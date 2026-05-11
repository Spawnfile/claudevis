import type { SkillEntry } from '@claudevis/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PromptBar } from '../src/PromptBar.js';
import { useConnection } from '../src/store/connection.js';

const buildEntry = (overrides: Partial<SkillEntry> = {}): SkillEntry => ({
  name: 'sample',
  description: '',
  source: 'user',
  path: '',
  kind: 'skill',
  ...overrides,
});

const seedCatalog = () =>
  useConnection.setState({
    catalog: [
      buildEntry({ name: 'commit', kind: 'slash_command' }),
      buildEntry({ name: 'compact', kind: 'slash_command' }),
      buildEntry({ name: 'review', kind: 'slash_command' }),
    ],
  });

describe('PromptBar — inline /-completion', () => {
  beforeEach(() => {
    useConnection.getState().reset();
    seedCatalog();
  });

  afterEach(() => {
    cleanup();
    // Match chat.test.tsx hygiene: drop any mocked send so the next test
    // starts with a clean stub, regardless of test order.
    useConnection.setState({ send: () => {} });
  });

  it('does not render the dropdown for non-slash input', () => {
    render(<PromptBar sessionId="sess-1" />);
    fireEvent.change(screen.getByPlaceholderText(/type a prompt/i), {
      target: { value: 'hello' },
    });
    expect(screen.queryByTestId('completion-dropdown')).toBeNull();
  });

  it('opens the dropdown when input becomes "/"', () => {
    render(<PromptBar sessionId="sess-1" />);
    fireEvent.change(screen.getByPlaceholderText(/type a prompt/i), {
      target: { value: '/' },
    });
    expect(screen.getByTestId('completion-dropdown')).toBeInTheDocument();
    expect(screen.getAllByTestId('completion-entry')).toHaveLength(3);
  });

  it('narrows entries as the user types', () => {
    render(<PromptBar sessionId="sess-1" />);
    fireEvent.change(screen.getByPlaceholderText(/type a prompt/i), {
      target: { value: '/co' },
    });
    const names = screen.getAllByTestId('completion-entry').map((b) => b.dataset.name);
    expect(names).toEqual(['commit', 'compact']);
  });

  it('closes the dropdown once a space is typed after the slash command', () => {
    render(<PromptBar sessionId="sess-1" />);
    fireEvent.change(screen.getByPlaceholderText(/type a prompt/i), {
      target: { value: '/commit ' },
    });
    expect(screen.queryByTestId('completion-dropdown')).toBeNull();
  });

  it('does not open the dropdown when catalog is null', () => {
    useConnection.setState({ catalog: null });
    render(<PromptBar sessionId="sess-1" />);
    fireEvent.change(screen.getByPlaceholderText(/type a prompt/i), {
      target: { value: '/' },
    });
    expect(screen.queryByTestId('completion-dropdown')).toBeNull();
  });

  it('ArrowDown cycles modulo length (4 presses on 3-entry list lands on index 1)', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i);
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const items = screen.getAllByRole('option');
    expect(items[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp wraps selection from first to last', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i);
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const items = screen.getAllByRole('option');
    expect(items[2]!.getAttribute('aria-selected')).toBe('true');
  });

  it('Enter selects the highlighted entry and replaces input with "/<name> "', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/co' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('/compact ');
    expect(screen.queryByTestId('completion-dropdown')).toBeNull();
  });

  it('Tab selects the highlighted entry like Enter', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('/commit ');
  });

  it('Click on an entry selects it', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.click(screen.getAllByTestId('completion-entry')[2]!);
    expect(input.value).toBe('/review ');
  });

  it('Escape closes the dropdown without changing input; reopen on next keystroke', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/co' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('completion-dropdown')).toBeNull();
    expect(input.value).toBe('/co');
    fireEvent.change(input, { target: { value: '/com' } });
    expect(screen.getByTestId('completion-dropdown')).toBeInTheDocument();
  });

  it('Enter with no dropdown open submits the prompt as today', () => {
    let captured: unknown = null;
    useConnection.setState({
      send: (cmd) => {
        captured = cmd;
      },
    });
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(captured).toMatchObject({
      type: 'session.send',
      sessionId: 'sess-1',
      content: 'hello world',
    });
    expect(input.value).toBe('');
  });

  it('Hovering an entry updates the selected index', () => {
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.mouseEnter(screen.getAllByRole('option')[2]!);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('/review ');
  });

  it('Enter while open with out-of-bounds selectedIndex is a no-op', async () => {
    // Defensive guard: if the Zustand catalog shrinks between ArrowDown and
    // Enter (e.g. server pushed a new skill.catalog with fewer entries),
    // filtered[selectedIndex] becomes undefined → handler safely no-ops.
    render(<PromptBar sessionId="sess-1" />);
    const input = screen.getByPlaceholderText(/type a prompt/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } }); // 3 entries
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // selectedIndex = 2
    // Server pushes a new catalog with fewer entries — selectedIndex stays 2.
    useConnection.setState({
      catalog: [buildEntry({ name: 'commit', kind: 'slash_command' })],
    });
    // Wait for component to re-render with the new catalog.
    await waitFor(() => {
      expect(screen.getAllByTestId('completion-entry')).toHaveLength(1);
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Input unchanged (entry at index 2 is undefined); dropdown still showing the one entry.
    expect(input.value).toBe('/');
    expect(screen.getByTestId('completion-dropdown')).toBeInTheDocument();
  });
});
