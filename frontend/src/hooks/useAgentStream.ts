/**
 * useAgentStream — simplified port of the playground's
 * `ag-ui-playground/frontend/src/hooks/useAgentStream.ts` for the
 * Power BI chat. Consumes the AG-UI SSE stream from
 * `POST /api/chat/stream` and exposes everything the UI needs:
 *
 * - `messages`        chat-bubble friendly messages, incl. streaming text
 * - `events`          raw timestamped events for the explainability panel
 * - `toolCalls`       per-tool-call status with streamed args/result
 * - `routingEvents`   handoff banners (CUSTOM "AgentHandoff")
 * - `inlineVisuals`   inline visual configs (CUSTOM "InlineVisuals")
 * - `isRunning`       true while an SSE connection is open
 * - `error`           latest error string, if any
 *
 * Also exposes `sendMessage(text)` to fire a new run, and
 * `cancelRun()` / `clear()` for cleanup.
 */

import { useCallback, useRef, useState } from "react";
import type {
  AGUIEvent,
  AGUIMessage,
  AGUIRunRequest,
  AgentHandoffPayload,
  InlineVisualWire,
  InlineVisualsPayload,
  TimestampedEvent,
} from "../types/ag-ui";
import { AGUIEventType, REQUEST_SENT_TYPE } from "../types/ag-ui";
import { streamAgentResponse } from "../services/sseChatClient";

export interface StreamChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  /** Inline visuals attached to this assistant message (assistant only). */
  visuals?: InlineVisualWire[];
  /** Optional handoff annotation rendered as a banner above the bubble. */
  handoff?: AgentHandoffPayload;
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

export interface RoutingEvent extends AgentHandoffPayload {
  ts: number;
}

interface UseAgentStreamReturn {
  messages: StreamChatMessage[];
  events: TimestampedEvent[];
  toolCalls: ToolCall[];
  routingEvents: RoutingEvent[];
  inlineVisuals: InlineVisualWire[];
  isRunning: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  cancelRun: () => void;
  clear: () => void;
}

const MAX_EVENTS = 1000;

export interface UseAgentStreamOptions {
  /** Override the SSE endpoint URL (defaults to /api/chat/stream). */
  endpoint?: string;
  /** Optional seed message inserted at the top of the chat. */
  initialAssistantGreeting?: string;
}

export function useAgentStream(
  options: UseAgentStreamOptions = {}
): UseAgentStreamReturn {
  const endpoint = options.endpoint ?? "/api/chat/stream";
  const initialGreeting = options.initialAssistantGreeting;

  const [messages, setMessages] = useState<StreamChatMessage[]>(() =>
    initialGreeting
      ? [
          {
            id: "msg-greeting",
            role: "assistant",
            content: initialGreeting,
            order: 0,
          },
        ]
      : []
  );
  const [events, setEvents] = useState<TimestampedEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [routingEvents, setRoutingEvents] = useState<RoutingEvent[]>([]);
  const [inlineVisuals, setInlineVisuals] = useState<InlineVisualWire[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const eventCounterRef = useRef(0);
  const orderCounterRef = useRef(initialGreeting ? 1 : 0);
  const conversationRef = useRef<AGUIMessage[]>([]);
  // Most-recent assistant message id (set on TEXT_MESSAGE_START). Used so
  // we can attach handoff + visual annotations to the right bubble.
  const lastAssistantIdRef = useRef<string | null>(null);
  // Pending handoff to attach to the next assistant text bubble. Holds the
  // most recent payload so a single routed turn shows exactly one banner.
  const pendingHandoffRef = useRef<AgentHandoffPayload | null>(null);
  // Visuals to attach to the next assistant text bubble (same idea).
  const pendingVisualsRef = useRef<InlineVisualWire[]>([]);

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

  const handleEvent = useCallback(
    (event: AGUIEvent) => {
      pushEvent(event);

      switch (event.type) {
        case AGUIEventType.TEXT_MESSAGE_START: {
          lastAssistantIdRef.current = event.messageId;
          const order = orderCounterRef.current++;
          const handoff = pendingHandoffRef.current;
          const visuals = pendingVisualsRef.current;
          pendingHandoffRef.current = null;
          pendingVisualsRef.current = [];
          setMessages((prev) => [
            ...prev,
            {
              id: event.messageId,
              role: "assistant",
              content: "",
              isStreaming: true,
              handoff: handoff ?? undefined,
              visuals: visuals.length > 0 ? visuals : undefined,
              order,
            },
          ]);
          break;
        }
        case AGUIEventType.TEXT_MESSAGE_CONTENT: {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId
                ? { ...m, content: m.content + event.delta }
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
              // Any visuals/handoff that arrived AFTER text end (the
              // router tool runs to completion after the model already
              // started streaming "the answer is…") still belong on
              // this bubble.
              const pendingVisuals = pendingVisualsRef.current;
              const pendingHandoff = pendingHandoffRef.current;
              const nextVisuals = pendingVisuals.length
                ? [...(m.visuals ?? []), ...pendingVisuals]
                : m.visuals;
              if (pendingVisuals.length) pendingVisualsRef.current = [];
              const nextHandoff = m.handoff ?? pendingHandoff ?? undefined;
              if (pendingHandoff && !m.handoff) pendingHandoffRef.current = null;
              return {
                ...m,
                isStreaming: false,
                visuals: nextVisuals,
                handoff: nextHandoff,
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
          if (event.name === "AgentHandoff" && event.value) {
            const payload = event.value as AgentHandoffPayload;
            const routing: RoutingEvent = { ...payload, ts: Date.now() };
            setRoutingEvents((prev) => [...prev, routing]);
            // Attach to the current assistant bubble if one already
            // exists, otherwise queue for the next TEXT_MESSAGE_START.
            const currentId = lastAssistantIdRef.current;
            if (currentId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentId && m.role === "assistant"
                    ? { ...m, handoff: m.handoff ?? payload }
                    : m
                )
              );
            } else {
              pendingHandoffRef.current = payload;
            }
          } else if (event.name === "InlineVisuals" && event.value) {
            const payload = event.value as InlineVisualsPayload;
            const visuals = Array.isArray(payload?.visuals) ? payload.visuals : [];
            if (visuals.length === 0) break;
            setInlineVisuals((prev) => [...prev, ...visuals]);
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
          }
          break;
        }
        default:
          break;
      }
    },
    [pushEvent]
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
      pendingHandoffRef.current = null;
      pendingVisualsRef.current = [];

      const userMsg: StreamChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        order: orderCounterRef.current++,
      };
      setMessages((prev) => [...prev, userMsg]);
      conversationRef.current.push({ role: "user", content });

      const request: AGUIRunRequest = {
        messages: conversationRef.current,
      };
      await runStream(request);
    },
    [isRunning, runStream]
  );

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clear = useCallback(() => {
    cancelRun();
    setMessages(
      initialGreeting
        ? [
            {
              id: "msg-greeting",
              role: "assistant",
              content: initialGreeting,
              order: 0,
            },
          ]
        : []
    );
    setEvents([]);
    setToolCalls([]);
    setRoutingEvents([]);
    setInlineVisuals([]);
    setError(null);
    conversationRef.current = [];
    lastAssistantIdRef.current = null;
    pendingHandoffRef.current = null;
    pendingVisualsRef.current = [];
    orderCounterRef.current = initialGreeting ? 1 : 0;
  }, [cancelRun, initialGreeting]);

  return {
    messages,
    events,
    toolCalls,
    routingEvents,
    inlineVisuals,
    isRunning,
    error,
    sendMessage,
    cancelRun,
    clear,
  };
}
