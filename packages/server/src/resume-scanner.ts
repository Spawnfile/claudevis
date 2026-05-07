import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResumableSession } from '@claudevis/shared';

/**
 * Decode an encoded project directory name back to its absolute cwd.
 * claude CLI encodes cwds as `cwd.replaceAll('/', '-')`. We reverse it
 * by replacing each `-` with `/`. Edge case: paths containing literal
 * hyphens are ambiguous (e.g., `/home/foo-bar/baz` and `/home/foo/bar/baz`
 * both encode to `-home-foo-bar-baz`). M3b.3 accepts this ambiguity and
 * documents it; M4 may revisit by reading the cwd from jsonl content.
 */
export function decodeProjectDirName(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  return encoded.replaceAll('-', '/');
}

/**
 * Default projects directory. claude CLI persists session metadata under
 * `~/.claude/projects/`. Override at startup via the `CLAUDEVIS_PROJECTS_DIR`
 * env var (handled by index.ts).
 */
export function defaultProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

interface MetadataExtract {
  name?: string;
  model?: string;
}

/**
 * Read the first ~5 lines of a jsonl file and extract `name` and `model`
 * if any line carries them. Defensive: malformed JSON lines are silently
 * skipped; a file with no recognizable metadata returns {}.
 *
 * Field heuristics (subject to claude CLI version drift):
 * - `name`: a `summary` field on a `{type:"summary"}` line.
 * - `model`: a `model` field on a `{type:"system",subtype:"init"}` line.
 */
function extractMetadata(jsonlPath: string): MetadataExtract {
  let content = '';
  try {
    content = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return {};
  }
  const lines = content.split('\n').slice(0, 5);
  const out: MetadataExtract = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (out.name === undefined && obj.type === 'summary' && typeof obj.summary === 'string') {
      out.name = obj.summary;
    }
    if (
      out.model === undefined &&
      obj.type === 'system' &&
      obj.subtype === 'init' &&
      typeof obj.model === 'string'
    ) {
      out.model = obj.model;
    }
    if (out.name !== undefined && out.model !== undefined) break;
  }
  return out;
}

export interface ScanOpts {
  projectsDir: string;
}

/**
 * Scan the projects directory for session jsonl files, extract metadata,
 * and return a ResumableSession[] sorted by lastActiveAt descending. Pure
 * function — no global IO; the caller passes projectsDir explicitly.
 *
 * Returns empty array when projectsDir does not exist or is empty.
 */
export async function scanResumableSessions(opts: ScanOpts): Promise<ResumableSession[]> {
  const { projectsDir } = opts;
  if (!fs.existsSync(projectsDir)) return [];

  const result: ResumableSession[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = path.join(projectsDir, entry);
    let entryStat: fs.Stats;
    try {
      entryStat = fs.statSync(entryPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    const cwd = decodeProjectDirName(entry);
    let files: string[];
    try {
      files = fs.readdirSync(entryPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const jsonlPath = path.join(entryPath, file);
      let st: fs.Stats;
      try {
        st = fs.statSync(jsonlPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const id = file.slice(0, -'.jsonl'.length);
      const meta = extractMetadata(jsonlPath);
      result.push({
        id,
        cwd,
        name: meta.name,
        model: meta.model,
        lastActiveAt: st.mtimeMs,
      });
    }
  }

  result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return result;
}
