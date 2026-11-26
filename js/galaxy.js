import { makeRng, pick, shuffle, weighted } from './rng.js';

export const GOODS = [
  { id: 'food', name: 'Food', base: 20 },
  { id: 'water', name: 'Water', base: 16 },
  { id: 'textiles', name: 'Textiles', base: 40 },
  { id: 'ore', name: 'Ore', base: 34 },
  { id: 'metals', name: 'Refined metals', base: 70 },
  { id: 'chemicals', name: 'Chemicals', base: 88 },
  { id: 'machinery', name: 'Machinery', base: 125 },
  { id: 'medicine', name: 'Medicine', base: 150 },
  { id: 'electronics', name: 'Electronics', base: 180 },
  { id: 'luxuries', name: 'Luxury goods', base: 290 },
  { id: 'weapons', name: 'Illegal weapons', base: 240, illegal: true },
  { id: 'blacktech', name: 'Black-market tech', base: 320, illegal: true },
];

export const ECONOMIES = {
  agricultural: { name: 'Agricultural', produces: ['food', 'water', 'textiles'], demands: ['machinery', 'electronics', 'medicine', 'chemicals'] },
  mining: { name: 'Mining', produces: ['ore', 'water'], demands: ['food', 'machinery', 'medicine', 'luxuries'] },
  industrial: { name: 'Industrial', produces: ['metals', 'machinery', 'chemicals'], demands: ['ore', 'food', 'textiles'] },
  refinery: { name: 'Refinery', produces: ['metals', 'chemicals'], demands: ['ore', 'water', 'food'] },
  hightech: { name: 'High-tech', produces: ['electronics', 'medicine'], demands: ['metals', 'chemicals', 'food', 'luxuries'] },
  wealthy: { name: 'Wealthy', produces: ['luxuries', 'textiles'], demands: ['food', 'water', 'electronics', 'medicine'] },
};

export const SECURITY_NAMES = { high: 'high security', medium: 'medium security', low: 'low security', none: 'no security' };

const SYL = ['ka', 'vel', 'dor', 'ari', 'zen', 'tor', 'mi', 'sha', 'rin', 'qua', 'lo', 've', 'nex', 'ost', 'ira', 'bel', 'cor',
  'dra', 'eth', 'fa', 'gal', 'hal', 'is', 'jun', 'kes', 'lyr', 'mor', 'nal', 'oph', 'pri', 'ryn', 'sol', 'tal', 'ul', 'vor',
  'wen', 'xan', 'yra', 'zor', 'cae', 'dun', 'eph', 'fen', 'gor', 'hes', 'ith', 'kor', 'lun', 'mar', 'nyx', 'or', 'pel',
  'rho', 'sev', 'tyr', 'und', 'var', 'wyl', 'ash', 'bri', 'cyn', 'del', 'ess', 'kal', 'tem', 'ros', 'vin'];
const SUFFIX = [' Prime', ' Major', ' Minor', ' II', ' III', ' IV', ' Station', ' Gate', ' Reach', ' Hold'];
const REGION_POOL = ['Ashen Reach', 'Veil Expanse', 'Ember Marches', 'Silent Drift', 'Iron Belt', 'Shattered Verge',
  'Hollow Deep', 'Cinder Wastes', 'Pale Frontier', 'Tidewater Cluster', 'Sable Rim', 'Ghostlight Fields'];
const CLANS = ['Red Talon', 'Hollow Crown', 'Black Tide', 'Iron Wake', 'Grave Lantern', 'Sixth Knife'];

const ECON_WEIGHTS = {
  core: { wealthy: 3, hightech: 3, industrial: 2, refinery: 1, agricultural: 1, mining: 0.5 },
  frontier: { agricultural: 3, industrial: 2, mining: 2, refinery: 2, hightech: 1, wealthy: 0.5 },
  lawless: { mining: 3, agricultural: 2, refinery: 1, industrial: 1, hightech: 0.4, wealthy: 0.3 },
};
const SECURITY_WEIGHTS = {
  core: { high: 8, medium: 2 },
  frontier: { high: 1, medium: 5, low: 4 },
  lawless: { low: 4.5, none: 5.5 },
};

