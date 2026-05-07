import type { ResumableSession, SkillEntry } from '@claudevis/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnection } from '../src/store/connection.js';

class FakeWs {
  static instances: FakeWs[] = [];
  url: string;
  readyState = 0;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(text: string) {
    this.onmessage?.({ data: text });
  }
}

beforeEach(() => {
  FakeWs.instances = [];
  // biome-ignore lint/suspicious/noExplicitAny: test injection
  (globalThis as any).WebSocket = FakeWs;
  useConnection.getState().reset();
});

describe('useConnection', () => {
  it('records hello frame on open', () => {
    useConnection.getState().connect('ws://test/v1');
    const fake = FakeWs.instances[0]!;
    fake.open();
    fake.recv(JSON.stringify({ type: 'hello', protocol: 'v1', serverVersion: '0.0.0' }));
    expect(useConnection.getState().connected).toBe(true);
  });

  it('appends events from event frames', () => {
    useConnection.getState().connect('ws://test/v1');
    const fake = FakeWs.instances[0]!;
    fake.open();
    fake.recv(
      JSON.stringify({
        type: 'event',
        event: {
          id: 'e1',
          ts: 1,
          sessionId: 's',
          type: 'agent.message',
          content: 'hi',
          streaming: false,
        },
      }),
    );
    expect(useConnection.getState().events.length).toBe(1);
  });

  it('sends commands as JSON via send()', () => {
    useConnection.getState().connect('ws://test/v1');
    const fake = FakeWs.instances[0]!;
    fake.open();
    useConnection.getState().send({ type: 'session.send', sessionId: 's', content: 'hi' });
    expect(fake.sent[0]).toBe(
      JSON.stringify({ type: 'session.send', sessionId: 's', content: 'hi' }),
    );
  });

  it('auto-subscribes with replay:true after hello', () => {
    useConnection.getState().connect('ws://test/v1');
    const fake = FakeWs.instances[0]!;
    fake.open();
    fake.recv(JSON.stringify({ type: 'hello', protocol: 'v1', serverVersion: '0.0.0' }));
    expect(fake.sent[0]).toBe(JSON.stringify({ type: 'subscribe', sessionIds: '*', replay: true }));
  });

  it('flips replayDone on replay.done frame', () => {
    useConnection.getState().connect('ws://test/v1');
    const fake = FakeWs.instances[0]!;
    fake.open();
    fake.recv(JSON.stringify({ type: 'hello', protocol: 'v1', serverVersion: '0.0.0' }));
    expect(useConnection.getState().replayDone).toBe(false);
    fake.recv(JSON.stringify({ type: 'replay.done' }));
    expect(useConnection.getState().replayDone).toBe(true);
  });
});

describe('connection store — M3b.2 catalog and pendingPromptPrefix', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  it('catalog defaults to null on fresh state', () => {
    expect(useConnection.getState().catalog).toBeNull();
  });

  it('pendingPromptPrefix defaults to empty string on fresh state', () => {
    expect(useConnection.getState().pendingPromptPrefix).toBe('');
  });

  it('setPendingPromptPrefix sets the slice', () => {
    useConnection.getState().setPendingPromptPrefix('/test-skill ');
    expect(useConnection.getState().pendingPromptPrefix).toBe('/test-skill ');
  });

  it('setPendingPromptPrefix can be cleared with empty string', () => {
    useConnection.getState().setPendingPromptPrefix('/foo ');
    useConnection.getState().setPendingPromptPrefix('');
    expect(useConnection.getState().pendingPromptPrefix).toBe('');
  });

  it('reset clears catalog and pendingPromptPrefix', () => {
    const skills: SkillEntry[] = [
      { name: 's1', description: '', source: 'user', path: '', kind: 'skill' },
    ];
    useConnection.setState({ catalog: skills, pendingPromptPrefix: '/x ' });
    useConnection.getState().reset();
    expect(useConnection.getState().catalog).toBeNull();
    expect(useConnection.getState().pendingPromptPrefix).toBe('');
  });
});

describe('connection store — M3b.3 resumable slice', () => {
  beforeEach(() => {
    useConnection.getState().reset();
  });

  it('resumable defaults to empty array on fresh state', () => {
    expect(useConnection.getState().resumable).toEqual([]);
  });

  it('reset() clears resumable to empty array', () => {
    const sessions: ResumableSession[] = [{ id: 's1', cwd: '/x', lastActiveAt: 1000 }];
    useConnection.setState({ resumable: sessions });
    useConnection.getState().reset();
    expect(useConnection.getState().resumable).toEqual([]);
  });

  it('setting resumable populates the slice', () => {
    const sessions: ResumableSession[] = [
      { id: 'a', cwd: '/x', name: 'old', model: 'sonnet', lastActiveAt: 1000 },
      { id: 'b', cwd: '/y', lastActiveAt: 2000 },
    ];
    useConnection.setState({ resumable: sessions });
    expect(useConnection.getState().resumable).toHaveLength(2);
    expect(useConnection.getState().resumable[0]?.name).toBe('old');
  });
});
