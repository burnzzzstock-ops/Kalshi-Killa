# Kalshi Killa setup

About 25 minutes, once. Three free accounts plus Anthropic API credit. Nothing secret goes in this repo: the Anthropic key lives only in the Cloudflare Worker.

```
iPhone app (GitHub Pages) ──screenshot──▶ Cloudflare Worker (holds Anthropic key) ──▶ Claude reads it
        │                                        ▲ checks he's signed in + on the allowlist
        └── bets ──▶ Firebase (his account; saved on the phone first, synced to the cloud)
```

## 1. Firebase: login and database (10 min)

1. Go to https://console.firebase.google.com → **Create a project** → name it `kalshi-killa` → turn Google Analytics off → Create.
2. **Build → Authentication → Get started → Email/Password** → Enable → Save.
3. **Authentication → Users → Add user** → his email and a password. Add yourself too if you want to test.
4. **Authentication → Settings → User actions** → uncheck **Enable create (sign-up)** → Save. Only accounts you add can sign in.
5. **Authentication → Settings → Authorized domains** → Add domain → `burnzzzstock-ops.github.io`.
6. **Build → Firestore Database → Create database** → Production mode → pick a US location → Create.
7. Firestore → **Rules** tab → replace everything with the contents of [`firestore.rules`](firestore.rules) → **Publish**. Each person can only read and write their own bets.
8. **Project settings** (gear icon) → **General** → *Your apps* → the **</>** (Web) button → nickname `Kalshi Killa` → leave Hosting unchecked → Register. Keep the `firebaseConfig` it shows open; you need 4 values in step 4.

## 2. Anthropic API key (5 min)

1. https://console.anthropic.com → **API Keys → Create Key** → name it `kalshi-killa`. Copy it.
2. **Billing** → add credit. $5 covers roughly 1,000 screenshots (Claude Haiku 4.5 at $1 / $5 per million tokens; one screenshot is about half a cent).
3. **Limits** → set a monthly spend limit, e.g. $10, so a bug or a flood can't run up a bill.

## 3. Cloudflare Worker: the screenshot reader (7 min)

1. https://dash.cloudflare.com → sign up (free, no card) → **Workers & Pages → Create → Create Worker** → name it `kalshi-killa` → **Deploy**.
2. **Edit code** → delete the sample → paste all of [`worker/worker.js`](worker/worker.js) → **Deploy**.
3. Worker → **Settings → Variables and Secrets → Add**, one at a time:

   | Name | Type | Value |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | **Secret** | the key from step 2 |
   | `FIREBASE_PROJECT_ID` | Text | `projectId` from the Firebase config |
   | `ALLOWED_ORIGIN` | Text | `https://burnzzzstock-ops.github.io` |
   | `ALLOWED_EMAILS` | Text | his sign-in email, plus yours, comma-separated |

   Deploy when asked.
4. Copy the Worker's address (looks like `https://kalshi-killa.<you>.workers.dev`). Open `<that address>/health` in a browser; it should say `{"ok":true}`.

## 4. Connect the app (3 min)

1. On GitHub open `js/config.js` → pencil icon → fill in:
   ```js
   firebase: {
     apiKey: "…",        // from the Firebase config
     authDomain: "…",
     projectId: "…",
     appId: "…",
   },
   parseUrl: "https://kalshi-killa.<you>.workers.dev/parse",
   ```
   → **Commit changes**.
2. Repo **Settings → Pages** → Source **Deploy from a branch** → Branch `main`, folder `/ (root)` → Save. Give it a minute. The app lives at **https://burnzzzstock-ops.github.io/Kalshi-Killa/**

## 5. His iPhone (1 min)

1. Open that address in **Safari** → Share button → **Add to Home Screen**.
2. Open Kalshi Killa from the home screen → sign in with the account from step 1.3.

Done. Before setup, `…/Kalshi-Killa/?demo` shows the app with sample data.

## Day to day

- **Bought:** screenshot the Kalshi order → Add screenshot → check the numbers → Save.
- **Settled:** tap **Won** or **Lost** on the bet. The math is automatic ($1.00 per contract or $0).
- **Sold early:** screenshot the sale → Add screenshot. It attaches to the open bet and locks in the profit or loss.
- **Same screenshot twice:** the app spots it and skips it, so nothing is counted double.
- **Backups:** Settings → *Save a full backup* (JSON) or *Export spreadsheet* (CSV) → save to Files or iCloud Drive. *Restore from a backup* puts it all back.

## If something's off

| Message | Fix |
|---|---|
| "This account isn't on the reader's allowed list" | Add the email to `ALLOWED_EMAILS` in the Worker, Deploy. |
| "The reader is set to a different web address" | `ALLOWED_ORIGIN` must be exactly `https://burnzzzstock-ops.github.io` (no trailing slash). |
| "Couldn't reach the screenshot reader" | `parseUrl` in `js/config.js` must end in `/parse`. |
| "The reader rejected the request" | Check the API key and that the Anthropic account has credit. |
| "Couldn't save to the cloud (permission-denied)" | Firestore rules weren't published (step 1.7). |

Optional: set `MODEL` in the Worker to `claude-sonnet-5-5` for harder-to-read screenshots (about 2× the cost).
