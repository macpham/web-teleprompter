// The page registers this as sw.js?v=<APP_VERSION>, so bumping the version in index.html installs a fresh worker and cache.
const VERSION = 'tp-v' + (new URL(self.location).searchParams.get('v') || '0');
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// The host (GitHub Pages) lets browsers reuse each file for 10 minutes without asking the
// server, which would let the app open on a stale release. So this worker never trusts
// the browser's HTTP cache: `reload` here downloads every file afresh, and `no-cache`
// below checks each one with the server.
self.addEventListener('install', (e) => {
  const fresh = FILES.map((f) => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so a refresh always gets the current release while online; fall back to
// the cache offline. Fetching by URL rather than passing the request on, because a page
// navigation request can't be re-issued with a different cache mode in every browser.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      // The page asks for styles.css?v=N and app.js?v=N; the install step stored them
      // without the query, so fall back to a match that ignores it.
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match(e.request, { ignoreSearch: true })))
  );
});
