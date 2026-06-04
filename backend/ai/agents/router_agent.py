"""Fast entry/triage agent that routes deep analytical questions to the DAX agent.

Feature 5 (multi-agent): every chat turn lands on this agent first. It uses
a fast model with a tiny prompt to either answer simple greetings /
clarifications directly OR call the ``route_to_deep_analysis`` tool, which
internally invokes the existing :class:`DaxAgent` for any question that
needs DAX over the Power BI model.

When the routing tool fires we push two ``CustomEvent``-shaped payloads
onto a per-request queue:

* ``AgentHandoff`` — emitted *before* the heavy DAX run starts so the UI
  can render a "Routed to Deep Analysis Agent" chip immediately.
* ``InlineVisuals`` — emitted after the DAX agent returns, carrying the
  inline ``VisualConfig`` previews produced by the visual creator agent.

The queue is drained by the SSE generator in ``main.py`` between
framework events, so these payloads end up interleaved with the regular
AG-UI ``RUN_*``/``TOOL_CALL_*`` event stream.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated, Any, Dict, List, Optional, Tuple

from agent_framework import Agent
from pydantic import Field

from ai.agents.base_agent import BaseAgent
from ai.agents.dax_agent import DaxAgent
from ai.agents.visual_creator_agent import VisualCreatorAgent
from ai.ai_config import config


logger = logging.getLogger(__name__)


# Kept intentionally short — this agent should answer trivial things on
# its own and route only when real analysis is needed. We DO include the
# data-model schema below so it can answer meta-questions like "what
# tables do you have?" without round-tripping to the deep agent. We do
# NOT teach it how to write DAX; that belongs to the DAX agent.
SYSTEM_INSTRUCTIONS = f"""\
You are a fast triage assistant for a Power BI analytics chat.

You have ONE tool:
- route_to_deep_analysis(question: str, reason: str): hands the user's
  question to a specialist DAX agent that knows the data model, writes
  DAX, runs queries, and produces a charted answer. Use this whenever
  the answer requires actually querying the Power BI model.

Data model schema (use this to answer meta-questions directly, without
routing):
{config.data_model_schema}

Decision rules:
1. Answer directly (do NOT call the tool) when the request is any of:
   - greetings, thanks, who/what you are, what you can do, "help"
   - meta questions about the data model schema (you have the schema
     above — describe it)
   - one-shot definitional questions ("what is DAX?", "what's a
     slicer?")
2. You MUST call route_to_deep_analysis whenever the answer requires:
   - any DAX query against the model,
   - comparison or aggregation of values from the data,
   - identifying top/bottom items, trends, or anomalies,
   - building any chart or visual,
   - any multi-step reasoning ("which region grew fastest YoY?",
     "what correlates with profit?", anything implying more than one
     query).
   Pass the user's question verbatim as `question` and a 1-sentence
   `reason` explaining why this needs deep analysis.
3. When the tool returns, present its answer to the user verbatim. Do
   not re-summarize, do not add caveats, do not invent numbers. The
   tool's answer is already the final analyst response.
"""


# Payload kinds we push onto the per-request custom-event queue. The SSE
# layer in main.py knows how to wrap each one as the appropriate
# ``CustomEvent``.
CustomEventPayload = Tuple[str, Dict[str, Any]]


class RouterAgent(BaseAgent):
    """Lightweight router that delegates analytical questions to the DAX agent."""

    def __init__(
        self,
        dax_agent: DaxAgent,
        visual_creator_agent: VisualCreatorAgent,
    ) -> None:
        super().__init__(
            agent_name="RouterAgent",
            model_deployment_name=config.azure_ai_fast_model_deployment_name,
        )
        self._dax_agent = dax_agent
        self._visual_creator_agent = visual_creator_agent

    def build_agent(self, custom_event_queue: "asyncio.Queue[CustomEventPayload]") -> Agent:
        """Build a fresh ``Agent`` wired to push CUSTOM events into ``custom_event_queue``.

        We create the agent per request so the routing tool can close
        over the queue without leaking state across concurrent requests.
        """
        self._ensure_client()
        dax_agent = self._dax_agent
        visual_creator_agent = self._visual_creator_agent

        async def route_to_deep_analysis(
            question: Annotated[
                str,
                Field(description="The user's question, passed verbatim to the deep-analysis agent."),
            ],
            reason: Annotated[
                str,
                Field(description="One-sentence justification for why this needs the deep-analysis agent."),
            ],
        ) -> str:
            """Hand off the user's question to the DAX deep-analysis agent."""
            logger.info(f"RouterAgent → DaxAgent handoff: {reason}")
            await custom_event_queue.put((
                "handoff",
                {
                    "from": "router",
                    "to": "dax-deep-analysis",
                    "reason": reason,
                    "question": question,
                },
            ))

            answer_text, captured_queries = await dax_agent.generate_dax_query(
                user_query=question,
            )

            visuals: List[Dict[str, Any]] = []
            if captured_queries:
                try:
                    suggested_configs = await visual_creator_agent.suggest_visuals_for_queries(
                        user_message=question,
                        queries=captured_queries,
                    )
                    for query, suggested in zip(captured_queries, suggested_configs):
                        if suggested is None:
                            continue
                        visuals.append({
                            "config": suggested.model_dump(),
                            "data": query.get("rows", []),
                        })
                except Exception as exc:  # noqa: BLE001 - visuals are best-effort
                    logger.warning(f"Inline visual suggestion failed: {exc}")

            if visuals:
                await custom_event_queue.put((
                    "inline_visuals",
                    {"visuals": visuals},
                ))

            return answer_text or ""

        agent = Agent(
            client=self._client,
            name="RouterAgent",
            instructions=SYSTEM_INSTRUCTIONS,
            tools=[route_to_deep_analysis],
        )
        return agent
