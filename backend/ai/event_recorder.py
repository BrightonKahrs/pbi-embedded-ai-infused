"""Per-request event recorder for AG-UI-style explainability.

The recorder captures a stream of structured events while an agent run is
in progress (run start/finish, tool invocations, reasoning notes) and
exposes them on the chat response so the front-end can show *what the AI
is doing*. The event names mirror the AG-UI protocol vocabulary
(``RUN_STARTED``, ``TOOL_CALL_START``, etc.) but we keep the transport
on the existing REST endpoint — no SSE rewire required.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


EventType = Literal[
    "RUN_STARTED",
    "RUN_FINISHED",
    "RUN_ERROR",
    "TOOL_CALL_START",
    "TOOL_CALL_RESULT",
    "TEXT_MESSAGE_CONTENT",
    "REASONING",
]


class AgentEvent(BaseModel):
    """A single observable event emitted during an agent run."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: EventType
    timestamp: float = Field(default_factory=time.time)
    name: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    duration_ms: Optional[float] = None


class EventRecorder:
    """Collects ``AgentEvent`` instances for a single request.

    The recorder is intentionally thread-unsafe — instantiate one per
    request. Callers wrap their tool invocations with
    :meth:`start_tool` / :meth:`end_tool` to capture the inputs, output
    and elapsed time, and emit a :meth:`end_run` event at the very end.
    """

    def __init__(self) -> None:
        self.events: List[AgentEvent] = []
        self._run_started_at: Optional[float] = None
        self._tool_starts: Dict[str, float] = {}

    # -- run lifecycle ---------------------------------------------------

    def start_run(self) -> None:
        self._run_started_at = time.perf_counter()
        self._emit("RUN_STARTED", name="agent_run")

    def end_run(self, success: bool, error: Optional[str] = None) -> None:
        duration_ms: Optional[float] = None
        if self._run_started_at is not None:
            duration_ms = (time.perf_counter() - self._run_started_at) * 1000.0
        if success:
            self._emit("RUN_FINISHED", name="agent_run", duration_ms=duration_ms)
        else:
            self._emit(
                "RUN_ERROR",
                name="agent_run",
                details={"error": error or "unknown error"},
                duration_ms=duration_ms,
            )

    # -- tool lifecycle --------------------------------------------------

    def start_tool(self, name: str, args: Dict[str, Any]) -> str:
        tool_call_id = str(uuid.uuid4())
        self._tool_starts[tool_call_id] = time.perf_counter()
        self._emit(
            "TOOL_CALL_START",
            name=name,
            details={"tool_call_id": tool_call_id, "args": _safe(args)},
        )
        return tool_call_id

    def end_tool(
        self,
        tool_call_id: str,
        result: Any,
        error: Optional[str] = None,
    ) -> None:
        started = self._tool_starts.pop(tool_call_id, None)
        duration_ms = (
            (time.perf_counter() - started) * 1000.0 if started is not None else None
        )
        details: Dict[str, Any] = {"tool_call_id": tool_call_id}
        if error is not None:
            details["error"] = error
        details["result"] = _summarize_result(result)
        self._emit(
            "TOOL_CALL_RESULT",
            name=None,
            details=details,
            duration_ms=duration_ms,
        )

    # -- free-form -------------------------------------------------------

    def add_text(self, content: str) -> None:
        self._emit(
            "TEXT_MESSAGE_CONTENT",
            details={"content": content},
        )

    def add_reasoning(self, details: Dict[str, Any]) -> None:
        self._emit("REASONING", details=_safe(details))

    # -- internals -------------------------------------------------------

    def _emit(
        self,
        event_type: EventType,
        name: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[float] = None,
    ) -> None:
        self.events.append(
            AgentEvent(
                type=event_type,
                name=name,
                details=details or {},
                duration_ms=duration_ms,
            )
        )


def _safe(value: Any) -> Any:
    """Best-effort coercion to JSON-friendly types."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    return str(value)


def _summarize_result(result: Any) -> Any:
    """Compress potentially huge tool results into a panel-friendly form."""
    if isinstance(result, str):
        if len(result) > 2000:
            return {"preview": result[:2000], "truncated": True, "length": len(result)}
        return result
    if isinstance(result, list):
        if len(result) > 50:
            return {
                "preview": _safe(result[:50]),
                "truncated": True,
                "row_count": len(result),
            }
        return _safe(result)
    return _safe(result)
