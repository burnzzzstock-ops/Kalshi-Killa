import { config } from "./config.js";
import * as L from "./ledger.js";
import { isConfigured, createFirebaseStore, createDemoStore } from "./store.js";
import { hashFile, readShot, sampleRead } from "./parse.js";
import { samplePositions } from "./sample.js";

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[$,¢\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const pref = {
  get(k, d) {
    try {
      return localStorage.getItem("kk." + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("kk." + k, v);
    } catch {
      /* private mode */
    }
  },
};
const fmtDate = (iso, withTime = false) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const opts = { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) };
  if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString("en-US", opts);
};
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const signClass = (c) => (c > 0 ? "gain" : c < 0 ? "loss" : "flat");
const sideChip = (side) => `<span class="side side-${side === "no" ? "no" : "yes"}">${side === "no" ? "NO" : "YES"}</span>`;
const title = (p) => esc(p.market) + (p.outcome ? ` <span class="sep">·</span> ${esc(p.outcome)}` : "");

const PERIODS = [
  ["today", "Today", "Today"],
  ["7d", "7D", "Last 7 days"],
  ["30d", "30D", "Last 30 days"],
  ["ytd", "YTD", "This year"],
  ["all", "All", "All time"],
];
const HOW_LABEL = { win: "Won", loss: "Lost", void: "Void", sold: "Sold" };

const ICON = {
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  shot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M9 6.5h6M9 10h6M9 13.5h3.5"/><path d="M15.5 16.5v4M13.5 18.5h4"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- state ----------
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const state = {
  store: null,
  user: null,
  positions: [],
  shots: {},
  loaded: false,
  period: pref.get("period", "30d"),
  status: "connecting",
  historyLimit: 20,
  unsub: null,
  agg: null,
};
const app = $("#app");

// ---------- boot ----------
async function boot() {
  registerSW();
  if (DEMO) {
    state.store = createDemoStore(samplePositions());
  } else if (!isConfigured(config)) {
    renderSetupNeeded();
    return;
  } else {
    app.innerHTML = `<div class="center-screen"><div class="spinner" role="status" aria-label="Loading"></div></div>`;
    try {
      state.store = await createFirebaseStore(config);
    } catch {
      renderMessage("Couldn't load", "The app needs a connection the first time it opens. Check your signal and reopen it.");
      return;
    }
  }
  state.store.onAuth((user) => {
    state.user = user;
    if (state.unsub) {
      state.unsub();
      state.unsub = null;
    }
    if (!user) {
      renderSignIn();
      return;
    }
    state.positions = [];
    state.loaded = false;
    renderShell();
    state.unsub = state.store.subscribe({
      onPositions: (p) => {
        state.positions = p;
        state.loaded = true;
        renderMain();
      },
      onShots: (s) => (state.shots = s),
      onStatus: (st) => {
        state.status = st;
        renderStatus();
      },
      onError: (e) => toast(`Sync problem: ${e.code || e.message}. Your data is still saved on this phone.`),
    });
  });
  window.addEventListener("online", renderStatus);
  window.addEventListener("offline", renderStatus);
}

function registerSW() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// ---------- pre-app screens ----------
function brand() {
  return `<div class="brand"><span class="brand-mark" aria-hidden="true">¢</span><span class="brand-name">Kalshi Killa</span></div>`;
}

function renderMessage(head, body) {
  app.innerHTML = `<div class="center-screen"><div class="gate">${brand()}<h1>${esc(head)}</h1><p>${esc(body)}</p></div></div>`;
}

function renderSetupNeeded() {
  app.innerHTML = `
  <div class="center-screen"><div class="gate">
    ${brand()}
    <h1>Almost ready</h1>
    <p>This copy of the app isn't connected to its database yet. Fill in <code>js/config.js</code> using the steps in <code>SETUP.md</code>, then reload.</p>
    <a class="btn primary block" href="?demo">Preview with sample data</a>
  </div></div>`;
}

function renderSignIn(err = "") {
  app.innerHTML = `
  <div class="center-screen"><form class="gate" id="signin" novalidate>
    ${brand()}
    <h1>Sign in</h1>
    <p>Your bets sync to your account, so a new phone picks up right where you left off.</p>
    <label class="field"><span>Email</span><input id="si-email" type="email" autocomplete="username" inputmode="email" required></label>
    <label class="field"><span>Password</span><input id="si-pass" type="password" autocomplete="current-password" required></label>
    <p class="form-err" id="si-err" ${err ? "" : "hidden"}>${esc(err)}</p>
    <button class="btn primary block" type="submit" id="si-go">Sign in</button>
    <button class="btn ghost block" type="button" id="si-reset">Forgot password</button>
  </form></div>`;
  const form = $("#signin");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#si-email").value.trim();
    const pass = $("#si-pass").value;
    if (!email || !pass) return showErr("Enter your email and password.");
    $("#si-go").disabled = true;
    $("#si-go").textContent = "Signing in…";
    try {
      await state.store.signIn(email, pass);
    } catch (ex) {
      const code = ex.code || "";
      showErr(
        code.includes("network")
          ? "No connection. Signing in needs internet the first time."
          : code.includes("too-many")
            ? "Too many tries. Wait a minute and try again."
            : "That email and password don't match an account.",
      );
      $("#si-go").disabled = false;
      $("#si-go").textContent = "Sign in";
    }
  });
  $("#si-reset").addEventListener("click", async () => {
    const email = $("#si-email").value.trim();
    if (!email) return showErr("Type your email above, then tap Forgot password.");
    try {
      await state.store.resetPassword(email);
      showErr(`Reset link sent to ${email}.`, true);
    } catch {
      showErr("Couldn't send the reset email. Check the address.");
    }
  });
  function showErr(msg, ok = false) {
    const el = $("#si-err");
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("ok", ok);
  }
}

// ---------- main shell ----------
function renderShell() {
  app.innerHTML = `
  ${DEMO ? `<div class="demo-strip">Sample data. Nothing here is real and nothing is saved.</div>` : ""}
  <header class="top">
    ${brand()}
    <div class="sync" id="sync" role="status"></div>
    <button class="icon-btn" id="btn-settings" aria-label="Settings and backup">${ICON.gear}</button>
  </header>
  <main class="wrap" id="main">
    <nav class="periods" id="periods" aria-label="Time period">
      ${PERIODS.map(([k, short]) => `<button type="button" data-period="${k}" aria-pressed="${k === state.period}">${short}</button>`).join("")}
    </nav>
    <section class="hero" id="hero" aria-live="polite"></section>
    <section class="chart-block" id="chart"></section>
    <section class="block" id="open"></section>
    <section class="block" id="history"></section>
    <section class="block" id="cats"></section>
    <p class="foot">Each contract pays $1.00 if it hits. P&amp;L uses your average price, the same way Kalshi shows it.</p>
  </main>
  <div class="actionbar">
    <button class="btn primary" id="btn-shot">${ICON.shot}<span>Add screenshot</span></button>
    <button class="btn" id="btn-manual">${ICON.pen}<span>By hand</span></button>
  </div>`;

  $("#periods").addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    state.period = b.dataset.period;
    state.historyLimit = 20;
    pref.set("period", state.period);
    $$("#periods button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderMain();
  });
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-shot").addEventListener("click", () => $("#shot-input").click());
  $("#btn-manual").addEventListener("click", () => openReview({ items: [blankItem("buy")], title: "Enter a bet" }));
  $("#main").addEventListener("click", onMainClick);
  renderStatus();
  renderMain();

  const ro = new ResizeObserver(() => state.agg && renderChart(state.agg));
  ro.observe($("#chart"));
}

