// The living galaxy: timed events that move prices, and wars that move borders.
import { GOODS } from './galaxy.js';
import { clanKey, clanOf, factionName } from './reputation.js';

let api = null; // { state(), galaxy() }
export function initWorld(a) { api = a; }

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const goodName = id => GOODS.find(g => g.id === id).name.toLowerCase();

const TYPES = {
  famine: { name: 'Famine', weight: 2, filter: s => s.economy !== 'agricultural', goods: { food: 2.2, water: 1.5 }, days: [15, 30],
    start: n => `Famine strikes ${n}. Food and water prices have soared.`, end: n => `The famine at ${n} is over.`,
    effect: 'food and water in high demand' },
  plague: { name: 'Plague', weight: 1.5, filter: () => true, goods: { medicine: 2.6 }, days: [15, 30],
    start: n => `A plague has broken out at ${n}. Medicine is desperately needed.`, end: n => `The plague at ${n} has burned out.`,
    effect: 'medicine in high demand' },
  boom: { name: 'Mining boom', weight: 1.5, filter: s => s.economy === 'mining', goods: { machinery: 1.8, food: 1.4, luxuries: 1.5, ore: 0.6 }, days: [20, 35],
    start: n => `A mining boom at ${n}: miners are buying machinery, food and luxuries, and ore is cheap.`, end: n => `The mining boom at ${n} has gone bust.`,
    effect: 'machinery, food and luxuries in demand, ore cheap' },
  festival: { name: 'Festival', weight: 1, filter: s => s.economy === 'wealthy' || s.economy === 'hightech', goods: { luxuries: 1.8, food: 1.3, textiles: 1.4 }, days: [8, 15],
    start: n => `${n} is celebrating its founding festival. Luxuries, fine food and textiles are selling fast.`, end: n => `The festival at ${n} is over.`,
    effect: 'luxuries, food and textiles in demand' },
  glut: { name: 'Glut', weight: 2, filter: () => true, goods: null, days: [10, 25],
    start: (n, ev) => `${n} is flooded with ${goodName(ev.goodId)}. Prices have crashed.`, end: (n, ev) => `The ${goodName(ev.goodId)} glut at ${n} has cleared.`,
    effect: ev => `${goodName(ev.goodId)} very cheap` },
  blockade: { name: 'Blockade', weight: 1, filter: s => s.authority !== 'Independent', goods: 'all', days: [12, 25],
    start: (n, ev) => `The ${factionName(ev.blockader)} has blockaded ${n}. Supplies are short and prices are high.`, end: n => `The blockade of ${n} has been lifted.`,
    effect: ev => `blockaded by the ${factionName(ev.blockader)}, all prices high` },
  surge: { name: 'Pirate surge', weight: 1, region: true, days: [15, 30],
    start: n => `Pirate raids are surging across the ${n}.`, end: n => `Pirate raids in the ${n} have died down.`,
    effect: 'more pirate attacks' },
};

export function ensureWorld(st) {
  if (!st.world) st.world = { events: [], wars: [], control: {}, news: [], newsSeen: 0, newsCount: 0, lastDay: st.day, lastWarDay: -30, nextId: 1 };
}

// Re-apply border changes from wars to a freshly generated galaxy.
export function applyControl(g, st) {
  if (!st.world) return;
  for (const [id, c] of Object.entries(st.world.control)) Object.assign(g.systems[Number(id)], c);
}

export function news(text) {
  const w = api.state().world;
  w.newsCount = (w.newsCount || 0) + 1;
  w.news.unshift({ id: w.newsCount, day: api.state().day, text });
  if (w.news.length > 30) w.news.length = 30;
}

export const controllerOf = sys => (sys.authority === 'Concord' ? 'concord' : sys.authority === 'Independent' ? null : clanKey(sys.clan));

function eventPlaceName(ev) {
  const g = api.galaxy();
  return ev.region != null ? g.regions[ev.region].name : g.systems[ev.sys].name;
}

