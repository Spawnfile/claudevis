import type { SkillEntry } from '@claudevis/shared';

/**
 * Pure matcher for inline /-completion in PromptBar. Strips an optional
 * leading slash + trims + lowercases the query, then returns case-insensitive
 * name-substring matches preserving the catalog's source order. Empty needle
 * returns the full catalog; null catalog returns [].
 */
export function filterCatalog(catalog: SkillEntry[] | null, query: string): SkillEntry[] {
  if (catalog === null) return [];
  const needle = query.replace(/^\//, '').trim().toLowerCase();
  if (needle === '') return [...catalog];
  return catalog.filter((e) => e.name.toLowerCase().includes(needle));
}
