import React, { useMemo, useState } from 'react';
import {
  AGUIEvent,
  AGUIEventType,
  REQUEST_SENT_TYPE,
  TimestampedEvent,
} from '../types/ag-ui';
import './ExplainabilityPanel.css';

interface Props {
  events: TimestampedEvent[];
  isOpen: boolean;
  onClose: () => void;
}

type Category =
  | 'REQUEST'
  | 'RUN'
  | 'TEXT_MESSAGE'
  | 'TOOL_CALL'
  | 'CUSTOM'
  | 'STEP'
  | 'REASONING'
  | 'STATE'
  | 'OTHER';

const CATEGORY_META: Record<Category, { label: string; icon: string; className: string }> = {
  REQUEST: { label: 'Request', icon: '📤', className: 'cat-request' },
  RUN: { label: 'Run', icon: '▶️', className: 'cat-run' },
  TEXT_MESSAGE: { label: 'Message', icon: '💬', className: 'cat-text' },
  TOOL_CALL: { label: 'Tool', icon: '🔧', className: 'cat-tool' },
  CUSTOM: { label: 'Custom', icon: '✨', className: 'cat-custom' },
  STEP: { label: 'Step', icon: '🪜', className: 'cat-run' },
  REASONING: { label: 'Reasoning', icon: '🧠', className: 'cat-reasoning' },
  STATE: { label: 'State', icon: '🗂️', className: 'cat-run' },
  OTHER: { label: 'Other', icon: '📦', className: 'cat-run' },
};

function categorize(type: string): Category {
  if (type === REQUEST_SENT_TYPE) return 'REQUEST';
  if (type.startsWith('RUN_')) return 'RUN';
  if (type.startsWith('TEXT_MESSAGE')) return 'TEXT_MESSAGE';
  if (type.startsWith('TOOL_CALL')) return 'TOOL_CALL';
  if (type === 'CUSTOM') return 'CUSTOM';
  if (type.startsWith('STEP_')) return 'STEP';
  if (type.startsWith('REASONING')) return 'REASONING';
  if (type.startsWith('STATE_') || type === 'MESSAGES_SNAPSHOT') return 'STATE';
  return 'OTHER';
}

