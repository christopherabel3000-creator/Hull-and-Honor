// The captain's personal weapon and armor, and the crew armory.
export const WEAPON_GEAR = {
  knife: { name: 'Combat knife', price: 100, bonus: 1, sold: ['concord', 'independent', 'clan'] },
  baton: { name: 'Shock baton', price: 300, bonus: 1, sold: ['concord'] },
  pistol: { name: 'Heavy pistol', price: 600, bonus: 2, sold: ['concord', 'independent', 'clan'] },
  blade: { name: 'Monofilament blade', price: 1400, bonus: 3, sold: ['independent', 'clan'] },
  plasma: { name: 'Plasma pistol', price: 2500, bonus: 3, sold: ['clan'] },
  saber: { name: 'Duelist’s saber', price: 4000, bonus: 4, sold: ['clan'] },
};
export const ARMOR_GEAR = {
  padded: { name: 'Padded vest', price: 200, bonus: 1, sold: ['concord', 'independent', 'clan'] },
  flak: { name: 'Flak jacket', price: 700, bonus: 2, sold: ['concord', 'independent', 'clan'] },
  combat: { name: 'Combat armor', price: 1800, bonus: 3, sold: ['concord', 'clan'] },
  powered: { name: 'Powered armor', price: 4500, bonus: 4, sold: ['clan', 'concord-high'] },
};
export const ARMORY_COST = [1500, 3500, 7000];
export const ARMORY_MAX = 3;

export function ensureGear(st) {
  if (!st.gear) st.gear = { weapon: null, armor: null, armory: 0 };
}
export const weaponBonus = st => (st.gear && st.gear.weapon ? WEAPON_GEAR[st.gear.weapon].bonus : 0);
export const armorBonus = st => (st.gear && st.gear.armor ? ARMOR_GEAR[st.gear.armor].bonus : 0);

// Boarding-fight strength multiplier from gear.
export function boardingGearMult(st) {
  return (1 + 0.05 * weaponBonus(st) + 0.04 * armorBonus(st)) * (1 + 0.1 * (st.gear ? st.gear.armory : 0));
}

// Chance that armor saves your life when a boarding fight is lost.
export const armorSaveChance = st => armorBonus(st) * 0.1;

export function soldHere(item, kind, security) {
  return item.sold.includes(kind) || (kind === 'concord' && security === 'high' && item.sold.includes('concord-high'));
}
