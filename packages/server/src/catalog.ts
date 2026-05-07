import type { SkillEntry } from '@claudevis/shared';

export interface RawCatalog {
  skills: unknown[];
  slash_commands: unknown[];
  agents: unknown[];
  plugins: Array<Record<string, unknown>>;
}

/**
 * Build a flat SkillEntry[] from the raw arrays in claude's system/init line.
 * Names with a "<plugin-name>:<rest>" prefix matching a plugins[] entry get
 * source='plugin'; everything else defaults to source='user'. Description
 * and path are left empty in M3b.2 — claude's system/init does not carry that
 * metadata; richer fields wait for a future filesystem scan (M3c/M4).
 */
export function buildSkillEntries(raw: RawCatalog): SkillEntry[] {
  const pluginNames = new Set<string>();
  for (const p of raw.plugins ?? []) {
    if (p !== null && typeof p === 'object' && typeof p.name === 'string') {
      pluginNames.add(p.name);
    }
  }

  const inferSource = (name: string): SkillEntry['source'] => {
    const colonIdx = name.indexOf(':');
    if (colonIdx <= 0) return 'user';
    const prefix = name.slice(0, colonIdx);
    return pluginNames.has(prefix) ? 'plugin' : 'user';
  };

  const buildEntries = (
    arr: unknown[] | undefined,
    kind: 'skill' | 'slash_command' | 'agent',
  ): SkillEntry[] => {
    const out: SkillEntry[] = [];
    for (const item of arr ?? []) {
      if (typeof item !== 'string') continue;
      out.push({
        name: item,
        description: '',
        path: '',
        source: inferSource(item),
        kind,
      });
    }
    return out;
  };

  return [
    ...buildEntries(raw.skills, 'skill'),
    ...buildEntries(raw.slash_commands, 'slash_command'),
    ...buildEntries(raw.agents, 'agent'),
  ];
}

/**
 * Build a Set of all entry names for fast membership checks during
 * skill.invoked synthesis on user prompts.
 */
export function extractInvokableNames(entries: SkillEntry[]): Set<string> {
  return new Set(entries.map((e) => e.name));
}
