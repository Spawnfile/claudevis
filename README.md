# claudevis

> An isometric pixel-art GUI for the `claude` agentic CLI.

`claudevis` wraps the upstream `claude` command in a browser-based
graphical client so you can drive sessions, watch tool calls, follow
subagent dispatches, and review token usage from a small in-game
"village" instead of a terminal.

This repository ships:

- **`packages/server`** &mdash; a Bun WebSocket server that spawns `claude`
  subprocesses, parses their stream-json output, and persists every
  event in SQLite for replay.
- **`packages/web`** &mdash; a Vite + React frontend that connects to the
  server and renders sessions, prompts, tool calls, subagent
  dispatches, file changes, token spend, and permission requests.
- **`packages/shared`** &mdash; the typed Event/Command protocol shared
  by both ends, with Zod schemas for runtime validation.
- **`packages/landing`** &mdash; the marketing/landing site served at
  `claudevis.com` (independent of the runtime).

The current release is M2: real-CLI integration over `--output-format
stream-json --input-format stream-json --verbose`. A fake-fixture mode
remains available for UI iteration and contract self-testing without
spawning the real CLI.

## Requirements

| Tool   | Minimum version |
|--------|-----------------|
| Bun    | 1.1             |
| pnpm   | 9               |
| Node   | 20              |
| Git    | any modern      |

Required for real mode (default):

- `claude` CLI on your `PATH` (v2.1.131+), signed in via `claude login`.

Fake mode does not require the `claude` binary.

## Install

```bash
git clone https://github.com/Spawnfile/claudevis.git
cd claudevis
pnpm install
```

`pnpm install` resolves the three workspace packages and pulls
dependencies. The first install also downloads Bun's native sqlite
binding through pnpm's lifecycle scripts.

## Run (development)

### Real mode (default)

Talks to the local `claude` binary. Two terminals:

```bash
# terminal 1: Bun server on :7878 (WebSocket at /v1), real claude
pnpm --filter @claudevis/server dev

# terminal 2: Vite on :5173
pnpm --filter @claudevis/web dev
```

Open `http://localhost:5173/` in your browser. Requires `claude` on
PATH and `claude login` already run.

The first time you click "+ New Session" the sidebar opens a small form
asking for cwd, session name, and model (sonnet / opus / haiku, default
sonnet). Tilde paths like `~/projects/my-repo` are expanded server-side.
Agent messages and thinking blocks render as GitHub-flavored markdown
(bold, italics, lists, code fences, tables, autolinks).

### Fake mode (no token cost)

```bash
./scripts/dev.sh
```

`scripts/dev.sh` boots both processes with `CLAUDEVIS_FAKE_CLAUDE=1`,
so every prompt produces a scripted scene that exercises the full
event vocabulary (thinking → tool calls → subagent dispatch → file
changes → token usage → agent message). Use this for UI iteration
and screenshot work without consuming API tokens.

### What real mode emits vs fake mode

The real `claude` CLI does not surface every event type the protocol
supports. In real mode you will see: `session.started`,
`agent.message`, `agent.thinking`, `tool.started`, `tool.completed`,
`subagent.dispatched`, `subagent.completed`, `file.changed`,
`tokens.updated`, `error`, plus the locally-emitted `user.prompt`,
`interrupt.signaled`, `session.ended`. M3b.1 also synthesizes
`permission.requested` + `permission.resolved` from the
`permission_denials[]` array on the final `result` line — these
arrive AFTER the failed tool, with a `requestId` prefixed
`auto-deny-` and `decision: 'deny'`. The UI renders them as a
read-only red "🚫 Permission denied (auto)" card. Stream-json mode
does not carry interactive permission consent; true Allow/Deny/Always
round-trip is fake-mode only and waits for a future milestone (likely
via an MCP permission proxy). M3b.2 added the skill drawer: claude's `system/init` payload feeds a
toggleable sidebar listing every available skill, slash command, and
agent (names only — descriptions and paths wait for a future
filesystem-scan milestone). Clicking an entry prepends `/<name> `
into the prompt input; sending the prompt fires `skill.invoked`
before `user.prompt`. Both real and fake modes participate. In fake
mode you additionally see `session.idle` and `session.mode.changed`
&mdash; the fake fixture emits these so the frontend's exhaustive
event renderer stays exercised. The fake fixture also emits a full
interactive permission round-trip on the `/permission-test` sentinel
prompt (mustard pending card → click Allow/Deny/Always → green
resolved card) and a hardcoded test catalog at startup so developers
can iterate on the drawer UI without API spend.

