"""Per-visual streaming explainer for the deep DAX agent run.

When ``RouterAgent.route_to_deep_analysis`` pushes an ``InlineVisuals``
payload for a captured DAX query, it also kicks off this helper as a
background task. The helper makes a single fast-model chat call,
streams the tokens back out, and pushes ``visual_explanation_delta``
plus ``visual_explanation_end`` payloads onto the per-request custom
event queue. The SSE generator maps those onto ``VisualExplanationDelta``
/ ``VisualExplanationEnd`` CUSTOM events that the front-end ties to a
specific visual by ``visual_index``.

Keeping the explainer in its own module:
  * keeps ``router_agent.py`` focused on routing/orchestration;
  * lets the model + prompt be tuned without touching either agent;
  * stays out of the deep agent's hot path because it runs concurrently
    while the deep agent is computing the next DAX query.

The prompt is intentionally tight (truncated row preview, no skills /
context providers) so the fast model returns 2-3 sentences quickly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from agent_framework import Agent

from ai.agents.base_agent import BaseAgent
from ai.ai_config import config


logger = logging.getLogger(__name__)


# Keep the prompt small so the fast model returns 2-3 sentences quickly.
_MAX_ROWS_PREVIEW = 10
_MAX_PROMPT_ROW_CHARS = 600


SYSTEM_INSTRUCTIONS = """\
You explain Power BI visuals in plain English for a chat assistant.

You will be given:
- The user's original question.
- The DAX query the deep-analysis agent ran.
- A small preview of the result rows.
- The chosen inline visual configuration (visualType + title).

Write 2-3 short sentences that:
1. Say what the visual is showing (chart type + what's on each axis or slice).
2. Call out the most interesting takeaway from the preview rows
   (largest/smallest/notable change). Quote real numbers with thousands
   separators when helpful. Do not invent data outside the preview.

Plain prose only. No bullet points, no markdown headings, no preamble
like "Sure" or "Here is". Be direct.
"""


def _format_rows_preview(rows: List[Dict[str, Any]]) -> str:
    """Return a JSON string preview of ``rows``, capped by row count and char length."""
    if not rows:
        return "[]"
    sample = rows[:_MAX_ROWS_PREVIEW]
    text = json.dumps(sample, default=str)
    if len(text) > _MAX_PROMPT_ROW_CHARS:
        text = text[:_MAX_PROMPT_ROW_CHARS] + "...(truncated)"
    return text


class VisualExplainer(BaseAgent):
    """Lightweight fast-model helper that streams short per-visual explanations."""

    def __init__(self) -> None:
        super().__init__(
            agent_name="VisualExplainer",
            model_deployment_name=config.azure_ai_fast_model_deployment_name,
        )

    async def stream_explanation(
        self,
        *,
        custom_event_queue: "asyncio.Queue[tuple[str, Dict[str, Any]]]",
        visual_index: int,
        user_question: str,
        dax: str,
        rows: List[Dict[str, Any]],
        visual_config: Dict[str, Any],
        agent_label: str = "deep-analysis",
    ) -> None:
        """Stream a short explanation for one visual onto ``custom_event_queue``.

        Pushes ``("visual_explanation_delta", {...})`` payloads as the
        model streams tokens and finally a ``("visual_explanation_end",
        {...})`` so the frontend can stop the typing animation for this
        ``visual_index``. The ``visual_index`` is the per-run index of
        the visual inside this deep-analysis turn (0 for the first
        visual, 1 for the next, etc.).

        All errors are caught and logged — an explainer failure must
        never break the main router/deep-analysis flow.
        """
        try:
            self._ensure_client()
        except RuntimeError as exc:
            logger.warning(f"VisualExplainer not started: {exc}")
            await self._emit_end(custom_event_queue, visual_index, agent_label)
            return

        # Build a compact prompt the fast model can answer in 2-3 sentences.
        visual_type = visual_config.get("visualType", "chart")
        title = visual_config.get("title", "")
        prompt = (
            f"User question: {user_question}\n"
            f"Visual type: {visual_type}\n"
            f"Visual title: {title}\n"
            f"DAX query:\n{dax}\n"
            f"Result row count: {len(rows)}\n"
            f"Sample rows (first {min(len(rows), _MAX_ROWS_PREVIEW)}):\n"
            f"{_format_rows_preview(rows)}\n"
        )

        agent = Agent(
            client=self._client,
            name="VisualExplainer",
            instructions=SYSTEM_INSTRUCTIONS,
            tools=[],
        )

        any_delta = False
        try:
            stream = agent.run(messages=prompt, stream=True)
            async for update in stream:
                delta_text = self._extract_text(update)
                if not delta_text:
                    continue
                any_delta = True
                await custom_event_queue.put((
                    "visual_explanation_delta",
                    {
                        "visual_index": visual_index,
                        "delta": delta_text,
                        "agent": agent_label,
                    },
                ))
            # Drain the final response so any trailing tokens land in
            # the stream (some clients buffer the last chunk in
            # get_final_response only). Best-effort.
            try:
                final = await stream.get_final_response()
                final_text = final.text or ""
                if not any_delta and final_text:
                    await custom_event_queue.put((
                        "visual_explanation_delta",
                        {
                            "visual_index": visual_index,
                            "delta": final_text,
                            "agent": agent_label,
                        },
                    ))
            except Exception as final_exc:  # noqa: BLE001 - best-effort
                logger.debug(f"VisualExplainer get_final_response failed: {final_exc}")
        except Exception as exc:  # noqa: BLE001 - explainer must never break the run
            logger.warning(f"VisualExplainer stream failed: {exc}")
        finally:
            await self._emit_end(custom_event_queue, visual_index, agent_label)

    @staticmethod
    def _extract_text(update: Any) -> Optional[str]:
        """Pull any ``text`` content out of an ``AgentResponseUpdate``.

        Reasoning content is intentionally skipped — only user-facing
        text is forwarded as visual-explanation deltas.
        """
        contents = getattr(update, "contents", None) or []
        chunks: List[str] = []
        for content in contents:
            if getattr(content, "type", None) != "text":
                continue
            text = getattr(content, "text", None)
            if text:
                chunks.append(text)
        if chunks:
            return "".join(chunks)
        # Fallback to ``update.text`` if the framework exposes it directly.
        direct = getattr(update, "text", None)
        if isinstance(direct, str) and direct:
            return direct
        return None

    @staticmethod
    async def _emit_end(
        custom_event_queue: "asyncio.Queue[tuple[str, Dict[str, Any]]]",
        visual_index: int,
        agent_label: str,
    ) -> None:
        await custom_event_queue.put((
            "visual_explanation_end",
            {
                "visual_index": visual_index,
                "agent": agent_label,
            },
        ))
