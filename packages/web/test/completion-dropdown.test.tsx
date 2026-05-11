import type { SkillEntry } from '@claudevis/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionDropdown } from '../src/CompletionDropdown.js';

const buildEntry = (overrides: Partial<SkillEntry> = {}): SkillEntry => ({
  name: 'sample',
  description: '',
  source: 'user',
  path: '',
  kind: 'skill',
  ...overrides,
});

describe('CompletionDropdown', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when entries is empty', () => {
    const { container } = render(
      <CompletionDropdown entries={[]} selectedIndex={0} onHover={() => {}} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per entry with name + data attributes', () => {
    render(
      <CompletionDropdown
        entries={[
          buildEntry({ name: 'foo' }),
          buildEntry({ name: 'bar', kind: 'agent', source: 'plugin' }),
        ]}
        selectedIndex={0}
        onHover={() => {}}
        onSelect={() => {}}
      />,
    );
    const entries = screen.getAllByTestId('completion-entry');
    expect(entries).toHaveLength(2);
    const [first, second] = entries as [HTMLElement, HTMLElement];
    expect(first.dataset.name).toBe('foo');
    expect(second.dataset.name).toBe('bar');
  });

  it('marks the selected index with aria-selected and the selected className', () => {
    render(
      <CompletionDropdown
        entries={[buildEntry({ name: 'a' }), buildEntry({ name: 'b' })]}
        selectedIndex={1}
        onHover={() => {}}
        onSelect={() => {}}
      />,
    );
    const items = screen.getAllByRole('option');
    const [first, second] = items as [HTMLElement, HTMLElement];
    expect(first.getAttribute('aria-selected')).toBe('false');
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(second.className).toContain('completion-entry-selected');
  });

  it('calls onHover with the entry index on mouse-enter', () => {
    const onHover = vi.fn();
    render(
      <CompletionDropdown
        entries={[buildEntry({ name: 'a' }), buildEntry({ name: 'b' })]}
        selectedIndex={0}
        onHover={onHover}
        onSelect={() => {}}
      />,
    );
    const [, second] = screen.getAllByRole('option') as [HTMLElement, HTMLElement];
    fireEvent.mouseEnter(second);
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it('calls onSelect with the entry on click', () => {
    const onSelect = vi.fn();
    const entries = [buildEntry({ name: 'a' }), buildEntry({ name: 'b' })];
    render(
      <CompletionDropdown
        entries={entries}
        selectedIndex={0}
        onHover={() => {}}
        onSelect={onSelect}
      />,
    );
    const [, secondButton] = screen.getAllByTestId('completion-entry') as [
      HTMLElement,
      HTMLElement,
    ];
    fireEvent.click(secondButton);
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
  });

  it('uses kind/source classes per entry', () => {
    render(
      <CompletionDropdown
        entries={[
          buildEntry({ name: 'a', kind: 'slash_command', source: 'project' }),
          buildEntry({ name: 'b', kind: 'agent', source: 'plugin' }),
        ]}
        selectedIndex={0}
        onHover={() => {}}
        onSelect={() => {}}
      />,
    );
    const [first, second] = screen.getAllByRole('option') as [HTMLElement, HTMLElement];
    expect(first.className).toContain('section-slash_command');
    expect(first.className).toContain('source-project');
    expect(second.className).toContain('section-agent');
    expect(second.className).toContain('source-plugin');
  });
});
