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

  // Daily targets + tracking window. These seed "Cycle 1" the first time the app
  // runs; after that, cycles (their duration + targets) are created and edited in
  // the app's Cycles page and saved per-device/synced, so editing these values
  // only affects a fresh install.
  targets: { cal: 3800, protein: 155, carbs: 377, fat: 127, fiber: 50, sugar: 40 },
  startDate: "2026-06-20", // YYYY-MM-DD — Cycle 1 start
  numDays: 14,             // Cycle 1 length (rounded to whole weeks)

  // Weight goal guidance shown in the trend panel
  weightGoal: {
    minGainKg: 0.5,
    maxGainKg: 1.0,
    note: "Target +0.5–1 kg over two weeks. Log weight each morning; only weekly averages matter.",
  },

  // Food catalog — your master library, grouped by macro category. Macros:
  // c=calories, p=protein, cb=carbs, f=fat, fi=fiber, sg=added sugar (grams). Categories render in
  // the order listed below and are the sections shown in the Catalog tab. The chip
  // colour is derived from each food's *dominant* macro at render time, so where you
  // file a food only affects organization, not its colour. Add/edit/move foods
  // freely, and add or rename categories by editing the keys. To plan a day, tap a
  // catalog food and pick a meal — it drops into the Log items journal for that day.
  foods: {
    "Protein": [
      { n: "Chicken breast 200g raw", c: 220, p: 46, cb: 0, f: 5, fi: 0 },
      { n: "Chicken thighs 200g raw", c: 220, p: 46, cb: 0, f: 8, fi: 0 },
      { n: "4 scrambled eggs", c: 280, p: 24, cb: 2, f: 20, fi: 0 },
      { n: "Paneer 200g", c: 520, p: 36, cb: 6, f: 40, fi: 0 },
      { n: "Whole milk 200ml", c: 130, p: 7, cb: 10, f: 7, fi: 0 },
    ],
    "Carbs": [
      { n: "Sweet potato 400g", c: 344, p: 6, cb: 80, f: 0, fi: 12 },
      { n: "2 cups quinoa (cooked)", c: 1290, p: 48, cb: 226, f: 20, fi: 10 },
      { n: "2 slices bread", c: 240, p: 8, cb: 28, f: 10, fi: 4 },
      { n: "Whole wheat pasta (medium)", c: 420, p: 15, cb: 84, f: 2, fi: 8 },
      { n: "Green juice + celery", c: 250, p: 4, cb: 62, f: 1, fi: 4 },
    ],
    "Fruit": [
      { n: "Banana", c: 105, p: 1, cb: 27, f: 0, fi: 3 },
      { n: "Apple", c: 95, p: 0, cb: 25, f: 0, fi: 4 },
      { n: "Blueberries 100g", c: 57, p: 1, cb: 14, f: 0, fi: 2 },
      { n: "Orange", c: 62, p: 1, cb: 15, f: 0, fi: 3 },
    ],
    "Fat": [
      { n: "Avocado", c: 240, p: 3, cb: 13, f: 22, fi: 10 },
    ],
    "Vegetables": [
      { n: "Broccoli 100g", c: 34, p: 3, cb: 7, f: 0, fi: 3 },
      { n: "Spinach 100g", c: 23, p: 3, cb: 4, f: 0, fi: 2 },
      { n: "Green salad + olive oil", c: 128, p: 4, cb: 11, f: 9, fi: 3 },
      { n: "Kimchi 100g", c: 25, p: 2, cb: 4, f: 1, fi: 2 },
      { n: "Sauerkraut 100g", c: 20, p: 1, cb: 4, f: 0, fi: 3 },
    ],
    "Snacks": [
      { n: "Kefir 200ml", c: 120, p: 6, cb: 9, f: 4, fi: 0 },
      { n: "2 boiled eggs", c: 140, p: 12, cb: 1, f: 10, fi: 0 },
    ],
  },
};
