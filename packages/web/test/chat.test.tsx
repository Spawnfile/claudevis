import type { Event } from '@claudevis/shared';
import { cleanup, render, screen } from '@testing-library/react';
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
