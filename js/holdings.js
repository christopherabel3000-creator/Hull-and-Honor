// Property: warehouses, shares in Guild shipping lines, and your own station.
let api = null; // { state(), galaxy(), news(t), regionTrouble(sysId) }
export function initHoldings(a) { api = a; }

const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export const WAREHOUSE_CAP = 60;
export const MAX_WAREHOUSES = 4;
export const warehouseCost = sys => ({ high: 2500, medium: 2000, low: 1500, none: 1200 }[sys.security]);

export const LINES = {
  core: { name: 'Core Express', desc: 'safe routes in the Core Worlds', vol: 0.03, div: 0.01, crash: 0.01, drift: 0.004 },
  frontier: { name: 'Frontier Freight', desc: 'busy frontier routes, some pirate risk', vol: 0.07, div: 0.022, crash: 0.04, drift: 0.008 },
  rimward: { name: 'Rimward Ventures', desc: 'daring runs into lawless space, high risk and high reward', vol: 0.15, div: 0.04, crash: 0.1, drift: 0.012 },
};

export const STATION_COST = 60000;
export const STATION_UPGRADES = {
  market: { name: 'Market hub', max: 3, cost: l => 8000 * (l + 1), desc: 'more traffic and 500 more income per period for each level' },
  defense: { name: 'Defense grid', max: 3, cost: l => 6000 * (l + 1), desc: 'makes pirate raids less likely' },
  shipyard: { name: 'Private shipyard', max: 1, cost: () => 10000, desc: 'free fuel and repairs for you here' },
};

export function ensureHoldings(st) {
  if (!st.holdings) {
    st.holdings = { warehouses: {}, shares: {}, lines: {}, station: null, lastTick: st.day, pending: [] };
    for (const id of Object.keys(LINES)) st.holdings.lines[id] = { price: 1000, last: 1000 };
  }
}

export function storedUnits(w) { return Object.values(w.goods).reduce((s, n) => s + n, 0); }

// Every 10 days: dividends, share prices, station income and raids, warehouse theft.
export function tickHoldings() {
  const st = api.state(), h = st.holdings, g = api.galaxy();
  while (st.day - h.lastTick >= 10) {
    h.lastTick += 10;
    const trouble = (st.world ? st.world.wars.length : 0) * 0.01 + (st.world ? st.world.events.filter(e => e.type === 'surge').length : 0) * 0.008;
    let dividends = 0;
    for (const [id, line] of Object.entries(LINES)) {
      const L = h.lines[id];
      L.last = L.price;
      let p = L.price * (1 + line.drift - (id === 'core' ? 0 : trouble) + gauss() * line.vol);
      if (Math.random() < line.crash) { p *= 0.6; if (h.shares[id]) h.pending.push(`${line.name} lost ships to pirates and its shares fell sharply.`); else api.news(`${line.name} has lost a convoy. Its share price fell sharply.`); }
      L.price = Math.max(80, Math.round(p));
      const n = h.shares[id] || 0;
      dividends += Math.round(n * L.price * line.div);
    }
    if (dividends) { st.credits += dividends; h.pending.push(`Your shares paid ${dividends} credits in dividends.`); }
    const stn = h.station;
    if (stn) {
      let income = 900 + 500 * stn.upgrades.market;
      if (api.regionTrouble(stn.sys)) income = Math.round(income / 2);
      if (Math.random() < 0.2 - 0.06 * stn.upgrades.defense) {
        const lost = Object.keys(stn.upgrades).filter(k => stn.upgrades[k] > 0 && k !== 'defense');
        let note = '';
        if (lost.length && Math.random() < 0.5) { const k = lost[rint(0, lost.length - 1)]; stn.upgrades[k]--; note = ` They wrecked your ${STATION_UPGRADES[k].name.toLowerCase()}.`; }
        h.pending.push(`Pirates raided ${stn.name}. You lost this period's income.${note}`);
      } else {
        st.credits += income;
        h.pending.push(`${stn.name} earned ${income} credits.`);
      }
    }
    for (const [sid, w] of Object.entries(h.warehouses)) {
      const sys = g.systems[Number(sid)];
      if ((sys.security === 'low' || sys.security === 'none') && storedUnits(w) && Math.random() < 0.12) {
        let stolen = 0;
        for (const gid of Object.keys(w.goods)) { const k = Math.ceil(w.goods[gid] * 0.25); w.goods[gid] -= k; stolen += k; if (w.goods[gid] <= 0) delete w.goods[gid]; }
        h.pending.push(`Thieves broke into your warehouse at ${sys.name} and took ${stolen} units.`);
      }
    }
  }
}

export function takePending() {
  const h = api.state().holdings;
  const p = h.pending;
  h.pending = [];
  return p;
}

export function netWorth() {
  const st = api.state(), h = st.holdings;
  let v = 0;
  for (const [id, n] of Object.entries(h.shares)) v += n * h.lines[id].price;
  if (h.station) v += STATION_COST * 0.6;
  return Math.round(v);
}
