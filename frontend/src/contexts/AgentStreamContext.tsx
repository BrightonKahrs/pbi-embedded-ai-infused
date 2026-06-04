/**
 * AgentStreamContext — hoists the entire chat session out of `<AIChat>` so
 * that the conversation (messages, events, tool calls, inline visuals,
 * routing banners, reasoning blocks, isRunning, error) plus auxiliary UI
 * state (pinned messages, per-message pin errors) survive when `<AIChat>`
 * unmounts/remounts due to `ChatShell` mode changes.
 *
 * The provider calls `useAgentStream(...)` ONCE for the whole app; every
 * `<AIChat>` instance reads the same state via `useAgentStreamContext()`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  useAgentStream,
  UseAgentStreamOptions,
} from "../hooks/useAgentStream";
import type {
  StreamChatMessage,
  ToolCall,
  DeepToolCall,
  ReasoningBlock,
  TimelineItem,
} from "../hooks/useAgentStream";
import type {
  InlineVisualWire,
  TimestampedEvent,
} from "../types/ag-ui";
import type { RoutingEvent } from "../hooks/useAgentStream";

export interface AgentStreamContextValue {
  // Mirror of useAgentStream
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

  // Per-message UI state that previously lived in <AIChat>.
  pinnedMessages: Set<string>;
  markPinned: (messageId: string) => void;
  pinErrors: Record<string, string>;
  setPinError: (messageId: string, message: string | null) => void;
  resetPinState: () => void;
}

const AgentStreamContext = createContext<AgentStreamContextValue | null>(null);

export interface AgentStreamProviderProps extends UseAgentStreamOptions {
  children: React.ReactNode;
}

export const AgentStreamProvider: React.FC<AgentStreamProviderProps> = ({
  children,
  ...streamOptions
}) => {
  const stream = useAgentStream(streamOptions);

  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(
    () => new Set(),
  );
  const [pinErrors, setPinErrors] = useState<Record<string, string>>({});

  const markPinned = useCallback((messageId: string) => {
    setPinnedMessages((prev) => {
      if (prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }, []);

  const setPinError = useCallback(
    (messageId: string, message: string | null) => {
      setPinErrors((prev) => {
        if (message === null) {
          if (!prev[messageId]) return prev;
          const next = { ...prev };
          delete next[messageId];
          return next;
        }
        return { ...prev, [messageId]: message };
      });
    },
    [],
  );

  const resetPinState = useCallback(() => {
    setPinnedMessages(new Set());
    setPinErrors({});
  }, []);

  // Wrap `clear` so resetting the conversation also resets pin state.
  const wrappedClear = useCallback(() => {
    stream.clear();
    resetPinState();
  }, [stream, resetPinState]);

  const value = useMemo<AgentStreamContextValue>(
    () => ({
      ...stream,
      clear: wrappedClear,
      pinnedMessages,
      markPinned,
      pinErrors,
      setPinError,
      resetPinState,
    }),
    [
      stream,
      wrappedClear,
      pinnedMessages,
      markPinned,
      pinErrors,
      setPinError,
      resetPinState,
    ],
  );

  return (
    <AgentStreamContext.Provider value={value}>
      {children}
    </AgentStreamContext.Provider>
  );
};

export function useAgentStreamContext(): AgentStreamContextValue {
  const ctx = useContext(AgentStreamContext);
  if (!ctx) {
    throw new Error(
      "useAgentStreamContext must be used within an <AgentStreamProvider>",
    );
  }
  return ctx;
}

export default AgentStreamContext;