function renderStatus() {
  const el = $("#sync");
  if (!el) return;
  let st = state.status;
  if (!navigator.onLine && st !== "sample") st = "offline";
  const label = {
    synced: "Synced",
    syncing: "Syncing",
    connecting: "Connecting",
    offline: "Offline · saved on phone",
    sample: "Sample",
  }[st];
  el.className = "sync sync-" + st;
  el.innerHTML = `<i aria-hidden="true"></i>${label}`;
}

function renderMain() {
  if (!$("#hero")) return;
  const from = L.periodStart(state.period);
  const agg = L.aggregate(state.positions, from);
  state.agg = agg;
  renderHero(agg);
  renderChart(agg);
  renderOpen(agg);
  renderHistory(agg);
  renderCats(agg);
}

function renderHero(agg) {
  const label = PERIODS.find((p) => p[0] === state.period)[2];
  const rec = agg.wins + agg.losses + agg.pushes ? `${agg.wins}–${agg.losses}${agg.pushes ? "–" + agg.pushes : ""}` : "—";
  $("#hero").innerHTML = `
    <div class="hero-label">Profit &amp; loss <span class="dim">· ${esc(label)}</span></div>
    <div class="hero-num ${signClass(agg.pnl)}">${!state.loaded && !DEMO ? "&nbsp;" : L.money(agg.pnl, { sign: true })}</div>
    <dl class="stats">
      <div><dt>Record</dt><dd>${rec}</dd></div>
      <div><dt>Win rate</dt><dd>${L.pct(agg.winRate)}</dd></div>
      <div><dt>ROI</dt><dd class="${agg.roi == null ? "" : signClass(agg.roi)}">${L.pct(agg.roi, { sign: true })}</dd></div>
      <div><dt>Staked</dt><dd>${L.money(agg.wagered)}</dd></div>
    </dl>`;
}

// ---------- chart ----------
function niceStep(range) {
  const raw = range / 3;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const shortMoney = (c) => {
  const v = c / 100;
  const a = Math.abs(v);
  const s = a >= 1000 ? "$" + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : "$" + (Number.isInteger(a) ? a : a.toFixed(a < 10 ? 2 : 0));
  return (v < 0 ? "−" : "") + s;
};

function renderChart(agg) {
  const host = $("#chart");
  if (!host) return;
  const series = agg.series;
  if (!state.loaded && !DEMO) {
    host.innerHTML = `<div class="chart-empty">Loading your bets…</div>`;
    return;
  }
  if (!state.positions.length) {
    host.innerHTML = `
      <div class="howto">
        <h2>How it works</h2>
        <ol>
          <li><b>Screenshot</b> the Kalshi order screen after you buy.</li>
          <li>Tap <b>Add screenshot</b>. The app reads the bet; you check the numbers and save.</li>
          <li>When it settles, tap <b>Won</b> or <b>Lost</b>. Sold early? Add that screenshot too.</li>
        </ol>
      </div>`;
    return;
  }
  if (!series.length) {
    host.innerHTML = `<div class="chart-empty">No bets settled or sold in this period.</div>`;
    return;
  }

  const W = Math.max(280, host.clientWidth || 340);
  const H = 176;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const from = L.periodStart(state.period);
  const tFirst = Date.parse(series[0].at);
  const t0 = from ? Date.parse(from) : tFirst - Math.max(3600e3, (Date.now() - tFirst) * 0.03);
  const t1 = Math.max(Date.now(), Date.parse(series[series.length - 1].at));
  const pts = series.map((s) => ({ t: Date.parse(s.at), v: s.cum, pnl: s.pnl, posId: s.posId, at: s.at }));
  let lo = Math.min(0, ...pts.map((p) => p.v));
  let hi = Math.max(0, ...pts.map((p) => p.v));
  if (hi - lo < 100) hi = lo + 100;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const y0 = y(0);

  let line = `M${x(t0).toFixed(1)},${y0.toFixed(1)}`;
  for (const p of pts) line += `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`;
  line += `H${x(t1).toFixed(1)}`;
  const area = `${line}V${y0.toFixed(1)}H${x(t0).toFixed(1)}Z`;

  const ticks = [];
  for (let v = lo; v <= hi + 1e-6; v += step) ticks.push(v);
  const last = pts[pts.length - 1];
  const lx = x(t1);
  const ly = y(last.v);

  host.innerHTML = `
    <div class="chart-head"><span>Running total</span><span class="dim">${esc(fmtDate(new Date(t0).toISOString()))} – now</span></div>
    <div class="chart-box">
      <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Running profit and loss, now ${esc(L.money(last.v, { sign: true }))}">
        <defs>
          <clipPath id="clip-up"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath>
          <clipPath id="clip-dn"><rect x="0" y="${y0}" width="${W}" height="${H - y0}"/></clipPath>
        </defs>
        ${ticks
          .map(
            (v) => `<line class="grid${v === 0 ? " zero" : ""}" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
          <text class="tick" x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${shortMoney(v)}</text>`,
          )
          .join("")}
        <path class="area-up" d="${area}" clip-path="url(#clip-up)"/>
        <path class="area-dn" d="${area}" clip-path="url(#clip-dn)"/>
        <path class="line" d="${line}"/>
        <circle class="end ${signClass(last.v)}" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5"/>
        <line class="cross" id="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
        <circle class="hot" id="hot" r="5" cx="0" cy="0" visibility="hidden"/>
        <text class="tick" x="${padL}" y="${H - 8}">${esc(fmtDate(new Date(t0).toISOString()))}</text>
        <text class="tick" x="${W - padR}" y="${H - 8}" text-anchor="end">Today</text>
        <rect id="hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
      </svg>
      <div class="tip" id="tip" hidden></div>
    </div>`;

  const svg = $("svg", host);
  const tip = $("#tip", host);
  const cross = $("#cross", host);
  const hot = $("#hot", host);
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    const bx = x(best.t);
    const by = y(best.v);
    cross.setAttribute("x1", bx);
    cross.setAttribute("x2", bx);
    cross.setAttribute("visibility", "visible");
    hot.setAttribute("cx", bx);
    hot.setAttribute("cy", by);
    hot.setAttribute("visibility", "visible");
    const pos = state.positions.find((q) => q.id === best.posId);
    tip.innerHTML = `<div class="tip-date">${esc(fmtDate(best.at, true))}</div>
      <div class="tip-row"><span>This bet</span><b class="${signClass(best.pnl)}">${L.money(best.pnl, { sign: true })}</b></div>
      <div class="tip-row"><span>Running</span><b>${L.money(best.v, { sign: true })}</b></div>
      ${pos ? `<div class="tip-mkt">${esc(pos.market)}${pos.outcome ? " · " + esc(pos.outcome) : ""}</div>` : ""}`;
    tip.hidden = false;
    const left = (bx / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 90), r.width - 90) + "px";
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    hot.setAttribute("visibility", "hidden");
  };
  const hit = $("#hit", host);
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
}

