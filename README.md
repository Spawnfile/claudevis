<p align="center">
  <img src=".github/assets/hero.png" alt="claudevis — a lantern-bearing figure standing on an isometric moonlit checkerboard, stars overhead" width="480" />
</p>

<h1 align="center">claudevis</h1>

<p align="center"><em>An isometric pixel-art GUI for the <code>claude</code> agentic CLI &mdash; a moonlit watchtower over your sessions, tools, subagents, and token spend.</em></p>

<p align="center">
  <a href="https://www.claudevis.com">claudevis.com</a> &nbsp;·&nbsp;
  <a href="./packages/landing/lore/lore.md">Bestiarium claudevisi</a> &nbsp;·&nbsp;
  <a href="#status">Status</a> &nbsp;·&nbsp;
  <a href="#run-development">Run</a>
</p>

---

## What this is

`claudevis` wraps the upstream `claude` command in a browser-based graphical client. Instead of a terminal scrollback you get a tiny moonlit village: each active session becomes a model-tinted villager standing on a grass tile, every tool call lights an icon at their side, every subagent dispatch pulls a child villager out of a glowing summon ring, and every dollar of token spend dims a stamina bar above their head.

It is a **single-user, dev-time tool** &mdash; designed for one developer, one machine, one local browser. It is not a hosted product, not a streaming overlay, not a multi-tenant dashboard.

The frontend talks to a small Bun WebSocket server that lives on `127.0.0.1`. The server spawns the real `claude` binary (or a synthetic fake fixture for UI iteration), parses its stream-json output line by line, persists every event to a local SQLite store for replay, and broadcasts the canonical Event union to the browser. The browser draws the village in PixiJS and the chat in React.

## The village, briefly

claudevis renders the same lore the landing site documents in [`packages/landing/lore/lore.md`](./packages/landing/lore/lore.md). A handful of named characters do all the work:

| In the village | In the CLI |
|---|---|
| **The Light-Footed** &mdash; rye-bread runner | Claude Haiku |
| **The Steady Hand** &mdash; gate-counter | Claude Sonnet |
| **The Elder** &mdash; rare, gold-cloaked | Claude Opus |
| **The Headstrong / Cartographer / Trusting / Wary** | `auto` / `plan` / `autoAccept` / `strict` permission modes |
| **The Forge / Cartographer's Eye / Chisel / Quill / Hound** | Bash / Read / Edit / Write / Grep |
| **The Summon** &mdash; a ring of light beneath the western tower | Subagent dispatch (the `Task` tool) |
| **The Reeve / Architect / Apprentice Proper / Smithy's Aide / Sheriff / Wanderer** | `code-reviewer`, `planner`, `tdd-guide`, `build-error-resolver`, `security-reviewer`, `researcher` agents |

When you spawn a session, a villager walks onto the grass. When the model thinks, a thought-cloud floats above. When it speaks, a parchment glyph drifts up. When a tool runs, the matching lore-locked icon attaches to the villager's right side. When a subagent is summoned, the ring carves itself into the flagstones and a smaller villager appears inside it. When a permission is requested, a sigil is raised; when it resolves, the sigil flashes green or red. When the session falls quiet for thirty seconds, the villager's idle bob slows and the stamina bar dims.

Hover any villager and a parchment cost tooltip rises with cumulative tokens (input / output / cached), total USD spend, and the cost of the last message.

## How it actually works

```
                 ┌─────────────────────────────────────────────────────────┐
                 │                      browser (Vite)                     │
                 │  ┌────────────┐   ┌────────────┐   ┌─────────────────┐  │
                 │  │ SessionList│   │   Chat /   │   │  PixiJS scene   │  │
                 │  │ + Skills   │   │ Streaming  │   │  + dom-mirror   │  │
                 │  │ + Resumable│   │ Markdown   │   │  + cost tooltip │  │
                 │  └────────────┘   └────────────┘   └─────────────────┘  │
                 │            └─────────── Zustand store ─────────┘        │
                 │                            │                            │
                 │                       WebSocket /v1                     │
                 └────────────────────────────┼────────────────────────────┘
                                              │
                 ┌────────────────────────────┼────────────────────────────┐
                 │                  Bun server (127.0.0.1:7878)            │
                 │   command-router  ⇄  session-manager  ⇄  event-store    │
                 │                            │                  (SQLite)  │
                 │                       spawnSubprocess                   │
                 └────────────────────────────┼────────────────────────────┘
                                              │
                 ┌────────────────────────────┼────────────────────────────┐
                 │     claude CLI  (--output-format stream-json)           │
                 │     OR  fake fixture  (CLAUDEVIS_FAKE_CLAUDE=1)         │
                 └─────────────────────────────────────────────────────────┘
```

