// Story arcs that open up as your reputation changes.
import { getRep, clanKey, changeRep, addNotoriety } from './reputation.js';
import { GOODS, ECONOMIES, hopCounts } from './galaxy.js';

let api = null; // { state(), galaxy(), receive, charge, log }
export function initStory(a) { api = a; }

const NAMES = ['Varna', 'Kessick', 'Oru', 'Thane', 'Isolde', 'Ravik', 'Marrow', 'Sezzi', 'Duran', 'Ilka', 'Corva', 'Bastien'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clans = st => Object.keys(st.rep.clans);

function pickSystem(g, from, filter, lo = 2, hi = 8) {
  const hops = hopCounts(g, from);
  const all = g.systems.filter(s => filter(s) && hops[s.id] < Infinity && s.id !== from);
  const near = all.filter(s => hops[s.id] >= lo && hops[s.id] <= hi);
  const pool = near.length ? near : all;
  if (!pool.length) return from;
  return pick(pool).id;
}
const regionOfClan = (g, clan) => g.regions.find(r => r.clan === clan).id;
function clanSystem(g, clan, from, preferNone = true) {
  const reg = regionOfClan(g, clan);
  const inReg = s => s.region === reg;
  const strong = g.systems.filter(s => inReg(s) && s.security === 'none');
  if (preferNone && strong.length) return pickSystem(g, from, s => inReg(s) && s.security === 'none', 0, 99);
  return pickSystem(g, from, inReg, 0, 99);
}
const lowestClan = st => clans(st).sort((a, b) => st.rep.clans[a] - st.rep.clans[b])[0];
const highestClan = st => clans(st).sort((a, b) => st.rep.clans[b] - st.rep.clans[a])[0];
const sysName = (ctx, id) => ctx.g.systems[id].name;
const active = (st, id) => st.arcs[id] && st.arcs[id].status === 'active';

export const ARCS = {
  navy: {
    title: 'Navy hero',
    trigger: (st, g, sys) => getRep(st, 'concord') >= 30 && sys.authority === 'Concord' && !active(st, 'wanted'),
    offer: () => 'Admiral Rhee of the Concord Navy offers you a reserve commission, and a chance to take down a pirate lord. Commissioned captains earn 25% more from pirate bounties.',
    setup(ctx) {
      const { st, g } = ctx;
      const clan = lowestClan(st);
      return {
        clan, lord: `Lord ${pick(NAMES)}`,
        admiral: pickSystem(g, st.location, s => s.authority === 'Concord' && s.security === 'high', 2, 6),
        outpost: clanSystem(g, clan, st.location, false),
        stronghold: clanSystem(g, clan, st.location, true),
      };
    },
    accept(ctx, msgs) { ctx.st.perks.navyCommission = true; changeRep(ctx.st, 'concord', 3, msgs); },
    steps: [
      { kind: 'goto', title: c => `Report to Admiral Rhee at ${sysName(c, c.data.admiral)}`, dest: c => c.data.admiral, faction: 'concord',
        done: (c, msgs) => msgs.push(`The admiral briefs you. ${c.data.lord} of the ${c.data.clan} clan hides at ${sysName(c, c.data.stronghold)}. First, break the clan's outpost at ${sysName(c, c.data.outpost)}.`) },
      { kind: 'fight', title: c => `Destroy the ${c.data.clan} outpost guard at ${sysName(c, c.data.outpost)}`, dest: c => c.data.outpost, faction: 'concord',
        enemy: 'marauder', enemyFaction: c => clanKey(c.data.clan), enemyName: c => `${c.data.clan} outpost guard`,
        done: (c, msgs) => { changeRep(c.st, 'concord', 5, msgs); api.receive(1500, msgs); msgs.push('The Concord pays 1500 credits for the outpost.'); } },
      { kind: 'choice', when: c => active(c.st, 'pirate') && c.st.arcs.pirate.data.clan === c.data.clan,
        text: c => `Your next target is ${c.data.lord}, lord of the ${c.data.clan} clan, the same clan you sail for. You must choose a side.`,
        options: [
          { id: 'navy', label: 'Stay with the Navy and betray the clan',
            resolve: (c, msgs) => { failArc('pirate', msgs, 'You turned on the clan.'); changeRep(c.st, clanKey(c.data.clan), -30, msgs); return 'next'; } },
          { id: 'clan', label: 'Warn the clan and abandon the Navy',
            resolve: (c, msgs) => { changeRep(c.st, 'concord', -25, msgs); changeRep(c.st, clanKey(c.data.clan), 10, msgs); return 'fail'; } },
        ] },
      { kind: 'fight', title: c => `Defeat ${c.data.lord} at ${sysName(c, c.data.stronghold)}`, dest: c => c.data.stronghold, faction: 'concord',
        enemy: 'dreadnought', enemyFaction: c => clanKey(c.data.clan), enemyName: c => `${c.data.lord}'s dreadnought`, captain: c => c.data.lord,
        done: (c, msgs) => {
          changeRep(c.st, 'concord', 20, msgs);
          changeRep(c.st, clanKey(c.data.clan), -30, msgs);
          for (const k of clans(c.st)) if (k !== c.data.clan) changeRep(c.st, clanKey(k), -5, msgs);
          addNotoriety(c.st, 10);
          api.receive(8000, msgs);
          msgs.push(`${c.data.lord} is finished. The Concord names you a Hero of the Concord and pays 8000 credits. Pirate bounties now pay you 50% more, and the Warden frigate is open to you.`);
        } },
    ],
    finish(ctx) { ctx.st.perks.concordHero = true; },
  },

  pirate: {
    title: 'Pirate rise',
    trigger: (st, g, sys) => sys.authority.endsWith(' clan') && getRep(st, clanKey(sys.clan)) >= 30,
    offer: (ctx, sys) => `The captain-elders of the ${sys.clan} clan invite you to sail under their banner and rise through their ranks.`,
    setup(ctx) {
      const { st, g } = ctx;
      const clan = g.systems[st.location].clan;
      const others = clans(st).filter(k => k !== clan).sort((a, b) => st.rep.clans[a] - st.rep.clans[b]);
      const rival = others[0];
      return {
        clan, rival, lord: `Lord ${pick(NAMES)}`, rivalCaptain: `${pick(NAMES)} of the ${rival}`,
        convoy: pickSystem(g, st.location, s => (s.authority === 'Concord' || s.authority === 'Independent') && s.security !== 'high', 3, 7),
        rivalSys: clanSystem(g, rival, st.location, false),
        stronghold: clanSystem(g, clan, st.location, true),
      };
    },
    accept(ctx, msgs) { changeRep(ctx.st, clanKey(ctx.data.clan), 5, msgs); },
    steps: [
      { kind: 'fight', title: c => `Raid the armed Guild convoy at ${sysName(c, c.data.convoy)}`, dest: c => c.data.convoy, faction: c => clanKey(c.data.clan),
        enemy: 'convoy', enemyFaction: () => 'guild', enemyName: () => 'armed Guild convoy ship', approach: true,
        done: (c, msgs) => { changeRep(c.st, clanKey(c.data.clan), 5, msgs); api.receive(2000, msgs); msgs.push('The clan takes its share and pays you 2000 credits.'); } },
      { kind: 'fight', title: c => `Destroy the rival captain ${c.data.rivalCaptain} at ${sysName(c, c.data.rivalSys)}`, dest: c => c.data.rivalSys, faction: c => clanKey(c.data.clan),
        enemy: 'flagship', enemyFaction: c => clanKey(c.data.rival), enemyName: c => `${c.data.rivalCaptain}'s flagship`, captain: c => c.data.rivalCaptain,
        done: (c, msgs) => { changeRep(c.st, clanKey(c.data.clan), 10, msgs); changeRep(c.st, clanKey(c.data.rival), -20, msgs); api.receive(2500, msgs); msgs.push('The elders reward you with 2500 credits and a seat among the clan captains.'); } },
      { kind: 'choice', when: c => active(c.st, 'navy') && c.st.arcs.navy.data.clan === c.data.clan,
        text: c => `The Navy's commission has you hunting the ${c.data.clan} clan's lord, the very clan you now sail for. You must choose a side.`,
        options: [
          { id: 'clan', label: 'Stay with the clan and resign your commission',
            resolve: (c, msgs) => { failArc('navy', msgs, 'You resigned your commission.'); c.st.perks.navyCommission = false; changeRep(c.st, 'concord', -25, msgs); return 'next'; } },
          { id: 'navy', label: 'Betray the clan to the Navy',
            resolve: (c, msgs) => { changeRep(c.st, clanKey(c.data.clan), -30, msgs); changeRep(c.st, 'concord', 5, msgs); return 'fail'; } },
        ] },
      { kind: 'choice', text: c => `You can now challenge ${c.data.lord} for leadership of the ${c.data.clan} clan: by tribute, or by duel at ${sysName(c, c.data.stronghold)}.`,
        options: [
          { id: 'tribute', label: 'Buy the elders’ votes for 12000 credits', cost: 12000,
            resolve: (c, msgs) => { if (c.st.credits < 12000) { msgs.push('You need 12000 credits.'); return 'stay'; } c.st.credits -= 12000; msgs.push(`The elders vote ${c.data.lord} out.`); return 'end'; } },
          { id: 'duel', label: 'Challenge the lord to a duel', resolve: () => 'next' },
          { id: 'wait', label: 'Not yet', resolve: (c, msgs) => { msgs.push('The challenge can wait.'); return 'stay'; } },
        ] },
      { kind: 'fight', title: c => `Defeat ${c.data.lord} in a duel at ${sysName(c, c.data.stronghold)}`, dest: c => c.data.stronghold, faction: c => clanKey(c.data.clan),
        enemy: 'dreadnought', enemyFaction: c => clanKey(c.data.clan), enemyName: c => `${c.data.lord}'s dreadnought`, captain: c => c.data.lord },
    ],
    finish(ctx, msgs) {
      const { st, data } = ctx;
      st.rep.clans[data.clan] = 100;
      st.perks.clanLord = data.clan;
      st.perks.lastTribute = st.day;
      changeRep(st, 'concord', -20, msgs);
      addNotoriety(st, 20);
      msgs.push(`You are now lord of the ${data.clan} clan. Its raiders will never attack you, and its ports pay you 800 credits of tribute every 10 days.`);
    },
  },

  double: {
    title: 'Double agent',
    trigger: st => getRep(st, 'concord') >= 30 && clans(st).some(k => st.rep.clans[k] >= 30),
    offer: ctx => `A message arrives with no sender: "We know you work for both the Concord and the ${highestClan(ctx.st)} clan. Let's talk."`,
    acceptLabel: 'Answer the message',
    declineLabel: 'Ignore it',
    decline(ctx, msgs) {
      const clan = highestClan(ctx.st);
      msgs.push('Whoever sent it leaks what they know.');
      changeRep(ctx.st, 'concord', -10, msgs);
      changeRep(ctx.st, clanKey(clan), -10, msgs);
    },
    setup: ctx => ({ clan: highestClan(ctx.st) }),
    steps: [
      { kind: 'choice', text: c => `The sender wants 3000 credits for silence, but also says both the Concord and the ${c.data.clan} clan would pay well to know what the other is planning.`,
        options: [
          { id: 'pay', label: 'Pay 3000 credits for silence',
            resolve: (c, msgs) => { if (c.st.credits < 3000) { msgs.push('You need 3000 credits.'); return 'stay'; } c.st.credits -= 3000; msgs.push('The sender goes quiet.'); return 'end'; } },
          { id: 'concord', label: 'Sell the clan out to the Concord',
            resolve: (c, msgs) => { changeRep(c.st, clanKey(c.data.clan), -40, msgs); changeRep(c.st, 'concord', 15, msgs); api.receive(4000, msgs); msgs.push(`The Concord pays 4000 credits. The ${c.data.clan} clan will want revenge.`); c.data.side = 'concord'; return 'next'; } },
          { id: 'clan', label: 'Warn the clan about the Concord',
            resolve: (c, msgs) => { changeRep(c.st, 'concord', -40, msgs); changeRep(c.st, clanKey(c.data.clan), 15, msgs); api.receive(4000, msgs); msgs.push('The clan pays 4000 credits. Concord intelligence will come for you.'); c.data.side = 'clan'; return 'next'; } },
          { id: 'both', label: 'Feed both sides false information',
            resolve: (c, msgs) => {
              if (Math.random() < 0.5) { changeRep(c.st, 'concord', 5, msgs); changeRep(c.st, clanKey(c.data.clan), 5, msgs); api.receive(6000, msgs); msgs.push('Both sides pay, and neither suspects. 6000 credits.'); }
              else { changeRep(c.st, 'concord', -30, msgs); changeRep(c.st, clanKey(c.data.clan), -30, msgs); addNotoriety(c.st, 10); msgs.push('Both sides find out.'); }
              return 'end';
            } },
        ] },
      { kind: 'fight', title: c => (c.data.side === 'concord' ? `Survive the ${c.data.clan} clan's assassin` : 'Survive the Concord intelligence hunter'), dest: () => -1,
        faction: c => (c.data.side === 'concord' ? 'concord' : clanKey(c.data.clan)),
        enemy: c => (c.data.side === 'concord' ? 'marauder' : 'hunter'),
        enemyFaction: c => (c.data.side === 'concord' ? clanKey(c.data.clan) : 'concord'),
        enemyName: c => (c.data.side === 'concord' ? `${c.data.clan} assassin` : 'Concord intelligence hunter'),
        done: (c, msgs) => msgs.push('That loose end is tied off.') },
    ],
  },

  guild: {
    title: 'Guild favorite',
    trigger: (st, g, sys) => getRep(st, 'guild') >= 30 && (sys.authority === 'Concord' || sys.authority === 'Independent'),
    offer: ctx => `The Merchant Guild invites you to address its council. Captains who win the council's favor are paid 25% more for Guild contracts.`,
    setup(ctx) {
      const { st, g } = ctx;
      const council = pickSystem(g, st.location, s => s.authority === 'Concord' && s.economy === 'wealthy', 2, 7);
      const wanted = ECONOMIES[g.systems[council].economy].demands;
      return { council, goodId: pick(wanted), units: 15, house: `House ${pick(['Varo', 'Delacourt', 'Imre', 'Sallow', 'Okafor'])}` };
    },
    steps: [
      { kind: 'goto', title: c => `Address the Guild council at ${sysName(c, c.data.council)}`, dest: c => c.data.council, faction: 'guild',
        done: (c, msgs) => msgs.push(`The council wants proof of your reach: bring ${c.data.units} ${GOODS.find(x => x.id === c.data.goodId).name} to ${sysName(c, c.data.council)}.`) },
      { kind: 'deliver', title: c => `Bring ${c.data.units} ${GOODS.find(x => x.id === c.data.goodId).name} to the council at ${sysName(c, c.data.council)}`, dest: c => c.data.council, faction: 'guild',
        goodId: c => c.data.goodId, units: c => c.data.units,
        done: (c, msgs) => { changeRep(c.st, 'guild', 10, msgs); api.receive(3000, msgs); msgs.push('The council pays 3000 credits.'); } },
      { kind: 'choice', text: c => `${c.data.house}, a rival trading house, quietly offers you 8000 credits to leak the Guild's convoy routes.`,
        options: [
          { id: 'expose', label: `Expose the offer to the Guild`,
            resolve: (c, msgs) => { changeRep(c.st, 'guild', 15, msgs); api.receive(5000, msgs); msgs.push(`The Guild breaks ${c.data.house} and rewards you with 5000 credits.`); return 'end'; } },
          { id: 'take', label: 'Take the money',
            resolve: (c, msgs) => {
              api.receive(8000, msgs);
              if (Math.random() < 0.5) { changeRep(c.st, 'guild', -40, msgs); msgs.push('The Guild discovers your betrayal.'); return 'fail'; }
              msgs.push('You take 8000 credits. Nobody finds out.');
              return 'end';
            } },
          { id: 'refuse', label: 'Refuse quietly', resolve: (c, msgs) => { changeRep(c.st, 'guild', 5, msgs); msgs.push('You turn them down.'); return 'end'; } },
        ] },
    ],
    finish(ctx, msgs) { ctx.st.perks.guildCharter = true; msgs.push('You hold a Guild charter. Guild contracts now pay you 25% more.'); },
  },

  wanted: {
    title: 'Wanted',
    auto: true,
    repeatable: true,
    trigger: st => getRep(st, 'concord') <= -60,
    offer: () => 'The Concord has posted a bounty on your head. Bounty hunters will come for you until your name is cleared.',
    setup(ctx) {
      const { st, g } = ctx;
      const lawyer = pickSystem(g, st.location, s => s.authority === 'Independent', 1, 6);
      const clan = highestClan(st) === lowestClan(st) ? clans(st)[0] : lowestClan(st);
      return { lawyer, clan, target: clanSystem(g, clan, st.location, true), captain: `${pick(NAMES)} the Butcher` };
    },
    steps: [
      { kind: 'goto', title: c => `Meet the lawyer at ${sysName(c, c.data.lawyer)}`, dest: c => c.data.lawyer, faction: 'concord',
        done: (c, msgs) => msgs.push('The lawyer can clear your name, for a price, or for a favor the Concord badly wants done.') },
      { kind: 'choice', text: c => `Pay 15000 credits to clear your name, or kill ${c.data.captain}, a ${c.data.clan} clan butcher the Concord can't reach, at ${sysName(c, c.data.target)}.`,
        options: [
          { id: 'pay', label: 'Pay 15000 credits',
            resolve: (c, msgs) => { if (c.st.credits < 15000) { msgs.push('You need 15000 credits.'); return 'stay'; } c.st.credits -= 15000; return 'end'; } },
          { id: 'job', label: 'Take the job', resolve: () => 'next' },
          { id: 'wait', label: 'Not yet', resolve: (c, msgs) => { msgs.push('The offer stands.'); return 'stay'; } },
        ] },
      { kind: 'fight', title: c => `Kill ${c.data.captain} at ${sysName(c, c.data.target)}`, dest: c => c.data.target, faction: 'concord',
        enemy: 'flagship', enemyFaction: c => clanKey(c.data.clan), enemyName: c => `${c.data.captain}'s flagship`, captain: c => c.data.captain },
    ],
    finish(ctx, msgs) {
      ctx.st.rep.concord = Math.max(ctx.st.rep.concord, -9);
      msgs.push('Your name is cleared. The bounty is lifted and the Concord treats you as Neutral.');
    },
  },
};

// ---------- engine ----------
const ctxFor = id => {
  const st = api.state();
  return { st, g: api.galaxy(), arc: st.arcs[id], data: st.arcs[id]?.data };
};
const val = (v, c) => (typeof v === 'function' ? v(c) : v);

export function ensureStory(st) {
  if (!st.arcs) st.arcs = {};
  if (!st.perks) st.perks = {};
}

export function checkTriggers(sys, msgs) {
  const st = api.state(), g = api.galaxy();
  for (const [id, def] of Object.entries(ARCS)) {
    const a = st.arcs[id];
    if (a && !(def.repeatable && a.status === 'done')) continue;
    if (!def.trigger(st, g, sys)) continue;
    st.arcs[id] = { status: 'offered', step: -1, data: {}, offerText: def.offer({ st, g }, sys) };
    if (def.auto) { msgs.push(`Story: ${def.title}. ${st.arcs[id].offerText}`); acceptArc(id, msgs); }
    else msgs.push(`New story offer: ${def.title}. See Contracts.`);
  }
  // The Wanted story ends early if your Concord standing recovers.
  if (active(st, 'wanted') && getRep(st, 'concord') > -30) {
    endMissions('wanted');
    st.arcs.wanted.status = 'done';
    msgs.push('The Concord has lifted the bounty on you.');
  }
}

export function acceptArc(id, msgs) {
  const def = ARCS[id];
  const st = api.state();
  const a = st.arcs[id];
  a.status = 'active';
  a.data = def.setup({ st, g: api.galaxy() });
  if (def.accept) def.accept(ctxFor(id), msgs);
  api.log(`Story begun: ${def.title}.`);
  activateStep(id, 0, msgs);
}

export function declineArc(id, msgs) {
  const def = ARCS[id];
  const st = api.state();
  st.arcs[id].status = 'declined';
  if (def.decline) def.decline({ st, g: api.galaxy() }, msgs);
  else msgs.push(`You decline. ${def.title} will not be offered again.`);
}

function activateStep(id, n, msgs) {
  const def = ARCS[id];
  const st = api.state();
  const a = st.arcs[id];
  if (n >= def.steps.length) { finishArc(id, msgs); return; }
  const step = def.steps[n];
  const c = ctxFor(id);
  if (step.when && !step.when(c)) { activateStep(id, n + 1, msgs); return; }
  a.step = n;
  a.choice = step.kind === 'choice';
  if (a.choice) {
    msgs.push(`${def.title}: ${step.text(c)} Choose in Contracts.`);
    return;
  }
  const m = {
    id: st.nextMissionId++, type: 'story', arc: id, step: n, faction: val(step.faction, c) || 'concord', tier: 0,
    origin: st.location, dest: val(step.dest, c), units: 0, pay: 0, deadline: 99999, title: step.title(c),
  };
  if (step.kind === 'fight') {
    m.enemy = val(step.enemy, c);
    m.enemyFaction = val(step.enemyFaction, c);
    m.enemyName = val(step.enemyName, c);
    m.approach = !!step.approach;
    if (step.captain) m.captain = val(step.captain, c);
  }
  if (step.kind === 'deliver') { m.goodId = val(step.goodId, c); m.units = val(step.units, c); m.deliverOnly = true; }
  st.missions.push(m);
  msgs.push(`${def.title}: ${m.title}.`);
}

export function storyMissionDone(m, msgs) {
  const st = api.state();
  st.missions = st.missions.filter(x => x !== m);
  const def = ARCS[m.arc];
  const step = def.steps[m.step];
  if (step.done) step.done(ctxFor(m.arc), msgs);
  activateStep(m.arc, m.step + 1, msgs);
}

export function chooseOption(id, optionId, msgs) {
  const def = ARCS[id];
  const st = api.state();
  const a = st.arcs[id];
  if (!a || a.status !== 'active' || !a.choice) return;
  const step = def.steps[a.step];
  const opt = step.options.find(o => o.id === optionId);
  if (!opt) return;
  const r = opt.resolve(ctxFor(id), msgs);
  if (r === 'stay') return;
  a.choice = false;
  if (r === 'fail') failArc(id, msgs, 'This story has ended.');
  else if (r === 'end') finishArc(id, msgs);
  else activateStep(id, a.step + 1, msgs);
}

function endMissions(id) {
  const st = api.state();
  st.missions = st.missions.filter(m => !(m.type === 'story' && m.arc === id));
}

export function failArc(id, msgs, reason) {
  const st = api.state();
  const a = st.arcs[id];
  if (!a || a.status !== 'active') return;
  endMissions(id);
  a.status = 'failed';
  a.choice = false;
  msgs.push(`${ARCS[id].title} is over. ${reason}`);
  api.log(`Story failed: ${ARCS[id].title}.`);
}

function finishArc(id, msgs) {
  const def = ARCS[id];
  const st = api.state();
  const a = st.arcs[id];
  endMissions(id);
  a.status = 'done';
  a.choice = false;
  if (def.finish) def.finish(ctxFor(id), msgs);
  msgs.push(`Story complete: ${def.title}.`);
  api.log(`Story complete: ${def.title}.`);
}

// Data for the Story section of the Contracts view.
export function storyEntries() {
  const st = api.state();
  const out = [];
  for (const [id, def] of Object.entries(ARCS)) {
    const a = st.arcs[id];
    if (!a) continue;
    const e = { id, title: def.title, status: a.status };
    if (a.status === 'offered') {
      e.text = a.offerText;
      e.acceptLabel = def.acceptLabel || 'Accept';
      e.declineLabel = def.declineLabel || 'Decline';
    } else if (a.status === 'active') {
      if (a.choice) {
        const step = def.steps[a.step];
        e.text = step.text(ctxFor(id));
        e.options = step.options.map(o => ({ id: o.id, label: o.label }));
      } else {
        const m = st.missions.find(x => x.type === 'story' && x.arc === id);
        e.text = m ? `Current objective: ${m.title}.` : '';
      }
    }
    out.push(e);
  }
  return out;
}
