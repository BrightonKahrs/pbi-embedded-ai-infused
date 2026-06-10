/**
 * AG-UI Protocol Type Definitions
 *
 * Ported from the ag-ui-playground reference project. These types
 * represent the wire format of AG-UI events streamed over SSE from
 * the backend's POST /api/chat/stream endpoint. Trimmed down to the
 * events this codebase actually consumes; add more as needed.
 */

// --- Event Types Enum ---
export enum AGUIEventType {
  RUN_STARTED = "RUN_STARTED",
  RUN_FINISHED = "RUN_FINISHED",
  RUN_ERROR = "RUN_ERROR",
  STEP_STARTED = "STEP_STARTED",
  STEP_FINISHED = "STEP_FINISHED",
  TEXT_MESSAGE_START = "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END = "TEXT_MESSAGE_END",
  TOOL_CALL_START = "TOOL_CALL_START",
  TOOL_CALL_ARGS = "TOOL_CALL_ARGS",
  TOOL_CALL_END = "TOOL_CALL_END",
  TOOL_CALL_RESULT = "TOOL_CALL_RESULT",
  STATE_SNAPSHOT = "STATE_SNAPSHOT",
  STATE_DELTA = "STATE_DELTA",
  MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT",
  REASONING_START = "REASONING_START",
  REASONING_MESSAGE_START = "REASONING_MESSAGE_START",
  REASONING_MESSAGE_CONTENT = "REASONING_MESSAGE_CONTENT",
  REASONING_MESSAGE_END = "REASONING_MESSAGE_END",
  REASONING_END = "REASONING_END",
  RAW = "RAW",
  CUSTOM = "CUSTOM",
}

// Synthetic event used purely by the front-end Event Inspector to
// represent the outgoing POST request as a row in the event log.
export const REQUEST_SENT_TYPE = "REQUEST_SENT";

// --- Event Interfaces ---

export interface RunStartedEvent {
  type: AGUIEventType.RUN_STARTED;
  threadId?: string;
  runId?: string;
}

export interface RunFinishedEvent {
  type: AGUIEventType.RUN_FINISHED;
  threadId?: string;
  runId?: string;
  result?: unknown;
}

export interface RunErrorEvent {
  type: AGUIEventType.RUN_ERROR;
  message: string;
  code?: string;
}

export interface StepStartedEvent {
  type: AGUIEventType.STEP_STARTED;
  stepName: string;
}

export interface StepFinishedEvent {
  type: AGUIEventType.STEP_FINISHED;
  stepName: string;
}

export interface TextMessageStartEvent {
  type: AGUIEventType.TEXT_MESSAGE_START;
  messageId: string;
  role: "assistant" | "user" | "system" | "tool";
}

export interface TextMessageContentEvent {
  type: AGUIEventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent {
  type: AGUIEventType.TEXT_MESSAGE_END;
  messageId: string;
}

export interface ToolCallStartEvent {
  type: AGUIEventType.TOOL_CALL_START;
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

export interface ToolCallArgsEvent {
  type: AGUIEventType.TOOL_CALL_ARGS;
  toolCallId: string;
  delta: string;
}

export interface ToolCallEndEvent {
  type: AGUIEventType.TOOL_CALL_END;
  toolCallId: string;
}

export interface ToolCallResultEvent {
  type: AGUIEventType.TOOL_CALL_RESULT;
  toolCallId: string;
  content: string;
  role?: string;
}

export interface MessagesSnapshotEvent {
  type: AGUIEventType.MESSAGES_SNAPSHOT;
  messages: Array<{ role: string; content: string }>;
}

export interface CustomEvent {
  type: AGUIEventType.CUSTOM;
  name: string;
  value: unknown;
}

export interface ReasoningStartEvent {
  type: AGUIEventType.REASONING_START;
  messageId?: string;
}

export interface ReasoningMessageContentEvent {
  type: AGUIEventType.REASONING_MESSAGE_CONTENT;
  messageId?: string;
  delta: string;
}

export interface ReasoningEndEvent {
  type: AGUIEventType.REASONING_END;
  messageId?: string;
}

// --- Discriminated Union ---

export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | MessagesSnapshotEvent
  | CustomEvent
  | ReasoningStartEvent
  | ReasoningMessageContentEvent
  | ReasoningEndEvent
  | { type: typeof REQUEST_SENT_TYPE };

// --- Request ---

export interface AGUIMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface AGUIRunRequest {
  messages: AGUIMessage[];
  threadId?: string;
  runId?: string;
  state?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

// --- Timestamped Event (for the inspector) ---

export interface TimestampedEvent {
  id: string;
  timestamp: number;
  event: AGUIEvent;
  /** When present, this entry represents the HTTP POST sent to the backend. */
  request?: AGUIRunRequest;
}

// --- Router/handoff payloads (CUSTOM event shapes used by this app) ---

export interface AgentHandoffPayload {
  from: string;
  to: string;
  reason: string;
  question?: string;
}

export interface InlineVisualsPayload {
  visuals: InlineVisualWire[];
}

/** Wire shape of an inline visual coming from the AG-UI CUSTOM event.
 *
 * Keeps the structure intentionally permissive so the existing
 * `InlineChart` component (which already accepts `InlineVisual` from
 * `services/api.ts`) can render it after a tiny shape conversion.
 */
export interface InlineVisualWire {
  config: Record<string, unknown>;
  data: Array<Record<string, unknown>>;
}

// --- Deep-agent CUSTOM event payloads --------------------------------------

/** Fired the moment the deep-analysis tool starts a sub-tool call. */
export interface DeepToolStartPayload {
  tool_call_id: string;
  name: string;
  args_preview?: string;
  agent: string;
}

/** Fired when a deep-analysis sub-tool call completes. */
export interface DeepToolEndPayload {
  tool_call_id: string;
  result_preview?: string;
  success: boolean;
  agent: string;
}

/** Streamed reasoning delta produced by the deep-analysis agent. */
export interface DeepReasoningPayload {
  delta: string;
  agent: string;
}

/** Generic reasoning payload (router / fast model). */
export interface ReasoningCustomPayload {
  content?: string;
  delta?: string;
  source?: string;
}

/** Streaming explanation delta for an inline visual produced by the
 * deep-analysis agent. The `visual_index` matches the index of the visual
 * in the cumulative `inlineVisuals` array on the frontend (i.e. arrival
 * order of `InlineVisuals` payloads). */
export interface VisualExplanationDeltaPayload {
  visual_index: number;
  delta: string;
  agent: string;
}

/** Terminator event for a per-visual explanation stream. */
export interface VisualExplanationEndPayload {
  visual_index: number;
  agent: string;
}
