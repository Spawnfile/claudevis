import type { Command, Event, ResumableSession, ServerFrame, SkillEntry } from '@claudevis/shared';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface ConnectionState {
  socket: WebSocket | null;
  connected: boolean;
  replayDone: boolean;
  events: Event[];
  catalog: SkillEntry[] | null;
  pendingPromptPrefix: string;
  resumable: ResumableSession[];
  connect: (url: string) => void;
  send: (cmd: Command) => void;
  setPendingPromptPrefix: (s: string) => void;
  reset: () => void;
}

const assertNever = (x: never): never => {
  throw new Error(`unhandled ServerFrame variant: ${JSON.stringify(x)}`);
};

export const useConnection = create<ConnectionState>((set, get) => ({
  socket: null,
  connected: false,
  replayDone: false,
  events: [],
  catalog: null,
  pendingPromptPrefix: '',
  resumable: [],
  connect: (url) => {
    // React 19 strict-mode mounts effects twice in development. Skip a second
    // connect to the same URL so we don't open two sockets and end up with
    // the late one winning the `connected: true` race.
    const existing = get().socket;
    if (existing && existing.url === url && existing.readyState <= 1) return;
    const ws = new WebSocket(url);
    ws.onmessage = (msg) => {
      const data = typeof msg.data === 'string' ? msg.data : '';
      let frame: ServerFrame;
      try {
        frame = JSON.parse(data) as ServerFrame;
      } catch {
        return;
      }
      // M3b.2: exhaustive switch + assertNever default. Future ServerFrame
      // additions must be handled here or TypeScript fails the build (closes
      // the silent-drop gap that previously let settings.status and
      // skill.catalog flow into the void).
      switch (frame.type) {
        case 'hello': {
          set({ connected: true });
          // Auto-subscribe so a fresh page load receives the full history
          // from the server's event store before live events resume.
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              sessionIds: '*',
              replay: true,
            } satisfies Command),
          );
          return;
        }
        case 'event': {
          set((s) => ({ events: [...s.events, frame.event] }));
          return;
        }
        case 'replay.done': {
          set({ replayDone: true });
          return;
        }
        case 'settings.status': {
          // M1 stub — no UI yet. Silently accepted so the exhaustive switch
          // typechecks; a future settings overlay (M4) will surface this.
          return;
        }
        case 'skill.catalog': {
          set({ catalog: frame.skills });
          return;
        }
        case 'session.resumable': {
          set({ resumable: frame.sessions });
          return;
        }
        default:
          return assertNever(frame);
      }
    };
    ws.onclose = () => {
      set({ connected: false });
    };
    set({ socket: ws });
  },
  send: (cmd) => {
    const ws = get().socket;
    // Skip send when the socket is missing or not in OPEN state (WebSocket
    // spec: OPEN === 1). Without this guard, a button clicked before/after
    // the connection is alive raises "WebSocket is already in CLOSING or
    // CLOSED state" and ends up as an unhandled error in production builds.
    const OPEN = 1;
    if (!ws || ws.readyState !== OPEN) return;
    ws.send(JSON.stringify(cmd));
  },
  setPendingPromptPrefix: (s) => set({ pendingPromptPrefix: s }),
  reset: () =>
    set({
      socket: null,
      connected: false,
      replayDone: false,
      events: [],
      catalog: null,
      pendingPromptPrefix: '',
      resumable: [],
    }),
}));

/**
 * Subscribe to event-array deltas. The callback receives (events, lastIndex)
 * each render and is responsible for processing only events[lastIndex..].
 * Returns the new lastIndex. Used by SceneCanvas to apply deltas.
 */
export function useEventStream(cb: (events: Event[], lastIndex: number) => number): void {
  const events = useConnection((s) => s.events);
  const lastIndexRef = useRef(0);

  useEffect(() => {
    if (events.length > lastIndexRef.current) {
      lastIndexRef.current = cb(events, lastIndexRef.current);
    }
  }, [events, cb]);
}
