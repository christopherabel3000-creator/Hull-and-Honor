import { generateGalaxy, GOODS, ECONOMIES, SECURITY_NAMES, jumpCost, shortestPath, hopCounts } from './galaxy.js';
import { sysState, refreshMarket, prices, nudge, recordNotes, tradeTag, fuelPrice, hasBlackMarket } from './economy.js';
import {
  ensureRep, factionKeys, getRep, changeRep, changeLocal, tierName, accessTier, factionName, TIER_REQUIREMENT,
  addNotoriety, notorietyName, dockingStatus, clanKey,
} from './reputation.js';
import {
  MAX_ACTIVE, BOARD_REFRESH_DAYS, offices, officeName, officeFaction, missionSpace, isContraband,
  generateBoard, canTake, missionTitle, COMBAT_TYPES, missionEnemy,
} from './missions.js';
import {
  RANGES, SYSTEMS, SYSTEM_STATE, WEAPONS, MAX_POWER_PER_SYSTEM, makeEnemy, effPower, usedPower, hitChance,
  resolveTurn, boardingOdds, oddsText, boardingFight, demandSurrenderChance,
} from './combat.js';
import {
  SHIP_CLASSES, WEAPON_PRICES, HEAVY_WEAPONS, UPGRADES, portKind, weaponSummary, classSummary,
  applyStats, buildShip, tradeInValue,
} from './ships.js';
import { ARCS, initStory, ensureStory, checkTriggers, acceptArc, declineArc, chooseOption, storyMissionDone, failArc, storyEntries } from './story.js';
import { initHoldings, ensureHoldings, tickHoldings, takePending, netWorth, storedUnits, WAREHOUSE_CAP, MAX_WAREHOUSES, warehouseCost, LINES, STATION_COST, STATION_UPGRADES } from './holdings.js';
import { startStarjack, starjackHit, starjackStand, bestCard, handTotal, startDice, diceRoll, diceStop, PIT_TIERS, startPit, pitRound } from './games.js';
import { WEAPON_GEAR, ARMOR_GEAR, ARMORY_COST, ARMORY_MAX, ensureGear, weaponBonus, armorBonus, boardingGearMult, armorSaveChance, soldHere } from './gear.js';
import { initOfficers, ensureOfficers, officerBonus, officerWages, moraleName, officerBoard, hireOfficer, dismissOfficer, officerReact, officerDepartures, maybePersonalFavor, personalDone, personalAbandoned, ROLES, TRAITS, MAX_OFFICERS } from './officers.js';
import { retireRival, initRivals, ensureRivals, tickRivals, rivalAt, rivalById, aliveRivals, adjust, rivalEnemy, seenAt, isCombat, attitudeName, nearbyAlly, styleLabel, rivalFaction, rivalShipKind } from './rivals.js';
import { initWorld, news as pushNews, ensureWorld, applyControl, advanceWorld, freshNews, fronts, frontWarAt, warContribution, warStatus, blockadeAt, surgeAt, eventsAt, eventList } from './world.js';
import { twistEvent, rivalMeetEvent, initEvents, rollEvent, startEvent, eventView, chooseEvent, startSalvage, salvageStep, finishSalvage, salvageDanger } from './events.js';

