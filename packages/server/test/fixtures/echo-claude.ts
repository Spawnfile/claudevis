#!/usr/bin/env bun
// Fake claude for tests. Exercises the FULL Event vocabulary from spec §4
// so the contract is proven end-to-end before real claude is wired up.
// For each ordinary user.prompt it emits a representative scripted scene:
//   agent.thinking → tool.started/completed → subagent.dispatched/
//   completed → file.changed → tokens.updated → agent.message
//
// M3b.1 also adds a `/permission-test` sentinel prompt that emits a
// `permission.requested` Event and waits for the host to write a
// `permission_response` line back on stdin (driven by
// SessionManager.respondToPermission); on response, emits the matching
// `permission.resolved` Event.

const stdin = process.stdin;
let buffer = '';

const emit = (obj: unknown) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

emit({ type: 'session.started', name: 'fake', cwd: process.cwd(), model: 'fake-model' });
// M3b.2: emit a system/init-shaped catalog so SessionManager's fake-mode
// handler populates the drawer. Mirrors the real CLI's wire shape so the
// end-to-end skill.invoked + catalog flow works without API spend.
emit({
  type: 'system',
  subtype: 'init',
  skills: ['plugin-a:test-skill'],
  slash_commands: ['plugin-a:test-cmd'],
  agents: ['test-agent'],
  plugins: [{ name: 'plugin-a', path: '/fake/plugin-a', source: 'fake' }],
});

let counter = 0;
const next = () => `c-${++counter}`;
const pendingRequests = new Set<string>();

stdin.setEncoding('utf8');
stdin.on('data', async (chunk) => {
  buffer += chunk;
  for (let idx = buffer.indexOf('\n'); idx >= 0; idx = buffer.indexOf('\n')) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as {
        type: string;
        content?: string;
        request_id?: string;
        decision?: string;
      };

      // M3b.1: SessionManager.respondToPermission writes lines of this shape.
      // When the request_id matches a tracked sentinel-emitted permission, emit
      // the matching permission.resolved Event and clear the tracking entry.
      if (msg.type === 'permission_response') {
        if (typeof msg.request_id === 'string' && pendingRequests.has(msg.request_id)) {
          const decision =
            msg.decision === 'allow' || msg.decision === 'deny' || msg.decision === 'always'
              ? msg.decision
              : 'deny';
          await sleep(5);
          emit({
            type: 'permission.resolved',
            requestId: msg.request_id,
            decision,
          });
          pendingRequests.delete(msg.request_id);
        }
        continue;
      }

      if (msg.type !== 'user.prompt') continue;
      const text = msg.content ?? '';

      // M4.1 sentinel: mid-session mode change. /mode-test <mode> emits a
      // session.mode.changed Event with the requested mode (default 'plan').
      // Used by E2E to assert mode-icon swap.
      if (text.startsWith('/mode-test')) {
        const arg = text.slice('/mode-test'.length).trim();
        const mode =
          arg === 'auto' || arg === 'plan' || arg === 'autoAccept' || arg === 'strict'
            ? arg
            : 'plan';
        await sleep(5);
        emit({ type: 'session.mode.changed', mode });
        continue;
      }

      // M3b.1 sentinel: trigger a permission flow without firing the default
      // scripted scene. requestId uses a "req-fake-" prefix so SessionManager
      // tracks it (non-`auto-deny-` prefix → enters pendingPermissions Map).
      if (text.startsWith('/permission-test')) {
        const requestId = `req-fake-${++counter}`;
        pendingRequests.add(requestId);
        await sleep(5);
        emit({
          type: 'permission.requested',
          requestId,
          toolName: 'Bash',
          toolInput: { command: 'echo hi from fake fixture' },
          callId: `tu-fake-${counter}`,
        });
        continue;
      }

      // Default scripted scene — unchanged from M2/M3a.
      await sleep(5);
      emit({ type: 'agent.thinking', content: `Considering: ${text}`, streaming: false });

      await sleep(5);
      const callId = next();
      emit({ type: 'tool.started', callId, name: 'Read', input: { path: 'demo.ts' } });
      await sleep(5);
      emit({
        type: 'tool.completed',
        callId,
        output: { lines: 42 },
        status: 'ok',
        durationMs: 5,
      });

      await sleep(5);
      const subCall = next();
      emit({
        type: 'subagent.dispatched',
        parentCallId: subCall,
        agentType: 'Explore',
        prompt: `find references to "${text}"`,
        childSessionId: 'child-fake-1',
      });
      await sleep(10);
      emit({
        type: 'subagent.completed',
        parentCallId: subCall,
        childSessionId: 'child-fake-1',
        result: { matches: 3 },
        status: 'ok',
      });

      await sleep(5);
      emit({
        type: 'file.changed',
        path: 'demo.ts',
        plus: 4,
        minus: 1,
        preview: '+ added line\n- removed line',
      });

      await sleep(5);
      emit({
        type: 'tokens.updated',
        input: 120,
        output: 340,
        cached: 80,
        costUsd: 0.0042,
        model: 'fake-model',
      });

      await sleep(5);
      emit({
        type: 'agent.message',
        content: `echo: ${text}`,
        streaming: false,
      });

      // M4.1: emit a session.idle tail so E2E asserts the idle mirror
      // attribute without waiting CLAUDEVIS_IDLE_MS (default 30s). The
      // server-side timer is reset by every line; this fixture-emitted
      // idle event sets the latch directly so subsequent server-side
      // re-arm is a no-op until the next event arrives.
      await sleep(5);
      emit({ type: 'session.idle', durationMs: 0 });
    } catch {
      emit({ type: 'error', message: 'bad input', recoverable: true });
    }
  }
});

stdin.on('end', () => process.exit(0));
