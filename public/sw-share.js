// Scopeflow service worker (WS-06, SF-03). It exists only so the installed app can be a share
// target. It caches nothing and serves nothing offline: every request, including the share
// target's POST to /api/share, goes straight to the network. Client data never lands in a cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.clients.claim();
  })());
});