const SAVE_KEY = 'hullandhonor.save.v1';
const PREFIGHT_KEY = 'hullandhonor.prefight.v1';
const SLOT_COUNT = 3;
const slotKey = i => `hullandhonor.slot${i}.v1`;
function readKey(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
const WAGE = 2; // credits per crew member per day

function ensureShip(st) {
  const sh = st.ship;
  if (!sh.classId) sh.classId = 'mule';
  if (!sh.upgrades) sh.upgrades = [];
  if (!sh.weapons) sh.weapons = ['llaser', 'lcannon'];
  if (!sh.sys) sh.sys = { shields: 3, weapons: 3, engines: 3 };
  if (!sh.power) sh.power = { shields: 2, weapons: 2, engines: 2 };
  if (sh.crew == null) sh.crew = 6;
  applyStats(sh);
  if (!st.crew) st.crew = { loyalty: 60, lean: 0, skill: 1, owed: 0, lastBonusDay: -99 };
  if (!st.insurance) st.insurance = { plan: 'none', expires: 0, claims: 0 };
  if (st.debt == null) st.debt = 0;
  ensureSkills(st);
  ensureStory(st);
  if (!st.caches) st.caches = [];
  ensureWorld(st);
  ensureRivals(st);
  ensureOfficers(st);
  ensureHoldings(st);
  ensureGear(st);
}
function newStarterShip(crew = 6) {
  const ship = buildShip('mule');
  ship.crew = Math.min(crew, ship.crewMax);
  return ship;
}

const app = document.getElementById('app');
const isStory = m => m.type === 'story';
const isPersonal = m => m.type === 'personal';
const isSpecial = m => isStory(m) || isPersonal(m);
const isStoryFight = m => isSpecial(m) && !!m.enemy;
const contractCount = () => state.missions.filter(m => !isSpecial(m)).length;
const live = document.getElementById('live');

let state = null;
let galaxy = null;
initWorld({ state: () => state, galaxy: () => galaxy });
initOfficers({ state: () => state, galaxy: () => galaxy });
initHoldings({ state: () => state, galaxy: () => galaxy, news: t => pushNews(t), regionTrouble: id => !!(frontWarAt(id) || surgeAt(galaxy.systems[id]) || blockadeAt(id)) });
initRivals({ state: () => state, galaxy: () => galaxy, news: t => pushNews(t) });
initEvents({
  state: () => state, here: () => here(), sk: id => sk(id), gainXP: (id, n, o) => gainXP(id, n, o),
  receive: (n, o) => receive(n, o), charge: (n, o) => charge(n, o), morale: (d, o) => morale(d, o), conduct: (k, o) => conduct(k, o),
  freeCrewBerths: () => state.ship.crewMax - state.ship.crew, crewCount: () => state.ship.crew,
  addCrew: (n, lean) => {
    const c = state.crew, old = state.ship.crew, total = old + n;
    c.lean = Math.round((c.lean * old + lean * n) / total);
    c.loyalty = Math.round((c.loyalty * old + 60 * n) / total);
    state.ship.crew = total;
  },
  addCargo: (goodId, qty, cost = 0) => {
    const n = Math.max(0, Math.min(qty, freeSpace()));
    if (!n) return 0;
    const slot = state.cargo[goodId] || (state.cargo[goodId] = { qty: 0, cost: 0 });
    slot.qty += n; slot.cost += n * cost;
    return n;
  },
  freeSpace: () => freeSpace(),
  weaponBonus: () => weaponBonus(state),
  missionById: id => state.missions.find(m => m.id === id) || null,
  sysName: id => galaxy.systems[id].name,
  dropMission: (m, o, reason, penalty) => failMission(m, o, reason, penalty),
  completeWithPay: (m, mult, o) => { m.pay = Math.round(m.pay * mult / 10) * 10; completeMission(m, o); },
  localRep: (d, o) => changeLocal(state, galaxy, state.location, d, o),
  tip: o => {
    const list = eventList().filter(x => x.sys !== state.location);
    if (!list.length) { o.push('They have no news worth sharing.'); return; }
    const x = list[Math.floor(Math.random() * list.length)];
    o.push(`They tell you: ${x.name.toLowerCase()} at ${x.sys != null ? galaxy.systems[x.sys].name : `the ${x.place}`}, ${x.effect}.`);
  },
  hullDamage: n => { state.ship.hull = Math.max(1, state.ship.hull - n); },
  damageSystem: () => { const x = SYSTEMS[Math.floor(Math.random() * 3)]; state.ship.sys[x] = Math.max(0, state.ship.sys[x] - 1); return x; },
  passDays: (n, o) => { state.day += n; payWages(n, o); accrueInterest(n, o); checkDeadlines(o); refreshMarket(state, state.location); },
  carryingContraband: () => carryingContraband(),
  seizeContraband: o => seizeContraband(o),
  dumpContraband: o => {
    for (const g of GOODS) if (g.illegal) delete state.cargo[g.id];
    for (const m of [...state.missions]) if (isContraband(m)) failMission(m, o, 'cargo dumped', 4);
  },
  loseFuel: n => { state.fuel = Math.max(0, state.fuel - n); },
  loseCrew: (n, o) => { const k = Math.min(n, state.ship.crew); state.ship.crew -= k; if (k) o.push(k === 1 ? 'You lose a crew member.' : `You lose ${k} crew.`); },
  freeUpgradeSlot: () => state.ship.upgrades.length < state.ship.slots && Object.keys(UPGRADES).some(u => !state.ship.upgrades.includes(u)),
  grantUpgrade: () => {
    const opts = Object.keys(UPGRADES).filter(u => !state.ship.upgrades.includes(u));
    const id = opts[Math.floor(Math.random() * opts.length)];
    const hullWas = state.ship.hullMax;
    state.ship.upgrades.push(id);
    applyStats(state.ship);
    if (id === 'armor') state.ship.hull += state.ship.hullMax - hullWas;
    return UPGRADES[id].name.toLowerCase();
  },
  addCache: () => {
    const hops = hopCounts(galaxy, state.location);
    const pool = galaxy.systems.filter(x => hops[x.id] >= 2 && hops[x.id] <= 6 && !state.caches.includes(x.id));
    const dest = pool[Math.floor(Math.random() * pool.length)] || galaxy.systems[state.location];
    state.caches.push(dest.id);
    return dest.name;
  },
});
initStory({ state: () => state, galaxy: () => galaxy, receive: (n, msgs) => receive(n, msgs), charge: (n, msgs) => charge(n, msgs), log: m => log(m) });
const ui = { confirmDismiss: null, confirmSlot: null, view: 'bridge', confirmBuyShip: null, screen: 'title', confirmNew: false, confirmAbandon: null, confirmSurrender: false, priceGood: 'food', plotSelect: null, focus: null };

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const good = id => GOODS.find(g => g.id === id);

function announce(msg) {
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 60);
}
function log(msg) {
  state.log.unshift({ day: state.day, msg });
  if (state.log.length > 40) state.log.length = 40;
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

const here = () => galaxy.systems[state.location];
const cargoOnly = () => Object.values(state.cargo).reduce((s, c) => s + c.qty, 0);
const holdUsed = () => cargoOnly() + state.missions.reduce((s, m) => s + missionSpace(m), 0);
const freeSpace = () => state.ship.cargo - holdUsed();
const regionOf = sys => galaxy.regions[sys.region];
const docked = () => dockingStatus(state, here()).ok;
function describeSystem(sys) {
  return `${regionOf(sys).name}, ${SECURITY_NAMES[sys.security]}, ${sys.authority}, ${ECONOMIES[sys.economy].name.toLowerCase()} economy`;
}
function coursePath() {
  if (state.course == null || state.course === state.location) return null;
  return shortestPath(galaxy, state.location, state.course);
}
function carryingContraband() {
  return GOODS.some(g => g.illegal && state.cargo[g.id]) || state.missions.some(isContraband);
}
function getBoard(sys) {
  const s = sysState(state, sys.id);
  if (!s.board || state.day - s.board.day >= BOARD_REFRESH_DAYS) {
    s.board = { day: state.day, missions: generateBoard(state, galaxy, sys) };
    if (state.perks.guildCharter) for (const m of s.board.missions) if (m.faction === 'guild') m.pay = Math.round(m.pay * 1.25 / 10) * 10;
    const neg = 1.25 * (1 + sk('negotiation') * 0.02);
    s.board.missions.push(...warContracts(sys));
    for (const m of s.board.missions) m.pay = Math.round(m.pay * neg / 10) * 10;
  }
  return s.board.missions;
}

// War contracts for a faction's office at this port.
function warContracts(sys) {
  const out = [];
  const hops = hopCounts(galaxy, sys.id);
  const r10 = v => Math.max(10, Math.round(v / 10) * 10);
  for (const office of offices(sys)) {
    if (office === 'guild') continue;
    const fk = officeFaction(office, sys);
    for (const war of state.world.wars) {
      if (war.a !== fk && war.b !== fk) continue;
      const enemy = war.a === fk ? war.b : war.a;
      const f = fronts(war);
      const own = f[fk].filter(id => id !== sys.id && hops[id] < Infinity);
      const theirs = f[enemy].filter(id => id !== sys.id && hops[id] < Infinity);
      const base = { faction: fk, enemy, origin: sys.id, office, warId: war.id };
      if (own.length) {
        const tier = Math.floor(Math.random() * 3);
        const dest = own[Math.floor(Math.random() * own.length)];
        const units = 6 + tier * 3;
        out.push({ ...base, id: state.nextMissionId++, type: 'warsupply', tier, dest, units, pay: r10((55 * hops[dest] + 18 * units) * (1 + 0.3 * tier)), deadline: state.day + hops[dest] * 5 + 6 });
      }
      if (theirs.length) {
        const tier = Math.floor(Math.random() * 3);
        const dest = theirs[Math.floor(Math.random() * theirs.length)];
        const enemyKind = enemy === 'concord' ? (tier === 2 ? 'hunter' : 'patrol') : ['raider', 'marauder', 'marauder'][tier];
        out.push({ ...base, id: state.nextMissionId++, type: 'warstrike', tier, dest, units: 0, enemyKind, pay: r10((280 + 60 * hops[dest]) * (1 + 0.35 * tier)), deadline: state.day + hops[dest] * 5 + 8 });
      }
    }
  }
  return out;
}

// ---------- contracts ----------
function completeMission(m, msgs) {
  state.missions = state.missions.filter(x => x !== m);
  if (m.race) {
    const r = rivalById(m.race.rivalId);
    if (r && r.alive) {
      if (state.day > m.race.eta) { m.pay = Math.round(m.pay * 0.6 / 10) * 10; msgs.push(`${r.name} got there first. The client pays you less.`); adjust(r, 1, 'Beat you to a delivery.', msgs); }
      else { m.pay = Math.round(m.pay * 1.2 / 10) * 10; msgs.push(`You beat ${r.name} there, and the client pays a bonus.`); adjust(r, -3, 'You beat them to a delivery.', msgs); }
    }
  }
  if (m.rushBy != null) {
    if (state.day <= m.rushBy) { m.pay = Math.round(m.pay * 1.5 / 10) * 10; msgs.push('You made the rush deadline: a 50% bonus.'); }
    else msgs.push('You missed the rush deadline, so no bonus.');
  }
  msgs.push(`Contract complete: ${missionTitle(m, galaxy)}. Paid ${m.pay} credits.`);
  receive(m.pay, msgs);
  if (m.type === 'smuggle') {
    changeRep(state, m.faction, 4 + m.tier, msgs);
    for (const k of factionKeys(state)) if (k.startsWith('clan:') && k !== m.faction) changeRep(state, k, 1, msgs);
    if (galaxy.systems[m.dest].authority !== 'Concord') changeLocal(state, galaxy, m.dest, 2, msgs);
    addNotoriety(state, 1);
  } else if (m.type === 'raid') {
    changeRep(state, m.faction, 5 + m.tier, msgs);
    changeRep(state, 'guild', -3, msgs);
    addNotoriety(state, 2);
  } else if (m.type === 'warsupply' || m.type === 'warstrike') {
    changeRep(state, m.faction, 4 + m.tier, msgs);
    changeRep(state, m.enemy, -4, msgs);
    addNotoriety(state, 1);
    conduct(m.faction === 'concord' ? 'lawful' : 'smuggle', msgs);
    const war = warContribution(m.faction, m.enemy, 12);
    if (war) msgs.push(`Your work helps the ${factionName(m.faction)}. In the war, ${warStatus(war)}.`);
  } else if (m.type === 'patrol' || m.type === 'bounty') {
    changeRep(state, 'concord', 4 + m.tier, msgs);
    changeLocal(state, galaxy, m.dest, 4, msgs);
    addNotoriety(state, 1);
  } else if (m.type === 'dispatch') {
    changeRep(state, 'concord', 3 + m.tier, msgs);
    for (const k of factionKeys(state)) if (k.startsWith('clan:')) changeRep(state, k, -1, msgs);
    changeLocal(state, galaxy, m.dest, 3, msgs);
  } else {
    changeRep(state, 'guild', 3 + m.tier, msgs);
    changeLocal(state, galaxy, m.dest, 3, msgs);
    if (m.origin !== m.dest) changeLocal(state, galaxy, m.origin, 1, msgs);
  }
  if (m.tier >= 2) addNotoriety(state, m.tier - 1);
  morale(1, msgs);
  gainXP('negotiation', 2, msgs);
  if (m.type === 'smuggle') { conduct('smuggle', msgs); gainXP('deception', 5, msgs); }
  state.contractsDone++;
  if (state.contractsDone % 8 === 0) gainPoint(1, msgs, `completing ${state.contractsDone} contracts`);
  if (['dispatch', 'patrol', 'bounty'].includes(m.type)) conduct('lawful', msgs);
  log(`Completed: ${missionTitle(m, galaxy)} (${m.pay} credits).`);
}

function failMission(m, msgs, reason, penalty = 6 + m.tier) {
  state.missions = state.missions.filter(x => x !== m);
  msgs.push(`Contract failed, ${reason}: ${missionTitle(m, galaxy)}.`);
  changeRep(state, m.faction, -penalty, msgs);
  changeLocal(state, galaxy, m.origin, -4, msgs);
  log(`Failed (${reason}): ${missionTitle(m, galaxy)}.`);
}

function checkDeadlines(msgs) {
  for (const m of [...state.missions]) if (state.day > m.deadline) failMission(m, msgs, 'deadline missed');
}

function autoDeliver(msgs) {
  for (const m of [...state.missions]) {
    if (m.dest !== state.location) continue;
    if (isSpecial(m)) { if (!m.enemy && !m.deliverOnly) specialDone(m, msgs); continue; }
    if (m.type !== 'procure' && !COMBAT_TYPES.includes(m.type)) completeMission(m, msgs);
  }
}

function customsScan(sys, msgs) {
  if (sys.authority !== 'Concord' || !carryingContraband()) return;
  const chance = (sys.security === 'high' ? 0.45 : 0.25) * (state.ship.hidden ? 0.5 : 1) * (1 - sk('deception') * 0.05);
  if (Math.random() >= chance) {
    msgs.push('Customs waved you through.');
    gainXP('deception', 3, msgs);
    return;
  }
  msgs.push('Customs scans your ship.');
  seizeContraband(msgs);
}

function seizeContraband(msgs) {
  const sys = here();
  let value = 0;
  for (const g of GOODS) {
    if (g.illegal && state.cargo[g.id]) {
      value += state.cargo[g.id].qty * g.base;
      delete state.cargo[g.id];
    }
  }
  const seized = state.missions.filter(isContraband);
  for (const m of seized) value += m.units * 200;
  const fine = Math.min(state.credits, Math.round(value * 1.5));
  state.credits -= fine;
  msgs.push(`Your contraband is found and seized. Fined ${fine} credits.`);
  log(`Caught by customs at ${sys.name}. Fined ${fine} credits.`);
  changeRep(state, 'concord', -8, msgs);
  changeLocal(state, galaxy, sys.id, -10, msgs);
  addNotoriety(state, 3);
  for (const m of seized) failMission(m, msgs, 'cargo seized', 4);
}

// ---------- game actions ----------
function newGame(captain, ship, seedText, ironman) {
  const seed = seedText || String(Math.floor(Math.random() * 1e9));
  galaxy = generateGalaxy(seed);
  state = {
    version: 2, seed, day: 1, credits: 1500,
    captain: captain || 'Captain', shipName: ship || 'Wayfarer',
    ship: newStarterShip(), fuel: 12, crew: { loyalty: 60, lean: 0, skill: 1, owed: 0, lastBonusDay: -99 },
    location: galaxy.start, cargo: {}, systems: {}, course: null, log: [],
    ironman: !!ironman, insurance: { plan: 'none', expires: 0, claims: 0 }, debt: 0, arcs: {}, perks: {},
    skills: null, skillPoints: 3, contractsDone: 0, caches: [],
  };
  try { localStorage.removeItem(PREFIGHT_KEY); } catch (e) { /* ignore */ }
  ensureSkills(state);
  ensureWorld(state);
  ensureRep(state, galaxy);
  ensureRivals(state);
  ensureOfficers(state);
  ensureHoldings(state);
  ensureGear(state);
  arrive(galaxy.start);
  log(`${state.captain} takes command of the ${state.shipName} at ${here().name}.`);
  save();
  ui.screen = 'game';
  ui.focus = 'sys-heading';
  render();
  announce(`Welcome, Captain ${state.captain}. You are docked at ${here().name}.`);
}

function continueGame() {
  const saved = loadSave();
  if (!saved) return;
  state = saved;
  galaxy = generateGalaxy(state.seed);
  ensureRep(state, galaxy);
  ensureShip(state);
  applyControl(galaxy, state);
  refreshMarket(state, state.location);
  ui.screen = state.dead ? 'gameover' : 'game';
  ui.focus = state.dead ? 'over-heading' : state.mutiny ? 'mutiny-heading' : state.event ? 'event-heading' : state.salvage ? 'salvage-heading' : state.combat ? 'combat-heading' : 'sys-heading';
  render();
}

function arrive(id) {
  state.location = id;
  const s = sysState(state, id);
  s.visited = true;
  refreshMarket(state, id);
  if (dockingStatus(state, galaxy.systems[id]).ok) recordNotes(state, galaxy.systems[id]);
}

function buy(goodId, max) {
  const sys = here();
  const g = good(goodId);
  let bought = 0, spent = 0;
  for (;;) {
    if (freeSpace() <= 0) break;
    const p = prices(state, sys, g).buy;
    if (state.credits < p) break;
    state.credits -= p;
    spent += p;
    const c = state.cargo[goodId] || (state.cargo[goodId] = { qty: 0, cost: 0 });
    c.qty++;
    c.cost += p;
    nudge(state, sys.id, goodId, 1);
    bought++;
    if (!max) break;
  }
  if (!bought) {
    announce(freeSpace() <= 0 ? 'Your hold is full.' : 'Not enough credits.');
    return;
  }
  recordNotes(state, sys);
  log(`Bought ${bought} ${g.name} for ${spent} credits at ${sys.name}.`);
  save();
  render();
  announce(`Bought ${bought} ${g.name} for ${spent}. Credits ${state.credits}. Hold ${holdUsed()} of ${state.ship.cargo}.`);
}

function sell(goodId, all) {
  const sys = here();
  const g = good(goodId);
  const c = state.cargo[goodId];
  if (!c || !c.qty) return;
  let sold = 0, earned = 0, costBasis = 0;
  while (c.qty > 0) {
    const p = prices(state, sys, g).sell;
    const avg = c.cost / c.qty;
    state.credits += p;
    earned += p;
    costBasis += avg;
    c.cost -= avg;
    c.qty--;
    nudge(state, sys.id, goodId, -1);
    sold++;
    if (!all) break;
  }
  if (c.qty === 0) delete state.cargo[goodId];
  const profit = Math.round(earned - costBasis);
  const tmsgs = [];
  if (profit > 0) gainXP('trading', Math.ceil(profit / 150), tmsgs);
  if (profit > 500) officerReact('profit', tmsgs);
  recordNotes(state, sys);
  log(`Sold ${sold} ${g.name} for ${earned} credits at ${sys.name} (${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}).`);
  save();
  render();
  announce([`Sold ${sold} ${g.name} for ${earned}, ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}. Credits ${state.credits}.`, ...tmsgs].join(' '));
}

function sellAllCargo() {
  const sys = here();
  let earned = 0, profit = 0, n = 0;
  const msgs = [];
  for (const g of GOODS) {
    const c = state.cargo[g.id];
    if (!c || (g.illegal && !hasBlackMarket(sys))) continue;
    while (c.qty > 0) {
      const p = prices(state, sys, g).sell;
      const avg = c.cost / c.qty;
      earned += p; profit += p - avg; n++;
      state.credits += p; c.cost -= avg; c.qty--;
      nudge(state, sys.id, g.id, -1);
    }
    delete state.cargo[g.id];
  }
  if (!n) return;
  profit = Math.round(profit);
  if (profit > 0) gainXP('trading', Math.ceil(profit / 150), msgs);
  recordNotes(state, sys);
  log(`Sold ${n} units of cargo for ${earned} credits at ${sys.name}.`);
  save(); render();
  announce([`Sold ${n} units for ${earned}, ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}. Credits ${state.credits}.`, ...msgs].join(' '));
}

function serviceAll() {
  const sh = state.ship, sys = here();
  const msgs = [];
  let spent = 0;
  const fp = myFuelPrice(sys);
  while (state.fuel < sh.tank && state.credits >= fp) { state.fuel++; state.credits -= fp; spent += fp; }
  const hp = hullRepairPrice(sys);
  let hulls = 0;
  while (sh.hull < sh.hullMax && state.credits >= hp) { sh.hull++; state.credits -= hp; spent += hp; hulls++; }
  if (hulls) gainXP('repairs', 1, msgs);
  for (const x of SYSTEMS) while (sh.sys[x] < 3 && state.credits >= sysRepairPrice()) { sh.sys[x]++; state.credits -= sysRepairPrice(); spent += sysRepairPrice(); }
  const mp = MISSILE_PRICE;
  while (sh.missiles < sh.missilesMax && state.credits >= mp) { sh.missiles++; state.credits -= mp; spent += mp; }
  const done = state.fuel >= sh.tank && sh.hull >= sh.hullMax && SYSTEMS.every(x => sh.sys[x] === 3) && sh.missiles >= sh.missilesMax;
  save(); render();
  announce([spent ? `Spent ${spent} credits.` : 'Nothing needed.', done ? 'Your ship is fully serviced.' : 'You ran out of credits before everything was done.', ...msgs].join(' '));
}

function refuel(full, emergency) {
  const price = myFuelPrice(here()) * (emergency ? 3 : 1);
  let units = 0;
  while (state.fuel < state.ship.tank && state.credits >= price) {
    state.fuel++;
    state.credits -= price;
    units++;
    if (!full) break;
  }
  if (!units) {
    announce(state.fuel >= state.ship.tank ? 'Fuel tank is already full.' : 'Not enough credits for fuel.');
    return;
  }
  save();
  render();
  announce(`Bought ${plural(units, 'fuel unit')} for ${units * price}. Fuel ${state.fuel} of ${state.ship.tank}. Credits ${state.credits}.`);
}

function jump(to) {
  const lane = galaxy.adj[state.location].find(l => l.to === to);
  if (!lane) return;
  const cost = navCost(lane.ly);
  if (state.fuel < cost.fuel) {
    announce(`Not enough fuel. That jump needs ${cost.fuel}, you have ${state.fuel}.`);
    return;
  }
  const from = here();
  gainXP('navigation', 1 + Math.floor(lane.ly / 5));
  state.fuel -= cost.fuel;
  state.day += cost.days;
  advanceWorld(); tickRivals(); tickHoldings();
  ui.confirmAbandon = null;
  const msgs = [];
  payWages(cost.days, msgs);
  accrueInterest(cost.days, msgs);
  if (state.insurance.plan !== 'none' && state.day > state.insurance.expires) {
    msgs.push('Your insurance policy has lapsed.');
    state.insurance.plan = 'none';
  }
  checkDeadlines(msgs);
  arrive(to);
  const sys = here();
  msgs.unshift(`Arrived at ${sys.name} after ${plural(cost.days, 'day')}. Fuel ${state.fuel} of ${state.ship.tank}.`);
  log(`Jumped from ${from.name} to ${sys.name}.`);
  if (mutinyCheck()) { startMutiny(msgs); return; }
  const enc = missionEncounter(sys) || twistEncounter(sys, msgs) || blockadeEncounter(sys, msgs) || rivalEncounter(sys) || randomEncounter(sys);
  if (enc && enc.event) { beginEvent(enc.event, msgs); return; }
  if (enc && enc.message) msgs.push(enc.message);
  else if (enc) { startCombat(enc, true, msgs); return; }
  let ev = null;
  if (state.caches.includes(sys.id)) {
    state.caches = state.caches.filter(x => x !== sys.id);
    ev = startEvent('derelict', sys);
    ev.data.cache = true;
    msgs.push('You reach the coordinates from the black box.');
  } else ev = rollEvent(sys);
  if (ev) { beginEvent(ev, msgs); return; }
  finishArrival(msgs);
}

function finishArrival(msgs) {
  const sys = here();
  const dock = dockingStatus(state, sys);
  if (!dock.ok) {
    msgs.push(dock.reason);
  } else {
    customsScan(sys, msgs);
    if (dockingStatus(state, sys).ok) {
      autoDeliver(msgs);
      recordNotes(state, sys);
      crewArrivalChecks(msgs);
      officerDepartures(msgs);
      maybePersonalFavor(msgs);
      if (state.perks.clanLord && sys.clan === state.perks.clanLord && sys.authority.endsWith(' clan') && state.day - (state.perks.lastTribute || 0) >= 10) {
        state.perks.lastTribute = state.day;
        receive(800, msgs);
        msgs.push(`The ${sys.clan} clan pays you 800 credits of tribute.`);
      }
    }
  }
  if (state.course === state.location) {
    state.course = null;
    msgs.push('Destination reached.');
  }
  checkTriggers(sys, msgs);
  const held = takePending();
  if (held.length) msgs.push(`Holdings: ${held.join(' ')}`);
  const fresh = freshNews();
  if (fresh.length) msgs.push(`News: ${fresh.join(' ')}`);
  if (!msgs.length) msgs.push(`You are at ${sys.name}.`);
  save();
  ui.view = 'bridge';
  ui.game = null;
  ui.focus = 'sys-heading';
  render();
  announce(msgs.join(' '));
}

function plotTo(dest) {
  if (dest === state.location) { announce('You are already there.'); return; }
  state.course = dest;
  ui.plotSelect = String(dest);
  save();
  render();
  const path = coursePath();
  announce(`Course plotted to ${galaxy.systems[dest].name}: ${plural(path.length - 1, 'jump')}. Next jump: ${galaxy.systems[path[1]].name}.`);
}

function acceptMission(id) {
  const board = getBoard(here());
  const m = board.find(x => x.id === id);
  if (!m) return;
  if (!canTake(state, m)) { announce(`You need ${TIER_REQUIREMENT[m.tier]} standing with the ${factionName(m.faction)}.`); return; }
  if (contractCount() >= MAX_ACTIVE) { announce(`You can hold at most ${MAX_ACTIVE} contracts at once.`); return; }
  if (missionSpace(m) > freeSpace()) { announce(`Not enough hold space. This contract needs ${missionSpace(m)}, you have ${freeSpace()} free.`); return; }
  sysState(state, state.location).board.missions = board.filter(x => x !== m);
  state.missions.push(m);
  const TWISTS = {
    freight: { contraband: 3, doublecross: 2, rerouted: 2, rush: 2 },
    dispatch: { ambush: 3, rush: 3, rerouted: 1, doublecross: 1 },
    smuggle: { doublecross: 3, ambush: 2, rerouted: 1 },
    escort: { ambush: 4, rerouted: 1 },
    warsupply: { ambush: 3, rush: 2 },
  }[m.type];
  if (TWISTS && rand() < 0.3) m.twist = pickW(TWISTS);
  let raceMsg = '';
  if (['freight', 'dispatch', 'smuggle', 'warsupply'].includes(m.type)) {
    const present = rivalAt(state.location);
    const racer = present && (present.style === 'trader' || present.style === 'smuggler') ? present
      : rand() < 0.12 ? aliveRivals().filter(r => r.style === 'trader' || r.style === 'smuggler')[Math.floor(rand() * 2)] : null;
    if (racer) {
      const path = shortestPath(galaxy, state.location, m.dest);
      let days = 0;
      for (let i = 0; i < path.length - 1; i++) days += navCost(galaxy.adj[path[i]].find(l => l.to === path[i + 1]).ly).days;
      m.race = { rivalId: racer.id, eta: state.day + Math.max(1, Math.round(days * (0.85 + rand() * 0.4))) };
      raceMsg = ` ${racer.name} of the ${racer.ship} is racing you for the client's favor, expected to arrive around day ${m.race.eta}.`;
    }
  }
  log(`Accepted: ${missionTitle(m, galaxy)} (${m.pay} credits, due day ${m.deadline}).`);
  save();
  render();
  announce(`Accepted: ${missionTitle(m, galaxy)}. Due day ${m.deadline}.${raceMsg}`);
}

function deliverProcurement(id) {
  const m = state.missions.find(x => x.id === id);
  if (!m || m.dest !== state.location) return;
  const c = state.cargo[m.goodId];
  if (!c || c.qty < m.units) { announce(`You need ${m.units} ${good(m.goodId).name} in your hold.`); return; }
  c.cost -= (c.cost / c.qty) * m.units;
  c.qty -= m.units;
  if (c.qty <= 0) delete state.cargo[m.goodId];
  const msgs = [];
  if (isSpecial(m)) specialDone(m, msgs);
  else completeMission(m, msgs);
  save();
  render();
  announce(msgs.join(' '));
}

function abandonMission(id) {
  const m = state.missions.find(x => x.id === id);
  if (!m) return;
  if (ui.confirmAbandon !== id) {
    ui.confirmAbandon = id;
    render();
    announce(isPersonal(m) ? 'Abandoning this favor will hurt your officer badly. Press Confirm abandon to continue.' : isStory(m) ? 'Abandoning this objective ends the story for good. Press Confirm abandon to continue.' : `Abandoning costs standing with the ${factionName(m.faction)}. Press Confirm abandon to continue.`);
    return;
  }
  ui.confirmAbandon = null;
  const msgs = [];
  if (isPersonal(m)) personalAbandoned(m, msgs);
  else if (isStory(m)) failArc(m.arc, msgs, 'You abandoned it.');
  else failMission(m, msgs, 'abandoned');
  save();
  render();
  announce(msgs.join(' '));
}



// ---------- captain skills ----------
const SKILLS = {
  piloting: { name: 'Piloting', effect: l => `+${(l * 0.03).toFixed(2)} agility in combat, for dodging and controlling range` },
  gunnery: { name: 'Gunnery', effect: l => `+${l}% to hit with ship weapons` },
  repairs: { name: 'Repairs', effect: l => `emergency repairs restore ${3 + l * 2} hull with a ${40 + l * 6}% chance to fix a system; ${l * 3} hull patched after each fight; shipyard repairs ${l * 4}% cheaper` },
  dueling: { name: 'Dueling', effect: l => `your boarding parties fight ${l * 4}% better, attacking or defending` },
  leadership: { name: 'Leadership', effect: l => `crew loyalty gains ${l * 5}% bigger, losses ${l * 5}% smaller` },
  trading: { name: 'Trading', effect: l => `${l}% better buy and sell prices` },
  negotiation: { name: 'Negotiation', effect: l => `contracts pay ${l * 2}% more, insurance ${l * 2}% cheaper, demands to surrender ${l * 3}% likelier` },
  navigation: { name: 'Navigation', effect: l => `jumps use less fuel and time, ${l * 3}% fewer random encounters` },
  deception: { name: 'Deception', effect: l => `customs ${l * 5}% less likely to catch you, and better odds playing both sides` },
};
const SKILL_MAX = 10, TRAIN_MAX = 6;
const TRAINERS = {
  concord: ['piloting', 'gunnery', 'repairs', 'navigation', 'leadership', 'negotiation'],
  independent: ['trading', 'negotiation', 'repairs', 'navigation', 'deception'],
  clan: ['dueling', 'deception', 'gunnery', 'piloting', 'leadership'],
};
const xpNeeded = level => 10 + level * 10;
const sk = id => (state.skills && state.skills[id] ? state.skills[id].level : 0) + officerBonus(id);
function ensureSkills(st) {
  if (!st.skills) st.skills = {};
  for (const id of Object.keys(SKILLS)) if (!st.skills[id]) st.skills[id] = { level: 1, xp: 0 };
  if (st.skillPoints == null) st.skillPoints = 3;
  if (st.contractsDone == null) st.contractsDone = 0;
}
function gainXP(id, amount, msgs) {
  const s = state.skills[id];
  if (!s || s.level >= SKILL_MAX || amount <= 0) return;
  s.xp += amount;
  while (s.level < SKILL_MAX && s.xp >= xpNeeded(s.level)) {
    s.xp -= xpNeeded(s.level);
    s.level++;
    if (msgs) msgs.push(`Your ${SKILLS[id].name.toLowerCase()} skill rises to ${s.level}.`);
    log(`${SKILLS[id].name} rose to ${s.level}.`);
  }
  if (s.level >= SKILL_MAX) s.xp = 0;
}
function gainPoint(n, msgs, why) {
  state.skillPoints += n;
  msgs.push(`You earn ${plural(n, 'skill point')} for ${why}. Spend ${n === 1 ? 'it' : 'them'} in the Captain view.`);
}
// Copy captain skills onto the ship before combat math.
function applyCaptain() {
  const sh = state.ship;
  sh.pilotBonus = sk('piloting') * 0.03;
  sh.gunBonus = sk('gunnery') * 0.01;
  sh.repairSkill = sk('repairs');
  sh.negBonus = sk('negotiation') * 0.03;
  sh.skill = combatSkill() * (1 + sk('dueling') * 0.04) * boardingGearMult(state);
}
function navCost(ly) {
  const n = sk('navigation');
  return { fuel: Math.min(state.ship.tank, Math.max(1, Math.ceil(ly / (4 + n * 0.25)))), days: Math.max(1, Math.ceil(ly / (3 + n * 0.2))) };
}
function spendPoint(id) {
  const s = state.skills[id];
  if (state.skillPoints <= 0) { announce('You have no skill points.'); return; }
  if (s.level >= SKILL_MAX) { announce(`${SKILLS[id].name} is already at its maximum.`); return; }
  state.skillPoints--;
  s.level++;
  s.xp = 0;
  save(); render();
  announce(`${SKILLS[id].name} rises to ${s.level}. ${plural(state.skillPoints, 'skill point')} left.`);
}
const trainCost = level => 300 * (level + 1);
function trainSkill(id) {
  const s = state.skills[id];
  const list = TRAINERS[portKind(here())];
  if (!docked() || !list.includes(id)) { announce('No trainer for that skill here.'); return; }
  if (s.level >= TRAIN_MAX) { announce(`Trainers can't teach past level ${TRAIN_MAX}. Grow it by using it, or with skill points.`); return; }
  const cost = trainCost(s.level);
  if (state.credits < cost) { announce(`Training costs ${cost} credits.`); return; }
  state.credits -= cost;
  state.day += 2;
  const msgs = [];
  s.level++;
  s.xp = 0;
  msgs.push(`You spend 2 days training. ${SKILLS[id].name} rises to ${s.level}.`);
  payWages(2, msgs);
  accrueInterest(2, msgs);
  checkDeadlines(msgs);
  refreshMarket(state, state.location);
  log(`Trained ${SKILLS[id].name.toLowerCase()} to ${s.level}.`);
  save(); render();
  announce(msgs.join(' '));
}
function specialDone(m, msgs) {
  if (isPersonal(m)) personalDone(m, msgs);
  else storyDone(m, msgs);
}
function buyGear(slot, id) {
  const list = slot === 'weapon' ? WEAPON_GEAR : ARMOR_GEAR;
  const item = list[id];
  if (!docked() || !soldHere(item, portKind(here()), here().security)) { announce('That isn’t sold here.'); return; }
  const cur = state.gear[slot];
  if (cur === id) { announce('You already have it.'); return; }
  const refund = cur ? Math.round(list[cur].price * 0.5) : 0;
  if (state.credits + refund < item.price) { announce(`That costs ${item.price}${refund ? `, less ${refund} for your old one` : ''}.`); return; }
  state.credits += refund - item.price;
  state.gear[slot] = id;
  log(`Bought a ${item.name.toLowerCase()}.`);
  save(); render();
  announce(`${slot === 'weapon' ? `You now carry a ${item.name.toLowerCase()}` : `You now wear ${item.name === 'Padded vest' || item.name === 'Flak jacket' ? `a ${item.name.toLowerCase()}` : item.name.toLowerCase()}`}.${refund ? ` Your old one sold for ${refund}.` : ''} Credits ${state.credits}.`);
}
function buyArmory() {
  const lvl = state.gear.armory;
  if (lvl >= ARMORY_MAX) { announce('Your armory is fully stocked.'); return; }
  const cost = ARMORY_COST[lvl];
  if (state.credits < cost) { announce(`That costs ${cost}.`); return; }
  state.credits -= cost;
  state.gear.armory++;
  save(); render();
  announce(`Crew armory upgraded to level ${state.gear.armory}. Your boarding parties are better armed.`);
}
function gearHTML() {
  const g = state.gear, sys = here(), kind = portKind(sys);
  const w = g.weapon ? WEAPON_GEAR[g.weapon] : null, a = g.armor ? ARMOR_GEAR[g.armor] : null;
  const shop = (list, slot) => Object.entries(list).filter(([, it]) => soldHere(it, kind, sys.security)).map(([id, it]) => {
    const owned = g[slot] === id;
    return `<li><p>${it.name}, ${slot === 'weapon' ? 'attack' : 'protection'} ${it.bonus}, ${it.price} credits${owned ? ', yours' : ''}.</p>${owned ? '' : `<button data-action="buygear" data-arg="${slot}:${id}" data-key="buygear-${id}" aria-label="Buy ${it.name}">Buy</button>`}</li>`;
  }).join('');
  const shopping = docked() ? `<h3>Weapons for sale</h3><ul class="cards">${shop(WEAPON_GEAR, 'weapon') || '<li>None here.</li>'}</ul>
    <h3>Armor for sale</h3><ul class="cards">${shop(ARMOR_GEAR, 'armor') || '<li>None here.</li>'}</ul>
    ${g.armory < ARMORY_MAX ? `<button data-action="buyarmory" data-key="buyarmory">Stock the crew armory to level ${g.armory + 1}, ${ARMORY_COST[g.armory]} credits</button>` : ''}` : '';
  return `<section id="sec-gear" aria-labelledby="h-gear"><h2 id="h-gear" tabindex="-1">Personal gear</h2>
    <ul><li>Weapon: ${w ? `${w.name}, attack ${w.bonus}` : 'none'}</li>
    <li>Armor: ${a ? `${a.name}, protection ${a.bonus}` : 'none'}</li>
    <li>Crew armory: level ${g.armory} of ${ARMORY_MAX}</li></ul>
    <p>Your weapon adds to your dueling in pit fights, and with your armor it makes boarding fights and mutinies go better. In the pit, armor can turn aside a blow. If you lose a boarding fight, armor gives you 10% per point of protection to escape with your life${armorBonus(state) ? `, ${armorBonus(state) * 10}% with yours` : ''}. The crew armory makes your whole boarding party fight 10% better per level. Buying replaces what you carry, and the old item sells for half.</p>
    ${shopping}</section>`;
}

function storyDone(m, msgs) {
  storyMissionDone(m, msgs);
  gainPoint(1, msgs, 'a story chapter');
}

function captainHTML() {
  const kind = portKind(here());
  const trainers = docked() ? TRAINERS[kind] : [];
  const items = Object.entries(SKILLS).map(([id, def]) => {
    const s = state.skills[id];
    const prog = s.level >= SKILL_MAX ? 'maximum' : `${s.xp} of ${xpNeeded(s.level)} to next level`;
    let btns = '';
    if (state.skillPoints > 0 && s.level < SKILL_MAX) btns += `<button data-action="spendpoint" data-arg="${id}" data-key="spend-${id}" aria-label="Spend a point on ${def.name}">Spend a point</button>`;
    if (trainers.includes(id) && s.level < TRAIN_MAX) btns += `<button data-action="train" data-arg="${id}" data-key="train-${id}" aria-label="Train ${def.name}, ${trainCost(s.level)} credits and 2 days">Train, ${trainCost(s.level)} credits and 2 days</button>`;
    const bonus = officerBonus(id);
    const eff = def.effect(s.level + bonus) + (bonus ? `, including ${bonus} from your officers` : '');
    return `<li><p>${def.name} ${s.level}, ${prog}. ${eff.charAt(0).toUpperCase() + eff.slice(1)}.</p>${btns}</li>`;
  }).join('');
  const where = trainers.length
    ? `Trainers here teach ${trainers.map(t => SKILLS[t].name.toLowerCase()).join(', ')}, up to level ${TRAIN_MAX}.`
    : 'No trainers here.';
  return `<section id="sec-captain" aria-labelledby="h-captain"><h2 id="h-captain" tabindex="-1">Captain ${esc(state.captain)}</h2>
    <p>${plural(state.skillPoints, 'skill point')} to spend. ${where} Skills also grow as you use them, up to level ${SKILL_MAX}. Story chapters and every 8 completed contracts earn skill points.</p>
    <ul class="cards">${items}</ul></section>`;
}

// ---------- crew ----------
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function loyaltyName(v) {
  return v >= 80 ? 'devoted' : v >= 60 ? 'loyal' : v >= 45 ? 'content' : v >= 30 ? 'restless' : v >= 15 ? 'near mutiny' : 'mutinous';
}
const leanName = v => (v >= 20 ? 'lawful' : v <= -20 ? 'outlaw' : 'mixed');
const skillName = v => (v >= 1.4 ? 'elite' : v >= 1.25 ? 'veteran' : v >= 1.1 ? 'trained' : 'green');

function morale(delta, msgs) {
  const c = state.crew;
  const lead = sk('leadership') * 0.05;
  delta = delta > 0 ? delta * (1 + lead) : delta * (1 - lead);
  const before = loyaltyName(c.loyalty);
  c.loyalty = clampN(Math.round((c.loyalty + delta) * 10) / 10, 0, 100);
  const after = loyaltyName(c.loyalty);
  if (before !== after && msgs) msgs.push(`Your crew is now ${after}.`);
}

// How the crew feels about what you do, depending on how they lean.
function conduct(kind, msgs) {
  officerReact(kind, msgs);
  const c = state.crew;
  const lawful = c.lean >= 20, outlaw = c.lean <= -20;
  if (kind === 'piracy') { morale(lawful ? -5 : outlaw ? 2 : -1, msgs); c.lean = clampN(c.lean - 4, -100, 100); }
  if (kind === 'smuggle') { morale(lawful ? -2 : outlaw ? 1 : 0, msgs); c.lean = clampN(c.lean - 2, -100, 100); }
  if (kind === 'lawful') { morale(outlaw ? -2 : lawful ? 1 : 0, msgs); c.lean = clampN(c.lean + 2, -100, 100); }
  if (kind === 'atrocity') { morale(lawful ? -8 : outlaw ? 0 : -3, msgs); c.lean = clampN(c.lean - 3, -100, 100); }
}

function combatSkill() {
  return state.crew.skill * (state.crew.loyalty < 40 ? 0.85 : 1);
}

function payWages(days, msgs) {
  const due = days * (state.ship.crew * WAGE + officerWages());
  if (!due) return;
  if (state.credits >= due) {
    state.credits -= due;
    if (state.crew.loyalty < 60) morale(1, msgs);
  } else {
    state.crew.owed += due - state.credits;
    state.credits = 0;
    msgs.push(`You could not pay your crew in full. You owe them ${state.crew.owed} credits.`);
    morale(-8, msgs);
    officerReact('unpaid', msgs);
  }
}

function hireCrewAt(n, sys) {
  const c = state.crew, sh = state.ship;
  const lean = { concord: 30, independent: 0, clan: -30 }[portKind(sys)];
  const old = sh.crew;
  const total = old + n;
  c.lean = Math.round((c.lean * old + lean * n) / total);
  c.loyalty = Math.round((c.loyalty * old + 55 * n) / total);
  c.skill = Math.round(((c.skill * old + 1 * n) / total) * 100) / 100;
  sh.crew = total;
}

function crewArrivalChecks(msgs) {
  const c = state.crew;
  if (c.loyalty < 30 && state.ship.crew > 1 && docked()) {
    const n = Math.max(1, Math.ceil(state.ship.crew * 0.2));
    state.ship.crew -= n;
    msgs.push(`${n === 1 ? 'A crew member deserts' : `${n} crew members desert`} at ${here().name}.`);
    log(`${n} crew deserted at ${here().name}.`);
  }
}

function mutinyCheck() {
  return state.crew.loyalty < 15 && state.ship.crew >= 2 && Math.random() < 0.4;
}

function mutinyNumbers() {
  const loyal = Math.round(state.ship.crew * (state.crew.loyalty / 100) + 1);
  return { loyal, rebels: Math.max(1, state.ship.crew - loyal + 1) };
}

function startMutiny(msgs) {
  state.mutiny = { msgs };
  save();
  ui.focus = 'mutiny-heading';
  render();
  announce([...msgs, 'Mutiny! Your crew has taken up arms against you.'].join(' '));
}

function resolveMutiny(choice) {
  const msgs = [...(state.mutiny.msgs || [])];
  const { loyal, rebels } = mutinyNumbers();
  if (choice === 'pay') {
    const cost = state.ship.crew * 150;
    if (state.credits < cost) { announce('You cannot afford to pay them off.'); return; }
    state.credits -= cost;
    state.crew.owed = 0;
    state.crew.loyalty = 50;
    msgs.push(`You pay the crew ${cost} credits and they stand down.`);
  } else if (choice === 'fight') {
    const att = { crew: loyal + 1, skill: (combatSkill() + 0.3) * (1 + sk('dueling') * 0.04) * (1 + 0.05 * weaponBonus(state) + 0.04 * armorBonus(state)) };
    const def = { crew: rebels, skill: state.crew.skill };
    if (!boardingFight(att, def, Math.random)) {
      state.mutiny = null;
      die(`Captain ${state.captain} was killed by mutineers on day ${state.day}.`);
      return;
    }
    state.ship.crew = Math.max(1, att.crew - 1);
    state.crew.loyalty = 65;
    state.crew.owed = 0;
    msgs.push(`You put down the mutiny. The survivors are thrown off at the next port. ${plural(state.ship.crew, 'loyal crew member')} remain.`);
  } else {
    state.mutiny = null;
    die(`Captain ${state.captain} gave up command to mutineers and was set adrift on day ${state.day}.`);
    return;
  }
  gainXP('leadership', 4, msgs);
  if (choice === 'fight') gainXP('dueling', 8, msgs);
  log(msgs[msgs.length - 1]);
  state.mutiny = null;
  finishArrival(msgs);
}

function crewAction(kind) {
  const sh = state.ship, c = state.crew;
  if (kind === 'payowed') {
    const n = Math.min(c.owed, state.credits);
    if (!n) { announce(c.owed ? 'Not enough credits.' : 'You owe your crew nothing.'); return; }
    state.credits -= n; c.owed -= n;
    const msgs = [`Paid ${n} credits of back wages.`];
    if (!c.owed) morale(6, msgs);
    save(); render(); announce(msgs.join(' '));
  } else if (kind === 'hire') {
    const need = sh.crewMax - sh.crew;
    const n = Math.min(need, Math.floor(state.credits / CREW_PRICE));
    if (need <= 0) { announce('Your crew is at full strength.'); return; }
    if (n <= 0) { announce('Not enough credits.'); return; }
    state.credits -= n * CREW_PRICE;
    hireCrewAt(n, here());
    save(); render();
    announce(`Hired ${plural(n, 'crew member')} for ${n * CREW_PRICE}. Crew ${sh.crew} of ${sh.crewMax}, leaning ${leanName(c.lean)}.`);
  } else if (kind === 'bonus') {
    const cost = sh.crew * 25;
    if (state.credits < cost) { announce('Not enough credits.'); return; }
    state.credits -= cost;
    const msgs = [`Paid a bonus of ${cost} credits.`];
    morale(state.day - c.lastBonusDay >= 5 ? 10 : 3, msgs);
    gainXP('leadership', 2, msgs);
    c.lastBonusDay = state.day;
    save(); render(); announce(msgs.join(' '));
  } else if (kind === 'leave') {
    const cost = sh.crew * 15;
    if (state.credits < cost) { announce('Not enough credits.'); return; }
    state.credits -= cost;
    state.day += 1;
    const msgs = [`Your crew takes a day of shore leave for ${cost} credits.`];
    payWages(1, msgs);
    morale(8, msgs);
    gainXP('leadership', 2, msgs);
    checkDeadlines(msgs);
    refreshMarket(state, state.location);
    save(); render(); announce(msgs.join(' '));
  }
}

// ---------- outfitting and ship dealer ----------
function buyWeapon(id) {
  const sh = state.ship;
  const price = WEAPON_PRICES[id];
  if (sh.weapons.length >= sh.hardpoints) { announce('No free hardpoints. Sell a weapon first.'); return; }
  if (state.credits < price) { announce('Not enough credits.'); return; }
  state.credits -= price;
  sh.weapons.push(id);
  applyStats(sh);
  if (id === 'missile') sh.missiles = Math.min(sh.missilesMax, sh.missiles + 6);
  save(); render();
  announce(`Installed a ${WEAPONS[id].name.toLowerCase()} for ${price}. Credits ${state.credits}.`);
}
function sellWeapon(index) {
  const sh = state.ship;
  const id = sh.weapons[index];
  if (!id) return;
  const value = Math.round(WEAPON_PRICES[id] * 0.5);
  sh.weapons.splice(index, 1);
  state.credits += value;
  applyStats(sh);
  save(); render();
  announce(`Sold the ${WEAPONS[id].name.toLowerCase()} for ${value}.`);
}
function installUpgrade(id) {
  const sh = state.ship;
  const u = UPGRADES[id];
  if (sh.upgrades.includes(id)) return;
  if (sh.upgrades.length >= sh.slots) { announce('No free upgrade slots.'); return; }
  if (state.credits < u.price) { announce('Not enough credits.'); return; }
  state.credits -= u.price;
  sh.upgrades.push(id);
  const hullWas = sh.hullMax;
  applyStats(sh);
  if (id === 'armor') sh.hull += sh.hullMax - hullWas;
  save(); render();
  announce(`Installed ${u.name.toLowerCase()} for ${u.price}. Credits ${state.credits}.`);
}
function removeUpgrade(id) {
  const sh = state.ship;
  if (!sh.upgrades.includes(id)) return;
  if (id === 'cargo' && holdUsed() > sh.cargo - 10) { announce('Empty some cargo first.'); return; }
  const value = Math.round(UPGRADES[id].price * 0.5);
  sh.upgrades = sh.upgrades.filter(x => x !== id);
  state.credits += value;
  applyStats(sh);
  state.fuel = Math.min(state.fuel, sh.tank);
  save(); render();
  announce(`Removed ${UPGRADES[id].name.toLowerCase()} and sold it for ${value}.`);
}
function shipRequirementMet(c, sys) {
  if (!c.req) return true;
  if (c === SHIP_CLASSES.frigate && state.perks.concordHero) return true;
  const key = c.req.faction === 'clan' ? clanKey(sys.clan) : c.req.faction;
  return getRep(state, key) >= c.req.min;
}
function shipRequirementText(c, sys) {
  const key = c.req.faction === 'clan' ? clanKey(sys.clan) : c.req.faction;
  return `Requires ${tierName(c.req.min)} standing with the ${factionName(key)}.`;
}
function buyShip(classId) {
  const sys = here();
  const c = SHIP_CLASSES[classId];
  if (!shipRequirementMet(c, sys)) { announce(shipRequirementText(c, sys)); return; }
  if (state.debt > 0) { announce('The dealer will not sell you a ship while you owe the Merchant Guild.'); return; }
  const cost = c.price - tradeInValue(state.ship);
  if (state.credits < cost) { announce(`Not enough credits. You need ${cost}.`); return; }
  const cargoNeed = holdUsed();
  if (cargoNeed > c.cargo) { announce(`That ship holds only ${c.cargo}. You are carrying ${cargoNeed}.`); return; }
  if (ui.confirmBuyShip !== classId) {
    ui.confirmBuyShip = classId;
    render();
    announce(`Your current ship, weapons and upgrades will be traded in. Press Confirm purchase to buy the ${c.name}.`);
    return;
  }
  ui.confirmBuyShip = null;
  const oldCrew = state.ship.crew;
  state.credits -= cost;
  state.ship = buildShip(classId);
  state.ship.crew = Math.min(oldCrew, state.ship.crewMax);
  const dismissed = oldCrew - state.ship.crew;
  state.fuel = Math.min(state.fuel, state.ship.tank);
  log(`Bought a ${c.name} at ${sys.name}.`);
  save(); render();
  announce(`The ${state.shipName} is now a ${c.name}.${cost >= 0 ? ` Paid ${cost}.` : ` You received ${-cost}.`}${dismissed ? ` ${plural(dismissed, 'crew member')} had to be let go.` : ''}`);
}

// ---------- encounters and combat ----------
const rand = () => Math.random();
const pickW = w => { const e = Object.entries(w); let r = rand() * e.reduce((s, [, v]) => s + v, 0); for (const [k, v] of e) { r -= v; if (r <= 0) return k; } return e[0][0]; };

function randomCargo(legalOnly, min, max) {
  const pool = GOODS.filter(g => !legalOnly || !g.illegal);
  const total = min + Math.floor(rand() * (max - min + 1));
  const cargo = {};
  for (let i = 0; i < total; i++) {
    const g = pool[Math.floor(rand() * pool.length)];
    cargo[g.id] = (cargo[g.id] || 0) + 1;
  }
  return Object.entries(cargo).map(([goodId, qty]) => ({ goodId, qty }));
}

// Pirate strength depends on how lawless the system is, and a little on how dangerous your ship looks.
function pirateKind(sec) {
  const w = { high: { cutter: 1 }, medium: { cutter: 6, raider: 4 }, low: { cutter: 3, raider: 5, marauder: 2 }, none: { cutter: 2, raider: 5, marauder: 3 } }[sec];
  const strong = state.ship.hullMax + state.ship.shieldMax >= 120;
  const out = { ...w };
  if (!strong) { if (out.marauder) out.marauder *= 0.3; if (out.raider) out.raider *= 0.7; }
  else if (out.cutter) out.cutter *= 0.6;
  return pickW(out);
}

function missionEncounter(sys) {
  const m = state.missions.find(x => (COMBAT_TYPES.includes(x.type) || isStoryFight(x)) && (x.dest === sys.id || (x.dest === -1 && Math.random() < 0.35)));
  if (!m) return null;
  return missionCombat(m);
}

function missionCombat(m) {
  if (isSpecial(m)) {
    const cargo = m.enemy === 'convoy' ? randomCargo(true, 10, 18) : randomCargo(false, 3, 10);
    const enemy = makeEnemy(m.enemy, m.enemyFaction, cargo);
    enemy.name = m.enemyName;
    if (m.captain) enemy.captain = m.captain;
    return { enemy, range: m.approach ? 1 : 2, approach: m.approach, missionId: m.id, intro: m.approach ? `Your target is here: the ${enemy.name}.` : `The ${enemy.name} moves to engage you.` };
  }
  const sys = galaxy.systems[m.dest];
  if (m.type === 'warstrike') {
    const enemy = makeEnemy(m.enemyKind, m.enemy, randomCargo(false, 2, 6));
    enemy.name = `${factionName(m.enemy)} ${enemy.name}`;
    return { enemy, range: 2, missionId: m.id, intro: `A ${enemy.name} holds the line at ${sys.name}.` };
  }
  const kind = missionEnemy(m);
  if (m.type === 'raid') {
    const enemy = makeEnemy(kind, 'guild', randomCargo(true, 8, 16));
    return { enemy, range: 1, approach: true, missionId: m.id, intro: `Your target is here: a ${enemy.name} hauling Guild cargo.` };
  }
  const enemy = makeEnemy(kind, clanKey(sys.clan), randomCargo(false, 2, 8));
  if (m.type === 'bounty') {
    enemy.name = `${m.target}'s ${enemy.name}`;
    enemy.captain = m.target;
    return { enemy, range: 2, missionId: m.id, intro: `You find ${m.target}'s ship. They turn to fight.` };
  }
  return { enemy, range: 2, missionId: m.id, intro: `A ${sys.clan} ${enemy.name} moves to attack.` };
}

// Contract twists: some happen on the way, some at the destination.
function twistEncounter(sys, msgs) {
  const order = [...state.missions].sort((a, b) => (b.dest === sys.id) - (a.dest === sys.id));
  for (const m of order) {
    if (!m.twist || m.twistDone) continue;
    const away = m.dest !== sys.id && sys.id !== m.origin;
    const atDest = m.dest === sys.id;
    if (m.twist === 'contraband' && away) { m.twistDone = true; return { event: twistEvent('twist-contraband', m) }; }
    if (m.twist === 'rerouted' && away) {
      m.twistDone = true;
      const hops = hopCounts(galaxy, m.dest);
      const pool = galaxy.systems.filter(x => hops[x.id] >= 1 && hops[x.id] <= 3 && x.id !== sys.id && (m.type !== 'dispatch' || x.authority === 'Concord'));
      if (!pool.length) continue;
      const nd = pool[Math.floor(rand() * pool.length)];
      const extra = hops[nd.id];
      msgs.push(`New orders: the client has moved the delivery from ${galaxy.systems[m.dest].name} to ${nd.name}. Pay rises 40%, and you get ${extra * 4} more days.`);
      m.dest = nd.id; m.pay = Math.round(m.pay * 1.4 / 10) * 10; m.deadline += extra * 4;
      continue;
    }
    if (m.twist === 'rush' && away) {
      m.twistDone = true;
      const left = Math.max(1, m.deadline - state.day);
      m.rushBy = state.day + Math.max(2, Math.floor(left * 0.6));
      msgs.push(`The client sends word: deliver ${missionTitle(m, galaxy).toLowerCase()} by day ${m.rushBy} and they'll pay 50% more.`);
      continue;
    }
    if (m.twist === 'doublecross' && atDest && docked()) { m.twistDone = true; return { event: twistEvent('twist-doublecross', m) }; }
    if (m.twist === 'ambush' && atDest) {
      m.twistDone = true;
      const kind = m.type === 'smuggle' ? 'hunter' : m.tier >= 2 ? 'marauder' : 'raider';
      const enemy = makeEnemy(kind, kind === 'hunter' ? 'concord' : clanKey(sys.clan), randomCargo(false, 1, 5));
      return { enemy, range: 1, intro: `Someone sold you out. A ${enemy.name} is waiting for your delivery at ${sys.name}.` };
    }
  }
  return null;
}

function rivalEncounter(sys) {
  const r = rivalAt(sys.id);
  if (!r) return null;
  seenAt(r);
  if (r.attitude <= -25 && isCombat(r) && rand() < (r.attitude <= -60 ? 0.9 : 0.5)) {
    return { enemy: rivalEnemy(r), range: 2, intro: r.attitude <= -60 ? `${r.name} has hunted you down. The ${r.ship} attacks!` : `${r.name} and the ${r.ship} are here, and they want a fight.` };
  }
  if (rand() < 0.6) return { event: rivalMeetEvent(r) };
  return { message: `${r.name}'s ship, the ${r.ship}, is in port here.` };
}

function blockadeEncounter(sys, msgs) {
  const bl = blockadeAt(sys.id);
  if (!bl || rand() >= 0.7) return null;
  if (bl.blockader === 'concord') {
    if (getRep(state, 'concord') <= -10) {
      return { enemy: makeEnemy('patrol', 'concord'), range: 1, intro: `Concord blockade ships close on you. They know who you are.` };
    }
    if (carryingContraband() && rand() < 0.5 * (1 - sk('deception') * 0.05)) {
      msgs.push('Concord blockade ships stop and search you.');
      seizeContraband(msgs);
      return { message: 'They let you go on.' };
    }
    gainXP('deception', carryingContraband() ? 3 : 0, msgs);
    return { message: 'Concord blockade ships hail you and let you through.' };
  }
  if (getRep(state, bl.blockader) >= 10 || state.perks.clanLord === sys.clan) return { message: `The ${factionName(bl.blockader)} blockade ships wave you through.` };
  const enemy = makeEnemy(rand() < 0.5 ? 'raider' : 'marauder', bl.blockader, randomCargo(false, 0, 4));
  return { enemy, range: 2, intro: `You run into the ${factionName(bl.blockader)} blockade. A ${enemy.name} moves to stop you.` };
}

function randomEncounter(sys) {
  const war = frontWarAt(sys.id);
  if (war && rand() < 0.3) {
    const sides = [war.a, war.b].sort((x, y) => getRep(state, x) - getRep(state, y));
    const foe = sides[0];
    if (getRep(state, foe) <= -10) {
      const enemy = makeEnemy(foe === 'concord' ? 'patrol' : (rand() < 0.5 ? 'raider' : 'marauder'), foe, randomCargo(false, 0, 4));
      return { enemy, range: 2, intro: `You arrive on the war front. A ${factionName(foe)} warship marks you as an enemy and attacks.` };
    }
    return { message: `Warships of the ${factionName(war.a)} and the ${factionName(war.b)} trade fire nearby.` };
  }
  if (state.arcs.wanted && state.arcs.wanted.status === 'active' && rand() < 0.15) {
    const enemy = makeEnemy('hunter', 'concord', randomCargo(false, 0, 3));
    return { enemy, range: 2, intro: 'A bounty hunter drops out of a jump right on top of you. Your face is on their screen.' };
  }
  const escort = state.missions.some(m => m.type === 'escort');
  let chance = { high: 0.06, medium: 0.14, low: 0.24, none: 0.34 }[sys.security] * (1 - sk('navigation') * 0.03);
  if (escort) chance = Math.max(chance, 0.4);
  const surge = surgeAt(sys);
  if (surge) chance = Math.min(0.6, chance * 1.6);
  if (rand() >= chance) return null;
  let type = pickW({ high: { patrol: 5, merchant: 4, pirate: 1 }, medium: { pirate: 4.5, merchant: 3.5, patrol: 2 }, low: { pirate: 7, merchant: 3 }, none: { pirate: 8, merchant: 2 } }[sys.security]);
  if (escort && rand() < 0.75) type = 'pirate';
  if (surge && rand() < 0.6) type = 'pirate';
  if (type === 'pirate') {
    const clan = clanKey(sys.clan);
    if (getRep(state, clan) >= 10 || state.perks.clanLord === sys.clan) return { message: `Raiders of the ${sys.clan} clan recognize your ship and let you pass.` };
    const enemy = makeEnemy(pirateKind(sys.security), clan, randomCargo(false, 0, 6));
    const extra = escort ? ' They are after your convoy.' : '';
    return { enemy, range: 2, intro: `Pirates! A ${sys.clan} ${enemy.name} is closing in.${extra}` };
  }
  if (type === 'merchant') {
    const enemy = makeEnemy(rand() < 0.2 ? 'convoy' : 'hauler', 'guild', randomCargo(true, 6, 14));
    return { enemy, range: 1, approach: true, intro: `A ${enemy.name} crosses your path.` };
  }
  if (getRep(state, 'concord') <= -30) {
    const enemy = makeEnemy('patrol', 'concord');
    return { enemy, range: 2, intro: 'A Concord patrol cutter has you on its wanted list and moves to intercept.' };
  }
  return { message: 'A Concord patrol cutter passes by.' };
}

function startCombat(enc, pendingArrival, msgs = []) {
  if (!state.ironman) { try { localStorage.setItem(PREFIGHT_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  state.ship.shield = state.ship.shieldMax;
  applyCaptain();
  let ally = null;
  if (!enc.enemy.rivalId && !enc.approach) {
    const a = nearbyAlly();
    if (a && rand() < 0.35) { ally = { id: a.id, name: a.name, ship: a.ship, dmg: 4 + a.level * 2 }; msgs = [...msgs]; enc = { ...enc, intro: `${enc.intro} Your ally ${a.name} answers your call, and the ${a.ship} jumps in beside you!` }; }
  }
  state.combat = {
    ally,
    enemy: enc.enemy, range: enc.range, turn: 0, move: 0, target: 'hull',
    phase: enc.approach ? 'approach' : 'fight', lines: [], intro: enc.intro,
    missionId: enc.missionId ?? null, pendingArrival, pendingMsgs: msgs, outcome: null, resultText: [],
  };
  ui.confirmSurrender = false;
  save();
  ui.focus = 'combat-heading';
  render();
  announce([...msgs, enc.intro].join(' '));
}

const combatMission = () => state.combat.missionId != null ? state.missions.find(m => m.id === state.combat.missionId) : null;

function combatAction(action) {
  const cb = state.combat;
  ui.confirmSurrender = false;
  if (action === 'board') {
    if (cb.range !== 0 || effPower(cb.enemy, 'engines') > 0) { announce('You can only board a ship whose engines are disabled, at close range.'); return; }
  }
  applyCaptain();
  const r = resolveTurn(cb, state.ship, action);
  const xm = [];
  if (r.hits) gainXP('gunnery', r.hits, xm);
  if (r.moved) gainXP('piloting', 1, xm);
  if (r.escaped) gainXP('piloting', 5, xm);
  if (action === 'repair') gainXP('repairs', 4, xm);
  if (r.boarded || action === 'board') gainXP('dueling', 8, xm);
  if (r.demanded) gainXP('negotiation', 3, xm);
  cb.lines = [...r.lines, ...xm];
  if (!r.outcome && cb.ally && cb.phase === 'fight') {
    const e = cb.enemy;
    let d = Math.round(cb.ally.dmg * (0.7 + rand() * 0.6));
    const abs = Math.min(e.shield, d);
    e.shield -= abs;
    e.hull = Math.max(0, e.hull - (d - abs));
    cb.lines.push(`The ${cb.ally.ship} fires: ${d} damage.`);
    if (e.hull <= 0) { cb.lines.push('Their ship explodes.'); endFight('enemy-destroyed', cb.lines); return; }
  }
  if (r.outcome) { endFight(r.outcome, cb.lines); return; }
  save();
  render();
  announce(cb.lines.join(' '));
}

function attackMerchant() {
  const cb = state.combat;
  const sys = here();
  const msgs = [];
  changeRep(state, 'guild', -6, msgs);
  changeRep(state, 'concord', sys.authority === 'Concord' || sys.security === 'high' || sys.security === 'medium' ? -4 : -1, msgs);
  changeRep(state, clanKey(sys.clan), 2, msgs);
  addNotoriety(state, 2);
  conduct('piracy', msgs);
  cb.phase = 'fight';
  cb.attacked = true;
  log(`Attacked a ${cb.enemy.name} near ${sys.name}.`);
  save();
  render();
  announce(['You open fire. Piracy will not be forgotten.', ...msgs].join(' '));
}

function lootEnemy(msgs) {
  const e = state.combat.enemy;
  const taken = [];
  const sorted = [...e.cargo].sort((a, b) => good(b.goodId).base - good(a.goodId).base);
  for (const c of sorted) {
    const n = Math.min(c.qty, freeSpace());
    if (n <= 0) continue;
    const slot = state.cargo[c.goodId] || (state.cargo[c.goodId] = { qty: 0, cost: 0 });
    slot.qty += n;
    c.qty -= n;
    taken.push(`${n} ${good(c.goodId).name}`);
  }
  e.cargo = e.cargo.filter(c => c.qty > 0);
  msgs.push(taken.length ? `You take ${taken.join(', ')}.` : 'There is nothing you can fit in your hold.');
  if (e.cargo.length) msgs.push('Some cargo had to be left behind.');
}

// Reputation and rewards for beating a ship. how: destroyed | captured | released | looted | prisoner
function defeatEffects(how, msgs) {
  const cb = state.combat;
  const e = cb.enemy;
  if (!cb.rewarded) {
    cb.rewarded = true;
    morale(2, msgs);
    state.crew.skill = Math.min(1.5, Math.round((state.crew.skill + 0.02) * 100) / 100);
  }
  if (e.side === 'pirate') {
    changeRep(state, e.faction, { destroyed: -4, captured: -3, looted: -3, prisoner: -3, released: -1 }[how], msgs);
    if (how !== 'released') {
      changeRep(state, 'concord', 2, msgs);
      if (getRep(state, 'concord') > -30) {
        const base = { cutter: 120, raider: 220, marauder: 380, flagship: 600, dreadnought: 1500 }[e.kind] || 0;
        const bounty = Math.round(base * (state.perks.concordHero ? 1.5 : state.perks.navyCommission ? 1.25 : 1));
        receive(bounty);
        msgs.push(`The Concord pays a ${bounty} credit bounty.`);
      }
    }
    addNotoriety(state, 1);
  } else if (e.side === 'merchant') {
    if (how === 'destroyed') { changeRep(state, 'guild', -4, msgs); addNotoriety(state, 1); }
    if (how === 'released') changeRep(state, 'guild', 1, msgs);
  } else if (e.side === 'concord') {
    if (how === 'destroyed') { changeRep(state, 'concord', -10, msgs); addNotoriety(state, 3); }
  }
  const m = combatMission();
  if (m) {
    if (m.type === 'patrol') {
      m.count--;
      if (m.count <= 0) completeMission(m, msgs);
      else msgs.push(`${m.count} more pirate ${m.count === 1 ? 'ship' : 'ships'} to clear here.`);
    } else if (m.type === 'bounty') {
      if (how === 'prisoner') { m.pay = Math.round(m.pay * 1.5 / 10) * 10; msgs.push(`${m.target} is taken alive for a bigger reward.`); }
      completeMission(m, msgs);
    } else if (m.type === 'raid' || m.type === 'warstrike') {
      completeMission(m, msgs);
    } else if (isSpecial(m)) {
      specialDone(m, msgs);
    }
  }
}

function failEscort(msgs) {
  for (const m of [...state.missions]) if (m.type === 'escort') failMission(m, msgs, 'convoy lost');
}

function loseCargoMissions(msgs, reason) {
  for (const m of [...state.missions]) if (missionSpace(m) > 0 || m.type === 'escort') failMission(m, msgs, reason);
}

function die(reason) {
  state.dead = { reason, day: state.day };
  if (state.ironman) { try { localStorage.removeItem(PREFIGHT_KEY); } catch (e) { /* ignore */ } }
  state.combat = null;
  log(reason);
  save();
  ui.screen = 'gameover';
  ui.focus = 'over-heading';
  render();
  announce(reason);
}

function endFight(outcome, lines) {
  const cb = state.combat;
  const e = cb.enemy;
  const msgs = [];
  cb.outcome = outcome;
  if (outcome === 'player-killed' && rand() < armorSaveChance(state)) {
    outcome = 'player-destroyed';
    cb.outcome = outcome;
    msgs.push(`Your ${ARMOR_GEAR[state.gear.armor].name.toLowerCase()} turns a killing blow. Badly hurt, you reach an escape pod as your ship is lost.`);
  }
  if (outcome === 'player-killed') {
    die(`Captain ${state.captain} was killed in a boarding fight on day ${state.day}.`);
    return;
  }
  if (outcome !== 'player-destroyed' && sk('repairs') > 0 && state.ship.hull < state.ship.hullMax) {
    const fix = Math.min(state.ship.hullMax - state.ship.hull, sk('repairs') * 3);
    state.ship.hull += fix;
    msgs.push(`Field repairs patch ${fix} hull.`);
  }
  if (outcome === 'player-destroyed') {
    const hater = e.side !== 'merchant' && getRep(state, e.faction) <= -60;
    if (hater && rand() < 0.6) {
      die(`Captain ${state.captain}'s escape pod was caught by the ${factionName(e.faction)}, and the captain was executed on day ${state.day}.`);
      return;
    }
    rescue(msgs);
    morale(-10, msgs);
  } else if (outcome === 'enemy-destroyed') {
    const salvage = 30 + Math.floor(rand() * 90);
    receive(salvage);
    msgs.push(`You salvage ${salvage} credits worth of wreckage.`);
    defeatEffects('destroyed', msgs);
  } else if (outcome === 'captured') {
    lootEnemy(msgs);
    msgs.push('Their crew is set adrift in escape pods.');
    defeatEffects('captured', msgs);
  } else if (outcome === 'player-escaped' || outcome === 'separated') {
    failEscort(msgs);
  }
  rivalOutcome(outcome, msgs);
  if (['enemy-destroyed', 'captured', 'enemy-surrendered'].includes(outcome)) officerReact('victory', msgs);
  if (outcome === 'player-escaped') officerReact('fled', msgs);
  if (outcome === 'player-destroyed') officerReact('lost', msgs);
  cb.phase = 'result';
  cb.resultText = [...lines, ...msgs];
  save();
  ui.focus = 'combat-result';
  render();
  announce(cb.resultText.join(' '));
}

function rivalOutcome(outcome, msgs) {
  const cb = state.combat;
  if (cb.ally && ['enemy-destroyed', 'captured', 'enemy-surrendered'].includes(outcome)) {
    const a = rivalById(cb.ally.id);
    if (a) adjust(a, 2, 'Fought beside you.', msgs);
  }
  const id = cb.enemy.rivalId;
  if (!id) return;
  const r = rivalById(id);
  if (!r || !r.alive) return;
  const kill = (how) => { retireRival(r); r.killedByPlayer = true; pushNews(`Captain ${r.name} of the ${r.ship} was ${how} by Captain ${state.captain}.`); addNotoriety(state, 3); };
  switch (outcome) {
    case 'enemy-destroyed':
      if (rand() < 0.5) { adjust(r, -30, 'You destroyed their ship.', msgs); r.level = Math.max(1, r.level - 2); msgs.push(`${r.name} escapes in a pod, swearing revenge.`); }
      else { msgs.push(`${r.name} goes down with the ${r.ship}.`); kill('killed in battle'); }
      break;
    case 'captured': adjust(r, -20, 'You took their ship.', msgs); r.level = Math.max(1, r.level - 1); msgs.push(`${r.name} is set adrift with their crew, humiliated.`); break;
    case 'looted': adjust(r, -10, 'You looted their ship.', msgs); break;
    case 'released': adjust(r, 20, 'You spared them after they surrendered.', msgs); msgs.push(`${r.name} won't forget your mercy.`); break;
    case 'prisoner': retireRival(r); pushNews(`Captain ${r.name} of the ${r.ship} was taken prisoner by Captain ${state.captain}.`); break;
    case 'executed': kill('executed after surrendering'); break;
    case 'player-destroyed': adjust(r, -3, 'Destroyed your ship.', msgs); r.level = Math.min(10, r.level + 1); break;
    case 'player-escaped': adjust(r, -2, 'Watched you run.', msgs); break;
    case 'enemy-escaped': adjust(r, -4, 'Fled from you.', msgs); break;
    default: break;
  }
}

function surrenderChoice(choice) {
  const cb = state.combat;
  const msgs = [];
  if (choice === 'loot') { lootEnemy(msgs); msgs.push('You let their ship go.'); defeatEffects('looted', msgs); }
  if (choice === 'prisoner') { lootEnemy(msgs); defeatEffects('prisoner', msgs); }
  if (choice === 'release') { msgs.push('You let them go.'); defeatEffects('released', msgs); officerReact('mercy', msgs); }
  if (choice === 'destroy') {
    msgs.push('You destroy the surrendered ship. Word of this will spread.');
    changeRep(state, cb.enemy.faction, -6, msgs);
    if (cb.enemy.side === 'merchant') changeRep(state, 'concord', -3, msgs);
    addNotoriety(state, 3);
    conduct('atrocity', msgs);
    defeatEffects('destroyed', msgs);
  }
  rivalOutcome({ loot: 'looted', prisoner: 'prisoner', release: 'released', destroy: 'executed' }[choice], msgs);
  cb.outcome = 'resolved';
  cb.resultText = msgs;
  save();
  ui.focus = 'combat-result';
  render();
  announce(msgs.join(' '));
}

function playerSurrender() {
  const cb = state.combat;
  const e = cb.enemy;
  if (!ui.confirmSurrender) {
    ui.confirmSurrender = true;
    render();
    announce('Press Confirm surrender to give up the fight.');
    return;
  }
  ui.confirmSurrender = false;
  const msgs = [];
  if (getRep(state, e.faction) <= -60) {
    die(`Captain ${state.captain} surrendered to the ${factionName(e.faction)} and was executed on day ${state.day}.`);
    return;
  }
  if (e.side === 'pirate') {
    state.cargo = {};
    const taken = Math.round(state.credits * 0.3);
    state.credits -= taken;
    msgs.push(`You surrender. The pirates strip your hold and take ${taken} credits, then let you go.`);
    loseCargoMissions(msgs, 'cargo taken by pirates');
  } else {
    const fine = Math.round(state.credits * 0.4);
    state.credits -= fine;
    for (const g of GOODS) if (g.illegal) delete state.cargo[g.id];
    for (const m of [...state.missions]) if (isContraband(m)) failMission(m, msgs, 'cargo seized', 4);
    failEscort(msgs);
    state.day += 10;
    state.rep.concord = Math.max(state.rep.concord, -29);
    msgs.push(`You surrender to the Concord. You are fined ${fine} credits and serve 10 days in prison. Your record is partly cleared.`);
    checkDeadlines(msgs);
  }
  morale(-10, msgs);
  log(msgs[0]);
  cb.phase = 'result';
  cb.outcome = 'player-surrendered';
  cb.resultText = msgs;
  save();
  ui.focus = 'combat-result';
  render();
  announce(msgs.join(' '));
}

function rescue(msgs) {
  const cb = state.combat;
  const hops = hopCounts(galaxy, state.location);
  const order = galaxy.systems.map(x => x.id).filter(id => hops[id] < Infinity).sort((a, b) => hops[a] - hops[b]);
  const port = order.find(id => dockingStatus(state, galaxy.systems[id]).ok) ?? state.location;
  const name = state.shipName;
  const old = state.ship;
  const ins = state.insurance;
  const covered = ins.plan !== 'none' && state.day <= ins.expires;
  const piracy = cb && (cb.attacked || (combatMission() && combatMission().type === 'raid'));
  state.cargo = {};
  loseCargoMissions(msgs, 'ship destroyed');
  msgs.push(`You escape in your pod and are towed to ${galaxy.systems[port].name}.`);
  if (covered && piracy) msgs.push('Your insurer refuses the claim: losses during piracy are not covered.');
  if (covered && !piracy) {
    const plan = INSURANCE[ins.plan];
    ins.claims++;
    if (ins.plan === 'basic') {
      state.ship = newStarterShip(old.crew);
      const payout = Math.round(tradeInValue({ ...old, hull: old.hullMax }) * 0.5 / 10) * 10;
      msgs.push(`Basic insurance gives you a used Mule freighter and pays ${payout} credits toward your loss, minus a ${plan.deductible} credit deductible.`);
      receive(payout, msgs, true);
    } else {
      state.ship = buildShip(old.classId);
      state.ship.weapons = [...old.weapons];
      if (ins.plan === 'premium') state.ship.upgrades = [...old.upgrades];
      applyStats(state.ship);
      state.ship.hull = state.ship.hullMax;
      state.ship.missiles = state.ship.missilesMax;
      state.ship.crew = Math.min(old.crew, state.ship.crewMax);
      state.ship.power = { ...old.power };
      applyStats(state.ship);
      msgs.push(`${plan.name} replaces the ${name} with a new ${state.ship.cls}${ins.plan === 'premium' ? ', with all weapons and upgrades' : ' with the same weapons, but no upgrades'}. Deductible ${plan.deductible} credits.`);
    }
    charge(plan.deductible, msgs);
    msgs.push('Future premiums will be higher.');
  } else {
    state.ship = newStarterShip(old.crew);
    state.ship.hull = Math.round(state.ship.hullMax / 2);
    msgs.push(`With no insurance, the Merchant Guild sells you a battered Mule freighter for ${UNINSURED_COST} credits.`);
    charge(UNINSURED_COST, msgs);
  }
  state.fuel = state.ship.tank;
  arrive(port);
  log(`The ${name} was destroyed. Rescued at ${galaxy.systems[port].name}.`);
}

// ---------- money, debt and insurance ----------
const UNINSURED_COST = 3000;
const INSURANCE = {
  basic: { name: 'Basic insurance', rate: 0.03, deductible: 500, desc: 'a used Mule freighter plus half your ship’s value in credits' },
  full: { name: 'Full insurance', rate: 0.06, deductible: 1000, desc: 'a new ship of the same class with the same weapons, but not upgrades' },
  premium: { name: 'Premium insurance', rate: 0.09, deductible: 1500, desc: 'a new ship of the same class with all weapons and upgrades' },
};
const POLICY_DAYS = 30;

// Money you earn goes to your debt first (half of each payment) while you owe the Guild.
function receive(amount, msgs, quiet) {
  if (state.debt > 0) {
    const toDebt = Math.min(state.debt, Math.round(amount / 2));
    state.debt -= toDebt;
    amount -= toDebt;
    if (msgs && toDebt) msgs.push(`${toDebt} credits go to your Guild debt${state.debt ? `, ${state.debt} left` : ', which is now paid off'}.`);
  }
  state.credits += amount;
}
function charge(amount, msgs) {
  const paid = Math.min(amount, state.credits);
  state.credits -= paid;
  if (paid < amount) {
    state.debt += amount - paid;
    msgs.push(`You could not pay ${amount - paid} credits. It becomes a debt to the Merchant Guild. You now owe ${state.debt}.`);
  }
}
function accrueInterest(days, msgs) {
  if (state.debt <= 0) return;
  const before = state.debt;
  state.debt = Math.ceil(state.debt * Math.pow(1.005, days));
  if (state.debt - before >= 1 && msgs && before > 0) { /* interest is shown in the shipyard */ }
}
function insuredValue() {
  return tradeInValue({ ...state.ship, hull: state.ship.hullMax });
}
function insuranceQuote(planId) {
  const guild = getRep(state, 'guild');
  if (guild <= -30) return { denied: 'The Merchant Guild will not insure you while it is hostile to you.' };
  if (getRep(state, 'concord') <= -60) return { denied: 'No insurer will cover a captain the Concord hates.' };
  let risk = (1 + 0.25 * state.insurance.claims) * (1 - sk('negotiation') * 0.02);
  if (state.notoriety >= 25) risk += 0.3;
  if (getRep(state, 'concord') <= -10) risk += 0.5;
  if (guild >= 30) risk -= 0.2;
  const premium = Math.max(100, Math.round(insuredValue() * INSURANCE[planId].rate * risk / 10) * 10);
  return { premium, risk };
}
function buyInsurance(planId) {
  if (!docked() || !offices(here()).includes('guild')) { announce('Insurance is sold at Merchant Guild offices.'); return; }
  const q = insuranceQuote(planId);
  if (q.denied) { announce(q.denied); return; }
  if (state.credits < q.premium) { announce(`Not enough credits. The premium is ${q.premium}.`); return; }
  state.credits -= q.premium;
  const ins = state.insurance;
  const start = ins.plan === planId && ins.expires >= state.day ? ins.expires : state.day;
  ins.plan = planId;
  ins.expires = start + POLICY_DAYS;
  log(`Bought ${INSURANCE[planId].name.toLowerCase()} until day ${ins.expires}.`);
  save(); render();
  announce(`${INSURANCE[planId].name} for ${q.premium} credits, covered until day ${ins.expires}.`);
}
function repayDebt() {
  const n = Math.min(state.debt, state.credits);
  if (!n) { announce(state.debt ? 'Not enough credits.' : 'You owe nothing.'); return; }
  state.credits -= n;
  state.debt -= n;
  save(); render();
  announce(state.debt ? `Repaid ${n}. You still owe ${state.debt}.` : `Repaid ${n}. Your debt is cleared.`);
}

// ---------- saved games ----------
function slotSummary(st) {
  if (!st) return 'Empty';
  const g = generateGalaxy(st.seed);
  return `Captain ${st.captain} of the ${st.shipName}, day ${st.day}, at ${g.systems[st.location].name}, ${st.credits} credits`;
}
function saveToSlot(i) {
  if (state.ironman) return;
  if (state.combat || state.mutiny || state.event || state.salvage) { announce('You cannot save in the middle of this.'); return; }
  const existing = readKey(slotKey(i));
  if (existing && ui.confirmSlot !== i) {
    ui.confirmSlot = i;
    render();
    announce(`Slot ${i} already holds a save. Press Confirm overwrite to replace it.`);
    return;
  }
  ui.confirmSlot = null;
  try { localStorage.setItem(slotKey(i), JSON.stringify(state)); } catch (e) { announce('Could not save.'); return; }
  render();
  announce(`Saved to slot ${i}.`);
}
function loadSlot(i) {
  const st = readKey(slotKey(i));
  if (!st) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
  continueGame();
  announce(`Loaded slot ${i}. You are at ${here().name}, day ${state.day}.`);
}
function slotsHTML(forLoading) {
  const items = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const st = readKey(slotKey(i));
    const summary = st && st.dead ? `${esc(st.dead.reason)}` : esc(slotSummary(st));
    let btn = '';
    if (forLoading) btn = st && !st.dead ? `<button data-action="loadslot" data-arg="${i}" data-key="loadslot-${i}" aria-label="Load slot ${i}">Load</button>` : '';
    else btn = `<button data-action="saveslot" data-arg="${i}" data-key="saveslot-${i}" aria-label="${ui.confirmSlot === i ? `Confirm overwrite slot ${i}` : `Save to slot ${i}`}">${ui.confirmSlot === i ? 'Confirm overwrite' : 'Save here'}</button>`;
    items.push(`<li><p>Slot ${i}: ${summary}.</p>${btn}</li>`);
  }
  return `<ul class="cards">${items.join('')}</ul>`;
}

function leaveCombat() {
  const cb = state.combat;
  state.combat = null;
  state.ship.shield = state.ship.shieldMax;
  if (cb.outcome === 'player-destroyed') {
    finishArrival([]);
    return;
  }
  if (cb.pendingArrival) finishArrival([]);
  else { save(); ui.focus = 'sys-heading'; render(); }
}

function ignoreEncounter() {
  const cb = state.combat;
  state.combat = null;
  if (cb.pendingArrival) finishArrival(['You let them pass.']);
  else { save(); ui.focus = 'sys-heading'; render(); announce('You let them pass.'); }
}

function huntTarget(id) {
  const m = state.missions.find(x => x.id === id);
  if (!m || m.dest !== state.location) return;
  startCombat(missionCombat(m), false);
}

function setPower(sysName, delta) {
  const p = state.ship.power;
  const next = p[sysName] + delta;
  if (next < 0 || next > MAX_POWER_PER_SYSTEM) { announce(`${sysName} power is at its ${delta > 0 ? 'maximum' : 'minimum'}.`); return; }
  if (delta > 0 && usedPower(state.ship) >= state.ship.reactor) { announce('No unassigned power. Take power from another system first.'); return; }
  p[sysName] = next;
  save();
  render();
  announce(`Shields ${p.shields}, weapons ${p.weapons}, engines ${p.engines}. ${state.ship.reactor - usedPower(state.ship)} unassigned.`);
}

// ---------- shipyard ----------
const atOwnShipyard = () => !!(state.holdings && state.holdings.station && state.holdings.station.sys === state.location && state.holdings.station.upgrades.shipyard);
const myFuelPrice = sys => (atOwnShipyard() && sys.id === state.location ? 0 : fuelPrice(sys));
const repairDiscount = () => (atOwnShipyard() ? 0 : 1 - sk('repairs') * 0.04);
const hullRepairPrice = sys => (atOwnShipyard() ? 0 : 1) * Math.max(1, Math.round({ high: 5, medium: 7, low: 9, none: 11 }[sys.security] * repairDiscount()));
const sysRepairPrice = () => Math.round(40 * repairDiscount());
const CREW_PRICE = 50, MISSILE_PRICE = 30;

function repairHull() {
  const price = hullRepairPrice(here());
  const need = state.ship.hullMax - state.ship.hull;
  const n = Math.min(need, Math.floor(state.credits / price));
  if (need <= 0) { announce('Hull is undamaged.'); return; }
  if (n <= 0) { announce('Not enough credits.'); return; }
  state.ship.hull += n;
  state.credits -= n * price;
  gainXP('repairs', 1);
  save(); render();
  announce(`Repaired ${n} hull for ${n * price}. Hull ${state.ship.hull} of ${state.ship.hullMax}.`);
}
function repairSystems() {
  let spent = 0;
  for (const s of SYSTEMS) {
    while (state.ship.sys[s] < 3 && state.credits >= sysRepairPrice()) {
      state.ship.sys[s]++; state.credits -= sysRepairPrice(); spent += sysRepairPrice();
    }
  }
  if (!spent) { announce(SYSTEMS.every(s => state.ship.sys[s] === 3) ? 'All systems are operational.' : 'Not enough credits.'); return; }
  save(); render();
  announce(`Systems repaired for ${spent}. Credits ${state.credits}.`);
}
function buyMissiles() {
  const need = state.ship.missilesMax - state.ship.missiles;
  const n = Math.min(need, Math.floor(state.credits / MISSILE_PRICE));
  if (need <= 0) { announce('Missile racks are full.'); return; }
  if (n <= 0) { announce('Not enough credits.'); return; }
  state.ship.missiles += n; state.credits -= n * MISSILE_PRICE;
  save(); render();
  announce(`Bought ${plural(n, 'missile')}. Missiles ${state.ship.missiles} of ${state.ship.missilesMax}.`);
}


// ---------- jump events and salvage ----------
function beginEvent(ev, msgs) {
  state.event = ev;
  save();
  ui.focus = 'event-heading';
  render();
  const v = eventView(ev);
  announce([...msgs, `${v.title}. ${v.text}`].join(' '));
}

function eventChoice(choiceId) {
  const ev = state.event;
  const before = eventView(ev).text;
  const r = chooseEvent(ev, choiceId);
  if (!r.done) {
    ev.lines = r.lines;
    save(); render();
    const v = eventView(ev);
    announce([...r.lines, v.text !== before ? v.text : ''].filter(Boolean).join(' '));
    return;
  }
  if (r.combat) {
    state.event = null;
    startCombat(r.combat, true, r.lines);
    return;
  }
  if (r.salvage) {
    state.event = null;
    state.salvage = startSalvage(r.salvage);
    if (ev.data.cache) state.salvage.maxDepth += 2;
    save();
    ui.focus = 'salvage-heading';
    render();
    announce(`${state.salvage.log.join(' ')} Each section deeper is riskier, and you keep what you find only if you return.`);
    return;
  }
  ev.result = r.lines;
  ev.lines = [];
  save();
  ui.focus = 'event-result';
  render();
  announce(r.lines.join(' '));
}

function leaveEvent() {
  state.event = null;
  finishArrival([]);
}

function salvageAction(kind) {
  const sv = state.salvage;
  if (kind === 'deeper' && !sv.over) {
    const lines = salvageStep(sv);
    save(); render();
    announce(lines.join(' '));
    return;
  }
  const msgs = finishSalvage(sv);
  state.salvage = null;
  log(`Salvaged a derelict ${sv.name}.`);
  finishArrival(msgs);
}

function eventHTML() {
  const ev = state.event;
  const v = eventView(ev);
  if (ev.result) {
    return `<h1 id="event-heading" tabindex="-1">${esc(v.title)}</h1>
      <section aria-labelledby="event-result"><h2 id="event-result" tabindex="-1">Outcome</h2>
      <ul>${ev.result.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <button data-action="ev-leave" data-key="ev-leave">Continue</button></section>`;
  }
  const lines = (ev.lines || []).map(l => `<p>${esc(l)}</p>`).join('');
  const btns = v.choices.map(c => `<button data-action="ev-choose" data-arg="${c.id}" data-key="ev-${c.id}">${esc(c.label)}</button>`).join(' ');
  return `<h1 id="event-heading" tabindex="-1">${esc(v.title)}</h1>${lines}${v.text ? `<p>${esc(v.text)}</p>` : ''}<p>${btns}</p>`;
}

function salvageHTML() {
  const sv = state.salvage;
  const d = Math.round(salvageDanger(sv) * 100);
  const goods = Object.entries(sv.haul.goods).map(([g, q]) => `${q} ${good(g).name}`).join(', ');
  const haul = `${sv.haul.credits} credits${goods ? `, ${goods}` : ''}`;
  return `<h1 id="salvage-heading" tabindex="-1">Derelict ${esc(sv.name)}</h1>
    <ul>${sv.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <p>Section ${sv.depth} explored. Haul so far: ${haul}. Crew ${state.ship.crew}, hull ${state.ship.hull} of ${state.ship.hullMax}.</p>
    ${sv.over ? '' : `<button data-action="sv-deeper" data-key="sv-deeper">Push deeper, about ${d}% risk of trouble</button>`}
    <button data-action="sv-leave" data-key="sv-leave">Return to your ship with the haul</button>`;
}


// ---------- holdings ----------
function holdingsAct(fn) {
  const out = [];
  fn(out);
  save(); render();
  announce(out.join(' '));
}
function buyWarehouse(out) {
  const h = state.holdings, sys = here();
  if (h.warehouses[sys.id]) return;
  if (Object.keys(h.warehouses).length >= MAX_WAREHOUSES) { out.push(`You can own at most ${MAX_WAREHOUSES} warehouses.`); return; }
  const cost = warehouseCost(sys);
  if (state.credits < cost) { out.push(`A warehouse here costs ${cost}.`); return; }
  state.credits -= cost;
  h.warehouses[sys.id] = { goods: {} };
  log(`Bought a warehouse at ${sys.name}.`);
  out.push(`You buy a warehouse at ${sys.name} for ${cost}. It holds ${WAREHOUSE_CAP} units.`);
}
function storeGoods(gid, out) {
  const w = state.holdings.warehouses[state.location];
  const c = state.cargo[gid];
  if (!w || !c) return;
  const n = Math.min(c.qty, WAREHOUSE_CAP - storedUnits(w));
  if (n <= 0) { out.push('The warehouse is full.'); return; }
  c.cost -= (c.cost / c.qty) * n;
  c.qty -= n;
  if (c.qty <= 0) delete state.cargo[gid];
  w.goods[gid] = (w.goods[gid] || 0) + n;
  out.push(`Stored ${n} ${good(gid).name}.`);
}
function retrieveGoods(gid, out) {
  const w = state.holdings.warehouses[state.location];
  if (!w || !w.goods[gid]) return;
  const n = Math.min(w.goods[gid], freeSpace());
  if (n <= 0) { out.push('Your hold is full.'); return; }
  w.goods[gid] -= n;
  if (w.goods[gid] <= 0) delete w.goods[gid];
  const slot = state.cargo[gid] || (state.cargo[gid] = { qty: 0, cost: 0 });
  slot.qty += n;
  out.push(`Loaded ${n} ${good(gid).name} into your hold.`);
}
function trade_shares(id, n, out) {
  const h = state.holdings, L = h.lines[id];
  if (!offices(here()).includes('guild') || !docked()) { out.push('Shares are traded at Merchant Guild offices.'); return; }
  if (n > 0) {
    const k = Math.min(n, Math.floor(state.credits / L.price));
    if (k <= 0) { out.push(`One share costs ${L.price}.`); return; }
    state.credits -= k * L.price;
    h.shares[id] = (h.shares[id] || 0) + k;
    out.push(`Bought ${plural(k, 'share')} of ${LINES[id].name} for ${k * L.price}.`);
  } else {
    const k = Math.min(-n, h.shares[id] || 0);
    if (!k) return;
    const each = Math.round(L.price * 0.98);
    state.credits += k * each;
    h.shares[id] -= k;
    out.push(`Sold ${plural(k, 'share')} of ${LINES[id].name} for ${k * each}.`);
  }
}
function buyStation(out) {
  const h = state.holdings, sys = here();
  if (h.station) return;
  if (sys.authority !== 'Independent' || !docked()) { out.push('Stations can only be bought at independent ports.'); return; }
  if (state.debt > 0) { out.push('The Guild will not sell to you while you owe it money.'); return; }
  if (state.credits < STATION_COST) { out.push(`A station costs ${STATION_COST}.`); return; }
  state.credits -= STATION_COST;
  h.station = { sys: sys.id, name: `${state.captain}'s Haven`, upgrades: { market: 0, defense: 0, shipyard: 0 } };
  changeLocal(state, galaxy, sys.id, 20, out);
  pushNews(`Captain ${state.captain} has bought a station at ${sys.name}: ${h.station.name}.`);
  log(`Bought ${h.station.name} at ${sys.name}.`);
  out.push(`${h.station.name} at ${sys.name} is yours. It earns money every 10 days.`);
}
function upgradeStation(k, out) {
  const stn = state.holdings.station, u = STATION_UPGRADES[k];
  if (!stn || stn.sys !== state.location) return;
  const lvl = stn.upgrades[k];
  if (lvl >= u.max) { out.push(`${u.name} is fully built.`); return; }
  const cost = u.cost(lvl);
  if (state.credits < cost) { out.push(`That costs ${cost}.`); return; }
  state.credits -= cost;
  stn.upgrades[k]++;
  out.push(`${u.name} built to level ${stn.upgrades[k]} for ${cost}.`);
}

function holdingsHTML() {
  const h = state.holdings, sys = here(), isDocked = docked();
  const hops = hopCounts(galaxy, state.location);
  const w = h.warehouses[sys.id];
  const whList = Object.entries(h.warehouses).map(([id, wh]) => {
    const n = Number(id);
    const contents = Object.entries(wh.goods).map(([g, q]) => `${q} ${good(g).name}`).join(', ') || 'empty';
    return `<li>${esc(galaxy.systems[n].name)}${n === state.location ? ', here' : `, ${plural(hops[n], 'jump')} away`}: ${storedUnits(wh)} of ${WAREHOUSE_CAP}, ${contents}.</li>`;
  }).join('');
  let whHere = '';
  if (isDocked && w) {
    const store = GOODS.filter(g => state.cargo[g.id]).map(g => `<button data-action="h-store" data-arg="${g.id}" data-key="h-store-${g.id}">Store ${state.cargo[g.id].qty} ${g.name}</button>`).join(' ');
    const take = Object.entries(w.goods).map(([g, q]) => `<button data-action="h-take" data-arg="${g}" data-key="h-take-${g}">Load ${q} ${good(g).name}</button>`).join(' ');
    whHere = `<h3>Your warehouse here</h3><p>${store || 'Nothing in your hold to store.'}</p><p>${take || 'Nothing stored here.'}</p>`;
  } else if (isDocked && Object.keys(h.warehouses).length < MAX_WAREHOUSES) {
    whHere = `<p><button data-action="h-warehouse" data-key="h-warehouse">Buy a warehouse here, ${warehouseCost(sys)} credits</button></p>`;
  }
  const canTrade = isDocked && offices(sys).includes('guild');
  const lines = Object.entries(LINES).map(([id, line]) => {
    const L = h.lines[id], n = h.shares[id] || 0;
    const ch = L.price - L.last;
    const btns = canTrade ? `<button data-action="h-shares" data-arg="${id}:1" data-key="h-buy1-${id}" aria-label="Buy 1 share of ${line.name}">Buy 1</button>
      <button data-action="h-shares" data-arg="${id}:10" data-key="h-buy10-${id}" aria-label="Buy 10 shares of ${line.name}">Buy 10</button>
      ${n ? `<button data-action="h-shares" data-arg="${id}:-1" data-key="h-sell1-${id}" aria-label="Sell 1 share of ${line.name}">Sell 1</button>
      <button data-action="h-shares" data-arg="${id}:-9999" data-key="h-sellall-${id}" aria-label="Sell all shares of ${line.name}">Sell all</button>` : ''}` : '';
    return `<li><p>${line.name}, ${line.desc}: ${L.price} a share, ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch)} last period, dividend about ${Math.round(line.div * 100 * 10) / 10}% every 10 days. You own ${n}${n ? `, worth ${n * L.price}` : ''}.</p>${btns}</li>`;
  }).join('');
  let stn = '';
  if (h.station) {
    const st = h.station;
    const ups = Object.entries(STATION_UPGRADES).map(([k, u]) => {
      const lvl = st.upgrades[k];
      const btn = st.sys === state.location && lvl < u.max ? `<button data-action="h-upgrade" data-arg="${k}" data-key="h-upgrade-${k}">Build, ${u.cost(lvl)} credits</button>` : '';
      return `<li><p>${u.name}, level ${lvl} of ${u.max}: ${u.desc}.</p>${btn}</li>`;
    }).join('');
    stn = `<p>${esc(st.name)} at ${esc(galaxy.systems[st.sys].name)}${st.sys === state.location ? ', here' : `, ${plural(hops[st.sys], 'jump')} away`}. Earns about ${900 + 500 * st.upgrades.market} credits every 10 days, half when its region is troubled by war, blockades or pirate surges. Pirate raids can take a period's income.</p><ul class="cards">${ups}</ul>`;
  } else {
    stn = `<p>You don't own a station. One costs ${STATION_COST} credits at any independent port.</p>${isDocked && sys.authority === 'Independent' ? `<button data-action="h-station" data-key="h-station">Buy a station here, ${STATION_COST} credits</button>` : ''}`;
  }
  return `<section id="sec-holdings" aria-labelledby="h-holdings"><h2 id="h-holdings" tabindex="-1">Holdings</h2>
    <p>Shares and station are worth about ${netWorth()} credits. Payments arrive every 10 days and are announced when you next arrive somewhere.</p>
    <h3>Warehouses</h3>${whList ? `<ul>${whList}</ul>` : '<p>You have none.</p>'}<p>Warehouses at low and no security ports can be robbed.</p>${whHere}
    <h3>Guild shipping lines</h3><ul class="cards">${lines}</ul>${canTrade ? '' : '<p>Shares are bought and sold at Merchant Guild offices.</p>'}
    <h3>Station</h3>${stn}</section>`;
}

// ---------- cantina ----------
const BETS = [50, 100, 250, 500];
function startGame(kind, arg) {
  const s = sysState(state, state.location);
  if (kind === 'starjack' && s.bannedUntil && state.day < s.bannedUntil) { announce('The card dealers here won’t play with you after you were caught cheating.'); return; }
  const bet = kind === 'pit' ? PIT_TIERS[Number(arg)].fee : Number(arg);
  if (state.credits < bet) { announce('You can’t cover that.'); return; }
  state.credits -= bet;
  ui.game = kind === 'starjack' ? startStarjack(bet) : kind === 'dice' ? startDice(bet) : startPit(Number(arg));
  if (ui.game.over) settleGame();
  render();
  announce(ui.game.lines.join(' '));
}
function settleGame() {
  const g = ui.game;
  if (g.settled) return;
  g.settled = true;
  const extra = [];
  if (g.game === 'pit') {
    if (g.result === 'win') { state.credits += PIT_TIERS[g.tier].purse; morale(2, extra); }
  } else if (g.result === 'win') state.credits += g.bet * 2;
  else if (g.result === 'starjack') state.credits += Math.round(g.bet * 2.5);
  else if (g.result === 'push') state.credits += g.bet;
  g.lines.push(...extra, `Credits ${state.credits}.`);
  save();
}
function gameAction(a) {
  const g = ui.game;
  if (!g || g.over) return;
  const out = [];
  if (a === 'hit') starjackHit(g);
  if (a === 'stand') starjackStand(g);
  if (a === 'cheat') {
    const ok = Math.random() < Math.max(0.1, Math.min(0.9, 0.35 + sk('deception') * 0.06));
    gainXP('deception', ok ? 4 : 2, out);
    if (ok) { starjackHit(g, bestCard(g)); g.lines.unshift('You palm a card from your sleeve.'); }
    else {
      g.over = true; g.result = 'lose'; g.settled = true;
      const fine = Math.min(state.credits, 100);
      state.credits -= fine;
      sysState(state, state.location).bannedUntil = state.day + 10;
      g.lines = [`The dealer catches you cheating. You lose your bet, pay a ${fine} credit fine, and are banned from the tables here for 10 days.`];
      changeLocal(state, galaxy, state.location, -8, g.lines);
    }
  }
  if (a === 'roll') diceRoll(g);
  if (a === 'stop') diceStop(g);
  if (['strike', 'guard', 'feint'].includes(a)) { pitRound(g, a, sk('dueling') + weaponBonus(state), armorBonus(state)); gainXP('dueling', 2, out); }
  g.lines.push(...out);
  if (g.over) settleGame();
  render();
  announce(g.lines.join(' '));
}

function cantinaHTML() {
  const sys = here();
  const g = ui.game;
  const pitOk = sys.authority !== 'Concord';
  if (g) {
    const name = { starjack: 'Starjack', dice: 'Void Dice', pit: 'Pit fight' }[g.game];
    let btns = '';
    if (!g.over) {
      if (g.game === 'starjack') btns = `<button data-action="g-hit" data-key="g-hit">Hit</button> <button data-action="g-stand" data-key="g-stand">Stand</button> <button data-action="g-cheat" data-key="g-cheat">Palm a card (deception ${sk('deception')})</button>`;
      if (g.game === 'dice') btns = `<button data-action="g-roll" data-key="g-roll">Roll</button> ${g.total ? `<button data-action="g-stop" data-key="g-stop">Stop at ${g.total}</button>` : ''}`;
      if (g.game === 'pit') btns = ['strike', 'guard', 'feint'].map(m => `<button data-action="g-${m}" data-key="g-${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`).join(' ');
    } else {
      const again = g.game === 'pit' ? `data-arg="pit:${g.tier}"` : `data-arg="${g.game}:${g.bet}"`;
      btns = `<button data-action="g-start" ${again} data-key="g-again">Play again</button>`;
    }
    const state2 = g.game === 'starjack' ? `<p>Your hand: ${g.you.join(', ')}, total ${handTotal(g.you)}. Dealer shows ${g.dealer[0]}.</p>` : g.game === 'dice' ? `<p>Your total: ${g.total}. Bet ${g.bet}.</p>` : `<p>You ${g.you}, them ${g.them}.</p>`;
    return `<section id="sec-cantina" aria-labelledby="h-cantina"><h2 id="h-cantina" tabindex="-1">${name}</h2>
      <ul>${g.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${g.over ? '' : state2}
      <p>${btns}</p><button data-action="g-leave" data-key="g-leave">Leave the table</button></section>`;
  }
  const bets = kind => BETS.filter(b => b <= state.credits).map(b => `<button data-action="g-start" data-arg="${kind}:${b}" data-key="g-${kind}-${b}" aria-label="Play ${kind === 'starjack' ? 'Starjack' : 'Void Dice'} for ${b}">${b}</button>`).join(' ');
  const pits = PIT_TIERS.map((t, i) => `<li><p>Fight ${t.name}: entry ${t.fee}, purse ${t.purse}.</p>${state.credits >= t.fee ? `<button data-action="g-start" data-arg="pit:${i}" data-key="g-pit-${i}" aria-label="Fight ${t.name}">Fight</button>` : ''}</li>`).join('');
  return `<section id="sec-cantina" aria-labelledby="h-cantina"><h2 id="h-cantina" tabindex="-1">Cantina</h2>
    <p>Credits ${state.credits}.</p>
    <h3>Starjack</h3><p>Get closer to 21 than the dealer without going over. The dealer stands on 17. Starjack, 21 with your first two cards, pays 3 to 2. You can try to palm a card, using deception.</p>
    <p>${bets('starjack') || 'You can’t afford a bet.'}</p>
    <h3>Void Dice</h3><p>Roll as often as you like, adding up your rolls. A 1 busts you. When you stop, the house rolls and must beat your total without busting.</p>
    <p>${bets('dice') || 'You can’t afford a bet.'}</p>
    <h3>Pit fights</h3>${pitOk ? `<p>Three blows wins. Strike beats feint, guard beats strike, feint beats guard. Ties go to the better fighter, using dueling.</p><ul class="cards">${pits}</ul>` : '<p>The Concord bans pit fights. Try an independent or pirate port.</p>'}</section>`;
}

// ---------- rendering ----------
function titleHTML() {
  const saved = loadSave();
  let cont = '';
  if (saved) {
    const g = generateGalaxy(saved.seed);
    cont = saved.dead ? `<section aria-labelledby="h-cont"><h2 id="h-cont" tabindex="-1">Last campaign</h2>
      <p>${esc(saved.dead.reason)}</p>
      <button data-action="continue" data-key="continue">View</button></section>` : `<section aria-labelledby="h-cont"><h2 id="h-cont" tabindex="-1">Continue</h2>
      <p>Captain ${esc(saved.captain)} of the ${esc(saved.shipName)}, day ${saved.day}, at ${esc(g.systems[saved.location].name)}, ${saved.credits} credits.</p>
      <button data-action="continue" data-key="continue">Continue campaign</button></section>`;
  }
  const warn = saved && ui.confirmNew
    ? `<p role="alert">Starting a new campaign will replace your saved one. Press Start again to confirm.</p>` : '';
  let slots = '';
  for (let i = 1; i <= SLOT_COUNT; i++) if (readKey(slotKey(i))) { slots = `<section aria-labelledby="h-slots"><h2 id="h-slots">Saved games</h2>${slotsHTML(true)}</section>`; break; }
  return `<h1 id="title-heading" tabindex="-1">Hull and Honor</h1>
    <p>Trade, smuggle, raid or hunt pirates across a lawless galaxy. Your reputation decides who welcomes you and who wants you dead.</p>
    <button data-action="help" data-key="help">How to play</button>
    ${cont}${slots}
    <section aria-labelledby="h-new"><h2 id="h-new">New campaign</h2>
      <form id="new-form">
        <p><label for="f-captain">Captain name</label><br><input id="f-captain" name="captain" autocomplete="off" maxlength="30"></p>
        <p><label for="f-ship">Ship name</label><br><input id="f-ship" name="ship" autocomplete="off" maxlength="30"></p>
        <p><label for="f-seed">Galaxy seed (optional)</label><br><input id="f-seed" name="seed" autocomplete="off" maxlength="30"></p>
        <p><input type="checkbox" id="f-ironman" name="ironman"> <label for="f-ironman">One life mode: no saved games or reloads. Death ends the campaign for good.</label></p>
        ${warn}
        <button type="submit" data-key="start">Start</button>
      </form></section>`;
}

function holdContents() {
  const parts = [];
  for (const g of GOODS) if (state.cargo[g.id]) parts.push(`${g.name} ${state.cargo[g.id].qty}`);
  for (const m of state.missions) {
    if (m.type === 'freight') parts.push(`Guild freight ${m.units}`);
    if (m.type === 'dispatch') parts.push('Concord dispatches 1');
    if (m.type === 'smuggle') parts.push(`Contraband crates ${m.units}`);
  }
  return parts.length ? parts.join(', ') : 'empty';
}

function statusHTML() {
  const path = coursePath();
  let course = '<li>No course plotted.</li>';
  if (path) {
    let ly = 0, fuel = 0, days = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const lane = galaxy.adj[path[i]].find(l => l.to === path[i + 1]);
      const c = navCost(lane.ly);
      ly += lane.ly; fuel += c.fuel; days += c.days;
    }
    course = `<li>Course to ${esc(galaxy.systems[state.course].name)}: ${plural(path.length - 1, 'jump')}, ${ly.toFixed(1)} light-years, ${fuel} fuel, about ${plural(days, 'day')}.</li>`;
  }
  return `<section id="sec-status" aria-labelledby="h-status"><h2 id="h-status" tabindex="-1">Status</h2><ul>
    <li>Hold: ${holdContents()}</li>
    ${state.caches.length ? `<li>Cache coordinates: ${state.caches.map(id => esc(galaxy.systems[id].name)).join(', ')}</li>` : ''}
    <li>Ship: the ${esc(state.shipName)}, ${state.ship.cls}</li>
    <li>Systems: ${systemsText(state.ship)}</li>
    <li>Crew: ${state.ship.crew} of ${state.ship.crewMax}</li>
    <li>Insurance: ${state.insurance.plan === 'none' ? 'none' : `${INSURANCE[state.insurance.plan].name.toLowerCase()} until day ${state.insurance.expires}`}${state.debt ? `. Guild debt ${state.debt}` : ''}</li>
    ${course}</ul>${strandedHTML()}</section>`;
}

// Stuck with no fuel to reach anywhere and no money to buy it.
function stranded() {
  const cheapest = Math.min(...galaxy.adj[state.location].map(l => navCost(l.ly).fuel));
  if (state.fuel >= cheapest) return false;
  const price = fuelPrice(here()) * (docked() ? 1 : 3);
  return state.credits < (cheapest - state.fuel) * price;
}
function strandedHTML() {
  if (!stranded()) return '';
  return `<p>You don't have the fuel or the credits to leave.</p>
    <button data-action="distress" data-key="distress">Send a distress call for a tow, 400 credits added to your Guild debt</button>`;
}
function distressCall() {
  if (!stranded()) return;
  const msgs = [];
  const hops = hopCounts(galaxy, state.location);
  const order = galaxy.systems.map(x => x.id).filter(id => id !== state.location && hops[id] < Infinity).sort((a, b) => hops[a] - hops[b]);
  const port = order.find(id => dockingStatus(state, galaxy.systems[id]).ok) ?? state.location;
  state.debt += 400;
  state.day += 3;
  payWages(3, msgs);
  checkDeadlines(msgs);
  state.fuel = Math.max(state.fuel, Math.min(state.ship.tank, 4));
  arrive(port);
  msgs.unshift(`A Guild tug tows you to ${here().name} and leaves you 4 fuel. You owe the Guild ${state.debt} credits.`);
  log(`Towed to ${here().name}.`);
  finishArrival(msgs);
}

function systemsText(c) {
  if (SYSTEMS.every(x => c.sys[x] === 3)) return 'all operational';
  return SYSTEMS.map(x => `${x} ${SYSTEM_STATE[c.sys[x]]}`).join(', ');
}

function missionDetails(m, hops) {
  if (isPersonal(m)) {
    const where = m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away`;
    return `Personal favor: ${m.title} (${where}).`;
  }
  if (isStory(m)) {
    const where = m.dest === -1 ? 'anywhere' : m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away`;
    return `Story, ${ARCS[m.arc].title}: ${m.title} (${where}).`;
  }
  const dest = galaxy.systems[m.dest];
  const left = m.deadline - state.day;
  const due = left === 0 ? 'due today' : `due day ${m.deadline}, ${plural(left, 'day')} left`;
  const where = m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away, ${dest.authority}`;
  const space = missionSpace(m) ? `, takes ${missionSpace(m)} hold space` : '';
  const risk = (m.type === 'smuggle' && dest.authority === 'Concord' ? ', customs risk at destination' : '')
    + (m.hotCargo ? ', secretly contraband' : '') + (m.rushBy != null ? `, rush bonus if delivered by day ${m.rushBy}` : '')
    + (m.race && rivalById(m.race.rivalId) ? `, racing ${rivalById(m.race.rivalId).name}, who should arrive around day ${m.race.eta}` : '');
  return `${missionTitle(m, galaxy)} (${where}). For the ${factionName(m.faction)}. Pays ${m.pay}, ${due}${space}${risk}.`;
}

function storyHTML() {
  const entries = storyEntries().filter(e => e.status !== 'active' || e.options);
  if (!entries.length) return '';
  const items = entries.map(e => {
    let body = `<p>${e.title}: ${e.status === 'done' ? 'complete' : e.status === 'failed' ? 'ended' : e.status === 'declined' ? 'declined' : esc(e.text)}</p>`;
    if (e.status === 'offered') {
      body += `<button data-action="story-accept" data-arg="${e.id}" data-key="story-accept-${e.id}">${e.acceptLabel}</button>
        <button data-action="story-decline" data-arg="${e.id}" data-key="story-decline-${e.id}">${e.declineLabel}</button>`;
    }
    if (e.options) body += e.options.map(o => `<button data-action="story-choose" data-arg="${e.id}:${o.id}" data-key="story-choose-${e.id}-${o.id}">${esc(o.label)}</button>`).join(' ');
    return `<li>${body}</li>`;
  }).join('');
  return `<h3>Story</h3><ul class="cards">${items}</ul>`;
}

function storyAct(fn) {
  const msgs = [];
  fn(msgs);
  save();
  render();
  announce(msgs.join(' '));
}

function contractsHTML() {
  const sys = here();
  const hops = hopCounts(galaxy, state.location);
  const isDocked = docked();
  const active = state.missions.map(m => {
    const btns = [];
    if (m.dest !== state.location && m.dest !== -1) btns.push(`<button data-action="plotto" data-arg="${m.dest}" data-key="plotto-${m.id}">Plot course to ${esc(galaxy.systems[m.dest].name)}</button>`);
    if ((COMBAT_TYPES.includes(m.type) || (isStoryFight(m) && m.dest !== -1)) && m.dest === state.location) {
      const label = isStory(m) ? 'Search for your target' : m.type === 'patrol' ? 'Hunt pirates here' : m.type === 'bounty' ? `Search for ${esc(m.target)}` : 'Search for the convoy';
      btns.push(`<button data-action="hunt" data-arg="${m.id}" data-key="hunt-${m.id}">${label}</button>`);
    }
    if (isSpecial(m) && m.deliverOnly && m.dest === state.location && isDocked) btns.push(`<button data-action="deliver" data-arg="${m.id}" data-key="deliver-${m.id}">Deliver ${m.units} ${good(m.goodId).name}</button>`);
    if (m.type === 'procure' && m.dest === state.location && isDocked) btns.push(`<button data-action="deliver" data-arg="${m.id}" data-key="deliver-${m.id}">Deliver ${m.units} ${good(m.goodId).name}</button>`);
    const confirm = ui.confirmAbandon === m.id;
    btns.push(`<button data-action="abandon" data-arg="${m.id}" data-key="abandon-${m.id}">${confirm ? 'Confirm abandon' : 'Abandon'}</button>`);
    return `<li><p>${missionDetails(m, hops)}</p>${btns.join(' ')}</li>`;
  }).join('');
  let boards = '';
  if (isDocked) {
    const board = getBoard(sys);
    for (const office of offices(sys)) {
      const faction = officeFaction(office, sys);
      const rep = getRep(state, faction);
      const mine = board.filter(m => m.office === office);
      let body;
      if (accessTier(rep) < 0) {
        body = `<p>The ${factionName(faction)} won't offer you work while you are ${tierName(rep)}.</p>`;
      } else {
        const open = mine.filter(m => canTake(state, m));
        const locked = mine.filter(m => !canTake(state, m));
        const items = open.map(m => `<li><p>${missionDetails(m, hops)}</p><button data-action="accept" data-arg="${m.id}" data-key="accept-${m.id}">Accept</button></li>`).join('');
        body = open.length ? `<ul class="cards">${items}</ul>` : '<p>No contracts available for you right now.</p>';
        if (locked.length) {
          const need = TIER_REQUIREMENT[Math.min(...locked.map(m => m.tier))];
          body += `<p>${locked.length === 1 ? '1 more contract needs' : `${locked.length} more contracts need`} higher standing, starting at ${need}.</p>`;
        }
      }
      boards += `<h3>${officeName(office, sys)}</h3>${body}`;
    }
    boards += `<p>New contracts are posted every ${BOARD_REFRESH_DAYS} days.</p>`;
  }
  return `<section id="sec-contracts" aria-labelledby="h-contracts"><h2 id="h-contracts" tabindex="-1">Contracts</h2>
    ${storyHTML()}
    <h3>Your contracts, ${contractCount()} of ${MAX_ACTIVE}</h3>
    ${active ? `<ul class="cards">${active}</ul>` : '<p>None.</p>'}
    ${boards}</section>`;
}

