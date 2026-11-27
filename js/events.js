// Jump events: short scenes with choices that happen on arrival, and derelict salvage runs.
import { GOODS } from './galaxy.js';
import { getRep, changeRep, clanKey } from './reputation.js';
import { makeEnemy } from './combat.js';

let api = null;
export function initEvents(a) { api = a; }

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const SKILL_NAMES = { piloting: 'piloting', gunnery: 'gunnery', repairs: 'repairs', dueling: 'dueling', leadership: 'leadership', trading: 'trading', negotiation: 'negotiation', navigation: 'navigation', deception: 'deception' };

// A skill check: base chance plus 6% per skill level.
export function checkChance(skill, base) {
  return Math.max(0.05, Math.min(0.95, base + api.sk(skill) * 0.06));
}
function roll(skill, base, out) {
  const ok = Math.random() < checkChance(skill, base);
  api.gainXP(skill, ok ? 4 : 2, out);
  return ok;
}
const odds = (skill, base) => `${SKILL_NAMES[skill]} ${api.sk(skill)}, ${Math.round(checkChance(skill, base) * 100)}% chance`;

function pirateEnemy(ctx, strong) {
  const kind = strong ? pick(['raider', 'marauder']) : pick(['cutter', 'raider']);
  return makeEnemy(kind, clanKey(ctx.sys.clan));
}

