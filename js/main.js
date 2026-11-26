import { generateGalaxy, GOODS, ECONOMIES, SECURITY_NAMES, jumpCost, shortestPath, hopCounts } from './galaxy.js';
import { sysState, refreshMarket, prices, nudge, recordNotes, tradeTag, fuelPrice, hasBlackMarket } from './economy.js';
import {
  ensureRep, factionKeys, getRep, changeRep, changeLocal, tierName, accessTier, factionName, TIER_REQUIREMENT,
  addNotoriety, notorietyName, dockingStatus, clanKey,
} from './reputation.js';
import {
  MAX_ACTIVE, BOARD_REFRESH_DAYS, offices, officeName, officeFaction, missionSpace, isContraband,
  generateBoard, canTake, missionTitle,
} from './missions.js';

const SAVE_KEY = 'hullandhonor.save.v1';
const STARTER_SHIP = { cls: 'Mule-class light freighter', cargo: 20, tank: 12 };

const app = document.getElementById('app');
const live = document.getElementById('live');

let state = null;
let galaxy = null;
const ui = { screen: 'title', confirmNew: false, confirmAbandon: null, priceGood: 'food', plotSelect: null, focus: null };

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
  }
  return s.board.missions;
}

// ---------- contracts ----------
function completeMission(m, msgs) {
  state.missions = state.missions.filter(x => x !== m);
  state.credits += m.pay;
  msgs.push(`Contract complete: ${missionTitle(m, galaxy)}. Paid ${m.pay} credits.`);
  if (m.type === 'smuggle') {
    changeRep(state, m.faction, 4 + m.tier, msgs);
    for (const k of factionKeys(state)) if (k.startsWith('clan:') && k !== m.faction) changeRep(state, k, 1, msgs);
    if (galaxy.systems[m.dest].authority !== 'Concord') changeLocal(state, galaxy, m.dest, 2, msgs);
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
    if (m.dest === state.location && m.type !== 'procure') completeMission(m, msgs);
  }
}

function customsScan(sys, msgs) {
  if (sys.authority !== 'Concord' || !carryingContraband()) return;
  const chance = sys.security === 'high' ? 0.45 : 0.25;
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
function newGame(captain, ship, seedText) {
  const seed = seedText || String(Math.floor(Math.random() * 1e9));
  galaxy = generateGalaxy(seed);
  state = {
    version: 2, seed, day: 1, credits: 1500,
    captain: captain || 'Captain', shipName: ship || 'Wayfarer',
    ship: { ...STARTER_SHIP }, fuel: STARTER_SHIP.tank,
    location: galaxy.start, cargo: {}, systems: {}, course: null, log: [],
  };
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
  refreshMarket(state, state.location);
  ui.screen = 'game';
  ui.focus = 'sys-heading';
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
  checkDeadlines(msgs);
  arrive(to);
  const sys = here();
  msgs.unshift(`Arrived at ${sys.name} after ${plural(cost.days, 'day')}. Fuel ${state.fuel} of ${state.ship.tank}.`);
  log(`Jumped from ${from.name} to ${sys.name}.`);
  const dock = dockingStatus(state, sys);
  if (!dock.ok) {
    msgs.push(dock.reason);
  } else {
    customsScan(sys, msgs);
    if (dockingStatus(state, sys).ok) {
      autoDeliver(msgs);
      recordNotes(state, sys);
    }
  }
  if (state.course === to) {
    state.course = null;
    msgs.push('Destination reached.');
  }
  save();
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
  if (state.missions.length >= MAX_ACTIVE) { announce(`You can hold at most ${MAX_ACTIVE} contracts at once.`); return; }
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
  completeMission(m, msgs);
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
    announce(`Abandoning costs standing with the ${factionName(m.faction)}. Press Confirm abandon to continue.`);
    return;
  }
  ui.confirmAbandon = null;
  const msgs = [];
  failMission(m, msgs, 'abandoned');
  save();
  render();
  announce(msgs.join(' '));
}

