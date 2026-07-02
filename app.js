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

  // Meal slots, in display order. Logged items carry their slot in `s`.
  const SLOTS = Object.keys(P.foods);

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
    const carbsFrom = (cal, protein, fat) => Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
    if (phase === "recomp") {
      const cal = Math.round((b.cal * 0.84) / 10) * 10, protein = b.protein + 20, fat = b.fat;
      return { cal, protein, carbs: carbsFrom(cal, protein, fat), fat };
    }
    if (phase === "cut") {
      const cal = Math.round((b.cal * 0.7) / 10) * 10, protein = b.protein + 40, fat = Math.round(b.fat * 0.8);
      return { cal, protein, carbs: carbsFrom(cal, protein, fat), fat };
    }
    return { ...b }; // bulk
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
  // Load weeks oldest-first; migrate from legacy cycles or seed from PLAN once.
  function loadWeeks() {
    let w = window.Store.getWeeks();
    if (!w || !w.length) {
      const cys = window.Store.getCycles();
      w = cys && cys.length ? migrateCycles(cys) : seedWeeks();
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
  // Quick-add foods: the user's saved arrangement, or a fresh copy of the
  // PLAN default the first time. Reordered via drag, then persisted.
  let foods = window.Store.getFoods() || JSON.parse(JSON.stringify(P.foods));
  let selected = todayOrFirst(weekDates(activeWeek()));
  let tab = "quick"; // quick | custom
  let editQty = null; // { slot, i } of the quick-add food whose qty box is being edited
  // Quantity display: drop a trailing ".0" so whole numbers stay clean.
  const fmtQ = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  let lastSlot = SLOTS[0]; // section a freshly-added custom food lands in
  let authMsg = "";      // transient cloud-sync status/error message
  let authReady = false; // has the Firebase SDK reported initial auth state yet?
  let localOnly = false; // user chose to skip login and use this device only

  // Cloud sync: when the Store pulls remote data, reload our state and re-render.
  window.Store.onSync(() => {
    logs = window.Store.getLogs();
    weights = window.Store.getWeights();
    foods = window.Store.getFoods() || JSON.parse(JSON.stringify(P.foods));
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
    dayItems().reduce(
      (a, it) => {
        const q = it.q || 1;
        return { c: a.c + it.c * q, p: a.p + it.p * q, cb: a.cb + it.cb * q, f: a.f + it.f * q };
      },
      { c: 0, p: 0, cb: 0, f: 0 }
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
  // Identity of a quick-add food, used to tell whether it's already logged for
  // the selected day (and to find which logged item to remove when toggled off).
  const foodKey = (p) => `${p.n}|${p.c}|${p.p}|${p.cb}|${p.f}`;
  const isLogged = (slot, p) =>
    dayItems().some((it) => it.s === slot && foodKey(it) === foodKey(p));
  // Macros are stored "per base amount" `b` (default 1 — a single serving).
  // Effective macros = stored macros × multiplier `q`. The red box shows the
  // *amount* the user thinks in (q × b): servings for plan foods, or grams for
  // custom foods whose macros were entered per N grams.
  function snapItem(slot, p, q) {
    return { n: p.n, c: p.c, p: p.p, cb: p.cb, f: p.f, s: slot, q, b: p.b || 1 };
  }
  // Tap a quick-add food to log it (at its default amount); tap green to un-log.
  function toggleFood(slot, p) {
    const items = dayItems();
    const idx = items.findIndex((it) => it.s === slot && foodKey(it) === foodKey(p));
    if (idx === -1) {
      addItem(snapItem(slot, p, p.q || 1));
      return;
    }
    const next = items.slice();
    next.splice(idx, 1);
    logs = { ...logs, [selected]: next };
    saveLogs();
    render();
  }
  // Base amount the macros are quoted per. Logged items carry their own snapshot.
  function baseOf(slot, p) {
    const it = dayItems().find((x) => x.s === slot && foodKey(x) === foodKey(p));
    return (it ? it.b : p.b) || 1;
  }
  // Multiplier: the logged day's value, or the food's default when not logged.
  function qtyOf(slot, p) {
    const it = dayItems().find((x) => x.s === slot && foodKey(x) === foodKey(p));
    return (it ? it.q : p.q) || 1;
  }
  // Amount shown in the red box = multiplier × base amount.
  const amountOf = (slot, p) => qtyOf(slot, p) * baseOf(slot, p);
  // Commit an edited amount for the selected day only. The typed value is an
  // amount (q × b); convert back to a multiplier. If the food is already logged,
  // update that day's amount; otherwise log it at that amount.
  function commitQty(slot, i, val) {
    const p = foods[slot][i];
    const base = baseOf(slot, p);
    let amt = parseFloat(val);
    if (!isFinite(amt) || amt <= 0) amt = base; // fall back to one base unit
    const q = Math.round((amt / base) * 1000) / 1000;
    editQty = null;
    const items = dayItems();
    const idx = items.findIndex((it) => it.s === slot && foodKey(it) === foodKey(p));
    if (idx >= 0) {
      const next = items.slice();
      next[idx] = { ...next[idx], q };
      logs = { ...logs, [selected]: next };
      saveLogs();
      render();
    } else {
      addItem(snapItem(slot, p, q));
    }
  }

  function saveFoods() { flash(window.Store.setFoods(foods)); }
  // A quick-add food is hidden on the selected day if it was deleted on or
  // before it. `to` is the day the deletion takes effect; earlier days keep it.
  const isHidden = (p) => !!p.to && selected >= p.to;
  // Move a quick-add food. `fromIdx` is its real index in foods[fromSlot];
  // `toVis` is the drop position among the *visible* foods in toSlot (some may
  // be hidden on this day), so map it back to a real array index before insert.
  function moveFood(fromSlot, fromIdx, toSlot, toVis) {
    const [moved] = foods[fromSlot].splice(fromIdx, 1);
    if (!moved) return render();
    const arr = (foods[toSlot] = foods[toSlot] || []);
    let count = 0, realTo = arr.length;
    for (let i = 0; i < arr.length; i++) {
      if (isHidden(arr[i])) continue;
      if (count === toVis) { realTo = i; break; }
      count++;
    }
    arr.splice(realTo, 0, moved);
    saveFoods();
    render();
  }
  // Delete a quick-add food from the selected day onward: hide it from `selected`
  // on, and drop any logged copies on the selected day and later days within the
  // window. Earlier days keep both the food and its logs untouched.
  function deleteFood(slot, p) {
    const idx = foods[slot].indexOf(p);
    if (idx < 0) return;
    foods[slot] = foods[slot].slice();
    foods[slot][idx] = { ...p, to: selected };
    saveFoods();
    let changed = false;
    const next = { ...logs };
    weekDates(activeWeek()).forEach((d) => {
      const k = keyFor(d);
      if (k < selected || !next[k]) return;
      const filtered = next[k].filter((it) => !(it.s === slot && foodKey(it) === foodKey(p)));
      if (filtered.length !== next[k].length) { next[k] = filtered; changed = true; }
    });
    if (changed) { logs = next; saveLogs(); }
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
  const pct = (v, t) => Math.min(100, Math.round((v / t) * 100));

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
      el("div", { class: "edLabel" }, "Targets (cal · protein · carbs · fat)"),
      el("div", { class: "crow" }, mk("cal"), mk("protein")),
      el("div", { class: "crow" }, mk("carbs"), mk("fat")),
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
    return (logs[key] || []).reduce((a, it) => {
      const q = it.q || 1;
      return { c: a.c + it.c * q, p: a.p + it.p * q, cb: a.cb + it.cb * q, f: a.f + it.f * q };
    }, { c: 0, p: 0, cb: 0, f: 0 });
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
    const loggedDays = Object.keys(logs).filter((k) => (logs[k] || []).length > 0);
    const sum = loggedDays.reduce((a, k) => {
      const m = dayMacros(k);
      return { c: a.c + m.c, p: a.p + m.p, cb: a.cb + m.cb, f: a.f + m.f };
    }, { c: 0, p: 0, cb: 0, f: 0 });
    const n = loggedDays.length;
    const avg = (x) => (n ? Math.round(x / n) : 0);

    const nutri = el("div", { class: "card" }, el("div", { class: "eyebrow lime" }, "Nutrition"));
    if (n) {
      nutri.appendChild(el("div", { class: "statGrid" },
        statTile(n.toLocaleString(), "", "Days logged"),
        statTile(avg(sum.c).toLocaleString(), "cal", "Avg / day"),
        statTile(avg(sum.p).toLocaleString(), "g", "Avg protein"),
        statTile(avg(sum.cb).toLocaleString(), "g", "Avg carbs"),
        statTile(avg(sum.f).toLocaleString(), "g", "Avg fat")
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
    const topRow = el("div", { class: "totalsTop" },
      el("div", null,
        el("div", { class: "bigcal" }, Math.round(tt.c).toLocaleString()),
        el("div", { class: "sub" }, `of ${T.cal.toLocaleString()} cal · ${Math.max(0, T.cal - Math.round(tt.c)).toLocaleString()} left`)
      ),
      el("div", { class: "weightBox" },
        el("div", { class: "wlabel" }, "Weight"),
        (function () {
          const w = weights[selected];
          const shown = w === "" || w == null ? "" : fmtW(toDisplay(w));
          const inp = el("input", { class: "winput", inputmode: "decimal", placeholder: "—",
            value: shown, onInput: (e) => setWeight(e.target.value) });
          return inp;
        })(),
        el("button", { class: "wunit", title: "Tap to switch units", onClick: toggleUnit }, unit)
      )
    );
    card.appendChild(topRow);
    card.appendChild(macroBar("Protein", tt.p, T.protein, "var(--lime)"));
    card.appendChild(macroBar("Carbs", tt.cb, T.carbs, "var(--blue)"));
    card.appendChild(macroBar("Fat", tt.f, T.fat, "var(--orange)"));
    wrap.appendChild(card);

    // tabs
    wrap.appendChild(
      el("div", { class: "tabs" },
        el("button", { class: "tab" + (tab === "quick" ? " active" : ""), onClick: () => { tab = "quick"; render(); } }, "Log items"),
        el("button", { class: "tab" + (tab === "custom" ? " active" : ""), onClick: () => { tab = "custom"; render(); } }, "Add items"),
        el("button", { class: "tab" + (tab === "remove" ? " active" : ""), onClick: () => { tab = "remove"; render(); } }, "Remove items")
      )
    );

    if (tab === "quick") {
      SLOTS.forEach((slot) => {
        const items = foods[slot] || [];
        wrap.appendChild(el("div", { class: "slotTitle" }, slot));
        const grid = el("div", { class: "presets", "data-slot": slot });
        items.forEach((p, i) => {
          if (isHidden(p)) return; // deleted from this day onward
          const logged = isLogged(slot, p);
          let qtyEl;
          if (editQty && editQty.slot === slot && editQty.i === i) {
            let cancelled = false;
            const inp = el("input", { class: "qinput", inputmode: "decimal", value: fmtQ(amountOf(slot, p)),
              onClick: (e) => e.stopPropagation(),
              onBlur: (e) => { if (!cancelled) commitQty(slot, i, e.target.value); },
              onKeydown: (e) => {
                if (e.key === "Enter") e.target.blur();
                else if (e.key === "Escape") { cancelled = true; editQty = null; render(); }
              } });
            setTimeout(() => { inp.focus(); inp.select(); }, 0);
            qtyEl = inp;
          } else {
            qtyEl = el("div", { class: "qty",
              onClick: (e) => { e.stopPropagation(); editQty = { slot, i }; render(); } }, fmtQ(amountOf(slot, p)));
          }
          const q = qtyOf(slot, p);
          const btn = el("div", { class: "preset draggable" + (logged ? " logged" : ""),
            onClick: () => toggleFood(slot, p) },
            qtyEl,
            el("div", { class: "pbody" },
              el("span", { class: "pn" }, p.n),
              el("span", { class: "pmacros" },
                el("span", { class: "pcal" }, Math.round(p.c * q) + " cal"),
                el("span", { class: "pmac" }, "P " + Math.round(p.p * q)),
                el("span", { class: "pmac" }, "C " + Math.round(p.cb * q)),
                el("span", { class: "pmac" }, "F " + Math.round(p.f * q))
              )
            )
          );
          makeDraggable(btn, slot, i, foodDragCtx);
          grid.appendChild(btn);
        });
        if (!grid.children.length) grid.appendChild(el("div", { class: "dropHint" }, "Drop here"));
        wrap.appendChild(grid);
      });
    } else if (tab === "remove") {
      // Removal interface: every food shows an × that deletes it from this day
      // onward (earlier days keep it). No tap-to-log, qty editing, or reordering.
      let any = false;
      SLOTS.forEach((slot) => {
        const visible = (foods[slot] || []).filter((p) => !isHidden(p));
        if (!visible.length) return;
        any = true;
        wrap.appendChild(el("div", { class: "slotTitle" }, slot));
        const grid = el("div", { class: "presets", "data-slot": slot });
        visible.forEach((p) => {
          grid.appendChild(
            el("div", { class: "preset removing" },
              el("div", { class: "pbody" },
                el("span", { class: "pn" }, p.n),
                el("span", { class: "pc" }, String(p.c))
              ),
              el("button", { class: "pdel", title: "Delete from here on",
                onClick: () => {
                  if (confirm(`Delete "${p.n}" from this day onward? Earlier days keep it.`)) deleteFood(slot, p);
                } }, "×")
            )
          );
        });
        wrap.appendChild(grid);
      });
      if (!any) wrap.appendChild(el("div", { class: "empty" }, "No foods to remove."));
    } else {
      const cn = el("input", { class: "ci", placeholder: "Food name" });
      const cbase = el("input", { class: "ci", inputmode: "decimal", placeholder: "macros are per… (e.g. 50)" });
      const cc = el("input", { class: "ci", inputmode: "numeric", placeholder: "cal" });
      const cp = el("input", { class: "ci", inputmode: "numeric", placeholder: "protein" });
      const ccb = el("input", { class: "ci", inputmode: "numeric", placeholder: "carbs" });
      const cf = el("input", { class: "ci", inputmode: "numeric", placeholder: "fat" });
      const cdef = el("input", { class: "ci", inputmode: "decimal", placeholder: "default amount (e.g. 200)" });
      const cs = el("select", { class: "ci", onChange: (e) => { lastSlot = e.target.value; } });
      SLOTS.forEach((s) => {
        const opt = el("option", { value: s }, s);
        if (s === lastSlot) opt.selected = true;
        cs.appendChild(opt);
      });
      wrap.appendChild(
        el("div", { class: "customBox" },
          cn,
          cbase,
          el("div", { class: "crow" }, cc, cp),
          el("div", { class: "crow" }, ccb, cf),
          cdef,
          cs,
          el("button", { class: "addBtn", onClick: () => {
            const name = cn.value.trim();
            if (!name) return;
            // Macros are entered per `base` units; `def` is the default amount to
            // log. The food's default multiplier is def/base (e.g. 200/50 = 4×).
            const base = +cbase.value || 1;
            const def = +cdef.value || base;
            const food = { n: name, c: +cc.value || 0, p: +cp.value || 0, cb: +ccb.value || 0, f: +cf.value || 0,
              b: base, q: Math.round((def / base) * 1000) / 1000 };
            addItem({ ...food, s: lastSlot });
            // Also save to Quick add for this slot, skipping exact duplicates.
            const slotFoods = foods[lastSlot] = foods[lastSlot] || [];
            if (!slotFoods.some((q) => !q.to && q.n === food.n && q.c === food.c && q.p === food.p && q.cb === food.cb && q.f === food.f && (q.b || 1) === food.b)) {
              slotFoods.push(food);
              saveFoods(); // persists locally + syncs to the cloud via Store
            }
            tab = "quick"; render();
          } }, "Add food")
        )
      );
    }

    root.appendChild(wrap);
  }

  function macroBar(label, val, target, color) {
    return el("div", { class: "mb" },
      el("div", { class: "mbtop" },
        el("span", { class: "mblabel" }, label),
        el("span", { class: "mbval" }, `${Math.round(val)} `, el("span", { class: "muted" }, `/ ${target}`))
      ),
      el("div", { class: "track" }, el("div", { class: "fill", style: `width:${pct(val, target)}%;background:${color}` }))
    );
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
