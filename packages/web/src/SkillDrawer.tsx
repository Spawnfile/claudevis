import type { SkillEntry } from '@claudevis/shared';
import { useState } from 'react';
import { useConnection } from './store/connection.js';

type SkillKind = NonNullable<SkillEntry['kind']>;

const KIND_LABELS: Record<SkillKind, string> = {
  slash_command: 'Slash Commands',
  skill: 'Skills',
  agent: 'Agents',
};

const KIND_ORDER: readonly SkillKind[] = ['slash_command', 'skill', 'agent'] as const;

export function SkillDrawer() {
  const catalog = useConnection((s) => s.catalog);
  const setPrefix = useConnection((s) => s.setPendingPromptPrefix);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const onClickEntry = (entry: SkillEntry) => {
    setPrefix(`/${entry.name} `);
  };

  const needle = filter.toLowerCase();
  const filtered = (catalog ?? []).filter(
    (e) => needle.length === 0 || e.name.toLowerCase().includes(needle),
  );

  const grouped: Record<SkillKind, SkillEntry[]> = {
    slash_command: [],
    skill: [],
    agent: [],
  };
  for (const entry of filtered) {
    if (entry.kind) grouped[entry.kind].push(entry);
  }

  return (
    <div className="skill-drawer">
      <button type="button" className="skill-drawer-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▼' : '▶'} Skills
        {catalog ? ` (${catalog.length})` : ''}
      </button>
      {open && (
        <div className="skill-drawer-body">
          {catalog === null ? (
            <div className="skill-drawer-empty">Create a session to load available skills.</div>
          ) : catalog.length === 0 ? (
            <div className="skill-drawer-empty">No skills loaded.</div>
          ) : (
            <>
              <input
                type="text"
                className="skill-drawer-filter"
                placeholder="Filter by name..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {KIND_ORDER.map((kind) =>
                grouped[kind].length > 0 ? (
                  <section key={kind} className={`skill-drawer-section section-${kind}`}>
                    <h4 className="skill-drawer-section-title">{KIND_LABELS[kind]}</h4>
                    <ul className="skill-drawer-list">
                      {grouped[kind].map((entry) => (
                        <li
                          key={entry.name}
                          className={`skill-drawer-entry source-${entry.source}`}
                        >
                          <button
                            type="button"
                            className="skill-drawer-entry-button"
                            onClick={() => onClickEntry(entry)}
                          >
                            {entry.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null,
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