// ---------- rendering ----------
function titleHTML() {
  const saved = loadSave();
  let cont = '';
  if (saved) {
    const g = generateGalaxy(saved.seed);
    cont = `<section aria-labelledby="h-cont"><h2 id="h-cont" tabindex="-1">Continue</h2>
      <p>Captain ${esc(saved.captain)} of the ${esc(saved.shipName)}, day ${saved.day}, at ${esc(g.systems[saved.location].name)}, ${saved.credits} credits.</p>
      <button data-action="continue" data-key="continue">Continue campaign</button></section>`;
  }
  const warn = saved && ui.confirmNew
    ? `<p role="alert">Starting a new campaign will replace your saved one. Press Start again to confirm.</p>` : '';
  return `<h1 id="title-heading" tabindex="-1">Hull and Honor</h1>
    <p>Trade, smuggle, raid or hunt pirates across a lawless galaxy. Your reputation decides who welcomes you and who wants you dead.</p>
    ${cont}
    <section aria-labelledby="h-new"><h2 id="h-new">New campaign</h2>
      <form id="new-form">
        <p><label for="f-captain">Captain name</label><br><input id="f-captain" name="captain" autocomplete="off" maxlength="30"></p>
        <p><label for="f-ship">Ship name</label><br><input id="f-ship" name="ship" autocomplete="off" maxlength="30"></p>
        <p><label for="f-seed">Galaxy seed (optional)</label><br><input id="f-seed" name="seed" autocomplete="off" maxlength="30"></p>
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
    ${course}</ul></section>`;
}

function missionDetails(m, hops) {
  const dest = galaxy.systems[m.dest];
  const left = m.deadline - state.day;
  const due = left === 0 ? 'due today' : `due day ${m.deadline}, ${plural(left, 'day')} left`;
  const where = m.dest === state.location ? 'here' : `${plural(hops[m.dest], 'jump')} away, ${dest.authority}`;
  const space = missionSpace(m) ? `, takes ${missionSpace(m)} hold space` : '';
  const risk = m.type === 'smuggle' && dest.authority === 'Concord' ? ', customs risk at destination' : '';
  return `${missionTitle(m, galaxy)} (${where}). For the ${factionName(m.faction)}. Pays ${m.pay}, ${due}${space}${risk}.`;
}

function contractsHTML() {
  const sys = here();
  const hops = hopCounts(galaxy, state.location);
  const isDocked = docked();
  const active = state.missions.map(m => {
    const btns = [];
    if (m.dest !== state.location) btns.push(`<button data-action="plotto" data-arg="${m.dest}" data-key="plotto-${m.id}">Plot course to ${esc(galaxy.systems[m.dest].name)}</button>`);
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
    <h3>Your contracts, ${state.missions.length} of ${MAX_ACTIVE}</h3>
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
  const price = fuelPrice(here());
  const need = state.ship.tank - state.fuel;
  return `<section id="sec-services" aria-labelledby="h-services"><h2 id="h-services" tabindex="-1">Fuel</h2>
    <p>Fuel costs ${price} credits per unit here.</p>
    <button data-action="refuel" data-key="refuel">Refuel to full${need ? `, ${need * price} credits` : ''}</button>
    <button data-action="fuel1" data-key="fuel1">Buy 1 fuel</button></section>`;
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

function gameHTML() {
  const sys = here();
  const port = docked() ? `${contractsHTML()}${marketHTML()}${servicesHTML()}` : `${refusedHTML()}${contractsHTML()}`;
  return `<h1 id="sys-heading" tabindex="-1">${esc(sys.name)}</h1>
    <p>${describeSystem(sys)}.</p>
    ${statusHTML()}${travelHTML()}${port}${reputationHTML()}${courseHTML()}${priceNotesHTML()}${logHTML()}
    <section id="sec-game" aria-labelledby="h-game"><h2 id="h-game" tabindex="-1">Game</h2>
      <p>Your campaign saves automatically.</p>
      <button data-action="title" data-key="title">Return to title screen</button></section>`;
}

function render() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.key : null;
  const section = active && active.closest ? active.closest('section') : null;
  const sectionId = section ? section.id : null;
  if (ui.screen === 'game') save();
  app.innerHTML = ui.screen === 'title' ? titleHTML() : gameHTML();
  let target = null;
  if (ui.focus) { target = document.getElementById(ui.focus); ui.focus = null; }
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
    const vals = { c: f.captain.value, s: f.ship.value, d: f.seed.value };
    render();
    document.getElementById('f-captain').value = vals.c;
    document.getElementById('f-ship').value = vals.s;
    document.getElementById('f-seed').value = vals.d;
    app.querySelector('[data-key="start"]').focus();
    return;
  }
  newGame(f.captain.value.trim(), f.ship.value.trim(), f.seed.value.trim());
});

render();
