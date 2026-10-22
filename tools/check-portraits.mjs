#!/usr/bin/env node
/** Codex portrait inventory.
 *
 * Fails when `shippedPortraits` and `web/public/portraits/` disagree, so a listed portrait
 * cannot be missing and a present one cannot be silently unused -- the same contract
 * `check-effects.mjs` enforces for the hit effects, and for the same reason: a card must
 * never request a file that is not there.
 *
 * A hero with no portrait is not a problem. The Codex falls back to that hero's battle
 * sprite, which is a real likeness and already loaded, so the screen is complete from day
 * one and each portrait upgrades one card as it lands.
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {decodePng} from './png.mjs';

const repoPath = p => new URL(`../${p}`, import.meta.url);
const dir = repoPath('web/public/portraits');
const catalog = readFileSync(repoPath('web/src/portrait-catalog.ts'), 'utf8');
const {heroIds} = await import('../dist/src/roster.js');

const EXPECTED = 64;

// Read the shipped list out of the module text rather than importing it: the catalog imports
// `media-url.js`, which reaches for a Vite `define` that does not exist outside a build.
const listed = (() => {
  const m = catalog.match(/shippedPortraits:\s*readonly HeroId\[\]\s*=\s*\[([^\]]*)\]/);
  if (!m) {
    console.error('\n  PROBLEM  could not find shippedPortraits in portrait-catalog.ts');
    process.exit(1);
  }
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
})();

const onDisk = new Set(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png')) : []);
const problems = [];
const advice = [];

console.log('\nCODEX PORTRAITS\n');
console.log('       hero         file              art');
for (const id of heroIds) {
  const file = `${id}.png`;
  const present = onDisk.has(file);
  const isListed = listed.has(id);
  let note = present ? 'live' : 'sprite fallback';
  if (present) {
    try {
      const img = decodePng(readFileSync(new URL(`${file}`, `${dir}/`)));
      note = `live  ${img.width}x${img.height}`;
      if (img.width !== EXPECTED || img.height !== EXPECTED) {
        problems.push(`${file} is ${img.width}x${img.height}, not ${EXPECTED}x${EXPECTED}; `
          + 'the card reserves a fixed box, so an odd size is scaled and goes soft');
      }
    } catch (error) {
      problems.push(`${file} could not be decoded: ${error.message}`);
    }
  }
  console.log(`  ${isListed && present ? 'OK  ' : present || isListed ? '??  ' : '--  '} `
    + `${id.padEnd(12)} ${file.padEnd(17)} ${note}`);
  if (present && !isListed) {
    advice.push(`${file} exists but ${id} is not in shippedPortraits, so it is never shown`);
  }
  if (isListed && !present) {
    problems.push(`${id} is listed as shipped but ${file} is not in web/public/portraits/, `
      + 'so the card would request a file that is not there');
  }
}

const known = new Set(heroIds.map(id => `${id}.png`));
for (const file of onDisk) {
  if (!known.has(file)) advice.push(`${file} is in portraits/ but matches no hero id`);
}

console.log('');
for (const p of problems) console.log(`  PROBLEM  ${p}`);
for (const a of advice) console.log(`  ADVICE   ${a}`);

const live = heroIds.filter(id => listed.has(id) && onDisk.has(`${id}.png`)).length;
console.log(`\n  ${live}/${heroIds.length} portraits live.`);
if (live < heroIds.length) {
  console.log('  The rest fall back to the hero\'s battle sprite, which is already loaded.');
  console.log('  Drop a 64x64 PNG in web/public/portraits/<id>.png and add the id to');
  console.log('  shippedPortraits in web/src/portrait-catalog.ts.');
}
console.log('');
process.exit(problems.length ? 1 : 0);
