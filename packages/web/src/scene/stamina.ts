// packages/web/src/scene/stamina.ts
// Cumulative-cost stamina bar. Each segment represents a doubling of cost.
// Thresholds: $0.10 (1), $0.20 (2), $0.40 (3), $0.80 (4), $1.60 (5).
// Above $1.60, the bar stays at 5 segments — visual indicator that the session
// is "expensive" without infinite headroom.

const THRESHOLDS = [0.1, 0.2, 0.4, 0.8, 1.6] as const;

export function costToSegments(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  let count = 0;
  for (const t of THRESHOLDS) {
    if (usd >= t) count++;
    else break;
  }
  return count;
}
