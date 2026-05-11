import { memo } from 'react';
import { aggregateCost } from './cost.js';
import { useConnection } from './store/connection.js';

export const CostTooltip = memo(function CostTooltip() {
  const sessionId = useConnection((s) => s.hoveredSessionId);
  const events = useConnection((s) => s.events);
  if (!sessionId) return null;
  const cost = aggregateCost(events, sessionId);
  return (
    <div className="cost-tooltip" data-testid="cost-tooltip" data-session-id={sessionId}>
      <div className="cost-tooltip__row">
        <span className="cost-tooltip__label">in / out / cached</span>
        <span className="cost-tooltip__value">
          {cost.inputTotal} / {cost.outputTotal} / {cost.cachedTotal}
        </span>
      </div>
      <div className="cost-tooltip__row">
        <span className="cost-tooltip__label">total</span>
        <span className="cost-tooltip__value">${cost.costUsdTotal.toFixed(4)}</span>
      </div>
      <div className="cost-tooltip__row">
        <span className="cost-tooltip__label">last msg</span>
        <span className="cost-tooltip__value">${cost.lastCostUsd.toFixed(4)}</span>
      </div>
    </div>
  );
});