// ---------- open bets ----------
function renderOpen(agg) {
  const host = $("#open");
  if (!agg.open.length) {
    host.innerHTML = state.positions.length
      ? `<div class="block-head"><h2>Open bets</h2></div><p class="empty">Nothing open. Add a screenshot after your next buy.</p>`
      : "";
    return;
  }
  host.innerHTML = `
    <div class="block-head">
      <h2>Open bets <span class="count">${agg.open.length}</span></h2>
      <div class="block-sub">${L.money(agg.exposure)} in · pays ${L.money(agg.maxPayout)} if all hit</div>
    </div>
    <div class="tickets">${agg.open.map(({ pos, sm }) => ticket(pos, sm)).join("")}</div>`;
}

function ticket(pos, sm) {
  return `
  <article class="ticket" data-id="${esc(pos.id)}">
    <button type="button" class="ticket-top" data-detail="${esc(pos.id)}">
      <span class="t-meta">${esc(pos.category || "Other")} · ${esc(fmtDate(sm.openedAt))}</span>
      <span class="t-title">${esc(pos.market)}</span>
      <span class="t-pick">${sideChip(pos.side)}<span>${esc(pos.outcome || (pos.side === "no" ? "No" : "Yes"))}</span></span>
    </button>
    <div class="perf" aria-hidden="true"></div>
    <div class="t-nums">
      <div><span class="k">Contracts</span><span class="v">${fmtQty(sm.held)} @ ${L.cents(sm.avgPrice)}</span></div>
      <div><span class="k">In</span><span class="v">${L.money(sm.basis)}</span></div>
      <div><span class="k">Pays</span><span class="v">${L.money(sm.maxPayout)}</span></div>
    </div>
    <div class="t-actions">
      <button type="button" class="settle won" data-settle="win" data-id="${esc(pos.id)}">Won <span>${L.money(sm.toWin, { sign: true })}</span></button>
      <button type="button" class="settle lost" data-settle="loss" data-id="${esc(pos.id)}">Lost <span>${L.money(-sm.basis, { sign: true })}</span></button>
    </div>
  </article>`;
}
const fmtQty = (n) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2));

// ---------- history ----------
function renderHistory(agg) {
  const host = $("#history");
  const rows = agg.closed;
  if (!rows.length) {
    host.innerHTML = "";
    return;
  }
  const shown = rows.slice(0, state.historyLimit);
  host.innerHTML = `
    <div class="block-head"><h2>Closed <span class="count">${rows.length}</span></h2></div>
    <ul class="hist">
      ${shown
        .map(
          ({ pos, sm }) => `
        <li><button type="button" class="hist-row" data-detail="${esc(pos.id)}">
          <span class="h-main">
            <span class="h-title">${title(pos)}</span>
            <span class="h-meta">${sideChip(pos.side)}<span class="chip chip-${sm.how}">${HOW_LABEL[sm.how]}</span><span class="dim">${esc(fmtDate(sm.closedAt))}</span></span>
          </span>
          <span class="h-pnl ${signClass(sm.realized)}">${L.money(sm.realized, { sign: true })}</span>
        </button></li>`,
        )
        .join("")}
    </ul>
    ${rows.length > shown.length ? `<button type="button" class="btn ghost block" data-more>Show ${Math.min(20, rows.length - shown.length)} more</button>` : ""}`;
}

// ---------- by category ----------
function renderCats(agg) {
  const host = $("#cats");
  const entries = Object.entries(agg.byCategory).filter(([, v]) => v !== 0);
  if (entries.length < 2) {
    host.innerHTML = "";
    return;
  }
  entries.sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => Math.abs(v)));
  host.innerHTML = `
    <div class="block-head"><h2>By category</h2></div>
    <ul class="cats">
      ${entries
        .map(
          ([k, v]) => `<li>
          <span class="c-name">${esc(k)}</span>
          <span class="c-track"><span class="c-bar ${signClass(v)}" style="--w:${((Math.abs(v) / max) * 50).toFixed(1)}%"></span></span>
          <span class="c-val ${signClass(v)}">${L.money(v, { sign: true })}</span>
        </li>`,
        )
        .join("")}
    </ul>`;
}

// ---------- main clicks ----------
function onMainClick(e) {
  const s = e.target.closest("[data-settle]");
  if (s) return settle(s.dataset.id, s.dataset.settle);
  const d = e.target.closest("[data-detail]");
  if (d) return openDetail(d.dataset.detail);
  if (e.target.closest("[data-more]")) {
    state.historyLimit += 20;
    renderHistory(state.agg);
  }
}

// ---------- writes with undo ----------
function write(changed, removed = []) {
  const before = new Map();
  for (const pos of changed) before.set(pos.id, clone(state.positions.find((p) => p.id === pos.id)) || null);
  for (const id of removed) before.set(id, clone(state.positions.find((p) => p.id === id)) || null);
  // Optimistic local update so the screen never waits on the network.
  const ids = new Set([...changed.map((p) => p.id), ...removed]);
  state.positions = [...state.positions.filter((p) => !ids.has(p.id)), ...changed.map(clone)];
  renderMain();
  for (const pos of changed) state.store.put(pos).catch(writeFailed);
  for (const id of removed) state.store.remove(id).catch(writeFailed);
  return () => {
    const restore = [];
    const drop = [];
    for (const [id, prev] of before) prev ? restore.push(prev) : drop.push(id);
    write(restore, drop);
  };
}
function writeFailed(e) {
  toast(`Couldn't save to the cloud (${e.code || e.message}). Sign out and back in, then try again.`);
}