function spawnEvent() {
  const st = api.state(), g = api.galaxy(), w = st.world;
  const types = Object.entries(TYPES);
  let r = Math.random() * types.reduce((s, [, t]) => s + t.weight, 0);
  let typeId = types[0][0];
  for (const [id, t] of types) { r -= t.weight; if (r <= 0) { typeId = id; break; } }
  const t = TYPES[typeId];
  const ev = { id: w.nextId++, type: typeId, start: st.day, end: st.day + rint(t.days[0], t.days[1]) };
  if (t.region) {
    const regs = g.regions.filter(x => x.kind !== 'core' && !w.events.some(e => e.type === 'surge' && e.region === x.id));
    if (!regs.length) return;
    ev.region = pick(regs).id;
  } else {
    const pool = g.systems.filter(s => t.filter(s) && !w.events.some(e => e.sys === s.id));
    if (!pool.length) return;
    const s = pick(pool);
    ev.sys = s.id;
    if (typeId === 'glut') ev.goodId = pick(GOODS.filter(x => !x.illegal)).id;
    if (typeId === 'blockade') ev.blockader = s.authority === 'Concord' ? clanKey(s.clan) : 'concord';
  }
  w.events.push(ev);
  news(t.start(eventPlaceName(ev), ev));
}

// ---------- wars ----------
function sideSystems(key) {
  return api.galaxy().systems.filter(s => controllerOf(s) === key);
}

// The systems on each side closest to the other side.
export function fronts(war) {
  const g = api.galaxy();
  const res = {};
  for (const [mine, theirs] of [[war.a, war.b], [war.b, war.a]]) {
    const dist = new Array(g.systems.length).fill(Infinity);
    const q = [];
    for (const s of sideSystems(theirs)) { dist[s.id] = 0; q.push(s.id); }
    while (q.length) {
      const c = q.shift();
      for (const { to } of g.adj[c]) if (dist[to] === Infinity) { dist[to] = dist[c] + 1; q.push(to); }
    }
    res[mine] = sideSystems(mine).filter(s => dist[s.id] < Infinity).sort((x, y) => dist[x.id] - dist[y.id]).slice(0, 4).map(s => s.id);
  }
  return res;
}

export function frontWarAt(sysId) {
  const w = api.state().world;
  for (const war of w.wars) {
    const f = fronts(war);
    if (f[war.a].includes(sysId) || f[war.b].includes(sysId)) return war;
  }
  return null;
}

export function declareWar() {
  const st = api.state(), w = st.world;
  const clans = Object.keys(st.rep.clans).map(clanKey).filter(k => sideSystems(k).length);
  const busy = new Set(w.wars.flatMap(x => [x.a, x.b]));
  let a, b;
  if (Math.random() < 0.6 && !busy.has('concord')) {
    a = 'concord';
    const free = clans.filter(k => !busy.has(k));
    if (!free.length) return;
    b = pick(free);
  } else {
    const free = clans.filter(k => !busy.has(k));
    if (free.length < 2) return;
    a = pick(free);
    b = pick(free.filter(k => k !== a));
  }
  const war = { id: w.nextId++, a, b, score: 0, start: st.day, end: st.day + rint(50, 80) };
  w.wars.push(war);
  w.lastWarDay = st.day;
  news(`War! The ${factionName(a)} and the ${factionName(b)} are at war. Front-line systems need weapons, metals and medicine.`);
}

function setControl(sysId, key) {
  const st = api.state(), g = api.galaxy();
  const c = key === 'concord'
    ? { authority: 'Concord', security: 'medium' }
    : { authority: `${clanOf(key)} clan`, clan: clanOf(key), security: 'low' };
  st.world.control[sysId] = { ...(st.world.control[sysId] || {}), ...c };
  Object.assign(g.systems[sysId], c);
  if (st.systems[sysId]) st.systems[sysId].board = null;
}

function endWar(war, i) {
  const st = api.state(), g = api.galaxy(), w = st.world;
  w.wars.splice(i, 1);
  if (Math.abs(war.score) < 15) { news(`The war between the ${factionName(war.a)} and the ${factionName(war.b)} ends in a stalemate.`); return; }
  const winner = war.score > 0 ? war.a : war.b;
  const loser = winner === war.a ? war.b : war.a;
  const taken = fronts(war)[loser].slice(0, Math.abs(war.score) >= 70 ? 3 : Math.abs(war.score) >= 40 ? 2 : 1);
  for (const id of taken) setControl(id, winner);
  news(`The ${factionName(winner)} wins its war against the ${factionName(loser)}${taken.length ? ` and takes ${taken.map(id => g.systems[id].name).join(', ')}` : ''}.`);
}