function marketHTML() {
  const sys = here();
  const hopsHere = hopCounts(galaxy, state.location);
  const items = GOODS.filter(g => !g.illegal || hasBlackMarket(sys)).map(g => {
    const p = prices(state, sys, g);
    const tag = tradeTag(sys, g);
    const c = state.cargo[g.id];
    let held = '';
    if (c) {
      const best = bestSellElsewhere(g.id, hopsHere);
      held = `. In hold: ${c.qty}, paid ${Math.round(c.cost / c.qty)} each${best ? `. Best known: sells for ${best.n.sell} at ${esc(galaxy.systems[best.id].name)}, ${plural(hopsHere[best.id], 'jump')} away` : ''}`;
    }
    const sellBtns = c
      ? `<button data-action="sell1" data-arg="${g.id}" data-key="sell1-${g.id}" aria-label="Sell 1 ${g.name}">Sell 1</button>
         <button data-action="sellall" data-arg="${g.id}" data-key="sellall-${g.id}" aria-label="Sell all ${g.name}">Sell all</button>` : '';
    return `<li><p>${g.name}: buy ${p.buy}, sell ${p.sell}${tag ? `, ${tag}` : ''}${held}.</p>
      <button data-action="buy1" data-arg="${g.id}" data-key="buy1-${g.id}" aria-label="Buy 1 ${g.name}">Buy 1</button>
      <button data-action="buymax" data-arg="${g.id}" data-key="buymax-${g.id}" aria-label="Buy max ${g.name}">Buy max</button>
      ${sellBtns}</li>`;
  }).join('');
  const note = hasBlackMarket(sys) ? '' : '<p>Contraband cannot be traded in Concord ports.</p>';
  const sellable = GOODS.filter(g => state.cargo[g.id] && (!g.illegal || hasBlackMarket(sys)));
  const sellAll = sellable.length > 1 ? `<button data-action="sellcargo" data-key="sellcargo">Sell all cargo you can sell here</button>` : '';
  return `<section id="sec-market" aria-labelledby="h-market"><h2 id="h-market" tabindex="-1">Market</h2>
    ${note}${sellAll}<ul class="cards">${items}</ul></section>`;
}

