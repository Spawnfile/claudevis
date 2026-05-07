import type { SkillEntry } from '@claudevis/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillDrawer } from '../src/SkillDrawer.js';
import { useConnection } from '../src/store/connection.js';

const buildEntry = (overrides: Partial<SkillEntry> = {}): SkillEntry => ({
  name: 'sample',
  description: '',
  source: 'user',
  path: '',
  kind: 'skill',
  ...overrides,
});

describe('SkillDrawer', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "Create a session" empty state when catalog is null', () => {
    render(<SkillDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /skills/i }));
    expect(screen.getByText(/create a session/i)).toBeInTheDocument();
  });

  it('shows "No skills loaded" empty state when catalog is empty array', () => {
    useConnection.setState({ catalog: [] });
    render(<SkillDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /skills/i }));
    expect(screen.getByText(/no skills loaded/i)).toBeInTheDocument();
  });

  it('renders three sections grouped by kind', () => {
    useConnection.setState({
      catalog: [
        buildEntry({ name: 's1', kind: 'skill' }),
        buildEntry({ name: 'c1', kind: 'slash_command' }),
        buildEntry({ name: 'a1', kind: 'agent' }),
      ],
    });
    render(<SkillDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /skills/i }));
    expect(screen.getByText(/slash commands/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^skills$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.getByText('a1')).toBeInTheDocument();
  });

  it('filter input narrows visible entries by name substring (case-insensitive)', () => {
    useConnection.setState({
      catalog: [
        buildEntry({ name: 'foo-skill', kind: 'skill' }),
        buildEntry({ name: 'bar-skill', kind: 'skill' }),
      ],
    });
    render(<SkillDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /skills/i }));
    const filter = screen.getByPlaceholderText(/filter/i);
    fireEvent.change(filter, { target: { value: 'FOO' } });
    expect(screen.getByText('foo-skill')).toBeInTheDocument();
    expect(screen.queryByText('bar-skill')).not.toBeInTheDocument();
  });

  it('clicking an entry sets pendingPromptPrefix to "/<name> "', () => {
    useConnection.setState({
      catalog: [buildEntry({ name: 'plugin-a:test-skill', kind: 'skill' })],
    });
    render(<SkillDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /skills/i }));
    fireEvent.click(screen.getByText('plugin-a:test-skill'));
    expect(useConnection.getState().pendingPromptPrefix).toBe('/plugin-a:test-skill ');
  });
});
