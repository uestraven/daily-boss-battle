#!/usr/bin/env node
/** Validates the web app manifest and its icons against what platforms actually require.
 *
 * Checks the declared icon dimensions against the real PNG headers, because a manifest
 * that lies about a size is accepted silently and then renders blurry.
 *
 *   npm run pwa:check
 */
import {existsSync, readFileSync} from 'node:fs';
import {decodePng} from './png.mjs';
import {repoPath} from './load.mjs';

const problems = [];
const advice = [];

const manifestPath = repoPath('web/public/manifest.webmanifest');
if (!existsSync(manifestPath)) {
  console.error('No manifest at web/public/manifest.webmanifest');
  process.exit(1);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Manifest is not valid JSON: ${error.message}`);
  process.exit(1);
}

console.log('\nWEB APP MANIFEST\n');
for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
  if (manifest[field] === undefined) problems.push(`missing required field "${field}"`);
}
console.log(`  name          ${manifest.name ?? '-'}`);
console.log(`  short_name    ${manifest.short_name ?? '-'}`);
console.log(`  display       ${manifest.display ?? '-'}`);
console.log(`  start_url     ${manifest.start_url ?? '-'}`);
console.log(`  theme_color   ${manifest.theme_color ?? '-'}`);

// A 12-character limit is where Android starts truncating under the icon.
if (manifest.short_name && manifest.short_name.length > 12) {
  advice.push(`short_name "${manifest.short_name}" is ${manifest.short_name.length} characters; ` +
    'Android truncates past about 12');
}
if (manifest.display && !['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
  advice.push(`display "${manifest.display}" will not feel like an installed app`);
}
if (!manifest.background_color) {
  advice.push('no background_color: the splash screen will be white, which will flash against a dark game');
}

console.log('\nICONS\n');
const sizesSeen = new Set();
let maskable = 0;
for (const icon of manifest.icons ?? []) {
  const file = repoPath('web/public', icon.src);
  if (!existsSync(file)) { problems.push(`icon file missing: ${icon.src}`); continue; }
  let actual = null;
  try {
    const image = decodePng(readFileSync(file));
    actual = `${image.width}x${image.height}`;
  } catch (error) {
    problems.push(`${icon.src} is not a readable PNG: ${error.message}`);
    continue;
  }
  // A declared size that does not match the file renders blurry and is never reported.
  if (icon.sizes && icon.sizes !== actual) {
    problems.push(`${icon.src} declares ${icon.sizes} but is actually ${actual}`);
  }
  for (const size of (icon.sizes ?? '').split(' ')) sizesSeen.add(size);
  const purposes = (icon.purpose ?? 'any').split(/\s+/);
  if (purposes.includes('maskable')) maskable++;
  console.log(`  OK  ${icon.src.padEnd(30)} ${actual.padEnd(9)} ${purposes.join(', ')}`);
}
if (!sizesSeen.has('192x192')) problems.push('no 192x192 icon; required for installability');
if (!sizesSeen.has('512x512')) problems.push('no 512x512 icon; required for the splash screen');
if (!maskable) {
  advice.push('no maskable icon: Android will letterbox the icon inside its adaptive shape');
}

console.log('\nHTML\n');
const html = readFileSync(repoPath('web/index.html'), 'utf8');
const requirements = [
  {test: /rel="manifest"/, label: 'manifest linked',
    missing: 'the manifest is not linked from index.html, so nothing is installable'},
  {test: /rel="apple-touch-icon"/, label: 'apple-touch-icon',
    missing: 'no apple-touch-icon: iOS will screenshot the page for the home screen'},
  {test: /name="viewport"[^>]*viewport-fit=cover/, label: 'viewport-fit=cover',
    missing: 'viewport lacks viewport-fit=cover, which safe-area insets need'},
  {test: /name="theme-color"/, label: 'theme-color',
    missing: 'no theme-color meta: the browser chrome will not match the game'},
  {test: /property="og:title"/, label: 'open graph',
    missing: 'no Open Graph tags: a shared link will preview as a bare URL'},
];
for (const requirement of requirements) {
  const ok = requirement.test.test(html);
  console.log(`  ${ok ? 'OK  ' : '--  '} ${requirement.label}`);
  if (!ok) advice.push(requirement.missing);
}

console.log('\nSERVICE WORKER\n');
const swPath = repoPath('web/public/sw.js');
const swPresent = existsSync(swPath);
const sw = swPresent ? readFileSync(swPath, 'utf8') : '';
// Registration moved out of index.html into a module, so look in both places.
const sources = [html, ...['web/src/main.tsx', 'web/src/register-sw.ts']
  .filter(file => existsSync(repoPath(file)))
  .map(file => readFileSync(repoPath(file), 'utf8'))].join('\n');
const headersPath = repoPath('web/public/_headers');
const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';

const swChecks = [
  {ok: swPresent, label: 'web/public/sw.js exists',
    missing: 'no service worker: Chrome on Android will not offer "Install app", and there ' +
      'is no offline play'},
  // Chrome requires a *fetch* handler specifically; an install-only worker is ignored.
  {ok: /addEventListener\(\s*['"]fetch['"]/.test(sw), label: 'has a fetch handler',
    missing: 'the worker has no fetch handler, which is what Chrome checks for ' +
      'installability; an install-only worker does not count'},
  {ok: /serviceWorker\s*\.\s*register/.test(sources), label: 'registered by the app',
    missing: 'nothing calls serviceWorker.register(), so the worker is never installed'},
  // Without this, a broken worker is served from cache and becomes effectively permanent.
  {ok: /\/sw\.js[\s\S]*?Cache-Control:\s*no-cache/i.test(headers),
    label: '_headers serves it no-cache',
    missing: '_headers does not send Cache-Control: no-cache for /sw.js. A worker cached by ' +
      'the browser cannot be replaced, so a bad deploy would be permanent for return visitors'},
];
for (const check of swChecks) {
  console.log(`  ${check.ok ? 'OK  ' : '--  '} ${check.label}`);
  if (!check.ok) problems.push(check.missing);
}
// The worker installs each shell entry with its own catch, so one missing file does not
// fail the install — which also means a typo would never be reported at runtime.
const shellBlock = sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
if (shellBlock) {
  const entries = [...shellBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const entry of entries) {
    const relative = entry.replace(/^\.\//, '');
    // index.html lives at web/, not web/public/; '/' is the same document.
    if (relative === '' || relative === 'index.html') continue;
    if (!existsSync(repoPath('web/public', relative))) {
      problems.push(`the worker precaches "${entry}", which is not in web/public`);
    }
  }
  console.log(`  OK   precaches ${entries.length} shell files`);
}

// Match a call, not the word: the worker's own comment explains why it does not do this.
if (swPresent && /skipWaiting\s*\(/.test(sw) && !/SKIP_WAITING/.test(sw)) {
  advice.push('the worker calls skipWaiting() unconditionally, so a new version takes over ' +
    'mid-session; make sure the page can survive its assets changing underneath it');
}

console.log('');
for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
for (const item of advice) console.log(`  ADVICE   ${item}`);
console.log('');
if (!problems.length) console.log('  Manifest and icons check out.\n');
process.exit(problems.length ? 1 : 0);
