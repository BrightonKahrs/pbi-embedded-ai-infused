import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiService, InlineVisual, VisualConfig } from '../services/api';
import { useAgentStream, StreamChatMessage } from '../hooks/useAgentStream';
import { InlineVisualWire } from '../types/ag-ui';
import InlineChart from './InlineChart';
import ExplainabilityPanel from './ExplainabilityPanel';
import './AIChat.css';

const GREETING = "Hello! I'm your AI assistant for Power BI analytics. How can I help you today?";

interface AIChatProps {
  onAddInlineVisual?: (visual: InlineVisual) => Promise<void>;
}

/** Convert the wire-shape visual (from CUSTOM "InlineVisuals" events) into
 * the InlineVisual structure the existing InlineChart component expects.
 * The config payload is shaped exactly like our pydantic `VisualConfig`
 * so the cast is safe — we just give TS a typed view.
 */
function toInlineVisual(wire: InlineVisualWire): InlineVisual {
  return {
    config: wire.config as unknown as VisualConfig,
    data: (wire.data ?? []) as Array<Record<string, any>>,
  };
}

const AIChat: React.FC<AIChatProps> = ({ onAddInlineVisual }) => {
  const {
    messages,
    events,
    toolCalls,
    routingEvents,
    isRunning,
    error,
    sendMessage,
    clear,
  } = useAgentStream({ initialAssistantGreeting: GREETING });

  const [inputValue, setInputValue] = useState('');
  const [explainOpen, setExplainOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(new Set());
  const [pinErrors, setPinErrors] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolCalls]);

  const handlePin = async (messageId: string, visual: InlineVisual) => {
    if (!onAddInlineVisual) return;
    try {
      await onAddInlineVisual(visual);
      setPinnedMessages(prev => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
      setPinErrors(prev => {
        if (!prev[messageId]) return prev;
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      setPinErrors(prev => ({ ...prev, [messageId]: msg }));
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
      // Non-fatal — the streaming endpoint is stateless, but the
      // legacy /api/chat history still lives on the server. Best effort.
    }
    clear();
    setPinnedMessages(new Set());
    setPinErrors({});
  };

  // Map tool-call id → tool call so we can render running chips beneath
  // the currently-streaming assistant bubble.
  const liveToolCalls = useMemo(
    () => toolCalls.filter(tc => tc.status !== 'complete'),
    [toolCalls]
  );

  const renderMessage = (message: StreamChatMessage) => {
    const hasCharts = !!(message.visuals && message.visuals.length > 0);
    const pinned = pinnedMessages.has(message.id);
    const pinError = pinErrors[message.id];
    return (
      <div key={message.id} className={`message ${message.role}`}>
        <div className="message-avatar">
          {message.role === 'user' ? '👤' : '🤖'}
        </div>
        <div className={`message-content${hasCharts ? ' has-charts' : ''}`}>
          {message.handoff && (
            <div className="agent-handoff-banner" title={message.handoff.reason}>
              ✨ Routed to <strong>Deep Analysis Agent</strong>
              <span className="agent-handoff-reason"> — {message.handoff.reason}</span>
            </div>
          )}
          <div className="message-text">
            {message.content}
            {message.isStreaming && <span className="streaming-cursor">▍</span>}
          </div>
          {hasCharts && (
            <div className="message-charts">
              {message.visuals!.map((wire, i) => {
                const visual = toInlineVisual(wire);
                return (
                  <InlineChart
                    key={i}
                    visual={visual}
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
      <div className="chat-header">
        <h3>💬 AI Assistant</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {routingEvents.length > 0 && (
            <span
              className="agent-handoff-chip"
              title={`${routingEvents.length} handoff${routingEvents.length === 1 ? '' : 's'} this session`}
            >
              ✨ Deep Analysis × {routingEvents.length}
            </span>
          )}
          <button
            onClick={() => setExplainOpen(true)}
            className="clear-button"
            title="Inspect live agent events"
          >
            🧠 Explain
          </button>
          <button
            onClick={handleClearChat}
            className="clear-button"
            title="Clear conversation"
          >
            🗑️ Clear
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.map(renderMessage)}

        {isRunning && liveToolCalls.length > 0 && (
          <div className="message assistant">
            <div className="message-avatar">🛠️</div>
            <div className="message-content">
              {liveToolCalls.map(tc => (
                <div key={tc.id} className="tool-call-chip">
                  <span className="tool-call-name">{tc.name}</span>
                  <span className="tool-call-status">{tc.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isRunning && liveToolCalls.length === 0 && messages[messages.length - 1]?.role === 'user' && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="message assistant">
            <div className="message-avatar">⚠️</div>
            <div className="message-content">
              <div className="message-text" style={{ color: '#b91c1c' }}>
                {error}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="input-container">
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

      <ExplainabilityPanel
        events={events}
        isOpen={explainOpen}
        onClose={() => setExplainOpen(false)}
      />
    </div>
  );
};

export default AIChat;
