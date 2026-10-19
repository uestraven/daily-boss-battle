import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

/** A token that changes whenever the deployed art might have.
 *
 * Game assets live in `public/` under names that never change (`heroes/machinist.png`),
 * and the service worker serves them stale-while-revalidate. That combination means a
 * returning player keeps the *previous* bytes for one more visit — which is tolerable for
 * a recoloured sprite and broken for a resized one. Adding an eighth row to a sheet took
 * it from 7 rows to 8: the new manifest asked for row 7 of a cached 7-row image, so the
 * Machinist's walk played his old victory and his victory drew nothing at all, silently,
 * because `drawImage` with a source rect past the bottom edge is a no-op rather than an
 * error.
 *
 * Appending this to every media URL makes new art a new URL, so it cannot be served from
 * an entry cached against the old one. The commit sha is the right granularity: art only
 * changes in a commit, and it stays stable across rebuilds of the same commit so the
 * caching still works. Cloudflare exposes the sha directly; a plain checkout has git; a
 * tarball with neither falls back to the build time, which busts more often than needed
 * but never too little. */
const assetRev = (() => {
  const fromCI = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromCI) return fromCI.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', {stdio: ['ignore', 'pipe', 'ignore']})
      .toString().trim();
  } catch {
    return String(Date.now());
  }
})();

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  define: {__ASSET_REV__: JSON.stringify(assetRev)},
  build: {outDir: '../web-dist', emptyOutDir: true, target: 'es2022'},
  // host: true binds all interfaces so a phone on the same network can open the dev
  // server directly. Testing on the real Android target answers the questions that
  // matter -- touch latency, 60fps, safe areas -- without needing a native wrapper.
  server: {host: true, port: 5173, strictPort: false, fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
});
