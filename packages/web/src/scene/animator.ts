// packages/web/src/scene/animator.ts
// Deterministic tween runner with prefers-reduced-motion short-circuit.
// Imperative & mutating-by-design: tweens write directly to target[prop] every
// PIXI Ticker frame. The single active list is process-global because PIXI's
// Ticker.shared is also process-global; tests reset state via cancelAll() in
// beforeEach. The internal _step is exported for unit testing without booting
// a real PIXI Application.
//
// Reduce-motion contract: the class on document.body is read at tween() call
// time (not on every step). Mid-flight class changes do not retroactively
// snap or unfreeze tweens; the next tween() call observes the new state.
// This matches the design §4.6 contract — "the animator reads the class on
// each tween creation."

import { Ticker } from 'pixi.js';

export const ANIM = {
  fadeIn: 220,
  fadeOut: 220,
  glyphFloat: 1800,
  speechBubble: 3000,
  parchmentScroll: 2000,
  summonRing: 600,
  fileFly: 800,
  sigilPulse: 1400,
  errorFlash: 400,
  bellShake: 600,
  emberRise: 7000,
  lanternFlicker: 2400,
  npcIdleBob: 1600,
} as const;

interface Tween {
  target: Record<string, number>;
  prop: string;
  from: number;
  to: number;
  durationMs: number;
  ease?: (t: number) => number;
  onDone?: () => void;
  startMs: number;
}

const active: Tween[] = [];
let tickerInstalled = false;

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('reduced-motion');
}

function ensureTicker(): void {
  if (tickerInstalled) return;
  // PIXI's Ticker.shared advances every browser frame. The step callback is
  // idempotent on an empty active list, so installing once at first use is fine.
  Ticker.shared.add(_step);
  tickerInstalled = true;
}

/**
 * Internal step callback — exported solely for unit testing. Production code
 * never calls it directly; PIXI's Ticker invokes it on every frame.
 */
export function _step(): void {
  if (active.length === 0) return;
  const now = Date.now();
  for (let i = active.length - 1; i >= 0; i--) {
    const t = active[i];
    if (!t) continue;
    const elapsed = now - t.startMs;
    if (elapsed >= t.durationMs) {
      // Target may have been destroyed by a prior tween's onDone fired
      // earlier in this same frame (e.g. file-fly's y tween destroys sprite
      // before x tween writes its final position). PIXI 8 setters touch
      // _texture.orig on transform recalculation; a write to a destroyed
      // ObservablePoint throws. Swallow + always splice so the active list
      // doesn't accumulate dead entries that crash on every subsequent frame.
      try {
        t.target[t.prop] = t.to;
      } catch {
        // ignore — target destroyed mid-tween
      }
      try {
        t.onDone?.();
      } catch {
        // ignore — onDone raced with destroy
      }
      active.splice(i, 1);
      continue;
    }
    try {
      const u = t.ease ? t.ease(elapsed / t.durationMs) : elapsed / t.durationMs;
      t.target[t.prop] = t.from + (t.to - t.from) * u;
    } catch {
      // Same race as above but mid-tween — drop the tween entirely.
      active.splice(i, 1);
    }
  }
}

interface TweenOpts {
  ease?: (t: number) => number;
  onDone?: () => void;
}

export const animator = {
  tween(
    target: Record<string, number>,
    prop: string,
    from: number,
    to: number,
    durationMs: number,
    opts?: TweenOpts,
  ): void {
    if (reducedMotion()) {
      target[prop] = to;
      opts?.onDone?.();
      return;
    }
    ensureTicker();
    active.push({
      target,
      prop,
      from,
      to,
      durationMs,
      ease: opts?.ease,
      onDone: opts?.onDone,
      startMs: Date.now(),
    });
  },
  cancelAll(): void {
    active.length = 0;
  },
  ANIM,
};

export const easeOutQuad = (t: number): number => t * (2 - t);
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
