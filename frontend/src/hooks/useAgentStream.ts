/**
 * useAgentStream — consumes the AG-UI SSE stream from
 * `POST /api/chat/stream` and exposes everything the UI needs to render
 * the chat as a strict-arrival-order timeline.
 *
 * Key exports:
 *
 * - `messages`        chat-bubble friendly messages incl. `hasContent`
 * - `events`          raw timestamped events for the explainability panel
 * - `toolCalls`       per-tool-call status for the router agent
 * - `deepToolCalls`   per-tool-call status for the deep-analysis agent
 *                     (rendered as indented chips under the handoff banner)
 * - `routingEvents`   handoff banners (CUSTOM "AgentHandoff")
 * - `inlineVisuals`   inline visual configs (CUSTOM "InlineVisuals" /
 *                     "inline_visuals") — appended incrementally as the
 *                     backend pushes one or more visuals per DAX query
 * - `reasoningBlocks` reasoning cards keyed by source/agent
 * - `timelineItems`   a single, insertion-ordered list of items the chat
 *                     iterates over. Each item carries a `kind`
 *                     discriminator so the renderer can dispatch:
 *                     `'message' | 'tool' | 'handoff' | 'deep-tool' |
 *                     'reasoning' | 'visual'`. Preserving arrival order
 *                     is critical — the user explicitly wants updates
 *                     shown as they happen (e.g. the handoff banner must
 *                     appear BEFORE deep-agent tool chips).
 * - `isRunning`       true while an SSE connection is open
 * - `error`           latest error string, if any
 *
 * Also exposes `sendMessage(text)`, `cancelRun()`, and `clear()`.
 */

import { useCallback, useRef, useState } from "react";
import type {
  AGUIEvent,
  AGUIMessage,
  AGUIRunRequest,
  AgentHandoffPayload,
  DeepReasoningPayload,
  DeepToolEndPayload,
  DeepToolStartPayload,
  InlineVisualWire,
  InlineVisualsPayload,
  ReasoningCustomPayload,
  TimestampedEvent,
} from "../types/ag-ui";
import { AGUIEventType, REQUEST_SENT_TYPE } from "../types/ag-ui";
import { streamAgentResponse } from "../services/sseChatClient";
import { apiService } from "../services/api";

export interface StreamChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  /** True once at least one non-empty TEXT_MESSAGE_CONTENT delta has
   * been received. The empty white placeholder bubble that used to flash
   * at the start of a stream was caused by rendering on isStreaming
   * alone — this flag lets the renderer suppress the bubble until there
   * is actual content to show. */
  hasContent?: boolean;
  /** Inline visuals attached to this assistant message (assistant only). */
  visuals?: InlineVisualWire[];
  /** Insertion timestamp — used to interleave messages with activity events
   * into a single chat timeline. */
  ts: number;
  order: number;
}

export type ToolCallStatus = "calling" | "complete" | "error";

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: ToolCallStatus;
  order: number;
}

export type DeepToolStatus = "running" | "done" | "failed";

export interface DeepToolCall {
  id: string;
  name: string;
  args_preview: string;
  result_preview?: string;
  status: DeepToolStatus;
  order: number;
}

export interface ReasoningBlock {
  /** Stable id derived from the source string. */
  id: string;
  /** Logical source — e.g. "deep-analysis" or "router". */
  source: string;
  content: string;
  order: number;
}

export interface RoutingEvent extends AgentHandoffPayload {
  ts: number;
  /** Stable id for use as a timeline reference. */
  id: string;
}

// --- Timeline ---------------------------------------------------------------
//
// A SINGLE insertion-ordered list of "things to render" so the bubble
// timeline matches the exact arrival order of the SSE stream. Items
// reference the canonical state arrays above by id so that streaming
// updates to a tool call / reasoning block / message body don't require
// rewriting the timeline list itself.

