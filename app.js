// ============================================================
//  app.js — UI + logic. Vanilla JS, no build step.
//  Renders into #root. Reads PLAN, persists via Store.
// ============================================================

(function () {
  const T = window.PLAN.targets;
  const P = window.PLAN;

  // ---- date helpers ----
  const pad = (n) => String(n).padStart(2, "0");
  const keyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (s) => {
    const [y, m, dd] = s.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };
  const DAYS = Array.from({ length: P.numDays }, (_, i) => {
    const d = parseKey(P.startDate);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Meal slots, in display order. Logged items carry their slot in `s`; items
  // with no/unknown slot (e.g. logged before this feature) fall into "Unsorted".
  const SLOTS = Object.keys(P.foods);
  const UNSORTED = "Unsorted";
  const ALL_SLOTS = [...SLOTS, UNSORTED];

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
  let selected = (function () {
    const today = keyFor(new Date());
    return DAYS.some((d) => keyFor(d) === today) ? today : keyFor(DAYS[0]);
  })();
  let tab = "quick"; // quick | custom
  let lastSlot = SLOTS[0]; // section a freshly-added custom food lands in
  // Auto-sync to plan.js via the File System Access API. The user links the file
  // once (handle persisted in IndexedDB via Store); custom adds then write to it.
  // Browsers without the API fall back to downloading plan.js.
  const FS_SUPPORTED = "showOpenFilePicker" in window;
  let planHandle = null;
  if (FS_SUPPORTED) {
    Promise.resolve(window.Store.getPlanFileHandle()).then((h) => { if (h) { planHandle = h; render(); } });
  }

  // Cloud sync: when the Store pulls remote data, reload our state and re-render.
  // Pull on startup and whenever the tab regains focus (e.g. switching devices).
  window.Store.onSync(() => {
    logs = window.Store.getLogs();
    weights = window.Store.getWeights();
    foods = window.Store.getFoods() || JSON.parse(JSON.stringify(P.foods));
    unit = window.Store.getUnit();
    render();
  });
  window.Store.syncInit();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) window.Store.syncInit();
  });
  // live drag state; null fields when not dragging
  let drag = { active: false }, dragSource = null, dragClone = null, dragPh = null, dragOff = null, dragCtx = null;

  // ---- derived ----
  const dayItems = () => logs[selected] || [];
  const totals = () =>
    dayItems().reduce(
      (a, it) => ({ c: a.c + it.c, p: a.p + it.p, cb: a.cb + it.cb, f: a.f + it.f }),
      { c: 0, p: 0, cb: 0, f: 0 }
    );
  const weekAvg = (start, end) => {
    const vals = DAYS.slice(start, end)
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
  // Group the day's flat item list by slot, preserving array order within each
  // slot. Returns { slot: [item, ...] } for every slot in ALL_SLOTS.
  function buildGroups() {
    const g = {};
    ALL_SLOTS.forEach((s) => (g[s] = []));
    dayItems().forEach((it) => {
      const s = it.s && g[it.s] ? it.s : UNSORTED;
      g[s].push(it);
    });
    return g;
  }
  // Flatten groups back to one array in slot order (normalizes storage order).
  function flattenGroups(g) {
    const flat = [];
    ALL_SLOTS.forEach((s) => (g[s] || []).forEach((it) => flat.push(it)));
    return flat;
  }
  function commitGroups(g) {
    logs = { ...logs, [selected]: flattenGroups(g) };
    saveLogs();
    render();
  }
  function removeBy(slot, idx) {
    const g = buildGroups();
    g[slot].splice(idx, 1);
    commitGroups(g);
  }
  // Move an item from (fromSlot, fromIdx) to position toIdx within toSlot.
  function moveItem(fromSlot, fromIdx, toSlot, toIdx) {
    const g = buildGroups();
    const [moved] = g[fromSlot].splice(fromIdx, 1);
    if (!moved) return render();
    if (toSlot === UNSORTED) delete moved.s;
    else moved.s = toSlot;
    g[toSlot].splice(toIdx, 0, moved);
    commitGroups(g);
  }

  function saveFoods() { flash(window.Store.setFoods(foods)); }
  // Move a quick-add food from (fromSlot, fromIdx) to toIdx within toSlot.
  function moveFood(fromSlot, fromIdx, toSlot, toIdx) {
    const [moved] = foods[fromSlot].splice(fromIdx, 1);
    if (!moved) return render();
    (foods[toSlot] = foods[toSlot] || []).splice(toIdx, 0, moved);
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
  const pct = (v, t) => Math.min(100, Math.round((v / t) * 100));

  // ---- drag & drop (press-and-hold to reorder / move across sections) ----
  // Generic engine shared by the log (vertical lists) and Quick add (wrap
  // grids). A ctx describes the DOM shape + how to commit a move:
  //   { bodySel, itemSel, grid, onBegin?, commit }
  // Works with touch and mouse via pointer events; no libraries.
  const logDragCtx = { bodySel: ".sectionBody", itemSel: ".item", grid: false,
    onBegin: revealEmptySections, commit: moveItem };
  const foodDragCtx = { bodySel: ".presets", itemSel: ".preset", grid: true,
    onBegin: null, commit: moveFood };

  function makeDraggable(card, slot, idx, ctx) {
    card.addEventListener("pointerdown", (e) => {
      if (drag.active || e.target.closest(".x")) return; // ignore delete button
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

  // Inject empty placeholder sections for slots that have no items right now,
  // so there's always somewhere to drop while dragging the log.
  function revealEmptySections() {
    const listEl = document.getElementById("logList");
    if (!listEl) return;
    SLOTS.forEach((slot, si) => {
      if (listEl.querySelector(`.logSection[data-slot="${slot}"]`)) return;
      const section = el("div", { class: "logSection", "data-slot": slot },
        el("div", { class: "slotTitle" }, slot),
        el("div", { class: "sectionBody", "data-slot": slot },
          el("div", { class: "dropHint" }, "Drop here")));
      let before = null;
      for (const sec of listEl.querySelectorAll(".logSection")) {
        if (ALL_SLOTS.indexOf(sec.getAttribute("data-slot")) > si) { before = sec; break; }
      }
      listEl.insertBefore(section, before);
    });
  }

  // ---- render ----
  function render() {
    const root = document.getElementById("root");
    root.innerHTML = "";
    const tt = totals();

    const wrap = el("div", { class: "wrap" });

    // header
    wrap.appendChild(
      el("div", { class: "header" },
        el("div", null,
          el("div", { class: "eyebrow" }, "2-Week Lean Bulk"),
          el("h1", null, "Meal Log"),
          el("div", { class: "sub" }, `Target ${T.cal.toLocaleString()} cal · ${T.protein}g protein floor`)
        ),
        el("div", { id: "saveBadge", class: "badge" })
      )
    );

    // day strip
    const strip = el("div", { class: "strip" });
    DAYS.forEach((d) => {
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

    // logged list — grouped by slot; press-and-hold a card to reorder or move it
    const list = el("div", { class: "list", id: "logList" });
    if (dayItems().length === 0) {
      list.appendChild(el("div", { class: "empty" }, "Nothing logged yet. Tap a food below to add it."));
    } else {
      const groups = buildGroups();
      ALL_SLOTS.forEach((slot) => {
        const items = groups[slot];
        if (!items.length) return; // empty sections appear only while dragging
        const body = el("div", { class: "sectionBody", "data-slot": slot });
        items.forEach((it, i) => {
          const card = el("div", { class: "item draggable", "data-slot": slot },
            el("div", { class: "grip" }, "⠿"),
            el("div", { class: "itemInfo" },
              el("div", { class: "iname" }, it.n),
              el("div", { class: "imacros" }, `${it.c} cal · ${it.p}p · ${it.cb}c · ${it.f}f`)
            ),
            el("button", { class: "x", onClick: () => removeBy(slot, i) }, "×")
          );
          makeDraggable(card, slot, i, logDragCtx);
          body.appendChild(card);
        });
        list.appendChild(
          el("div", { class: "logSection", "data-slot": slot },
            el("div", { class: "slotTitle" }, slot), body)
        );
      });
    }
    wrap.appendChild(list);

    // tabs
    wrap.appendChild(
      el("div", { class: "tabs" },
        el("button", { class: "tab" + (tab === "quick" ? " active" : ""), onClick: () => { tab = "quick"; render(); } }, "Quick add"),
        el("button", { class: "tab" + (tab === "custom" ? " active" : ""), onClick: () => { tab = "custom"; render(); } }, "Custom")
      )
    );

    if (tab === "quick") {
      Object.entries(foods).forEach(([slot, items]) => {
        wrap.appendChild(el("div", { class: "slotTitle" }, slot));
        const grid = el("div", { class: "presets", "data-slot": slot });
        items.forEach((p, i) => {
          const btn = el("button", { class: "preset draggable",
            onClick: () => addItem({ n: p.n, c: p.c, p: p.p, cb: p.cb, f: p.f, s: slot }) },
            el("span", { class: "pn" }, p.n),
            el("span", { class: "pc" }, String(p.c))
          );
          makeDraggable(btn, slot, i, foodDragCtx);
          grid.appendChild(btn);
        });
        if (!items.length) grid.appendChild(el("div", { class: "dropHint" }, "Drop here"));
        wrap.appendChild(grid);
      });
    } else {
      const cn = el("input", { class: "ci", placeholder: "Food name" });
      const cc = el("input", { class: "ci", inputmode: "numeric", placeholder: "cal" });
      const cp = el("input", { class: "ci", inputmode: "numeric", placeholder: "protein" });
      const ccb = el("input", { class: "ci", inputmode: "numeric", placeholder: "carbs" });
      const cf = el("input", { class: "ci", inputmode: "numeric", placeholder: "fat" });
      const cs = el("select", { class: "ci", onChange: (e) => { lastSlot = e.target.value; } });
      SLOTS.forEach((s) => {
        const opt = el("option", { value: s }, s);
        if (s === lastSlot) opt.selected = true;
        cs.appendChild(opt);
      });
      wrap.appendChild(
        el("div", { class: "customBox" },
          cn,
          el("div", { class: "crow" }, cc, cp),
          el("div", { class: "crow" }, ccb, cf),
          cs,
          el("button", { class: "addBtn", onClick: () => {
            const name = cn.value.trim();
            if (!name) return;
            const food = { n: name, c: +cc.value || 0, p: +cp.value || 0, cb: +ccb.value || 0, f: +cf.value || 0 };
            addItem({ ...food, s: lastSlot });
            // Also save to Quick add for this slot, skipping exact duplicates.
            const slotFoods = foods[lastSlot] = foods[lastSlot] || [];
            if (!slotFoods.some((q) => q.n === food.n && q.c === food.c && q.p === food.p && q.cb === food.cb && q.f === food.f)) {
              slotFoods.push(food);
              saveFoods();
              syncPlan(); // mirror into plan.js (auto-write if linked, else download)
            }
            tab = "quick"; render();
          } }, "Add food")
        )
      );
    }

    // weight trend
    const w1 = weekAvg(0, 7), w2 = weekAvg(7, 14);
    const trend = el("div", { class: "card trend" },
      el("div", { class: "eyebrow lime" }, "Weight trend"),
      el("div", { class: "wcols" },
        el("div", { class: "wcol" }, el("div", { class: "wctitle" }, "Week 1 avg"),
          el("div", { class: "wcval" + (w1 != null ? "" : " muted") }, w1 != null ? fmtW(toDisplay(w1)) : "—", el("span", { class: "wcu" }, " " + unit))),
        el("div", { class: "wcol" }, el("div", { class: "wctitle" }, "Week 2 avg"),
          el("div", { class: "wcval" + (w2 != null ? "" : " muted") }, w2 != null ? fmtW(toDisplay(w2)) : "—", el("span", { class: "wcu" }, " " + unit)))
      )
    );
    if (w1 != null && w2 != null) {
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
    // plan.js sync: link the file once (auto-write thereafter), or download it
    // on browsers without the File System Access API.
    if (FS_SUPPORTED) {
      tools.appendChild(el("button", { class: "tool", onClick: linkPlanFile },
        planHandle ? "✓ plan.js linked" : "Link plan.js"));
    } else {
      tools.appendChild(el("button", { class: "tool", onClick: downloadPlan }, "Download plan.js"));
    }
    tools.appendChild(el("button", { class: "tool", onClick: setupCloud },
      window.Store.getCloudConfig() ? "✓ Sync on" : "Set up sync"));
    wrap.appendChild(tools);

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

  // ---- plan.js auto-sync ----
  // Serialize the current config + quick-add foods back into plan.js source.
  function planText() {
    const foodsStr = Object.entries(foods).map(([slot, items]) => {
      const lines = items.map((it) =>
        `      { n: ${JSON.stringify(it.n)}, c: ${it.c}, p: ${it.p}, cb: ${it.cb}, f: ${it.f} },`
      ).join("\n");
      return `    ${JSON.stringify(slot)}: [\n${lines}\n    ],`;
    }).join("\n");
    return `// ============================================================
//  plan.js — your plan config. Edit these values anytime.
//  This is the single source of truth for targets + foods.
//  Claude Code can extend this file to add features later.
// ============================================================

window.PLAN = {
  // Daily targets from the lean-bulk plan
  targets: { cal: ${T.cal}, protein: ${T.protein}, carbs: ${T.carbs}, fat: ${T.fat} },

  // 14-day tracking window. Change startDate to roll the window forward.
  startDate: ${JSON.stringify(P.startDate)}, // YYYY-MM-DD
  numDays: ${P.numDays},

  // Weight goal guidance shown in the trend panel
  weightGoal: {
    minGainKg: ${P.weightGoal.minGainKg},
    maxGainKg: ${P.weightGoal.maxGainKg},
    note: ${JSON.stringify(P.weightGoal.note)},
  },

  // Quick-add foods, grouped into meal slots. Macros: c=calories, p=protein,
  // cb=carbs, f=fat (grams). Slots render in the order listed below; the slot
  // name is the heading shown in the Quick add tab.
  foods: {
${foodsStr}
  },
};
`;
  }

  // Push the current foods into plan.js: write to the linked file if we have a
  // handle, otherwise (no File System Access API) fall back to a download.
  function syncPlan() {
    if (planHandle) writePlanFile();
    else if (!FS_SUPPORTED) downloadPlan();
    // FS supported but not linked yet: user links once via the tools button.
  }
  async function writePlanFile() {
    if (!planHandle) return false;
    try {
      const opts = { mode: "readwrite" };
      if ((await planHandle.queryPermission(opts)) !== "granted" &&
          (await planHandle.requestPermission(opts)) !== "granted") {
        flash(false); return false;
      }
      const w = await planHandle.createWritable();
      await w.write(planText());
      await w.close();
      flash(true);
      return true;
    } catch (e) { console.warn("plan.js write failed", e); flash(false); return false; }
  }
  async function linkPlanFile() {
    try {
      const [h] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "JavaScript", accept: { "text/javascript": [".js"] } }],
      });
      planHandle = h;
      await window.Store.setPlanFileHandle(h);
      await writePlanFile();
      render();
    } catch (e) { /* user cancelled the picker */ }
  }
  function downloadPlan() {
    const blob = new Blob([planText()], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plan.js";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Configure cloud sync. Enter the same Firebase URL + secret code on every
  // device; syncInit then pulls shared data and future writes push to it.
  function setupCloud() {
    const cfg = window.Store.getCloudConfig() || {};
    const url = prompt(
      "Firebase Realtime Database URL\n(e.g. https://yourproject-default-rtdb.firebaseio.com)",
      cfg.url || ""
    );
    if (url == null) return;
    const code = prompt("Sync code — use the SAME secret on every device:", cfg.code || "");
    if (code == null) return;
    if (!url.trim() || !code.trim()) { alert("Both the URL and a sync code are required."); return; }
    window.Store.setCloudConfig({ url: url.trim(), code: code.trim() });
    window.Store.syncInit();
    render();
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