The wire protocol is frozen at v1 and lives in `packages/shared`:

- **13 Event variants** &mdash; `session.started/ended/idle/mode.changed`, `user.prompt`, `agent.thinking/message`, `tool.started/completed`, `subagent.dispatched/completed`, `tokens.updated`, `file.changed`, `permission.requested/resolved`, `skill.invoked`, `interrupt.signaled`, `error`.
- **12 Command variants** &mdash; `session.create/send/interrupt/clear/kill/setMode`, `permission.respond`, `skill.list/run/install`, `subscribe`, `settings.checkClaude/runLogin`.
- **6 ServerFrame variants** &mdash; `hello`, `event`, `replay.done`, `settings.status`, `skill.catalog`, `session.resumable`.

Both ends share the same TypeScript types and Zod schemas. Adding a new event variant requires touching all five layers (parser → session-manager → event-store → event-mapper → scene), which keeps the contract honest.

The server's parser converts upstream stream-json line-by-line into Event variants:

- `Edit` / `Write` / `MultiEdit` / `NotebookEdit` tool results emit `file.changed` alongside `tool.completed` (additive). Real `+N -M` line counts come from `git diff --numstat HEAD -- <path>` shelled from the session's cwd, with a 1s timeout and `0/0` fallback when the file is not tracked.
- `Agent` tool calls emit `subagent.dispatched` and replace the plain `tool.started`. The matching tool result emits `subagent.completed`.
- `permission_denials[]` on the final result line synthesizes `permission.requested` + `permission.resolved` pairs with `requestId` prefixed `auto-deny-`. The UI renders these as read-only red cards. True interactive Allow/Deny/Always round-trip is fake-mode only and waits for a future MCP-based permission proxy.
- `system/init` payloads broadcast a `skill.catalog` ServerFrame so the sidebar drawer can render every available skill, slash command, and agent.
- A per-session idle timer in the session manager fires `session.idle` after `CLAUDEVIS_IDLE_MS` (default 30s) of subprocess silence. Latched: exactly one idle event per quiet stretch.
- `session.mode.changed` is emitted from the `Command<'session.create'>.mode` field immediately after `session.started`. Mid-session swap requires upstream CLI cooperation that v1 does not assume.

The browser's event-mapper is a pure function: `Event → Mutation[]`. The PixiJS scene applies mutations in order, the dom-mirror writes a parallel set of `data-scene-*` attributes for Playwright, and React's chat lane renders the same events as a Markdown stream.

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

`pnpm install` resolves the four workspace packages and pulls dependencies. The first install also downloads Bun's native sqlite binding through pnpm's lifecycle scripts.

## Run (development)

### Real mode (default)

Talks to the local `claude` binary. Two terminals:

```bash
# terminal 1: Bun server on :7878 (WebSocket at /v1), real claude
pnpm --filter @claudevis/server dev

# terminal 2: Vite on :5173
pnpm --filter @claudevis/web dev
```

Open `http://localhost:5173/` in your browser. Click "+ New Session", fill the small inline form (cwd, name, model — sonnet by default), and the first villager walks onto the grass. Tilde paths like `~/projects/my-repo` are expanded server-side.

### Fake mode (no API spend)

```bash
./scripts/dev.sh
```

`scripts/dev.sh` boots both processes with `CLAUDEVIS_FAKE_CLAUDE=1`. Every prompt produces a scripted scene that exercises the full event vocabulary (thinking → tool calls → subagent dispatch → file changes → token usage → agent message). Sentinel prompts:

- `/permission-test` &mdash; full interactive permission round-trip (mustard pending card → click Allow/Deny/Always → green resolved card).
- `/mode-test <mode>` &mdash; mid-session mode swap; the villager's mode-icon flips.
- `/stream-test` &mdash; streaming `agent.message` chunks converge into a single chat row.
- `/big-tool-test` &mdash; long tool I/O collapses behind a `<details>` toggle.

