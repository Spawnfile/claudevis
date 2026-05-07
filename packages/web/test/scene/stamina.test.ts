// packages/web/test/scene/stamina.test.ts
import { describe, expect, it } from 'vitest';
import { costToSegments } from '../../src/scene/stamina';

describe('stamina.costToSegments', () => {
  it('returns 0 for $0.00', () => {
    expect(costToSegments(0)).toBe(0);
  });

  it('returns 0 just below first threshold $0.10', () => {
    expect(costToSegments(0.099)).toBe(0);
  });

  it('returns 1 at exactly $0.10 (first threshold)', () => {
    expect(costToSegments(0.1)).toBe(1);
  });

  it('returns 2 at $0.20 (second threshold)', () => {
    expect(costToSegments(0.2)).toBe(2);
  });

  it('returns 3 at $0.40 (third threshold)', () => {
    expect(costToSegments(0.4)).toBe(3);
  });

  it('returns 4 at $0.80 (fourth threshold)', () => {
    expect(costToSegments(0.8)).toBe(4);
  });

  it('returns 5 at $1.60 (fifth threshold)', () => {
    expect(costToSegments(1.6)).toBe(5);
  });

  it('caps at 5 for any cost above $1.60', () => {
    expect(costToSegments(2.0)).toBe(5);
    expect(costToSegments(100)).toBe(5);
  });

  it('returns 5 for very large costs without floating-point overflow', () => {
    expect(costToSegments(1e9)).toBe(5);
  });

  it('handles fractional values between thresholds', () => {
    expect(costToSegments(0.15)).toBe(1); // between $0.10 and $0.20
    expect(costToSegments(0.5)).toBe(3); // between $0.40 and $0.80
  });
});
