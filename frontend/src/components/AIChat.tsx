import React, { useEffect, useRef, useState } from 'react';
import { Report } from 'powerbi-client';
import { apiService, InlineVisual, VisualConfig } from '../services/api';
import {
  StreamChatMessage,
  ToolCall,
  DeepToolCall,
  ReasoningBlock,
  RoutingEvent,
} from '../hooks/useAgentStream';
import { useAgentStreamContext } from '../contexts/AgentStreamContext';
import { InlineVisualWire } from '../types/ag-ui';
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

function shortenArgs(args: string, max = 80): string {
  const trimmed = args.trim();
  if (!trimmed) return '';
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

function firstLine(text: string | undefined, max = 160): string {
  if (!text) return '';
  const line = text.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

// --- Tool-call chip (router agent) -----------------------------------------

const ToolCallChip: React.FC<{ tool: ToolCall | undefined; toolName?: string }> = ({
  tool,
  toolName,
}) => {
  const [open, setOpen] = useState(false);
  if (!tool && !toolName) return null;
  // Defensive: never render a "usage" chip even if it slipped through.
  const name = tool?.name ?? toolName ?? '';
  if (name.toLowerCase() === 'usage') return null;

  const status: ToolCall['status'] = tool?.status ?? 'calling';
  const isDone = status === 'complete';
  const argsPreview = tool ? shortenArgs(tool.args) : '';
  const resultPreview = tool?.result ? shortenResult(tool.result) : '';
  const hasDetail = !!(tool?.args || tool?.result);

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
            <code>{name}</code>
            {hasDetail && <span className="activity-chev">{open ? '▾' : '▸'}</span>}
          </span>
          {argsPreview && <span className="activity-tool-args">({argsPreview})</span>}
          {isDone && resultPreview && (
            <span className="activity-tool-result">→ {resultPreview}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="activity-tool-detail">
          {tool?.args && (
            <>
              <div className="activity-detail-label">arguments</div>
              <pre className="activity-detail-pre">{tool.args}</pre>
            </>
          )}
          {tool?.result && (
            <>
              <div className="activity-detail-label">result</div>
              <pre className="activity-detail-pre">{tool.result}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// --- Deep-agent sub-tool chip (indented under handoff banner) --------------

const DeepToolChip: React.FC<{ tool: DeepToolCall | undefined }> = ({ tool }) => {
  if (!tool) return null;
  const status = tool.status;
  const argsPreview = shortenArgs(tool.args_preview ?? '');
  const resultLine = firstLine(tool.result_preview);

  const klass =
    status === 'done'
      ? 'activity-deep-tool-done'
      : status === 'failed'
        ? 'activity-deep-tool-failed'
        : '';

  return (
    <div className={`activity activity-deep-tool ${klass}`}>
      <span className="activity-deep-tool-arrow" aria-hidden="true">↳</span>
      <span className="activity-icon">
        {status === 'done' && '✅'}
        {status === 'failed' && '⚠️'}
        {status === 'running' && (
          <span className="activity-spinner" aria-hidden="true" />
        )}
      </span>
      <span className="activity-text">
        <span className="activity-tool-line">
          <span className="activity-tool-verb">
            {status === 'running' ? 'Calling tool' : 'tool'}
          </span>{' '}
          <code>{tool.name}</code>
        </span>
        {argsPreview && <span className="activity-tool-args">({argsPreview})</span>}
        {resultLine && status !== 'running' && (
          <span className="activity-tool-result">→ {resultLine}</span>
        )}
      </span>
    </div>
  );
};

// --- Reasoning card --------------------------------------------------------

const ReasoningCard: React.FC<{ block: ReasoningBlock | undefined }> = ({ block }) => {
  const [expanded, setExpanded] = useState(false);
  if (!block) return null;
  const content = block.content ?? '';
  // Conservative line count — newlines or every ~80 wrapped chars.
  const lineCount = Math.max(
    content.split(/\r?\n/).length,
    Math.ceil(content.length / 80)
  );
  const isLong = lineCount > 6;
  const showFull = expanded || !isLong;

  return (
    <div className="activity activity-reasoning-card">
      <div className="activity-reasoning-header">
        <span className="activity-icon">🧠</span>
        <span className="activity-reasoning-title">Reasoning</span>
        {block.source && block.source !== 'agent' && (
          <span className="activity-reasoning-source">· {block.source}</span>
        )}
      </div>
      <div
        className={`activity-reasoning-body ${showFull ? '' : 'activity-reasoning-collapsed'}`}
      >
        {content || <span className="activity-muted">(reasoning in progress)</span>}
      </div>
      {isLong && (
        <button
          type="button"
          className="activity-reasoning-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
};

// --- Handoff banner --------------------------------------------------------

const HandoffBanner: React.FC<{ routing: RoutingEvent | undefined }> = ({ routing }) => {
  if (!routing) return null;
  return (
    <div className="activity activity-handoff" role="status">
      <div className="activity-handoff-title">
        <span className="activity-icon">✨</span>
        <span>
          Routed to <strong>Deep Analysis Agent</strong>
        </span>
      </div>
      {routing.reason && (
        <div className="activity-handoff-reason">{routing.reason}</div>
      )}
    </div>
  );
};

// --- Assistant bubble ------------------------------------------------------

interface MessageBubbleProps {
  message: StreamChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const hasContent = !!message.hasContent || !!message.content;

  // The bubble only renders when there is actually something to show.
  // Tool chips, reasoning cards, and inline visuals live in the timeline
  // outside the bubble — they don't keep an empty bubble alive.
  if (message.role === 'assistant' && !hasContent) {
    return null;
  }

  return (
    <div className={`message ${message.role}`}>
      <div className="message-avatar">
        {message.role === 'user' ? '👤' : '🤖'}
      </div>
      <div className="message-content">
        {hasContent && (
          <div className="message-text">
            {message.content}
            {message.isStreaming && <span className="streaming-cursor">▍</span>}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main component -------------------------------------------------------

const AIChat: React.FC<AIChatProps> = ({ onAddInlineVisual, currentReport = null }) => {
  const {
    messages,
    toolCalls,
    deepToolCalls,
    routingEvents,
    inlineVisuals,
    reasoningBlocks,
    timelineItems,
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

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timelineItems, messages, isRunning]);

  const handlePin = async (messageId: string, visual: InlineVisual) => {
    if (!onAddInlineVisual) return;
    try {
      await onAddInlineVisual(visual);
      markPinned(messageId);
      setPinError(messageId, null);
    } catch (err: any) {
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

  // Render the SINGLE arrival-ordered timeline. Each item resolves to the
  // appropriate renderer based on its `kind`. No fixed-order stitching here
  // — the order is whatever the SSE stream produced.
  const renderTimelineItem = (item: typeof timelineItems[number]) => {
    switch (item.kind) {
      case 'message': {
        const message = messages.find((m) => m.id === item.messageId);
        if (!message) return null;
        return <MessageBubble key={item.id} message={message} />;
      }
      case 'tool': {
        const tool = toolCalls.find((t) => t.id === item.toolCallId);
        return <ToolCallChip key={item.id} tool={tool} />;
      }
      case 'handoff': {
        const routing = routingEvents.find((r) => r.id === item.handoffId);
        return <HandoffBanner key={item.id} routing={routing} />;
      }
      case 'deep-tool': {
        const tool = deepToolCalls.find((t) => t.id === item.toolCallId);
        return <DeepToolChip key={item.id} tool={tool} />;
      }
      case 'reasoning': {
        const block = reasoningBlocks.find((b) => b.id === item.blockId);
        return <ReasoningCard key={item.id} block={block} />;
      }
      case 'visual': {
        const wire = inlineVisuals[item.visualIndex];
        if (!wire) return null;
        const visual = toInlineVisual(wire);
        const pinKey = item.id;
        const pinned = pinnedMessages.has(pinKey);
        const pinError = pinErrors[pinKey];
        return (
          <div key={item.id} className="timeline-visual-card">
            <InlinePowerBIVisual
              config={visual.config}
              fallbackVisual={visual}
              report={currentReport}
              onAddToPage={
                onAddInlineVisual ? (v) => handlePin(pinKey, v) : undefined
              }
              isPinned={pinned}
            />
            {pinError && (
              <div
                className="message-text"
                style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}
              >
                Couldn't add: {pinError}
              </div>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="ai-chat-container">
      <div className="messages-container">
        {timelineItems.map(renderTimelineItem)}

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