export type TimelineItem =
  | { kind: "message"; id: string; messageId: string; ts: number }
  | { kind: "tool"; id: string; toolCallId: string; ts: number }
  | { kind: "handoff"; id: string; handoffId: string; ts: number }
  | { kind: "deep-tool"; id: string; toolCallId: string; ts: number }
  | { kind: "reasoning"; id: string; blockId: string; ts: number }
  | { kind: "visual"; id: string; visualIndex: number; ts: number };

interface UseAgentStreamReturn {
  messages: StreamChatMessage[];
  events: TimestampedEvent[];
  toolCalls: ToolCall[];
  deepToolCalls: DeepToolCall[];
  routingEvents: RoutingEvent[];
  inlineVisuals: InlineVisualWire[];
  reasoningBlocks: ReasoningBlock[];
  timelineItems: TimelineItem[];
  isRunning: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  cancelRun: () => void;
  clear: () => void;
}

const MAX_EVENTS = 1000;

export interface UseAgentStreamOptions {
  /** Override the SSE endpoint URL. Defaults to the backend's
   *  /api/chat/stream resolved against API_BASE_URL (so it works in
   *  CRA's dev server where the frontend is on :3000 and the API on :8000). */
  endpoint?: string;
  /** Optional seed message inserted at the top of the chat. */
  initialAssistantGreeting?: string;
}

// --- Usage / billing event filtering ---------------------------------------
//
// The Azure OpenAI client surfaces token-usage records through a few
// different shapes depending on the SSE wire format the backend chose
// (CUSTOM "usage", RAW with an inner event.type === 'usage', or a tool
// call literally named "usage"). None of these have anything useful for
// the end user — historically we rendered them as a stray "usage" chip.
// Drop them at the source so downstream state stays clean.

function isUsageEvent(event: AGUIEvent): boolean {
  const anyEv = event as any;
  const type = typeof anyEv?.type === "string" ? anyEv.type : "";

  if (type === AGUIEventType.CUSTOM) {
    const name = typeof anyEv.name === "string" ? anyEv.name : "";
    if (name.toLowerCase() === "usage") return true;
    const val = anyEv.value;
    if (val && typeof val === "object") {
      if ("prompt_tokens" in val || "completion_tokens" in val) return true;
    }
  }

  if (type === AGUIEventType.RAW || type === "RAW") {
    const inner = anyEv.event ?? anyEv.value ?? anyEv.payload;
    if (inner && typeof inner === "object") {
      const innerType = (inner as any).type;
      if (typeof innerType === "string" && innerType.toLowerCase() === "usage") {
        return true;
      }
      if ("prompt_tokens" in (inner as any) || "completion_tokens" in (inner as any)) {
        return true;
      }
    }
  }

  if (
    type === AGUIEventType.TOOL_CALL_START &&
    typeof anyEv.toolCallName === "string" &&
    anyEv.toolCallName.toLowerCase() === "usage"
  ) {
    return true;
  }

  return false;
}

function reasoningSourceFromPayload(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.agent === "string" && v.agent) return v.agent;
    if (typeof v.source === "string" && v.source) return v.source;
  }
  return "agent";
}

