// Ship classes, weapons for sale, upgrades and derived ship stats.
import { WEAPONS } from './combat.js';

export const SHIP_CLASSES = {
  mule: { name: 'Mule-class light freighter', price: 6000, hull: 60, shield: 20, reactor: 6, agility: 1.0, cargo: 20, tank: 12, hardpoints: 2, slots: 3, crew: 6, sold: ['concord', 'independent'], loadout: ['llaser', 'lcannon'] },
  courier: { name: 'Swift-class courier', price: 8000, hull: 50, shield: 24, reactor: 7, agility: 1.5, cargo: 12, tank: 16, hardpoints: 2, slots: 3, crew: 5, sold: ['concord', 'independent'], loadout: ['llaser', 'lcannon'] },
  hauler: { name: 'Bulwark-class hauler', price: 13000, hull: 110, shield: 26, reactor: 7, agility: 0.7, cargo: 45, tank: 14, hardpoints: 2, slots: 4, crew: 8, sold: ['concord', 'independent'], loadout: ['lcannon', 'lcannon'] },
  gunship: { name: 'Talon-class gunship', price: 17000, hull: 95, shield: 32, reactor: 9, agility: 1.15, cargo: 16, tank: 12, hardpoints: 4, slots: 4, crew: 12, sold: ['concord', 'independent', 'clan'], loadout: ['llaser', 'lcannon', 'missile'] },
  corsair: { name: 'Corsair-class raider', price: 15000, hull: 85, shield: 26, reactor: 8, agility: 1.3, cargo: 28, tank: 14, hardpoints: 3, slots: 4, crew: 12, sold: ['clan'], req: { faction: 'clan', min: 10 }, loadout: ['llaser', 'lcannon', 'missile'] },
  freighter: { name: 'Atlas-class heavy freighter', price: 26000, hull: 130, shield: 30, reactor: 8, agility: 0.6, cargo: 80, tank: 16, hardpoints: 3, slots: 4, crew: 10, sold: ['concord'], req: { faction: 'guild', min: 30 }, loadout: ['lcannon', 'lcannon', 'missile'] },
  frigate: { name: 'Warden-class frigate', price: 33000, hull: 150, shield: 40, reactor: 11, agility: 1.0, cargo: 24, tank: 14, hardpoints: 5, slots: 5, crew: 16, sold: ['concord'], req: { faction: 'concord', min: 30 }, loadout: ['hlaser', 'lcannon', 'missile'] },
  reaver: { name: 'Reaver-class warship', price: 31000, hull: 135, shield: 34, reactor: 11, agility: 1.15, cargo: 30, tank: 14, hardpoints: 5, slots: 5, crew: 18, sold: ['clan'], req: { faction: 'clan', min: 30 }, loadout: ['hlaser', 'lcannon', 'missile'] },
};

export const WEAPON_PRICES = { llaser: 600, lcannon: 700, missile: 1200, hlaser: 2400, hcannon: 2800 };
export const HEAVY_WEAPONS = ['hlaser', 'hcannon'];
export const MISSILES_PER_RACK = 6;

export const UPGRADES = {
  armor: { name: 'Armor plating', price: 1500, desc: '25 more hull' },
  shieldboost: { name: 'Shield booster', price: 1800, desc: '12 more shields' },
  reactor: { name: 'Reactor overhaul', price: 3000, desc: '2 more reactor power' },
  thrusters: { name: 'Tuned thrusters', price: 2000, desc: '0.2 more agility' },
  targeting: { name: 'Targeting computer', price: 2600, desc: '8% better accuracy' },
  cargo: { name: 'Cargo expansion', price: 1200, desc: '10 more cargo space' },
  tanks: { name: 'Long-range tanks', price: 900, desc: '4 more fuel capacity' },
  quarters: { name: 'Extra crew quarters', price: 1000, desc: '4 more crew capacity' },
  hidden: { name: 'Hidden compartments', price: 2500, desc: 'customs is half as likely to find contraband', blackMarket: true },
};

export const portKind = sys => (sys.authority === 'Concord' ? 'concord' : sys.authority === 'Independent' ? 'independent' : 'clan');

