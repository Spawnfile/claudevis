import type { Command, Event, ServerFrame } from '@claudevis/shared';
import { create } from 'zustand';

interface ConnectionState {
  socket: WebSocket | null;
  connected: boolean;
  replayDone: boolean;
  events: Event[];
  connect: (url: string) => void;
  send: (cmd: Command) => void;
  reset: () => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  socket: null,
  connected: false,
  replayDone: false,
  events: [],
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
      if (frame.type === 'hello') {
        set({ connected: true });
        // Auto-subscribe so a fresh page load receives the full history
        // from the server's event store before live events resume.
        ws.send(
          JSON.stringify({ type: 'subscribe', sessionIds: '*', replay: true } satisfies Command),
        );
      } else if (frame.type === 'event') {
        set((s) => ({ events: [...s.events, frame.event] }));
      } else if (frame.type === 'replay.done') {
        set({ replayDone: true });
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
  reset: () => set({ socket: null, connected: false, replayDone: false, events: [] }),
}));
