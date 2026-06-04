import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Report } from 'powerbi-client';
import { apiService, InlineVisual, VisualConfig } from '../services/api';
import { StreamChatMessage, ToolCall } from '../hooks/useAgentStream';
import { useAgentStreamContext } from '../contexts/AgentStreamContext';
import {
  AGUIEvent,
  AGUIEventType,
  AgentHandoffPayload,
  InlineVisualWire,
  TimestampedEvent,
} from '../types/ag-ui';
import InlinePowerBIVisual from './InlinePowerBIVisual';
import './AIChat.css';

export const GREETING =
  "Hello! I'm your AI assistant for Power BI analytics. How can I help you today?";

interface AIChatProps {
  onAddInlineVisual?: (visual: InlineVisual) => Promise<void>;
  /** The user's currently embedded Power BI report. When non-null and
   *  authoring-capable, inline visuals are rendered as real Power BI
   *  embeds; otherwise InlinePowerBIVisual falls back to Recharts. */
  currentReport?: Report | null;
}

/** Convert the wire-shape visual (from CUSTOM "InlineVisuals" events) into
 * the InlineVisual structure the inline visual renderer expects.
 */
function toInlineVisual(wire: InlineVisualWire): InlineVisual {
  return {
    config: wire.config as unknown as VisualConfig,
    data: (wire.data ?? []) as Array<Record<string, any>>,
  };
}

// --- Timeline item model ---------------------------------------------------
//
// The chat is a single timeline of three kinds of items, sorted by arrival
// time:
//   - message  : the user's input or the assistant's streaming answer bubble
//   - activity : a small inline card representing a single AG-UI event
//   - error    : a red activity card for RUN_ERROR
//
// `ts` is the wall-clock time we received the item so the timeline stays
// strictly chronological even when events and messages interleave.

type TimelineItem =
  | { kind: 'message'; ts: number; key: string; message: StreamChatMessage }
  | { kind: 'activity'; ts: number; key: string; event: TimestampedEvent };

/** Events we render as their own inline activity card. Anything that is
 * already represented by a bubble (TEXT_MESSAGE_*), rolled up into a
 * tool-call chip (TOOL_CALL_ARGS/END/RESULT), already shown inside the
 * assistant bubble (InlineVisuals), or noise the user can't act on
 * (RUN_STARTED/RUN_FINISHED — we show a single bottom "AI is working…"
 * pulse instead — STEP_*, and AG-UI usage/billing events) is filtered
 * out so the timeline stays clean.
 */
function isRenderableActivity(event: AGUIEvent): boolean {
  // Filter out any usage/billing events (case-insensitive). These have
  // no actionable info for the end user and tend to render as noise.
  const t = (event as { type?: string }).type;
  if (typeof t === 'string' && t.toLowerCase().includes('usage')) {
    return false;
  }

  switch (event.type) {
    case AGUIEventType.RUN_ERROR:
    case AGUIEventType.TOOL_CALL_START:
    case AGUIEventType.REASONING_START:
      return true;
    case AGUIEventType.CUSTOM:
      // The InlineVisuals payload is already rendered inside the assistant
      // bubble (see `message.visuals`), so suppress the redundant chip.
      if (event.name === 'InlineVisuals') return false;
      return true;
    default:
      return false;
  }
}

function shortenArgs(args: string, max = 80): string {
  const trimmed = args.trim();
  if (!trimmed) return '';
  // Try to parse JSON so we can render `{key: value}` compactly.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed)
        .map(([k, v]) => {
          let val = typeof v === 'string' ? v : JSON.stringify(v);
          if (val.length > 30) val = val.slice(0, 30) + '…';
          return `${k}=${val}`;
        })
        .join(', ');
      return entries.length > max ? entries.slice(0, max) + '…' : entries;
    }
  } catch {
    // not JSON yet (streaming) — fall through
  }
  return trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed;
}

function shortenResult(result: string | undefined, max = 120): string {
  if (!result) return '';
  const r = result.trim().replace(/\s+/g, ' ');
  return r.length > max ? r.slice(0, max) + '…' : r;
}

// --- Activity card --------------------------------------------------------

interface ActivityCardProps {
  event: TimestampedEvent;
  toolCalls: ToolCall[];
  reasoningBlocks: Record<string, string>;
}

