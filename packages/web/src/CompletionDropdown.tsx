import type { SkillEntry } from '@claudevis/shared';

interface CompletionDropdownProps {
  entries: SkillEntry[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (entry: SkillEntry) => void;
}

/**
 * Pure presentation list for inline /-completion. Uses divs with explicit
 * `role="listbox"`/`role="option"` rather than `<ul>/<li>` so the option
 * wrapper can host an interactive `<button>` child without violating Biome's
 * a11y rules — semantic `<select>/<option>` cannot host arbitrary children.
 *
 * Test-selector contract (used by Vitest + Playwright):
 * - `role="option"` is on the OUTER wrapper div (carries `aria-selected` and
 *   the `onMouseEnter` handler).
 * - `data-testid="completion-entry"` is on the INNER `<button>` (carries the
 *   `onClick` handler and the `data-name` attribute).
 *   The two selectors return DIFFERENT DOM nodes — fire `mouseEnter` against
 *   `getAllByRole('option')` and `click` against `getAllByTestId('completion-entry')`.
 */
export function CompletionDropdown({
  entries,
  selectedIndex,
  onHover,
  onSelect,
}: CompletionDropdownProps) {
  if (entries.length === 0) return null;
  return (
    <div
      className="completion-dropdown"
      data-testid="completion-dropdown"
      id="completion-dropdown"
      // biome-ignore lint/a11y/useSemanticElements: ARIA listbox — no semantic HTML element hosts a button-rich combobox option list
      role="listbox"
      tabIndex={-1}
    >
      {entries.map((entry, index) => {
        const selected = index === selectedIndex;
        const kindClass = `section-${entry.kind ?? 'skill'}`;
        const sourceClass = `source-${entry.source}`;
        const selectedClass = selected ? ' completion-entry-selected' : '';
        return (
          <div
            key={entry.name}
            // biome-ignore lint/a11y/useSemanticElements: ARIA option — must wrap a focusable button child for click-to-select
            role="option"
            aria-selected={selected ? 'true' : 'false'}
            className={`completion-entry ${kindClass} ${sourceClass}${selectedClass}`}
            onMouseEnter={() => onHover(index)}
            tabIndex={-1}
          >
            <button
              type="button"
              tabIndex={-1}
              className="completion-entry-button"
              data-testid="completion-entry"
              data-name={entry.name}
              onClick={() => onSelect(entry)}
            >
              {entry.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
