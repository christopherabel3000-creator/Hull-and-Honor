// Cantina games: Starjack (cards), Void Dice and pit fights.
const RANKS = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function cardValue(r) { return r === 'ace' ? 11 : ['jack', 'queen', 'king'].includes(r) ? 10 : Number(r); }
export function handTotal(hand) {
  let t = hand.reduce((s, r) => s + cardValue(r), 0);
  let aces = hand.filter(r => r === 'ace').length;
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
}
const draw = () => RANKS[rint(0, 12)];
const article = r => (r === 'ace' || r === '8' ? 'an' : 'a');
export const handText = h => `${h.join(', ')}, total ${handTotal(h)}`;

// ---------- Starjack ----------
export function startStarjack(bet) {
  const g = { game: 'starjack', bet, you: [draw(), draw()], dealer: [draw(), draw()], over: false, lines: [] };
  g.lines = [`You're dealt ${handText(g.you)}. The dealer shows ${article(g.dealer[0])} ${g.dealer[0]}.`];
  if (handTotal(g.you) === 21) finishStarjack(g, 'You have Starjack!');
  return g;
}
export function starjackHit(g, card) {
  const c = card || draw();
  g.you.push(c);
  g.lines = [`You draw ${article(c)} ${c}. Your hand: ${handText(g.you)}.`];
  if (handTotal(g.you) > 21) { g.over = true; g.result = 'lose'; g.lines.push(`Bust. You lose ${g.bet}.`); }
  else if (handTotal(g.you) === 21) { g.lines.push('Twenty-one.'); finishStarjack(g); }
}
// A cheat: draw the best card for your hand.
export function bestCard(g) {
  const need = 21 - handTotal(g.you);
  if (need === 11) return 'ace';
  if (need >= 10) return '10';
  if (need <= 1) return 'ace';
  return String(need);
}
export function starjackStand(g) {
  g.lines = [`You stand at ${handTotal(g.you)}.`];
  finishStarjack(g);
}
export function finishStarjack(g, opening) {
  const lines = opening ? [...g.lines, opening] : [...g.lines];
  while (handTotal(g.dealer) < 17) g.dealer.push(draw());
  const y = handTotal(g.you), d = handTotal(g.dealer);
  lines.push(`The dealer has ${handText(g.dealer)}.`);
  if (d > 21 || y > d) { g.result = y === 21 && g.you.length === 2 ? 'starjack' : 'win'; lines.push(`You win ${g.result === 'starjack' ? Math.round(g.bet * 1.5) : g.bet}.`); }
  else if (y === d) { g.result = 'push'; lines.push('A tie. Your bet comes back.'); }
  else { g.result = 'lose'; lines.push(`You lose ${g.bet}.`); }
  g.over = true;
  g.lines = lines;
}

// ---------- Void Dice ----------
export function startDice(bet) {
  return { game: 'dice', bet, total: 0, over: false, lines: ['Roll as often as you dare. A 1 busts you. When you stop, the house must beat your total.'] };
}
export function diceRoll(g) {
  const r = rint(1, 6);
  if (r === 1) { g.total = 0; g.over = true; g.result = 'lose'; g.lines = [`You roll a 1. Bust! You lose ${g.bet}.`]; return; }
  g.total += r;
  g.lines = [`You roll a ${r}. Your total is ${g.total}.`];
}
export function diceStop(g) {
  let h = 0;
  const rolls = [];
  while (h <= g.total) {
    const r = rint(1, 6);
    rolls.push(r);
    if (r === 1) { h = -1; break; }
    h += r;
  }
  g.over = true;
  if (h < 0) { g.result = 'win'; g.lines = [`You stop at ${g.total}. The house rolls ${rolls.join(', ')} and busts. You win ${g.bet}.`]; }
  else { g.result = 'lose'; g.lines = [`You stop at ${g.total}. The house rolls ${rolls.join(', ')} for ${h}. You lose ${g.bet}.`]; }
}

// ---------- Pit fights ----------
export const PIT_TIERS = [
  { name: 'a dockhand brawler', fee: 50, purse: 150, skill: 1 },
  { name: 'a scarred mercenary', fee: 150, purse: 450, skill: 3 },
  { name: 'the reigning pit champion', fee: 400, purse: 1400, skill: 5 },
];
const MOVES = ['strike', 'guard', 'feint'];
const BEATS = { strike: 'feint', guard: 'strike', feint: 'guard' };
export function startPit(tier) {
  const t = PIT_TIERS[tier];
  return { game: 'pit', tier, bet: t.fee, you: 3, them: 3, over: false, lines: [`You step into the pit against ${t.name}. Strike beats feint, guard beats strike, feint beats guard.`] };
}
export function pitRound(g, move, dueling) {
  const t = PIT_TIERS[g.tier];
  const theirs = MOVES[rint(0, 2)];
  let youWin;
  if (BEATS[move] === theirs) youWin = true;
  else if (BEATS[theirs] === move) youWin = false;
  else youWin = Math.random() < Math.max(0.15, Math.min(0.85, 0.5 + 0.06 * (dueling - t.skill)));
  if (youWin) g.them--; else g.you--;
  const lead = `You ${move}, they ${theirs}. ${youWin ? 'You land a blow.' : 'They land a blow.'}`;
  g.lines = [`${lead} You ${g.you}, them ${g.them}.`];
  if (g.them <= 0) { g.over = true; g.result = 'win'; g.lines.push(`You win the fight and the ${t.purse} credit purse!`); }
  else if (g.you <= 0) { g.over = true; g.result = 'lose'; g.lines.push('You go down. The crowd roars for your opponent.'); }
}
