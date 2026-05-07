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
