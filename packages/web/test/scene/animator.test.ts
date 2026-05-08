// packages/web/test/scene/animator.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _step, animator, easeInOutQuad, easeOutQuad } from '../../src/scene/animator';

describe('animator', () => {
  beforeEach(() => {
    document.body.classList.remove('reduced-motion');
    animator.cancelAll();
  });

  afterEach(() => {
    animator.cancelAll();
    vi.useRealTimers();
  });

  it('exposes the ANIM duration table', () => {
    expect(animator.ANIM.fadeIn).toBe(220);
    expect(animator.ANIM.fadeOut).toBe(220);
    expect(animator.ANIM.glyphFloat).toBe(1800);
    expect(animator.ANIM.summonRing).toBe(600);
    expect(animator.ANIM.fileFly).toBe(800);
    expect(animator.ANIM.sigilPulse).toBe(1400);
    expect(animator.ANIM.errorFlash).toBe(400);
    expect(animator.ANIM.bellShake).toBe(600);
    expect(animator.ANIM.emberRise).toBe(7000);
    expect(animator.ANIM.lanternFlicker).toBe(2400);
    expect(animator.ANIM.npcIdleBob).toBe(1600);
  });

  it('linear tween: midpoint produces value halfway between from and to', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const target: Record<string, number> = { alpha: 0 };
    animator.tween(target, 'alpha', 0, 1, 1000);
    // halfway: t=500ms → 0.5
    vi.setSystemTime(1500);
    _step();
    expect(target.alpha).toBeCloseTo(0.5, 5);
  });

  it('linear tween: reaches `to` at durationMs and removes from active list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const target: Record<string, number> = { alpha: 0 };
    animator.tween(target, 'alpha', 0, 1, 200);
    vi.setSystemTime(1200);
    _step();
    expect(target.alpha).toBe(1);
    // Stepping again doesn't move the value (no active tween).
    target.alpha = 0.7;
    vi.setSystemTime(1300);
    _step();
    expect(target.alpha).toBe(0.7);
  });

  it('reduced-motion short-circuits to `to` immediately and skips active list', () => {
    document.body.classList.add('reduced-motion');
    const target: Record<string, number> = { alpha: 0 };
    let doneFired = false;
    animator.tween(target, 'alpha', 0, 1, 1000, {
      onDone: () => {
        doneFired = true;
      },
    });
    expect(target.alpha).toBe(1);
    expect(doneFired).toBe(true);
    // _step is a no-op when nothing is active; alpha stays at 1.
    _step();
    expect(target.alpha).toBe(1);
  });

  it('reduced-motion is read at tween() call time (not on step)', () => {
    document.body.classList.add('reduced-motion');
    const target: Record<string, number> = { alpha: 0 };
    animator.tween(target, 'alpha', 0, 1, 1000);
    expect(target.alpha).toBe(1);
    // Toggle off — already-completed tween stays at to.
    document.body.classList.remove('reduced-motion');
    _step();
    expect(target.alpha).toBe(1);
  });

  it('cancelAll() clears active tweens — no further updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const target: Record<string, number> = { alpha: 0 };
    animator.tween(target, 'alpha', 0, 1, 1000);
    vi.setSystemTime(1200);
    _step();
    expect(target.alpha).toBeCloseTo(0.2, 5);
    animator.cancelAll();
    vi.setSystemTime(2000);
    _step();
    // Value should NOT have advanced past the pre-cancel sample.
    expect(target.alpha).toBeCloseTo(0.2, 5);
  });

  it('onDone callback fires exactly once when tween completes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const target: Record<string, number> = { alpha: 0 };
    const onDone = vi.fn();
    animator.tween(target, 'alpha', 0, 1, 200, { onDone });
    vi.setSystemTime(1100);
    _step();
    expect(onDone).not.toHaveBeenCalled();
    vi.setSystemTime(1200);
    _step();
    expect(onDone).toHaveBeenCalledTimes(1);
    // Stepping again doesn't fire onDone again (tween was removed).
    vi.setSystemTime(1300);
    _step();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('eased tween (easeOutQuad) reaches `to` at durationMs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const target: Record<string, number> = { y: 0 };
    animator.tween(target, 'y', 0, 100, 500, { ease: easeOutQuad });
    vi.setSystemTime(1500);
    _step();
    expect(target.y).toBe(100);
  });

  it('easeOutQuad produces monotonically increasing intermediate values', () => {
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
    const samples = [0.1, 0.25, 0.5, 0.75, 0.9].map(easeOutQuad);
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1] ?? 0;
      const curr = samples[i] ?? 0;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('easeInOutQuad is symmetric around 0.5', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 5);
  });

  it('multiple concurrent tweens advance independently', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a: Record<string, number> = { alpha: 0 };
    const b: Record<string, number> = { x: 100 };
    animator.tween(a, 'alpha', 0, 1, 1000);
    animator.tween(b, 'x', 100, 200, 500);
    vi.setSystemTime(1500);
    _step();
    expect(a.alpha).toBeCloseTo(0.5, 5);
    expect(b.x).toBe(200); // b finished
    vi.setSystemTime(2000);
    _step();
    expect(a.alpha).toBe(1); // a finished
    expect(b.x).toBe(200);
  });
});
