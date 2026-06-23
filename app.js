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

  // ---- diet cycles ----
  // A cycle is a diet block spanning `weeks` weeks with its own macro targets.
  // PLAN provides the seed (Cycle 1); once the user creates more, the whole array
  // is persisted via Store. Cycles are non-overlapping date ranges, so the log
  // page is just a view over the date-keyed logs/weights plus the cycle's targets.
  function seedCycle() {
    return { id: "c1", name: "Cycle 1", startDate: P.startDate,
      weeks: Math.max(1, Math.round(P.numDays / 7)), targets: { ...P.targets } };
  }
  // All Date objects spanned by a cycle (length weeks*7), in order.
  function cycleDays(cy) {
    return Array.from({ length: cy.weeks * 7 }, (_, i) => {
      const d = parseKey(cy.startDate);
      d.setDate(d.getDate() + i);
      return d;
    });
  }
  // The 7 Date objects of week `w` (0-based) within a cycle.
  const weekDays = (cy, w) => cycleDays(cy).slice(w * 7, w * 7 + 7);
  // First/last date keys of a cycle (string compare works on YYYY-MM-DD).
  function cycleRange(cy) {
    const ds = cycleDays(cy).map(keyFor);
    return { start: ds[0], end: ds[ds.length - 1] };
  }
  // Today if it falls within the given days, else the first day.
  function todayOrFirst(days) {
    const keys = days.map(keyFor), today = keyFor(new Date());
    return keys.includes(today) ? today : keys[0];
  }
  // The cycle whose range contains today, or null when today is outside them all.
  function currentCycleId() {
    const today = keyFor(new Date());
    const cy = cycles.find((c) => { const r = cycleRange(c); return today >= r.start && today <= r.end; });
    return cy ? cy.id : null;
  }

  let cycles = window.Store.getCycles() || [seedCycle()];
  let view = "log";       // "log" | "cycles"
  let activeCycleId, activeWeek; // which cycle/week the log page is showing
  let expandedId = null;  // cycle expanded in the Cycles list
  let newCycle = null;    // draft for the "new cycle" form, or null when closed
  // Land on the cycle/week containing today, else the most recent cycle's last week.
  (function initActive() {
    const id = currentCycleId();
    if (id) {
      const cy = cycles.find((c) => c.id === id);
      activeCycleId = id;
      activeWeek = Math.floor(cycleDays(cy).map(keyFor).indexOf(keyFor(new Date())) / 7);
    } else {
      const last = cycles[cycles.length - 1];
      activeCycleId = last.id;
      activeWeek = last.weeks - 1;
    }
    expandedId = activeCycleId;
  })();
  // The cycle currently shown on the log page (fallback keeps things sane if an
  // id goes stale after a cloud sync replaces the cycles array).
  function activeCycle() { return cycles.find((c) => c.id === activeCycleId) || cycles[cycles.length - 1]; }
  // activeWeek clamped to the active cycle's range.
  const curWeek = () => Math.min(Math.max(0, activeWeek), activeCycle().weeks - 1);

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
  let selected = todayOrFirst(weekDays(activeCycle(), curWeek()));
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
    cycles = window.Store.getCycles() || [seedCycle()];
    if (!cycles.some((c) => c.id === activeCycleId)) {
      const last = cycles[cycles.length - 1];
      activeCycleId = last.id; activeWeek = last.weeks - 1;
    }
    selected = todayOrFirst(weekDays(activeCycle(), curWeek()));
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
    cycleDays(activeCycle()).forEach((d) => {
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
  const foodDragCtx = { bodySel: ".presets", itemSel: ".preset", grid: true,
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

  // ---- cycles view ----
  const fmtDate = (key) => parseKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtRange = (r) => `${fmtDate(r.start)} – ${fmtDate(r.end)}`;

  // The "+ New cycle" form. Prefilled from the latest cycle (the reassess step):
  // its targets are copied so the user tweaks, and it starts the day after the
  // previous cycle ends.
  function newCycleForm() {
    const name = el("input", { class: "ci", placeholder: "Cycle name", value: `Cycle ${cycles.length + 1}` });
    const sd = el("input", { class: "ci", type: "date", value: newCycle.startDate });
    const wks = el("input", { class: "ci", inputmode: "numeric", placeholder: "weeks", value: String(newCycle.weeks) });
    const cc = el("input", { class: "ci", inputmode: "numeric", placeholder: "cal", value: String(newCycle.targets.cal) });
    const cp = el("input", { class: "ci", inputmode: "numeric", placeholder: "protein", value: String(newCycle.targets.protein) });
    const ccb = el("input", { class: "ci", inputmode: "numeric", placeholder: "carbs", value: String(newCycle.targets.carbs) });
    const cf = el("input", { class: "ci", inputmode: "numeric", placeholder: "fat", value: String(newCycle.targets.fat) });
    return el("div", { class: "customBox" },
      el("div", { class: "slotTitle" }, "New cycle"),
      name,
      el("div", { class: "crow" }, sd, wks),
      el("div", { class: "crow" }, cc, cp),
      el("div", { class: "crow" }, ccb, cf),
      el("div", { class: "crow" },
        el("button", { class: "tool", onClick: () => { newCycle = null; render(); } }, "Cancel"),
        el("button", { class: "addBtn", onClick: () => {
          const weeks = Math.max(1, Math.round(+wks.value) || 1);
          const cyNew = {
            id: "c" + Date.now(),
            name: name.value.trim() || `Cycle ${cycles.length + 1}`,
            startDate: sd.value || newCycle.startDate,
            weeks,
            targets: { cal: +cc.value || 0, protein: +cp.value || 0, carbs: +ccb.value || 0, fat: +cf.value || 0 },
          };
          cycles = [...cycles, cyNew]; // seed Cycle 1 is already in the array
          window.Store.setCycles(cycles);
          activeCycleId = cyNew.id; activeWeek = 0;
          selected = todayOrFirst(weekDays(cyNew, 0));
          newCycle = null; view = "log"; render();
        } }, "Create cycle")
      )
    );
  }

  function renderCycles() {
    const wrap = el("div", { class: "wrap" });
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("div", { class: "eyebrow lime" }, "Diet plan"),
          el("h1", null, "Cycles")
        ),
        el("button", { class: "tool", onClick: () => { newCycle = null; view = "log"; render(); } }, "Done")
      )
    );

    if (newCycle) {
      wrap.appendChild(newCycleForm());
    } else {
      wrap.appendChild(el("button", { class: "addBtn", onClick: () => {
        const last = cycles[cycles.length - 1];
        const after = parseKey(cycleRange(last).end);
        after.setDate(after.getDate() + 1); // contiguous with the previous cycle
        newCycle = { startDate: keyFor(after), weeks: last.weeks, targets: { ...last.targets } };
        render();
      } }, "+ New cycle"));
    }

    const nowId = currentCycleId();
    // Newest cycle on top.
    cycles.slice().reverse().forEach((cy) => {
      const r = cycleRange(cy);
      const isCurrent = cy.id === nowId;
      const expanded = expandedId === cy.id;
      wrap.appendChild(
        el("div", { class: "cycleRow" + (isCurrent ? " current" : ""),
          onClick: () => { expandedId = expanded ? null : cy.id; render(); } },
          el("div", { class: "cycleMeta" },
            el("div", { class: "cycleName" }, cy.name,
              isCurrent ? el("span", { class: "curTag" }, "now") : ""),
            el("div", { class: "sub" }, `${fmtRange(r)} · ${cy.weeks} wk · ${cy.targets.cal.toLocaleString()} cal`)
          ),
          el("div", { class: "chev" }, expanded ? "▾" : "▸")
        )
      );
      if (!expanded) return;
      for (let w = 0; w < cy.weeks; w++) {
        const wd = weekDays(cy, w);
        const wr = { start: keyFor(wd[0]), end: keyFor(wd[6]) };
        wrap.appendChild(
          el("div", { class: "weekRow", onClick: () => {
            activeCycleId = cy.id; activeWeek = w;
            selected = todayOrFirst(wd);
            view = "log"; render();
          } },
            el("span", { class: "weekName" }, `Week ${w + 1}`),
            el("span", { class: "sub" }, fmtRange(wr))
          )
        );
      }
    });
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
    if (view === "cycles") { root.appendChild(renderCycles()); return; }

    const cy = activeCycle();
    const week = curWeek();
    const T = cy.targets; // active cycle's macro targets drive the whole log page
    const tt = totals();

    const wrap = el("div", { class: "wrap" });

    // header
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("button", { class: "backbtn", onClick: () => { view = "cycles"; expandedId = cy.id; render(); } }, "‹ Cycles"),
          el("h1", null, cy.name),
          el("div", { class: "sub" }, `Target ${T.cal.toLocaleString()} cal · ${T.protein}g protein floor`)
        ),
        el("div", { id: "saveBadge", class: "badge" })
      )
    );

    // week navigation within the cycle
    const goWeek = (w) => {
      activeWeek = Math.min(Math.max(0, w), cy.weeks - 1);
      selected = todayOrFirst(weekDays(cy, activeWeek));
      render();
    };
    const prevBtn = el("button", { class: "wkarrow", onClick: () => goWeek(week - 1) }, "‹");
    if (week === 0) prevBtn.setAttribute("disabled", "true");
    const nextBtn = el("button", { class: "wkarrow", onClick: () => goWeek(week + 1) }, "›");
    if (week === cy.weeks - 1) nextBtn.setAttribute("disabled", "true");
    wrap.appendChild(el("div", { class: "wknav" },
      prevBtn,
      el("div", { class: "wklabel" }, `Week ${week + 1} of ${cy.weeks}`),
      nextBtn
    ));

    // day strip
    const strip = el("div", { class: "strip" });
    weekDays(cy, week).forEach((d) => {
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
          const btn = el("div", { class: "preset draggable" + (logged ? " logged" : ""),
            onClick: () => toggleFood(slot, p) },
            qtyEl,
            el("div", { class: "pbody" },
              el("span", { class: "pn" }, p.n),
              el("span", { class: "pc" }, String(Math.round(p.c * qtyOf(slot, p))))
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

    // weight trend — first week vs last week of the active cycle
    const w1 = weekAvg(weekDays(cy, 0));
    const w2 = cy.weeks > 1 ? weekAvg(weekDays(cy, cy.weeks - 1)) : null;
    const wcols = el("div", { class: "wcols" },
      el("div", { class: "wcol" }, el("div", { class: "wctitle" }, cy.weeks > 1 ? "First week avg" : "Week avg"),
        el("div", { class: "wcval" + (w1 != null ? "" : " muted") }, w1 != null ? fmtW(toDisplay(w1)) : "—", el("span", { class: "wcu" }, " " + unit)))
    );
    if (cy.weeks > 1) {
      wcols.appendChild(el("div", { class: "wcol" }, el("div", { class: "wctitle" }, "Last week avg"),
        el("div", { class: "wcval" + (w2 != null ? "" : " muted") }, w2 != null ? fmtW(toDisplay(w2)) : "—", el("span", { class: "wcu" }, " " + unit))));
    }
    const trend = el("div", { class: "card trend" }, el("div", { class: "eyebrow lime" }, "Weight trend"), wcols);
    if (cy.weeks > 1 && w1 != null && w2 != null) {
      const diffKg = w2 - w1; // advice thresholds are defined in kg
      const diff = fmtW(toDisplay(w2) - toDisplay(w1));
      const advice = diffKg > P.weightGoal.maxGainKg ? "trim 200 cal"
        : diffKg < (P.weightGoal.minGainKg - 0.35) ? "add 200 cal" : "perfect — hold steady";
      trend.appendChild(el("div", { class: "diff" },
        "Change: ", el("span", { class: "lime b" }, `${diffKg > 0 ? "+" : ""}${diff} ${unit}`), ` · ${advice}`));
    }
    trend.appendChild(el("div", { class: "note" }, P.weightGoal.note));
    wrap.appendChild(trend);

    // data tools
    const tools = el("div", { class: "tools" },
      el("button", { class: "tool", onClick: exportData }, "Export backup"),
      el("button", { class: "tool", onClick: importData }, "Import backup")
    );
    wrap.appendChild(tools);

    // cloud sync (sign-in / status) — only when Firebase config is present
    const sp = syncPanel();
    if (sp) wrap.appendChild(sp);

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

  // Cloud-sync panel: Google sign-in button, or signed-in status + sign out.
  function syncPanel() {
    if (!window.Store.isSyncConfigured()) return null;
    const panel = el("div", { class: "card trend" }, el("div", { class: "eyebrow lime" }, "Cloud sync"));
    const user = window.Store.getUser();
    if (user) {
      panel.appendChild(el("div", { class: "sub" }, `Signed in as ${user.email} — synced across devices.`));
      panel.appendChild(el("button", { class: "tool", style: "margin-top:10px",
        onClick: () => { window.Store.signOut(); authMsg = ""; render(); } }, "Sign out"));
      return panel;
    }
    panel.appendChild(el("div", { class: "sub" }, "Sign in with Google to sync this device with your others."));
    const btn = el("button", { class: "addBtn", style: "margin-top:12px", onClick: async () => {
      authMsg = "Opening Google sign-in…"; render();
      try { await window.Store.signInWithGoogle(); authMsg = ""; render(); } // onChange handler syncs + re-renders
      catch (e) { authMsg = authError(e && (e.code || e.message)); render(); }
    } }, "Sign in with Google");
    if (!window.Store.isSyncReady()) { btn.setAttribute("disabled", "true"); authMsg = authMsg || "Loading sign-in…"; }
    panel.appendChild(btn);
    if (authMsg) panel.appendChild(el("div", { class: "sub", style: "margin-top:8px" }, authMsg));
    return panel;
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