function servicesHTML() {
  const sys = here();
  const sh = state.ship;
  const price = myFuelPrice(sys);
  const need = sh.tank - state.fuel;
  const hullNeed = sh.hullMax - sh.hull;
  const sysNeed = SYSTEMS.reduce((n, x) => n + (3 - sh.sys[x]), 0);
  const misNeed = sh.missilesMax - sh.missiles;
  return `<section id="sec-services" aria-labelledby="h-services"><h2 id="h-services" tabindex="-1">Shipyard</h2>
    <p>Credits ${state.credits}. Fuel ${price} per unit, hull repair ${hullRepairPrice(sys)} per point, system repair ${sysRepairPrice()} per level.</p>
    <button data-action="serviceall" data-key="serviceall">Refuel, repair and restock everything</button>
    <button data-action="refuel" data-key="refuel">Refuel to full${need ? `, ${need * price} credits` : ''}</button>
    <button data-action="fuel1" data-key="fuel1">Buy 1 fuel</button>
    ${hullNeed ? `<button data-action="repairhull" data-key="repairhull">Repair hull, ${hullNeed * hullRepairPrice(sys)} credits</button>` : ''}
    ${sysNeed ? `<button data-action="repairsys" data-key="repairsys">Repair systems, ${sysNeed * sysRepairPrice()} credits</button>` : ''}
    ${misNeed > 0 ? `<button data-action="missiles" data-key="missiles">Restock ${plural(misNeed, 'missile')}, ${misNeed * MISSILE_PRICE} credits</button>` : ''}
    </section>`;
}

