import type { ResumableSession } from '@claudevis/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from '../src/SessionList.js';
import { useConnection } from '../src/store/connection.js';

describe('SessionList — new-session form', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens a form when "+ New Session" is clicked', () => {
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /New Session/ }));
    expect(screen.getByPlaceholderText(/working directory/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/session name/i)).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy();
  });

  it('dispatches session.create with the chosen fields on Create', () => {
    const sendSpy = vi.spyOn(useConnection.getState(), 'send');
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /New Session/ }));

    const cwd = screen.getByPlaceholderText(/working directory/i) as HTMLInputElement;
    const name = screen.getByPlaceholderText(/session name/i) as HTMLInputElement;
    const model = screen.getByRole('combobox') as HTMLSelectElement;

    fireEvent.change(cwd, { target: { value: '/tmp/proj' } });
    fireEvent.change(name, { target: { value: 'demo' } });
    fireEvent.change(model, { target: { value: 'opus' } });

    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'session.create',
      cwd: '/tmp/proj',
      name: 'demo',
      model: 'opus',
    });
  });

  it('uses lazy default for empty name field at submit time', () => {
    const sendSpy = vi.spyOn(useConnection.getState(), 'send');
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /New Session/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.create',
        cwd: '.',
        name: expect.stringMatching(/^s-\d{1,4}$/),
        model: 'sonnet',
      }),
    );
  });

  it('closes the form on Cancel without dispatching', () => {
    const sendSpy = vi.spyOn(useConnection.getState(), 'send');
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /New Session/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(sendSpy).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/working directory/i)).toBeNull();
  });

  it('renders a model badge for each session card', () => {
    useConnection.setState((s) => ({
      events: [
        ...s.events,
        {
          id: 'ev-1',
          ts: 1,
          sessionId: 'sess-1',
          type: 'session.started',
          name: 'demo',
          cwd: '/tmp/x',
          model: 'opus',
        },
      ],
    }));
    const { container } = render(
      <SessionList activeSessionId="sess-1" onSelect={() => undefined} />,
    );
    expect(container.querySelector('.model-badge.model-opus')).not.toBeNull();
  });
});

describe('SessionList — resumable section', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useConnection.setState({ send: () => undefined });
  });

  it('does NOT render the resumable section when resumable is empty', () => {
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    expect(screen.queryByText(/resumable/i)).not.toBeInTheDocument();
  });

  it('renders a collapsible Resumable section when resumable has entries', () => {
    const sessions: ResumableSession[] = [
      {
        id: 'old-uuid-1',
        cwd: '/path/to/project',
        name: 'old session',
        model: 'sonnet',
        lastActiveAt: Date.now() - 1000 * 60 * 60,
      },
    ];
    useConnection.setState({ resumable: sessions });
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    expect(screen.getByText(/resumable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/resumable/i));
    expect(screen.getByText('old session')).toBeInTheDocument();
  });

  it('shows count in the summary label', () => {
    const sessions: ResumableSession[] = [
      { id: 'a', cwd: '/x', lastActiveAt: 1 },
      { id: 'b', cwd: '/y', lastActiveAt: 2 },
    ];
    useConnection.setState({ resumable: sessions });
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);
    expect(screen.getByText(/resumable \(2\)/i)).toBeInTheDocument();
  });

  it('clicking a resumable entry dispatches session.create with resume field filled', () => {
    const sent: unknown[] = [];
    const sessions: ResumableSession[] = [
      {
        id: 'old-uuid-1',
        cwd: '/path/to/project',
        name: 'old',
        model: 'opus',
        lastActiveAt: Date.now(),
      },
    ];
    useConnection.setState({
      resumable: sessions,
      send: (cmd) => {
        sent.push(cmd);
      },
    });
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);

    fireEvent.click(screen.getByText(/resumable/i));
    fireEvent.click(screen.getByText('old'));

    expect(sent).toEqual([
      {
        type: 'session.create',
        cwd: '/path/to/project',
        name: 'old',
        model: 'opus',
        resume: 'old-uuid-1',
      },
    ]);
  });

  it('falls back to "resumed-<id-prefix>" for entries without a name and sonnet for missing model', () => {
    const sent: unknown[] = [];
    const sessions: ResumableSession[] = [
      {
        id: 'abcdef0123456789',
        cwd: '/x',
        lastActiveAt: Date.now(),
      },
    ];
    useConnection.setState({
      resumable: sessions,
      send: (cmd) => {
        sent.push(cmd);
      },
    });
    render(<SessionList activeSessionId={null} onSelect={() => undefined} />);

    fireEvent.click(screen.getByText(/resumable/i));
    expect(screen.getByText(/resumed-abcdef01/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/resumed-abcdef01/i));

    expect(sent).toEqual([
      {
        type: 'session.create',
        cwd: '/x',
        name: 'resumed-abcdef01',
        model: 'sonnet',
        resume: 'abcdef0123456789',
      },
    ]);
  });
});
