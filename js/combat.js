// Turn-based ship combat: range bands, reactor power, targeted systems, boarding.

export const RANGES = ['close', 'medium', 'long', 'extreme'];
export const SYSTEMS = ['shields', 'weapons', 'engines'];
export const SYSTEM_STATE = ['disabled', 'badly damaged', 'damaged', 'operational'];
export const MAX_POWER_PER_SYSTEM = 4;

export const WEAPONS = {
  llaser: { name: 'Light laser', acc: [0.85, 0.65, 0.3, 0], dmg: 8, power: 1 },
  hlaser: { name: 'Heavy laser', acc: [0.9, 0.7, 0.35, 0], dmg: 14, power: 2 },
  lcannon: { name: 'Light cannon', acc: [0.6, 0.75, 0.5, 0.15], dmg: 9, power: 1 },
  hcannon: { name: 'Heavy cannon', acc: [0.6, 0.8, 0.55, 0.2], dmg: 15, power: 2 },
  missile: { name: 'Missile rack', acc: [0.5, 0.8, 0.85, 0.55], dmg: 16, power: 1, ammo: true },
};

export const ENEMIES = {
  cutter: { name: 'pirate cutter', side: 'pirate', hull: 40, shield: 12, reactor: 5, agility: 1.2, weapons: ['llaser', 'lcannon'], missiles: 0, crew: 5, skill: 1, bounty: 120 },
  raider: { name: 'pirate raider', side: 'pirate', hull: 65, shield: 18, reactor: 6, agility: 1.0, weapons: ['llaser', 'lcannon', 'missile'], missiles: 3, crew: 7, skill: 1, bounty: 220 },
  marauder: { name: 'pirate marauder', side: 'pirate', hull: 95, shield: 26, reactor: 8, agility: 0.9, weapons: ['hlaser', 'lcannon', 'missile'], missiles: 5, crew: 10, skill: 1.1, bounty: 380 },
  flagship: { name: 'pirate flagship', side: 'pirate', hull: 125, shield: 32, reactor: 9, agility: 1.0, weapons: ['hlaser', 'hcannon', 'missile'], missiles: 6, crew: 13, skill: 1.2, bounty: 600 },
  hauler: { name: 'Guild hauler', side: 'merchant', hull: 70, shield: 14, reactor: 5, agility: 0.55, weapons: ['lcannon'], missiles: 0, crew: 5, skill: 0.9 },
  convoy: { name: 'armed Guild convoy ship', side: 'merchant', hull: 100, shield: 22, reactor: 7, agility: 0.6, weapons: ['lcannon', 'lcannon', 'missile'], missiles: 3, crew: 9, skill: 1 },
  patrol: { name: 'Concord patrol cutter', side: 'concord', hull: 90, shield: 28, reactor: 8, agility: 1.1, weapons: ['llaser', 'lcannon', 'missile'], missiles: 5, crew: 10, skill: 1.1 },
};

export function makeEnemy(kind, faction, cargo = []) {
  const t = ENEMIES[kind];
  const e = {
    kind, faction, side: t.side, name: t.name,
    hull: t.hull, hullMax: t.hull, shield: t.shield, shieldMax: t.shield,
    reactor: t.reactor, agility: t.agility, weapons: [...t.weapons], missiles: t.missiles,
    crew: t.crew, crewMax: t.crew, skill: t.skill,
    sys: { shields: 3, weapons: 3, engines: 3 }, power: { shields: 2, weapons: 2, engines: 1 },
    cargo, fleeing: false,
  };
  return e;
}

export function effPower(c, s) {
  if (c.sys[s] <= 0) return 0;
  return Math.round(c.power[s] * c.sys[s] / 3);
}

export function usedPower(c) {
  return SYSTEMS.reduce((sum, s) => sum + c.power[s], 0);
}

export function hitChance(attacker, target, weaponId, range, aim) {
  const w = WEAPONS[weaponId];
  const base = w.acc[range];
  if (base <= 0) return 0;
  let acc = base - 0.04 * effPower(target, 'engines') * target.agility + (attacker.accBonus || 0);
  if (aim !== 'hull') acc -= 0.1;
  return Math.max(0.05, Math.min(0.95, acc));
}

