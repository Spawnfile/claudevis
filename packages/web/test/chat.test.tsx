import type { Command, Event } from '@claudevis/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chat } from '../src/Chat.js';
import { useConnection } from '../src/store/connection.js';

function pushEvent(event: Event) {
  useConnection.setState((s) => ({ events: [...s.events, event] }));
}

describe('Chat — markdown rendering', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders **bold** as <strong> inside agent.message', () => {
    pushEvent({
      id: 'ev-1',
      ts: 1,
      sessionId: 'sess-1',
      type: 'agent.message',
      content: 'hello **world**',
      streaming: false,
    });
    render(<Chat sessionId="sess-1" />);
    const strong = screen.getByText('world');
    expect(strong.tagName).toBe('STRONG');
  });

  it('renders fenced code blocks as <code> inside <pre>', () => {
    pushEvent({
      id: 'ev-2',
      ts: 2,
      sessionId: 'sess-1',
      type: 'agent.message',
      content: '```\nconst x = 1;\n```',
      streaming: false,
    });
    render(<Chat sessionId="sess-1" />);
    const code = screen.getByText('const x = 1;');
    expect(code.tagName).toBe('CODE');
    expect(code.parentElement?.tagName).toBe('PRE');
  });

  it('renders agent.thinking as markdown too', () => {
    pushEvent({
      id: 'ev-3',
      ts: 3,
      sessionId: 'sess-1',
      type: 'agent.thinking',
      content: 'I should *consider* options.',
      streaming: false,
    });
    render(<Chat sessionId="sess-1" />);
    const em = screen.getByText('consider');
    expect(em.tagName).toBe('EM');
  });

  it('preserves data-evtype on the wrapping div', () => {
    pushEvent({
      id: 'ev-4',
      ts: 4,
      sessionId: 'sess-1',
      type: 'agent.message',
      content: 'plain',
      streaming: false,
    });
    const { container } = render(<Chat sessionId="sess-1" />);
    expect(container.querySelector('[data-evtype="agent.message"]')).not.toBeNull();
  });
});

describe('Chat — permission card', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  afterEach(() => {
    cleanup();
    // Drop any mocked send injected by individual tests so the next test
    // starts with a clean stub (the real send is a socket-OPEN-guarded
    // no-op in tests anyway, but resetting prevents stale capture arrays
    // from being mutated cross-test if test order ever changes).
    useConnection.setState({ send: () => {} });
  });

  it('renders interactive card with three buttons for non-auto-deny requestId', () => {
    pushEvent({
      id: 'ev-perm-1',
      ts: 1,
      sessionId: 'sess-1',
      type: 'permission.requested',
      requestId: 'req-fake-1',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
    });
    render(<Chat sessionId="sess-1" />);
    expect(screen.getByText(/Permission needed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always' })).toBeInTheDocument();
  });

  it('renders read-only card (no buttons) for auto-deny-* requestId', () => {
    pushEvent({
      id: 'ev-perm-2',
      ts: 2,
      sessionId: 'sess-1',
      type: 'permission.requested',
      requestId: 'auto-deny-toolu_xyz',
      toolName: 'Write',
      toolInput: { file_path: '/tmp/x', content: 'y' },
      callId: 'toolu_xyz',
    });
    pushEvent({
      id: 'ev-perm-3',
      ts: 3,
      sessionId: 'sess-1',
      type: 'permission.resolved',
      requestId: 'auto-deny-toolu_xyz',
      decision: 'deny',
    });
    render(<Chat sessionId="sess-1" />);
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always' })).not.toBeInTheDocument();
  });

  it('clicking Allow on interactive card dispatches permission.respond', () => {
    const sent: Command[] = [];
    pushEvent({
      id: 'ev-perm-4',
      ts: 4,
      sessionId: 'sess-1',
      type: 'permission.requested',
      requestId: 'req-fake-1',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
    });
    useConnection.setState({ send: (cmd: Command) => sent.push(cmd) });
    render(<Chat sessionId="sess-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(sent).toEqual([
      { type: 'permission.respond', requestId: 'req-fake-1', decision: 'allow' },
    ]);
  });

  it('matching permission.resolved hides interactive buttons and shows resolution', () => {
    pushEvent({
      id: 'ev-perm-5',
      ts: 5,
      sessionId: 'sess-1',
      type: 'permission.requested',
      requestId: 'req-fake-1',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
    });
    pushEvent({
      id: 'ev-perm-6',
      ts: 6,
      sessionId: 'sess-1',
      type: 'permission.resolved',
      requestId: 'req-fake-1',
      decision: 'allow',
    });
    render(<Chat sessionId="sess-1" />);
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
    expect(screen.getByText(/allow/i)).toBeInTheDocument();
  });

  it('non-matching permission.resolved leaves interactive buttons visible', () => {
    pushEvent({
      id: 'ev-perm-7',
      ts: 7,
      sessionId: 'sess-1',
      type: 'permission.requested',
      requestId: 'req-fake-1',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
    });
    pushEvent({
      id: 'ev-perm-8',
      ts: 8,
      sessionId: 'sess-1',
      type: 'permission.resolved',
      requestId: 'req-other',
      decision: 'allow',
    });
    render(<Chat sessionId="sess-1" />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  });
});
