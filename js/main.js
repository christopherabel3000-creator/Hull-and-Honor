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
  ensureStory(st);
}
function newStarterShip(crew = 6) {
  const ship = buildShip('mule');
  ship.crew = Math.min(crew, ship.crewMax);
  return ship;
}

const app = document.getElementById('app');
const isStory = m => m.type === 'story';
const isStoryFight = m => isStory(m) && !!m.enemy;
const contractCount = () => state.missions.filter(m => !isStory(m)).length;
const live = document.getElementById('live');

let state = null;
let galaxy = null;
initStory({ state: () => state, galaxy: () => galaxy, receive: (n, msgs) => receive(n, msgs), charge: (n, msgs) => charge(n, msgs), log: m => log(m) });
const ui = { confirmSlot: null, view: 'bridge', confirmBuyShip: null, screen: 'title', confirmNew: false, confirmAbandon: null, confirmSurrender: false, priceGood: 'food', plotSelect: null, focus: null };

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
  }
  return s.board.missions;
}

// ---------- contracts ----------
function completeMission(m, msgs) {
  state.missions = state.missions.filter(x => x !== m);
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
  if (m.type === 'smuggle') conduct('smuggle', msgs);
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
    if (isStory(m)) { if (!m.enemy && !m.deliverOnly) storyMissionDone(m, msgs); continue; }
    if (m.type !== 'procure' && !COMBAT_TYPES.includes(m.type)) completeMission(m, msgs);
  }
}

function customsScan(sys, msgs) {
  if (sys.authority !== 'Concord' || !carryingContraband()) return;
  const chance = (sys.security === 'high' ? 0.45 : 0.25) * (state.ship.hidden ? 0.5 : 1);
  if (Math.random() >= chance) {
    msgs.push('Customs waved you through.');
    return;
  }
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
  msgs.push(`Customs scan! Your contraband was found and seized. Fined ${fine} credits.`);
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
  };
  try { localStorage.removeItem(PREFIGHT_KEY); } catch (e) { /* ignore */ }
  ensureRep(state, galaxy);
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
  refreshMarket(state, state.location);
  ui.screen = state.dead ? 'gameover' : 'game';
  ui.focus = state.dead ? 'over-heading' : state.combat ? 'combat-heading' : 'sys-heading';
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
  recordNotes(state, sys);
  log(`Sold ${sold} ${g.name} for ${earned} credits at ${sys.name} (${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}).`);
  save();
  render();
  announce(`Sold ${sold} ${g.name} for ${earned}, ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}. Credits ${state.credits}.`);
}

function refuel(full, emergency) {
  const price = fuelPrice(here()) * (emergency ? 3 : 1);
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
  const cost = jumpCost(lane.ly, state.ship.tank);
  if (state.fuel < cost.fuel) {
    announce(`Not enough fuel. That jump needs ${cost.fuel}, you have ${state.fuel}.`);
    return;
  }
  const from = here();
  state.fuel -= cost.fuel;
  state.day += cost.days;
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
  const enc = missionEncounter(sys) || randomEncounter(sys);
  if (enc && enc.message) msgs.push(enc.message);
  else if (enc) { startCombat(enc, true, msgs); return; }
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
  if (!msgs.length) msgs.push(`You are at ${sys.name}.`);
  save();
  ui.view = 'bridge';
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
  log(`Accepted: ${missionTitle(m, galaxy)} (${m.pay} credits, due day ${m.deadline}).`);
  save();
  render();
  announce(`Accepted: ${missionTitle(m, galaxy)}. Due day ${m.deadline}.`);
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
  if (isStory(m)) storyMissionDone(m, msgs);
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
    announce(isStory(m) ? 'Abandoning this objective ends the story for good. Press Confirm abandon to continue.' : `Abandoning costs standing with the ${factionName(m.faction)}. Press Confirm abandon to continue.`);
    return;
  }
  ui.confirmAbandon = null;
  const msgs = [];
  if (isStory(m)) failArc(m.arc, msgs, 'You abandoned it.');
  else failMission(m, msgs, 'abandoned');
  save();
  render();
  announce(msgs.join(' '));
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
  const before = loyaltyName(c.loyalty);
  c.loyalty = clampN(Math.round((c.loyalty + delta) * 10) / 10, 0, 100);
  const after = loyaltyName(c.loyalty);
  if (before !== after && msgs) msgs.push(`Your crew is now ${after}.`);
}

