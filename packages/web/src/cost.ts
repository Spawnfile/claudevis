import type { Event } from '@claudevis/shared';

export interface CostSummary {
  inputTotal: number;
  outputTotal: number;
  cachedTotal: number;
  costUsdTotal: number;
  lastInput: number;
  lastOutput: number;
  lastCached: number;
  lastCostUsd: number;
}

export function aggregateCost(events: Event[], sessionId: string): CostSummary {
  let inputTotal = 0;
  let outputTotal = 0;
  let cachedTotal = 0;
  let costUsdTotal = 0;
  let last: { input: number; output: number; cached: number; costUsd: number } | null = null;
  for (const e of events) {
    if (e.type !== 'tokens.updated' || e.sessionId !== sessionId) continue;
    inputTotal += e.input;
    outputTotal += e.output;
    cachedTotal += e.cached;
    costUsdTotal += e.costUsd;
    last = { input: e.input, output: e.output, cached: e.cached, costUsd: e.costUsd };
  }
  return {
    inputTotal,
    outputTotal,
    cachedTotal,
    costUsdTotal,
    lastInput: last?.input ?? 0,
    lastOutput: last?.output ?? 0,
    lastCached: last?.cached ?? 0,
    lastCostUsd: last?.costUsd ?? 0,
  };
}
