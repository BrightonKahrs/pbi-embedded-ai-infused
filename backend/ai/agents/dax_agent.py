import json
import logging
import uuid
from typing import Annotated, Any, Awaitable, Callable, Dict, List, Optional, Tuple

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
        on_query_captured: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        on_reasoning_delta: Optional[Callable[[str], Awaitable[None]]] = None,
        on_tool_start: Optional[Callable[[str, str, Dict[str, Any]], Awaitable[None]]] = None,
        on_tool_end: Optional[Callable[[str, str, Optional[str], bool], Awaitable[None]]] = None,
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

        ``on_query_captured`` is invoked (awaited) immediately after each
        successful ``execute_dax_query_tool`` call so callers can emit
        interim per-query visuals while the deep agent is still working.

        ``on_reasoning_delta`` is invoked with the text of each reasoning
        summary chunk emitted while streaming. Callers use it to surface
        the deep agent's thinking in the chat as it happens.

        ``on_tool_start`` / ``on_tool_end`` fire around EVERY tool the
        deep agent invokes — ``execute_dax_query_tool`` and
        ``inspect_data_model_tool``. The router agent wires these to
        push nested tool-call CUSTOM events onto its SSE queue so the
        frontend timeline can render a chip per deep-agent tool call as
        they happen. Signatures:
            ``on_tool_start(tool_call_id, tool_name, args)``
            ``on_tool_end(tool_call_id, tool_name, result_or_error, success)``
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
                    captured = {"dax": dax_query, "rows": parsed}
                    captured_queries.append(captured)
                    if on_query_captured is not None:
                        try:
                            await on_query_captured(captured)
                        except Exception as cb_exc:  # noqa: BLE001 - callback is best-effort
                            logger.warning(f"on_query_captured callback failed: {cb_exc}")
            except (json.JSONDecodeError, ValueError):
                # Tool returned an error string, not JSON rows — skip
                # capture so the chat won't suggest a visual for it.
                pass
            return result

        # Wrap the (already wrapped) tools with the event recorder so the
        # explainability panel can show what the agent invoked, what
        # arguments it passed, and how long each call took. The recorder
        # wrappers are pure observers — they do not alter the tool's
        # return value. They also fan out to the optional
        # ``on_tool_start`` / ``on_tool_end`` callbacks so callers (the
        # router agent) can stream nested tool-call events for the deep
        # agent through the SSE channel in real time.
        async def _emit_tool_start(name: str, args: Dict[str, Any]) -> str:
            tool_call_id = f"deep-{uuid.uuid4().hex[:12]}"
            if on_tool_start is not None:
                try:
                    await on_tool_start(tool_call_id, name, args)
                except Exception as cb_exc:  # noqa: BLE001 - callback is best-effort
                    logger.warning(f"on_tool_start callback failed: {cb_exc}")
            return tool_call_id

        async def _emit_tool_end(
            tool_call_id: str,
            name: str,
            result_or_error: Optional[str],
            success: bool,
        ) -> None:
            if on_tool_end is not None:
                try:
                    await on_tool_end(tool_call_id, name, result_or_error, success)
                except Exception as cb_exc:  # noqa: BLE001 - callback is best-effort
                    logger.warning(f"on_tool_end callback failed: {cb_exc}")

        async def recorded_execute_dax_query_tool(
            dax_query: Annotated[
                str,
                Field(description="The DAX query to execute on the power bi semantic model"),
            ],
        ) -> str:
            tool_call_id = await _emit_tool_start(
                "execute_dax_query_tool", {"dax_query": dax_query}
            )
            recorder_call_id: Optional[str] = None
            if recorder is not None:
                recorder_call_id = recorder.start_tool(
                    "execute_dax_query_tool", {"dax_query": dax_query}
                )
            try:
                result = await execute_dax_query_tool_capture(dax_query)
            except Exception as exc:  # noqa: BLE001
                if recorder is not None and recorder_call_id is not None:
                    recorder.end_tool(recorder_call_id, result=None, error=str(exc))
                await _emit_tool_end(
                    tool_call_id, "execute_dax_query_tool", str(exc), success=False
                )
                raise
            row_count: Optional[int] = None
            try:
                parsed = json.loads(result)
                if isinstance(parsed, list):
                    row_count = len(parsed)
            except (json.JSONDecodeError, ValueError):
                pass
            if recorder is not None and recorder_call_id is not None:
                recorder.end_tool(
                    recorder_call_id,
                    result={"rows": row_count, "raw": result} if row_count is not None else result,
                )
            await _emit_tool_end(
                tool_call_id, "execute_dax_query_tool", result, success=True
            )
            return result

        async def recorded_inspect_data_model_tool(
            info_function: Annotated[
                str,
                Field(description="The INFO function or DMV query to run against the model."),
            ],
        ) -> str:
            tool_call_id = await _emit_tool_start(
                "inspect_data_model_tool", {"info_function": info_function}
            )
            recorder_call_id: Optional[str] = None
            if recorder is not None:
                recorder_call_id = recorder.start_tool(
                    "inspect_data_model_tool", {"info_function": info_function}
                )
            try:
                result = await inspect_data_model_tool(info_function)
            except Exception as exc:  # noqa: BLE001
                if recorder is not None and recorder_call_id is not None:
                    recorder.end_tool(recorder_call_id, result=None, error=str(exc))
                await _emit_tool_end(
                    tool_call_id, "inspect_data_model_tool", str(exc), success=False
                )
                raise
            if recorder is not None and recorder_call_id is not None:
                recorder.end_tool(recorder_call_id, result=result)
            await _emit_tool_end(
                tool_call_id, "inspect_data_model_tool", result, success=True
            )
            return result

        agent = Agent(
            client=self._client,
            name="DaxAgent",
            instructions=SYSTEM_INSTRUCTIONS,
            tools=[recorded_execute_dax_query_tool, recorded_inspect_data_model_tool],
            context_providers=[self._skills_provider],
        )

        # Ask the model for low-effort reasoning with concise summaries
        # so we can stream "thinking" deltas into the chat. The OpenAI
        # Responses API (which the Foundry chat client wraps) expects
        # ``reasoning={"effort": ..., "summary": ...}`` as a top-level
        # option key — ``OpenAIChatOptions`` declares this as a typed
        # field and the OpenAI chat client passes it through verbatim.
        # When the deployment supports reasoning summaries the API
        # streams ``response.reasoning_summary_text.delta`` events that
        # the framework surfaces as ``Content`` items with
        # ``type="text_reasoning"``.
        run_options: Dict[str, Any] = {
            "reasoning": {"effort": "low", "summary": "auto"},
        }

        stream = agent.run(
            messages=user_query,
            stream=True,
            options=run_options,
        )

        async for update in stream:
            contents = getattr(update, "contents", None) or []
            for content in contents:
                if getattr(content, "type", None) != "text_reasoning":
                    continue
                delta_text = self._extract_reasoning_text(content)
                if on_reasoning_delta is None:
                    continue
                if not delta_text:
                    # Defensive: reasoning content arrived but no text
                    # could be extracted. Log enough context to debug
                    # whether the framework is putting the text on a
                    # different attribute (e.g. ``protected_data``) or
                    # whether the model is returning encrypted-only
                    # reasoning.
                    logger.debug(
                        "Reasoning content received without extractable text: "
                        f"attrs={sorted(k for k in vars(content) if not k.startswith('_'))} "
                        f"raw_type={type(getattr(content, 'raw_representation', None)).__name__}"
                    )
                    continue
                try:
                    await on_reasoning_delta(delta_text)
                except Exception as cb_exc:  # noqa: BLE001 - callback is best-effort
                    logger.warning(f"on_reasoning_delta callback failed: {cb_exc}")

        result = await stream.get_final_response()
        answer_text = result.text or ""
        logger.info(
            f"DAX agent answer: {answer_text} "
            f"(captured {len(captured_queries)} query result(s))"
        )
        if recorder is not None:
            recorder.add_reasoning({"answer_preview": answer_text[:160]})
        return answer_text, captured_queries

    @staticmethod
    def _extract_reasoning_text(content: Any) -> Optional[str]:
        """Pull human-readable text from a ``text_reasoning`` ``Content``.

        The OpenAI/Foundry chat client populates ``Content.text`` for
        reasoning summary deltas (``response.reasoning_summary_text.delta``)
        and full reasoning text events (``response.reasoning_text.delta``).
        We also fall back to ``additional_properties['reasoning_text']``
        which some upstream code paths surface — defensive against
        framework version churn.
        """
        text = getattr(content, "text", None)
        if isinstance(text, str) and text:
            return text
        extras = getattr(content, "additional_properties", None) or {}
        for key in ("reasoning_text", "summary_text", "text"):
            value = extras.get(key)
            if isinstance(value, str) and value:
                return value
        return None