const EVENTS = {
  beacon: {
    title: 'Distress beacon',
    weight: ctx => (ctx.sys.security === 'high' ? 1 : 2),
    setup: () => ({ truth: pick(['trap', 'trap', 'survivors', 'survivors', 'wreck']) }),
    text: ctx => (ctx.data.scanned
      ? { trap: 'Your scan shows a pirate ship hiding behind the beacon, powered down and waiting.', survivors: 'Your scan picks up life signs: a damaged freighter with survivors aboard.', wreck: 'Your scan finds only a dead wreck, but its hold may still have cargo.' }[ctx.data.truth]
      : 'A distress beacon is calling for help from a drifting ship nearby.'),
    choices: ctx => [
      { id: 'answer', label: 'Answer the call', run: (c, out) => {
        if (c.data.truth === 'trap') { out.push('It was a trap. Pirates power up and attack!'); return { combat: { enemy: pirateEnemy(c, false), range: 1, intro: 'The ambushers close in.' } }; }
        if (c.data.truth === 'survivors') {
          if (api.freeCrewBerths() > 0 && Math.random() < 0.5) { const n = Math.min(api.freeCrewBerths(), rint(1, 3)); api.addCrew(n, 0); out.push(`You rescue the crew. ${n === 1 ? 'One of them asks' : `${n} of them ask`} to join you.`); }
          else { api.receive(rint(200, 450), out); out.push('You rescue the crew, and their company pays a reward.'); }
          changeRep(c.st, 'guild', 2, out); api.morale(3, out); return null;
        }
        const n = api.addCargo(pick(GOODS.filter(g => !g.illegal)).id, rint(3, 8));
        out.push(n ? `The wreck is empty of life, but you salvage ${n} crates from its hold.` : 'The wreck is empty, and you have no room for its cargo.');
        return null;
      } },
      !ctx.data.scanned && !ctx.data.scanFailed && { id: 'scan', label: `Scan it carefully first (${odds('navigation', 0.45)})`, run: (c, out) => {
        if (roll('navigation', 0.45, out)) { c.data.scanned = true; out.push('Your scan cuts through the interference.'); return { more: true }; }
        out.push('The scan shows nothing useful.'); c.data.scanFailed = true; return { more: true };
      } },
      { id: 'ignore', label: 'Ignore it and move on', run: (c, out) => { out.push('You leave the beacon behind.'); if (c.data.truth === 'survivors') api.morale(-2, out); return null; } },
    ],
  },

  stowaway: {
    title: 'Stowaway',
    weight: () => 1,
    setup: () => ({ fugitive: Math.random() < 0.4 }),
    text: ctx => (ctx.data.fugitive ? 'Your crew drags a stowaway out of the cargo hold. The Concord has a warrant out for them.' : 'Your crew finds a scared young stowaway hiding in the cargo hold, looking for work and a way out.'),
    choices: ctx => [
      api.freeCrewBerths() > 0 && { id: 'hire', label: 'Put them to work as crew', run: (c, out) => { api.addCrew(1, c.data.fugitive ? -40 : 0); out.push('They sign on gratefully.'); if (c.data.fugitive) changeRep(c.st, 'concord', -2, out); return null; } },
      { id: 'turnin', label: c => (ctx.data.fugitive ? 'Hand them over to the Concord for the reward' : 'Drop them off at this port'), run: (c, out) => {
        if (c.data.fugitive) { api.receive(300, out); changeRep(c.st, 'concord', 3, out); api.conduct('lawful', out); out.push('The Concord pays 300 credits.'); }
        else out.push('You leave them at the port with a little money.');
        return null;
      } },
      ctx.data.fugitive && { id: 'help', label: 'Let them go quietly', run: (c, out) => { changeRep(c.st, clanKey(c.sys.clan), 2, out); api.morale(1, out); out.push('They slip away into the port crowds.'); return null; } },
    ],
  },

  storm: {
    title: 'Ion storm',
    weight: () => 1.2,
    text: () => 'An ion storm boils across your path. Your sensors flicker.',
    choices: () => [
      { id: 'through', label: `Fly straight through it (${odds('piloting', 0.5)})`, run: (c, out) => {
        if (roll('piloting', 0.5, out)) { out.push('You thread the storm without a scratch.'); return null; }
        const s = api.damageSystem(); api.hullDamage(rint(5, 12)); out.push(`Lightning tears across the hull. Your ${s} are damaged.`); return null;
      } },
      { id: 'around', label: `Plot a way around it (${odds('navigation', 0.55)})`, run: (c, out) => {
        if (roll('navigation', 0.55, out)) { out.push('You find a quiet path around the storm.'); return null; }
        api.passDays(2, out); out.push('The detour costs you 2 days.'); return null;
      } },
      { id: 'wait', label: 'Wait for it to pass, 3 days', run: (c, out) => { api.passDays(3, out); out.push('The storm passes.'); return null; } },
    ],
  },

  smuggler: {
    title: 'A quiet offer',
    weight: ctx => (ctx.sys.security === 'high' ? 0.4 : 1),
    setup: () => ({ goodId: pick(['weapons', 'blacktech']), qty: rint(3, 7) }),
    text: ctx => `A small trader pulls alongside and offers you ${ctx.data.qty} crates of ${GOODS.find(g => g.id === ctx.data.goodId).name.toLowerCase()} at half the usual price.`,
    choices: ctx => {
      const g = GOODS.find(x => x.id === ctx.data.goodId);
      const price = Math.round(g.base * 0.5) * ctx.data.qty;
      return [
        { id: 'buy', label: `Buy them for ${price} credits`, run: (c, out) => {
          if (c.st.credits < price) { out.push('You can’t afford it.'); return { more: true }; }
          if (api.freeSpace() < c.data.qty) { out.push('You don’t have the hold space.'); return { more: true }; }
          c.st.credits -= price; api.addCargo(g.id, c.data.qty, Math.round(g.base * 0.5)); api.conduct('smuggle', out);
          out.push(`You load ${c.data.qty} crates of contraband.`); return null;
        } },
        { id: 'report', label: 'Report them to the Concord', run: (c, out) => { changeRep(c.st, 'concord', 3, out); changeRep(c.st, clanKey(c.sys.clan), -2, out); out.push('You pass their ship ID along to the Concord.'); return null; } },
        { id: 'decline', label: 'Decline', run: (c, out) => { out.push('They shrug and drift away.'); return null; } },
      ];
    },
  },

  pod: {
    title: 'Escape pod',
    weight: () => 1,
    setup: () => ({ who: pick(['merchant', 'merchant', 'pirate', 'spacer']) }),
    text: () => 'An escape pod tumbles past, its beacon blinking weakly.',
    choices: () => [
      { id: 'rescue', label: 'Bring it aboard', run: (c, out) => {
        if (c.data.who === 'merchant') { api.receive(rint(300, 600), out); changeRep(c.st, 'guild', 3, out); out.push('Inside is a Guild merchant, who pays you well for the rescue.'); return null; }
        if (c.data.who === 'spacer') {
          if (api.freeCrewBerths() > 0) { api.addCrew(1, 0); out.push('Inside is a veteran spacer, who joins your crew.'); }
          else out.push('Inside is a spacer, who thanks you and leaves at the next port.');
          api.morale(2, out); return null;
        }
        c.data.step = 'pirate';
        out.push('Inside is a wounded pirate captain with a price on their head.');
        return { more: true };
      } },
      { id: 'leave', label: 'Leave it', run: (c, out) => { out.push('You leave the pod drifting.'); api.morale(-1, out); return null; } },
    ],
    stepChoices: {
      pirate: () => [
        { id: 'bounty', label: 'Hand them to the Concord', run: (c, out) => { api.receive(350, out); changeRep(c.st, 'concord', 3, out); changeRep(c.st, clanKey(c.sys.clan), -3, out); out.push('The Concord pays 350 credits.'); return null; } },
        { id: 'free', label: 'Patch them up and let them go', run: (c, out) => { changeRep(c.st, clanKey(c.sys.clan), 4, out); out.push(`The captain promises the ${c.sys.clan} clan will remember.`); return null; } },
      ],
    },
  },

  derelict: {
    title: 'Derelict',
    weight: ctx => (ctx.sys.security === 'high' ? 0.6 : 1.4),
    setup: () => ({ name: pick(['freighter', 'mining barge', 'survey ship', 'Concord picket', 'pirate hulk', 'passenger liner', 'research station']) }),
    text: ctx => `Your sensors find a derelict ${ctx.data.name}, dark and silent, with no sign of power.`,
    choices: () => [
      { id: 'board', label: 'Send a salvage team aboard', run: c => ({ salvage: c.data.name }) },
      { id: 'leave', label: 'Leave it alone', run: (c, out) => { out.push('You leave the derelict to the dark.'); return null; } },
    ],
  },

  meteors: {
    title: 'Debris field',
    weight: () => 1,
    text: () => 'You drop out of the jump into a field of tumbling debris.',
    choices: () => [
      { id: 'dodge', label: `Weave through it (${odds('piloting', 0.55)})`, run: (c, out) => {
        if (roll('piloting', 0.55, out)) { out.push('You slip through untouched.'); return null; }
        const d = rint(6, 16); api.hullDamage(d); out.push(`Debris hammers the hull for ${d} damage.`); return null;
      } },
      { id: 'shields', label: 'Raise shields and push through slowly, 1 day', run: (c, out) => { api.passDays(1, out); const d = rint(0, 5); if (d) api.hullDamage(d); out.push(d ? `A few pieces get through: ${d} damage.` : 'Your shields take it all.'); return null; } },
    ],
  },

  checkpoint: {
    title: 'Customs checkpoint',
    weight: ctx => (ctx.sys.authority === 'Concord' && api.carryingContraband() ? 3 : 0),
    text: () => 'A Concord customs cutter orders you to hold position for an inspection. You have contraband aboard.',
    choices: () => [
      { id: 'bribe', label: `Offer a quiet payment of 400 credits (${odds('negotiation', 0.45)})`, run: (c, out) => {
        if (c.st.credits < 400) { out.push('You don’t have 400 credits.'); return { more: true }; }
        c.st.credits -= 400;
        if (roll('negotiation', 0.45, out)) { out.push('The inspector pockets the money and waves you on.'); return null; }
        out.push('The inspector takes the money and searches you anyway.'); api.seizeContraband(out); return null;
      } },
      { id: 'bluff', label: `Bluff your way through (${odds('deception', 0.4)})`, run: (c, out) => {
        if (roll('deception', 0.4, out)) { out.push('Your papers and your story hold up.'); return null; }
        out.push('They see through you.'); api.seizeContraband(out); return null;
      } },
      { id: 'dump', label: 'Dump the contraband before they board', run: (c, out) => { api.dumpContraband(out); out.push('The inspection finds nothing.'); return null; } },
      { id: 'run', label: 'Run for it', run: (c, out) => { changeRep(c.st, 'concord', -5, out); out.push('You gun the engines. The cutter gives chase!'); return { combat: { enemy: makeEnemy('patrol', 'concord'), range: 1, intro: 'The customs cutter opens fire.' } }; } },
    ],
  },

  dispute: {
    title: 'Trouble in the crew',
    weight: () => (api.crewCount() >= 4 ? 1 : 0),
    text: () => 'Two of your crew come to blows over a card game, and the rest are taking sides.',
    choices: () => [
      { id: 'settle', label: `Step in and settle it (${odds('leadership', 0.5)})`, run: (c, out) => {
        if (roll('leadership', 0.5, out)) { api.morale(4, out); out.push('Your judgment is accepted, and the crew respects you for it.'); return null; }
        api.morale(-4, out); out.push('Your ruling leaves half the crew sulking.'); return null;
      } },
      { id: 'duel', label: `Let them settle it in a sparring match you referee (${odds('dueling', 0.45)})`, run: (c, out) => {
        if (roll('dueling', 0.45, out)) { api.morale(3, out); out.push('A fair fight clears the air.'); return null; }
        api.morale(-2, out); out.push('The fight gets out of hand before you stop it.'); return null;
      } },
      { id: 'ignore', label: 'Stay out of it', run: (c, out) => { api.morale(-2, out); out.push('It simmers on for days.'); return null; } },
    ],
  },

  nebula: {
    title: 'A strange light',
    weight: () => 0.6,
    text: () => 'You arrive beside a glowing nebula, rippling with colors nobody aboard has seen before.',
    choices: () => [
      { id: 'study', label: 'Spend a day studying it', run: (c, out) => { api.passDays(1, out); api.gainXP('navigation', 8, out); api.morale(3, out); out.push('The crew crowds the viewports, and your charts improve.'); return null; } },
      { id: 'move', label: 'Keep moving', run: (c, out) => { out.push('You press on.'); return null; } },
    ],
  },

  leak: {
    title: 'Fuel leak',
    weight: ctx => (ctx.st.fuel >= 3 ? 1 : 0),
    text: () => 'An alarm sounds: a fuel line has cracked and is venting into space.',
    choices: () => [
      { id: 'fix', label: `Repair it in vacuum (${odds('repairs', 0.5)})`, run: (c, out) => {
        if (roll('repairs', 0.5, out)) { out.push('You seal the line before much is lost.'); api.loseFuel(1); return null; }
        api.loseFuel(3); out.push('The repair takes too long. You lose 3 fuel.'); return null;
      } },
      { id: 'seal', label: 'Seal off the line, losing 2 fuel', run: (c, out) => { api.loseFuel(2); out.push('You lose 2 fuel.'); return null; } },
    ],
  },

  toll: {
    title: 'Pirate toll',
    weight: ctx => ((ctx.sys.security === 'low' || ctx.sys.security === 'none') && getRep(ctx.st, clanKey(ctx.sys.clan)) < 10 ? 1.5 : 0),
    setup: ctx => ({ toll: Math.max(100, Math.round(ctx.st.credits * 0.1 / 10) * 10) }),
    text: ctx => `A ${ctx.sys.clan} clan gunship blocks your path and demands a toll of ${ctx.data.toll} credits.`,
    choices: ctx => [
      { id: 'pay', label: `Pay ${ctx.data.toll} credits`, run: (c, out) => { api.charge(c.data.toll, out); changeRep(c.st, clanKey(c.sys.clan), 1, out); out.push('They let you through.'); return null; } },
      { id: 'talk', label: `Talk them down (${odds('negotiation', 0.35)})`, run: (c, out) => {
        if (roll('negotiation', 0.35, out)) { out.push('You convince them you’re more trouble than you’re worth.'); return null; }
        out.push('They lose patience and attack.'); return { combat: { enemy: pirateEnemy(c, false), range: 1, intro: 'The toll ship opens fire.' } };
      } },
      { id: 'fight', label: 'Refuse and fight', run: (c, out) => ({ combat: { enemy: pirateEnemy(c, false), range: 2, intro: 'You refuse. The toll ship attacks.' } }) },
    ],
  },

  breakdown: {
    title: 'Merchant in trouble',
    weight: ctx => (ctx.sys.security === 'high' ? 0.6 : 1),
    text: () => 'A Guild hauler hangs dead in space, its engines burned out. The captain begs for help.',
    choices: () => [
      { id: 'help', label: `Help repair their engines (${odds('repairs', 0.5)})`, run: (c, out) => {
        if (roll('repairs', 0.5, out)) { api.receive(rint(200, 400), out); changeRep(c.st, 'guild', 4, out); out.push('You get them running, and they pay for your time.'); return null; }
        api.passDays(1, out); changeRep(c.st, 'guild', 1, out); out.push('You can’t fix it, but you tow them to safety. It takes a day.'); return null;
      } },
      { id: 'rob', label: 'Rob them', run: (c, out) => {
        const n = api.addCargo(pick(GOODS.filter(g => !g.illegal)).id, rint(4, 10));
        changeRep(c.st, 'guild', -6, out); changeRep(c.st, clanKey(c.sys.clan), 2, out); api.conduct('piracy', out);
        out.push(n ? `You take ${n} crates from their hold.` : 'You have no room for their cargo, but you scare them badly.'); return null;
      } },
      { id: 'leave', label: 'Leave them', run: (c, out) => { out.push('You fly on.'); return null; } },
    ],
  },

  blackbox: {
    title: 'Black box',
    weight: () => 0.6,
    text: () => 'Your scanners pick up a flight recorder drifting alone. Its last entry mentions a hidden cache.',
    choices: () => [
      { id: 'decode', label: `Decode the coordinates (${odds('navigation', 0.55)})`, run: (c, out) => {
        if (roll('navigation', 0.55, out)) { const dest = api.addCache(); out.push(`The coordinates point to ${dest}. A derelict waits there for you.`); return null; }
        out.push('The data is too corrupted to read.'); return null;
      } },
      { id: 'sell', label: 'Keep it to sell, 150 credits', run: (c, out) => { api.receive(150, out); out.push('A collector at the port buys it.'); return null; } },
    ],
  },
};

