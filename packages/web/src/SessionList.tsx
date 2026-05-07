import type { ResumableSession } from '@claudevis/shared';
import { useState } from 'react';
import { useConnection } from './store/connection.js';

type Model = 'sonnet' | 'opus' | 'haiku';

interface SessionMeta {
  name: string;
  model: Model;
}

function isModel(s: string): s is Model {
  return s === 'sonnet' || s === 'opus' || s === 'haiku';
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewSessionForm({ onClose }: { onClose: () => void }) {
  const send = useConnection((s) => s.send);
  const [cwd, setCwd] = useState('.');
  const [name, setName] = useState('');
  const [model, setModel] = useState<Model>('sonnet');

  const submit = () => {
    const resolvedName = name.trim() || `s-${Date.now() % 10000}`;
    send({
      type: 'session.create',
      cwd: cwd.trim() || '.',
      name: resolvedName,
      model,
    });
    onClose();
  };

  return (
    <div className="new-session-form">
      <input
        type="text"
        placeholder="working directory"
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
      />
      <input
        type="text"
        placeholder="session name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        value={model}
        onChange={(e) => {
          if (isModel(e.target.value)) setModel(e.target.value);
        }}
      >
        <option value="sonnet">sonnet</option>
        <option value="opus">opus</option>
        <option value="haiku">haiku</option>
      </select>
      <div className="new-session-form-actions">
        <button type="button" onClick={submit}>
          Create
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SessionList({
  activeSessionId,
  onSelect,
}: { activeSessionId: string | null; onSelect: (id: string) => void }) {
  const events = useConnection((s) => s.events);
  const resumable = useConnection((s) => s.resumable);
  const send = useConnection((s) => s.send);
  const [formOpen, setFormOpen] = useState(false);

  const sessions = new Map<string, SessionMeta>();
  for (const e of events) {
    if (e.type === 'session.started') {
      const model = isModel(e.model) ? e.model : 'sonnet';
      sessions.set(e.sessionId, { name: e.name, model });
    }
  }

  const onClickResume = (entry: ResumableSession) => {
    const name = entry.name ?? `resumed-${entry.id.slice(0, 8)}`;
    const model = entry.model ?? 'sonnet';
    send({
      type: 'session.create',
      cwd: entry.cwd,
      name,
      model,
      resume: entry.id,
    });
  };

  return (
    <div>
      {resumable.length > 0 && (
        <details className="resumable-section">
          <summary>Resumable ({resumable.length})</summary>
          <ul className="resumable-list">
            {resumable.map((entry) => {
              const displayName = entry.name ?? `resumed-${entry.id.slice(0, 8)}`;
              return (
                <li key={entry.id} className="resumable-entry">
                  <button
                    type="button"
                    className="resumable-entry-button"
                    onClick={() => onClickResume(entry)}
                  >
                    <span className="resumable-entry-name">{displayName}</span>
                    <span className="resumable-entry-cwd">{entry.cwd}</span>
                    <span className="resumable-entry-meta">
                      {entry.model ?? '?'} · {timeAgo(entry.lastActiveAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {formOpen ? (
        <NewSessionForm onClose={() => setFormOpen(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          style={{ width: '100%', marginBottom: 8 }}
        >
          + New Session
        </button>
      )}
      {Array.from(sessions.entries()).map(([id, { name, model }]) => (
        <button
          key={id}
          type="button"
          className={`session ${activeSessionId === id ? 'active' : ''}`}
          onClick={() => onSelect(id)}
        >
          {name}
          <span className={`model-badge model-${model}`}>{model}</span>
          <div style={{ fontSize: 10, color: '#7a8699' }}>{id}</div>
        </button>
      ))}
    </div>
  );
}