// Which weapons fire this turn, given weapon power.
function firingWeapons(c) {
  let budget = effPower(c, 'weapons');
  const list = [];
  for (const id of c.weapons) {
    const w = WEAPONS[id];
    if (w.ammo && c.missiles <= 0) continue;
    if (w.power > budget) continue;
    budget -= w.power;
    list.push(id);
  }
  return list;
}

function strengthAt(c, range) {
  return c.weapons.reduce((s, id) => s + WEAPONS[id].acc[range] * WEAPONS[id].dmg, 0);
}

export function preferredRange(c) {
  let best = 1, bestV = -1;
  for (let r = 0; r < 4; r++) {
    const v = strengthAt(c, r);
    if (v > bestV) { bestV = v; best = r; }
  }
  return best;
}

function enemyOrders(e, p, range, playerMove) {
  const hullPct = e.hull / e.hullMax;
  if (e.side === 'merchant' || (hullPct < 0.3 && e.side !== 'concord') || (e.side === 'concord' && hullPct < 0.25)) e.fleeing = true;
  let move = 0;
  if (e.fleeing) move = 1;
  else {
    const pref = preferredRange(e);
    move = range > pref ? -1 : range < pref ? 1 : 0;
  }
  // Power: shields when they are low, then weapons, then engines.
  let left = e.reactor;
  const power = { shields: 0, weapons: 0, engines: 0 };
  const weaponNeed = e.weapons.reduce((s, id) => s + WEAPONS[id].power, 0);
  if (e.fleeing) {
    power.engines = Math.min(e.side === 'merchant' ? 3 : MAX_POWER_PER_SYSTEM, left); left -= power.engines;
    power.shields = Math.min(e.side === 'merchant' ? 2 : MAX_POWER_PER_SYSTEM, left); left -= power.shields;
    power.weapons = Math.min(MAX_POWER_PER_SYSTEM, left);
  } else if (playerMove === 1 && range >= 2) {
    // Chase a fleeing target.
    power.engines = Math.min(3, left - 2); left -= power.engines;
    power.weapons = Math.min(MAX_POWER_PER_SYSTEM, weaponNeed, left); left -= power.weapons;
    power.shields = Math.min(MAX_POWER_PER_SYSTEM, left);
    move = -1;
  } else {
    power.shields = Math.min(e.shield < e.shieldMax / 2 ? 3 : 2, left); left -= power.shields;
    power.weapons = Math.min(MAX_POWER_PER_SYSTEM, weaponNeed, left); left -= power.weapons;
    power.engines = Math.min(MAX_POWER_PER_SYSTEM, left); left -= power.engines;
    power.shields = Math.min(MAX_POWER_PER_SYSTEM, power.shields + left);
  }
  e.power = power;
  let aim = 'hull';
  if (e.side === 'pirate' && e.kind !== 'flagship' && p.sys.engines > 0) aim = 'engines';
  if (e.side === 'concord' && p.sys.weapons > 0) aim = 'weapons';
  if (e.side === 'merchant' && p.sys.weapons > 0) aim = 'weapons';
  return { move, aim };
}

function applyHit(target, dmg, aim, rng, events, who) {
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
  }
  if (dmg <= 0) return;
  let sysHit = null;
  if (aim !== 'hull') {
    sysHit = aim;
    target.hull -= Math.ceil(dmg / 2);
  } else {
    target.hull -= dmg;
    if (rng() < 0.15) sysHit = SYSTEMS[Math.floor(rng() * 3)];
  }
  if (sysHit && target.sys[sysHit] > 0) {
    target.sys[sysHit]--;
    events.push(`${who} ${sysHit} ${SYSTEM_STATE[target.sys[sysHit]]}.`);
  }
  target.hull = Math.max(0, target.hull);
}