function settle(id, result) {
  const pos = clone(state.positions.find((p) => p.id === id));
  if (!pos) return;
  pos.settlement = { result, at: new Date().toISOString(), payout: null, source: "tap" };
  pos.updatedAt = new Date().toISOString();
  const pnl = L.summarize(pos).realized;
  const undo = write([pos]);
  closeSheet();
  toast(`${HOW_LABEL[result]} · ${pos.outcome || pos.market} · ${L.money(pnl, { sign: true })}`, { label: "Undo", fn: undo });
}

// ---------- sheets ----------
let sheetCleanup = null;
function openSheet(html, { onMount, wide = false, label = "Details" } = {}) {
  closeSheet(true);
  const root = $("#sheet-root");
  root.innerHTML = `<div class="scrim" data-close></div><div class="sheet${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  document.body.classList.add("sheet-open");
  const onKey = (e) => e.key === "Escape" && closeSheet();
  document.addEventListener("keydown", onKey);
  root.addEventListener("click", onScrim);
  sheetCleanup = () => document.removeEventListener("keydown", onKey);
  requestAnimationFrame(() => root.classList.add("on"));
  if (onMount) onMount($(".sheet", root));
}
function onScrim(e) {
  if (e.target.closest("[data-close]")) closeSheet();
}
function closeSheet(immediate = false) {
  const root = $("#sheet-root");
  if (!root.innerHTML) return;
  if (sheetCleanup) sheetCleanup();
  sheetCleanup = null;
  root.removeEventListener("click", onScrim);
  document.body.classList.remove("sheet-open");
  if (immediate) {
    root.classList.remove("on");
    root.innerHTML = "";
    return;
  }
  root.classList.remove("on");
  setTimeout(() => {
    if (!root.classList.contains("on")) root.innerHTML = "";
  }, 220);
}
const sheetHead = (t, sub = "") =>
  `<div class="sheet-head"><div><h2>${t}</h2>${sub ? `<div class="sheet-sub">${sub}</div>` : ""}</div><button type="button" class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>`;

// ---------- detail ----------
function openDetail(id) {
  const pos = state.positions.find((p) => p.id === id);
  if (!pos) return;
  const sm = L.summarize(pos);
  const fills = [...(pos.fills || [])].sort((a, b) => (a.at < b.at ? -1 : 1));
  const s = pos.settlement;
  const open = sm.status === "open";
  const html = `
    ${sheetHead(title(pos), `${sideChip(pos.side)} ${esc(pos.category || "Other")}`)}
    <div class="sheet-body">
      <dl class="d-stats">
        ${
          open
            ? `<div><dt>Held</dt><dd>${fmtQty(sm.held)}</dd></div>
               <div><dt>Avg price</dt><dd>${L.cents(sm.avgPrice)}</dd></div>
               <div><dt>In</dt><dd>${L.money(sm.basis)}</dd></div>
               <div><dt>Pays</dt><dd>${L.money(sm.maxPayout)}</dd></div>`
            : `<div><dt>Result</dt><dd>${HOW_LABEL[sm.how]}</dd></div>
               <div><dt>Staked</dt><dd>${L.money(sm.cost)}</dd></div>
               <div><dt>Got back</dt><dd>${L.money(sm.proceeds + sm.payout)}</dd></div>
               <div><dt>P&amp;L</dt><dd class="${signClass(sm.realized)}">${L.money(sm.realized, { sign: true })}</dd></div>`
        }
      </dl>
      ${open && sm.realized ? `<p class="note">Already locked in from partial sales: <b class="${signClass(sm.realized)}">${L.money(sm.realized, { sign: true })}</b></p>` : ""}
      ${sm.warnings.map((w) => `<p class="note warn">${esc(w)}. Check the contract counts.</p>`).join("")}
      <h3 class="mini">Activity</h3>
      <ol class="fills">
        ${fills
          .map(
            (f) => `<li><button type="button" class="fill-row" data-edit-fill="${esc(f.id)}">
              <span class="f-kind f-${f.kind}">${f.kind === "buy" ? (f.source === "entry" ? "Entry" : "Buy") : "Sell"}</span>
              <span class="f-main">${fmtQty(Number(f.contracts) || 0)} @ ${L.cents(Number.isFinite(f.price) ? f.price : L.fillAmount(f) / (Number(f.contracts) || 1))}</span>
              <span class="f-amt">${L.money(L.fillAmount(f))}</span>
              <span class="f-date">${esc(fmtDate(f.at, true))}</span>
            </button></li>`,
          )
          .join("")}
        ${
          s && s.result
            ? `<li><button type="button" class="fill-row" data-edit-fill="settlement">
                <span class="f-kind f-settle">${HOW_LABEL[s.result]}</span>
                <span class="f-main">Settled</span>
                <span class="f-amt">${L.money(sm.payout)}</span>
                <span class="f-date">${esc(fmtDate(s.at, true))}</span>
              </button></li>`
            : ""
        }
      </ol>
      <p class="hint">Tap a line to fix it.</p>
    </div>
    <div class="sheet-foot stack">
      ${
        open
          ? `<div class="row3">
              <button type="button" class="btn won" data-act="win">Won</button>
              <button type="button" class="btn lost" data-act="loss">Lost</button>
              <button type="button" class="btn" data-act="void">Void</button>
            </div>
            <div class="row2">
              <button type="button" class="btn" data-act="sell">Record a sale</button>
              <button type="button" class="btn" data-act="add">Add to bet</button>
            </div>`
          : s && s.result
            ? `<button type="button" class="btn block" data-act="reopen">Undo settlement</button>`
            : ""
      }
      <button type="button" class="btn ghost danger block" data-act="delete">Delete this bet</button>
    </div>`;
  openSheet(html, {
    label: pos.market,
    onMount: (sheet) => {
      sheet.addEventListener("click", (e) => {
        const ef = e.target.closest("[data-edit-fill]");
        if (ef) return editEntry(pos.id, ef.dataset.editFill);
        const a = e.target.closest("[data-act]");
        if (!a) return;
        const act = a.dataset.act;
        if (["win", "loss", "void"].includes(act)) return settle(pos.id, act);
        if (act === "reopen") {
          const p = clone(pos);
          p.settlement = null;
          p.updatedAt = new Date().toISOString();
          const undo = write([p]);
          closeSheet();
          toast("Settlement removed. The bet is open again.", { label: "Undo", fn: undo });
        }
        if (act === "sell") {
          const it = blankItem("sell");
          Object.assign(it, { market: pos.market, outcome: pos.outcome, side: pos.side, category: pos.category, target: pos.id, contracts: String(sm.held) });
          openReview({ items: [it], title: "Record a sale" });
        }
        if (act === "add") {
          const it = blankItem("buy");
          Object.assign(it, { market: pos.market, outcome: pos.outcome, side: pos.side, category: pos.category, target: pos.id });
          openReview({ items: [it], title: "Add to this bet" });
        }
        if (act === "delete") {
          if (a.dataset.armed) {
            const undo = write([], [pos.id]);
            closeSheet();
            toast("Bet deleted.", { label: "Undo", fn: undo });
          } else {
            a.dataset.armed = "1";
            a.textContent = "Tap again to delete";
          }
        }
      });
    },
  });
}

// ---------- review (screenshots, manual entry, edits) ----------
let R = null;

function blankItem(kind = "buy") {
  return {
    key: L.newId(),
    kind,
    market: "",
    outcome: "",
    side: "yes",
    category: "Sports",
    contracts: "",
    price: "",
    total: "",
    fees: "",
    result: kind === "settle" ? "win" : "",
    at: toLocalInput(new Date()),
    target: "new",
    entryPrice: "",
    include: true,
    confidence: "high",
    note: "",
    flags: [],
    hash: null,
    shotLabel: "",
  };
}

function fromParsed(t, { hash, shotLabel, dup }) {
  const it = blankItem(["buy", "sell", "settle"].includes(t.kind) ? t.kind : "buy");
  const d = t.datetime ? new Date(t.datetime) : null;
  const money2 = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : "");
  Object.assign(it, {
    market: t.market || "",
    outcome: t.outcome || "",
    side: t.side === "no" ? "no" : "yes",
    category: L.CATEGORIES.includes(t.category) ? t.category : "Other",
    contracts: Number.isFinite(t.contracts) ? String(t.contracts) : "",
    price: Number.isFinite(t.price_cents) ? String(t.price_cents) : "",
    total: money2(t.total_usd),
    fees: money2(t.fees_usd),
    result: ["win", "loss", "void"].includes(t.result) ? t.result : t.kind === "settle" ? (t.total_usd > 0 ? "win" : "loss") : "",
    at: d && !isNaN(d) ? toLocalInput(d) : toLocalInput(new Date()),
    confidence: t.confidence || "medium",
    note: t.note || "",
    hash,
    shotLabel,
    matchId: t.match_id || null,
    alreadyTracked: Boolean(t.already_tracked),
  });
  if (dup) {
    it.include = false;
    it.flags.push(`You already added this screenshot on ${fmtDate(dup.at)}. Skipped so it isn't counted twice.`);
  } else if (it.alreadyTracked) {
    it.include = false;
    it.flags.push("This looks like a bet you're already tracking. Skipped.");
  }
  if (it.confidence === "low") it.flags.push("Hard to read. Double-check the numbers.");
  return it;
}

