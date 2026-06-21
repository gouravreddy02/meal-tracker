// ============================================================
//  plan.js — your plan config. Edit these values anytime.
//  This is the single source of truth for targets + foods.
//  Claude Code can extend this file to add features later.
// ============================================================

window.PLAN = {
  // Cloud sync (Firebase). These values are PUBLIC by design — security comes
  // from Firebase Auth + Realtime Database rules, not from hiding them. Fill in
  // from Firebase console → Project settings → your web app config. Leave the
  // placeholders to disable sync (app falls back to local-only storage).
  sync: {
    apiKey: "AIzaSyDqOMSnpTLSq2aR8egPlt3ki4WFeZ4BO5o",
    authDomain: "meal-tracker-12ca8.firebaseapp.com",
    databaseURL: "https://meal-tracker-12ca8-default-rtdb.firebaseio.com",
    projectId: "meal-tracker-12ca8",
  },

  // Daily targets from the lean-bulk plan
  targets: { cal: 3800, protein: 155, carbs: 377, fat: 127 },

  // 14-day tracking window. Change startDate to roll the window forward.
  startDate: "2026-06-20", // YYYY-MM-DD
  numDays: 14,

  // Weight goal guidance shown in the trend panel
  weightGoal: {
    minGainKg: 0.5,
    maxGainKg: 1.0,
    note: "Target +0.5–1 kg over two weeks. Log weight each morning; only weekly averages matter.",
  },

  // Quick-add foods, grouped into meal slots. Macros: c=calories, p=protein,
  // cb=carbs, f=fat (grams). Slots render in the order listed below; the slot
  // name is the heading shown in the Quick add tab. Add/edit/move foods freely,
  // and add or rename slots by editing the keys.
  foods: {
    "Before workout": [
      { n: "Green juice + celery", c: 250, p: 4, cb: 62, f: 1 },
      { n: "Banana", c: 105, p: 1, cb: 27, f: 0 },
    ],
    "After workout": [
      { n: "4 scrambled eggs", c: 280, p: 24, cb: 2, f: 20 },
      { n: "Whole milk 200ml", c: 130, p: 7, cb: 10, f: 7 },
      { n: "Sweet potato 400g", c: 344, p: 6, cb: 80, f: 0 },
    ],
    "Lunch": [
      { n: "Chicken breast 200g raw", c: 220, p: 46, cb: 0, f: 5 },
      { n: "2 cups quinoa (cooked)", c: 1290, p: 48, cb: 226, f: 20 },
      { n: "2 slices bread", c: 240, p: 8, cb: 28, f: 10 },
      { n: "Avocado", c: 240, p: 3, cb: 13, f: 22 },
      { n: "Green salad + olive oil", c: 128, p: 4, cb: 11, f: 9 },
    ],
    "Snacks": [
      { n: "Kefir 200ml", c: 120, p: 6, cb: 9, f: 4 },
      { n: "2 boiled eggs", c: 140, p: 12, cb: 1, f: 10 },
      { n: "Paneer 200g", c: 520, p: 36, cb: 6, f: 40 },
    ],
    "Dinner": [
      { n: "Chicken thighs 200g raw", c: 220, p: 46, cb: 0, f: 8 },
      { n: "Whole wheat pasta (medium)", c: 420, p: 15, cb: 84, f: 2 },
      { n: "Kimchi 100g", c: 25, p: 2, cb: 4, f: 1 },
      { n: "Sauerkraut 100g", c: 20, p: 1, cb: 4, f: 0 },
    ],
  },
};
