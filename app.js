// ============================================================
//  app.js — UI + logic. Vanilla JS, no build step.
//  Renders into #root. Reads PLAN, persists via Store.
// ============================================================

(function () {
  const P = window.PLAN;

  // ---- date helpers ----
  const pad = (n) => String(n).padStart(2, "0");
  const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (s) => {
    const [y, m, dd] = s.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };

  // Two independent axes:
  //  • CATEGORIES — the catalog's macro groups (config-driven, from PLAN.foods).
  //  • MEALS      — how the day's journal is grouped; a journal item carries its
  //    meal in `s`. A catalog food is planned into one of these meals.
  const CATEGORIES = Object.keys(P.foods);
  const MEALS = ["Before workout", "After workout", "Lunch", "Snacks", "Dinner"];
  // Measurement units a food's macros can be quoted per (value stored on the food
  // as `u`; label shown in the New food picker). "serving" ≈ the old unit-less food.
  const UNITS = [
    { v: "g", l: "grams (g)" },
    { v: "tbsp", l: "tablespoon (tbsp)" },
    { v: "tsp", l: "teaspoon (tsp)" },
    { v: "ml", l: "milliliter (ml)" },
    { v: "cup", l: "cup" },
    { v: "oz", l: "ounce (oz)" },
    { v: "piece", l: "piece" },
    { v: "serving", l: "serving" },
  ];
  // Which meal a journal item belongs to (legacy/unknown slots fall under Snacks).
  const mealOf = (it) => (MEALS.indexOf(it.s) >= 0 ? it.s : "Snacks");
  // A journal item counts toward totals only once eaten. Legacy items (saved
  // before this field existed) have no `eaten` flag, so treat them as eaten.
  const isEaten = (it) => it.eaten !== false;
  // A food's dominant macro (by grams) → drives its chip colour. Ties: P → C → F.
  function macroOf(it) {
    const p = it.p || 0, c = it.cb || 0, f = it.f || 0;
    if (p >= c && p >= f) return "protein";
    if (c >= f) return "carbs";
    return "fat";
  }
  // Category a food lands in when auto-sorted by its dominant macro.
  const catForMacro = (m) => (m === "protein" ? "Protein" : m === "carbs" ? "Carbs" : "Fat");

  // ---- diet weeks ----
  // The plan is a flat, ordered list of weeks. Each week spans 7 consecutive days
  // from its `startDate`, owns its own macro targets, and has a `phase`
  // (bulk/recomp/cut) that sets its accent color and pre-fills suggested targets.
  // Weeks are non-overlapping date ranges, so the log page is just a view over the
  // date-keyed logs/weights plus the week's targets.
  const PHASES = {
    bulk:   { label: "Bulk",   color: "var(--lime)",   cls: "ph-bulk" },
    recomp: { label: "Recomp", color: "var(--blue)",   cls: "ph-recomp" },
    cut:    { label: "Cut",    color: "var(--orange)", cls: "ph-cut" },
  };
  const PHASE_ORDER = ["bulk", "recomp", "cut"];
  const phaseOf = (wk) => (PHASES[wk.phase] ? wk.phase : "bulk");
  // Suggested targets for a phase, derived from PLAN.targets (treated as the bulk
  // baseline): recomp/cut step calories down, push protein up and trim carbs.
  // These only pre-fill the editable target inputs; the user can override.
  function phaseTargets(phase) {
    const b = P.targets;
    const fiber = b.fiber || 0; // fiber is a floor; it doesn't scale with calories
    const sugar = b.sugar || 0; // added-sugar limit; also held constant across phases
    const carbsFrom = (cal, protein, fat) => Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
    if (phase === "recomp") {
      const cal = Math.round((b.cal * 0.84) / 10) * 10, protein = b.protein + 20, fat = b.fat;
      return { cal, protein, carbs: carbsFrom(cal, protein, fat), fat, fiber, sugar };
    }
    if (phase === "cut") {
      const cal = Math.round((b.cal * 0.7) / 10) * 10, protein = b.protein + 40, fat = Math.round(b.fat * 0.8);
      return { cal, protein, carbs: carbsFrom(cal, protein, fat), fat, fiber, sugar };
    }
    return { ...b, fiber, sugar }; // bulk
  }

  // The 7 Date objects of a week, in order.
  function weekDates(wk) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = parseKey(wk.startDate);
      d.setDate(d.getDate() + i);
      return d;
    });
  }
  // First/last date keys of a week (string compare works on YYYY-MM-DD).
  function weekRange(wk) {
    const ds = weekDates(wk).map(keyFor);
    return { start: ds[0], end: ds[6] };
  }
  // Today if it falls within the given days, else the first day.
  function todayOrFirst(days) {
    const keys = days.map(keyFor), today = keyFor(new Date());
    return keys.includes(today) ? today : keys[0];
  }
  // The week whose range contains today, or null when today is outside them all.
  function currentWeekId() {
    const today = keyFor(new Date());
    const wk = weeks.find((w) => { const r = weekRange(w); return today >= r.start && today <= r.end; });
    return wk ? wk.id : null;
  }

  // Seed a fresh plan from PLAN: numDays worth of bulk weeks from startDate.
  function seedWeeks() {
    const n = Math.max(1, Math.round(P.numDays / 7));
    return Array.from({ length: n }, (_, i) => {
      const d = parseKey(P.startDate);
      d.setDate(d.getDate() + i * 7);
      return { id: "w" + (i + 1), startDate: keyFor(d), phase: "bulk", targets: { ...P.targets } };
    });
  }
  // Expand legacy cycles (each `weeks` weeks long) into individual 1-week entries,
  // defaulted to the bulk phase and carrying the cycle's targets.
  function migrateCycles(cys) {
    const out = [];
    cys.forEach((cy) => {
      for (let w = 0; w < (cy.weeks || 1); w++) {
        const d = parseKey(cy.startDate);
        d.setDate(d.getDate() + w * 7);
        out.push({ id: cy.id + "_w" + w, startDate: keyFor(d), phase: "bulk", targets: { ...cy.targets } });
      }
    });
    return out;
  }
  const sortWeeks = (arr) => arr.slice().sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  // Backfill fiber/added-sugar targets on weeks saved before those existed, so
  // T.fiber / T.sugar are always defined. Returns true if anything changed.
  function normalizeWeeks(arr) {
    let changed = false;
    arr.forEach((wk) => {
      if (wk.targets && wk.targets.fiber == null) {
        wk.targets = { ...wk.targets, fiber: phaseTargets(phaseOf(wk)).fiber };
        changed = true;
      }
      if (wk.targets && wk.targets.sugar == null) {
        wk.targets = { ...wk.targets, sugar: phaseTargets(phaseOf(wk)).sugar };
        changed = true;
      }
    });
    return changed;
  }
  // Load weeks oldest-first; migrate from legacy cycles or seed from PLAN once.
  function loadWeeks() {
    let w = window.Store.getWeeks();
    if (!w || !w.length) {
      const cys = window.Store.getCycles();
      w = cys && cys.length ? migrateCycles(cys) : seedWeeks();
      window.Store.setWeeks(w);
    } else if (normalizeWeeks(w)) {
      window.Store.setWeeks(w);
    }
    return sortWeeks(w);
  }

  let weeks = loadWeeks();
  let view = "weeks";     // "log" | "weeks" — land on the diet week plan after login
  let activeWeekId;       // which week the log page is showing
  let expandedId = null;  // week expanded in the Weeks list (inline editor)
  let showWeekAvg = false; // profile: weekly-average list collapsed by default
  let swipedWeekId = null; // week row slid open revealing its Delete action
  // Land on the week containing today, else the most recent week.
  (function initActive() {
    activeWeekId = currentWeekId() || weeks[weeks.length - 1].id;
  })();
  // The week currently shown on the log page (fallback keeps things sane if an id
  // goes stale after a cloud sync replaces the weeks array).
  function activeWeek() { return weeks.find((w) => w.id === activeWeekId) || weeks[weeks.length - 1]; }
  // Index (0-based) of a week in the ordered list — drives the "Week N" labels.
  const weekIndex = (id) => weeks.findIndex((w) => w.id === id);
  // Persist + keep the list ordered after any week mutation.
  function saveWeeks() { weeks = sortWeeks(weeks); flash(window.Store.setWeeks(weeks)); }

  // ---- state ----
  let logs = window.Store.getLogs();
  let weights = window.Store.getWeights();
  // Weight display unit. Weights are always stored in kg; this only affects how
  // they're shown and how typed input is interpreted.
  let unit = window.Store.getUnit();
  const KG_PER_LB = 0.45359237;
  const toDisplay = (kg) => (unit === "lb" ? kg / KG_PER_LB : kg);
  const fromDisplay = (v) => (unit === "lb" ? v * KG_PER_LB : v);
  // Round to 1 decimal, drop a trailing ".0" so whole numbers stay clean.
  const fmtW = (n) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  // Regroup a legacy meal-keyed catalog into macro categories by dominant macro.
  // (Snacks isn't auto-filled — the user files snacky foods there themselves.)
  function migrateFoods(old) {
    const out = {};
    CATEGORIES.forEach((c) => (out[c] = []));
    Object.keys(old).forEach((slot) => {
      (old[slot] || []).forEach((f) => {
        if (f.to) return; // was a date-scoped deletion; drop from the fresh catalog
        const { to, s, ...clean } = f; // strip legacy per-day delete/slot fields
        const cat = catForMacro(macroOf(f));
        (out[cat] = out[cat] || []).push(clean);
      });
    });
    return out;
  }
  // The catalog: the user's saved library, migrated from the old meal-keyed shape
  // if needed, or a fresh copy of the PLAN default the first time.
  function loadFoods() {
    const saved = window.Store.getFoods();
    if (!saved) return JSON.parse(JSON.stringify(P.foods));
    if (CATEGORIES.some((c) => c in saved)) return saved; // already category-keyed
    const migrated = migrateFoods(saved);
    window.Store.setFoods(migrated); // persist the one-time migration
    return migrated;
  }
  let foods = loadFoods();
  let selected = todayOrFirst(weekDates(activeWeek()));
  let tab = "log"; // log (journal) | catalog | newfood (create form)
  let editQty = null; // index of the journal item whose qty box is being edited
  let mealPickFor = null; // { cat, i } of the catalog food whose meal dropdown is open
  let catOpen = {}; // { <category>: true } — which catalog categories are expanded
  // Quantity display: drop a trailing ".0" so whole numbers stay clean.
  const fmtQ = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  let lastSlot = CATEGORIES[0]; // category a freshly-created food lands in
  let lastUnit = "g"; // measurement unit last chosen in the New food form
  let authMsg = "";      // transient cloud-sync status/error message
  let authReady = false; // has the Firebase SDK reported initial auth state yet?
  let localOnly = false; // user chose to skip login and use this device only

  // Cloud sync: when the Store pulls remote data, reload our state and re-render.
  window.Store.onSync(() => {
    logs = window.Store.getLogs();
    weights = window.Store.getWeights();
    foods = loadFoods();
    weeks = loadWeeks();
    if (!weeks.some((w) => w.id === activeWeekId)) activeWeekId = weeks[weeks.length - 1].id;
    selected = todayOrFirst(weekDates(activeWeek()));
    unit = window.Store.getUnit();
    render();
  });
  // The Firebase SDK loads async (index.html module). Once ready, react to auth
  // state: on sign-in/restore, pull remote data; always re-render to update the
  // sync panel. Also re-pull when the tab regains focus (e.g. switching devices).
  function wireAuth() {
    window.FBAuth.onChange(() => { authReady = true; authMsg = ""; window.Store.syncInit(); render(); });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) window.Store.syncInit();
    });
  }
  if (window.FBAuth) wireAuth();
  else window.addEventListener("fbauth-ready", wireAuth, { once: true });
  // live drag state; null fields when not dragging
  let drag = { active: false }, dragSource = null, dragClone = null, dragPh = null, dragOff = null, dragCtx = null;

  // ---- derived ----
  const dayItems = () => logs[selected] || [];
  const totals = () =>
    dayItems().filter(isEaten).reduce(
      (a, it) => {
        const q = it.q || 1;
        return { c: a.c + it.c * q, p: a.p + it.p * q, cb: a.cb + it.cb * q, f: a.f + it.f * q, fi: a.fi + (it.fi || 0) * q, sg: a.sg + (it.sg || 0) * q };
      },
      { c: 0, p: 0, cb: 0, f: 0, fi: 0, sg: 0 }
    );
  const weekAvg = (days) => {
    const vals = days
      .map((d) => weights[keyFor(d)])
      .filter((v) => typeof v === "number" && v > 0);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length; // kg
  };

  // ---- mutations ----
  let flashT = null;
  function flash(ok) {
    const el = document.getElementById("saveBadge");
    if (!el) return;
    el.textContent = ok ? "✓ saved" : "save failed";
    el.className = "badge " + (ok ? "ok" : "err");
    clearTimeout(flashT);
    flashT = setTimeout(() => {
      el.textContent = "";
      el.className = "badge";
    }, 1500);
  }
  function saveLogs() { flash(window.Store.setLogs(logs)); }
  function saveWeights() { flash(window.Store.setWeights(weights)); }

  function addItem(item) {
    logs = { ...logs, [selected]: [...dayItems(), item] };
    saveLogs();
    render();
  }
  // A journal item is a snapshot of a catalog food dropped into a meal. Macros are
  // stored "per base amount" `b` (default 1 — a single serving); effective macros =
  // stored macros × multiplier `q`. The red box shows the *amount* the user thinks
  // in (q × b): servings for plan foods, or grams for custom foods whose macros
  // were entered per N units. `s` is the meal it sits in.
  function snapItem(meal, p, q) {
    return { n: p.n, c: p.c, p: p.p, cb: p.cb, f: p.f, fi: p.fi || 0, sg: p.sg || 0, s: meal, q, b: p.b || 1, u: p.u || "" };
  }
  // Amount label for the red box: the amount (q × b) with its unit, e.g. "200 g".
  const amountLabel = (amt, u) => fmtQ(amt) + (u ? " " + u : "");
  // Plan a catalog food into a meal for the selected day. It lands greyed out
  // (eaten:false) and doesn't count toward totals until it's tapped to "eaten".
  function planFood(meal, p) {
    mealPickFor = null;
    addItem({ ...snapItem(meal, p, p.q || 1), eaten: false });
  }
  // Tap a journal item to flip planned⇄eaten. Only eaten items count in totals().
  function toggleEaten(idx) {
    const items = dayItems().slice();
    if (!items[idx]) return;
    items[idx] = { ...items[idx], eaten: !isEaten(items[idx]) };
    logs = { ...logs, [selected]: items };
    saveLogs();
    render();
  }
  // Remove a single journal item from the selected day.
  function removeJournalItem(idx) {
    const items = dayItems().slice();
    if (idx < 0 || idx >= items.length) return;
    items.splice(idx, 1);
    logs = { ...logs, [selected]: items };
    saveLogs();
    render();
  }
  // Commit an edited amount (q × b) for one journal item on the selected day; the
  // typed value is an amount, converted back to the stored multiplier `q`.
  function commitJournalQty(idx, val) {
    editQty = null;
    const items = dayItems().slice();
    const it = items[idx];
    if (!it) return render();
    const base = it.b || 1;
    let amt = parseFloat(val);
    if (!isFinite(amt) || amt <= 0) amt = base; // fall back to one base unit
    items[idx] = { ...it, q: Math.round((amt / base) * 1000) / 1000 };
    logs = { ...logs, [selected]: items };
    saveLogs();
    render();
  }

  function saveFoods() { flash(window.Store.setFoods(foods)); }
  // Reorder / move a catalog food between categories (press-and-hold drag).
  function moveFood(fromCat, fromIdx, toCat, toIdx) {
    const [moved] = foods[fromCat].splice(fromIdx, 1);
    if (!moved) return render();
    (foods[toCat] = foods[toCat] || []).splice(toIdx, 0, moved);
    saveFoods();
    render();
  }
  // Delete a food from the catalog. Journal entries are independent snapshots, so
  // days that already planned this food keep their logs untouched.
  function deleteCatalogFood(cat, i) {
    if (!foods[cat] || !foods[cat][i]) return;
    foods[cat] = foods[cat].slice();
    foods[cat].splice(i, 1);
    saveFoods();
    render();
  }
  let wT = null;
  function setWeight(val) {
    // Input is in the current display unit; store canonical kg (3 dp to avoid
    // float drift when toggling units back and forth).
    const kg = val === "" ? "" : Math.round(fromDisplay(Number(val)) * 1000) / 1000;
    weights = { ...weights, [selected]: kg };
    clearTimeout(wT);
    wT = setTimeout(saveWeights, 400);
  }
  function toggleUnit() {
    unit = unit === "kg" ? "lb" : "kg";
    window.Store.setUnit(unit);
    render();
  }

  // ---- tiny DOM helper ----
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "style") e.setAttribute("style", attrs[k]);
        else if (k === "class") e.className = attrs[k];
        else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (k === "value") e.value = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    kids.flat().forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  // ---- drag & drop (press-and-hold to reorder / move across sections) ----
  // Generic engine shared by the log (vertical lists) and Quick add (wrap
  // grids). A ctx describes the DOM shape + how to commit a move:
  //   { bodySel, itemSel, grid, onBegin?, commit }
  // Works with touch and mouse via pointer events; no libraries.
  const foodDragCtx = { bodySel: ".presets", itemSel: ".preset", grid: false,
    onBegin: null, commit: moveFood };

  function makeDraggable(card, slot, idx, ctx) {
    card.addEventListener("pointerdown", (e) => {
      if (drag.active || e.target.closest(".x, .qty, .qinput, .pdel")) return; // ignore qty box + delete
      const sx = e.clientX, sy = e.clientY;
      let holdT = setTimeout(() => { teardown(); beginDrag(card, slot, idx, ctx, sx, sy); }, 250);
      const onMove = (ev) => {
        if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) cancel();
      };
      const cancel = () => { clearTimeout(holdT); teardown(); };
      const teardown = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cancel);
        window.removeEventListener("pointercancel", cancel);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cancel);
      window.addEventListener("pointercancel", cancel);
    });
  }

  function beginDrag(card, fromSlot, fromIdx, ctx, x, y) {
    drag = { active: true, fromSlot, fromIdx };
    dragCtx = ctx;
    dragSource = card;
    if (ctx.onBegin) ctx.onBegin(); // e.g. reveal empty log sections
    const r = card.getBoundingClientRect();
    dragOff = { x: x - r.left, y: y - r.top };
    dragClone = card.cloneNode(true);
    dragClone.classList.add("dragClone");
    dragClone.style.width = r.width + "px";
    dragClone.style.left = r.left + "px";
    dragClone.style.top = r.top + "px";
    document.body.appendChild(dragClone);
    dragPh = el("div", { class: "placeholder" });
    dragPh.style.height = r.height + "px";
    if (ctx.grid) dragPh.style.width = r.width + "px";
    card.parentElement.insertBefore(dragPh, card);
    card.style.display = "none";
    if (navigator.vibrate) navigator.vibrate(12);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  function onDragMove(e) {
    e.preventDefault();
    dragClone.style.left = (e.clientX - dragOff.x) + "px";
    dragClone.style.top = (e.clientY - dragOff.y) + "px";
    // edge auto-scroll
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    // find drop target under the pointer (hide clone so it isn't picked)
    dragClone.style.display = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    dragClone.style.display = "";
    const body = under && under.closest(dragCtx.bodySel);
    if (!body) return;
    const hint = body.querySelector(".dropHint");
    if (hint) hint.remove();
    const cards = [...body.querySelectorAll(dragCtx.itemSel)].filter((c) => c !== dragSource);
    let ref;
    if (dragCtx.grid) {
      // wrap grid: drop next to the chip whose center is nearest the pointer
      let best = null, bestD = Infinity;
      for (const c of cards) {
        const cr = c.getBoundingClientRect();
        const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (d < bestD) { bestD = d; best = { c, cx }; }
      }
      ref = best ? (e.clientX < best.cx ? best.c : best.c.nextElementSibling) : null;
    } else {
      // vertical list: drop above the first chip past the pointer's midline
      ref = null;
      for (const c of cards) {
        const cr = c.getBoundingClientRect();
        if (e.clientY < cr.top + cr.height / 2) { ref = c; break; }
      }
    }
    if (ref === dragPh) return;
    if (ref) body.insertBefore(dragPh, ref);
    else body.appendChild(dragPh);
  }

  function endDrag() {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    const body = dragPh.parentElement;
    const toSlot = body ? body.getAttribute("data-slot") : drag.fromSlot;
    let toIdx = 0;
    if (body) {
      for (const c of body.children) {
        if (c === dragPh) break;
        if (c.matches(dragCtx.itemSel) && c !== dragSource) toIdx++;
      }
    }
    if (dragClone) dragClone.remove();
    if (dragPh) dragPh.remove();
    if (dragSource) dragSource.style.display = "";
    // swallow the click that fires after releasing a drag on a tappable chip
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    const { fromSlot, fromIdx } = drag, ctx = dragCtx;
    drag = { active: false };
    dragSource = dragClone = dragPh = dragOff = dragCtx = null;
    ctx.commit(fromSlot, fromIdx, toSlot, toIdx);
  }

  // Login gate. When sync is configured and the user hasn't signed in (and hasn't
  // chosen local-only), show the login screen instead of the app.
  function renderLogin() {
    const wrap = el("div", { class: "wrap login" });
    const card = el("div", { class: "loginCard" },
      el("div", { class: "eyebrow lime" }, "2-Week Lean Bulk"),
      el("h1", null, "Meal Log"),
      el("div", { class: "sub" }, "Sign in to sync your meals & weight across every device.")
    );
    const ready = authReady && window.Store.isSyncReady();
    const btn = el("button", { class: "addBtn", style: "margin-top:20px", onClick: async () => {
      authMsg = "Opening Google sign-in…"; render();
      try { await window.Store.signInWithGoogle(); authMsg = ""; render(); } // onChange renders the app
      catch (e) { authMsg = authError(e && (e.code || e.message)); render(); }
    } }, ready ? "Sign in with Google" : "Loading sign-in…");
    if (!ready) btn.setAttribute("disabled", "true");
    card.appendChild(btn);
    if (authMsg) card.appendChild(el("div", { class: "sub", style: "margin-top:10px" }, authMsg));
    card.appendChild(el("button", { class: "linklike",
      onClick: () => { localOnly = true; render(); } }, "Use on this device only"));
    wrap.appendChild(card);
    return wrap;
  }

  // ---- weeks view ----
  const fmtDate = (key) => parseKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtRange = (r) => `${fmtDate(r.start)} – ${fmtDate(r.end)}`;

  // Jump to a week on the log page.
  function openWeek(wk) {
    activeWeekId = wk.id;
    selected = todayOrFirst(weekDates(wk));
    view = "log"; expandedId = null; render();
  }
  // Append a new week, contiguous with the last one, continuing its phase/targets.
  // Auto-expand its editor so the phase/targets can be tweaked right away.
  function addWeek() {
    const last = weeks[weeks.length - 1];
    const after = parseKey(weekRange(last).end);
    after.setDate(after.getDate() + 1);
    const wk = { id: "w" + Date.now(), startDate: keyFor(after), phase: phaseOf(last), targets: { ...last.targets } };
    weeks = [...weeks, wk];
    saveWeeks();
    expandedId = wk.id;
    render();
  }
  // Remove a week (its date-keyed logs & weights are left untouched). Always keep
  // at least one week so the log page has something to show.
  function deleteWeek(wk) {
    if (weeks.length <= 1) { alert("Keep at least one week."); return; }
    if (!confirm(`Delete Week ${weekIndex(wk.id) + 1}? Logs & weights for those days are kept.`)) return;
    weeks = weeks.filter((w) => w.id !== wk.id);
    if (activeWeekId === wk.id) activeWeekId = currentWeekId() || weeks[weeks.length - 1].id;
    if (expandedId === wk.id) expandedId = null;
    saveWeeks();
    render();
  }

  // The three phase pills that recolor a week and pre-fill its targets.
  function phasePills(wk) {
    return el("div", { class: "phasePills" },
      PHASE_ORDER.map((ph) => el("button", {
        class: "phasePill " + PHASES[ph].cls + (phaseOf(wk) === ph ? " on" : ""),
        onClick: (e) => {
          e.stopPropagation();
          wk.phase = ph;
          wk.targets = phaseTargets(ph); // pre-fill suggested targets (still editable)
          saveWeeks(); render();
        },
      }, PHASES[ph].label))
    );
  }

  // Inline editor revealed under an expanded week row: phase, targets, start date.
  function weekEditor(wk) {
    const mk = (key) => {
      const inp = el("input", { class: "ci", inputmode: "numeric", placeholder: key, value: String(wk.targets[key]) });
      inp.addEventListener("change", () => { wk.targets = { ...wk.targets, [key]: +inp.value || 0 }; saveWeeks(); });
      return inp;
    };
    const sd = el("input", { class: "ci", type: "date", value: wk.startDate });
    sd.addEventListener("change", () => {
      wk.startDate = sd.value || wk.startDate;
      saveWeeks();
      if (activeWeekId === wk.id) selected = todayOrFirst(weekDates(wk));
      render();
    });
    return el("div", { class: "weekEditor" },
      el("div", { class: "edLabel" }, "Phase"),
      phasePills(wk),
      el("div", { class: "edLabel" }, "Targets (cal · protein · carbs · fat · fiber · added sugar)"),
      el("div", { class: "crow" }, mk("cal"), mk("protein")),
      el("div", { class: "crow" }, mk("carbs"), mk("fat")),
      el("div", { class: "crow" }, mk("fiber"), mk("sugar")),
      el("div", { class: "edLabel" }, "Start date"),
      sd,
      el("div", { class: "crow" },
        el("button", { class: "tool", onClick: () => deleteWeek(wk) }, "Delete week"),
        el("button", { class: "addBtn", onClick: () => openWeek(wk) }, "Open week →")
      )
    );
  }

  function renderWeeks() {
    const wrap = el("div", { class: "wrap" });
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("div", { class: "eyebrow lime" }, "Diet plan"),
          el("h1", null, "Weeks")
        ),
        el("button", { class: "profBtn", title: "Profile", onClick: () => { view = "profile"; render(); } },
          profInitial())
      )
    );
    wrap.appendChild(el("button", { class: "addBtn", style: "margin-bottom:10px", onClick: addWeek }, "+ New week"));

    const nowId = currentWeekId();
    // Newest week on top.
    weeks.slice().reverse().forEach((wk) => {
      const idx = weekIndex(wk.id);
      const r = weekRange(wk);
      const isCurrent = wk.id === nowId;
      const expanded = expandedId === wk.id;
      const ph = PHASES[phaseOf(wk)];
      const avg = weekAvg(weekDates(wk));
      const container = el("div", { class: "weekItem" });
      // Swipe a row left to reveal Edit & Remove actions behind it.
      const editLayer = el("button", { class: "swipeBtn swipeEdit", title: "Edit week",
        onClick: (e) => { e.stopPropagation(); swipedWeekId = null; expandedId = wk.id; render(); } }, "Edit");
      const delLayer = el("button", { class: "swipeBtn swipeDel", title: "Remove week",
        onClick: (e) => { e.stopPropagation(); swipedWeekId = null; deleteWeek(wk); render(); } }, "Remove");
      const row = el("div", { class: "weekRow2 " + ph.cls + (isCurrent ? " current" : "") },
        el("div", { class: "weekMeta",
          onClick: () => { if (swipedWeekId === wk.id) { swipedWeekId = null; render(); } else openWeek(wk); } },
          el("div", { class: "weekTitle" }, `Week ${idx + 1}`,
            el("span", { class: "phaseTag " + ph.cls }, ph.label),
            isCurrent ? el("span", { class: "curTag" }, "now") : ""),
          el("div", { class: "sub" }, `${fmtRange(r)} · ${wk.targets.cal.toLocaleString()} cal`)
        ),
        el("div", { class: "weekRight" },
          el("div", { class: "weekAvg" + (avg != null ? "" : " muted") },
            avg != null ? fmtW(toDisplay(avg)) : "—", el("span", { class: "wcu" }, " " + unit)),
          el("button", { class: "chevBtn", title: "Edit week",
            onClick: (e) => { e.stopPropagation(); expandedId = expanded ? null : wk.id; render(); } },
            expanded ? "▾" : "▸")
        )
      );
      makeWeekSwipe(row, wk);
      container.appendChild(el("div", { class: "swipeWrap" },
        el("div", { class: "swipeAct" }, editLayer, delLayer), row));
      if (expanded) container.appendChild(weekEditor(wk));
      wrap.appendChild(container);
    });

    return wrap;
  }

  // Slide a week row left to reveal its Edit & Remove buttons; release past a
  // threshold to leave it open, otherwise it snaps back. Vertical drags scroll.
  function makeWeekSwipe(row, wk) {
    const OPEN = -168, THRESH = 84;
    let startX = 0, startY = 0, t = 0, active = false, decided = false;
    row.style.transition = "transform .18s ease";
    row.style.transform = swipedWeekId === wk.id ? `translateX(${OPEN}px)` : "translateX(0)";
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      t = swipedWeekId === wk.id ? OPEN : 0;
      active = true; decided = false;
      row.style.transition = "none";
    });
    row.addEventListener("pointermove", (e) => {
      if (!active) return;
      const mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        if (Math.abs(my) > Math.abs(mx)) { active = false; return; } // vertical → let it scroll
        decided = true;
        row.setPointerCapture(e.pointerId);
      }
      const base = swipedWeekId === wk.id ? OPEN : 0;
      t = Math.max(OPEN, Math.min(0, base + mx));
      row.style.transform = `translateX(${t}px)`;
      e.preventDefault();
    });
    const end = () => {
      if (!active) return;
      active = false;
      row.style.transition = "transform .18s ease";
      const stayOpen = t < -THRESH;
      swipedWeekId = stayOpen ? wk.id : (swipedWeekId === wk.id ? null : swipedWeekId);
      row.style.transform = `translateX(${stayOpen ? OPEN : 0}px)`;
      if (decided) { // swallow the click that fires after a real swipe
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  }

  // Letter shown inside the round profile button (signed-in email initial).
  function profInitial() {
    const user = window.Store.getUser();
    const c = user && user.email ? user.email.trim()[0] : "";
    return c ? c.toUpperCase() : "☻";
  }

  // ---- profile view: account + simple analysis over all logged data ----
  // Effective macros for any day key (mirrors totals(), but for an arbitrary day).
  function dayMacros(key) {
    return (logs[key] || []).filter(isEaten).reduce((a, it) => {
      const q = it.q || 1;
      return { c: a.c + it.c * q, p: a.p + it.p * q, cb: a.cb + it.cb * q, f: a.f + it.f * q, fi: a.fi + (it.fi || 0) * q, sg: a.sg + (it.sg || 0) * q };
    }, { c: 0, p: 0, cb: 0, f: 0, fi: 0, sg: 0 });
  }

  function statTile(value, unitStr, label) {
    return el("div", { class: "statTile" },
      el("div", { class: "statVal" }, value, unitStr ? el("span", { class: "statUnit" }, " " + unitStr) : ""),
      el("div", { class: "statLab" }, label)
    );
  }

  // A small inline SVG line chart of every weigh-in over time, plotted by date
  // (so gaps between weigh-ins show as gaps) and in the current display unit.
  // `keys` are sorted, filtered date keys that all have a positive weight.
  function weightChart(keys) {
    const W = 320, H = 150, padL = 30, padR = 12, padT = 12, padB = 22;
    const pts = keys.map((k) => ({ t: parseKey(k).getTime(), v: toDisplay(weights[k]) }));
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, spanT = t1 - t0 || 1;
    const dataLo = Math.min(...pts.map((p) => p.v)), dataHi = Math.max(...pts.map((p) => p.v));
    let lo = dataLo, hi = dataHi;
    if (hi === lo) { hi += 1; lo -= 1; }           // flat data: give the axis room
    const padV = (hi - lo) * 0.15; lo -= padV; hi += padV;
    const x = (t) => padL + ((t - t0) / spanT) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const area = `${x(t0).toFixed(1)},${(H - padB).toFixed(1)} ${line} ${x(t1).toFixed(1)},${(H - padB).toFixed(1)}`;
    const dots = pts.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" fill="var(--lime)"/>`).join("");
    const axisDate = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const svg =
      `<svg viewBox="0 0 ${W} ${H}" class="wchart" role="img" aria-label="Weight over time">` +
        `<polyline points="${area}" fill="rgba(197,240,74,.10)" stroke="none"/>` +
        `<polyline points="${line}" fill="none" stroke="var(--lime)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        dots +
        `<text x="0" y="${(y(dataHi) + 3).toFixed(1)}" class="wcaxis">${fmtW(dataHi)}</text>` +
        `<text x="0" y="${(y(dataLo) + 3).toFixed(1)}" class="wcaxis">${fmtW(dataLo)}</text>` +
        `<text x="${padL}" y="${H - 6}" class="wcaxis">${axisDate(t0)}</text>` +
        (t1 > t0 ? `<text x="${W - padR}" y="${H - 6}" text-anchor="end" class="wcaxis">${axisDate(t1)}</text>` : "") +
      `</svg>`;
    const box = el("div", { class: "wchartBox" });
    box.innerHTML = svg;
    return box;
  }

  function renderProfile() {
    const wrap = el("div", { class: "wrap" });
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("div", { class: "eyebrow lime" }, "Account"),
          el("h1", null, "Profile")
        ),
        el("button", { class: "iconBtn", title: "Back to weeks",
          onClick: () => { view = "weeks"; render(); } }, "‹")
      )
    );

    // account card
    const user = window.Store.getUser();
    const acct = el("div", { class: "card" });
    if (user) {
      acct.appendChild(el("div", { class: "eyebrow lime" }, "Signed in"));
      acct.appendChild(el("div", { class: "profEmail" }, user.email));
      acct.appendChild(el("div", { class: "sub" }, "Your meals & weight sync across every device."));
      acct.appendChild(el("button", { class: "tool", style: "margin-top:14px",
        onClick: () => { window.Store.signOut(); authMsg = ""; view = "weeks"; render(); } }, "Sign out"));
    } else {
      acct.appendChild(el("div", { class: "eyebrow lime" }, "This device only"));
      acct.appendChild(el("div", { class: "sub" }, "Not signed in — data stays on this device."));
      if (window.Store.isSyncConfigured()) {
        const btn = el("button", { class: "addBtn", style: "margin-top:12px", onClick: async () => {
          authMsg = "Opening Google sign-in…"; render();
          try { await window.Store.signInWithGoogle(); authMsg = ""; render(); }
          catch (e) { authMsg = authError(e && (e.code || e.message)); render(); }
        } }, window.Store.isSyncReady() ? "Sign in with Google" : "Loading sign-in…");
        if (!window.Store.isSyncReady()) btn.setAttribute("disabled", "true");
        acct.appendChild(btn);
        if (authMsg) acct.appendChild(el("div", { class: "sub", style: "margin-top:8px" }, authMsg));
      }
    }
    wrap.appendChild(acct);

    // ---- nutrition analysis (over every logged day) ----
    const loggedDays = Object.keys(logs).filter((k) => (logs[k] || []).some(isEaten));
    const sum = loggedDays.reduce((a, k) => {
      const m = dayMacros(k);
      return { c: a.c + m.c, p: a.p + m.p, cb: a.cb + m.cb, f: a.f + m.f, fi: a.fi + m.fi, sg: a.sg + m.sg };
    }, { c: 0, p: 0, cb: 0, f: 0, fi: 0, sg: 0 });
    const n = loggedDays.length;
    const avg = (x) => (n ? Math.round(x / n) : 0);

    const nutri = el("div", { class: "card" }, el("div", { class: "eyebrow lime" }, "Nutrition"));
    if (n) {
      nutri.appendChild(el("div", { class: "statGrid" },
        statTile(n.toLocaleString(), "", "Days logged"),
        statTile(avg(sum.c).toLocaleString(), "cal", "Avg / day"),
        statTile(avg(sum.p).toLocaleString(), "g", "Avg protein"),
        statTile(avg(sum.cb).toLocaleString(), "g", "Avg carbs"),
        statTile(avg(sum.f).toLocaleString(), "g", "Avg fat"),
        statTile(avg(sum.fi).toLocaleString(), "g", "Avg fiber"),
        statTile(avg(sum.sg).toLocaleString(), "g", "Avg added sugar")
      ));
    } else {
      nutri.appendChild(el("div", { class: "empty" }, "No meals logged yet."));
    }
    wrap.appendChild(nutri);

    // ---- weight analysis ----
    const wKeys = Object.keys(weights)
      .filter((k) => typeof weights[k] === "number" && weights[k] > 0)
      .sort();
    const weight = el("div", { class: "card" }, el("div", { class: "eyebrow lime" }, "Weight"));
    if (wKeys.length) {
      const first = weights[wKeys[0]], last = weights[wKeys[wKeys.length - 1]];
      const delta = toDisplay(last) - toDisplay(first);
      const sign = delta > 0 ? "+" : "";
      weight.appendChild(el("div", { class: "statGrid" },
        statTile(fmtW(toDisplay(first)), unit, "Start"),
        statTile(fmtW(toDisplay(last)), unit, "Latest"),
        statTile(sign + fmtW(delta), unit, "Change"),
        statTile(wKeys.length.toLocaleString(), "", "Weigh-ins")
      ));
      // Line chart of every weigh-in over time (needs at least two points).
      if (wKeys.length >= 2) {
        weight.appendChild(el("div", { class: "edLabel", style: "margin-top:16px" }, "Trend"));
        weight.appendChild(weightChart(wKeys));
      }
      // Per-week average trend (only weeks that have at least one weigh-in).
      const trend = weeks
        .map((wk) => ({ wk, a: weekAvg(weekDates(wk)) }))
        .filter((x) => x.a != null);
      if (trend.length) {
        weight.appendChild(el("button", { class: "collapseHdr", style: "margin-top:14px",
          onClick: () => { showWeekAvg = !showWeekAvg; render(); } },
          el("span", { class: "edLabel", style: "margin:0" }, "Weekly average"),
          el("span", { class: "collapseChev" }, showWeekAvg ? "▾" : "▸")
        ));
        if (showWeekAvg) {
          trend.forEach(({ wk, a }) => {
            weight.appendChild(el("div", { class: "trendRow" },
              el("span", { class: "sub" }, `Week ${weekIndex(wk.id) + 1}`),
              el("span", { class: "trendVal" }, fmtW(toDisplay(a)), el("span", { class: "wcu" }, " " + unit))
            ));
          });
        }
      }
    } else {
      weight.appendChild(el("div", { class: "empty" }, "No weigh-ins yet."));
    }
    wrap.appendChild(weight);

    // ---- backup / restore ----
    const backup = el("div", { class: "card" },
      el("div", { class: "eyebrow lime" }, "Backup"),
      el("div", { class: "sub" }, "Export your data to a file, or restore it from one."),
      el("div", { class: "tools", style: "margin-top:14px" },
        el("button", { class: "tool", onClick: exportData }, "Export backup"),
        el("button", { class: "tool", onClick: importData }, "Import backup")
      )
    );
    wrap.appendChild(backup);

    return wrap;
  }

  // ---- render ----
  function render() {
    const root = document.getElementById("root");
    root.innerHTML = "";
    if (window.Store.isSyncConfigured() && !localOnly && !window.Store.getUser()) {
      root.appendChild(renderLogin());
      return;
    }
    if (view === "weeks") { root.appendChild(renderWeeks()); return; }
    if (view === "profile") { root.appendChild(renderProfile()); return; }

    const wk = activeWeek();
    const idx = weekIndex(wk.id);
    const ph = PHASES[phaseOf(wk)];
    const T = wk.targets; // active week's macro targets drive the whole log page
    const tt = totals();

    const wrap = el("div", { class: "wrap" });

    // header
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("button", { class: "backbtn", onClick: () => { view = "weeks"; expandedId = null; render(); } }, "‹ Weeks"),
          el("h1", null, `Week ${idx + 1}`,
            el("span", { class: "phaseTag " + ph.cls, style: "margin-left:10px;vertical-align:middle" }, ph.label)),
          el("div", { class: "sub" }, `Target ${T.cal.toLocaleString()} cal · ${T.protein}g protein floor`)
        ),
        el("div", { id: "saveBadge", class: "badge" })
      )
    );

    // navigation between weeks in the plan
    const goTo = (i) => {
      const w = weeks[Math.min(Math.max(0, i), weeks.length - 1)];
      activeWeekId = w.id;
      selected = todayOrFirst(weekDates(w));
      render();
    };
    const prevBtn = el("button", { class: "wkarrow", onClick: () => goTo(idx - 1) }, "‹");
    if (idx === 0) prevBtn.setAttribute("disabled", "true");
    const nextBtn = el("button", { class: "wkarrow", onClick: () => goTo(idx + 1) }, "›");
    if (idx === weeks.length - 1) nextBtn.setAttribute("disabled", "true");
    wrap.appendChild(el("div", { class: "wknav" },
      prevBtn,
      el("div", { class: "wklabel" }, `Week ${idx + 1} of ${weeks.length}`),
      nextBtn
    ));

    // day strip
    const strip = el("div", { class: "strip" });
    weekDates(wk).forEach((d) => {
      const k = keyFor(d);
      const active = k === selected;
      const logged = (logs[k] || []).length > 0;
      strip.appendChild(
        el("button", { class: "day" + (active ? " active" : ""), onClick: () => { selected = k; render(); } },
          el("div", { class: "dow" }, d.toLocaleDateString("en-US", { weekday: "short" })),
          el("div", { class: "dnum" }, String(d.getDate())),
          el("div", { class: "dot" + (logged ? " on" : "") })
        )
      );
    });
    wrap.appendChild(strip);

    // totals card
    const card = el("div", { class: "card" });
    const wInput = (function () {
      const w = weights[selected];
      const shown = w === "" || w == null ? "" : fmtW(toDisplay(w));
      return el("input", { class: "winput", inputmode: "decimal", placeholder: "—",
        value: shown, onInput: (e) => setWeight(e.target.value) });
    })();
    const topRow = el("div", { class: "topTiles" },
      (function () {
        const now = Math.round(tt.c);
        const ratio = T.cal > 0 ? tt.c / T.cal : 0;
        const overAmt = Math.max(0, now - T.cal);
        return el("div", { class: "topTile" },
          el("div", { class: "topLabel" }, "Calories"),
          el("div", { class: "calLine" },
            el("span", { class: "calNow" }, now.toLocaleString()),
            el("span", { class: "calTgt" }, " / " + T.cal.toLocaleString())
          ),
          el("div", { class: "calBarRow" },
            el("div", { class: "calTrack" },
              el("div", { class: "calFill" + (ratio > 1 ? " over" : ""), style: `width:${Math.min(100, Math.round(ratio * 100))}%` })),
            el("div", { class: "calPct" }, Math.round(ratio * 100) + "%")
          ),
          el("div", { class: "sub" }, overAmt > 0
            ? `${overAmt.toLocaleString()} over`
            : `${Math.max(0, T.cal - now).toLocaleString()} left`)
        );
      })(),
      el("div", { class: "topTile" },
        el("div", { class: "topLabel" }, "Weight"),
        el("div", { class: "wRow" }, wInput,
          el("button", { class: "wunit", title: "Tap to switch units", onClick: toggleUnit }, unit)),
        (function () {
          const vals = weekDates(wk).map((d) => weights[keyFor(d)])
            .filter((v) => typeof v === "number" && v > 0).map(toDisplay);
          if (vals.length < 2) return el("div", { class: "sub wHint" }, "Log each morning");
          const delta = vals[vals.length - 1] - vals[0];
          const arrow = delta > 0.05 ? "▲" : delta < -0.05 ? "▼" : "–";
          return el("div", { class: "sub wDelta" }, `${arrow} ${fmtW(Math.abs(delta))} ${unit} this week`);
        })()
      )
    );
    card.appendChild(topRow);
    card.appendChild(el("div", { class: "macroScroll" },
      macroRing("Protein", tt.p, T.protein, RING.protein),
      macroRing("Carbs", tt.cb, T.carbs, RING.carbs),
      macroRing("Fat", tt.f, T.fat, RING.fat),
      macroRing("Fiber", tt.fi, T.fiber, RING.fiber),
      macroRing("Added sugar", tt.sg, T.sugar, RING.sugar)
    ));
    wrap.appendChild(card);

    // tabs
    wrap.appendChild(
      el("div", { class: "tabs" },
        el("button", { class: "tab" + (tab === "log" ? " active" : ""), onClick: () => { tab = "log"; render(); } }, "Log items"),
        el("button", { class: "tab" + (tab === "catalog" || tab === "newfood" ? " active" : ""), onClick: () => { tab = "catalog"; render(); } }, "Catalog")
      )
    );

    if (tab === "log") {
      // The day's journal, grouped by meal. Planned items are grey; tapping one
      // marks it eaten (its macro colour) and makes it count toward the rings.
      const items = dayItems();
      let any = false;
      MEALS.forEach((meal) => {
        const entries = items
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => mealOf(it) === meal);
        if (!entries.length) return;
        any = true;
        wrap.appendChild(el("div", { class: "slotTitle" }, meal));
        const grid = el("div", { class: "presets" });
        entries.forEach(({ it, idx }) => {
          const eaten = isEaten(it);
          const q = it.q || 1, base = it.b || 1;
          let qtyEl;
          if (editQty === idx) {
            let cancelled = false;
            const inp = el("input", { class: "qinput", inputmode: "decimal", value: fmtQ(q * base),
              onClick: (e) => e.stopPropagation(),
              onBlur: (e) => { if (!cancelled) commitJournalQty(idx, e.target.value); },
              onKeydown: (e) => {
                if (e.key === "Enter") e.target.blur();
                else if (e.key === "Escape") { cancelled = true; editQty = null; render(); }
              } });
            setTimeout(() => { inp.focus(); inp.select(); }, 0);
            qtyEl = inp;
          } else {
            qtyEl = el("div", { class: "qty",
              onClick: (e) => { e.stopPropagation(); editQty = idx; render(); } }, amountLabel(q * base, it.u));
          }
          grid.appendChild(
            el("div", { class: "preset " + (eaten ? "eaten macro-" + macroOf(it) : "planned"),
              onClick: () => toggleEaten(idx) },
              qtyEl,
              el("div", { class: "pbody" },
                el("span", { class: "pn" }, it.n),
                el("span", { class: "pmacros" },
                  el("span", { class: "pcal" }, Math.round(it.c * q) + " cal"),
                  el("span", { class: "pmac" }, "P " + Math.round(it.p * q)),
                  el("span", { class: "pmac" }, "C " + Math.round(it.cb * q)),
                  el("span", { class: "pmac" }, "F " + Math.round(it.f * q)),
                  el("span", { class: "pmac" }, "Fb " + Math.round((it.fi || 0) * q)),
                  el("span", { class: "pmac" }, "Sug " + Math.round((it.sg || 0) * q))
                )
              ),
              el("button", { class: "pdel", title: "Remove from day",
                onClick: (e) => { e.stopPropagation(); removeJournalItem(idx); } }, "×")
            )
          );
        });
        wrap.appendChild(grid);
      });
      if (!any) wrap.appendChild(el("div", { class: "empty" }, "Nothing planned yet. Add foods from the Catalog."));
    } else if (tab === "catalog") {
      // Master food library, grouped by macro category. Tap a food to open a meal
      // dropdown and drop it into the day's journal (as a planned item).
      wrap.appendChild(el("button", { class: "addBtn", style: "margin-bottom:4px",
        onClick: () => { tab = "newfood"; render(); } }, "+ New food"));
      CATEGORIES.forEach((cat) => {
        const list = foods[cat] || [];
        const open = !!catOpen[cat];
        // Tappable category header (dropdown): shows the item count + a chevron and
        // toggles its food list open/closed.
        wrap.appendChild(el("button", { class: "catHdr" + (open ? " open" : ""),
          onClick: () => { catOpen[cat] = !open; render(); } },
          el("span", { class: "catHdrName" }, cat),
          el("span", { class: "catHdrRight" },
            el("span", { class: "catCount" }, String(list.length)),
            el("span", { class: "catChev" }, open ? "▾" : "▸"))
        ));
        if (!open) return; // collapsed — don't render the food chips
        const grid = el("div", { class: "presets catGrid", "data-slot": cat });
        list.forEach((p, i) => {
          const q = p.q || 1;
          const open = mealPickFor && mealPickFor.cat === cat && mealPickFor.i === i;
          const chip = el("div", { class: "preset draggable catalog macro-" + macroOf(p),
            onClick: () => { mealPickFor = open ? null : { cat, i }; render(); } },
            el("div", { class: "pbody" },
              el("span", { class: "pn" }, p.n,
                p.u ? el("span", { class: "pserv" }, " · " + amountLabel(q * (p.b || 1), p.u)) : ""),
              el("span", { class: "pmacros" },
                el("span", { class: "pcal" }, Math.round(p.c * q) + " cal"),
                el("span", { class: "pmac" }, "P " + Math.round(p.p * q)),
                el("span", { class: "pmac" }, "C " + Math.round(p.cb * q)),
                el("span", { class: "pmac" }, "F " + Math.round(p.f * q)),
                el("span", { class: "pmac" }, "Fb " + Math.round((p.fi || 0) * q)),
                el("span", { class: "pmac" }, "Sug " + Math.round((p.sg || 0) * q))
              )
            ),
            el("button", { class: "pdel", title: "Delete from catalog",
              onClick: (e) => { e.stopPropagation();
                if (confirm(`Delete "${p.n}" from your catalog?`)) deleteCatalogFood(cat, i);
              } }, "×")
          );
          makeDraggable(chip, cat, i, foodDragCtx);
          grid.appendChild(chip);
          if (open) {
            grid.appendChild(el("div", { class: "mealMenu" },
              el("div", { class: "mealMenuHdr" }, "Add to…"),
              MEALS.map((meal) => el("button", { class: "mealOpt",
                onClick: (e) => { e.stopPropagation(); planFood(meal, p); } }, meal))
            ));
          }
        });
        if (!list.length) grid.appendChild(el("div", { class: "dropHint" }, "No foods yet"));
        wrap.appendChild(grid);
      });
    } else {
      // New-food form: creates a catalog entry (name + macros + category). Unlike
      // before, this only adds to the catalog — it isn't auto-logged to the day.
      const cn = el("input", { class: "ci", placeholder: "Food name" });
      const cbase = el("input", { class: "ci", inputmode: "decimal", placeholder: "quantity (e.g. 100)" });
      const cdef = el("input", { class: "ci", inputmode: "decimal", placeholder: `default to log in ${lastUnit} (e.g. 200)` });
      // Unit the macros are quoted per; changing it updates the default-amount hint.
      const cu = el("select", { class: "ci", onChange: (e) => {
        lastUnit = e.target.value;
        cdef.setAttribute("placeholder", `default to log in ${lastUnit} (e.g. 200)`);
      } });
      UNITS.forEach((u) => {
        const opt = el("option", { value: u.v }, u.l);
        if (u.v === lastUnit) opt.selected = true;
        cu.appendChild(opt);
      });
      const cc = el("input", { class: "ci", inputmode: "decimal", placeholder: "cal" });
      const cp = el("input", { class: "ci", inputmode: "decimal", placeholder: "protein" });
      const ccb = el("input", { class: "ci", inputmode: "decimal", placeholder: "carbs" });
      const cf = el("input", { class: "ci", inputmode: "decimal", placeholder: "fat" });
      const cfi = el("input", { class: "ci", inputmode: "decimal", placeholder: "fiber" });
      const csg = el("input", { class: "ci", inputmode: "decimal", placeholder: "added sugar" });
      const cs = el("select", { class: "ci", onChange: (e) => { lastSlot = e.target.value; } });
      CATEGORIES.forEach((s) => {
        const opt = el("option", { value: s }, s);
        if (s === lastSlot) opt.selected = true;
        cs.appendChild(opt);
      });
      wrap.appendChild(el("div", { class: "slotTitle" }, "New food"));
      wrap.appendChild(
        el("div", { class: "customBox" },
          cn,
          el("div", { class: "edLabel", style: "margin-top:4px" }, "Macros are per"),
          el("div", { class: "crow" }, cbase, cu),
          el("div", { class: "crow" }, cc, cp),
          el("div", { class: "crow" }, ccb, cf),
          el("div", { class: "crow" }, cfi, csg),
          el("div", { class: "edLabel" }, "Default amount to log"),
          cdef,
          el("div", { class: "edLabel" }, "Category"),
          cs,
          el("div", { class: "crow" },
            el("button", { class: "tool", onClick: () => { tab = "catalog"; render(); } }, "Cancel"),
            el("button", { class: "addBtn", style: "margin-top:0", onClick: () => {
              const name = cn.value.trim();
              if (!name) return;
              // Macros are entered per `base` units of `unit`; `def` is the default
              // amount a serving logs. The food's default multiplier is def/base.
              const base = +cbase.value || 1;
              const def = +cdef.value || base;
              const unit = UNITS.some((x) => x.v === lastUnit) ? lastUnit : "g";
              const food = { n: name, c: +cc.value || 0, p: +cp.value || 0, cb: +ccb.value || 0, f: +cf.value || 0,
                fi: +cfi.value || 0, sg: +csg.value || 0, b: base, q: Math.round((def / base) * 1000) / 1000, u: unit };
              const cat = CATEGORIES.indexOf(lastSlot) >= 0 ? lastSlot : CATEGORIES[0];
              const catFoods = foods[cat] = foods[cat] || [];
              if (!catFoods.some((x) => x.n === food.n && x.c === food.c && x.p === food.p && x.cb === food.cb && x.f === food.f && (x.fi || 0) === food.fi && (x.sg || 0) === food.sg && (x.b || 1) === food.b && (x.u || "") === food.u)) {
                catFoods.push(food);
                saveFoods(); // persists locally + syncs to the cloud via Store
              }
              tab = "catalog"; render();
            } }, "Add to catalog")
          )
        )
      );
    }

    root.appendChild(wrap);
  }

  // One macro as a circular progress ring inside its own tile. The SVG ring is
  // built as markup (SVG needs a namespace `el()` can't set); the centred value
  // is overlaid with plain DOM so it can use the CSS variables/fonts.
  // Dark→bright colour stops per macro, so each ring gets an Apple-style angular
  // gradient (deep at the tail, vivid at the tip) instead of a flat colour.
  const RING = {
    protein: ["#7ea82f", "#d6ff5c"],
    carbs:   ["#2a9bd4", "#9ae2ff"],
    fat:     ["#d96a3a", "#ffb98c"],
    fiber:   ["#1f9e7d", "#6bf0cf"],
    sugar:   ["#b83b78", "#ff9ecb"],
  };
  // A macro as an Apple activity-style ring: a conic-gradient donut that fills to
  // the target, then laps a second time when over — with a rounded, shadowed tip
  // marking the leading end (the shadow reads as the lap overlapping itself).
  const D = 76, TW = 9, RC = (D - TW) / 2, CEN = D / 2; // px geometry of one ring
  function macroRing(label, val, target, stops) {
    const [c0, c1] = stops;
    const ratio = target > 0 ? val / target : 0;
    const base = Math.min(1, ratio);                 // fill up to the target
    const over = Math.max(0, Math.min(1, ratio - 1)); // excess, drawn as a 2nd lap
    const isOver = ratio > 1;
    const ring = el("div", { class: "ring" }, el("div", { class: "ringTrack" }));
    // one conic layer per lap (from 12 o'clock, clockwise). Lap 1 runs dark→bright;
    // the overflow lap starts from the bright shade so the colour carries straight
    // over instead of resetting to dark at the top.
    const layer = (frac, from, cls) => el("div", { class: "ringFill" + (cls || ""),
      style: `background:conic-gradient(from 0deg,${from} 0deg,${c1} ${(frac * 360).toFixed(1)}deg,transparent ${(frac * 360).toFixed(1)}deg)` });
    ring.appendChild(layer(base, c0, ""));
    if (isOver) ring.appendChild(layer(over, c1, " ringOverFill"));
    // rounded bright cap at the leading tip (position from trig; -90° = top)
    if (ratio > 0) {
      const tf = isOver ? over : base;
      const a = (-90 + tf * 360) * Math.PI / 180;
      const tx = CEN + RC * Math.cos(a), ty = CEN + RC * Math.sin(a);
      ring.appendChild(el("div", { class: "ringTip" + (isOver ? " over" : ""),
        style: `left:${tx.toFixed(1)}px;top:${ty.toFixed(1)}px;width:${TW}px;height:${TW}px;background:${c1}` }));
    }
    ring.appendChild(el("div", { class: "ringText" },
      el("div", { class: "ringVal" }, String(Math.round(val))),
      el("div", { class: "ringTgt" }, "/ " + target)
    ));
    return el("div", { class: "macroTile" }, ring, el("div", { class: "macroTileLabel" }, label));
  }

  // Turn a Firebase auth error into a readable message.
  function authError(msg) {
    if (/popup-closed-by-user|cancelled-popup/.test(msg)) return "Sign-in was cancelled.";
    if (/popup-blocked/.test(msg)) return "Your browser blocked the sign-in popup — allow popups and retry.";
    if (/unauthorized-domain/.test(msg)) return "This site isn't an authorized domain in Firebase Auth settings.";
    if (/network/.test(msg)) return "Network error — check your connection.";
    return msg || "Something went wrong.";
  }

  function exportData() {
    const blob = new Blob([window.Store.exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meal-tracker-backup-${keyFor(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (window.Store.importAll(reader.result)) {
          logs = window.Store.getLogs();
          weights = window.Store.getWeights();
          render();
        } else {
          alert("Could not read that backup file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  render();
})();
