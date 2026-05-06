#!/usr/bin/env bun
// Fake claude for tests. Exercises the FULL Event vocabulary from spec
// §4 so the contract is proven end-to-end before real claude is wired
// up. For each user.prompt it emits a representative scripted sequence:
//   agent.thinking → tool.started/completed → subagent.dispatched/
//   completed → file.changed → tokens.updated → agent.message
//
// One prompt = one scripted "scene". Real claude integration in M2
// replaces this fixture with a parser of actual stream-json output.

const stdin = process.stdin;
let buffer = '';

const emit = (obj: unknown) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

emit({ type: 'session.started', name: 'fake', cwd: process.cwd(), model: 'fake-model' });

let counter = 0;
const next = () => `c-${++counter}`;

stdin.setEncoding('utf8');
stdin.on('data', async (chunk) => {
  buffer += chunk;
  for (let idx = buffer.indexOf('\n'); idx >= 0; idx = buffer.indexOf('\n')) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as { type: string; content?: string };
      if (msg.type !== 'user.prompt') continue;
      const text = msg.content ?? '';

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
    } catch {
      emit({ type: 'error', message: 'bad input', recoverable: true });
    }
  }
});

stdin.on('end', () => process.exit(0));
