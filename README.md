# Kalshi Killa

A phone app for tracking Kalshi bets and seeing real profit and loss.

Screenshot a Kalshi order, add it, check the numbers, save. Tap **Won** or **Lost** when it settles; add the screenshot if you sell early. The home screen shows P&L for today, 7 days, 30 days, this year or all time, with record, win rate, ROI, a running-total chart and a breakdown by category.

- Installs to the iPhone home screen from Safari; works offline and syncs when there's signal.
- Bets are stored per account in Firebase, so a new or lost phone loses nothing. CSV and JSON backups on demand.
- Screenshots are read by Claude through a small Cloudflare Worker that holds the API key. Images are never stored; only the numbers are.
- P&L uses average cost, the way Kalshi shows "avg price". Each contract pays $1.00 if it hits.

**Setup:** see [SETUP.md](SETUP.md). **Preview:** open the app with `?demo` on the end of the address.

```
index.html, css/       the app
js/ledger.js           all money math (pure functions)
js/store.js            Firebase auth + Firestore with on-phone cache
js/parse.js            shrinks a screenshot and sends it to the reader
js/config.js           your Firebase config + reader address (fill in once)
worker/worker.js       Cloudflare Worker: checks sign-in, asks Claude to read the screenshot
firestore.rules        each person reads and writes only their own bets
```
