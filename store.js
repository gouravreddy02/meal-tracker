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
  // Note: the Firebase SDK persists its own auth session; no local key needed.

  // ---- IndexedDB: the linked plan.js file handle ----
  // FileSystemFileHandle objects can't be JSON/localStorage'd, but they survive
  // structured-clone into IndexedDB. Used for "auto-sync to plan.js".
  const IDB_NAME = "mealtracker", IDB_STORE = "handles", PLAN_HANDLE_KEY = "planFile";
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idbGet(key) {
    return idb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
      tx.onsuccess = () => res(tx.result || null);
      tx.onerror = () => rej(tx.error);
    })).catch(() => null);
  }
  function idbSet(key, val) {
    return idb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(val, key);
      tx.onsuccess = () => res(true);
      tx.onerror = () => rej(tx.error);
    })).catch(() => false);
  }

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
      unit: localStorage.getItem(UNIT_KEY) || "kg",
      updatedAt: Date.now(),
    };
  }
  function applySnapshot(d) {
    if (!d) return false;
    if (d.logs) write(LOGS_KEY, d.logs);
    if (d.weights) write(WEIGHTS_KEY, d.weights);
    if (d.foods) write(FOODS_KEY, d.foods);
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
    if (remote && (remote.logs || remote.weights || remote.foods)) applySnapshot(remote);
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

    // Cloud sync: Firebase Google auth + per-user data.
    isSyncConfigured: () => !!syncCfg(),
    isSyncReady: () => !!fb(),       // Firebase SDK loaded?
    getUser: () => currentUser(),
    signInWithGoogle, // → Promise, throws on failure
    signOut,
    onSync: (cb) => { syncCb = cb; },
    syncInit, // pull remote → cache, then fire onSync
    cloudPush,

    // Linked plan.js file handle (for auto-sync). Promise<handle|null>.
    getPlanFileHandle: () => idbGet(PLAN_HANDLE_KEY),
    setPlanFileHandle: (h) => idbSet(PLAN_HANDLE_KEY, h),

    // Weight display unit. Defaults to "kg"; weights themselves stay in kg.
    getUnit: () => localStorage.getItem(UNIT_KEY) || "kg",
    setUnit: (u) => {
      try { localStorage.setItem(UNIT_KEY, u); schedulePush(); return true; }
      catch (e) { return false; }
    },

    // Export everything as a JSON string (for backup / transfer)
    exportAll: () =>
      JSON.stringify(
        { logs: read(LOGS_KEY), weights: read(WEIGHTS_KEY), foods: read(FOODS_KEY), unit: localStorage.getItem(UNIT_KEY) },
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
      localStorage.removeItem(UNIT_KEY);
      idbSet(PLAN_HANDLE_KEY, null);
      signOut();
    },
  };
})();
