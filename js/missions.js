import { GOODS, ECONOMIES, jumpCost, shortestPath, hopCounts } from './galaxy.js';
import { clanKey, getRep, accessTier } from './reputation.js';

export const MAX_ACTIVE = 5;
export const BOARD_REFRESH_DAYS = 4;
const TIER_HOPS = [[2, 4], [3, 6], [4, 8], [5, 10]];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = n => Math.floor(Math.random() * n);
const round10 = v => Math.max(10, Math.round(v / 10) * 10);

export function offices(sys) {
  if (sys.authority === 'Concord') return ['guild', 'concord'];
  if (sys.authority === 'Independent') return ['guild', 'pirate'];
  return ['pirate'];
}

export function officeName(office, sys) {
  if (office === 'guild') return 'Merchant Guild office';
  if (office === 'concord') return 'Concord navy post';
  return `Back-room contact, ${sys.clan} clan`;
}

export const officeFaction = (office, sys) => (office === 'pirate' ? clanKey(sys.clan) : office);

// Cargo space a contract takes up in your hold.
export const missionSpace = m => (['freight', 'dispatch', 'smuggle'].includes(m.type) ? m.units : 0);
export const COMBAT_TYPES = ['patrol', 'bounty', 'raid'];

const CAPTAIN_FIRST = ['Vex', 'Mara', 'Dask', 'Iolo', 'Reth', 'Sable', 'Kain', 'Orra', 'Tamsin', 'Bram', 'Juno', 'Corvin', 'Nyla', 'Hask'];
const CAPTAIN_LAST = ['Varn', 'the Grey', 'Kesh', 'Halloway', 'Blackwater', 'Ashby', 'Morrow', 'Quill', 'Dray', 'the Knife', 'Stroud', 'Okonkwo'];

export function missionEnemy(m) {
  if (m.type === 'patrol') return ['cutter', Math.random() < 0.5 ? 'cutter' : 'raider', 'raider', 'marauder'][m.tier];
  if (m.type === 'bounty') return ['raider', 'marauder', 'flagship', 'flagship'][m.tier];
  if (m.type === 'raid') return ['hauler', 'hauler', 'convoy', 'convoy'][m.tier];
  return null;
}
export const isContraband = m => m.type === 'smuggle';

function routeDays(galaxy, path, tank) {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const lane = galaxy.adj[path[i]].find(l => l.to === path[i + 1]);
    d += jumpCost(lane.ly, tank).days;
  }
  return d;
}

function rndTier() {
  const r = Math.random() * 10;
  return r < 4 ? 0 : r < 7 ? 1 : r < 8.8 ? 2 : 3;
}

function okDest(type, s) {
  if (type === 'dispatch') return s.authority === 'Concord';
  if (type === 'patrol' || type === 'bounty') return s.security === 'low' || s.security === 'none';
  if (type === 'raid') return (s.authority === 'Concord' || s.authority === 'Independent') && s.security !== 'high';
  return s.authority === 'Concord' || s.authority === 'Independent';
}

function makeMission(state, galaxy, sys, hops, office, type, forceTier) {
  const tier = forceTier ?? rndTier();
  const faction = officeFaction(office, sys);
  const base = { id: state.nextMissionId++, type, faction, tier, origin: sys.id, office };

  if (type === 'procure') {
    const wanted = pick(ECONOMIES[sys.economy].demands);
    const g = GOODS.find(x => x.id === wanted);
    const units = 5 + tier * 3 + rint(3);
    return { ...base, dest: sys.id, goodId: g.id, units, pay: round10(g.base * units * (1.45 + 0.1 * tier)), deadline: state.day + 12 + tier * 4 };
  }

  const [lo, hi] = TIER_HOPS[tier];
  const cands = galaxy.systems.filter(s => hops[s.id] >= lo && hops[s.id] <= hi && okDest(type, s));
  if (!cands.length) return null;
  const dest = pick(cands);
  const path = shortestPath(galaxy, sys.id, dest.id);
  const h = path.length - 1;
  const days = routeDays(galaxy, path, state.ship.tank);
  const mult = 1 + 0.35 * tier;

  if (type === 'freight') {
    const units = 4 + tier * 3 + rint(4);
    return { ...base, dest: dest.id, units, pay: round10((40 * h + 6 * units) * mult), deadline: state.day + Math.ceil(days * 1.6) + 3 };
  }
  if (type === 'escort') {
    return { ...base, dest: dest.id, units: 0, pay: round10(60 * h * mult), deadline: state.day + Math.ceil(days * 1.6) + 3 };
  }
  if (type === 'patrol') {
    const count = [1, 2, 2, 3][tier];
    return { ...base, dest: dest.id, units: 0, count, pay: round10((50 * h + 170 * count) * mult), deadline: state.day + Math.ceil(days * 1.5) + 6 };
  }
  if (type === 'bounty') {
    const target = `${pick(CAPTAIN_FIRST)} ${pick(CAPTAIN_LAST)}`;
    return { ...base, dest: dest.id, units: 0, target, targetClan: dest.clan, pay: round10((320 + 60 * h) * mult), deadline: state.day + Math.ceil(days * 1.5) + 8 };
  }
  if (type === 'raid') {
    return { ...base, dest: dest.id, units: 0, pay: round10((100 * h + 220) * mult), deadline: state.day + Math.ceil(days * 1.5) + 5 };
  }
  if (type === 'dispatch') {
    return { ...base, dest: dest.id, units: 1, pay: round10(75 * h * mult), deadline: state.day + Math.ceil(days * 1.3) + 2 };
  }
  // smuggling
  const units = 2 + tier * 2 + rint(2);
  const risky = dest.authority === 'Concord';
  return { ...base, dest: dest.id, units, pay: round10((90 * h + 30 * units) * mult * (risky ? 1.4 : 1)), deadline: state.day + Math.ceil(days * 1.5) + 3 };
}

export function generateBoard(state, galaxy, sys) {
  const hops = hopCounts(galaxy, sys.id);
  const list = [];
  for (const office of offices(sys)) {
    const types = office === 'guild' ? ['freight', 'freight', 'procure', 'escort']
      : office === 'concord' ? ['dispatch', 'patrol', 'bounty'] : ['smuggle', 'smuggle', 'raid'];
    const n = 3 + rint(2);
    for (let i = 0; i < n; i++) {
      // The first contract at each office is always entry level.
      const m = makeMission(state, galaxy, sys, hops, office, pick(types), i === 0 ? 0 : undefined);
      if (m) list.push(m);
    }
  }
  return list;
}

export function canTake(state, m) {
  return accessTier(getRep(state, m.faction)) >= m.tier;
}

export function missionTitle(m, galaxy) {
  const dest = galaxy.systems[m.dest].name;
  switch (m.type) {
    case 'freight': return `Haul ${m.units} crates of Guild freight to ${dest}`;
    case 'dispatch': return `Carry sealed Concord dispatches to ${dest}`;
    case 'smuggle': return `Smuggle ${m.units} crates of contraband to ${dest}`;
    case 'story': return m.title;
    case 'escort': return `Escort a Guild convoy to ${dest}`;
    case 'patrol': return `Clear ${m.count === 1 ? '1 pirate ship' : `${m.count} pirate ships`} from ${dest}`;
    case 'bounty': return `Hunt the pirate captain ${m.target} at ${dest}`;
    case 'raid': return `Raid a Guild convoy passing through ${dest}`;
    case 'procure': return `Bring ${m.units} ${GOODS.find(g => g.id === m.goodId).name} to ${dest}`;
  }
  return 'Contract';
}
