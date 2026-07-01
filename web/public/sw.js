// budgetr service worker.
//
// Deliberately minimal: it provides PWA installability and an offline fallback
// page, and nothing else. It does NOT cache build assets. Next.js serves its
// content-hashed `/_next/static/*` files as immutable, so the browser's own HTTP
// cache handles them correctly — a rebuild produces new hashes that are fetched
// fresh, and there is no service-worker copy that can go stale. (An earlier
// version cached those chunks under a fixed name, which left the installed app
// serving mismatched JS after every rebuild.)

const CACHE = "budgetr-offline-v2";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)));
  // Take over as soon as possible so the fix reaches existing clients on reload.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop every cache except the current offline one. This purges the stale
  // build-asset caches left by older service workers, so upgrading to this
  // version self-heals a client that was serving mismatched chunks.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Network-first for page navigations (the data is live and server-rendered);
  // fall back to the offline page only when the network is unreachable. Static
  // assets and data requests are intentionally left to the browser/HTTP cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r ?? Response.error()),
      ),
    );
  }
});