export function weaponSummary(id) {
  const w = WEAPONS[id];
  const ranges = ['close', 'medium', 'long', 'extreme'];
  let best = 0;
  w.acc.forEach((a, i) => { if (a > w.acc[best]) best = i; });
  return `${w.dmg} damage, ${w.power} power, best at ${ranges[best]} range${w.ammo ? `, holds ${MISSILES_PER_RACK} missiles` : ''}`;
}

export function classSummary(c) {
  return `hull ${c.hull}, shields ${c.shield}, reactor ${c.reactor}, agility ${c.agility}, cargo ${c.cargo}, fuel ${c.tank}, ${c.hardpoints} hardpoints, ${c.slots} upgrade slots, crew ${c.crew}`;
}

// Recompute a ship's stats from its class and upgrades.
export function applyStats(ship) {
  const c = SHIP_CLASSES[ship.classId];
  const u = new Set(ship.upgrades);
  ship.cls = c.name;
  ship.hullMax = c.hull + (u.has('armor') ? 25 : 0);
  ship.shieldMax = c.shield + (u.has('shieldboost') ? 12 : 0);
  ship.reactor = c.reactor + (u.has('reactor') ? 2 : 0);
  ship.agility = Math.round((c.agility + (u.has('thrusters') ? 0.2 : 0)) * 100) / 100;
  ship.cargo = c.cargo + (u.has('cargo') ? 10 : 0);
  ship.tank = c.tank + (u.has('tanks') ? 4 : 0);
  ship.crewMax = c.crew + (u.has('quarters') ? 4 : 0);
  ship.accBonus = u.has('targeting') ? 0.08 : 0;
  ship.hardpoints = c.hardpoints;
  ship.slots = c.slots;
  ship.hidden = u.has('hidden');
  ship.missilesMax = ship.weapons.filter(w => w === 'missile').length * MISSILES_PER_RACK;
  ship.hull = Math.min(ship.hull ?? ship.hullMax, ship.hullMax);
  ship.shield = Math.min(ship.shield ?? ship.shieldMax, ship.shieldMax);
  ship.missiles = Math.min(ship.missiles ?? 0, ship.missilesMax);
  ship.crew = Math.min(ship.crew ?? ship.crewMax, ship.crewMax);
  // Keep assigned power within the reactor.
  const order = ['engines', 'weapons', 'shields'];
  let over = ship.power.shields + ship.power.weapons + ship.power.engines - ship.reactor;
  for (const s of order) {
    while (over > 0 && ship.power[s] > 0) { ship.power[s]--; over--; }
  }
  return ship;
}

export function buildShip(classId) {
  const c = SHIP_CLASSES[classId];
  const ship = {
    classId, upgrades: [], weapons: [...c.loadout],
    sys: { shields: 3, weapons: 3, engines: 3 }, power: { shields: 0, weapons: 0, engines: 0 },
  };
  applyStats(ship);
  // Spread reactor power evenly, extra to shields then weapons.
  const r = ship.reactor, b = Math.floor(r / 3), rem = r % 3;
  ship.power = { shields: Math.min(4, b + (rem > 0 ? 1 : 0)), weapons: Math.min(4, b + (rem > 1 ? 1 : 0)), engines: Math.min(4, b) };
  ship.hull = ship.hullMax;
  ship.shield = ship.shieldMax;
  ship.crew = 0;
  ship.missiles = ship.missilesMax;
  ship.skill = 1;
  return ship;
}

export function tradeInValue(ship) {
  const c = SHIP_CLASSES[ship.classId];
  const hullFactor = 0.5 + 0.5 * (ship.hull / ship.hullMax);
  const extras = ship.weapons.reduce((s, w) => s + WEAPON_PRICES[w] * 0.5, 0) - c.loadout.reduce((s, w) => s + WEAPON_PRICES[w] * 0.5, 0);
  const ups = ship.upgrades.reduce((s, u) => s + UPGRADES[u].price * 0.5, 0);
  return Math.max(0, Math.round((c.price * 0.6 * hullFactor + extras + ups) / 10) * 10);
}
