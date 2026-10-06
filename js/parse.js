// Screenshot → trades. Shrinks the image on the phone, sends it to the Worker,
// which asks Claude to read it and returns structured trades for review.

const MAX_EDGE = 1568; // the model reads text well at this size; bigger only costs more

export async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function prepImage(file) {
  const img = await decode(file);
  const w = img.width;
  const h = img.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  return { b64, mediaType: "image/jpeg" };
}

const MESSAGES = {
  sign_in_required: "Your sign-in expired. Sign out and back in, then try again.",
  account_not_allowed: "This account isn't on the reader's allowed list. Add the email to ALLOWED_EMAILS in the Worker settings.",
  origin_not_allowed: "The reader is set to a different web address. Check ALLOWED_ORIGIN in the Worker settings.",
  server_not_configured: "The reader is missing its API key or Firebase project id. Check the Worker settings.",
  image_too_large: "That image is too large. Try a normal screenshot instead of a photo.",
  busy: "The reader is busy. Wait a few seconds and try again.",
  unreadable_reply: "The reader couldn't make sense of that one. Try again or enter it by hand.",
  upstream_rejected: "The reader rejected the request. Check the API key and model in the Worker settings.",
};

export async function readShot({ file, parseUrl, token, open }) {
  if (!parseUrl) throw new Error("Screenshot reading isn't set up yet. Add parseUrl in js/config.js.");
  if (!navigator.onLine) throw new Error("No signal. Reading a screenshot needs internet; add it by hand or try again later.");
  const { b64, mediaType } = await prepImage(file);
  let r;
  try {
    r = await fetch(parseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        image: b64,
        mediaType,
        open,
        now: new Date().toString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
  } catch {
    throw new Error("Couldn't reach the screenshot reader. Check your connection and the parseUrl in js/config.js.");
  }
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* ignore */
  }
  if (!r.ok) throw new Error((body && MESSAGES[body.error]) || `Reader error (${r.status}). Try again.`);
  return body;
}

// Preview mode: a canned read so the review step can be tried without setup.
export async function sampleRead() {
  await new Promise((r) => setTimeout(r, 700));
  return {
    screen_type: "order_confirmation",
    warning: "Sample read. Real screenshots are read once setup is done.",
    trades: [
      {
        kind: "buy",
        market: "Lakers vs Celtics",
        outcome: "Celtics",
        side: "yes",
        contracts: 30,
        price_cents: 57,
        total_usd: 17.42,
        fees_usd: 0.32,
        result: "none",
        category: "Sports",
        confidence: "high",
      },
    ],
  };
}
