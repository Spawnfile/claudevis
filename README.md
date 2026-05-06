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

The current release is the M1 walking skeleton: end-to-end working
with a fake echo subprocess so you can exercise the contract without
the real CLI installed. Real-CLI integration arrives in M2.

## Requirements

| Tool   | Minimum version |
|--------|-----------------|
| Bun    | 1.1             |
| pnpm   | 9               |
| Node   | 20              |
| Git    | any modern      |

Optional (only needed once M2 lands):

- `claude` CLI on your `PATH`, signed in via `claude login`.

## Install

```bash
git clone https://github.com/claudevis-app/claudevis.git
cd claudevis
pnpm install
```

`pnpm install` resolves the three workspace packages and pulls
dependencies. The first install also downloads Bun's native sqlite
binding through pnpm's lifecycle scripts.

## Run (development)

```bash
./scripts/dev.sh
```

This boots two processes:

- The Bun server on `http://localhost:7878` (WebSocket at `/v1`).
- Vite on `http://localhost:5173`, which proxies `/v1` to the server
  so the browser uses a single same-origin port.

Open `http://localhost:5173/` in your browser.

By default the server runs in **fake mode**
(`CLAUDEVIS_FAKE_CLAUDE=1`): every prompt produces a scripted scene
that exercises the full event vocabulary (thinking → tool calls →
subagent dispatch → file changes → token usage → agent message). This
is what you see today.

## Tests

```bash
pnpm test                                  # all unit tests (3 packages)
pnpm typecheck                             # type-check all packages
pnpm --filter @claudevis/web test:e2e      # Playwright end-to-end tests
```

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

- [x] M1 &mdash; Walking skeleton (this release)
- [ ] M2 &mdash; Real-CLI integration with stream-json line parser
- [ ] M3 &mdash; Isometric pixel-art rendering with PixiJS
- [ ] M4 &mdash; Permissions, skill drawer, OBS broadcast mode

## Disclaimer

`claudevis` is an independent open-source community project. It is
not affiliated with, endorsed by, or sponsored by Anthropic. The
`claude` CLI it integrates with is provided by Anthropic; please see
Anthropic's own terms for usage of that tool.

## License

[MIT](./LICENSE) &mdash; Copyright (c) 2026 Alper Ekmekci.