Use this for UI iteration and screenshot work without consuming tokens.

## A typical session

1. Spawn a session. The Steady Hand (sonnet, default) walks onto the grass; the cost tooltip appears empty.
2. Type a prompt. A parchment glyph rises above the villager.
3. The model thinks; a thought cloud floats up. The Forge / Chisel / Quill / Hound icon attaches to the villager's right side as tools run; it retracts when each finishes.
4. If the model dispatches a subagent, the western flagstones light up with a summon ring and a smaller villager (Reeve, Architect, etc.) appears inside it. When the subagent finishes, the child fades and the ring closes.
5. File edits float a small archive sprite to the bottom-right with a `+N -M` label.
6. The cost tooltip on hover shows token spend climbing in real time.
7. Type `/` in the prompt input to open a parchment dropdown of every skill, slash command, and agent in your catalog. ArrowDown / ArrowUp cycle, Enter or Tab select, Esc closes.
8. Press the ⏹ button to interrupt mid-stream; the villager shakes once.
9. Reload the page &mdash; the villager and history come back from SQLite. Sessions that have already ended do not re-render as shadow villagers.

## Status

claudevis ships in milestones. Every milestone is a single squash commit on `main`.

- [x] M1 &mdash; Walking skeleton (server + frontend + frozen v1 protocol)
- [x] M2 &mdash; Real-CLI integration with stream-json line parser
- [x] M3a &mdash; Subagent + file.changed synthesis, model dropdown, markdown rendering
- [x] M3b &mdash; Auto-deny permission synthesis, skill drawer, `--resume` discovery
- [x] M3c &mdash; Isometric scene grammar (NPCs, sigils, glyphs, lore-locked tool icons, animations)
- [x] M4.1 &mdash; Replay zombie filter + idle/mode-change vocabulary closure
- [x] M4.2 &mdash; Chat ergonomics (streaming render, real diff math, syntax highlight, tool collapse, cost tooltip)
- [x] M4.3 &mdash; Inline `/`-completion in PromptBar

After M4.3 the daily-driver feature set is closed. Future work is observation-driven, not roadmap-driven.

## What v1 does *not* do (yet)

Honest deferrals so you know what to expect.

- **Real-mode interactive permission consent** &mdash; stream-json mode does not carry an interactive permission channel. claudevis surfaces auto-denied permissions as read-only red cards; the full Allow/Deny/Always loop only works in fake mode. A future MCP-based permission proxy is the most likely path forward.
- **`claude login` from inside the GUI** &mdash; run `claude login` in your terminal once. The GUI assumes you are already signed in.
- **Skill installation from inside the GUI** &mdash; `Command<'skill.install'>` is in the protocol but stubbed; use `claude /install <skill>` from your terminal.
- **`skill.run` real-mode wiring** &mdash; the `/<skillname>` Enter path already covers the daily flow; an explicit invocation route waits for a probe.
- **Cmd-K command palette** &mdash; the sidebar drawer plus inline `/`-completion are sufficient for a 1–5 session workflow.
- **Settings overlay** &mdash; `CLAUDEVIS_IDLE_MS`, `CLAUDEVIS_DB`, and `CLAUDEVIS_PROJECTS_DIR` env vars cover today's needs.
- **Mid-session mode swap via `session.setMode`** &mdash; requires upstream CLI support that v1 does not assume.
- **OBS broadcast / streamer overlay mode** &mdash; explicitly out of scope. claudevis is a personal dev-time tool.
- **Multi-user / hosted deployment** &mdash; the WebSocket binds to `127.0.0.1` and has no authentication. See **Security** below.

## Security

claudevis is built for a single developer on a single machine.