M3b.3 added the resumable session list: claudevis scans
`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` on subscribe and the
sidebar shows a collapsible "Resumable" section with previously-recorded
sessions for this user (sorted newest-first; name + model extracted from
the jsonl when present). Clicking a resumable entry restarts that
session via `claude --resume <id>`, restoring its history. The projects
directory location is overridable via the `CLAUDEVIS_PROJECTS_DIR`
environment variable (default `~/.claude/projects/`).

**Cost-discipline note:** real-mode probes (gated tests under
`CLAUDEVIS_RUN_REAL=1`) should pin `--model sonnet` in their spawn
args to keep API spend predictable. Higher-tier models can be
significantly more expensive per call, especially with extended
context windows.

## Tests

```bash
pnpm test                                  # all unit tests (3 packages)
pnpm typecheck                             # type-check all packages
pnpm lint                                  # biome check
pnpm --filter @claudevis/web test:e2e      # Playwright e2e (fake mode)
```

### Real-mode end-to-end (gated)

```bash
CLAUDEVIS_RUN_REAL=1 \
  pnpm --filter @claudevis/web test:e2e e2e/real-claude.spec.ts
```

Boots the server in real mode and drives the browser against the
actual `claude` binary. Skipped by default to avoid token spend.

### Real-CLI probe (refresh local fixtures)

```bash
CLAUDEVIS_RUN_REAL=1 pnpm --filter @claudevis/server test
```

Runs three scenarios (`greeting`, `tool-read`, `error`) against
`claude` and writes captured NDJSON to
`packages/server/test/fixtures/real-claude-captures/`. That directory
is gitignored &mdash; the captures embed developer-local paths and
session content from `~/.claude/`, so each contributor regenerates
them locally. The parser's fixture-replay tests skip gracefully when
the directory is empty.

## Layout

```
claudevis/
├── packages/
│   ├── shared/    # protocol types + Zod schemas
│   ├── server/    # Bun WebSocket server
│   ├── web/       # Vite + React frontend
│   └── landing/   # marketing site
├── scripts/
│   └── dev.sh     # boots server + web together
├── package.json   # pnpm workspace root
└── README.md
```

### Scene panel (M3c.1)

The web UI shows an isometric scene panel above the chat lane. Each active
session is rendered as a model-tinted villager NPC standing on a grass tile.
A cumulative-USD stamina bar (5 log-scale segments at $0.10 / $0.20 / $0.40
/ $0.80 / $1.60) sits above each NPC and updates from `tokens.updated` events.

Layout: SessionList sidebar | Scene + Chat (split vertically) | PromptBar at
the bottom. Theme is locked to the landing site's moonlit palette (deep
indigo / torch amber / ember red / parchment cream) with Cinzel serif
headings, Inter Tight body, and JetBrains Mono code/labels.

Subsequent M3c sub-milestones add the full scene grammar (subagent dispatch,
permission sigils, file-fly glyphs, lore-locked tool icons) and animations.

### Chat ergonomics (M4.2)

Streaming `agent.message` chunks collapse into a single converging row
(`/stream-test` in fake mode exercises the path). `file.changed` rows show
real `+N -M` line counts via `git diff --numstat` shelled from the session
cwd (bounded 1s timeout, fallback to 0/0 on failure) — surfaced both as a
chat-row badge and as a fly-by label on the scene's file archive sprite.
Markdown code fences are syntax-highlighted with Shiki (`github-dark`
theme, lazy-loaded so first paint isn't blocked). Tool I/O JSON longer
than 500 chars collapses behind a `<details>` toggle. Hovering an NPC in
the scene shows a parchment cost tooltip with cumulative tokens
(input / output / cached), total cost USD, and last-message cost.

## Status

- [x] M1 &mdash; Walking skeleton
- [x] M2 &mdash; Real-CLI integration with stream-json line parser
- [x] M3a &mdash; Subagent + file.changed synthesis, model dropdown, markdown rendering
- [x] M3b &mdash; Permission round-trip, skill drawer, `--resume` discovery
- [x] M3c &mdash; Isometric scene grammar — NPCs, sigils, glyphs, tool icons, animations
- [x] M4.2 &mdash; Chat ergonomics — streaming render, diff math, syntax highlight, tool collapse, cost tooltip
- [ ] M4.3 &mdash; Inline `/`-completion in PromptBar (Cmd-K palette + `skill.run` deferred)

## Disclaimer

`claudevis` is an independent open-source community project. It is
not affiliated with, endorsed by, or sponsored by Anthropic. The
`claude` CLI it integrates with is provided by Anthropic; please see
Anthropic's own terms for usage of that tool.

## License

[MIT](./LICENSE) &mdash; Copyright (c) 2026 Alper Ekmekci.
