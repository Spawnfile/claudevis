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
  const [formOpen, setFormOpen] = useState(false);

  const sessions = new Map<string, SessionMeta>();
  for (const e of events) {
    if (e.type === 'session.started') {
      const model = isModel(e.model) ? e.model : 'sonnet';
      sessions.set(e.sessionId, { name: e.name, model });
    }
  }

  return (
    <div>
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