function fire(att, target, range, aim, rng) {
  const shots = [];
  for (const id of firingWeapons(att)) {
    const w = WEAPONS[id];
    if (w.ammo) att.missiles--;
    const ch = hitChance(att, target, id, range, aim);
    if (ch > 0 && rng() < ch) shots.push({ id, dmg: Math.round(w.dmg * (0.75 + rng() * 0.5)) });
    else shots.push({ id, dmg: 0 });
  }
  return shots;
}

function describeShots(shots, mine) {
  if (!shots.length) return mine ? 'Your weapons are silent.' : 'They hold their fire.';
  const parts = shots.map(s => `${WEAPONS[s.id].name.toLowerCase()} ${s.dmg ? `hit for ${s.dmg}` : 'missed'}`);
  return (mine ? 'You fire: ' : 'They fire: ') + parts.join(', ') + '.';
}

function moveScore(c, rng) {
  const e = effPower(c, 'engines');
  return e === 0 ? 0 : e * c.agility + rng() * 2;
}

// Returns 'player' or 'enemy' if someone escaped.
function resolveMovement(cb, p, pMove, eMove, rng, lines) {
  const e = cb.enemy;
  if (effPower(p, 'engines') === 0) pMove = 0;
  if (effPower(e, 'engines') === 0) eMove = 0;
  const sp = moveScore(p, rng), se = moveScore(e, rng);
  let winnerMove = 0, mover = null;
  if (pMove === eMove) { winnerMove = pMove; mover = pMove ? 'both' : null; }
  else if (pMove === 0) { if (se > sp * 0.6) { winnerMove = eMove; mover = 'enemy'; } }
  else if (eMove === 0) { if (sp > se * 0.6) { winnerMove = pMove; mover = 'player'; } }
  else if (sp >= se) { winnerMove = pMove; mover = 'player'; } else { winnerMove = eMove; mover = 'enemy'; }

  if (cb.range === 3 && winnerMove === 1 && mover) {
    if (mover === 'both') return 'both';
    return mover;
  }
  const before = cb.range;
  cb.range = Math.max(0, Math.min(3, cb.range + winnerMove));
  if (cb.range !== before) {
    const who = mover === 'player' ? 'You' : mover === 'enemy' ? 'They' : 'Both ships';
    lines.push(`${who} ${cb.range < before ? 'close in' : 'pull away'}. Range ${RANGES[cb.range]}.`);
  } else if (pMove !== 0 && mover !== 'player' && mover !== 'both') {
    lines.push(`They match your maneuver. Range stays ${RANGES[cb.range]}.`);
  }
  return null;
}

export function regenShields(c) {
  c.shield = Math.min(c.shieldMax, c.shield + effPower(c, 'shields') * 3);
}

export function boardingOdds(att, def, defenderSurrendered) {
  const a = att.crew * att.skill;
  const d = def.crew * def.skill * (defenderSurrendered ? 0.3 : 1.15);
  return a / Math.max(0.1, d);
}

export function oddsText(r) {
  return r > 1.4 ? 'strongly in your favor' : r > 1.1 ? 'in your favor' : r > 0.9 ? 'about even' : r > 0.7 ? 'against you' : 'strongly against you';
}

// Boarding fight. Returns true if the attacker wins.
export function boardingFight(att, def, rng) {
  const a0 = att.crew, d0 = def.crew;
  for (let i = 0; i < 20; i++) {
    const a = att.crew * att.skill * (0.7 + rng() * 0.6);
    const d = def.crew * def.skill * 1.15 * (0.7 + rng() * 0.6);
    if (a >= d) def.crew = Math.max(0, def.crew - Math.max(1, Math.round(a * 0.2)));
    else att.crew = Math.max(0, att.crew - Math.max(1, Math.round(d * 0.2)));
    if (def.crew <= d0 * 0.4) return true;
    if (att.crew <= a0 * 0.4) return false;
  }
  return att.crew / a0 >= def.crew / d0;
}