// ---------- combat screen ----------
function weaponLine(c, target, id, range, aim, mine) {
  const w = WEAPONS[id];
  const ammo = w.ammo ? `, ${c.missiles} missiles left` : '';
  if (!mine) return `<li>${w.name}${ammo}</li>`;
  const ch = Math.round(hitChance(c, target, id, range, aim) * 100);
  return `<li>${w.name}: ${w.dmg} damage, uses ${w.power} power, ${ch}% to hit now${ammo}</li>`;
}

function combatHTML() {
  const cb = state.combat;
  const e = cb.enemy;
  const p = state.ship;
  const head = `<h1 id="combat-heading" tabindex="-1">Combat: ${esc(e.name)}</h1>`;
  if (cb.phase === 'approach') {
    return `${head}<p>${esc(cb.intro)}</p>
      <p>Attacking them is piracy: the Merchant Guild and the Concord will hate it, and the pirate clans will approve.</p>
      <button data-action="c-attack" data-key="c-attack">Attack them</button>
      <button data-action="c-ignore" data-key="c-ignore">Let them pass</button>`;
  }
  if (cb.phase === 'result') {
    let choices = '';
    if (cb.outcome === 'enemy-surrendered') {
      const hasCargo = e.cargo.some(c => c.qty > 0);
      choices = `<p>What do you do with them?</p>
        ${hasCargo ? '<button data-action="c-loot" data-key="c-loot">Take their cargo and let them go</button>' : ''}
        ${e.captain ? `<button data-action="c-prisoner" data-key="c-prisoner">Take ${esc(e.captain)} prisoner</button>` : ''}
        <button data-action="c-release" data-key="c-release">Let them go</button>
        <button data-action="c-destroy" data-key="c-destroy">Destroy them</button>`;
    } else {
      choices = '<button data-action="c-leave" data-key="c-leave">Continue</button>';
    }
    return `${head}<section aria-labelledby="combat-result"><h2 id="combat-result" tabindex="-1">Outcome</h2>
      <ul>${cb.resultText.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${choices}</section>`;
  }
  const pressed = (cond) => `aria-pressed="${cond ? 'true' : 'false'}"`;
  const moves = [[-1, 'Close in'], [0, 'Hold range'], [1, 'Pull back']].map(([v, l]) =>
    `<button data-action="c-move" data-arg="${v}" data-key="c-move${v}" ${pressed(cb.move === v)}>${l}</button>`).join(' ');
  const targets = ['hull', 'shields', 'weapons', 'engines'].map(t =>
    `<button data-action="c-target" data-arg="${t}" data-key="c-target-${t}" ${pressed(cb.target === t)}>${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join(' ');
  const power = SYSTEMS.map(x => `<li><p>${x.charAt(0).toUpperCase() + x.slice(1)}: ${p.power[x]} power${effPower(p, x) !== p.power[x] ? `, ${effPower(p, x)} effective` : ''}</p>
    <button data-action="c-power" data-arg="${x}:1" data-key="c-power-${x}-up" aria-label="More power to ${x}">More</button>
    <button data-action="c-power" data-arg="${x}:-1" data-key="c-power-${x}-down" aria-label="Less power to ${x}">Less</button></li>`).join('');
  const boardOk = cb.range === 0 && effPower(e, 'engines') === 0;
  const odds = oddsText(boardingOdds(p, e, false));
  const demand = e.side !== 'concord'
    ? `<button data-action="c-demand" data-key="c-demand">Demand surrender instead of firing</button>` : '';
  const surrender = e.side !== 'merchant'
    ? `<button data-action="c-surrender" data-key="c-surrender">${ui.confirmSurrender ? 'Confirm surrender' : 'Surrender'}</button>` : '';
  const last = cb.lines.length ? cb.lines : [cb.intro];
  return `${head}
    <p>Range ${RANGES[cb.range]}. Turn ${cb.turn + 1}. Maneuver: ${cb.move < 0 ? 'close in' : cb.move > 0 ? 'pull back' : 'hold range'}. Target: ${cb.target}.</p>
    <button data-action="c-turn" data-key="c-turn">Fire and maneuver</button>
    <section id="sec-lastturn" aria-labelledby="h-lastturn"><h2 id="h-lastturn" tabindex="-1">Last turn</h2>
      <ul>${last.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>
    <section id="sec-orders" aria-labelledby="h-orders"><h2 id="h-orders" tabindex="-1">Orders</h2>
      <h3>Maneuver</h3><p>${moves}</p>
      <p>Pulling back at extreme range escapes the fight.</p>
      <h3>Target</h3><p>${targets}</p>
      <p>Aiming at a system is 10% less accurate. Shots hit shields first.</p>
      <h3>Power, ${p.reactor - usedPower(p)} of ${p.reactor} unassigned</h3><ul class="cards">${power}</ul></section>
    <section id="sec-you" aria-labelledby="h-you"><h2 id="h-you" tabindex="-1">Your ship</h2><ul>
      <li>Hull ${p.hull} of ${p.hullMax}</li><li>Shields ${p.shield} of ${p.shieldMax}</li>
      <li>Systems: ${systemsText(p)}</li><li>Crew ${p.crew}</li></ul>
      <h3>Weapons</h3><ul>${p.weapons.map(id => weaponLine(p, e, id, cb.range, cb.target, true)).join('')}</ul></section>
    <section id="sec-them" aria-labelledby="h-them"><h2 id="h-them" tabindex="-1">Enemy</h2><ul>
      <li>${esc(e.name)}, ${factionName(e.faction)}</li>
      <li>Hull ${e.hull} of ${e.hullMax}</li><li>Shields ${e.shield} of ${e.shieldMax}</li>
      <li>Systems: ${systemsText(e)}</li><li>Crew ${e.crew}</li></ul>
      <h3>Weapons</h3><ul>${e.weapons.map(id => weaponLine(e, p, id, cb.range, 'hull', false)).join('')}</ul></section>
    <section id="sec-other" aria-labelledby="h-other"><h2 id="h-other" tabindex="-1">Other actions</h2>
      <button data-action="c-repair" data-key="c-repair">Emergency repairs instead of firing</button>
      ${demand}
      ${boardOk ? `<button data-action="c-board" data-key="c-board">Board them, odds ${odds}. If you lose, you die.</button>` : '<p>Boarding needs close range and their engines disabled.</p>'}
      ${surrender}</section>`;
}


function helpHTML() {
  return `<h1 id="help-heading" tabindex="-1">How to play</h1>
    <button data-action="helpback" data-key="helpback">Back</button>
    <h2>Getting around</h2>
    <p>Each port screen has a row of view buttons: Bridge, Contracts, Market, Shipyard, Captain, Crew and Records. The Bridge lists jump lanes to neighboring systems, with fuel, days and what kind of place each one is. Plot a course to any system and the Bridge offers its next jump. Each jump costs fuel, days and crew wages.</p>
    <h2>Making money</h2>
    <p>Buy goods marked local product, and sell them where they are in demand. Price notes in the Market view remember prices at systems you have visited. Buying or selling a lot moves prices against you, and they recover over a few days. Contracts pay more as your standing with a faction rises. Contraband sells only outside Concord ports, and customs at Concord ports may catch you.</p>
    <h2>Reputation</h2>
    <p>The Merchant Guild, the Concord and four pirate clans each track your standing, and so does every port. Helping one side often hurts another. High standing opens better contracts, ships and stories. Low standing closes ports, and very low standing gets you hunted, or executed if you're captured.</p>
    <h2>Combat</h2>
    <p>Fights happen at four ranges: close, medium, long and extreme. Each turn, set your maneuver, target and reactor power, then press Fire and maneuver. Your orders stay set until you change them. Lasers are best close, cannons at medium, missiles at long range. Pull back at extreme range to escape. Knock out an enemy's engines to stop them fleeing and to board them. Running is often the smart choice in a weak ship.</p>
    <h2>Captain and crew</h2>
    <p>Captain skills grow as you use them, from trainers at ports, and from skill points earned through stories and contracts. Your crew needs wages and cares how you behave: lawful crews dislike piracy, outlaw crews dislike Concord work. Low loyalty leads to desertion, then mutiny.</p>
    <h2>Losing</h2>
    <p>If your ship is destroyed you escape in a pod, unless a faction that hates you catches it. Insurance from the Merchant Guild replaces your ship. Without it you start over in a battered freighter and may end up in debt. Losing a boarding fight or a mutiny kills you. Use save slots in Records, or start in one life mode for no second chances.</p>
    <button data-action="helpback" data-key="helpback-end">Back</button>`;
}

function gameOverHTML() {
  const backup = (() => { try { return localStorage.getItem(PREFIGHT_KEY); } catch (e) { return null; } })();
  return `<h1 id="over-heading" tabindex="-1">Game over</h1>
    <p>${esc(state.dead.reason)}</p>
    ${state.ironman ? '<p>This was a one life campaign. It has ended for good.</p>' : `${backup ? '<button data-action="reloadfight" data-key="reloadfight">Reload from before the fight</button>' : ''}
    <h2>Saved games</h2>${slotsHTML(true)}`}
    <button data-action="title" data-key="title">Return to title screen</button>`;
}

function refusedHTML() {
  const price = fuelPrice(here()) * 3;
  return `<section id="sec-refused" aria-labelledby="h-refused"><h2 id="h-refused" tabindex="-1">Docking refused</h2>
    <p>${esc(dockingStatus(state, here()).reason)} You can't trade, refuel or take contracts here.</p>
    <p>A passing trader will sell you emergency fuel at ${price} credits per unit.</p>
    <button data-action="emergencyfuel" data-key="emergencyfuel">Buy 1 emergency fuel</button></section>`;
}

function travelHTML() {
  const path = coursePath();
  const next = path ? path[1] : null;
  let nextBtn = '';
  if (next != null) {
    nextBtn = `<p><button data-action="jump" data-arg="${next}" data-key="jumpnext">Next jump on course: ${esc(galaxy.systems[next].name)}</button></p>`;
  }
  const lanes = galaxy.adj[state.location].map(l => {
    const s = galaxy.systems[l.to];
    const c = navCost(l.ly);
    const visited = state.systems[l.to]?.visited ? ', visited' : '';
    const onCourse = l.to === next ? ', on your course' : '';
    const contract = state.missions.some(m => m.dest === l.to) ? ', contract destination' : '';
    const evs = eventsAt(l.to);
    const front = frontWarAt(l.to) ? ['war front'] : [];
    const tags = [...evs, ...front].length ? `, ${[...evs, ...front].join(', ')}` : '';
    return `<li><button data-action="jump" data-arg="${l.to}" data-key="jump-${l.to}">${esc(s.name)}: ${l.ly} light-years, ${c.fuel} fuel, ${plural(c.days, 'day')}. ${describeSystem(s)}${visited}${onCourse}${contract}${tags}</button></li>`;
  }).join('');
  return `<section id="sec-travel" aria-labelledby="h-travel"><h2 id="h-travel" tabindex="-1">Travel</h2>
    ${nextBtn}<h3>Jump lanes from here</h3><ul>${lanes}</ul></section>`;
}

function reputationHTML() {
  const items = factionKeys(state).map(k => {
    const v = getRep(state, k);
    return `<li>${factionName(k)}: ${tierName(v)}, ${Math.round(v)}</li>`;
  }).join('');
  const local = sysState(state, state.location).local;
  return `<section id="sec-rep" aria-labelledby="h-rep"><h2 id="h-rep" tabindex="-1">Reputation</h2>
    <ul>${items}
    <li>Local standing at ${esc(here().name)}: ${tierName(local)}, ${Math.round(local)}</li>
    <li>Notoriety: ${notorietyName(state.notoriety)}, ${Math.round(state.notoriety)}</li></ul></section>`;
}

function courseHTML() {
  const sorted = [...galaxy.systems].sort((a, b) => a.name.localeCompare(b.name));
  if (ui.plotSelect == null) ui.plotSelect = state.course != null ? String(state.course) : String(sorted[0].id);
  const opts = sorted.map(s => {
    const visited = state.systems[s.id]?.visited ? ', visited' : '';
    return `<option value="${s.id}"${String(s.id) === ui.plotSelect ? ' selected' : ''}>${esc(s.name)}, ${regionOf(s).name}${visited}</option>`;
  }).join('');
  const clear = state.course != null ? `<button data-action="clearcourse" data-key="clearcourse">Clear course</button>` : '';
  return `<section id="sec-course" aria-labelledby="h-course"><h2 id="h-course" tabindex="-1">Plot a course</h2>
    <p><label for="plot-select">Destination</label><br><select id="plot-select" data-change="plotselect" data-key="plotselect">${opts}</select></p>
    <button data-action="plot" data-key="plot">Plot course</button> ${clear}</section>`;
}

function knownPrices(goodId) {
  return Object.entries(state.systems)
    .filter(([id, x]) => x.notes && x.notes[goodId] && Number(id) !== state.location)
    .map(([id, x]) => ({ id: Number(id), n: x.notes[goodId] }));
}
function bestSellElsewhere(goodId, hops) {
  const list = knownPrices(goodId).filter(r => hops[r.id] < Infinity).sort((a, b) => b.n.sell - a.n.sell);
  return list[0] || null;
}

function priceNotesHTML() {
  const g = good(ui.priceGood);
  const hops = hopCounts(galaxy, state.location);
  const row = ({ id, n }) => {
    const age = state.day - n.day;
    const when = age === 0 ? 'today' : `${plural(age, 'day')} ago`;
    return `<li>${esc(galaxy.systems[id].name)}: buy ${n.buy}, sell ${n.sell}, ${when}, ${plural(hops[id], 'jump')} away.</li>`;
  };
  const known = knownPrices(g.id);
  const sells = [...known].sort((a, b) => b.n.sell - a.n.sell).slice(0, 6).map(row).join('');
  const buys = [...known].sort((a, b) => a.n.buy - b.n.buy).slice(0, 6).map(row).join('');
  const hereP = docked() && (!g.illegal || hasBlackMarket(here())) ? prices(state, here(), g) : null;
  const opts = GOODS.map(x => `<option value="${x.id}"${x.id === g.id ? ' selected' : ''}>${x.name}</option>`).join('');
  return `<section id="sec-notes" aria-labelledby="h-notes"><h2 id="h-notes" tabindex="-1">Price notes</h2>
    <p>Last known prices at other systems you have visited.</p>
    <p><label for="notes-select">Good</label><br><select id="notes-select" data-change="pricegood" data-key="pricegood">${opts}</select></p>
    ${hereP ? `<p>Here: buy ${hereP.buy}, sell ${hereP.sell}.</p>` : ''}
    ${known.length ? `<h3>Best places to sell</h3><ul>${sells}</ul><h3>Cheapest places to buy</h3><ul>${buys}</ul>` : '<p>No prices noted yet.</p>'}</section>`;
}

function logHTML() {
  const items = state.log.slice(0, 15).map(e => `<li>Day ${e.day}: ${esc(e.msg)}</li>`).join('');
  return `<section id="sec-log" aria-labelledby="h-log"><h2 id="h-log" tabindex="-1">Captain's log</h2><ul>${items}</ul></section>`;
}

function localSituation(sys) {
  const parts = eventsAt(sys.id);
  if (frontWarAt(sys.id)) parts.push('on a war front');
  return parts.length ? ` Here: ${parts.join(', ')}.` : '';
}

function rivalsHTML() {
  const hops = hopCounts(galaxy, state.location);
  const items = [...state.rivals].sort((x, y) => (y.alive ? 1 : 0) - (x.alive ? 1 : 0)).map(r => {
    if (!r.alive) return `<li><p>${esc(r.name)} of the ${esc(r.ship)}, ${styleLabel(r)}: gone since day ${r.goneDay}.${r.replaced ? '' : ' Word is someone new will fill the gap soon.'}</p></li>`;
    const where = !r.met ? 'You have never crossed paths.'
      : r.loc === state.location ? 'Here now.'
      : `Last seen at ${esc(galaxy.systems[r.seen.sys].name)}, ${state.day === r.seen.day ? 'today' : `${plural(state.day - r.seen.day, 'day')} ago`}, ${r.seen.sys === state.location ? 'here' : `${plural(hops[r.seen.sys], 'jump')} away`}.`;
    const hist = r.history.slice(0, 3).map(h => esc(h.note)).join(' ');
    const lvl = r.level >= 8 ? 'legendary' : r.level >= 6 ? 'formidable' : r.level >= 4 ? 'experienced' : 'up and coming';
    return `<li><p>${esc(r.name)} of the ${esc(r.ship)}, ${styleLabel(r)}, ${lvl}, flying a ${rivalShipKind(r)}. Sides with the ${rivalFaction(r)}. Toward you: ${attitudeName(r.attitude)}. ${where}${hist ? ` History: ${hist}` : ''}</p></li>`;
  }).join('');
  return `<section id="sec-rivals" aria-labelledby="h-rivals"><h2 id="h-rivals" tabindex="-1">Rival captains</h2>
    <p>Other captains travel the galaxy and grow stronger, just like you. They remember how you treat them. Allies may jump in to help you in a fight; nemeses hunt you.</p>
    <ul class="cards">${items}</ul></section>`;
}

function newsHTML() {
  const hops = hopCounts(galaxy, state.location);
  const away = id => (id === state.location ? 'here' : `${plural(hops[id], 'jump')} away`);
  const wars = state.world.wars.map(w => {
    const f = fronts(w);
    const fr = [...f[w.a], ...f[w.b]].sort((x, y) => hops[x] - hops[y]).slice(0, 4).map(id => `${esc(galaxy.systems[id].name)} (${away(id)})`).join(', ');
    return `<li>The ${factionName(w.a)} against the ${factionName(w.b)}: ${warStatus(w)}. ${plural(Math.max(0, w.end - state.day), 'day')} at most left. Nearest fronts: ${fr}.</li>`;
  }).join('');
  const evs = eventList().map(x => ({ ...x, d: x.sys != null ? hops[x.sys] : 0 })).sort((a, b) => a.d - b.d).map(x => {
    const where = x.sys != null ? `${esc(x.place)}, ${away(x.sys)}` : `the ${esc(x.place)}`;
    return `<li>${x.name} at ${where}: ${x.effect}. ${plural(Math.max(0, x.ev.end - state.day), 'day')} left.</li>`;
  }).join('');
  const recent = state.world.news.slice(0, 10).map(n => `<li>Day ${n.day}: ${esc(n.text)}</li>`).join('');
  return `<section id="sec-wars" aria-labelledby="h-wars"><h2 id="h-wars" tabindex="-1">Wars</h2>
    ${wars ? `<ul>${wars}</ul><p>Navy posts and pirate contacts of warring factions offer war contracts. Front-line systems pay more for weapons, metals, machinery, medicine and food.</p>` : '<p>The galaxy is at peace, for now.</p>'}</section>
    <section id="sec-events" aria-labelledby="h-events"><h2 id="h-events" tabindex="-1">Galaxy events</h2>
    ${evs ? `<ul>${evs}</ul>` : '<p>Nothing unusual is happening.</p>'}</section>
    <section id="sec-headlines" aria-labelledby="h-headlines"><h2 id="h-headlines" tabindex="-1">Recent news</h2>
    ${recent ? `<ul>${recent}</ul>` : '<p>No news yet.</p>'}</section>`;
}

function insuranceHTML() {
  const ins = state.insurance;
  const sold = offices(here()).includes('guild');
  const current = ins.plan !== 'none'
    ? `${INSURANCE[ins.plan].name}, covered until day ${ins.expires} (${plural(Math.max(0, ins.expires - state.day), 'day')} left).`
    : 'You are not insured. If your ship is destroyed, a battered Mule costs you ' + UNINSURED_COST + ' credits.';
  let plans = '';
  if (sold) {
    plans = Object.entries(INSURANCE).map(([id, pl]) => {
      const q = insuranceQuote(id);
      if (q.denied) return `<li>${pl.name}: ${esc(q.denied)}</li>`;
      const label = ins.plan === id ? 'Extend 30 days' : 'Buy 30 days';
      return `<li><p>${pl.name}: replaces your ship with ${pl.desc}. Deductible ${pl.deductible}. Premium ${q.premium} for 30 days.</p>
        <button data-action="insure" data-arg="${id}" data-key="insure-${id}" aria-label="${label} of ${pl.name.toLowerCase()}">${label}</button></li>`;
    }).join('');
    plans = `<ul class="cards">${plans}</ul><p>Premiums are based on your ship's value. Past claims, notoriety and trouble with the Concord raise them. Losses during piracy are never covered. Changing plans replaces your current one.</p>`;
  } else {
    plans = '<p>Insurance is sold at Merchant Guild offices, not here.</p>';
  }
  const debt = state.debt
    ? `<p>You owe the Merchant Guild ${state.debt} credits, growing half a percent a day. Half of every contract payment goes to it, and you cannot buy ships until it is paid.</p>
       ${sold ? `<button data-action="repaydebt" data-key="repaydebt">Repay ${Math.min(state.debt, state.credits)} credits</button>` : ''}` : '';
  return `<section id="sec-insurance" aria-labelledby="h-insurance"><h2 id="h-insurance" tabindex="-1">Insurance</h2>
    <p>${current}</p>${debt}${plans}</section>`;
}

function crewHTML() {
  const sh = state.ship, c = state.crew;
  const isDocked = docked();
  const need = sh.crewMax - sh.crew;
  const kind = portKind(here());
  const hireLean = { concord: 'lawful', independent: 'mixed', clan: 'outlaw' }[kind];
  let btns = '';
  if (c.owed) btns += `<button data-action="crew" data-arg="payowed" data-key="crew-payowed">Pay back wages, ${c.owed} credits</button>`;
  if (isDocked) {
    if (need) btns += `<button data-action="crew" data-arg="hire" data-key="crew-hire">Hire ${plural(need, 'crew member')}, ${need * CREW_PRICE} credits, leaning ${hireLean}</button>`;
    if (sh.crew) {
      btns += `<button data-action="crew" data-arg="bonus" data-key="crew-bonus">Pay a bonus, ${sh.crew * 25} credits</button>`;
      btns += `<button data-action="crew" data-arg="leave" data-key="crew-leave">Shore leave, ${sh.crew * 15} credits and 1 day</button>`;
    }
  }
  const officers = state.officers.map(o => `<li><p>${esc(o.name)}, ${ROLES[o.role].name}, skill ${o.level} (adds ${o.morale >= 25 ? o.level : Math.floor(o.level / 2)} to your ${SKILLS[ROLES[o.role].skill].name.toLowerCase()}). ${o.traits.map(t => TRAITS[t]).join('; ')}. Morale: ${moraleName(o.morale)}. Wage ${o.wage} a day.</p>
    <button data-action="dismiss" data-arg="${o.id}" data-key="dismiss-${o.id}" aria-label="${ui.confirmDismiss === o.id ? `Confirm dismissing ${esc(o.name)}` : `Dismiss ${esc(o.name)}`}">${ui.confirmDismiss === o.id ? 'Confirm dismiss' : 'Dismiss'}</button></li>`).join('');
  let hire = '';
  if (isDocked) {
    const list = officerBoard(sysState(state, state.location), here());
    hire = list.map(c => `<li><p>${esc(c.name)}, ${ROLES[c.role].name}, skill ${c.level}. ${c.traits.map(t => TRAITS[t]).join('; ')}. Wage ${c.wage} a day, signing bonus ${c.signing}.</p>
      <button data-action="hireofficer" data-arg="${c.id}" data-key="hireofficer-${c.id}" aria-label="Hire ${esc(c.name)}">Hire</button></li>`).join('');
    hire = `<h3>Officers looking for a berth</h3>${hire ? `<ul class="cards">${hire}</ul>` : '<p>Nobody here right now.</p>'}`;
  }
  const officerSec = `<section id="sec-officers" aria-labelledby="h-officers"><h2 id="h-officers" tabindex="-1">Officers</h2>
    <p>One officer per role, up to ${MAX_OFFICERS}. Officers add their skill to yours, and react to how you run the ship. An unhappy officer adds half as much, and one who's had enough quits at the next port.</p>
    ${officers ? `<ul class="cards">${officers}</ul>` : '<p>You have no officers.</p>'}${hire}</section>`;
  return `${officerSec}<section id="sec-crew" aria-labelledby="h-crew"><h2 id="h-crew" tabindex="-1">Crew</h2><ul>
    <li>Crew: ${sh.crew} of ${sh.crewMax}</li>
    <li>Loyalty: ${loyaltyName(c.loyalty)}, ${Math.round(c.loyalty)}</li>
    <li>Leaning: ${leanName(c.lean)}, ${c.lean}</li>
    <li>Experience: ${skillName(c.skill)}</li>
    <li>Wages: ${sh.crew * WAGE + officerWages()} credits per day, including officers${c.owed ? `, ${c.owed} owed` : ''}</li></ul>
    <p>Crew hired at Concord ports lean lawful and dislike piracy. Crew hired at pirate ports lean outlaw and dislike Concord work. Below 30 loyalty, crew desert in port; below 15, they may mutiny.</p>
    ${btns}</section>`;
}

function outfittingHTML() {
  const sys = here();
  const sh = state.ship;
  const kind = portKind(sys);
  const heavyOk = kind === 'clan' || (kind === 'concord' && sys.security === 'high');
  const installed = sh.weapons.map((id, i) => `<li><p>${WEAPONS[id].name}: ${weaponSummary(id)}.</p>
    <button data-action="sellweapon" data-arg="${i}" data-key="sellweapon-${i}">Sell for ${Math.round(WEAPON_PRICES[id] * 0.5)}</button></li>`).join('');
  const forSale = Object.keys(WEAPON_PRICES).filter(id => heavyOk || !HEAVY_WEAPONS.includes(id)).map(id => `<li><p>${WEAPONS[id].name}: ${weaponSummary(id)}. ${WEAPON_PRICES[id]} credits.</p>
    <button data-action="buyweapon" data-arg="${id}" data-key="buyweapon-${id}" aria-label="Buy ${WEAPONS[id].name}">Buy</button></li>`).join('');
  const ups = sh.upgrades.map(id => `<li><p>${UPGRADES[id].name}: ${UPGRADES[id].desc}.</p>
    <button data-action="removeupgrade" data-arg="${id}" data-key="removeupgrade-${id}">Remove and sell for ${Math.round(UPGRADES[id].price * 0.5)}</button></li>`).join('');
  const upSale = Object.entries(UPGRADES).filter(([id, u]) => !sh.upgrades.includes(id) && (!u.blackMarket || hasBlackMarket(sys)))
    .map(([id, u]) => `<li><p>${u.name}: ${u.desc}. ${u.price} credits.</p>
    <button data-action="upgrade" data-arg="${id}" data-key="upgrade-${id}" aria-label="Install ${u.name}">Install</button></li>`).join('');
  return `<section id="sec-outfit" aria-labelledby="h-outfit"><h2 id="h-outfit" tabindex="-1">Outfitting</h2>
    <p>Hardpoints ${sh.weapons.length} of ${sh.hardpoints} used. Upgrade slots ${sh.upgrades.length} of ${sh.slots} used.${heavyOk ? '' : ' Heavy weapons are sold only at high-security Concord ports and pirate ports.'}</p>
    <h3>Your weapons</h3>${installed ? `<ul class="cards">${installed}</ul>` : '<p>None.</p>'}
    <h3>Weapons for sale</h3><ul class="cards">${forSale}</ul>
    <h3>Your upgrades</h3>${ups ? `<ul class="cards">${ups}</ul>` : '<p>None.</p>'}
    <h3>Upgrades for sale</h3>${upSale ? `<ul class="cards">${upSale}</ul>` : '<p>None.</p>'}</section>`;
}

function dealerHTML() {
  const sys = here();
  const kind = portKind(sys);
  const value = tradeInValue(state.ship);
  const items = Object.entries(SHIP_CLASSES).filter(([id, c]) => c.sold.includes(kind) && id !== state.ship.classId).map(([id, c]) => {
    const cost = c.price - value;
    const ok = shipRequirementMet(c, sys);
    const costText = cost >= 0 ? `${cost} after trade-in` : `you receive ${-cost} after trade-in`;
    const loadout = c.loadout.map(w => WEAPONS[w].name.toLowerCase()).join(', ');
    const btn = ok
      ? `<button data-action="buyship" data-arg="${id}" data-key="buyship-${id}" aria-label="${ui.confirmBuyShip === id ? 'Confirm purchase' : `Buy ${c.name}`}">${ui.confirmBuyShip === id ? 'Confirm purchase' : 'Buy'}</button>`
      : `<p>${shipRequirementText(c, sys)}</p>`;
    return `<li><p>${c.name}: ${classSummary(c)}. Comes with ${loadout}. Price ${c.price}, ${costText}.</p>${btn}</li>`;
  }).join('');
  return `<section id="sec-dealer" aria-labelledby="h-dealer"><h2 id="h-dealer" tabindex="-1">Ship dealer</h2>
    <p>Your ${state.ship.cls} is worth ${value} in trade, including weapons and upgrades. Damage lowers its value.</p>
    ${items ? `<ul class="cards">${items}</ul>` : '<p>No ships for sale here.</p>'}</section>`;
}

function mutinyHTML() {
  const { loyal, rebels } = mutinyNumbers();
  const cost = state.ship.crew * 150;
  const odds = oddsText(boardingOdds({ crew: loyal + 1, skill: (combatSkill() + 0.3) * (1 + sk('dueling') * 0.04) * (1 + 0.05 * weaponBonus(state) + 0.04 * armorBonus(state)) }, { crew: rebels, skill: state.crew.skill }, false));
  return `<h1 id="mutiny-heading" tabindex="-1">Mutiny</h1>
    <p>${rebels} of your crew have taken up arms. About ${loyal - 1} stand with you.</p>
    ${state.credits >= cost ? `<button data-action="mutiny" data-arg="pay" data-key="mutiny-pay">Pay them off, ${cost} credits</button>` : `<p>Paying them off would cost ${cost} credits, more than you have.</p>`}
    <button data-action="mutiny" data-arg="fight" data-key="mutiny-fight">Fight them, odds ${odds}. If you lose, you die.</button>
    <button data-action="mutiny" data-arg="yield" data-key="mutiny-yield">Give up command</button>`;
}

const VIEWS = [['bridge', 'Bridge'], ['contracts', 'Contracts'], ['market', 'Market'], ['shipyard', 'Shipyard'], ['captain', 'Captain'], ['crew', 'Crew'], ['holdings', 'Holdings'], ['cantina', 'Cantina'], ['rivals', 'Rivals'], ['news', 'News'], ['records', 'Records']];

function gameHTML() {
  if (state.mutiny) return mutinyHTML();
  if (state.event) return eventHTML();
  if (state.salvage) return salvageHTML();
  if (state.combat) return combatHTML();
  const sys = here();
  const isDocked = docked();
  const nav = VIEWS.map(([id, label]) => `<li><button data-action="view" data-arg="${id}" data-key="view-${id}"${ui.view === id ? ' aria-current="page"' : ''}>${label}</button></li>`).join('');
  let view;
  switch (ui.view) {
    case 'contracts': view = contractsHTML(); break;
    case 'market': view = isDocked ? `${marketHTML()}${priceNotesHTML()}` : `${refusedHTML()}${priceNotesHTML()}`; break;
    case 'shipyard': view = isDocked ? `${servicesHTML()}${insuranceHTML()}${outfittingHTML()}${dealerHTML()}` : refusedHTML(); break;
    case 'crew': view = crewHTML(); break;
    case 'captain': view = `${captainHTML()}${gearHTML()}`; break;
    case 'news': view = newsHTML(); break;
    case 'rivals': view = rivalsHTML(); break;
    case 'holdings': view = holdingsHTML(); break;
    case 'cantina': view = isDocked ? cantinaHTML() : refusedHTML(); break;
    case 'records': view = `${reputationHTML()}${logHTML()}
      <section id="sec-game" aria-labelledby="h-game"><h2 id="h-game" tabindex="-1">Game</h2>
      <p>Your campaign saves automatically.${state.ironman ? ' One life mode: there are no manual saves.' : ''}</p>
      <button data-action="help" data-key="help-records">How to play</button>
      <button data-action="title" data-key="title">Return to title screen</button></section>
      ${state.ironman ? '' : `<section id="sec-saves" aria-labelledby="h-saves"><h2 id="h-saves" tabindex="-1">Saved games</h2>${slotsHTML(false)}</section>`}`; break;
    default: view = `${isDocked ? '' : refusedHTML()}${statusHTML()}${travelHTML()}${courseHTML()}`;
  }
  return `<h1 id="sys-heading" tabindex="-1">${esc(sys.name)}</h1>
    <p>${describeSystem(sys)}. ${isDocked ? 'Docked' : 'In orbit, docking refused'}.${localSituation(sys)}</p>
    <p>Day ${state.day}. Credits ${state.credits}. Fuel ${state.fuel} of ${state.ship.tank}. Hold ${holdUsed()} of ${state.ship.cargo}. Hull ${state.ship.hull} of ${state.ship.hullMax}.</p>
    <nav aria-label="Ship"><ul class="nav">${nav}</ul></nav>
    <div id="view">${view}</div>`;
}

function render() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.key : null;
  const section = active && active.closest ? active.closest('section') : null;
  const sectionId = section ? section.id : null;
  if (ui.screen === 'game') { advanceWorld(); tickRivals(); tickHoldings(); save(); }
  app.innerHTML = ui.screen === 'title' ? titleHTML() : ui.screen === 'gameover' ? gameOverHTML() : ui.screen === 'help' ? helpHTML() : gameHTML();
  let target = null;
  if (ui.focus === 'view-first') { target = app.querySelector('#view h2'); ui.focus = null; }
  else if (ui.focus) { target = document.getElementById(ui.focus); ui.focus = null; }
  else if (key) target = app.querySelector(`[data-key="${key}"]`);
  if (!target && key && sectionId) {
    const sec = document.getElementById(sectionId);
    target = sec && sec.querySelector('h2');
  }
  if (target) target.focus();
}

// ---------- events ----------
app.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const arg = b.dataset.arg;
  switch (b.dataset.action) {
    case 'continue': continueGame(); break;
    case 'buy1': buy(arg, false); break;
    case 'buymax': buy(arg, true); break;
    case 'sell1': sell(arg, false); break;
    case 'sellall': sell(arg, true); break;
    case 'refuel': refuel(true); break;
    case 'fuel1': refuel(false); break;
    case 'emergencyfuel': refuel(false, true); break;
    case 'jump': jump(Number(arg)); break;
    case 'plot': plotTo(Number(ui.plotSelect)); break;
    case 'plotto': plotTo(Number(arg)); break;
    case 'clearcourse': state.course = null; save(); render(); announce('Course cleared.'); break;
    case 'accept': acceptMission(Number(arg)); break;
    case 'deliver': deliverProcurement(Number(arg)); break;
    case 'abandon': abandonMission(Number(arg)); break;
    case 'hunt': huntTarget(Number(arg)); break;
    case 'repairhull': repairHull(); break;
    case 'repairsys': repairSystems(); break;
    case 'hirecrew': crewAction('hire'); break;
    case 'crew': crewAction(arg); break;
    case 'view': if (ui.game && ui.game.over) ui.game = null; ui.view = arg; ui.confirmBuyShip = null; ui.confirmSlot = null; ui.focus = 'view-first'; render(); break;
    case 'buyweapon': buyWeapon(arg); break;
    case 'sellweapon': sellWeapon(Number(arg)); break;
    case 'upgrade': installUpgrade(arg); break;
    case 'removeupgrade': removeUpgrade(arg); break;
    case 'buyship': buyShip(arg); break;
    case 'mutiny': resolveMutiny(arg); break;
    case 'insure': buyInsurance(arg); break;
    case 'h-warehouse': holdingsAct(o => buyWarehouse(o)); break;
    case 'h-store': holdingsAct(o => storeGoods(arg, o)); break;
    case 'h-take': holdingsAct(o => retrieveGoods(arg, o)); break;
    case 'h-shares': { const [id, n] = arg.split(':'); holdingsAct(o => trade_shares(id, Number(n), o)); break; }
    case 'h-station': holdingsAct(o => buyStation(o)); break;
    case 'h-upgrade': holdingsAct(o => upgradeStation(arg, o)); break;
    case 'g-start': { const [k, v] = arg.split(':'); ui.game = null; startGame(k, v); break; }
    case 'g-leave': { const g = ui.game; if (g && !g.over) { if (g.game === 'pit') announce('You walk out of the pit and forfeit the fight.'); else { announce(`You leave the table and forfeit your ${g.bet} credit bet.`); } } ui.game = null; ui.focus = 'view-first'; render(); break; }
    case 'g-hit': gameAction('hit'); break;
    case 'g-stand': gameAction('stand'); break;
    case 'g-cheat': gameAction('cheat'); break;
    case 'g-roll': gameAction('roll'); break;
    case 'g-stop': gameAction('stop'); break;
    case 'g-strike': gameAction('strike'); break;
    case 'g-guard': gameAction('guard'); break;
    case 'g-feint': gameAction('feint'); break;
    case 'hireofficer': { const o = []; if (hireOfficer(sysState(state, state.location), Number(arg), o)) log(o[0]); save(); render(); announce(o.join(' ')); break; }
    case 'dismiss': {
      const id = Number(arg);
      if (ui.confirmDismiss !== id) { ui.confirmDismiss = id; render(); announce('Press Confirm dismiss to let this officer go.'); break; }
      ui.confirmDismiss = null;
      const o = []; dismissOfficer(id, o); save(); render(); announce(o.join(' ')); break;
    }
    case 'story-accept': storyAct(msgs => acceptArc(arg, msgs)); break;
    case 'story-decline': storyAct(msgs => declineArc(arg, msgs)); break;
    case 'story-choose': { const [id, opt] = arg.split(':'); storyAct(msgs => chooseOption(id, opt, msgs)); break; }
    case 'repaydebt': repayDebt(); break;
    case 'saveslot': saveToSlot(Number(arg)); break;
    case 'loadslot': loadSlot(Number(arg)); break;
    case 'missiles': buyMissiles(); break;
    case 'c-attack': attackMerchant(); break;
    case 'c-ignore': ignoreEncounter(); break;
    case 'c-move': state.combat.move = Number(arg); save(); render(); announce(`Maneuver: ${b.textContent.toLowerCase()}.`); break;
    case 'c-target': state.combat.target = arg; save(); render(); announce(`Target: ${arg}.`); break;
    case 'c-power': { const [x, d] = arg.split(':'); setPower(x, Number(d)); break; }
    case 'c-turn': combatAction('fire'); break;
    case 'c-demand': combatAction('demand'); break;
    case 'c-repair': combatAction('repair'); break;
    case 'sellcargo': sellAllCargo(); break;
    case 'ev-choose': eventChoice(arg); break;
    case 'ev-leave': leaveEvent(); break;
    case 'sv-deeper': salvageAction('deeper'); break;
    case 'sv-leave': salvageAction('leave'); break;
    case 'serviceall': serviceAll(); break;
    case 'distress': distressCall(); break;
    case 'help': ui.helpFrom = ui.screen; ui.screen = 'help'; ui.focus = 'help-heading'; render(); break;
    case 'helpback': ui.screen = ui.helpFrom || 'title'; ui.focus = ui.screen === 'title' ? 'title-heading' : 'view-first'; render(); break;
    case 'spendpoint': spendPoint(arg); break;
    case 'buygear': { const [sl, id] = arg.split(':'); buyGear(sl, id); break; }
    case 'buyarmory': buyArmory(); break;
    case 'train': trainSkill(arg); break;
    case 'c-board': combatAction('board'); break;
    case 'c-surrender': playerSurrender(); break;
    case 'c-loot': surrenderChoice('loot'); break;
    case 'c-prisoner': surrenderChoice('prisoner'); break;
    case 'c-release': surrenderChoice('release'); break;
    case 'c-destroy': surrenderChoice('destroy'); break;
    case 'c-leave': leaveCombat(); break;
    case 'reloadfight': {
      try {
        const raw = localStorage.getItem(PREFIGHT_KEY);
        if (raw) { localStorage.setItem(SAVE_KEY, raw); continueGame(); announce('Reloaded from before the fight.'); }
      } catch (err) { /* ignore */ }
      break;
    }
    case 'title': ui.screen = 'title'; ui.confirmNew = false; ui.focus = 'title-heading'; render(); break;
  }
});

app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.change === 'plotselect') ui.plotSelect = t.value;
  if (t.dataset.change === 'pricegood') { ui.priceGood = t.value; render(); }
});

app.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id !== 'new-form') return;
  if (loadSave() && !ui.confirmNew) {
    ui.confirmNew = true;
    const vals = { c: f.captain.value, s: f.ship.value, d: f.seed.value, i: f.ironman.checked };
    render();
    document.getElementById('f-captain').value = vals.c;
    document.getElementById('f-ship').value = vals.s;
    document.getElementById('f-seed').value = vals.d;
    document.getElementById('f-ironman').checked = vals.i;
    app.querySelector('[data-key="start"]').focus();
    return;
  }
  newGame(f.captain.value.trim(), f.ship.value.trim(), f.seed.value.trim(), f.ironman.checked);
});

render();
