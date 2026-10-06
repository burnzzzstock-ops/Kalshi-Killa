// Kalshi Killa — screenshot reader.
// Cloudflare Worker. Holds the Anthropic API key so the phone app never sees it.
// Only signed-in Kalshi Killa users (Firebase ID token) on the allowlist can call it.
//
// Settings → Variables and Secrets:
//   ANTHROPIC_API_KEY  (Secret)  your Anthropic API key
//   FIREBASE_PROJECT_ID          e.g. kalshi-killa-1a2b3
//   ALLOWED_ORIGIN               e.g. https://burnzzzstock-ops.github.io
//   ALLOWED_EMAILS               comma-separated sign-in emails allowed to read screenshots
//   MODEL (optional)             default claude-haiku-4-5-20251001

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_IMAGE_B64 = 7_000_000;

const TOOL = {
  name: "record_trades",
  description: "Record every Kalshi trade, position or settlement visible in the screenshot.",
  input_schema: {
    type: "object",
    properties: {
      screen_type: {
        type: "string",
        enum: ["order_confirmation", "position_detail", "trade_history", "portfolio_list", "settlement", "not_kalshi", "other"],
      },
      trades: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["buy", "sell", "settle"] },
            market: { type: "string", description: "Market or event title as shown, e.g. 'Chiefs vs Raiders' or 'Fed decision in December?'" },
            outcome: { type: "string", description: "The specific contract within the market, e.g. 'Chiefs', 'Over 47.5', 'Above 4,500'. Empty string when the market is a single yes/no question." },
            side: { type: "string", enum: ["yes", "no"] },
            contracts: { type: "number", description: "Number of contracts (shares). Omit if not shown." },
            price_cents: { type: "number", description: "Price or average price per contract in cents (1-99). Omit if not shown." },
            total_usd: { type: "number", description: "buy: total cost paid. sell: total proceeds received. settle: payout received. Dollars. Omit if not shown." },
            fees_usd: { type: "number", description: "Fees in dollars, only if shown separately." },
            result: { type: "string", enum: ["win", "loss", "void", "none"], description: "For settle: did the contract pay out. 'none' for buys and sells." },
            datetime: { type: "string", description: "ISO 8601 local date-time if a date or time is visible; omit otherwise." },
            category: { type: "string", enum: ["Sports", "Politics", "Economics", "Crypto", "Weather", "Culture", "Other"] },
            match_id: { type: "string", description: "id of the open position from the provided list that this trade belongs to. Omit if none matches." },
            already_tracked: { type: "boolean", description: "True when this is a holding/position view that matches an open position already tracked with the same contract count (not a new purchase)." },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            note: { type: "string", description: "Short note on anything unclear or estimated." },
          },
          required: ["kind", "market", "outcome", "side", "category", "confidence"],
        },
      },
      warning: { type: "string", description: "Anything the user should know, e.g. the image is not a Kalshi screen or is cropped." },
    },
    required: ["screen_type", "trades"],
  },
};

function prompt({ open, now, tz }) {
  return `You read screenshots from the Kalshi app (a US prediction market) for a personal profit-and-loss tracker.

Kalshi basics: each contract is priced 1-99¢ and pays $1.00 if its side wins, $0 if it loses. A trader buys YES or NO on an outcome, may sell before the market settles, or holds until it settles.

Record every trade, holding or settlement visible in this screenshot by calling record_trades exactly once.
- Order confirmation or "Bought"/"Filled" screens -> kind "buy". "Sold" or cash-out screens -> kind "sell".
- A position/holding screen (contracts, avg price, cost, payout, current value) -> kind "buy" using the avg price and total cost.
- Settled/closed results showing won, lost or payout -> kind "settle" with result and payout.
- History lists with several rows -> one entry per row.
- Copy numbers exactly as shown. Never estimate fees or invent values; omit a field that is not visible.
- market = the event/question title; outcome = the specific option (team, threshold, candidate). Keep both as the screen shows them.
- If the image is not a Kalshi screen, return screen_type "not_kalshi" and no trades.

Today is ${now} (${tz}). Use it to resolve "Today", "Yesterday" or a date without a year.

Open positions already tracked (match sells, settlements and repeat buys to these by market, outcome and side):
${open && open.length ? JSON.stringify(open) : "(none)"}`;
}

// ---------- Firebase ID token verification ----------
let jwksCache = { keys: null, exp: 0 };
async function getJwks() {
  if (jwksCache.keys && Date.now() < jwksCache.exp) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("jwks fetch failed");
  const body = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  jwksCache = { keys: body.keys, exp: Date.now() + (m ? Number(m[1]) * 1000 : 3600_000) };
  return body.keys;
}
const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function verifyIdToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== "RS256") throw new Error("bad alg");
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
  if (!ok) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("wrong project");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("wrong issuer");
  if (!payload.sub || payload.exp <= now || payload.iat > now + 300) throw new Error("expired");
  return payload;
}

// ---------- helpers ----------
function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (env, status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(env) } });

function extractJson(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

async function callClaude(env, body, forceTool) {
  const req = {
    model: env.MODEL || DEFAULT_MODEL,
    max_tokens: 3000,
    tools: [TOOL],
    tool_choice: forceTool ? { type: "tool", name: TOOL.name } : { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: body.mediaType || "image/jpeg", data: body.image } },
          { type: "text", text: prompt(body) },
        ],
      },
    ],
  };
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json(env, 200, { ok: true });
    if (request.method !== "POST" || url.pathname !== "/parse") return json(env, 404, { error: "not_found" });

    if (env.ALLOWED_ORIGIN) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.ALLOWED_ORIGIN) return json(env, 403, { error: "origin_not_allowed" });
    }
    if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_PROJECT_ID) return json(env, 500, { error: "server_not_configured" });

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let user;
    try {
      user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
    } catch {
      return json(env, 401, { error: "sign_in_required" });
    }
    const allowed = (env.ALLOWED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(String(user.email || "").toLowerCase())) {
      return json(env, 403, { error: "account_not_allowed" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(env, 400, { error: "bad_request" });
    }
    if (!body || typeof body.image !== "string" || !body.image) return json(env, 400, { error: "no_image" });
    if (body.image.length > MAX_IMAGE_B64) return json(env, 413, { error: "image_too_large" });
    if (!["image/jpeg", "image/png", "image/webp"].includes(body.mediaType || "image/jpeg")) {
      return json(env, 400, { error: "bad_image_type" });
    }
    body.open = Array.isArray(body.open) ? body.open.slice(0, 200) : [];

    let r = await callClaude(env, body, true);
    if (r.status === 400) {
      const t = await r.text();
      if (/tool_choice|thinking/i.test(t)) r = await callClaude(env, body, false);
      else return json(env, 502, { error: "upstream_rejected", detail: t.slice(0, 300) });
    }
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      const code = r.status === 429 || r.status === 529 ? "busy" : "upstream_error";
      return json(env, 502, { error: code, detail });
    }
    const data = await r.json();
    const block = (data.content || []).find((c) => c.type === "tool_use" && c.name === TOOL.name);
    let out = block ? block.input : null;
    if (!out) {
      const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      out = extractJson(text);
    }
    if (!out || !Array.isArray(out.trades)) return json(env, 502, { error: "unreadable_reply" });

    return json(env, 200, {
      screen_type: out.screen_type || "other",
      trades: out.trades,
      warning: out.warning || "",
      model: data.model,
      usage: data.usage,
    });
  },
};