function openPositions() {
  return state.positions.map((pos) => ({ pos, sm: L.summarize(pos) })).filter((x) => x.sm.status === "open");
}

function autoTarget(items) {
  const open = openPositions();
  for (const it of items) {
    if (it.target !== "new") continue;
    const m = it.matchId && open.find((o) => o.pos.id === it.matchId);
    if (m) {
      it.target = m.pos.id;
      continue;
    }
    const same = open.find((o) => L.sameContract(o.pos, it));
    if (same) {
      it.target = same.pos.id;
      continue;
    }
    if (it.kind !== "buy") {
      const sib = items.find((b) => b !== it && b.kind === "buy" && b.target === "new" && L.sameContract(b, it));
      if (sib) it.target = "new:" + sib.key;
    }
  }
}

function openReview({ items, title: t = "Check and save", warnings = [], hashes = [], edit = null }) {
  autoTarget(items);
  R = { items, warnings, hashes, edit, errors: {} };
  const sub = edit ? "" : items.length > 1 ? `${items.length} trades found` : "";
  openSheet(
    `${sheetHead(esc(t), sub)}
     <div class="sheet-body" id="rv-body"></div>
     <div class="sheet-foot">
       <div class="rv-impact" id="rv-impact"></div>
       <button type="button" class="btn primary block" id="rv-save">${edit ? "Save changes" : "Save"}</button>
     </div>`,
    {
      wide: true,
      label: t,
      onMount: (sheet) => {
        renderReview();
        const body = $("#rv-body", sheet);
        body.addEventListener("input", onReviewInput);
        body.addEventListener("change", onReviewInput);
        body.addEventListener("click", onReviewClick);
        $("#rv-save", sheet).addEventListener("click", saveReview);
      },
    },
  );
}

function targetOptions(it) {
  const open = openPositions();
  const opts = [];
  if (it.kind === "buy") opts.push(["new", "New bet"]);
  for (const { pos, sm } of open) {
    opts.push([pos.id, `${pos.market}${pos.outcome ? " · " + pos.outcome : ""} · ${pos.side.toUpperCase()} · ${fmtQty(sm.held)} held`]);
  }
  if (it.kind !== "buy") {
    for (const b of R.items) if (b !== it && b.kind === "buy" && b.target === "new" && b.include) opts.push(["new:" + b.key, `${b.market || "New bet"} (from this batch)`]);
    opts.push(["new", "Not tracked yet (enter what you paid)"]);
  }
  return opts;
}

