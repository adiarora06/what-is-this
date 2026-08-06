const CACHE_NAME = "what-is-this-shell-v3";
const APP_SHELL = ["/"];
const MAX_CACHED_ASSETS = 40;

async function trimCache(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_CACHED_ASSETS)).map((request) => cache.delete(request)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("range")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/ort/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png";
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          void caches.open(CACHE_NAME).then(async (cache) => {
            await cache.put(request, response.clone());
            await trimCache(cache);
          });
        }
        return response;
      });
      return cached || network;
    }),
  );
});
