import type { Event } from '@claudevis/shared';
import type React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useConnection } from './store/connection.js';

export function Chat({ sessionId }: { sessionId: string | null }) {
  const events = useConnection((s) => s.events);
  const send = useConnection((s) => s.send);
  if (!sessionId)
    return <div style={{ color: '#7a8699' }}>Select a session or open a new one.</div>;
  const filtered = events.filter((e) => e.sessionId === sessionId);
  const respond = (requestId: string, decision: 'allow' | 'deny' | 'always') => {
    send({ type: 'permission.respond', requestId, decision });
  };
  return (
    <div data-testid="chat">
      {filtered.map((e) => (
        <ChatRow key={e.id} event={e} events={filtered} respond={respond} />
      ))}
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}

// Exhaustiveness helper — the `default` arm assigns the remaining union
// member to `never`. If a future protocol change adds an Event type and
// this switch isn't updated, TypeScript fails to compile here.
const assertNever = (x: never): null => {
  console.warn('unhandled event type', x);
  return null;
};

interface ChatRowProps {
  event: Event;
  events: Event[];
  respond: (requestId: string, decision: 'allow' | 'deny' | 'always') => void;
}

function ChatRow({ event: e, events, respond }: ChatRowProps): React.JSX.Element | null {
  switch (e.type) {
    case 'user.prompt':
      return (
        <div className="msg user" data-evtype="user.prompt">
          <div className="who">🧑 You</div>
          <div className="body">{e.content}</div>
        </div>
      );
    case 'agent.thinking':
      return (
        <div className="msg thinking" data-evtype="agent.thinking">
          <div className="who">💭 Thinking</div>
          <div className="body">
            <Markdown>{e.content}</Markdown>
          </div>
        </div>
      );
    case 'agent.message':
      return (
        <div className="msg agent" data-evtype="agent.message">
          <div className="who">⚒ Agent</div>
          <div className="body">
            <Markdown>{e.content}</Markdown>
          </div>
        </div>
      );
    case 'tool.started':
      return (
        <div className="msg tool" data-evtype="tool.started">
          <div className="who">⚙ Tool call</div>
          <div className="body">
            <code>{e.name}</code>
            <pre style={{ fontSize: 11, color: '#7a8699', margin: 0 }}>
              {JSON.stringify(e.input, null, 2)}
            </pre>
          </div>
        </div>
      );
    case 'tool.completed':
      return (
        <div className="msg tool" data-evtype="tool.completed">
          <div className="who">✓ Tool result ({e.status})</div>
          <div className="body">
            <pre style={{ fontSize: 11, color: '#7a8699', margin: 0 }}>
              {JSON.stringify(e.output, null, 2)}
            </pre>
            <span style={{ fontSize: 10, color: '#7a8699' }}>{e.durationMs}ms</span>
          </div>
        </div>
      );
    case 'subagent.dispatched':
      return (
        <div className="msg subagent" data-evtype="subagent.dispatched">
          <div className="who">🪄 Subagent dispatched: {e.agentType}</div>
          <div className="body">{e.prompt}</div>
        </div>
      );
    case 'subagent.completed':
      return (
        <div className="msg subagent" data-evtype="subagent.completed">
          <div className="who">🪄 Subagent done ({e.status})</div>
          <div className="body">
            <pre style={{ fontSize: 11, color: '#7a8699', margin: 0 }}>
              {JSON.stringify(e.result, null, 2)}
            </pre>
          </div>
        </div>
      );
    case 'tokens.updated':
      return (
        <div className="msg tokens" data-evtype="tokens.updated">
          <div className="who">💰 Tokens</div>
          <div className="body" style={{ fontSize: 11 }}>
            in {e.input} · out {e.output} · cached {e.cached} · ${e.costUsd.toFixed(4)} · {e.model}
          </div>
        </div>
      );
    case 'file.changed':
      return (
        <div className="msg file" data-evtype="file.changed">
          <div className="who">📝 File changed</div>
          <div className="body">
            <code>{e.path}</code> <span style={{ color: '#6dba3a' }}>+{e.plus}</span>{' '}
            <span style={{ color: '#d94a4a' }}>-{e.minus}</span>
            {e.preview && (
              <pre style={{ fontSize: 11, color: '#7a8699', margin: 0 }}>{e.preview}</pre>
            )}
          </div>
        </div>
      );
    case 'permission.requested': {
      const isAutoDeny = e.requestId.startsWith('auto-deny-');
      const resolution = events.find(
        (other): other is Extract<Event, { type: 'permission.resolved' }> =>
          other.type === 'permission.resolved' && other.requestId === e.requestId,
      );
      const resolved = resolution !== undefined;
      return (
        <div
          className={`msg permission${!isAutoDeny && resolved ? ' resolved' : ''}${isAutoDeny ? ' auto-deny' : ''}`}
          data-evtype="permission.requested"
          data-request-id={e.requestId}
        >
          <div className="who">
            {isAutoDeny
              ? '🚫 Permission denied (auto)'
              : resolved
                ? '✓ Permission'
                : '❓ Permission needed'}
          </div>
          <div className="permission-tool">{e.toolName}</div>
          <pre className="permission-input">{JSON.stringify(e.toolInput, null, 2)}</pre>
          {isAutoDeny ? (
            <div className="permission-resolution">
              auto-denied — claude requires interactive consent (TTY mode); see README
            </div>
          ) : resolved ? (
            <div className="permission-resolution">resolved: {resolution.decision}</div>
          ) : (
            <div className="permission-actions">
              <button type="button" onClick={() => respond(e.requestId, 'allow')}>
                Allow
              </button>
              <button type="button" onClick={() => respond(e.requestId, 'deny')}>
                Deny
              </button>
              <button type="button" onClick={() => respond(e.requestId, 'always')}>
                Always
              </button>
            </div>
          )}
        </div>
      );
    }
    case 'permission.resolved':
      return null;
    case 'skill.invoked':
      return (
        <div className="msg skill" data-evtype="skill.invoked">
          <div className="who">🛠 Skill: {e.skillName}</div>
          {e.args && <div className="body">{e.args}</div>}
        </div>
      );
    case 'session.started':
      return (
        <div className="msg system" data-evtype="session.started">
          <div className="who">▶ session started</div>
          <div className="body" style={{ fontSize: 11, color: '#7a8699' }}>
            {e.name} · {e.cwd} · {e.model}
            {e.repo && e.branch ? ` · ${e.repo}@${e.branch}` : ''}
          </div>
        </div>
      );
    case 'session.ended':
      return (
        <div className="msg system" data-evtype="session.ended">
          <div className="who">■ session ended ({e.reason})</div>
        </div>
      );
    case 'session.idle':
      return (
        <div className="msg system" data-evtype="session.idle">
          <div className="who">💤 idle ({Math.round(e.durationMs / 1000)}s)</div>
        </div>
      );
    case 'session.mode.changed':
      return (
        <div className="msg system" data-evtype="session.mode.changed">
          <div className="who">⚙ mode → {e.mode}</div>
        </div>
      );
    case 'interrupt.signaled':
      return (
        <div className="msg system" data-evtype="interrupt.signaled">
          <div className="who">⏹ interrupt</div>
        </div>
      );
    case 'error':
      return (
        <div className="msg error" data-evtype="error">
          <div className="who" style={{ color: '#d94a4a' }}>
            ⚠ error{e.recoverable ? '' : ' (critical)'}
          </div>
          <div className="body">{e.message}</div>
        </div>
      );
    default:
      return assertNever(e);
  }
}