const ActivityCard: React.FC<ActivityCardProps> = ({ event, toolCalls, reasoningBlocks }) => {
  const [open, setOpen] = useState(false);
  const e = event.event;

  if (e.type === AGUIEventType.RUN_ERROR) {
    return (
      <div className="activity activity-error">
        <span className="activity-icon">❌</span>
        <span className="activity-text">{e.message || 'Run failed'}</span>
      </div>
    );
  }

  // --- CUSTOM events ---
  if (e.type === AGUIEventType.CUSTOM) {
    if (e.name === 'AgentHandoff') {
      const v = (e.value ?? {}) as AgentHandoffPayload;
      return (
        <div className="activity activity-handoff" role="status">
          <div className="activity-handoff-title">
            <span className="activity-icon">✨</span>
            <span>
              Routed to <strong>Deep Analysis Agent</strong>
            </span>
          </div>
          {v.reason && <div className="activity-handoff-reason">{v.reason}</div>}
        </div>
      );
    }
    // InlineVisuals are intentionally filtered out upstream; any other
    // CUSTOM event we don't recognise gets a generic chip.
    return (
      <div className="activity activity-custom">
        <span className="activity-icon">✨</span>
        <span className="activity-text">{e.name}</span>
      </div>
    );
  }

  // --- TOOL_CALL_START → rich chip backed by toolCalls state ---
  if (e.type === AGUIEventType.TOOL_CALL_START) {
    const tc = toolCalls.find((t) => t.id === e.toolCallId);
    const status: 'calling' | 'complete' | 'error' = tc?.status ?? 'calling';
    const argsPreview = tc ? shortenArgs(tc.args) : '';
    const resultPreview = tc?.result ? shortenResult(tc.result) : '';
    const isDone = status === 'complete';
    const hasDetail = !!(tc?.args || tc?.result);
    return (
      <div className={`activity activity-tool ${isDone ? 'activity-tool-done' : ''}`}>
        <button
          type="button"
          className="activity-tool-head"
          onClick={() => hasDetail && setOpen((v) => !v)}
          aria-expanded={open}
          disabled={!hasDetail}
        >
          <span className="activity-icon">
            {isDone ? '✅' : <span className="activity-spinner" aria-hidden="true" />}
          </span>
          <span className="activity-text">
            <span className="activity-tool-line">
              <span className="activity-tool-verb">{isDone ? 'tool' : 'Calling tool'}</span>{' '}
              <code>{e.toolCallName}</code>
              {hasDetail && (
                <span className="activity-chev">{open ? '▾' : '▸'}</span>
              )}
            </span>
            {argsPreview && (
              <span className="activity-tool-args">({argsPreview})</span>
            )}
            {isDone && resultPreview && (
              <span className="activity-tool-result">→ {resultPreview}</span>
            )}
          </span>
        </button>
        {open && (
          <div className="activity-tool-detail">
            {tc?.args && (
              <>
                <div className="activity-detail-label">arguments</div>
                <pre className="activity-detail-pre">{tc.args}</pre>
              </>
            )}
            {tc?.result && (
              <>
                <div className="activity-detail-label">result</div>
                <pre className="activity-detail-pre">{tc.result}</pre>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- REASONING_START → collapsible thinking card ---
  if (e.type === AGUIEventType.REASONING_START) {
    const content = (e.messageId && reasoningBlocks[e.messageId]) || '';
    const preview = content.replace(/\s+/g, ' ').trim().slice(0, 80);
    const hasMore = content.length > 80;
    return (
      <div className="activity activity-reasoning">
        <button
          type="button"
          className="activity-reasoning-head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="activity-icon">🧠</span>
          <span className="activity-text">
            <span className="activity-reasoning-verb">Thinking…</span>{' '}
            {preview ? (
              <span className="activity-reasoning-preview">
                {preview}
                {hasMore ? '…' : ''}
              </span>
            ) : (
              <span className="activity-reasoning-preview activity-muted">
                (reasoning in progress)
              </span>
            )}
          </span>
          {content && <span className="activity-chev">{open ? '▾' : '▸'}</span>}
        </button>
        {open && content && (
          <pre className="activity-detail-pre">{content}</pre>
        )}
      </div>
    );
  }

  return null;
};

// --- Main component -------------------------------------------------------

const AIChat: React.FC<AIChatProps> = ({ onAddInlineVisual, currentReport = null }) => {
  const {
    messages,
    events,
    toolCalls,
    reasoningBlocks,
    isRunning,
    error,
    sendMessage,
    clear,
    pinnedMessages,
    markPinned,
    pinErrors,
    setPinError,
  } = useAgentStreamContext();

  const [inputValue, setInputValue] = useState('');
  const timelineEndRef = useRef<HTMLDivElement>(null);

  // Merge messages + activity events into one chronologically-sorted
  // timeline. We sort by `ts` then break ties by item kind so that a
  // RUN_STARTED activity logged at the same ms as the user message
  // still falls just after it.
  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const m of messages) {
      items.push({ kind: 'message', ts: m.ts, key: `msg-${m.id}`, message: m });
    }
    for (const ev of events) {
      if (!isRenderableActivity(ev.event)) continue;
      items.push({ kind: 'activity', ts: ev.timestamp, key: `act-${ev.id}`, event: ev });
    }
    items.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      // Stable secondary sort: messages before activity at same ms feels
      // more natural ("user said X, then AI started reasoning").
      if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1;
      return a.key < b.key ? -1 : 1;
    });
    return items;
  }, [messages, events]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, isRunning]);

  const handlePin = async (messageId: string, visual: InlineVisual) => {
    if (!onAddInlineVisual) return;
    try {
      await onAddInlineVisual(visual);
      markPinned(messageId);
      setPinError(messageId, null);
    } catch (err: any) {
      // Power BI SDK rejections often have neither `.message` nor a useful
      // `toString()`, so coerce through a chain of fallbacks before we give up
      // and stringify. Keeps "Couldn't add: undefined" out of the UI.
      const msg =
        err?.message
        || err?.detailedMessage
        || (typeof err === 'string' ? err : null)
        || (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();
      setPinError(messageId, msg);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isRunning) return;
    const text = inputValue;
    setInputValue('');
    sendMessage(text);
  };

  const handleClearChat = async () => {
    try {
      await apiService.clearChatHistory();
    } catch {
      // Non-fatal — streaming endpoint is stateless; legacy history is best-effort.
    }
    clear();
  };

  const renderMessage = (message: StreamChatMessage) => {
    const hasCharts = !!(message.visuals && message.visuals.length > 0);
    // Suppress the empty white placeholder bubble that otherwise shows up
    // the instant TEXT_MESSAGE_START arrives but before any content/visuals.
    if (
      message.role === 'assistant'
      && !message.content
      && !hasCharts
      && !message.isStreaming
    ) {
      return null;
    }
    const pinned = pinnedMessages.has(message.id);
    const pinError = pinErrors[message.id];
    return (
      <div className={`message ${message.role}`}>
        <div className="message-avatar">
          {message.role === 'user' ? '👤' : '🤖'}
        </div>
        <div className={`message-content${hasCharts ? ' has-charts' : ''}`}>
          <div className="message-text">
            {message.content}
            {message.isStreaming && <span className="streaming-cursor">▍</span>}
          </div>
          {hasCharts && (
            <div className="message-charts">
              {message.visuals!.map((wire, i) => {
                const visual = toInlineVisual(wire);
                return (
                  <InlinePowerBIVisual
                    key={i}
                    config={visual.config}
                    fallbackVisual={visual}
                    report={currentReport}
                    onAddToPage={
                      onAddInlineVisual
                        ? (v) => handlePin(message.id, v)
                        : undefined
                    }
                    isPinned={pinned}
                  />
                );
              })}
              {pinError && (
                <div
                  className="message-text"
                  style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}
                >
                  Couldn't add: {pinError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ai-chat-container">
      <div className="messages-container">
        {timeline.map((item) =>
          item.kind === 'message' ? (
            <React.Fragment key={item.key}>{renderMessage(item.message)}</React.Fragment>
          ) : (
            <ActivityCard
              key={item.key}
              event={item.event}
              toolCalls={toolCalls}
              reasoningBlocks={reasoningBlocks}
            />
          )
        )}

        {error && (
          <div className="activity activity-error">
            <span className="activity-icon">⚠️</span>
            <span className="activity-text">{error}</span>
          </div>
        )}

        {isRunning && (
          <div className="activity activity-pulse" aria-live="polite">
            <span className="activity-pulse-dot" />
            <span className="activity-text">AI is working…</span>
          </div>
        )}

        <div ref={timelineEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="input-container">
        <button
          type="button"
          onClick={handleClearChat}
          className="composer-clear-button"
          title="Clear conversation"
          disabled={isRunning}
        >
          🗑️
        </button>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask me about your Power BI data..."
          className="message-input"
          disabled={isRunning}
        />
        <button
          type="submit"
          className="send-button"
          disabled={!inputValue.trim() || isRunning}
        >
          ➤
        </button>
      </form>
    </div>
  );
};

export default AIChat;