function reviewCard(it, i) {
  const err = R.errors[it.key];
  const isEdit = Boolean(R.edit);
  const seg = (name, val, options) =>
    `<div class="seg" role="group">${options
      .map(([v, l]) => `<button type="button" data-seg="${name}" data-i="${i}" data-v="${v}" aria-pressed="${val === v}">${l}</button>`)
      .join("")}</div>`;
  const field = (label, f, val, { type = "text", mode = "decimal", ph = "", cls = "" } = {}) =>
    `<label class="field ${cls}"><span>${label}</span><input id="rv-${f}-${it.key}" data-f="${f}" data-i="${i}" type="${type}" ${type === "text" && mode ? `inputmode="${mode}"` : ""} value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
  const tOpts = targetOptions(it);
  const needsEntry = it.kind !== "buy" && it.target === "new";
  const calc = calcHint(it);
  return `
  <div class="rv-card${it.include ? "" : " skipped"}${err ? " invalid" : ""}" data-card="${i}">
    <div class="rv-top">
      ${it.shotLabel ? `<span class="rv-shot">${esc(it.shotLabel)}</span>` : ""}
      ${isEdit && R.edit.part === "fill" ? `<span class="rv-shot">${it.kind === "buy" ? "Buy" : "Sale"}</span>` : isEdit && R.edit.part === "settlement" ? "" : seg("kind", it.kind, [["buy", "Buy"], ["sell", "Sold"], ["settle", "Settled"]])}
      ${!isEdit && R.items.length > 1 ? `<label class="incl"><input type="checkbox" data-f="include" data-i="${i}" ${it.include ? "checked" : ""}> Include</label>` : ""}
    </div>
    ${it.flags.map((f) => `<p class="note warn">${esc(f)}</p>`).join("")}
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}
    ${err ? `<p class="note bad">${esc(err)}</p>` : ""}
    <div class="grid2">
      ${field("Market", "market", it.market, { mode: "", ph: "Chiefs vs Raiders", cls: "span2" })}
      ${field("Pick", "outcome", it.outcome, { mode: "", ph: "Chiefs, Over 47.5…", cls: "span2" })}
    </div>
    <div class="grid2">
      <div class="field"><span>Side</span>${seg("side", it.side, [["yes", "YES"], ["no", "NO"]])}</div>
      <label class="field"><span>Category</span><select id="rv-cat-${it.key}" data-f="category" data-i="${i}">${L.CATEGORIES.map((c) => `<option ${c === it.category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div>
    ${
      it.kind === "settle"
        ? `<div class="field"><span>Result</span>${seg("result", it.result, [["win", "Won"], ["loss", "Lost"], ["void", "Void"]])}</div>
           <div class="grid2">${field("Payout $", "total", it.total, { ph: calc.payoutPh })}${needsEntry ? field("Contracts", "contracts", it.contracts, { ph: "25" }) : ""}</div>`
        : `<div class="grid4">
            ${field("Contracts", "contracts", it.contracts, { ph: "25" })}
            ${field("Price ¢", "price", it.price, { ph: "62" })}
            ${field(it.kind === "sell" ? "Got $" : "Paid $", "total", it.total, { ph: calc.totalPh })}
            ${field("Fees $", "fees", it.fees, { ph: "0.00" })}
          </div>`
    }
    ${needsEntry ? `<div class="grid2">${field("You paid ¢ each", "entryPrice", it.entryPrice, { ph: "45" })}<p class="hint inline">Needed to work out profit on a bet bought before you started tracking.</p></div>` : ""}
    <label class="field"><span>When</span><input id="rv-at-${it.key}" data-f="at" data-i="${i}" type="datetime-local" value="${esc(it.at)}"></label>
    ${
      isEdit
        ? ""
        : `<label class="field"><span>${it.kind === "buy" ? "Goes to" : "Which bet"}</span><select id="rv-target-${it.key}" data-f="target" data-i="${i}">${tOpts
            .map(([v, l]) => `<option value="${esc(v)}" ${v === it.target ? "selected" : ""}>${esc(l)}</option>`)
            .join("")}</select></label>`
    }
    <p class="calc">${calc.line}</p>
  </div>`;
}

function calcHint(it) {
  const c = num(it.contracts);
  const p = num(it.price);
  const fees = num(it.fees) || 0;
  const out = { totalPh: "", payoutPh: "", line: "" };
  if (c && p) {
    const gross = (c * p) / 100;
    out.totalPh = (it.kind === "sell" ? gross - fees : gross + fees).toFixed(2);
  }
  if (it.kind === "buy" && c) {
    const paid = num(it.total) ?? (p ? (c * p) / 100 + fees : null);
    if (paid != null) out.line = `Pays ${L.money(c * 100)} if it hits · profit ${L.money(Math.round(c * 100 - paid * 100), { sign: true })}`;
  }
  if (it.kind === "settle") {
    let held = num(it.contracts);
    if (it.target && it.target !== "new" && !it.target.startsWith("new:")) {
      const pos = state.positions.find((q) => q.id === it.target);
      if (pos) held = L.summarize(pos).held;
    }
    if (held) out.payoutPh = it.result === "win" ? (held).toFixed(2) : it.result === "loss" ? "0.00" : "";
  }
  return out;
}

function renderReview() {
  const body = $("#rv-body");
  if (!body) return;
  body.innerHTML = `
    ${R.warnings.map((w) => `<p class="note warn">${esc(w)}</p>`).join("")}
    ${R.items.map(reviewCard).join("")}
    ${R.edit ? "" : `<button type="button" class="btn ghost block" data-add-item>+ Add another trade</button>`}`;
  renderImpact();
}

function renderCard(i) {
  const el = $(`[data-card="${i}"]`);
  if (!el) return renderReview();
  const focusId = document.activeElement && document.activeElement.id;
  const tmp = document.createElement("div");
  tmp.innerHTML = reviewCard(R.items[i], i);
  el.replaceWith(tmp.firstElementChild);
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  renderImpact();
}

function onReviewInput(e) {
  const el = e.target;
  const i = Number(el.dataset.i);
  const f = el.dataset.f;
  if (!f || !R.items[i]) return;
  const it = R.items[i];
  it[f] = el.type === "checkbox" ? el.checked : el.value;
  delete R.errors[it.key];
  const structural = ["target", "include"].includes(f);
  if (structural && e.type === "change") {
    if (f === "include") renderReview();
    else renderCard(i);
  } else if (e.type === "input" && ["contracts", "price", "total", "fees"].includes(f)) {
    const card = $(`[data-card="${i}"]`);
    const calc = calcHint(it);
    const calcEl = $(".calc", card);
    if (calcEl) calcEl.innerHTML = calc.line;
    const tot = card && $(`[data-f="total"]`, card);
    if (tot) tot.placeholder = it.kind === "settle" ? calc.payoutPh : calc.totalPh;
    renderImpact();
  }
}

function onReviewClick(e) {
  const sg = e.target.closest("[data-seg]");
  if (sg) {
    const it = R.items[Number(sg.dataset.i)];
    it[sg.dataset.seg] = sg.dataset.v;
    if (sg.dataset.seg === "kind") {
      if (it.kind === "settle" && !it.result) it.result = "win";
      if (it.kind === "buy" && it.target !== "new" && it.target.startsWith("new:")) it.target = "new";
      if (it.kind !== "buy" && it.target === "new") autoTarget([it]);
    }
    delete R.errors[it.key];
    renderCard(Number(sg.dataset.i));
    return;
  }
  if (e.target.closest("[data-add-item]")) {
    R.items.push(blankItem("buy"));
    renderReview();
    const cards = $$(".rv-card");
    cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toTrade(it) {
  const contracts = num(it.contracts);
  const price = num(it.price);
  const total = num(it.total);
  const fees = num(it.fees);
  const entry = num(it.entryPrice);
  const at = it.at ? new Date(it.at) : new Date();
  const fail = (m) => ({ error: m });
  if (!it.market.trim()) return fail("Add the market name.");
  if (it.kind !== "settle") {
    if (!(contracts > 0)) return fail("Add how many contracts.");
    if (price == null && total == null) return fail("Add the price per contract or the total.");
    if (price != null && (price <= 0 || price >= 100)) return fail("Price is in cents, between 1 and 99.");
  } else {
    if (!["win", "loss", "void"].includes(it.result)) return fail("Pick Won, Lost or Void.");
  }
  if (it.kind !== "buy") {
    if (it.target === "new") {
      if (it.kind === "settle" && !(contracts > 0)) return fail("Add how many contracts you held.");
      if (!(entry > 0 && entry < 100)) return fail("Add what you paid per contract, in cents.");
    } else if (!it.target.startsWith("new:")) {
      const pos = state.positions.find((q) => q.id === it.target);
      if (!pos) return fail("Pick which bet this belongs to.");
      if (it.kind === "sell" && contracts > L.summarize(pos).held + 1e-9) return fail(`You only hold ${fmtQty(L.summarize(pos).held)} contracts on that bet.`);
    }
  }
  return {
    key: it.key,
    kind: it.kind,
    market: it.market.trim(),
    outcome: it.outcome.trim(),
    side: it.side,
    category: it.category,
    contracts,
    price,
    amount: total != null ? Math.round(total * 100) : null,
    fees: fees != null ? Math.round(fees * 100) : null,
    result: it.kind === "settle" ? it.result : null,
    at: isNaN(at) ? new Date().toISOString() : at.toISOString(),
    target: it.target,
    entryPrice: entry,
    shot: it.hash || null,
  };
}

function renderImpact() {
  const el = $("#rv-impact");
  if (!el || R.edit) return;
  const trades = R.items.filter((i) => i.include).map(toTrade).filter((t) => !t.error);
  if (!trades.length) {
    el.innerHTML = "";
    return;
  }
  try {
    const { positions } = L.applyTrades(state.positions, trades);
    let delta = 0;
    for (const p of positions.values()) {
      const prev = state.positions.find((q) => q.id === p.id);
      delta += L.summarize(p).realized - (prev ? L.summarize(prev).realized : 0);
    }
    const n = trades.length;
    el.innerHTML = `${n} trade${n > 1 ? "s" : ""}${delta ? ` · locks in <b class="${signClass(delta)}">${L.money(delta, { sign: true })}</b>` : ""}`;
  } catch {
    el.innerHTML = "";
  }
}

function saveReview() {
  if (R.edit) return saveEdit();
  const chosen = R.items.filter((i) => i.include);
  if (!chosen.length) {
    toast("Nothing selected to save.");
    return;
  }
  const trades = [];
  let firstBad = null;
  for (const it of chosen) {
    const t = toTrade(it);
    if (t.error) {
      R.errors[it.key] = t.error;
      if (firstBad == null) firstBad = R.items.indexOf(it);
    } else trades.push(t);
  }
  if (firstBad != null) {
    renderReview();
    $(`[data-card="${firstBad}"]`).scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const { positions } = L.applyTrades(state.positions, trades);
  const undo = write([...positions.values()]);
  const at = new Date().toISOString();
  for (const h of new Set(R.hashes)) state.store.putShot(h, { at, trades: trades.length }).catch(() => {});
  closeSheet();
  toast(`Saved ${trades.length} trade${trades.length > 1 ? "s" : ""}.`, { label: "Undo", fn: undo });
}

function editEntry(posId, part) {
  const pos = state.positions.find((p) => p.id === posId);
  if (!pos) return;
  const it = blankItem("buy");
  Object.assign(it, { market: pos.market, outcome: pos.outcome, side: pos.side, category: pos.category || "Other", target: pos.id });
  if (part === "settlement") {
    const s = pos.settlement;
    Object.assign(it, {
      kind: "settle",
      result: s.result,
      total: Number.isFinite(s.payout) ? (s.payout / 100).toFixed(2) : "",
      at: toLocalInput(new Date(s.at)),
    });
    openReview({ items: [it], title: "Fix settlement", edit: { posId, part: "settlement" } });
  } else {
    const f = pos.fills.find((x) => x.id === part);
    if (!f) return;
    Object.assign(it, {
      kind: f.kind,
      contracts: String(f.contracts ?? ""),
      price: Number.isFinite(f.price) ? String(f.price) : "",
      total: Number.isFinite(f.amount) ? (f.amount / 100).toFixed(2) : "",
      fees: Number.isFinite(f.fees) ? (f.fees / 100).toFixed(2) : "",
      at: toLocalInput(new Date(f.at)),
    });
    openReview({ items: [it], title: f.kind === "buy" ? "Fix this buy" : "Fix this sale", edit: { posId, part: "fill", fillId: f.id } });
  }
}

function saveEdit() {
  const it = R.items[0];
  const pos = clone(state.positions.find((p) => p.id === R.edit.posId));
  if (!pos) return closeSheet();
  if (!it.market.trim()) {
    R.errors[it.key] = "Add the market name.";
    return renderReview();
  }
  pos.market = it.market.trim();
  pos.outcome = it.outcome.trim();
  pos.side = it.side;
  pos.category = it.category;
  const at = new Date(it.at);
  if (R.edit.part === "settlement") {
    if (!["win", "loss", "void"].includes(it.result)) {
      R.errors[it.key] = "Pick Won, Lost or Void.";
      return renderReview();
    }
    const total = num(it.total);
    pos.settlement = {
      ...pos.settlement,
      result: it.result,
      payout: total != null ? Math.round(total * 100) : null,
      at: isNaN(at) ? pos.settlement.at : at.toISOString(),
    };
  } else {
    const f = pos.fills.find((x) => x.id === R.edit.fillId);
    const contracts = num(it.contracts);
    const price = num(it.price);
    const total = num(it.total);
    const fees = num(it.fees);
    if (!(contracts > 0)) {
      R.errors[it.key] = "Add how many contracts.";
      return renderReview();
    }
    if (price == null && total == null) {
      R.errors[it.key] = "Add the price per contract or the total.";
      return renderReview();
    }
    Object.assign(f, {
      contracts,
      price,
      amount: total != null ? Math.round(total * 100) : null,
      fees: fees != null ? Math.round(fees * 100) : null,
      at: isNaN(at) ? f.at : at.toISOString(),
    });
  }
  pos.updatedAt = new Date().toISOString();
  const undo = write([pos]);
  closeSheet();
  toast("Updated.", { label: "Undo", fn: undo });
}

// ---------- screenshots in ----------
$("#shot-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  handleFiles(files);
});
document.addEventListener("paste", (e) => {
  if (!state.user || $("#sheet-root").innerHTML) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) handleFiles(files);
});

async function handleFiles(files) {
  if (!files.length || !state.user) return;
  openSheet(
    `${sheetHead("Reading screenshot" + (files.length > 1 ? "s" : ""))}
     <div class="sheet-body"><div class="reading"><div class="spinner"></div><p id="rd-msg">Reading screenshot 1 of ${files.length}…</p></div></div>`,
    { label: "Reading" },
  );
  const open = openPositions().map(({ pos, sm }) => ({
    id: pos.id,
    market: pos.market,
    outcome: pos.outcome,
    side: pos.side,
    contracts: sm.held,
    avg_price_cents: Math.round(sm.avgPrice * 10) / 10,
  }));
  let token = "";
  try {
    token = await state.store.idToken();
  } catch {
    /* handled by the reader */
  }
  const items = [];
  const warnings = [];
  const hashes = [];
  for (let i = 0; i < files.length; i++) {
    const msg = $("#rd-msg");
    if (msg) msg.textContent = `Reading screenshot ${i + 1} of ${files.length}…`;
    const label = files.length > 1 ? `Shot ${i + 1}` : "";
    let hash = null;
    try {
      hash = await hashFile(files[i]);
    } catch {
      /* hashing is best-effort */
    }
    const dup = hash ? state.shots[hash] : null;
    try {
      const res = DEMO ? await sampleRead() : await readShot({ file: files[i], parseUrl: config.parseUrl, token, open });
      if (res.warning) warnings.push((label ? label + ": " : "") + res.warning);
      const trades = Array.isArray(res.trades) ? res.trades : [];
      if (res.screen_type === "not_kalshi" || !trades.length) {
        warnings.push(`${label || "That screenshot"}: no Kalshi trades found. Enter it by hand if it should count.`);
      }
      for (const t of trades) items.push(fromParsed(t, { hash, shotLabel: label, dup }));
      if (hash && trades.length) hashes.push(hash);
    } catch (e) {
      warnings.push(`${label || "Screenshot"}: ${e.message}`);
    }
    if (!$("#sheet-root").innerHTML) return; // closed while reading
  }
  if (!items.length) {
    openSheet(
      `${sheetHead("Couldn't read that")}
       <div class="sheet-body">${warnings.map((w) => `<p class="note warn">${esc(w)}</p>`).join("")}</div>
       <div class="sheet-foot"><button type="button" class="btn primary block" id="rd-manual">Enter it by hand</button></div>`,
      {
        label: "Couldn't read",
        onMount: (s) => $("#rd-manual", s).addEventListener("click", () => openReview({ items: [blankItem("buy")], title: "Enter a bet" })),
      },
    );
    return;
  }
  openReview({ items, warnings, hashes, title: "Check and save" });
}

// ---------- settings, export, restore ----------
function openSettings() {
  const isDemo = state.store.mode === "demo";
  openSheet(
    `${sheetHead("Settings")}
     <div class="sheet-body">
       <div class="acct"><span class="dim">Signed in as</span><b>${esc(state.user.email)}</b></div>
       <h3 class="mini">Your data</h3>
       <p class="hint">Bets are saved on this phone and synced to your account, so they survive a lost or new phone. Backups are an extra copy you control.</p>
       <div class="stack">
         <button type="button" class="btn block" id="st-csv">Export spreadsheet (CSV)</button>
         <button type="button" class="btn block" id="st-json">Save a full backup</button>
         <button type="button" class="btn block" id="st-restore">Restore from a backup</button>
         <input type="file" id="st-file" accept="application/json,.json" hidden>
       </div>
       <p class="form-err" id="st-msg" hidden></p>
       <h3 class="mini">About</h3>
       <p class="hint">${state.positions.length} bets tracked. Screenshots are read by Claude through your own reader and never stored; only the numbers are saved.</p>
     </div>
     <div class="sheet-foot"><button type="button" class="btn ghost danger block" id="st-out">${isDemo ? "Leave sample data" : "Sign out"}</button></div>`,
    {
      label: "Settings",
      onMount: (s) => {
        $("#st-csv", s).addEventListener("click", () => saveFile(`kalshi-killa-${stamp()}.csv`, toCsv(), "text/csv"));
        $("#st-json", s).addEventListener("click", () =>
          saveFile(
            `kalshi-killa-backup-${stamp()}.json`,
            JSON.stringify({ app: "kalshi-killa", version: 1, exportedAt: new Date().toISOString(), positions: state.positions }, null, 1),
            "application/json",
          ),
        );
        $("#st-restore", s).addEventListener("click", () => $("#st-file", s).click());
        $("#st-file", s).addEventListener("change", (e) => restore(e.target.files[0], s));
        $("#st-out", s).addEventListener("click", async () => {
          closeSheet();
          await state.store.signOut();
        });
      },
    },
  );
}

const stamp = () => new Date().toISOString().slice(0, 10);

function toCsv() {
  const rows = [["date", "market", "pick", "side", "category", "type", "contracts", "price_cents", "amount_usd", "fees_usd", "result", "bet_pnl_usd", "bet_id"]];
  const q = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const pos of [...state.positions].sort((a, b) => (L.summarize(a).openedAt < L.summarize(b).openedAt ? -1 : 1))) {
    const sm = L.summarize(pos);
    const pnl = sm.status === "closed" ? (sm.realized / 100).toFixed(2) : "";
    for (const f of [...(pos.fills || [])].sort((a, b) => (a.at < b.at ? -1 : 1))) {
      rows.push([
        f.at,
        pos.market,
        pos.outcome,
        pos.side,
        pos.category,
        f.kind,
        f.contracts,
        f.price ?? "",
        (L.fillAmount(f) / 100).toFixed(2),
        Number.isFinite(f.fees) ? (f.fees / 100).toFixed(2) : "",
        "",
        "",
        pos.id,
      ]);
    }
    if (pos.settlement && pos.settlement.result) {
      rows.push([pos.settlement.at, pos.market, pos.outcome, pos.side, pos.category, "settle", "", "", (sm.payout / 100).toFixed(2), "", pos.settlement.result, pnl, pos.id]);
    } else if (sm.status === "closed") {
      rows[rows.length - 1][11] = pnl;
    }
  }
  return rows.map((r) => r.map(q).join(",")).join("\n");
}

async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function restore(file, sheet) {
  const msg = $("#st-msg", sheet);
  const say = (t, ok = false) => {
    msg.textContent = t;
    msg.hidden = false;
    msg.classList.toggle("ok", ok);
  };
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return say("That file isn't a Kalshi Killa backup.");
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.positions) ? data.positions : null;
  if (!list) return say("That file isn't a Kalshi Killa backup.");
  const valid = list.filter((p) => p && typeof p.id === "string" && typeof p.market === "string" && Array.isArray(p.fills));
  if (!valid.length) return say("No bets found in that backup.");
  try {
    await Promise.race([state.store.putMany(valid), new Promise((r) => setTimeout(r, 2500))]);
    say(`Restored ${valid.length} bets. Bets with the same id were replaced.`, true);
  } catch (e) {
    say(`Restore failed: ${e.code || e.message}`);
  }
}

// ---------- toast ----------
let toastTimer = null;
function toast(text, action = null) {
  const root = $("#toast-root");
  root.innerHTML = `<div class="toast"><span>${esc(text)}</span>${action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : ""}</div>`;
  requestAnimationFrame(() => root.classList.add("on"));
  if (action) {
    $("#toast-act").addEventListener("click", () => {
      action.fn();
      root.classList.remove("on");
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.classList.remove("on"), action ? 6000 : 4000);
}

boot();
