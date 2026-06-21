# Meal Log — Lean Bulk Tracker

A self-contained meal & weight tracker. No build step, no accounts, no internet
required after first load. Your data lives in your browser (localStorage).

## What it does

- Log meals per day by tapping preset foods, or add custom ones
- See running calories + protein / carbs / fat against your daily targets
- Log morning weight; auto-calculates Week 1 vs Week 2 averages and tells you
  whether to hold, add, or trim calories
- Export / import a JSON backup so you can move data between devices

## Run it

### On a laptop
Just double-click `index.html`. It opens in your browser and works immediately.

> Note: the service worker (offline mode) and "Add to home screen" only work when
> served over `http://` or `https://`, not the `file://` you get from double-clicking.
> For full PWA behavior, serve the folder (see below). Plain double-click still
> runs the app and saves data fine.

### Serve it locally (enables offline + installable app)
From inside this folder:

```bash
# Python (already on most machines)
python3 -m http.server 8000
```

Then open `http://localhost:8000` on the same computer.

### Use it on your phone
Two easy options:

1. **Same Wi-Fi:** run the serve command above on your laptop, find your laptop's
   local IP (e.g. `192.168.1.20`), and open `http://192.168.1.20:8000` in your
   phone's browser. Then use the browser menu → "Add to Home Screen".

2. **Host it free:** drop this folder into Netlify Drop (netlify.com/drop),
   GitHub Pages, or Vercel. You'll get a URL you can open anywhere and install
   to your home screen. This is the most convenient long-term.

Once added to your home screen it behaves like a native app and works offline.

## Move data between devices

- Tap **Export backup** to download a `.json` file.
- On the other device, tap **Import backup** and pick that file.

## Files

| File | What it is |
|------|-----------|
| `index.html` | App shell + all styling |
| `plan.js` | **Your targets and food list — edit this freely** |
| `store.js` | Data persistence (localStorage). Swap for cloud sync later. |
| `app.js` | UI and logic |
| `sw.js` | Service worker (offline caching) |
| `manifest.json`, `icon.svg` | PWA install metadata |

## Extending with Claude Code

The code is plain HTML/JS with no dependencies, so Claude Code can edit it directly.
Good first additions, and where they'd go:

- **Add/edit foods or change targets** → edit `plan.js` only.
- **Training & sleep logging** → add fields in `app.js` (mirror the weight input
  pattern) and new keys in `store.js`.
- **A real chart of weight over time** → add a `<canvas>` in `app.js`; the data is
  already in the `weights` object.
- **Cloud sync across devices** → replace the body of `store.js` with calls to a
  backend (e.g. Supabase). The UI calls only `Store.getLogs/setLogs/getWeights/
  setWeights`, so nothing else needs to change.
- **Macro goal tweaks per day (training vs rest)** → extend `PLAN.targets` into a
  per-day map and read it by date in `app.js`.

Suggested prompt for Claude Code:
> "This is a vanilla JS PWA meal tracker. Read README.md, plan.js, store.js, and
> app.js. Add a sleep-hours field to each day, persisted via Store, shown under
> the weight input."

## Reset everything

Open the browser console on the app and run:
```js
Store.clearAll(); location.reload();
```
