import React from 'react';
import './ChatShell.css';

export type ChatMode = 'docked' | 'minimized' | 'fullscreen';

interface ChatShellProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  children: React.ReactNode;
}

const ChatShell: React.FC<ChatShellProps> = ({ mode, onModeChange, children }) => {
  if (mode === 'minimized') {
    return (
      <button
        type="button"
        className="chat-shell-launcher"
        onClick={() => onModeChange('docked')}
        title="Open AI Assistant"
        aria-label="Open AI Assistant"
      >
        <span className="chat-shell-launcher-icon" aria-hidden="true">💬</span>
        <span className="chat-shell-launcher-label">AI Assistant</span>
      </button>
    );
  }

  const isFullscreen = mode === 'fullscreen';

  return (
    <>
      {isFullscreen && (
        <div
          className="chat-shell-backdrop"
          onClick={() => onModeChange('docked')}
          aria-hidden="true"
        />
      )}
      <section
        className={`chat-shell chat-shell-${mode}`}
        role="complementary"
        aria-label="AI Assistant"
      >
        <header className="chat-shell-header">
          <div className="chat-shell-title">
            <span className="chat-shell-sparkle" aria-hidden="true">✨</span>
            <span>AI Assistant</span>
          </div>
          <div className="chat-shell-actions">
            <button
              type="button"
              className="chat-shell-action"
              onClick={() => onModeChange('minimized')}
              title="Minimize chat"
              aria-label="Minimize chat"
            >
              <span aria-hidden="true">➖</span>
            </button>
            <button
              type="button"
              className="chat-shell-action"
              onClick={() => onModeChange(isFullscreen ? 'docked' : 'fullscreen')}
              title={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
            >
              <span aria-hidden="true">{isFullscreen ? '⤢' : '⛶'}</span>
            </button>
            <button
              type="button"
              className="chat-shell-action chat-shell-action-close"
              onClick={() => onModeChange('minimized')}
              title="Close chat"
              aria-label="Close chat"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </header>
        <div className="chat-shell-body">{children}</div>
      </section>
    </>
  );
};

export default ChatShell;
