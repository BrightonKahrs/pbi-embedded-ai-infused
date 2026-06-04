"""Fast entry/triage agent that routes deep analytical questions to the DAX agent.

Feature 5 (multi-agent): every chat turn lands on this agent first. It runs
on a fast model with three tools so it can answer the common case (a
single-shot DAX question) without paying the latency of the deep model.
It only routes to the DAX deep-analysis agent when the question genuinely
requires multi-step reasoning or several DAX queries.

When the routing tool fires we push several ``CustomEvent``-shaped
payloads onto a per-request queue:

* ``AgentHandoff`` — emitted *before* the heavy DAX run starts so the UI
  can render a "Routed to Deep Analysis Agent" chip immediately.
* ``InlineVisuals`` — emitted per captured DAX query (the deep agent
  streams these as it works) and also when the router answers a simple
  question directly via ``execute_dax_query``.
* ``DeepReasoning`` — emitted as the deep agent streams its reasoning
  summary so the UI can show the model's thinking live.
* ``DeepToolStart`` / ``DeepToolEnd`` — emitted around every tool the
  deep DaxAgent invokes (``execute_dax_query_tool``,
  ``inspect_data_model_tool``) so the frontend timeline can render a
  nested chip per deep-agent tool call as they happen.

The queue is drained by the SSE generator in ``main.py`` interleaved
with framework events, so these payloads end up alongside the regular
AG-UI ``RUN_*``/``TOOL_CALL_*`` event stream and appear immediately when
they are pushed (not buffered until the next framework event).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated, Any, Dict, List, Optional, Tuple

from agent_framework import Agent
from pydantic import Field

from ai.agents.base_agent import BaseAgent
from ai.agents.dax_agent import DaxAgent
from ai.agents.visual_creator_agent import VisualCreatorAgent
from ai.ai_config import config
from ai.tools.execute_dax_query_tool import execute_dax_query_tool
from ai.tools.inspect_data_model_tool import inspect_data_model_tool


logger = logging.getLogger(__name__)


# The router now has three tools and uses the fast model to answer the
# common case (single-shot DAX question) directly. Deep analysis is the
# exception, not the default — we only route when the question really
# needs multi-step reasoning or several queries.
SYSTEM_INSTRUCTIONS = f"""\
You are a fast Power BI analytics assistant. You have THREE tools:

TOOLS:
- inspect_data_model() -> schema description
- execute_dax_query(dax: str) -> result rows
  Use for SINGLE-shot analytical questions you can answer with one
  DAX query (sales by category, total profit by region, top 5
  products by sales, count of orders this year, etc).
