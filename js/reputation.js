import { sysState } from './economy.js';

const TIERS = [
  { min: 85, name: 'Revered' }, { min: 60, name: 'Honored' }, { min: 30, name: 'Trusted' }, { min: 10, name: 'Liked' },
  { min: -9, name: 'Neutral' }, { min: -29, name: 'Disliked' }, { min: -59, name: 'Hostile' }, { min: -100, name: 'Hated' },
];
export const tierName = v => TIERS.find(t => v >= t.min).name;
// Which contract tier a standing unlocks (-1 means no contracts at all).
export const accessTier = v => (v >= 60 ? 3 : v >= 30 ? 2 : v >= 10 ? 1 : v >= -9 ? 0 : -1);
export const TIER_REQUIREMENT = ['Neutral', 'Liked', 'Trusted', 'Honored'];

export const clanKey = name => 'clan:' + name;
export const clanOf = key => key.slice(5);
export const factionName = key =>
  key === 'guild' ? 'Merchant Guild' : key === 'concord' ? 'Concord' : `${clanOf(key)} clan`;

export function ensureRep(state, galaxy) {
  if (!state.rep) state.rep = { guild: 0, concord: 0, clans: {} };
  for (const r of galaxy.regions) if (r.clan && state.rep.clans[r.clan] == null) state.rep.clans[r.clan] = 0;
  if (state.notoriety == null) state.notoriety = 0;
  if (!state.missions) state.missions = [];
  if (state.nextMissionId == null) state.nextMissionId = 1;
}

export function factionKeys(state) {
  return ['guild', 'concord', ...Object.keys(state.rep.clans).map(clanKey)];
}

export function getRep(state, key) {
  return key.startsWith('clan:') ? state.rep.clans[clanOf(key)] : state.rep[key];
}

const clamp = v => Math.max(-100, Math.min(100, Math.round(v * 10) / 10));

export function changeRep(state, key, delta, msgs) {
  const before = getRep(state, key);
  const after = clamp(before + delta);
  if (key.startsWith('clan:')) state.rep.clans[clanOf(key)] = after;
  else state.rep[key] = after;
  if (tierName(before) !== tierName(after) && msgs) {
    msgs.push(`Your standing with the ${factionName(key)} is now ${tierName(after)}.`);
  }
}

export function changeLocal(state, galaxy, sysId, delta, msgs) {
  const s = sysState(state, sysId);
  const before = s.local;
  s.local = clamp(before + delta);
  if (tierName(before) !== tierName(s.local) && msgs) {
    msgs.push(`You are now ${tierName(s.local)} at ${galaxy.systems[sysId].name}.`);
  }
}

export function addNotoriety(state, n) {
  state.notoriety = Math.max(0, Math.min(100, state.notoriety + n));
}
export function notorietyName(n) {
  return n >= 70 ? 'legendary' : n >= 45 ? 'famous' : n >= 25 ? 'well known' : n >= 10 ? 'known locally' : 'unknown';
}

// The faction that runs a port.
export function controllingFaction(sys) {
  if (sys.authority === 'Concord') return 'concord';
  if (sys.authority === 'Independent') return null;
  return clanKey(sys.clan);
}

export function dockingStatus(state, sys) {
  const local = sysState(state, sys.id).local;
  const ruler = controllingFaction(sys);
  if (ruler && getRep(state, ruler) <= -30) {
    return { ok: false, reason: `The ${factionName(ruler)} refuses to let you dock.` };
  }
  if (local <= (ruler ? -30 : -50)) {
    return { ok: false, reason: `The port authorities at ${sys.name} refuse to let you dock.` };
  }
  return { ok: true };
}