export function eventTitle(id) { return EVENTS[id].title; }

// Pick an event for this arrival, or none.
export function rollEvent(sys) {
  const st = api.state();
  if (Math.random() >= 0.24) return null;
  const ctx = { st, sys, data: {} };
  const entries = Object.entries(EVENTS).map(([id, e]) => [id, e.weight(ctx)]).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return startEvent(id, sys);
  }
  return null;
}

export function startEvent(id, sys) {
  const st = api.state();
  const ctx = { st, sys, data: {} };
  const e = EVENTS[id];
  return { id, data: e.setup ? e.setup(ctx) : {}, result: null };
}

function ctxFor(ev) {
  const st = api.state();
  return { st, sys: api.here(), data: ev.data };
}

export function eventView(ev) {
  const e = EVENTS[ev.id];
  const c = ctxFor(ev);
  const list = ev.data.step && e.stepChoices ? e.stepChoices[ev.data.step](c) : e.choices(c);
  return {
    title: e.title,
    text: ev.data.step ? '' : e.text(c),
    choices: list.filter(Boolean).map(ch => ({ id: ch.id, label: typeof ch.label === 'function' ? ch.label(c) : ch.label })),
  };
}

// Returns { lines, combat?, salvage?, done }.
export function chooseEvent(ev, choiceId) {
  const e = EVENTS[ev.id];
  const c = ctxFor(ev);
  const list = (ev.data.step && e.stepChoices ? e.stepChoices[ev.data.step](c) : e.choices(c)).filter(Boolean);
  const ch = list.find(x => x.id === choiceId);
  if (!ch) return { lines: [], done: false };
  const out = [];
  const r = ch.run(c, out);
  if (r && r.more) return { lines: out, done: false };
  return { lines: out, combat: r && r.combat, salvage: r && r.salvage, done: true };
}

