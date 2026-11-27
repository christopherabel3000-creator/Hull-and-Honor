// Named officers with roles, skills, personalities and personal favors.
import { GOODS, hopCounts } from './galaxy.js';
import { clanKey } from './reputation.js';

let api = null; // { state(), galaxy() }
export function initOfficers(a) { api = a; }

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

export const ROLES = {
  firstmate: { name: 'first mate', skill: 'leadership' },
  pilot: { name: 'pilot', skill: 'piloting' },
  gunner: { name: 'gunner', skill: 'gunnery' },
  engineer: { name: 'engineer', skill: 'repairs' },
  navigator: { name: 'navigator', skill: 'navigation' },
  quartermaster: { name: 'quartermaster', skill: 'trading' },
};

export const TRAITS = {
  lawful: 'lawful: hates piracy and smuggling',
  outlaw: 'outlaw: dislikes Concord work',
  merciful: 'merciful: hates cruelty to the defeated',
  bloodthirsty: 'bloodthirsty: likes a kill, dislikes mercy',
  brave: 'brave: loves a victory, hates running',
  cautious: 'cautious: hates losing the ship, fine with running',
  greedy: 'greedy: wants to be paid, on time and well',
  loyal: 'loyal: slow to anger',
  ambitious: 'ambitious: will ask for raises',
};
const OPPOSED = [['lawful', 'outlaw'], ['merciful', 'bloodthirsty'], ['brave', 'cautious']];

const FIRST = ['Ines', 'Dax', 'Marisol', 'Tobin', 'Yara', 'Fenwick', 'Lio', 'Agnes', 'Ravi', 'Bex', 'Soren', 'Mina', 'Caspian', 'Wren', 'Olu', 'Greta', 'Haruto', 'Nell'];
const LAST = ['Rhee', 'Castillo', 'Abernathy', 'Nakamura', 'Osei', 'Kowalski', 'Ferro', 'Lund', 'Mbeki', 'Varga', 'Delacroix', 'Pike'];

export function ensureOfficers(st) {
  if (!st.officers) st.officers = [];
  if (st.nextOfficerId == null) st.nextOfficerId = 1;
}

export const MAX_OFFICERS = Object.keys(ROLES).length;
const moraleOk = o => o.morale >= 25;

// Skill bonus officers add to the captain's own level.
export function officerBonus(skill) {
  const st = api.state();
  if (!st.officers) return 0;
  let b = 0;
  for (const o of st.officers) if (ROLES[o.role].skill === skill) b += moraleOk(o) ? o.level : Math.floor(o.level / 2);
  return b;
}

export const officerWages = () => (api.state().officers || []).reduce((s, o) => s + o.wage, 0);

export function moraleName(m) {
  return m >= 75 ? 'devoted' : m >= 55 ? 'happy' : m >= 35 ? 'content' : m >= 20 ? 'unhappy' : 'ready to quit';
}

function makeCandidate(sys) {
  const st = api.state();
  const filled = new Set(st.officers.map(o => o.role));
  const open = Object.keys(ROLES).filter(r => !filled.has(r));
  const role = pick(open.length && Math.random() < 0.8 ? open : Object.keys(ROLES));
  const level = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : Math.random() < 0.7 ? 3 : 4;
  const traits = [];
  const lean = sys.authority === 'Concord' ? 'lawful' : sys.authority === 'Independent' ? null : 'outlaw';
  if (lean && Math.random() < 0.6) traits.push(lean);
  while (traits.length < (Math.random() < 0.5 ? 1 : 2)) {
    const t = pick(Object.keys(TRAITS));
    if (traits.includes(t)) continue;
    if (OPPOSED.some(([a, b]) => (t === a && traits.includes(b)) || (t === b && traits.includes(a)))) continue;
    traits.push(t);
  }
  const wage = 6 + level * 5 + (traits.includes('greedy') ? 4 : 0);
  return { id: st.nextOfficerId++, name: `${pick(FIRST)} ${pick(LAST)}`, role, level, traits, wage, signing: level * 350, morale: 60 };
}

export function officerBoard(sysState, sys) {
  const st = api.state();
  if (!sysState.officerBoard || st.day - sysState.officerBoard.day >= 6) {
    const n = sys.security === 'none' ? rint(0, 2) : rint(1, 3);
    sysState.officerBoard = { day: st.day, list: Array.from({ length: n }, () => makeCandidate(sys)) };
  }
  return sysState.officerBoard.list;
}

export function hireOfficer(sysState, id, out) {
  const st = api.state();
  const c = sysState.officerBoard.list.find(x => x.id === id);
  if (!c) return false;
  if (st.officers.some(o => o.role === c.role)) { out.push(`You already have a ${ROLES[c.role].name}. Dismiss them first.`); return false; }
  if (st.credits < c.signing) { out.push(`${c.name} wants a ${c.signing} credit signing bonus.`); return false; }
  st.credits -= c.signing;
  sysState.officerBoard.list = sysState.officerBoard.list.filter(x => x !== c);
  st.officers.push({ ...c, hiredDay: st.day, lastAsk: st.day, questDone: false });
  out.push(`${c.name} signs on as your ${ROLES[c.role].name}.`);
  return true;
}

export function dismissOfficer(id, out) {
  const st = api.state();
  const o = st.officers.find(x => x.id === id);
  if (!o) return;
  st.officers = st.officers.filter(x => x !== o);
  st.missions = st.missions.filter(m => !(m.type === 'personal' && m.officerId === o.id));
  out.push(`${o.name} leaves your ship.`);
}

