import { useConnection } from './store/connection.js';

export function RawEvents({ sessionId }: { sessionId: string | null }) {
  const events = useConnection((s) => s.events);
  const filtered = sessionId ? events.filter((e) => e.sessionId === sessionId) : events;

  // Distinct event-type counts so the contract coverage is glanceable.
  const counts = new Map<string, number>();
  for (const e of filtered) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  return (
    <div className="raw-events" data-testid="raw-events">
      <div className="raw-summary">
        <strong>Event coverage:</strong>{' '}
        {Array.from(counts.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([t, n]) => (
            <span className="raw-pill" key={t} data-event-type={t}>
              {t}×{n}
            </span>
          ))}
      </div>
      <pre className="raw-stream">{filtered.map((e) => `${JSON.stringify(e)}\n`).join('')}</pre>
    </div>
  );
}
