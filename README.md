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
via an MCP permission proxy). In fake mode you additionally see:
`skill.invoked`, `session.idle`, `session.mode.changed` &mdash; the
fake fixture emits these so the frontend's exhaustive event renderer
stays exercised. The fake fixture also emits a full interactive
permission round-trip on the `/permission-test` sentinel prompt
(mustard pending card → click Allow/Deny/Always → green resolved
card) so developers can iterate on the UI without API spend.

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

## Status

- [x] M1 &mdash; Walking skeleton
- [x] M2 &mdash; Real-CLI integration with stream-json line parser
- [x] M3a &mdash; Subagent + file.changed synthesis, model dropdown, markdown rendering
- [ ] M3b &mdash; Permission round-trip, skill drawer, `--resume` discovery
- [ ] M3c &mdash; Isometric pixel-art rendering (PixiJS or alternative)
- [ ] M4 &mdash; `claude login` OAuth, OBS broadcast mode, session persistence

## Disclaimer

`claudevis` is an independent open-source community project. It is
not affiliated with, endorsed by, or sponsored by Anthropic. The
`claude` CLI it integrates with is provided by Anthropic; please see
Anthropic's own terms for usage of that tool.

## License

[MIT](./LICENSE) &mdash; Copyright (c) 2026 Alper Ekmekci.
