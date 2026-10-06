// Kalshi Killa — position math.
// Money is integer cents. Prices are cents per contract (1–99, may be fractional for averages).
// Every Kalshi contract pays $1.00 (100¢) if it settles in its favor, $0 if not.
// Cost basis uses the average-cost method, the same way Kalshi shows "avg price".

export const PAYOUT_PER_CONTRACT = 100;

export const CATEGORIES = ["Sports", "Politics", "Economics", "Crypto", "Weather", "Culture", "Other"];

const round = (n) => Math.round(n);

/** Total cents moved by a fill. Buy: paid incl. fees. Sell: received after fees. */
export function fillAmount(f) {
  if (Number.isFinite(f.amount)) return round(f.amount);
  const gross = round((Number(f.contracts) || 0) * (Number(f.price) || 0));
  const fees = Number.isFinite(f.fees) ? round(f.fees) : 0;
  return f.kind === "sell" ? gross - fees : gross + fees;
}

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/**
 * Derive everything about one position from its fills and settlement.
 * Returns held contracts, open cost basis, realized P&L and the dated
 * realization events that feed period totals and the chart.
 */
export function summarize(pos) {
  const fills = [...(pos.fills || [])].sort(byTime);
  let held = 0;
  let basis = 0; // cents still at risk in held contracts
  let bought = 0;
  let cost = 0; // all buy cents ever
  let proceeds = 0;
  let realized = 0;
  const events = [];
  const warnings = [];

  for (const f of fills) {
    const c = Number(f.contracts) || 0;
    if (f.kind === "buy") {
      const amt = fillAmount(f);
      held += c;
      bought += c;
      basis += amt;
      cost += amt;
    } else if (f.kind === "sell") {
      let sold = c;
      if (sold > held + 1e-9) {
        warnings.push(`Sold ${c} but only ${held} held`);
        sold = held;
      }
      const amt = fillAmount(f);
      const costOut = held > 0 ? round((basis * sold) / held) : 0;
      const pnl = amt - costOut;
      held -= sold;
      basis -= costOut;
      proceeds += amt;
      realized += pnl;
      events.push({ at: f.at, pnl, costOut, kind: "sell", fillId: f.id });
    }
  }

  let payout = 0;
  const s = pos.settlement;
  if (s && s.result) {
    if (Number.isFinite(s.payout)) payout = round(s.payout);
    else if (s.result === "win") payout = round(held * PAYOUT_PER_CONTRACT);
    else if (s.result === "void") payout = basis;
    else payout = 0;
    const pnl = payout - basis;
    realized += pnl;
    events.push({ at: s.at, pnl, costOut: basis, kind: "settle", result: s.result });
    held = 0;
    basis = 0;
  }

  if (held < 1e-9) held = 0;
  const open = held > 0 && !(s && s.result);
  const status = open ? "open" : fills.length || s ? "closed" : "open";
  const closedAt = status === "closed" && events.length ? events[events.length - 1].at : null;

  let outcome = null; // win | loss | push, for the W-L record
  if (status === "closed") outcome = realized > 0 ? "win" : realized < 0 ? "loss" : "push";

  let how = null; // how it closed, for the history chip
  if (status === "closed") how = s && s.result ? s.result : "sold";

  return {
    held,
    basis,
    avgPrice: held > 0 ? basis / held : bought > 0 ? cost / bought : 0,
    bought,
    cost,
    proceeds,
    payout,
    realized,
    events,
    status,
    outcome,
    how,
    closedAt,
    openedAt: fills.length ? fills[0].at : pos.createdAt,
    maxPayout: open ? held * PAYOUT_PER_CONTRACT : 0,
    toWin: open ? held * PAYOUT_PER_CONTRACT - basis : 0,
    warnings,
  };
}

export function periodStart(period, now = new Date()) {
  const d = new Date(now);
  switch (period) {
    case "today":
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    case "7d":
      return new Date(now.getTime() - 7 * 864e5).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 864e5).toISOString();
    case "ytd":
      return new Date(now.getFullYear(), 0, 1).toISOString();
    default:
      return "";
  }
}

