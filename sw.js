// sw.js — caches the app shell so it works offline once loaded.
const CACHE = "mealtracker-v43";
const ASSETS = [
  ".",
  "index.html",
  "plan.js",
  "store.js",
  "app.js",
  "manifest.json",
  "icon.svg",
  "images/image_2.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for our own files: always try the network so a normal reload
// picks up new deploys, and refresh the cache with each success. Fall back to
// cache only when offline. Same-origin GETs only — cross-origin requests (e.g.
// Firebase sync) pass straight through untouched.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
