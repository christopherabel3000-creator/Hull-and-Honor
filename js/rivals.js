// Rival captains: named characters who travel, grow, compete and remember.
import { clanKey, factionName } from './reputation.js';
import { hopCounts, shortestPath } from './galaxy.js';
import { makeEnemy } from './combat.js';

let api = null; // { state(), galaxy(), news(text) }
export function initRivals(a) { api = a; }

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const FIRST = ['Vesna', 'Corran', 'Idris', 'Mags', 'Talia', 'Brennick', 'Oona', 'Rook', 'Sefa', 'Darrow', 'Kit', 'Ysolde', 'Hollis', 'Juno', 'Anselm', 'Petra'];
const LAST = ['Vale', 'Drummond', 'Achebe', 'Harrow', 'Sato', 'Quinlan', 'Moreau', 'Steele', 'Okoro', 'Brask', 'Lindqvist', 'Marlowe'];
const SHIPS = ['Black Comet', 'Lucky Seven', 'Iron Saint', 'Wandering Star', 'Quiet Knife', 'Second Chance', 'Red Gull', 'Long Odds', 'Merciful', 'Hollow Moon', 'Last Word', 'Silver Widow'];

export const STYLES = {
  trader: { label: 'a rival trader', combat: false, kinds: ['hauler', 'hauler', 'hauler', 'convoy'], likes: s => s.authority === 'Concord' || s.authority === 'Independent' },
  smuggler: { label: 'a smuggler', combat: true, kinds: ['cutter', 'cutter', 'raider', 'raider', 'marauder'], likes: s => s.authority === 'Independent' || s.security === 'low' },
  pirate: { label: 'a pirate captain', combat: true, kinds: ['cutter', 'raider', 'raider', 'marauder', 'marauder', 'flagship'], likes: s => s.security === 'none' || s.security === 'low' },
  hunter: { label: 'a bounty hunter', combat: true, kinds: ['hunter'], likes: s => s.security === 'medium' || s.security === 'low' },
  officer: { label: 'a Concord navy captain', combat: true, kinds: ['patrol'], likes: s => s.authority === 'Concord' },
  mercenary: { label: 'a mercenary', combat: true, kinds: ['raider', 'raider', 'marauder', 'marauder', 'flagship'], likes: () => true },
};

export function ensureRivals(st) {
  if (st.rivals) return;
  const g = api.galaxy();
  const clans = Object.keys(st.rep.clans);
  const used = new Set();
  const uniq = (list, f) => { for (let i = 0; i < 50; i++) { const v = f ? f() : pick(list); if (!used.has(v)) { used.add(v); return v; } } return pick(list); };
  st.rivals = Object.keys(STYLES).map((style, i) => {
    const faction = { trader: 'guild', smuggler: clanKey(pick(clans)), pirate: clanKey(pick(clans)), hunter: 'concord', officer: 'concord', mercenary: clanKey(pick(clans)) }[style];
    const home = g.systems.filter(s => STYLES[style].likes(s));
    return {
      id: i + 1, style, faction,
      name: `${uniq(FIRST)} ${uniq(LAST)}`, ship: uniq(SHIPS),
      level: rint(1, 3), attitude: 0, loc: pick(home.length ? home : g.systems).id,
      nextMove: st.day + rint(1, 3), alive: true, met: false, seen: null, history: [],
    };
  });
}

export const rivalById = id => api.state().rivals.find(r => r.id === id);
export const aliveRivals = () => api.state().rivals.filter(r => r.alive);

export function attitudeName(a) {
  return a >= 60 ? 'ally' : a >= 25 ? 'friendly' : a > -25 ? 'neutral' : a > -60 ? 'hostile' : 'nemesis';
}
export const isCombat = r => STYLES[r.style].combat;