function surrenderCheck(e, rng) {
  const hp = e.hull / e.hullMax;
  if (e.side === 'concord') return false;
  if (e.side === 'merchant') return (hp < 0.5 || e.sys.engines === 0) && rng() < 0.6;
  const th = e.kind === 'flagship' ? 0.2 : 0.3;
  return (hp < th || (e.sys.engines === 0 && hp < 0.5)) && rng() < (e.kind === 'flagship' ? 0.3 : 0.45);
}

export function demandSurrenderChance(e) {
  if (e.side === 'concord') return 0;
  let c = (1 - e.hull / e.hullMax) * 0.7;
  if (e.sys.engines === 0) c += 0.25;
  if (e.sys.weapons === 0) c += 0.2;
  if (e.side === 'merchant') c += 0.25;
  if (e.kind === 'flagship') c -= 0.2;
  return Math.max(0, Math.min(0.9, c));
}

// One combat turn. action: 'fire' | 'demand' | 'board'.
// Returns { lines, outcome } where outcome is null while the fight continues.
export function resolveTurn(cb, p, action, rng = Math.random) {
  const e = cb.enemy;
  const lines = [];
  cb.turn++;
  const eo = enemyOrders(e, p, cb.range, action === 'board' ? 0 : cb.move);

  if (action === 'board') {
    const won = boardingFight(p, e, rng);
    return won
      ? { lines: [`Your crew storms their ship and takes it. You have ${p.crew} crew left.`], outcome: 'captured' }
      : { lines: ['Your boarding party is overwhelmed and their crew pours onto your ship.'], outcome: 'player-killed' };
  }

  const escaped = resolveMovement(cb, p, action === 'fire' || action === 'demand' ? cb.move : 0, eo.move, rng, lines);
  if (escaped === 'both') return { lines: [...lines, 'Both ships break away.'], outcome: 'separated' };
  if (escaped === 'player') return { lines: [...lines, 'You break away and escape.'], outcome: 'player-escaped' };
  if (escaped === 'enemy') return { lines: [...lines, 'They break away and escape.'], outcome: 'enemy-escaped' };

  let pShots = [];
  if (action === 'demand') {
    if (rng() < demandSurrenderChance(e)) return { lines: [...lines, 'They answer your demand and surrender.'], outcome: 'enemy-surrendered' };
    lines.push('They refuse to surrender.');
  } else {
    pShots = fire(p, e, cb.range, cb.target, rng);
  }
  const eShots = fire(e, p, cb.range, eo.aim, rng);
  const events = [];
  for (const s of pShots) if (s.dmg) applyHit(e, s.dmg, cb.target, rng, events, 'Their');
  for (const s of eShots) if (s.dmg) applyHit(p, s.dmg, eo.aim, rng, events, 'Your');
  if (action !== 'demand') lines.push(describeShots(pShots, true));
  lines.push(describeShots(eShots, false));
  lines.push(...events);

  if (p.hull <= 0) return { lines: [...lines, 'Your ship breaks apart.'], outcome: 'player-destroyed' };
  if (e.hull <= 0) return { lines: [...lines, 'Their ship explodes.'], outcome: 'enemy-destroyed' };

  // Pirates board a crippled ship at close range.
  if (e.side === 'pirate' && cb.range === 0 && effPower(p, 'engines') === 0 && e.crew >= p.crew && e.hull > e.hullMax * 0.4) {
    lines.push('They lock on and board you!');
    const enemyWon = boardingFight(e, p, rng);
    if (!enemyWon) return { lines: [...lines, `Your crew drives them back and takes their ship. You have ${p.crew} crew left.`], outcome: 'captured' };
    return { lines: [...lines, 'Your crew is overwhelmed.'], outcome: 'player-killed' };
  }
  if (surrenderCheck(e, rng)) return { lines: [...lines, 'They signal their surrender.'], outcome: 'enemy-surrendered' };
  if (e.fleeing && eo.move === 1) lines.push('They are trying to flee.');

  regenShields(p);
  regenShields(e);
  lines.push(`Your hull ${p.hull}, shields ${p.shield}. Their hull ${e.hull}, shields ${e.shield}.`);
  return { lines, outcome: null };
}
