// ============================================================
//  store.js — data persistence layer.
//  localStorage is the instant local cache; if cloud sync is
//  configured, state is mirrored to a Firebase Realtime
//  Database over its REST API (no SDK, no build step) so the
//  same data shows up on every device. The UI only calls
//  Store.* methods and stays synchronous.
// ============================================================

window.Store = (function () {
  const LOGS_KEY = "mealtracker.logs.v1";     // { "YYYY-MM-DD": [ {n,c,p,cb,f}, ... ] }
  const WEIGHTS_KEY = "mealtracker.weights.v1"; // { "YYYY-MM-DD": number }
  const FOODS_KEY = "mealtracker.foods.v1";   // { "<slot>": [ {n,c,p,cb,f}, ... ] } — user's quick-add arrangement
  const UNIT_KEY = "mealtracker.unit.v1";     // "kg" | "lb" — weight display unit (weights are always stored in kg)
  const CYCLES_KEY = "mealtracker.cycles.v1"; // [ { id, name, startDate, weeks, targets:{cal,protein,carbs,fat} }, ... ] — legacy diet cycles (read only, migrated into weeks)
  const WEEKS_KEY = "mealtracker.weeks.v1";   // [ { id, startDate, phase, targets:{cal,protein,carbs,fat} }, ... ] — diet weeks, oldest first; each spans 7 days
  const CATCOLORS_KEY = "mealtracker.catcolors.v1"; // { "<category>": "#rrggbb" } — accent colour override per catalog category
  // Note: the Firebase SDK persists its own auth session; no local key needed.

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("Store.read failed", e);
      return {};
    }
  }
  function write(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn("Store.write failed", e);
      return false;
    }
  }

  // ---- cloud sync (Firebase: Google Auth + Realtime Database, REST) ----
  // The public Firebase config (apiKey, authDomain, databaseURL, projectId) lives
  // in PLAN.sync. Google sign-in + session handling is done by the Firebase SDK
  // (loaded in index.html, exposed as window.FBAuth); here we just take the
  // signed-in user's idToken to authorize Realtime Database REST calls. Data
  // lives at /users/<uid>, and Security Rules ensure only that user can touch it
  // — so the public config is safe by design. Local writes are debounced +
  // pushed; pulls replace the cache and fire onSync.
  let syncCb = null, pushT = null;

  function syncCfg() {
    const c = (window.PLAN && window.PLAN.sync) || null;
    if (!c || !c.apiKey || !c.databaseURL) return null;
    if (/PASTE/.test(c.apiKey) || /PASTE/.test(c.databaseURL)) return null; // placeholders
    return c;
  }
  const fb = () => window.FBAuth || null;            // Firebase SDK wrapper, once loaded
  function currentUser() { const a = fb(); return a ? a.getUser() : null; }
  async function signInWithGoogle() { const a = fb(); if (!a) throw new Error("Sync isn't ready yet."); return a.signInWithGoogle(); }
  function signOut() { const a = fb(); if (a) a.signOut(); }
  // Build the authorized REST URL for the signed-in user's data node.
  async function dataUrl() {
    const cfg = syncCfg(), a = fb(), user = currentUser();
    if (!cfg || !a || !user) return null;
    const tok = await a.getToken(); // SDK refreshes this automatically
    if (!tok) return null;
    return `${cfg.databaseURL.replace(/\/+$/, "")}/users/${user.uid}.json?auth=${tok}`;
  }

  function snapshot() {
    return {
      logs: read(LOGS_KEY),
      weights: read(WEIGHTS_KEY),
      foods: (function () { const r = localStorage.getItem(FOODS_KEY); return r ? JSON.parse(r) : null; })(),
      cycles: (function () { const r = localStorage.getItem(CYCLES_KEY); return r ? JSON.parse(r) : null; })(),
      weeks: (function () { const r = localStorage.getItem(WEEKS_KEY); return r ? JSON.parse(r) : null; })(),
      catColors: (function () { const r = localStorage.getItem(CATCOLORS_KEY); return r ? JSON.parse(r) : null; })(),
      unit: localStorage.getItem(UNIT_KEY) || "kg",
      updatedAt: Date.now(),
    };
  }
  function applySnapshot(d) {
    if (!d) return false;
    if (d.logs) write(LOGS_KEY, d.logs);
    if (d.weights) write(WEIGHTS_KEY, d.weights);
    if (d.foods) write(FOODS_KEY, d.foods);
    if (d.cycles) write(CYCLES_KEY, d.cycles);
    if (d.weeks) write(WEEKS_KEY, d.weeks);
    if (d.catColors) write(CATCOLORS_KEY, d.catColors);
    if (d.unit) localStorage.setItem(UNIT_KEY, d.unit);
    return true;
  }
  async function cloudPull() {
    const url = await dataUrl();
    if (!url) return null;
    try { const r = await fetch(url); return r.ok ? await r.json() : null; }
    catch (e) { console.warn("cloud pull failed", e); return null; }
  }
  async function cloudPush() {
    const url = await dataUrl();
    if (!url) return false;
    try { const r = await fetch(url, { method: "PUT", body: JSON.stringify(snapshot()) }); return r.ok; }
    catch (e) { console.warn("cloud push failed", e); return false; }
  }
  function schedulePush() {
    if (!currentUser()) return;
    clearTimeout(pushT);
    pushT = setTimeout(cloudPush, 600);
  }
  // Pull remote into the local cache (or seed the cloud from local on first run),
  // then notify the UI so it can re-read and re-render.
  async function syncInit() {
    if (!currentUser() || !syncCfg()) return;
    const remote = await cloudPull();
    if (remote && (remote.logs || remote.weights || remote.foods || remote.cycles || remote.weeks)) applySnapshot(remote);
    else cloudPush();
    if (syncCb) syncCb();
  }

  return {
    getLogs: () => read(LOGS_KEY),
    setLogs: (obj) => { const ok = write(LOGS_KEY, obj); schedulePush(); return ok; },
    getWeights: () => read(WEIGHTS_KEY),
    setWeights: (obj) => { const ok = write(WEIGHTS_KEY, obj); schedulePush(); return ok; },

    // Quick-add arrangement. Returns null until the user has rearranged it,
    // so the UI can fall back to the default PLAN.foods order.
    getFoods: () => {
      const raw = localStorage.getItem(FOODS_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    setFoods: (obj) => { const ok = write(FOODS_KEY, obj); schedulePush(); return ok; },

    // Diet cycles. Returns null until the user has created/customized cycles,
    // so the UI can fall back to a seed derived from PLAN (Cycle 1).
    getCycles: () => {
      const raw = localStorage.getItem(CYCLES_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    setCycles: (arr) => { const ok = write(CYCLES_KEY, arr); schedulePush(); return ok; },

    // Diet weeks. Returns null until the user has weeks persisted, so app.js can
    // migrate legacy cycles or seed from PLAN on first run.
    getWeeks: () => {
      const raw = localStorage.getItem(WEEKS_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    setWeeks: (arr) => { const ok = write(WEEKS_KEY, arr); schedulePush(); return ok; },

    // Per-category accent colour overrides. Returns {} when none set.
    getCatColors: () => read(CATCOLORS_KEY),
    setCatColors: (obj) => { const ok = write(CATCOLORS_KEY, obj); schedulePush(); return ok; },

    // Cloud sync: Firebase Google auth + per-user data.
    isSyncConfigured: () => !!syncCfg(),
    isSyncReady: () => !!fb(),       // Firebase SDK loaded?
    getUser: () => currentUser(),
    signInWithGoogle, // → Promise, throws on failure
    signOut,
    onSync: (cb) => { syncCb = cb; },
    syncInit, // pull remote → cache, then fire onSync
    cloudPush,

    // Weight display unit. Defaults to "kg"; weights themselves stay in kg.
    getUnit: () => localStorage.getItem(UNIT_KEY) || "kg",
    setUnit: (u) => {
      try { localStorage.setItem(UNIT_KEY, u); schedulePush(); return true; }
      catch (e) { return false; }
    },

    // Export everything as a JSON string (for backup / transfer)
    exportAll: () =>
      JSON.stringify(
        { logs: read(LOGS_KEY), weights: read(WEIGHTS_KEY), foods: read(FOODS_KEY), cycles: read(CYCLES_KEY), weeks: read(WEEKS_KEY), catColors: read(CATCOLORS_KEY), unit: localStorage.getItem(UNIT_KEY) },
        null,
        2
      ),

    // Import from a JSON string produced by exportAll
    importAll: (jsonStr) => {
      try {
        const data = JSON.parse(jsonStr);
        if (data.logs) write(LOGS_KEY, data.logs);
        if (data.weights) write(WEIGHTS_KEY, data.weights);
        if (data.foods) write(FOODS_KEY, data.foods);
        if (data.cycles) write(CYCLES_KEY, data.cycles);
        if (data.weeks) write(WEEKS_KEY, data.weeks);
        if (data.catColors) write(CATCOLORS_KEY, data.catColors);
        if (data.unit) localStorage.setItem(UNIT_KEY, data.unit);
        schedulePush();
        return true;
      } catch (e) {
        return false;
      }
    },

    clearAll: () => {
      localStorage.removeItem(LOGS_KEY);
      localStorage.removeItem(WEIGHTS_KEY);
      localStorage.removeItem(FOODS_KEY);
      localStorage.removeItem(CYCLES_KEY);
      localStorage.removeItem(WEEKS_KEY);
      localStorage.removeItem(CATCOLORS_KEY);
      localStorage.removeItem(UNIT_KEY);
      signOut();
    },
  };
})();