// ---------- derelict salvage ----------
const ROOMS = ['a cargo bay, its crates scattered', 'a cramped crew deck', 'the dark bridge, consoles cracked', 'an engine room thick with frost', 'a sealed vault door', 'a medical bay', 'the captain’s quarters', 'a gutted armory', 'a long maintenance shaft'];
const HAZARDS = [
  { text: 'A bulkhead gives way and someone is caught behind it.', crew: 1 },
  { text: 'An old automated turret wakes up and fires.', crew: 1, hull: 0 },
  { text: 'The derelict’s reactor flares and the shock wave hits your ship.', hull: 10 },
  { text: 'Something moves in the dark and drags one of your team away.', crew: 1, duel: true },
  { text: 'A section decompresses. Your team scrambles to safety.', crew: 0, hull: 4 },
];

export function startSalvage(name) {
  return { name, depth: 0, maxDepth: rint(3, 6), haul: { credits: 0, goods: {} }, log: [`Your team enters the derelict ${name}.`], over: false };
}

export function salvageDanger(sv) {
  return Math.max(0.05, Math.min(0.8, 0.1 + sv.depth * 0.08 - api.sk('repairs') * 0.01));
}

export function salvageStep(sv) {
  const out = [];
  sv.depth++;
  const room = pick(ROOMS);
  out.push(`You push into ${room}.`);
  if (Math.random() < salvageDanger(sv)) {
    const h = pick(HAZARDS);
    out.push(h.text);
    if (h.duel && Math.random() < 0.35 + api.sk('dueling') * 0.06) { out.push('You fight it off and get your crew member back.'); api.gainXP('dueling', 4, out); }
    else {
      if (h.crew) api.loseCrew(h.crew, out);
      if (h.hull) api.hullDamage(h.hull);
    }
    api.morale(-1, out);
  }
  const last = sv.depth >= sv.maxDepth;
  if (last) {
    const roll2 = Math.random();
    if (roll2 < 0.35 && api.freeUpgradeSlot()) {
      const u = api.grantUpgrade();
      out.push(`At the heart of the wreck you find intact ship parts. Your engineers install ${u}.`);
    } else {
      const credits = rint(800, 2000);
      sv.haul.credits += credits;
      out.push(`At the heart of the wreck you find a sealed strongbox: ${credits} credits.`);
    }
    out.push('There is nowhere further to go.');
    sv.over = true;
  } else if (Math.random() < 0.7) {
    if (Math.random() < 0.5) {
      const credits = rint(60, 180) * sv.depth;
      sv.haul.credits += credits;
      out.push(`You find ${credits} credits in salvageable parts.`);
    } else {
      const g = pick(GOODS.filter(x => x.base >= 70));
      const q = rint(1, 3);
      sv.haul.goods[g.id] = (sv.haul.goods[g.id] || 0) + q;
      out.push(`You find ${q} ${q === 1 ? 'crate' : 'crates'} of ${g.name.toLowerCase()}.`);
    }
  } else {
    out.push('There is nothing worth taking here.');
  }
  api.gainXP('repairs', 1, out);
  sv.log = out;
  return out;
}

export function finishSalvage(sv) {
  const out = [];
  if (sv.haul.credits) api.receive(sv.haul.credits, out);
  const parts = [];
  for (const [gid, q] of Object.entries(sv.haul.goods)) {
    const n = api.addCargo(gid, q);
    if (n) parts.push(`${n} ${GOODS.find(g => g.id === gid).name}`);
    if (n < q) out.push(`You leave ${q - n} crates of ${GOODS.find(g => g.id === gid).name.toLowerCase()} behind for lack of space.`);
  }
  out.unshift(`You bring back ${sv.haul.credits} credits${parts.length ? ` and ${parts.join(', ')}` : ''}.`);
  return out;
}
