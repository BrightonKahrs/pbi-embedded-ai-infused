import json
import logging
from typing import Annotated, Any, Dict, List, Optional, Tuple

from agent_framework import Agent
from agent_framework._skills import SkillsProvider
from pydantic import Field

from ai.ai_config import config
from ai.event_recorder import EventRecorder
from ai.tools.execute_dax_query_tool import execute_dax_query_tool
from ai.tools.inspect_data_model_tool import inspect_data_model_tool
from ai.skills.dax_skill import build_dax_skills_source
from ai.agents.base_agent import BaseAgent


logger = logging.getLogger(__name__)


# The data model schema and DAX authoring rules live in the file-based
# `dax-expert` skill (see ai/skills/dax-expert/SKILL.md). This system
# prompt only orchestrates the workflow.
SYSTEM_INSTRUCTIONS = """\
You are an expert DAX query generator for a Power BI semantic model.

You have access to two tools:
- inspect_data_model_tool: introspects the live model via INFO functions.
  Only call it when the user mentions a column or table that is NOT
  documented in the dax-expert skill.
- execute_dax_query_tool: runs a DAX query through the Power BI
  executeQueries REST API and returns rows.

The dax-expert skill attached to this agent contains the canonical data
model schema and DAX authoring rules. Treat that skill as the source of
truth — when its guidance conflicts with anything else, the skill wins.

Workflow for every user question:
  1. Compose DAX queries that follow the dax-expert skill rules.
  2. Call execute_dax_query_tool. You MAY call it more than once when a
     single query cannot answer the question on its own (for example,
     when the user asks to compare different measures, different time
     grains, or different breakdowns side-by-side). Each query must
     remain minimal and focused — do NOT cram multiple analyses into
     one EVALUATE.
  3. Keep the number of queries small. Never call execute_dax_query_tool
     more than 4 times for a single user question.
  4. Translate the rows into a concise, human-readable answer with
     numbers formatted using thousands separators. When you ran more
     than one query, weave the results together in the answer.
"""


MAX_DAX_QUERIES_PER_RUN = 4


class DaxAgent(BaseAgent):
    """Agent that specializes in translating natural language to DAX queries."""

    def __init__(self):
        super().__init__(
            agent_name="DaxAgent",
            model_deployment_name=config.azure_ai_deep_model_deployment_name,
        )
        self._skills_provider = SkillsProvider(build_dax_skills_source())

    async def generate_dax_query(
        self,
        user_query: str,
        recorder: Optional[EventRecorder] = None,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """Generate the DAX-driven answer for a user question.

        Returns a tuple ``(answer_text, captured_queries)``.
        ``captured_queries`` is the ordered list of every successful
        ``execute_dax_query_tool`` invocation during this run. Each entry
        is a dict ``{"dax": str, "rows": List[dict]}``. The list is empty
        when no DAX query produced rows. The caller can pair each query's
        rows with a ``VisualConfig`` to produce one or more inline
        charts.

        If ``recorder`` is provided, tool calls and a final ``REASONING``
        summary event are appended to it so callers can surface
        explainability data on the response.
        """
        self._ensure_client()

        if not self._client:
            raise RuntimeError("DaxAgent not started. Call start() first.")

        # Per-request capture state. We wrap the existing tool so we can
        # observe the rows it returned without changing its public API,
        # and we cap the number of invocations to keep runaway loops in
        # check.
        captured_queries: List[Dict[str, Any]] = []
        invocation_count = {"n": 0}

        async def execute_dax_query_tool_capture(
            dax_query: Annotated[
                str,
                Field(description="The DAX query to execute on the power bi semantic model"),
            ],
        ) -> str:
            """Execute a DAX query against the Power BI dataset and capture rows for charting."""
            invocation_count["n"] += 1
            if invocation_count["n"] > MAX_DAX_QUERIES_PER_RUN:
                raise RuntimeError(
                    f"execute_dax_query_tool was called more than "
                    f"{MAX_DAX_QUERIES_PER_RUN} times for a single user "
                    "question. Refusing to run another query to avoid a "
                    "runaway loop."
                )
            result = await execute_dax_query_tool(dax_query)
            try:
                parsed = json.loads(result)
                if isinstance(parsed, list):
                    captured_queries.append({"dax": dax_query, "rows": parsed})
            except (json.JSONDecodeError, ValueError):
                # Tool returned an error string, not JSON rows — skip
                # capture so the chat won't suggest a visual for it.
                pass
            return result

        # Wrap the (already wrapped) tools with the event recorder so the
        # explainability panel can show what the agent invoked, what
        # arguments it passed, and how long each call took. The recorder
        # wrappers are pure observers — they do not alter the tool's
        # return value.
        async def recorded_execute_dax_query_tool(
            dax_query: Annotated[
                str,
                Field(description="The DAX query to execute on the power bi semantic model"),
            ],
        ) -> str:
            if recorder is None:
                return await execute_dax_query_tool_capture(dax_query)
            tool_call_id = recorder.start_tool(
                "execute_dax_query_tool", {"dax_query": dax_query}
            )
            try:
                result = await execute_dax_query_tool_capture(dax_query)
            except Exception as exc:  # noqa: BLE001
                recorder.end_tool(tool_call_id, result=None, error=str(exc))
                raise
            row_count: Optional[int] = None
            try:
                parsed = json.loads(result)
                if isinstance(parsed, list):
                    row_count = len(parsed)
            except (json.JSONDecodeError, ValueError):
                pass
            recorder.end_tool(
                tool_call_id,
                result={"rows": row_count, "raw": result} if row_count is not None else result,
            )
            return result

        async def recorded_inspect_data_model_tool(
            info_function: Annotated[
                str,
                Field(description="The INFO function or DMV query to run against the model."),
            ],
        ) -> str:
            if recorder is None:
                return await inspect_data_model_tool(info_function)
            tool_call_id = recorder.start_tool(
                "inspect_data_model_tool", {"info_function": info_function}
            )
            try:
                result = await inspect_data_model_tool(info_function)
            except Exception as exc:  # noqa: BLE001
                recorder.end_tool(tool_call_id, result=None, error=str(exc))
                raise
            recorder.end_tool(tool_call_id, result=result)
            return result

        agent = Agent(
            client=self._client,
            name="DaxAgent",
            instructions=SYSTEM_INSTRUCTIONS,
            tools=[recorded_execute_dax_query_tool, recorded_inspect_data_model_tool],
            context_providers=[self._skills_provider],
        )

        result = await agent.run(messages=user_query)
        logger.info(
            f"DAX agent answer: {result.text} "
            f"(captured {len(captured_queries)} query result(s))"
        )
        if recorder is not None:
            answer_text = result.text or ""
            recorder.add_reasoning({"answer_preview": answer_text[:160]})
        return result.text, captured_queries
