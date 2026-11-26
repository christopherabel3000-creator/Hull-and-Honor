import { GOODS, ECONOMIES } from './galaxy.js';

const PRODUCE = 0.75, DEMAND = 1.3, SPREAD = 0.88;

export function sysState(state, id) {
  let s = state.systems[id];
  if (!s) {
    s = state.systems[id] = { visited: false, lastDay: state.day, noise: {}, pressure: {}, notes: {} };
    for (const g of GOODS) {
      s.noise[g.id] = (Math.random() - 0.5) * 0.2;
      s.pressure[g.id] = 0;
    }
  }
  return s;
}

// Prices drift day by day, and your own trading pressure fades over time.
export function refreshMarket(state, id) {
  const s = sysState(state, id);
  const elapsed = Math.max(0, state.day - s.lastDay);
  if (!elapsed) return;
  const steps = Math.min(elapsed, 30);
  for (const g of GOODS) {
    let n = s.noise[g.id];
    for (let i = 0; i < steps; i++) n = n * 0.9 + (Math.random() - 0.5) * 0.1;
    s.noise[g.id] = Math.max(-0.25, Math.min(0.25, n));
    s.pressure[g.id] *= Math.pow(0.85, elapsed);
  }
  s.lastDay = state.day;
}

export function tradeTag(sys, g) {
  const eco = ECONOMIES[sys.economy];
  if (eco.produces.includes(g.id)) return 'local product';
  if (eco.demands.includes(g.id)) return 'in demand';
  return '';
}

export function prices(state, sys, g) {
  const s = sysState(state, sys.id);
  const eco = ECONOMIES[sys.economy];
  let m = 1;
  if (eco.produces.includes(g.id)) m = PRODUCE;
  else if (eco.demands.includes(g.id)) m = DEMAND;
  const buy = Math.max(1, Math.round(g.base * m * sys.priceFactor[g.id] * (1 + s.noise[g.id]) * (1 + s.pressure[g.id])));
  return { buy, sell: Math.max(1, Math.round(buy * SPREAD)) };
}

// Buying pushes the local price up; selling pushes it down.
export function nudge(state, sysId, goodId, dir) {
  const s = sysState(state, sysId);
  s.pressure[goodId] = Math.max(-0.4, Math.min(0.6, s.pressure[goodId] + dir * 0.01));
}

export function recordNotes(state, sys) {
  const s = sysState(state, sys.id);
  for (const g of GOODS) s.notes[g.id] = { ...prices(state, sys, g), day: state.day };
}

export function fuelPrice(sys) {
  return { high: 12, medium: 15, low: 19, none: 24 }[sys.security];
}