// How the crew feels about what you do, depending on how they lean.
function conduct(kind, msgs) {
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
  const due = days * state.ship.crew * WAGE;
  if (!due) return;
  if (state.credits >= due) {
    state.credits -= due;
    if (state.crew.loyalty < 60) morale(1, msgs);
  } else {
    state.crew.owed += due - state.credits;
    state.credits = 0;
    msgs.push(`You could not pay your crew in full. You owe them ${state.crew.owed} credits.`);
    morale(-8, msgs);
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
    const att = { crew: loyal + 1, skill: combatSkill() + 0.3 };
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

function pirateKind(sec) {
  return pickW({ high: { cutter: 1 }, medium: { cutter: 6, raider: 4 }, low: { cutter: 3, raider: 5, marauder: 2 }, none: { cutter: 2, raider: 5, marauder: 3 } }[sec]);
}

function missionEncounter(sys) {
  const m = state.missions.find(x => (COMBAT_TYPES.includes(x.type) || isStoryFight(x)) && (x.dest === sys.id || (x.dest === -1 && Math.random() < 0.35)));
  if (!m) return null;
  return missionCombat(m);
}

function missionCombat(m) {
  if (isStory(m)) {
    const cargo = m.enemy === 'convoy' ? randomCargo(true, 10, 18) : randomCargo(false, 3, 10);
    const enemy = makeEnemy(m.enemy, m.enemyFaction, cargo);
    enemy.name = m.enemyName;
    if (m.captain) enemy.captain = m.captain;
    return { enemy, range: m.approach ? 1 : 2, approach: m.approach, missionId: m.id, intro: m.approach ? `Your target is here: the ${enemy.name}.` : `The ${enemy.name} moves to engage you.` };
  }
  const sys = galaxy.systems[m.dest];
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

function randomEncounter(sys) {
  if (state.arcs.wanted && state.arcs.wanted.status === 'active' && rand() < 0.15) {
    const enemy = makeEnemy('hunter', 'concord', randomCargo(false, 0, 3));
    return { enemy, range: 2, intro: 'A bounty hunter drops out of a jump right on top of you. Your face is on their screen.' };
  }
  const escort = state.missions.some(m => m.type === 'escort');
  let chance = { high: 0.06, medium: 0.14, low: 0.24, none: 0.34 }[sys.security];
  if (escort) chance = Math.max(chance, 0.4);
  if (rand() >= chance) return null;
  let type = pickW({ high: { patrol: 5, merchant: 4, pirate: 1 }, medium: { pirate: 4.5, merchant: 3.5, patrol: 2 }, low: { pirate: 7, merchant: 3 }, none: { pirate: 8, merchant: 2 } }[sys.security]);
  if (escort && rand() < 0.75) type = 'pirate';
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
  state.ship.skill = combatSkill();
  state.combat = {
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
  const r = resolveTurn(cb, state.ship, action);
  cb.lines = r.lines;
  if (r.outcome) { endFight(r.outcome, r.lines); return; }
  save();
  render();
  announce(r.lines.join(' '));
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
    } else if (m.type === 'raid') {
      completeMission(m, msgs);
    } else if (isStory(m)) {
      storyMissionDone(m, msgs);
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
  if (outcome === 'player-killed') {
    die(`Captain ${state.captain} was killed in a boarding fight on day ${state.day}.`);
    return;
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
  cb.phase = 'result';
  cb.resultText = [...lines, ...msgs];
  save();
  ui.focus = 'combat-result';
  render();
  announce(cb.resultText.join(' '));
}

function surrenderChoice(choice) {
  const cb = state.combat;
  const msgs = [];
  if (choice === 'loot') { lootEnemy(msgs); msgs.push('You let their ship go.'); defeatEffects('looted', msgs); }
  if (choice === 'prisoner') { lootEnemy(msgs); defeatEffects('prisoner', msgs); }
  if (choice === 'release') { msgs.push('You let them go.'); defeatEffects('released', msgs); }
  if (choice === 'destroy') {
    msgs.push('You destroy the surrendered ship. Word of this will spread.');
    changeRep(state, cb.enemy.faction, -6, msgs);
    if (cb.enemy.side === 'merchant') changeRep(state, 'concord', -3, msgs);
    addNotoriety(state, 3);
    conduct('atrocity', msgs);
    defeatEffects('destroyed', msgs);
  }
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
  let risk = 1 + 0.25 * state.insurance.claims;
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
  if (state.combat || state.mutiny) { announce('You cannot save in the middle of this.'); return; }
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
const hullRepairPrice = sys => ({ high: 5, medium: 7, low: 9, none: 11 }[sys.security]);
const SYSTEM_REPAIR_PRICE = 40, CREW_PRICE = 50, MISSILE_PRICE = 30;

function repairHull() {
  const price = hullRepairPrice(here());
  const need = state.ship.hullMax - state.ship.hull;
  const n = Math.min(need, Math.floor(state.credits / price));
  if (need <= 0) { announce('Hull is undamaged.'); return; }
  if (n <= 0) { announce('Not enough credits.'); return; }
  state.ship.hull += n;
  state.credits -= n * price;
  save(); render();
  announce(`Repaired ${n} hull for ${n * price}. Hull ${state.ship.hull} of ${state.ship.hullMax}.`);
}
function repairSystems() {
  let spent = 0;
  for (const s of SYSTEMS) {
    while (state.ship.sys[s] < 3 && state.credits >= SYSTEM_REPAIR_PRICE) {
      state.ship.sys[s]++; state.credits -= SYSTEM_REPAIR_PRICE; spent += SYSTEM_REPAIR_PRICE;
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
      const c = jumpCost(lane.ly, state.ship.tank);
      ly += lane.ly; fuel += c.fuel; days += c.days;
    }
    course = `<li>Course to ${esc(galaxy.systems[state.course].name)}: ${plural(path.length - 1, 'jump')}, ${ly.toFixed(1)} light-years, ${fuel} fuel, about ${plural(days, 'day')}.</li>`;
  }
  return `<section id="sec-status" aria-labelledby="h-status"><h2 id="h-status" tabindex="-1">Status</h2><ul>
    <li>Day ${state.day}</li>
    <li>Credits: ${state.credits}</li>
    <li>Fuel: ${state.fuel} of ${state.ship.tank}</li>
    <li>Hold: ${holdUsed()} of ${state.ship.cargo}: ${holdContents()}</li>
    <li>Ship: the ${esc(state.shipName)}, ${state.ship.cls}</li>
    <li>Hull: ${state.ship.hull} of ${state.ship.hullMax}</li>
    <li>Systems: ${systemsText(state.ship)}</li>
    <li>Crew: ${state.ship.crew} of ${state.ship.crewMax}</li>
    <li>Insurance: ${state.insurance.plan === 'none' ? 'none' : `${INSURANCE[state.insurance.plan].name.toLowerCase()} until day ${state.insurance.expires}`}${state.debt ? `. Guild debt ${state.debt}` : ''}</li>
    ${course}</ul></section>`;
}

function systemsText(c) {
  if (SYSTEMS.every(x => c.sys[x] === 3)) return 'all operational';
  return SYSTEMS.map(x => `${x} ${SYSTEM_STATE[c.sys[x]]}`).join(', ');
}

function missionDetails(m, hops) {
  if (isStory(m)) {
    const where = m.dest === -1 ? 'anywhere' : m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away`;
    return `Story, ${ARCS[m.arc].title}: ${m.title} (${where}).`;
  }
  const dest = galaxy.systems[m.dest];
  const left = m.deadline - state.day;
  const due = left === 0 ? 'due today' : `due day ${m.deadline}, ${plural(left, 'day')} left`;
  const where = m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away, ${dest.authority}`;
  const space = missionSpace(m) ? `, takes ${missionSpace(m)} hold space` : '';
  const risk = m.type === 'smuggle' && dest.authority === 'Concord' ? ', customs risk at destination' : '';
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
    if (isStory(m) && m.deliverOnly && m.dest === state.location && isDocked) btns.push(`<button data-action="deliver" data-arg="${m.id}" data-key="deliver-${m.id}">Deliver ${m.units} ${good(m.goodId).name}</button>`);
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
  const items = GOODS.filter(g => !g.illegal || hasBlackMarket(sys)).map(g => {
    const p = prices(state, sys, g);
    const tag = tradeTag(sys, g);
    const c = state.cargo[g.id];
    const held = c ? `. In hold: ${c.qty}, paid ${Math.round(c.cost / c.qty)} each` : '';
    const sellBtns = c
      ? `<button data-action="sell1" data-arg="${g.id}" data-key="sell1-${g.id}" aria-label="Sell 1 ${g.name}">Sell 1</button>
         <button data-action="sellall" data-arg="${g.id}" data-key="sellall-${g.id}" aria-label="Sell all ${g.name}">Sell all</button>` : '';
    return `<li><p>${g.name}: buy ${p.buy}, sell ${p.sell}${tag ? `, ${tag}` : ''}${held}.</p>
      <button data-action="buy1" data-arg="${g.id}" data-key="buy1-${g.id}" aria-label="Buy 1 ${g.name}">Buy 1</button>
      <button data-action="buymax" data-arg="${g.id}" data-key="buymax-${g.id}" aria-label="Buy max ${g.name}">Buy max</button>
      ${sellBtns}</li>`;
  }).join('');
  const note = hasBlackMarket(sys) ? '' : '<p>Contraband cannot be traded in Concord ports.</p>';
  return `<section id="sec-market" aria-labelledby="h-market"><h2 id="h-market" tabindex="-1">Market</h2>
    ${note}<ul class="cards">${items}</ul></section>`;
}

function servicesHTML() {
  const sys = here();
  const sh = state.ship;
  const price = fuelPrice(sys);
  const need = sh.tank - state.fuel;
  const hullNeed = sh.hullMax - sh.hull;
  const sysNeed = SYSTEMS.reduce((n, x) => n + (3 - sh.sys[x]), 0);
  const misNeed = sh.missilesMax - sh.missiles;
  return `<section id="sec-services" aria-labelledby="h-services"><h2 id="h-services" tabindex="-1">Shipyard</h2>
    <p>Credits ${state.credits}. Fuel ${price} per unit, hull repair ${hullRepairPrice(sys)} per point, system repair ${SYSTEM_REPAIR_PRICE} per level.</p>
    <button data-action="refuel" data-key="refuel">Refuel to full${need ? `, ${need * price} credits` : ''}</button>
    <button data-action="fuel1" data-key="fuel1">Buy 1 fuel</button>
    ${hullNeed ? `<button data-action="repairhull" data-key="repairhull">Repair hull, ${hullNeed * hullRepairPrice(sys)} credits</button>` : ''}
    ${sysNeed ? `<button data-action="repairsys" data-key="repairsys">Repair systems, ${sysNeed * SYSTEM_REPAIR_PRICE} credits</button>` : ''}
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
      ${demand}
      ${boardOk ? `<button data-action="c-board" data-key="c-board">Board them, odds ${odds}. If you lose, you die.</button>` : '<p>Boarding needs close range and their engines disabled.</p>'}
      ${surrender}</section>`;
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
    const c = jumpCost(l.ly, state.ship.tank);
    const visited = state.systems[l.to]?.visited ? ', visited' : '';
    const onCourse = l.to === next ? ', on your course' : '';
    const contract = state.missions.some(m => m.dest === l.to) ? ', contract destination' : '';
    return `<li><button data-action="jump" data-arg="${l.to}" data-key="jump-${l.to}">${esc(s.name)}: ${l.ly} light-years, ${c.fuel} fuel, ${plural(c.days, 'day')}. ${describeSystem(s)}${visited}${onCourse}${contract}</button></li>`;
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

function priceNotesHTML() {
  const g = good(ui.priceGood);
  const hops = hopCounts(galaxy, state.location);
  const rows = Object.entries(state.systems)
    .filter(([, s]) => s.notes && s.notes[g.id])
    .map(([id, s]) => ({ id: Number(id), n: s.notes[g.id] }))
    .sort((a, b) => b.n.sell - a.n.sell)
    .slice(0, 15)
    .map(({ id, n }) => {
      const s = galaxy.systems[id];
      const age = state.day - n.day;
      const when = id === state.location ? 'here now' : age === 0 ? 'today' : `${plural(age, 'day')} ago`;
      const away = id === state.location ? '' : `, ${plural(hops[id], 'jump')} away`;
      return `<li>${esc(s.name)}: buy ${n.buy}, sell ${n.sell}, ${when}${away}.</li>`;
    }).join('');
  const opts = GOODS.map(x => `<option value="${x.id}"${x.id === g.id ? ' selected' : ''}>${x.name}</option>`).join('');
  return `<section id="sec-notes" aria-labelledby="h-notes"><h2 id="h-notes" tabindex="-1">Price notes</h2>
    <p>Last known prices at systems you have visited, best selling price first.</p>
    <p><label for="notes-select">Good</label><br><select id="notes-select" data-change="pricegood" data-key="pricegood">${opts}</select></p>
    ${rows ? `<ul>${rows}</ul>` : '<p>No prices noted yet.</p>'}</section>`;
}

function logHTML() {
  const items = state.log.slice(0, 15).map(e => `<li>Day ${e.day}: ${esc(e.msg)}</li>`).join('');
  return `<section id="sec-log" aria-labelledby="h-log"><h2 id="h-log" tabindex="-1">Captain's log</h2><ul>${items}</ul></section>`;
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
  return `<section id="sec-crew" aria-labelledby="h-crew"><h2 id="h-crew" tabindex="-1">Crew</h2><ul>
    <li>Crew: ${sh.crew} of ${sh.crewMax}</li>
    <li>Loyalty: ${loyaltyName(c.loyalty)}, ${Math.round(c.loyalty)}</li>
    <li>Leaning: ${leanName(c.lean)}, ${c.lean}</li>
    <li>Experience: ${skillName(c.skill)}</li>
    <li>Wages: ${sh.crew * WAGE} credits per day${c.owed ? `, ${c.owed} owed` : ''}</li></ul>
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
  const odds = oddsText(boardingOdds({ crew: loyal + 1, skill: combatSkill() + 0.3 }, { crew: rebels, skill: state.crew.skill }, false));
  return `<h1 id="mutiny-heading" tabindex="-1">Mutiny</h1>
    <p>${rebels} of your crew have taken up arms. About ${loyal - 1} stand with you.</p>
    ${state.credits >= cost ? `<button data-action="mutiny" data-arg="pay" data-key="mutiny-pay">Pay them off, ${cost} credits</button>` : `<p>Paying them off would cost ${cost} credits, more than you have.</p>`}
    <button data-action="mutiny" data-arg="fight" data-key="mutiny-fight">Fight them, odds ${odds}. If you lose, you die.</button>
    <button data-action="mutiny" data-arg="yield" data-key="mutiny-yield">Give up command</button>`;
}

const VIEWS = [['bridge', 'Bridge'], ['contracts', 'Contracts'], ['market', 'Market'], ['shipyard', 'Shipyard'], ['crew', 'Crew'], ['records', 'Records']];

function gameHTML() {
  if (state.mutiny) return mutinyHTML();
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
    case 'records': view = `${reputationHTML()}${logHTML()}
      <section id="sec-game" aria-labelledby="h-game"><h2 id="h-game" tabindex="-1">Game</h2>
      <p>Your campaign saves automatically.${state.ironman ? ' One life mode: there are no manual saves.' : ''}</p>
      <button data-action="title" data-key="title">Return to title screen</button></section>
      ${state.ironman ? '' : `<section id="sec-saves" aria-labelledby="h-saves"><h2 id="h-saves" tabindex="-1">Saved games</h2>${slotsHTML(false)}</section>`}`; break;
    default: view = `${isDocked ? '' : refusedHTML()}${statusHTML()}${travelHTML()}${courseHTML()}`;
  }
  return `<h1 id="sys-heading" tabindex="-1">${esc(sys.name)}</h1>
    <p>${describeSystem(sys)}. ${isDocked ? 'Docked' : 'In orbit, docking refused'}.</p>
    <p>Day ${state.day}. Credits ${state.credits}. Fuel ${state.fuel} of ${state.ship.tank}. Hold ${holdUsed()} of ${state.ship.cargo}. Hull ${state.ship.hull} of ${state.ship.hullMax}.</p>
    <nav aria-label="Ship"><ul class="nav">${nav}</ul></nav>
    <div id="view">${view}</div>`;
}

function render() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.key : null;
  const section = active && active.closest ? active.closest('section') : null;
  const sectionId = section ? section.id : null;
  if (ui.screen === 'game') save();
  app.innerHTML = ui.screen === 'title' ? titleHTML() : ui.screen === 'gameover' ? gameOverHTML() : gameHTML();
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
    case 'view': ui.view = arg; ui.confirmBuyShip = null; ui.confirmSlot = null; ui.focus = 'view-first'; render(); break;
    case 'buyweapon': buyWeapon(arg); break;
    case 'sellweapon': sellWeapon(Number(arg)); break;
    case 'upgrade': installUpgrade(arg); break;
    case 'removeupgrade': removeUpgrade(arg); break;
    case 'buyship': buyShip(arg); break;
    case 'mutiny': resolveMutiny(arg); break;
    case 'insure': buyInsurance(arg); break;
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
