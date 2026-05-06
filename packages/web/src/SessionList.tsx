import { useConnection } from './store/connection.js';

const newSession = (send: ReturnType<typeof useConnection.getState>['send']): void => {
  // Ask the user for a working directory rather than hardcoding one. The
  // prompt fallback `.` resolves to the server process's cwd, which is the
  // workspace root when launched via the project's dev script.
  const cwd =
    typeof window !== 'undefined' ? window.prompt('Working directory for new session', '.') : '.';
  if (!cwd) return;
  send({ type: 'session.create', cwd, name: `s-${Date.now() % 10000}` });
};

export function SessionList({
  activeSessionId,
  onSelect,
}: { activeSessionId: string | null; onSelect: (id: string) => void }) {
  const events = useConnection((s) => s.events);
  const send = useConnection((s) => s.send);
  const sessions = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'session.started') sessions.set(e.sessionId, e.name);
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => newSession(send)}
        style={{ width: '100%', marginBottom: 8 }}
      >
        + New Session
      </button>
      {Array.from(sessions.entries()).map(([id, name]) => (
        <button
          key={id}
          type="button"
          className={`session ${activeSessionId === id ? 'active' : ''}`}
          onClick={() => onSelect(id)}
        >
          {name}
          <div style={{ fontSize: 10, color: '#7a8699' }}>{id}</div>
        </button>
      ))}
    </div>
  );
}
