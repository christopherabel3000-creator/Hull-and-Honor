import { generateGalaxy, GOODS, ECONOMIES, SECURITY_NAMES, jumpCost, shortestPath, hopCounts } from './galaxy.js';
import { sysState, refreshMarket, prices, nudge, recordNotes, tradeTag, fuelPrice } from './economy.js';

const SAVE_KEY = 'hullandhonor.save.v1';
const STARTER_SHIP = { cls: 'Mule-class light freighter', cargo: 20, tank: 12 };

const app = document.getElementById('app');
const live = document.getElementById('live');

let state = null;
let galaxy = null;
const ui = { screen: 'title', confirmNew: false, priceGood: 'food', plotSelect: null, focus: null };

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

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
const cargoUsed = () => Object.values(state.cargo).reduce((s, c) => s + c.qty, 0);
const regionOf = sys => galaxy.regions[sys.region];
function describeSystem(sys) {
  return `${regionOf(sys).name}, ${SECURITY_NAMES[sys.security]}, ${sys.authority}, ${ECONOMIES[sys.economy].name.toLowerCase()} economy`;
}
function coursePath() {
  if (state.course == null || state.course === state.location) return null;
  return shortestPath(galaxy, state.location, state.course);
}

// ---------- game actions ----------
function newGame(captain, ship, seedText) {
  const seed = seedText || String(Math.floor(Math.random() * 1e9));
  galaxy = generateGalaxy(seed);
  state = {
    version: 1, seed, day: 1, credits: 1500,
    captain: captain || 'Captain', shipName: ship || 'Wayfarer',
    ship: { ...STARTER_SHIP }, fuel: STARTER_SHIP.tank,
    location: galaxy.start, cargo: {}, systems: {}, course: null, log: [],
  };
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
  recordNotes(state, galaxy.systems[id]);
}

function buy(goodId, max) {
  const sys = here();
  const g = GOODS.find(x => x.id === goodId);
  let bought = 0, spent = 0;
  for (;;) {
    if (cargoUsed() >= state.ship.cargo) break;
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
    announce(cargoUsed() >= state.ship.cargo ? 'Your hold is full.' : 'Not enough credits.');
    return;
  }
  recordNotes(state, sys);
  log(`Bought ${bought} ${g.name} for ${spent} credits at ${sys.name}.`);
  save();
  render();
  announce(`Bought ${bought} ${g.name} for ${spent}. Credits ${state.credits}. Hold ${cargoUsed()} of ${state.ship.cargo}.`);
}

function sell(goodId, all) {
  const sys = here();
  const g = GOODS.find(x => x.id === goodId);
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

function refuel(full) {
  const price = fuelPrice(here());
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
  arrive(to);
  const sys = here();
  let msg = `Arrived at ${sys.name} after ${plural(cost.days, 'day')}. Fuel ${state.fuel} of ${state.ship.tank}.`;
  if (state.course === to) {
    state.course = null;
    msg += ' Destination reached.';
  }
  log(`Jumped from ${from.name} to ${sys.name}.`);
  save();
  ui.focus = 'sys-heading';
  render();
  announce(msg);
}

function plotCourse() {
  const dest = Number(ui.plotSelect);
  if (Number.isNaN(dest) || ui.plotSelect == null) { announce('Choose a destination first.'); return; }
  if (dest === state.location) { announce('You are already there.'); return; }
  state.course = dest;
  save();
  render();
  const path = coursePath();
  announce(`Course plotted to ${galaxy.systems[dest].name}: ${plural(path.length - 1, 'jump')}. Next jump: ${galaxy.systems[path[1]].name}.`);
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
    <li>Hold: ${cargoUsed()} of ${state.ship.cargo}</li>
    <li>Ship: the ${esc(state.shipName)}, ${state.ship.cls}</li>
    ${course}</ul></section>`;
}

function marketHTML() {
  const sys = here();
  const items = GOODS.map(g => {
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
  return `<section id="sec-market" aria-labelledby="h-market"><h2 id="h-market" tabindex="-1">Market</h2>
    <ul class="goods">${items}</ul></section>`;
}

function servicesHTML() {
  const price = fuelPrice(here());
  const need = state.ship.tank - state.fuel;
  return `<section id="sec-services" aria-labelledby="h-services"><h2 id="h-services" tabindex="-1">Fuel</h2>
    <p>Fuel costs ${price} credits per unit here.</p>
    <button data-action="refuel" data-key="refuel">Refuel to full${need ? `, ${need * price} credits` : ''}</button>
    <button data-action="fuel1" data-key="fuel1">Buy 1 fuel</button></section>`;
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
    return `<li><button data-action="jump" data-arg="${l.to}" data-key="jump-${l.to}">${esc(s.name)}: ${l.ly} light-years, ${c.fuel} fuel, ${plural(c.days, 'day')}. ${describeSystem(s)}${visited}${onCourse}</button></li>`;
  }).join('');
  return `<section id="sec-travel" aria-labelledby="h-travel"><h2 id="h-travel" tabindex="-1">Travel</h2>
    ${nextBtn}<h3>Jump lanes from here</h3><ul>${lanes}</ul></section>`;
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
  const g = GOODS.find(x => x.id === ui.priceGood);
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
    <ul>${rows}</ul></section>`;
}

function logHTML() {
  const items = state.log.slice(0, 15).map(e => `<li>Day ${e.day}: ${esc(e.msg)}</li>`).join('');
  return `<section id="sec-log" aria-labelledby="h-log"><h2 id="h-log" tabindex="-1">Captain's log</h2><ul>${items}</ul></section>`;
}

function gameHTML() {
  const sys = here();
  return `<h1 id="sys-heading" tabindex="-1">${esc(sys.name)}</h1>
    <p>${describeSystem(sys)}.</p>
    ${statusHTML()}${travelHTML()}${marketHTML()}${servicesHTML()}${courseHTML()}${priceNotesHTML()}${logHTML()}
    <section id="sec-game" aria-labelledby="h-game"><h2 id="h-game" tabindex="-1">Game</h2>
      <p>Your campaign saves automatically.</p>
      <button data-action="title" data-key="title">Return to title screen</button></section>`;
}

function render() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.key : null;
  const section = active && active.closest ? active.closest('section') : null;
  const sectionId = section ? section.id : null;
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
    case 'jump': jump(Number(arg)); break;
    case 'plot': plotCourse(); break;
    case 'clearcourse': state.course = null; save(); render(); announce('Course cleared.'); break;
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