export function useAgentStream(
  options: UseAgentStreamOptions = {}
): UseAgentStreamReturn {
  const endpoint = options.endpoint ?? apiService.getChatStreamUrl();
  const initialGreeting = options.initialAssistantGreeting;

  const seedMessage = (): StreamChatMessage[] =>
    initialGreeting
      ? [
          {
            id: "msg-greeting",
            role: "assistant",
            content: initialGreeting,
            hasContent: true,
            order: 0,
            ts: Date.now(),
          },
        ]
      : [];

  const seedTimeline = (msgs: StreamChatMessage[]): TimelineItem[] =>
    msgs.map((m) => ({
      kind: "message" as const,
      id: `tl-msg-${m.id}`,
      messageId: m.id,
      ts: m.ts,
    }));

  const initialMessages = seedMessage();

  const [messages, setMessages] = useState<StreamChatMessage[]>(initialMessages);
  const [events, setEvents] = useState<TimestampedEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [deepToolCalls, setDeepToolCalls] = useState<DeepToolCall[]>([]);
  const [routingEvents, setRoutingEvents] = useState<RoutingEvent[]>([]);
  const [inlineVisuals, setInlineVisuals] = useState<InlineVisualWire[]>([]);
  const [reasoningBlocks, setReasoningBlocks] = useState<ReasoningBlock[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>(() =>
    seedTimeline(initialMessages)
  );
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const eventCounterRef = useRef(0);
  const timelineCounterRef = useRef(initialMessages.length);
  const orderCounterRef = useRef(initialGreeting ? 1 : 0);
  const conversationRef = useRef<AGUIMessage[]>([]);
  // Most-recent assistant message id (set on TEXT_MESSAGE_START). Used so
  // we can attach inline visuals to the right bubble.
  const lastAssistantIdRef = useRef<string | null>(null);
  // Visuals queued from a CUSTOM "InlineVisuals" event that arrived
  // before the matching assistant text-message bubble exists yet.
  const pendingVisualsRef = useRef<InlineVisualWire[]>([]);

  const nextTimelineId = useCallback(
    (kind: TimelineItem["kind"]) => `tl-${kind}-${timelineCounterRef.current++}`,
    []
  );

  const pushTimelineItem = useCallback((item: TimelineItem) => {
    setTimelineItems((prev) => [...prev, item]);
  }, []);

  const pushEvent = useCallback((event: AGUIEvent) => {
    const ts: TimestampedEvent = {
      id: `evt-${eventCounterRef.current++}`,
      timestamp: Date.now(),
      event,
    };
    setEvents((prev) => {
      const next = [...prev, ts];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const handleCustomEvent = useCallback(
    (name: string, value: unknown, ts: number) => {
      switch (name) {
        case "AgentHandoff": {
          if (!value) return;
          const payload = value as AgentHandoffPayload;
          const handoffId = `handoff-${timelineCounterRef.current}`;
          const routing: RoutingEvent = { ...payload, ts, id: handoffId };
          setRoutingEvents((prev) => [...prev, routing]);
          pushTimelineItem({
            kind: "handoff",
            id: nextTimelineId("handoff"),
            handoffId,
            ts,
          });
          return;
        }
        case "InlineVisuals":
        case "inline_visuals": {
          if (!value) return;
          const payload = value as InlineVisualsPayload;
          const visuals = Array.isArray(payload?.visuals) ? payload.visuals : [];
          if (visuals.length === 0) return;
          setInlineVisuals((prev) => {
            const baseIndex = prev.length;
            // Push one timeline item per visual so each appears in arrival
            // order as a standalone card.
            visuals.forEach((_v, i) => {
              pushTimelineItem({
                kind: "visual",
                id: nextTimelineId("visual"),
                visualIndex: baseIndex + i,
                ts,
              });
            });
            return [...prev, ...visuals];
          });
          // Also attach to the current assistant bubble so the legacy
          // "charts inside the bubble" code path still works for any
          // consumer that reads `message.visuals` directly.
          const currentId = lastAssistantIdRef.current;
          if (currentId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentId && m.role === "assistant"
                  ? { ...m, visuals: [...(m.visuals ?? []), ...visuals] }
                  : m
              )
            );
          } else {
            pendingVisualsRef.current = [
              ...pendingVisualsRef.current,
              ...visuals,
            ];
          }
          return;
        }
        case "deep_tool_start": {
          if (!value) return;
          const payload = value as DeepToolStartPayload;
          if (!payload.tool_call_id) return;
          const dt: DeepToolCall = {
            id: payload.tool_call_id,
            name: payload.name ?? "tool",
            args_preview: payload.args_preview ?? "",
            status: "running",
            order: orderCounterRef.current++,
          };
          setDeepToolCalls((prev) => {
            if (prev.some((t) => t.id === dt.id)) return prev;
            return [...prev, dt];
          });
          pushTimelineItem({
            kind: "deep-tool",
            id: nextTimelineId("deep-tool"),
            toolCallId: dt.id,
            ts,
          });
          return;
        }
        case "deep_tool_end": {
          if (!value) return;
          const payload = value as DeepToolEndPayload;
          if (!payload.tool_call_id) return;
          setDeepToolCalls((prev) =>
            prev.map((t) =>
              t.id === payload.tool_call_id
                ? {
                    ...t,
                    result_preview: payload.result_preview ?? t.result_preview,
                    status: payload.success ? "done" : "failed",
                  }
                : t
            )
          );
          return;
        }
        case "Reasoning":
        case "reasoning":
        case "deep_reasoning": {
          if (!value) return;
          const payload = value as (DeepReasoningPayload & ReasoningCustomPayload) | undefined;
          const delta =
            (payload && (payload.delta ?? payload.content)) ?? "";
          if (!delta) return;
          const source = reasoningSourceFromPayload(value);
          const blockId = `reasoning-${source}`;
          setReasoningBlocks((prev) => {
            const idx = prev.findIndex((b) => b.id === blockId);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = { ...next[idx], content: next[idx].content + delta };
              return next;
            }
            // New source — also push a timeline item so it renders in
            // arrival order.
            pushTimelineItem({
              kind: "reasoning",
              id: nextTimelineId("reasoning"),
              blockId,
              ts,
            });
            return [
              ...prev,
              {
                id: blockId,
                source,
                content: delta,
                order: orderCounterRef.current++,
              },
            ];
          });
          return;
        }
        default:
          return;
      }
    },
    [nextTimelineId, pushTimelineItem]
  );

  const handleEvent = useCallback(
    (event: AGUIEvent) => {
      // Drop usage/billing events before they reach any state arrays so
      // we never accidentally render a "usage" chip.
      if (isUsageEvent(event)) return;

      pushEvent(event);

      const ts = Date.now();

      switch (event.type) {
        case AGUIEventType.TEXT_MESSAGE_START: {
          lastAssistantIdRef.current = event.messageId;
          const order = orderCounterRef.current++;
          const visuals = pendingVisualsRef.current;
          pendingVisualsRef.current = [];
          const newMsg: StreamChatMessage = {
            id: event.messageId,
            role: "assistant",
            content: "",
            isStreaming: true,
            hasContent: false,
            visuals: visuals.length > 0 ? visuals : undefined,
            order,
            ts,
          };
          setMessages((prev) => [...prev, newMsg]);
          pushTimelineItem({
            kind: "message",
            id: nextTimelineId("message"),
            messageId: newMsg.id,
            ts,
          });
          break;
        }
        case AGUIEventType.TEXT_MESSAGE_CONTENT: {
          const delta = event.delta ?? "";
          const hasNonEmpty = delta.length > 0;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? {
                    ...m,
                    content: m.content + delta,
                    hasContent: m.hasContent || hasNonEmpty,
                  }
                : m
            )
          );
          break;
        }
        case AGUIEventType.TEXT_MESSAGE_END: {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.messageId) return m;
              if (m.content) {
                conversationRef.current.push({
                  role: "assistant",
                  content: m.content,
                });
              }
              // Any visuals that arrived AFTER text end (the router tool
              // runs to completion after the model already started
              // streaming) still belong on this bubble.
              const pendingVisuals = pendingVisualsRef.current;
              const nextVisuals = pendingVisuals.length
                ? [...(m.visuals ?? []), ...pendingVisuals]
                : m.visuals;
              if (pendingVisuals.length) pendingVisualsRef.current = [];
              return {
                ...m,
                isStreaming: false,
                visuals: nextVisuals,
              };
            })
          );
          break;
        }
        case AGUIEventType.TOOL_CALL_START: {
          const tc: ToolCall = {
            id: event.toolCallId,
            name: event.toolCallName,
            args: "",
            status: "calling",
            order: orderCounterRef.current++,
          };
          setToolCalls((prev) => [...prev, tc]);
          pushTimelineItem({
            kind: "tool",
            id: nextTimelineId("tool"),
            toolCallId: tc.id,
            ts,
          });
          break;
        }
        case AGUIEventType.TOOL_CALL_ARGS: {
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.id === event.toolCallId
                ? { ...tc, args: tc.args + event.delta }
                : tc
            )
          );
          break;
        }
        case AGUIEventType.TOOL_CALL_RESULT: {
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.id === event.toolCallId
                ? { ...tc, result: event.content, status: "complete" }
                : tc
            )
          );
          break;
        }
        case AGUIEventType.RUN_ERROR: {
          setError(event.message || "agent run errored");
          break;
        }
        case AGUIEventType.CUSTOM: {
          handleCustomEvent(event.name, event.value, ts);
          break;
        }
        case AGUIEventType.REASONING_MESSAGE_CONTENT: {
          // Native AG-UI reasoning deltas. Route through the same store
          // as CUSTOM "Reasoning" so the timeline only sees one card per
          // source.
          const delta = event.delta ?? "";
          if (!delta) break;
          const source = event.messageId ? `reasoning-${event.messageId}` : "router";
          const blockId = `reasoning-${source}`;
          setReasoningBlocks((prev) => {
            const idx = prev.findIndex((b) => b.id === blockId);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = { ...next[idx], content: next[idx].content + delta };
              return next;
            }
            pushTimelineItem({
              kind: "reasoning",
              id: nextTimelineId("reasoning"),
              blockId,
              ts,
            });
            return [
              ...prev,
              {
                id: blockId,
                source,
                content: delta,
                order: orderCounterRef.current++,
              },
            ];
          });
          break;
        }
        default:
          break;
      }
    },
    [handleCustomEvent, nextTimelineId, pushEvent, pushTimelineItem]
  );

  const runStream = useCallback(
    async (request: AGUIRunRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;

      // Log outgoing request in the event inspector.
      const reqTs: TimestampedEvent = {
        id: `req-${eventCounterRef.current++}`,
        timestamp: Date.now(),
        event: { type: REQUEST_SENT_TYPE },
        request,
      };
      setEvents((prev) => {
        const next = [...prev, reqTs];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });

      await streamAgentResponse(endpoint, request, {
        signal: controller.signal,
        onEvent: handleEvent,
        onError(err) {
          setError(err.message);
          setIsRunning(false);
        },
        onComplete() {
          setIsRunning(false);
        },
      });
    },
    [endpoint, handleEvent]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isRunning) return;
      setError(null);
      setIsRunning(true);
      lastAssistantIdRef.current = null;
      pendingVisualsRef.current = [];

      const ts = Date.now();
      const userMsg: StreamChatMessage = {
        id: `msg-${ts}`,
        role: "user",
        content,
        hasContent: true,
        order: orderCounterRef.current++,
        ts,
      };
      setMessages((prev) => [...prev, userMsg]);
      pushTimelineItem({
        kind: "message",
        id: nextTimelineId("message"),
        messageId: userMsg.id,
        ts,
      });
      conversationRef.current.push({ role: "user", content });

      const request: AGUIRunRequest = {
        messages: conversationRef.current,
      };
      await runStream(request);
    },
    [isRunning, nextTimelineId, pushTimelineItem, runStream]
  );

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clear = useCallback(() => {
    cancelRun();
    const seeded = seedMessage();
    setMessages(seeded);
    setEvents([]);
    setToolCalls([]);
    setDeepToolCalls([]);
    setRoutingEvents([]);
    setInlineVisuals([]);
    setReasoningBlocks([]);
    setTimelineItems(seedTimeline(seeded));
    setError(null);
    conversationRef.current = [];
    lastAssistantIdRef.current = null;
    pendingVisualsRef.current = [];
    orderCounterRef.current = initialGreeting ? 1 : 0;
    timelineCounterRef.current = seeded.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelRun, initialGreeting]);

  return {
    messages,
    events,
    toolCalls,
    deepToolCalls,
    routingEvents,
    inlineVisuals,
    reasoningBlocks,
    timelineItems,
    isRunning,
    error,
    sendMessage,
    cancelRun,
    clear,
  };
}
