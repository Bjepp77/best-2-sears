const SHELL_HASH = '7e87dc3a3d26';
const SHELL_CACHE = `mk-shell-${SHELL_HASH}`;
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'styles.css', 'config.json', 'manifest.webmanifest', 'favicon.svg', 'data/index.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
  // No skipWaiting here: the page offers an update and the user chooses when.
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mk-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('fresh')) return; // page's freshness check goes to the network
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html', { cacheName: SHELL_CACHE })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