- route_to_deep_analysis(question, reason)
  Use ONLY when the question genuinely needs MULTI-STEP reasoning
  or MULTIPLE DAX queries to answer (e.g. "compare growth across
  regions and identify outliers", "which products drive the most
  profit and why is that pattern shifting over time?").

DECISION RULES:
1. Direct answer (no tool):
   - greetings/thanks/who you are
   - definitional questions (what is DAX/a slicer/etc)
   - meta-questions about the data model — use inspect_data_model
     and answer in prose
2. execute_dax_query (default for analytical asks):
   - "show me X by Y"
   - "what's the total/avg/count of X"
   - "top/bottom N X"
   - "sales by category", "profit by region", etc.
   After running, present the result with a 2-3 sentence summary.
3. route_to_deep_analysis (rare):
   - Only when 2+ DAX queries are clearly needed
   - Only when multi-step reasoning is required
   - Examples: anomaly investigation, year-over-year multi-dimensional
     comparisons, "explain why X happened"

When in doubt, prefer execute_dax_query over route_to_deep_analysis.
The DAX schema is below — use it directly.

Data model schema:
{config.data_model_schema}
"""


# Payload kinds we push onto the per-request custom-event queue. The SSE
# layer in main.py knows how to wrap each one as the appropriate
# ``CustomEvent``.
CustomEventPayload = Tuple[str, Dict[str, Any]]


class RouterAgent(BaseAgent):
    """Lightweight router that answers simple DAX questions directly and
    delegates only the genuinely complex ones to the DAX deep-analysis agent."""

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

        # ------------------------------------------------------------------
        # Helper: build a single-element InlineVisuals payload from one
        # captured DAX query + rows by asking the visual creator agent
        # for a sensible chart config.
        # ------------------------------------------------------------------
        async def push_visual_for_query(
            user_message: str,
            query: Dict[str, Any],
        ) -> None:
            rows = query.get("rows", []) or []
            if not rows:
                return
            try:
                suggested = await visual_creator_agent.suggest_visual_for_rows(
                    user_message=user_message,
                    rows=rows,
                )
            except Exception as exc:  # noqa: BLE001 - visuals are best-effort
                logger.warning(f"Inline visual suggestion failed: {exc}")
                return
            if suggested is None:
                return
            await custom_event_queue.put((
                "inline_visuals",
                {
                    "visuals": [{
                        "config": suggested.model_dump(),
                        "data": rows,
                    }],
                },
            ))

        # ------------------------------------------------------------------
        # Tool 1: execute_dax_query directly from the router so simple
        # single-shot analytical questions don't need to hop through the
        # deep agent. After running we also fire off a visual suggestion
        # so the chat shows an inline chart for the answer.
        # ------------------------------------------------------------------
        async def execute_dax_query(
            dax: Annotated[
                str,
                Field(description="A complete EVALUATE DAX query to run against the Power BI semantic model."),
            ],
            user_message: Annotated[
                str,
                Field(
                    description=(
                        "The original natural-language user question. Used to pick a sensible inline visual."
                    )
                ),
            ],
        ) -> str:
            """Run a single DAX query and emit an inline visual for the results."""
            result = await execute_dax_query_tool(dax)
            try:
                parsed = json.loads(result)
            except (json.JSONDecodeError, ValueError):
                # Tool returned an error/string — nothing to chart.
                return result
            if not isinstance(parsed, list) or not parsed:
                return result

            # Best-effort inline visual. We do this BEFORE returning so
            # the visual chip lands in the timeline ahead of the answer
            # bubble that the model produces from this tool result.
            await push_visual_for_query(user_message, {"dax": dax, "rows": parsed})
            return result

        # ------------------------------------------------------------------
        # Tool 2: inspect_data_model. Thin pass-through so the router can
        # answer meta-questions about the model without routing.
        # ------------------------------------------------------------------
        async def inspect_data_model(
            target: Annotated[
                str,
                Field(description="What to introspect: 'columns' (default), 'tables', or 'measures'."),
            ] = "columns",
            table_name: Annotated[
                Optional[str],
                Field(description="Optional table name to filter results to a single table."),
            ] = None,
        ) -> str:
            """Introspect the live Power BI semantic model (tables/columns/measures)."""
            return await inspect_data_model_tool(target=target, table_name=table_name)

        # ------------------------------------------------------------------
        # Tool 3: route_to_deep_analysis. Reserved for genuinely complex
        # questions. Streams interim per-query visuals and reasoning
        # deltas through the custom-event queue.
        # ------------------------------------------------------------------
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

            # Track which captured queries we've already turned into
            # visuals so the final fallback emit doesn't double up.
            pushed_query_keys: set = set()

            async def on_query_captured(query: Dict[str, Any]) -> None:
                key = id(query)
                pushed_query_keys.add(key)
                await push_visual_for_query(question, query)

            async def on_reasoning_delta(delta_text: str) -> None:
                # Use the dedicated ``deep_reasoning`` payload kind so
                # the frontend can render these chips under the deep
                # agent banner rather than mixing them with the
                # router's own (rare) reasoning output.
                await custom_event_queue.put((
                    "deep_reasoning",
                    {"delta": delta_text, "agent": "deep-analysis"},
                ))

            async def on_tool_start(
                tool_call_id: str,
                tool_name: str,
                args: Dict[str, Any],
            ) -> None:
                # Build a short preview of the first argument so the
                # chip can show e.g. the first 120 chars of the DAX
                # query without ballooning the SSE payload.
                preview_source = ""
                for v in args.values():
                    if isinstance(v, str):
                        preview_source = v
                        break
                args_preview = preview_source[:120]
                await custom_event_queue.put((
                    "deep_tool_start",
                    {
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "args_preview": args_preview,
                        "agent": "deep-analysis",
                    },
                ))

            async def on_tool_end(
                tool_call_id: str,
                tool_name: str,
                result_or_error: Optional[str],
                success: bool,
            ) -> None:
                result_preview = (result_or_error or "")[:200]
                await custom_event_queue.put((
                    "deep_tool_end",
                    {
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "result_preview": result_preview,
                        "success": success,
                        "agent": "deep-analysis",
                    },
                ))

            answer_text, captured_queries = await dax_agent.generate_dax_query(
                user_query=question,
                on_query_captured=on_query_captured,
                on_reasoning_delta=on_reasoning_delta,
                on_tool_start=on_tool_start,
                on_tool_end=on_tool_end,
            )

            # Safety net: if any captured query wasn't pushed via the
            # interim callback (shouldn't normally happen), aggregate
            # what's left into a single trailing InlineVisuals payload.
            leftover = [q for q in captured_queries if id(q) not in pushed_query_keys]
            if leftover:
                try:
                    suggested_configs = await visual_creator_agent.suggest_visuals_for_queries(
                        user_message=question,
                        queries=leftover,
                    )
                    visuals: List[Dict[str, Any]] = []
                    for query, suggested in zip(leftover, suggested_configs):
                        if suggested is None:
                            continue
                        visuals.append({
                            "config": suggested.model_dump(),
                            "data": query.get("rows", []),
                        })
                    if visuals:
                        await custom_event_queue.put((
                            "inline_visuals",
                            {"visuals": visuals},
                        ))
                except Exception as exc:  # noqa: BLE001 - visuals are best-effort
                    logger.warning(f"Trailing inline visual suggestion failed: {exc}")

            return answer_text or ""

        agent = Agent(
            client=self._client,
            name="RouterAgent",
            instructions=SYSTEM_INSTRUCTIONS,
            tools=[execute_dax_query, inspect_data_model, route_to_deep_analysis],
        )
        return agent
