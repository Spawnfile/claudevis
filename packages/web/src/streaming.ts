import type { Event } from '@claudevis/shared';

type StreamingEvent = Extract<Event, { type: 'agent.message' | 'agent.thinking' }>;

function isStreamingEvent(e: Event): e is StreamingEvent {
  return e.type === 'agent.message' || e.type === 'agent.thinking';
}

/**
 * Collapse consecutive `agent.message` / `agent.thinking` events with
 * `streaming: true` on the same `(sessionId, type)` into a single virtual
 * event with concatenated content. A subsequent `streaming: false` event
 * with the same `(sessionId, type)` replaces the head with its canonical
 * content. Other event types appear in their original position; they do
 * NOT terminate an in-progress run. The function is pure.
 *
 * Used in Chat.tsx to render incremental streaming runs without churning
 * the events array in the store.
 */
export function collapseStreamingMessages(events: Event[]): Event[] {
  const out: Event[] = [];
  const headIdx = new Map<string, number>();
  const chunks = new Map<string, string[]>();

  for (const e of events) {
    if (e.type !== 'agent.message' && e.type !== 'agent.thinking') {
      out.push(e);
      continue;
    }
    const key = `${e.sessionId}::${e.type}`;
    if (e.streaming === true) {
      const idx = headIdx.get(key);
      if (idx === undefined) {
        out.push(e);
        headIdx.set(key, out.length - 1);
        chunks.set(key, [e.content]);
      } else {
        const arr = chunks.get(key) ?? [];
        arr.push(e.content);
        chunks.set(key, arr);
        const head = out[idx];
        if (head !== undefined && isStreamingEvent(head)) {
          out[idx] = { ...head, content: arr.join('') };
        }
      }
      continue;
    }
    // streaming: false — finalize run if any.
    const idx = headIdx.get(key);
    if (idx !== undefined) {
      // Remove the head from its in-stream position and append the
      // canonical terminating event at the current end of the output.
      // This preserves the chronological position of any unrelated
      // events (e.g. tool.started) that arrived mid-stream.
      out.splice(idx, 1);
      // Indices in headIdx that point past the removed slot must shift.
      for (const [k, v] of headIdx) {
        if (v > idx) headIdx.set(k, v - 1);
      }
      headIdx.delete(key);
      chunks.delete(key);
      out.push(e);
    } else {
      out.push(e);
    }
  }

  return out;
}