- The WebSocket server binds to `127.0.0.1` only. It is not reachable from the LAN by default.
- There is **no authentication** on the WebSocket. Any local process that can open a socket to `127.0.0.1:7878` can drive your `claude` sessions, read your history, and incur API spend on your account.
- Do **not** run claudevis on a multi-tenant box, a shared remote dev environment, or behind a port-forward you have not reasoned about. If you must, front it with your own auth proxy.
- The local SQLite event store (`packages/server/claudevis.sqlite` by default, overridable via `CLAUDEVIS_DB`) contains your prompt history and tool calls in plaintext. Treat it like your shell history.
- The `~/.claude/projects/` filesystem scan only reads metadata (session UUID, cwd, model, summary lines) &mdash; it never sends content over the wire on its own.
- Real-CLI probe captures (`packages/server/test/fixtures/real-claude-captures/`) embed developer-local paths and session content; the directory is gitignored. Each contributor regenerates them locally with `CLAUDEVIS_RUN_REAL=1 pnpm --filter @claudevis/server test`.

## Tests

```bash
pnpm test                                  # all unit tests (3 packages)
pnpm typecheck                             # type-check all packages
pnpm lint                                  # biome check
pnpm --filter @claudevis/web test:e2e      # Playwright e2e (fake mode)
```

Real-mode end-to-end (token spend &mdash; gated):

```bash
CLAUDEVIS_RUN_REAL=1 \
  pnpm --filter @claudevis/web test:e2e e2e/real-claude.spec.ts
```

Real-CLI probe (refreshes local fixtures):

```bash
CLAUDEVIS_RUN_REAL=1 pnpm --filter @claudevis/server test
```

**Cost-discipline note:** real-mode probes should pin `--model sonnet` in their spawn args. Higher-tier models are significantly more expensive per call, especially with extended context windows.

## Layout

```
claudevis/
├── packages/
│   ├── shared/    # frozen v1 protocol — Event/Command/ServerFrame + Zod schemas
│   ├── server/    # Bun WebSocket server, parser, session-manager, event-store
│   ├── web/       # Vite + React frontend, PixiJS scene, Zustand store
│   └── landing/   # marketing site (claudevis.com) + lore.md
├── scripts/
│   └── dev.sh     # boots server + web together in fake mode
├── .github/
│   └── assets/    # repo-level images (this README's hero)
├── package.json   # pnpm workspace root
└── README.md
```

## Configuration

Environment variables read at server boot:

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDEVIS_FAKE_CLAUDE` | unset | Set to `1` to use the synthetic fake fixture instead of the real `claude` binary. |
| `CLAUDEVIS_IDLE_MS` | `30000` | Subprocess-silence threshold before `session.idle` fires. Set `0` to disable. |
| `CLAUDEVIS_DB` | `./claudevis.sqlite` | Path to the SQLite event store. |
| `CLAUDEVIS_PROJECTS_DIR` | `~/.claude/projects` | Where to scan for resumable sessions. |
| `CLAUDEVIS_DEBUG` | unset | Set to `1` to log every parsed event line and emit on the server. |
| `CLAUDEVIS_RUN_REAL` | unset | Set to `1` to enable gated real-mode tests. |

## Contributing

claudevis is built around a few hard rules:

- **Frozen v1 protocol.** Adding an Event/Command/ServerFrame variant requires touching all five layers (parser → session-manager → event-store → event-mapper → scene) in the same change.
- **Sub-milestones squash on `main`.** Each `M*` is one commit. No feature branches; no merge commits in the public history.
- **Fake-mode coverage first.** New event variants must be exercisable from `packages/server/test/fixtures/echo-claude.ts` so e2e and UI iteration never need API spend.
- **No new lore colors without a 4-way palette sync.** A new tone lands in `styles.css :root`, `theme.ts PALETTE`, `lore-colors.ts`, and `landing/lore/lore.md` in the same commit.
- **Write tests first.** Strict TDD on pure functions; component tests for React; Playwright for user-visible flows.

## Disclaimer

`claudevis` is an unofficial, community-built GUI for **Claude Code**. It is not affiliated with, endorsed by, or sponsored by **Anthropic, PBC**. **Claude** is a trademark of Anthropic, PBC. The `claude` CLI that claudevis integrates with is provided by Anthropic; please see Anthropic's own terms of service and acceptable use policy for usage of that tool.

claudevis does not redistribute Anthropic software, model weights, or proprietary content. It is a thin client over the public stream-json output of the `claude` CLI that you install and authenticate independently.

## License

[MIT](./LICENSE) &mdash; Copyright (c) 2026 Alper Ekmekci.