function tickWars() {
  const st = api.state(), w = st.world;
  for (let i = w.wars.length - 1; i >= 0; i--) {
    const war = w.wars[i];
    const bias = war.a === 'concord' ? 0.3 : 0;
    war.score = Math.max(-100, Math.min(100, war.score + (Math.random() * 6 - 3) + bias));
    if (Math.abs(war.score) >= 100 || st.day >= war.end) endWar(war, i);
  }
  if (w.wars.length < 2 && st.day - w.lastWarDay >= 25 && Math.random() < 0.025) declareWar();
}

// Your contracts push a war's score toward the side you helped.
export function warContribution(side, enemy, amount) {
  const war = api.state().world.wars.find(x => (x.a === side && x.b === enemy) || (x.b === side && x.a === enemy));
  if (!war) return null;
  war.score = Math.max(-100, Math.min(100, war.score + (war.a === side ? amount : -amount)));
  return war;
}

export function warStatus(war) {
  const s = war.score;
  const lead = s > 0 ? war.a : war.b;
  const m = Math.abs(s);
  if (m < 15) return 'evenly matched';
  return `the ${factionName(lead)} ${m >= 60 ? 'is winning decisively' : m >= 35 ? 'has the upper hand' : 'is slightly ahead'}`;
}

// ---------- daily update ----------
export function advanceWorld() {
  const st = api.state(), w = st.world;
  const g = api.galaxy();
  if (!w.seeded) {
    w.seeded = true;
    for (let i = 0; i < 4; i++) spawnEvent();
    w.lastWarDay = st.day - 15;
  }
  while (w.lastDay < st.day) {
    w.lastDay++;
    for (let i = w.events.length - 1; i >= 0; i--) {
      const ev = w.events[i];
      if (w.lastDay > ev.end) {
        w.events.splice(i, 1);
        news(TYPES[ev.type].end(eventPlaceName(ev), ev));
      }
    }
    if (w.events.length < 7 && Math.random() < 0.13) spawnEvent();
    tickWars();
  }
  void g;
}

// Headlines you haven't heard yet.
export function freshNews() {
  const w = api.state().world;
  const fresh = w.news.filter(n => n.id > w.newsSeen);
  w.newsSeen = w.newsCount || 0;
  return fresh.slice(0, 3).map(n => n.text);
}

// ---------- effects ----------
export function priceMult(st, sys, goodId) {
  if (!st.world) return 1;
  let m = 1;
  for (const ev of st.world.events) {
    if (ev.sys !== sys.id) continue;
    const t = TYPES[ev.type];
    if (ev.type === 'glut' && ev.goodId === goodId) m *= 0.55;
    else if (t.goods === 'all') m *= 1.35;
    else if (t.goods && t.goods[goodId]) m *= t.goods[goodId];
  }
  if (api && api.galaxy() && st.world.wars.length && frontWarAt(sys.id)) {
    m *= { weapons: 1.8, metals: 1.5, medicine: 1.4, food: 1.2, machinery: 1.3 }[goodId] || 1;
  }
  return m;
}

export function blockadeAt(sysId) {
  return api.state().world.events.find(e => e.type === 'blockade' && e.sys === sysId) || null;
}

export function surgeAt(sys) {
  return api.state().world.events.some(e => e.type === 'surge' && e.region === sys.region);
}

export function eventsAt(sysId) {
  return api.state().world.events.filter(e => e.sys === sysId).map(e => TYPES[e.type].name.toLowerCase());
}

export function eventList() {
  return api.state().world.events.map(ev => {
    const t = TYPES[ev.type];
    return { ev, name: t.name, place: eventPlaceName(ev), effect: typeof t.effect === 'function' ? t.effect(ev) : t.effect, sys: ev.sys, region: ev.region };
  });
}
