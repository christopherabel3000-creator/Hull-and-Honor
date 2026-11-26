import { GOODS, ECONOMIES } from './galaxy.js';

const PRODUCE = 0.75, DEMAND = 1.3, SPREAD = 0.88;

export function sysState(state, id) {
  let s = state.systems[id];
  if (!s) {
    s = state.systems[id] = { visited: false, lastDay: state.day, noise: {}, pressure: {}, notes: {}, local: 0 };
    for (const g of GOODS) {
      s.noise[g.id] = (Math.random() - 0.5) * 0.2;
      s.pressure[g.id] = 0;
    }
  }
  if (s.local == null) s.local = 0;
  return s;
}

export const hasBlackMarket = sys => sys.authority !== 'Concord';

// Prices drift day by day, and your own trading pressure fades over time.
export function refreshMarket(state, id) {
  const s = sysState(state, id);
  const elapsed = Math.max(0, state.day - s.lastDay);
  if (!elapsed) return;
  const steps = Math.min(elapsed, 30);
  for (const g of GOODS) {
    let n = s.noise[g.id] ?? (Math.random() - 0.5) * 0.2;
    for (let i = 0; i < steps; i++) n = n * 0.9 + (Math.random() - 0.5) * 0.1;
    s.noise[g.id] = Math.max(-0.25, Math.min(0.25, n));
    s.pressure[g.id] = (s.pressure[g.id] ?? 0) * Math.pow(0.85, elapsed);
  }
  s.lastDay = state.day;
}

export function tradeTag(sys, g) {
  if (g.illegal) return sys.authority === 'Independent' ? 'in demand, contraband' : 'cheap here, contraband';
  const eco = ECONOMIES[sys.economy];
  if (eco.produces.includes(g.id)) return 'local product';
  if (eco.demands.includes(g.id)) return 'in demand';
  return '';
}

export function prices(state, sys, g) {
  const s = sysState(state, sys.id);
  let m = 1;
  if (g.illegal) m = sys.authority === 'Independent' ? DEMAND : PRODUCE;
  else {
    const eco = ECONOMIES[sys.economy];
    if (eco.produces.includes(g.id)) m = PRODUCE;
    else if (eco.demands.includes(g.id)) m = DEMAND;
  }
  // Good local standing gets you up to 5% better prices; bad standing costs you.
  const local = s.local * 0.0005;
  const raw = g.base * m * sys.priceFactor[g.id] * (1 + (s.noise[g.id] ?? 0)) * (1 + (s.pressure[g.id] ?? 0));
  const buy = Math.max(1, Math.round(raw * (1 - local)));
  return { buy, sell: Math.max(1, Math.round(raw * SPREAD * (1 + local))) };
}

// Buying pushes the local price up; selling pushes it down.
export function nudge(state, sysId, goodId, dir) {
  const s = sysState(state, sysId);
  s.pressure[goodId] = Math.max(-0.4, Math.min(0.6, (s.pressure[goodId] ?? 0) + dir * 0.01));
}

export function recordNotes(state, sys) {
  const s = sysState(state, sys.id);
  for (const g of GOODS) {
    if (g.illegal && !hasBlackMarket(sys)) continue;
    s.notes[g.id] = { ...prices(state, sys, g), day: state.day };
  }
}

export function fuelPrice(sys) {
  return { high: 12, medium: 15, low: 19, none: 24 }[sys.security];
}