function makeName(rng, used) {
  for (let t = 0; t < 200; t++) {
    const parts = rng() < 0.35 ? 3 : 2;
    let n = '';
    for (let i = 0; i < parts; i++) n += pick(rng, SYL);
    n = n.charAt(0).toUpperCase() + n.slice(1);
    if (n.length < 4 || n.length > 10) continue;
    if (rng() < 0.22) n += pick(rng, SUFFIX);
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = 'System ' + used.size;
  used.add(n);
  return n;
}

export function generateGalaxy(seed) {
  const rng = makeRng(seed);
  const N = 120, MIN = 55, SIZE = 1000;
  const pts = [];
  let tries = 0;
  while (pts.length < N && tries < 50000) {
    tries++;
    const x = rng() * SIZE, y = rng() * SIZE;
    if (pts.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 >= MIN * MIN)) pts.push({ x, y });
  }

  const regionNames = shuffle(rng, [...REGION_POOL]);
  const clans = shuffle(rng, [...CLANS]);
  const regions = [];
  let ri = 0, ci = 0;
  for (let r = 0; r < 9; r++) {
    const row = Math.floor(r / 3), col = r % 3;
    const kind = r === 4 ? 'core' : (row !== 1 && col !== 1) ? 'lawless' : 'frontier';
    regions.push({ id: r, kind, name: kind === 'core' ? 'Core Worlds' : regionNames[ri++], clan: kind === 'lawless' ? clans[ci++] : null });
  }

  const used = new Set();
  const systems = pts.map((p, i) => {
    const row = Math.min(2, Math.floor(p.y / (SIZE / 3)));
    const col = Math.min(2, Math.floor(p.x / (SIZE / 3)));
    const region = regions[row * 3 + col];
    const security = weighted(rng, SECURITY_WEIGHTS[region.kind]);
    let authority;
    if (security === 'high' || security === 'medium') authority = 'Concord';
    else if (security === 'low') authority = 'Independent';
    else authority = region.clan + ' clan';
    const economy = weighted(rng, ECON_WEIGHTS[region.kind]);
    const priceFactor = {};
    for (const g of GOODS) priceFactor[g.id] = g.illegal ? 1 : 0.9 + rng() * 0.2;
    return { id: i, name: makeName(rng, used), x: p.x, y: p.y, region: region.id, security, authority, economy, priceFactor };
  });

  // Jump lanes: each system links to its nearest neighbours.
  const dist = (a, b) => Math.hypot(systems[a].x - systems[b].x, systems[a].y - systems[b].y);
  const edges = new Set();
  const addEdge = (a, b) => edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  for (let i = 0; i < N; i++) {
    const near = systems.map((_, j) => j).filter(j => j !== i).sort((a, b) => dist(i, a) - dist(i, b));
    addEdge(i, near[0]);
    addEdge(i, near[1]);
    if (dist(i, near[2]) < 105) addEdge(i, near[2]);
  }
  const buildAdj = () => {
    const adj = systems.map(() => []);
    for (const e of edges) {
      const [a, b] = e.split('-').map(Number);
      const ly = Math.round(dist(a, b)) / 10;
      adj[a].push({ to: b, ly });
      adj[b].push({ to: a, ly });
    }
    return adj;
  };
  // Make sure every system can be reached.
  for (;;) {
    const adj = buildAdj();
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      const c = stack.pop();
      for (const { to } of adj[c]) if (!seen.has(to)) { seen.add(to); stack.push(to); }
    }
    if (seen.size === systems.length) break;
    let best = null;
    for (const a of seen) for (let b = 0; b < N; b++) {
      if (seen.has(b)) continue;
      const d = dist(a, b);
      if (!best || d < best.d) best = { a, b, d };
    }
    addEdge(best.a, best.b);
  }
  const adj = buildAdj();
  for (const list of adj) list.sort((a, b) => a.ly - b.ly);

  // Each system's nearest pirate clan (their own clan in lawless space).
  const lawless = regions.filter(r => r.kind === 'lawless');
  for (const sys of systems) {
    const reg = regions[sys.region];
    if (reg.kind === 'lawless') { sys.clan = reg.clan; continue; }
    let best = null;
    for (const r of lawless) {
      const cx = (r.id % 3) * (SIZE / 3) + SIZE / 6, cy = Math.floor(r.id / 3) * (SIZE / 3) + SIZE / 6;
      const d = Math.hypot(sys.x - cx, sys.y - cy);
      if (!best || d < best.d) best = { d, clan: r.clan };
    }
    sys.clan = best.clan;
  }

  const coreHigh = systems.filter(s => regions[s.region].kind === 'core' && s.security === 'high');
  const start = (coreHigh.length ? pick(rng, coreHigh) : systems[0]).id;

  return { seed, systems, regions, adj, start };
}

export function jumpCost(ly, tank) {
  return { fuel: Math.min(tank, Math.max(1, Math.ceil(ly / 4))), days: Math.max(1, Math.ceil(ly / 3)) };
}

export function shortestPath(galaxy, from, to) {
  const n = galaxy.systems.length;
  const d = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  d[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || d[i] < d[u])) u = i;
    if (u === -1 || d[u] === Infinity) break;
    if (u === to) break;
    done[u] = true;
    for (const { to: v, ly } of galaxy.adj[u]) if (d[u] + ly < d[v]) { d[v] = d[u] + ly; prev[v] = u; }
  }
  if (d[to] === Infinity) return null;
  const path = [];
  for (let c = to; c !== -1; c = prev[c]) path.unshift(c);
  return path;
}

export function hopCounts(galaxy, from) {
  const hops = new Array(galaxy.systems.length).fill(Infinity);
  hops[from] = 0;
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const { to } of galaxy.adj[c]) if (hops[to] === Infinity) { hops[to] = hops[c] + 1; q.push(to); }
  }
  return hops;
}