/** Totals for a set of positions over a period (ISO lower bound, "" = all time). */
export function aggregate(positions, from = "") {
  const inRange = (at) => !from || (at && at >= from);
  let pnl = 0;
  let costOut = 0;
  let wagered = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let exposure = 0;
  let maxPayout = 0;
  let openCount = 0;
  const events = [];
  const byCategory = {};
  const closed = [];
  const open = [];

  for (const pos of positions) {
    const sm = summarize(pos);
    for (const f of pos.fills || []) if (f.kind === "buy" && inRange(f.at)) wagered += fillAmount(f);
    for (const e of sm.events) {
      if (!inRange(e.at)) continue;
      pnl += e.pnl;
      costOut += e.costOut;
      events.push({ ...e, posId: pos.id });
      const cat = pos.category || "Other";
      byCategory[cat] = (byCategory[cat] || 0) + e.pnl;
    }
    if (sm.status === "open") {
      openCount += 1;
      exposure += sm.basis;
      maxPayout += sm.maxPayout;
      open.push({ pos, sm });
    } else if (inRange(sm.closedAt)) {
      if (sm.outcome === "win") wins += 1;
      else if (sm.outcome === "loss") losses += 1;
      else pushes += 1;
      closed.push({ pos, sm });
    }
  }

  events.sort(byTime);
  let run = 0;
  const series = events.map((e) => ({ at: e.at, pnl: e.pnl, cum: (run += e.pnl), posId: e.posId }));
  closed.sort((a, b) => (a.sm.closedAt < b.sm.closedAt ? 1 : -1));
  open.sort((a, b) => (a.sm.openedAt < b.sm.openedAt ? 1 : -1));

  return {
    pnl,
    roi: costOut > 0 ? pnl / costOut : null,
    wagered,
    wins,
    losses,
    pushes,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    exposure,
    maxPayout,
    openCount,
    series,
    byCategory,
    closed,
    open,
  };
}

const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 20);
export const newId = uid;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export function sameContract(a, b) {
  return norm(a.market) === norm(b.market) && norm(a.outcome) === norm(b.outcome) && a.side === b.side;
}

/**
 * Turn reviewed trades into position writes.
 * trade: {key, kind, market, outcome, side, category, contracts, price, amount, fees,
 *         result, at, target ("new" | positionId | "new:<key>"), entryPrice, shot}
 * Returns {positions: Map<id, position>, createdIds: Set}.
 */
export function applyTrades(existing, trades, nowIso = new Date().toISOString()) {
  const out = new Map();
  const createdIds = new Set();
  const byKey = new Map();
  const get = (id) => {
    if (out.has(id)) return out.get(id);
    const src = existing.find((p) => p.id === id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    out.set(id, copy);
    return copy;
  };
  const create = (t) => {
    const id = uid();
    const p = {
      id,
      market: t.market.trim(),
      outcome: (t.outcome || "").trim(),
      side: t.side,
      category: t.category || "Other",
      fills: [],
      settlement: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    out.set(id, p);
    createdIds.add(id);
    return p;
  };
  const fill = (t, kind, extra = {}) => ({
    id: uid(),
    kind,
    at: t.at || nowIso,
    contracts: Number(t.contracts) || 0,
    price: Number.isFinite(t.price) ? t.price : null,
    amount: Number.isFinite(t.amount) ? Math.round(t.amount) : null,
    fees: Number.isFinite(t.fees) ? Math.round(t.fees) : null,
    source: t.shot ? "shot" : "manual",
    ...(t.shot ? { shot: t.shot } : {}),
    ...extra,
  });
  const syntheticBuy = (t) => ({
    id: uid(),
    kind: "buy",
    at: new Date(new Date(t.at || nowIso).getTime() - 60000).toISOString(),
    contracts: Number(t.contracts) || 0,
    price: Number(t.entryPrice) || 0,
    amount: Math.round((Number(t.contracts) || 0) * (Number(t.entryPrice) || 0)),
    fees: null,
    source: "entry",
  });

  // Buys first so a sell/settle in the same batch can attach to a new position.
  const order = [...trades].sort((a, b) => (a.kind === "buy" ? -1 : 0) - (b.kind === "buy" ? -1 : 0));
  for (const t of order) {
    let pos = null;
    if (t.target && t.target.startsWith("new:")) pos = byKey.get(t.target.slice(4)) || null;
    else if (t.target && t.target !== "new") pos = get(t.target);

    if (t.kind === "buy") {
      if (!pos) pos = create(t);
      pos.fills.push(fill(t, "buy"));
      byKey.set(t.key, pos);
    } else if (t.kind === "sell") {
      if (!pos) {
        pos = create(t);
        pos.fills.push(syntheticBuy(t));
      }
      pos.fills.push(fill(t, "sell"));
    } else if (t.kind === "settle") {
      if (!pos) {
        pos = create(t);
        pos.fills.push(syntheticBuy(t));
      }
      pos.settlement = {
        result: t.result || "loss",
        at: t.at || nowIso,
        payout: Number.isFinite(t.amount) ? Math.round(t.amount) : null,
        source: t.shot ? "shot" : "manual",
      };
    }
    pos.updatedAt = nowIso;
  }
  return { positions: out, createdIds };
}

// ---------- formatting ----------
export function money(cents, { sign = false } = {}) {
  const v = (cents || 0) / 100;
  const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (!sign) return v < 0 ? "−" + s : s;
  return v > 0 ? "+" + s : v < 0 ? "−" + s : s;
}
export function cents(p) {
  if (!Number.isFinite(p)) return "—";
  const r = Math.round(p * 10) / 10;
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)) + "¢";
}
export function pct(x, { sign = false } = {}) {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = Math.round(x * 1000) / 10;
  return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";
}
