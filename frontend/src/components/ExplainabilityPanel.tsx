import React, { useMemo, useState } from 'react';
import type { AgentEvent } from '../services/api';
import './ExplainabilityPanel.css';

interface Props {
  events: AgentEvent[];
  isOpen: boolean;
  onClose: () => void;
}

type Category = 'RUN' | 'TOOL_CALL' | 'TEXT_MESSAGE' | 'REASONING' | 'ERROR';

const CATEGORY_META: Record<Category, { label: string; icon: string; className: string }> = {
  RUN: { label: 'Run', icon: '▶️', className: 'cat-run' },
  TOOL_CALL: { label: 'Tool', icon: '🔧', className: 'cat-tool' },
  TEXT_MESSAGE: { label: 'Message', icon: '💬', className: 'cat-text' },
  REASONING: { label: 'Reasoning', icon: '🧠', className: 'cat-reasoning' },
  ERROR: { label: 'Error', icon: '❌', className: 'cat-error' },
};

function categorize(type: string): Category {
  if (type === 'RUN_ERROR') return 'ERROR';
  if (type.startsWith('RUN_')) return 'RUN';
  if (type.startsWith('TOOL_CALL')) return 'TOOL_CALL';
  if (type.startsWith('TEXT_MESSAGE')) return 'TEXT_MESSAGE';
  if (type.startsWith('REASONING')) return 'REASONING';
  return 'RUN';
}

function iconForType(type: string): string {
  switch (type) {
    case 'RUN_STARTED':
      return '▶️';
    case 'RUN_FINISHED':
      return '✅';
    case 'RUN_ERROR':
      return '❌';
    case 'TOOL_CALL_START':
      return '🔧';
    case 'TOOL_CALL_RESULT':
      return '📋';
    case 'TEXT_MESSAGE_CONTENT':
      return '💬';
    case 'REASONING':
      return '🧠';
    default:
      return '📤';
  }
}

function formatTime(ts: number): string {
  // Backend emits epoch seconds (float). Multiply to ms for Date.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function summary(event: AgentEvent): string {
  const d = event.details || {};
  switch (event.type) {
    case 'RUN_STARTED':
      return 'agent run starting';
    case 'RUN_FINISHED':
      return event.duration_ms != null ? `completed in ${event.duration_ms.toFixed(0)} ms` : 'completed';
    case 'RUN_ERROR':
      return d.error ? String(d.error) : 'run failed';
    case 'TOOL_CALL_START': {
      const args = d.args || {};
      if (typeof args.dax_query === 'string') {
        const q = args.dax_query.replace(/\s+/g, ' ').trim();
        return q.length > 80 ? `${q.slice(0, 80)}…` : q;
      }
      if (typeof args.info_function === 'string') return args.info_function;
      return event.name || 'tool call';
    }
    case 'TOOL_CALL_RESULT': {
      const parts: string[] = [];
      if (event.duration_ms != null) parts.push(`${event.duration_ms.toFixed(0)} ms`);
      const r = d.result;
      if (r && typeof r === 'object' && 'rows' in r && r.rows != null) {
        parts.push(`${r.rows} rows`);
      } else if (r && typeof r === 'object' && 'row_count' in r) {
        parts.push(`${r.row_count} rows`);
      }
      if (d.error) parts.push(`error: ${d.error}`);
      return parts.length ? parts.join(' · ') : 'result';
    }
    case 'TEXT_MESSAGE_CONTENT': {
      const c = typeof d.content === 'string' ? d.content : '';
      return c.length > 80 ? `${c.slice(0, 80)}…` : c;
    }
    case 'REASONING':
      return typeof d.answer_preview === 'string' ? d.answer_preview : 'reasoning';
    default:
      return '';
  }
}

const ExplainabilityPanel: React.FC<Props> = ({ events, isOpen, onClose }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<Category, AgentEvent[]>();
    for (const e of events) {
      const cat = categorize(e.type);
      const existing = map.get(cat);
      if (existing) {
        existing.push(e);
      } else {
        map.set(cat, [e]);
      }
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
            <span className="explain-count">{events.length} event{events.length === 1 ? '' : 's'}</span>
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
                    {list.map(event => {
                      const isOpen = expanded.has(event.id);
                      return (
                        <li
                          key={event.id}
                          className={`explain-card ${meta.className}`}
                        >
                          <button
                            type="button"
                            className="explain-card-head"
                            onClick={() => toggle(event.id)}
                            aria-expanded={isOpen}
                          >
                            <span className="explain-card-icon">{iconForType(event.type)}</span>
                            <div className="explain-card-main">
                              <div className="explain-card-row">
                                <span className={`explain-badge ${meta.className}`}>{event.type}</span>
                                {event.name && <span className="explain-card-name">{event.name}</span>}
                                <span className="explain-card-time">{formatTime(event.timestamp)}</span>
                              </div>
                              <div className="explain-card-summary">{summary(event)}</div>
                            </div>
                            <span className="explain-card-chev">{isOpen ? '▾' : '▸'}</span>
                          </button>
                          {isOpen && (
                            <pre className="explain-card-json">
                              {JSON.stringify(event.details ?? {}, null, 2)}
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
