/** Registers the service worker in production builds.
 *
 * There is deliberately no "a new version is available, reload?" prompt. The worker does
 * not call `skipWaiting`, so a new one waits until existing tabs close — but that costs
 * nothing, because the worker serves HTML network-first: a returning visitor gets the new
 * `index.html`, which references new content-hashed bundles, which miss the cache and are
 * fetched fresh. Only the worker's own code lags by one visit, which is invisible.
 *
 * Dev is left alone. Vite serves modules unbundled over its own transform pipeline, and a
 * caching worker in front of that produces confusing stale-module bugs; `public/sw.js` is
 * also served at `/sw.js` in dev, so registering would actually take effect.
 */
const SW_URL = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}sw.js`;
const SCOPE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  // Registration competes with the first paint and the first battle's assets, so wait
  // until the page has settled rather than racing it.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(SW_URL, {scope: SCOPE}).catch((error: unknown) => {
      // A failed registration must never break the game: it is fully playable online
      // without one. Most likely causes are an unsupported scope or a private window.
      console.warn('Service worker registration failed; continuing without offline support.',
        error);
    });
  });
}