function iconForType(type: string): string {
  switch (type) {
    case 'RUN_STARTED': return '▶️';
    case 'RUN_FINISHED': return '✅';
    case 'RUN_ERROR': return '❌';
    case 'TOOL_CALL_START': return '🔧';
    case 'TOOL_CALL_ARGS': return '📝';
    case 'TOOL_CALL_END': return '🏁';
    case 'TOOL_CALL_RESULT': return '📋';
    case 'TEXT_MESSAGE_START': return '✏️';
    case 'TEXT_MESSAGE_CONTENT': return '💬';
    case 'TEXT_MESSAGE_END': return '✔️';
    case 'CUSTOM': return '✨';
    case REQUEST_SENT_TYPE: return '📤';
    default: return '📦';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Short one-line summary for the event row. */
function summary(entry: TimestampedEvent): string {
  const e = entry.event as AGUIEvent;
  switch (e.type) {
    case AGUIEventType.RUN_STARTED:
      return e.threadId ? `thread ${e.threadId.slice(0, 8)}…` : 'agent run starting';
    case AGUIEventType.RUN_FINISHED:
      return 'completed';
    case AGUIEventType.RUN_ERROR:
      return e.message || 'run failed';
    case AGUIEventType.TEXT_MESSAGE_START:
      return `message ${e.messageId.slice(0, 8)}… (${e.role})`;
    case AGUIEventType.TEXT_MESSAGE_CONTENT: {
      const d = e.delta || '';
      return d.length > 80 ? `${d.slice(0, 80)}…` : d;
    }
    case AGUIEventType.TEXT_MESSAGE_END:
      return 'message complete';
    case AGUIEventType.TOOL_CALL_START:
      return e.toolCallName;
    case AGUIEventType.TOOL_CALL_ARGS: {
      const d = e.delta || '';
      return d.length > 80 ? `${d.slice(0, 80)}…` : d;
    }
    case AGUIEventType.TOOL_CALL_END:
      return 'tool call complete';
    case AGUIEventType.TOOL_CALL_RESULT: {
      const c = e.content || '';
      return c.length > 80 ? `${c.slice(0, 80)}…` : c;
    }
    case AGUIEventType.STEP_STARTED:
    case AGUIEventType.STEP_FINISHED:
      return e.stepName;
    case AGUIEventType.CUSTOM: {
      if (e.name === 'AgentHandoff') {
        const v = e.value as { to?: string; reason?: string } | null;
        if (v?.to) return `→ ${v.to}: ${v.reason ?? ''}`;
      }
      if (e.name === 'InlineVisuals') {
        const v = e.value as { visuals?: unknown[] } | null;
        return `${v?.visuals?.length ?? 0} inline visual(s)`;
      }
      return e.name;
    }
    case REQUEST_SENT_TYPE: {
      const reqMsgs = entry.request?.messages ?? [];
      const last = reqMsgs[reqMsgs.length - 1];
      const txt = last?.content ?? '';
      return `POST ${reqMsgs.length} msg${reqMsgs.length === 1 ? '' : 's'} · "${txt.slice(0, 50)}${txt.length > 50 ? '…' : ''}"`;
    }
    default:
      return '';
  }
}

function isHandoffEvent(entry: TimestampedEvent): boolean {
  const e = entry.event as AGUIEvent;
  return e.type === AGUIEventType.CUSTOM && (e as any).name === 'AgentHandoff';
}

const ExplainabilityPanel: React.FC<Props> = ({ events, isOpen, onClose }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<Category, TimestampedEvent[]>();
    for (const ts of events) {
      const cat = categorize(ts.event.type);
      const existing = map.get(cat);
      if (existing) existing.push(ts);
      else map.set(cat, [ts]);
    }
    return map;
  }, [events]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div
        className={`explain-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <aside
        className={`explain-panel ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-label="Agent activity"
        aria-hidden={!isOpen}
      >
        <header className="explain-header">
          <div>
            <h3>🧠 Agent activity</h3>
            <span className="explain-count">
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            className="explain-close"
            onClick={onClose}
            title="Close panel"
            aria-label="Close panel"
          >
            ✕
          </button>
        </header>

        <div className="explain-body">
          {events.length === 0 ? (
            <div className="explain-empty">
              <div className="explain-empty-icon">✨</div>
              <p>Send a message to see what the AI is doing.</p>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([cat, list]) => {
              const meta = CATEGORY_META[cat];
              return (
                <section key={cat} className={`explain-group ${meta.className}`}>
                  <h4 className="explain-group-title">
                    <span className="explain-group-icon">{meta.icon}</span>
                    {meta.label}
                    <span className="explain-group-count">{list.length}</span>
                  </h4>
                  <ul className="explain-list">
                    {list.map(entry => {
                      const eventType = entry.event.type;
                      const isOpenItem = expanded.has(entry.id);
                      const handoff = isHandoffEvent(entry);
                      return (
                        <li
                          key={entry.id}
                          className={`explain-card ${meta.className}${handoff ? ' explain-card-handoff' : ''}`}
                        >
                          <button
                            type="button"
                            className="explain-card-head"
                            onClick={() => toggle(entry.id)}
                            aria-expanded={isOpenItem}
                          >
                            <span className="explain-card-icon">
                              {iconForType(eventType)}
                            </span>
                            <div className="explain-card-main">
                              <div className="explain-card-row">
                                <span className={`explain-badge ${meta.className}`}>
                                  {eventType}
                                </span>
                                {handoff && (
                                  <span className="explain-badge explain-badge-handoff">
                                    Handoff
                                  </span>
                                )}
                                <span className="explain-card-time">
                                  {formatTime(entry.timestamp)}
                                </span>
                              </div>
                              <div className="explain-card-summary">
                                {summary(entry)}
                              </div>
                            </div>
                            <span className="explain-card-chev">
                              {isOpenItem ? '▾' : '▸'}
                            </span>
                          </button>
                          {isOpenItem && (
                            <pre className="explain-card-json">
                              {JSON.stringify(
                                entry.request
                                  ? { request: entry.request }
                                  : entry.event,
                                null,
                                2
                              )}
                            </pre>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};

export default ExplainabilityPanel;