// ---------- reactions ----------
const REACT = {
  piracy: { lawful: -10, outlaw: 4 },
  smuggle: { lawful: -5, outlaw: 2 },
  lawful: { outlaw: -5, lawful: 3 },
  atrocity: { merciful: -15, bloodthirsty: 4, lawful: -4 },
  mercy: { merciful: 5, bloodthirsty: -4 },
  victory: { brave: 4, bloodthirsty: 2, all: 1 },
  fled: { brave: -5, cautious: 2 },
  lost: { cautious: -10, all: -8 },
  unpaid: { greedy: -10, all: -5 },
  profit: { greedy: 2 },
  surrender: { brave: -8, all: -4 },
};
const WORDS = {
  piracy: ['approves of the raid', 'is disgusted by the piracy'],
  smuggle: ['likes the easy money', 'disapproves of the smuggling'],
  lawful: ['is proud to serve the law', 'grumbles about doing the Concord’s work'],
  atrocity: ['grins at the kill', 'is sickened by what you did'],
  mercy: ['respects your mercy', 'thinks mercy is weakness'],
  victory: ['is fired up by the victory', ''],
  fled: ['is relieved you got away', 'is ashamed you ran'],
  lost: ['', 'blames you for losing the ship'],
  unpaid: ['', 'is furious about the missing wages'],
  profit: ['likes the profits', ''],
  surrender: ['', 'is ashamed you surrendered'],
};

export function officerReact(kind, msgs) {
  const st = api.state();
  if (!st.officers || !st.officers.length) return;
  const table = REACT[kind];
  let loudest = null;
  for (const o of st.officers) {
    let d = table.all || 0;
    for (const t of o.traits) if (table[t]) d += table[t];
    if (d < 0 && o.traits.includes('loyal')) d = Math.round(d / 2);
    if (!d) continue;
    o.morale = Math.max(0, Math.min(100, o.morale + d));
    if (!loudest || Math.abs(d) > Math.abs(loudest.d)) loudest = { o, d };
  }
  if (loudest && Math.abs(loudest.d) >= 4 && msgs) {
    const w = WORDS[kind][loudest.d > 0 ? 0 : 1];
    if (w) msgs.push(`Your ${ROLES[loudest.o.role].name}, ${loudest.o.name}, ${w}.`);
  }
}

// Officers who have had enough leave at port.
export function officerDepartures(msgs) {
  const st = api.state();
  for (const o of [...st.officers]) {
    if (o.morale < 20) {
      dismissOfficer(o.id, []);
      msgs.push(`Your ${ROLES[o.role].name}, ${o.name}, has had enough and leaves the ship.`);
    }
  }
}

export function raiseCandidate() {
  const st = api.state();
  return (st.officers || []).find(o => (o.traits.includes('ambitious') || o.traits.includes('greedy')) && st.day - o.lastAsk >= 25) || null;
}

// ---------- personal favors ----------
export function maybePersonalFavor(msgs) {
  const st = api.state(), g = api.galaxy();
  for (const o of st.officers) {
    if (o.questDone || o.questActive || st.day - o.hiredDay < 25 || Math.random() >= 0.12) continue;
    const hops = hopCounts(g, st.location);
    const near = (lo, hi, f = () => true) => {
      const pool = g.systems.filter(s => hops[s.id] >= lo && hops[s.id] <= hi && f(s));
      return pool.length ? pick(pool) : null;
    };
    const sub = pick(['visit', 'fight', 'gift']);
    const m = { id: st.nextMissionId++, type: 'personal', sub, officerId: o.id, faction: 'guild', tier: 0, origin: st.location, units: 0, pay: 0, deadline: 99999 };
    let dest;
    if (sub === 'visit') { dest = near(3, 6); m.title = `Take ${o.name} home to ${dest && dest.name} for a family matter`; }
    if (sub === 'fight') {
      dest = near(3, 6, s => s.security === 'low' || s.security === 'none');
      m.enemy = o.level >= 3 ? 'marauder' : 'raider';
      m.enemyFaction = dest ? clanKey(dest.clan) : null;
      m.enemyName = `pirate ${pick(['Gutter', 'Slake', 'Morrow', 'Knuckles', 'Vane'])}'s ${m.enemy}`;
      m.title = `Help ${o.name} settle an old score with a pirate at ${dest && dest.name}`;
    }
    if (sub === 'gift') {
      dest = near(2, 5);
      m.goodId = pick(['luxuries', 'medicine', 'textiles']);
      m.units = 4; m.deliverOnly = true;
      m.title = `Bring 4 ${GOODS.find(x => x.id === m.goodId).name.toLowerCase()} to ${o.name}'s family at ${dest && dest.name}`;
    }
    if (!dest) continue;
    m.dest = dest.id;
    o.questActive = true;
    st.missions.push(m);
    msgs.push(`Your ${ROLES[o.role].name}, ${o.name}, asks a personal favor: ${m.title}. See Contracts.`);
    return;
  }
}

export function personalDone(m, msgs) {
  const st = api.state();
  st.missions = st.missions.filter(x => x !== m);
  const o = st.officers.find(x => x.id === m.officerId);
  if (!o) return;
  o.questActive = false;
  o.questDone = true;
  o.level = Math.min(5, o.level + 1);
  o.morale = Math.min(100, o.morale + 25);
  msgs.push(`${o.name} is deeply grateful. Their skill rises to ${o.level}, and they're devoted to you.`);
}

export function personalAbandoned(m, msgs) {
  const st = api.state();
  st.missions = st.missions.filter(x => x !== m);
  const o = st.officers.find(x => x.id === m.officerId);
  if (!o) return;
  o.questActive = false;
  o.questDone = true;
  o.morale = Math.max(0, o.morale - 30);
  msgs.push(`${o.name} won't forget that you let them down.`);
}
