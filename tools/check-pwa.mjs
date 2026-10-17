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

const serviceWorker = existsSync(repoPath('web/public/sw.js'))
  || /serviceWorker\s*\.\s*register/.test(html);

console.log('');
for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
for (const item of advice) console.log(`  ADVICE   ${item}`);
console.log('');
if (!serviceWorker) {
  console.log('  NOTE: there is no service worker.');
  console.log('  The manifest and icons are enough for iOS "Add to Home Screen", and enough');
  console.log('  for the icon and splash screen everywhere. But Chrome on Android only offers');
  console.log('  "Install app" when a service worker with a fetch handler is registered, so');
  console.log('  the install prompt will not appear until one exists. Offline play also needs');
  console.log('  it, and this game is fully playable offline by design.');
  console.log('');
}
if (!problems.length) console.log('  Manifest and icons check out.\n');
process.exit(problems.length ? 1 : 0);
