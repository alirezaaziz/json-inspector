// Offline support. Network-first so deploys are picked up immediately;
// the cache is only used when the network is unavailable.
const CACHE = 'json-inspector-v4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'icon.svg', 'favicon.ico', 'icons/favicon-32.png', 'manifest.webmanifest',
  'js/theme-init.js', 'js/main.js', 'js/state.js', 'js/util.js', 'js/path.js', 'js/parse.js', 'js/jsonpath.js',
  'js/search.js', 'js/diff.js', 'js/generate.js', 'js/share.js', 'js/storage.js', 'js/icons.js', 'js/ui.js',
  'js/tree.js', 'js/inspector.js', 'js/actions.js', 'js/samples.js',
  'js/views/raw.js', 'js/views/table.js', 'js/views/diff.js', 'js/views/generate.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || caches.match('index.html')))
  );
});
