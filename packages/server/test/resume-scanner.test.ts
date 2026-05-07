import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeProjectDirName,
  defaultProjectsDir,
  scanResumableSessions,
} from '../src/resume-scanner.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudevis-resume-scan-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('decodeProjectDirName', () => {
  it('decodes "-home-user-project" to "/home/user/project"', () => {
    expect(decodeProjectDirName('-home-user-project')).toBe('/home/user/project');
  });

  it('decodes "-tmp-x" to "/tmp/x"', () => {
    expect(decodeProjectDirName('-tmp-x')).toBe('/tmp/x');
  });

  it('returns the original string when no leading dash (defensive)', () => {
    expect(decodeProjectDirName('not-a-path')).toBe('not-a-path');
  });
});

describe('defaultProjectsDir', () => {
  it('returns the user homedir + .claude/projects', () => {
    expect(defaultProjectsDir()).toBe(path.join(os.homedir(), '.claude', 'projects'));
  });
});

describe('scanResumableSessions', () => {
  it('returns empty array when projectsDir does not exist', async () => {
    const result = await scanResumableSessions({
      projectsDir: path.join(tmpRoot, 'nonexistent'),
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when projectsDir is empty', async () => {
    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toEqual([]);
  });

  it('discovers a single jsonl file as a ResumableSession', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-test');
    fs.mkdirSync(cwdDir);
    const jsonlPath = path.join(cwdDir, 'abc-123.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"summary","summary":"my-session"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('abc-123');
    expect(result[0]?.cwd).toBe('/tmp/test');
    expect(result[0]?.lastActiveAt).toBeGreaterThan(0);
  });

  it('extracts model from a system/init line within the first 5 lines', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    const jsonlPath = path.join(cwdDir, 'session-uuid.jsonl');
    fs.writeFileSync(
      jsonlPath,
      '{"type":"summary","leafUuid":"x","summary":"Old chat about widgets"}\n' +
        '{"type":"system","subtype":"init","model":"test-model-x"}\n',
    );

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.model).toBe('test-model-x');
  });

  it('extracts name from summary field on a summary-type line', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    const jsonlPath = path.join(cwdDir, 'session-uuid.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"summary","summary":"Old chat about widgets"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Old chat about widgets');
  });

  it('handles a jsonl file with no metadata gracefully (name and model undefined)', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    const jsonlPath = path.join(cwdDir, 'session-uuid.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"unknown","random":"data"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBeUndefined();
    expect(result[0]?.model).toBeUndefined();
  });

  it('skips same-name directories (e.g., <uuid>/ next to <uuid>.jsonl)', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    fs.mkdirSync(path.join(cwdDir, 'uuid-state-dir'));
    fs.writeFileSync(path.join(cwdDir, 'uuid-state-dir.jsonl'), '{"type":"unknown"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('uuid-state-dir');
  });

  it('sorts results by lastActiveAt descending (newest first)', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);

    const olderPath = path.join(cwdDir, 'older.jsonl');
    fs.writeFileSync(olderPath, '{"type":"x"}\n');
    const past = new Date(Date.now() - 1000 * 60 * 60); // 1h ago
    fs.utimesSync(olderPath, past, past);

    fs.writeFileSync(path.join(cwdDir, 'newer.jsonl'), '{"type":"x"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('newer');
    expect(result[1]?.id).toBe('older');
  });

  it('handles malformed first jsonl line gracefully (does NOT crash)', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    fs.writeFileSync(path.join(cwdDir, 'bad.jsonl'), 'this is not JSON\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('bad');
    expect(result[0]?.model).toBeUndefined();
    expect(result[0]?.name).toBeUndefined();
  });

  it('skips files that are not .jsonl', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    fs.writeFileSync(path.join(cwdDir, 'README.md'), 'docs');
    fs.writeFileSync(path.join(cwdDir, 'real.jsonl'), '{"type":"x"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('real');
  });

  it('discovers jsonl across multiple cwd subdirectories', async () => {
    fs.mkdirSync(path.join(tmpRoot, '-tmp-a'));
    fs.mkdirSync(path.join(tmpRoot, '-tmp-b'));
    fs.writeFileSync(path.join(tmpRoot, '-tmp-a', 's1.jsonl'), '{"type":"x"}\n');
    fs.writeFileSync(path.join(tmpRoot, '-tmp-b', 's2.jsonl'), '{"type":"x"}\n');

    const result = await scanResumableSessions({ projectsDir: tmpRoot });
    expect(result).toHaveLength(2);
    const ids = result.map((s) => s.id).sort();
    expect(ids).toEqual(['s1', 's2']);
    const cwds = result.map((s) => s.cwd).sort();
    expect(cwds).toEqual(['/tmp/a', '/tmp/b']);
  });
});
