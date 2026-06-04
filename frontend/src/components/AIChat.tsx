import React, { useState, useRef, useEffect } from 'react';
import { Report } from 'powerbi-client';
import { apiService, ChatMessage, InlineVisual, AgentEvent } from '../services/api';
import InlinePowerBIVisual from './InlinePowerBIVisual';
import ExplainabilityPanel from './ExplainabilityPanel'; // explainability:
import './AIChat.css';

// Local message shape that augments the wire-level ChatMessage with any
// inline visuals the assistant returned for that turn.
interface ChatMessageWithVisuals extends ChatMessage {
  visuals?: InlineVisual[];
  /** Optional error string displayed inline when a pin attempt fails. */
  pinError?: string;
}

interface AIChatProps {
  onAddInlineVisual?: (visual: InlineVisual) => Promise<void>;
  /** The user's currently embedded Power BI report. When non-null and
   *  authoring-capable, inline visuals are rendered as real Power BI
   *  embeds; otherwise they fall back to Recharts. */
  currentReport?: Report | null;
}

const AIChat: React.FC<AIChatProps> = ({ onAddInlineVisual, currentReport = null }) => {
  const [messages, setMessages] = useState<ChatMessageWithVisuals[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant for Power BI analytics. How can I help you today?'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recentEvents, setRecentEvents] = useState<AgentEvent[]>([]); // explainability:
  const [explainOpen, setExplainOpen] = useState(false); // explainability:
  const [pinnedMessages, setPinnedMessages] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handlePin = async (messageIndex: number, visual: InlineVisual) => {
    if (!onAddInlineVisual) return;
    try {
      await onAddInlineVisual(visual);
      setPinnedMessages(prev => {
        const next = new Set(prev);
        next.add(messageIndex);
        return next;
      });
      setMessages(prev =>
        prev.map((m, i) =>
          i === messageIndex && m.pinError ? { ...m, pinError: undefined } : m
        )
      );
    } catch (error: any) {
      const msg = error?.message || String(error);
      setMessages(prev =>
        prev.map((m, i) => (i === messageIndex ? { ...m, pinError: msg } : m))
      );
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessageWithVisuals = {
      role: 'user',
      content: inputValue
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await apiService.sendChatMessage({
        messages: [...messages, userMessage].map(({ role, content }) => ({ role, content }))
      });

      setRecentEvents(response.events ?? []); // explainability:

      // Prefer the new plural field; fall back to the legacy single
      // `visual` for backwards compatibility.
      const visuals: InlineVisual[] =
        (response.visuals && response.visuals.length > 0)
          ? response.visuals
          : (response.visual ? [response.visual] : []);

      const assistantMessage: ChatMessageWithVisuals = {
        role: 'assistant',
        content: response.message,
        visuals: visuals.length > 0 ? visuals : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessageWithVisuals = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please make sure the backend server is running.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = async () => {
    try {
      await apiService.clearChatHistory();
      setPinnedMessages(new Set());
      setMessages([
        {
          role: 'assistant',
          content: 'Hello! I\'m your AI assistant for Power BI analytics. How can I help you today?'
        }
      ]);
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  };

  return (
    <div className="ai-chat-container">
      <div className="chat-header">
        <h3>💬 AI Assistant</h3>
        <button onClick={() => setExplainOpen(true)} className="clear-button" title="Explain what the AI is doing" style={{ marginRight: 8 }}>🧠 Explain</button>{/* explainability: */}
        <button onClick={handleClearChat} className="clear-button" title="Clear conversation">
          🗑️ Clear
        </button>
      </div>

      <div className="messages-container">
        {messages.map((message, index) => {
          const hasCharts = !!(message.visuals && message.visuals.length > 0);
          return (
            <div
              key={index}
              className={`message ${message.role}`}
            >
              <div className="message-avatar">
                {message.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className={`message-content${hasCharts ? ' has-charts' : ''}`}>
                <div className="message-text">{message.content}</div>
                {hasCharts && (
                  <div className="message-charts">
                    {message.visuals!.map((visual, i) => (
                      <InlinePowerBIVisual
                        key={i}
                        config={visual.config}
                        report={currentReport}
                        fallbackVisual={visual}
                        onAddToPage={
                          onAddInlineVisual
                            ? (vis) => handlePin(index, vis)
                            : undefined
                        }
                        isPinned={pinnedMessages.has(index)}
                      />
                    ))}
                    {message.pinError && (
                      <div
                        className="message-text"
                        style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}
                      >
                        Couldn't add: {message.pinError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isLoading && (
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
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="input-container">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask me about your Power BI data..."
          className="message-input"
          disabled={isLoading}
        />
        <button
          type="submit"
          className="send-button"
          disabled={!inputValue.trim() || isLoading}
        >
          ➤
        </button>
      </form>
      <ExplainabilityPanel events={recentEvents} isOpen={explainOpen} onClose={() => setExplainOpen(false)} />{/* explainability: */}
    </div>
  );
};

export default AIChat;
