/** Service worker: offline play, and the install prompt on Android.
 *
 * Deliberately hand-written and conservative. A service worker persists across visits, so
 * a bad one can keep serving a broken app to returning players. The rules that make that
 * unlikely:
 *
 *  - **HTML is never cache-first.** Navigations go to the network first and only fall back
 *    to the cache when offline, so a deploy always reaches people.
 *  - **Only successful, basic 200s are cached.** No opaque cross-origin responses, no 206
 *    partials from a Range request, no errors cached as though they were content.
 *  - **Cross-origin requests are not touched at all**, so the email endpoint is never
 *    intercepted.
 *  - **No skipWaiting.** A new worker waits until existing tabs close rather than taking
 *    over mid-session. Combined with network-first HTML, a returning visitor still gets
 *    the new build immediately; only the worker itself lags by one visit.
 *
 * `_headers` serves this file with `Cache-Control: no-cache`, which is the property that
 * makes a bad worker recoverable: the next visit always fetches a fresh one.
 *
 * To unregister by hand: devtools → Application → Service workers → Unregister.
 */

const VERSION = 'v1';
const SHELL_CACHE = `dbb-shell-${VERSION}`;
const ASSET_CACHE = `dbb-assets-${VERSION}`;
const CURRENT = new Set([SHELL_CACHE, ASSET_CACHE]);

/** The minimum needed to boot offline. Hashed bundles are not listed: their names change
 * every build, so they are cached on first use instead, which needs no build step. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map(url => cache.add(new Request(url, {cache: 'reload'})).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('dbb-') && !CURRENT.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Content-hashed bundles are immutable, so they can be served from cache without
 * revalidating. */
const isImmutable = url => url.pathname.includes('/assets/');

/** Unhashed assets copied from public/: worth serving fast and refreshing in the
 * background. */
const isGameAsset = url => /\/(battle-sprites|battle-backgrounds|battle-music|battle-sounds|icons)\//
  .test(url.pathname);

const cacheable = response => response
  && response.status === 200
  && response.type === 'basic';

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
  return response;
}

/** Serve from cache immediately, refresh in the background for next time. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(response => {
      if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const response = await update;
  if (response) return response;
  throw new Error('offline and not cached');
}

/** Always try the network, so a deploy is picked up; fall back to cache when offline. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const hit = await cache.match(request) ?? await cache.match('./index.html');
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  // A Range request would yield a 206, which must not be cached as a whole response.
  if (request.headers.has('range')) return;

  const url = new URL(request.url);
  // Never intercept another origin: the email endpoint and anything else stays untouched.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (isGameAsset(url) || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
  // Anything else falls through to the network untouched.
});