export function adjust(r, delta, note, msgs) {
  const before = attitudeName(r.attitude);
  r.attitude = Math.max(-100, Math.min(100, r.attitude + delta));
  if (note) { r.history.unshift({ day: api.state().day, note }); if (r.history.length > 6) r.history.length = 6; }
  const after = attitudeName(r.attitude);
  if (before !== after && msgs) {
    const t = { ally: 'is now your ally', friendly: 'now counts you as a friend', neutral: 'no longer has strong feelings about you', hostile: 'now holds a grudge against you', nemesis: 'has sworn to destroy you' }[after];
    msgs.push(`${r.name} ${t}.`);
  }
}

export function rivalShipKind(r) {
  const k = STYLES[r.style].kinds;
  return k[Math.min(k.length - 1, Math.floor((r.level - 1) / (10 / k.length)))];
}

export function rivalEnemy(r) {
  const e = makeEnemy(rivalShipKind(r), r.faction);
  const f = 1 + (r.level - 1) * 0.06;
  e.hull = e.hullMax = Math.round(e.hullMax * f);
  e.shield = e.shieldMax = Math.round(e.shieldMax * f);
  e.crew = e.crewMax = Math.round(e.crewMax * f);
  e.skill = Math.round((e.skill + r.level * 0.03) * 100) / 100;
  e.name = `the ${r.ship}, ${r.name}'s ${e.name}`;
  e.captain = r.name;
  e.rivalId = r.id;
  return e;
}

export function seenAt(r) {
  const st = api.state();
  r.seen = { sys: r.loc, day: st.day };
  r.met = true;
}

// Daily movement and growth.
export function advanceRivals(day) {
  const st = api.state(), g = api.galaxy();
  for (const r of aliveRivals()) {
    if (Math.random() < 1 / 28 && r.level < 10) {
      r.level++;
      const kind = rivalShipKind(r);
      if (Math.random() < 0.5) api.news(`${r.name} of the ${r.ship} is making a name: now flying a ${kind === 'hauler' ? 'Guild hauler' : kind === 'convoy' ? 'heavily armed freighter' : kind.replace('patrol', 'Concord cutter')}.`);
    }
    if (day < r.nextMove) continue;
    r.nextMove = day + rint(2, 4);
    let next;
    if (r.attitude <= -60 && isCombat(r) && Math.random() < 0.6) {
      const path = shortestPath(g, r.loc, st.location);
      next = path && path.length > 1 ? path[1] : null;
    }
    if (next == null) {
      const lanes = g.adj[r.loc].map(l => l.to);
      const liked = lanes.filter(id => STYLES[r.style].likes(g.systems[id]));
      next = pick(liked.length && Math.random() < 0.8 ? liked : lanes);
    }
    r.loc = next;
  }
  if (Math.random() < 1 / 20) {
    const r = pick(aliveRivals());
    if (r) {
      const deed = {
        trader: `${r.name} of the ${r.ship} has landed a major Guild shipping contract.`,
        smuggler: `Rumor says ${r.name} of the ${r.ship} slipped a hold full of contraband past the Concord.`,
        pirate: `${r.name} of the ${r.ship} has raided a Guild convoy.`,
        hunter: `Bounty hunter ${r.name} of the ${r.ship} has brought in another wanted captain.`,
        officer: `Captain ${r.name} of the Concord ship ${r.ship} has broken up a pirate gang.`,
        mercenary: `Mercenary ${r.name} of the ${r.ship} has sold their guns to the highest bidder again.`,
      }[r.style];
      api.news(deed);
    }
  }
}

export function tickRivals() {
  const st = api.state();
  if (!st.rivals) return;
  if (st.rivalsDay == null) st.rivalsDay = st.day;
  while (st.rivalsDay < st.day) { st.rivalsDay++; advanceRivals(st.rivalsDay); }
}

export const rivalAt = sysId => aliveRivals().find(r => r.loc === sysId) || null;

export function nearbyAlly(maxHops = 3) {
  const st = api.state();
  const hops = hopCounts(api.galaxy(), st.location);
  return aliveRivals().find(r => r.attitude >= 60 && isCombat(r) && hops[r.loc] <= maxHops) || null;
}

export function styleLabel(r) { return STYLES[r.style].label; }
export function rivalFaction(r) { return factionName(r.faction); }
