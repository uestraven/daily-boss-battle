#!/usr/bin/env node
/** Draft pool report: how many three-hero teams are viable, why the rest are not,
 * and how much work the offline verifier will therefore have to do.
 *
 * Run after any roster or ability change to see the effect on variety before
 * committing to a full verification pass.
 *
 *   npm run draft:check
 */
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {heroes} = await import(`${root}/dist/src/roster.js`);
const {bossProfiles} = await import(`${root}/dist/src/encounters.js`);
const {balancedParties, heroCapabilities, inspectParty} = await import(`${root}/dist/src/draft.js`);

const ids = heroes.map(h => h.id).sort();
const total = (ids.length * (ids.length - 1) * (ids.length - 2)) / 6;
const pool = balancedParties();

console.log('\nHERO CAPABILITIES\n');
for (const hero of heroes) {
  console.log(`  ${hero.id.padEnd(12)} ${hero.role.padEnd(11)} ${heroCapabilities[hero.id].join(', ')}`);
}

// Tally why parties are rejected, so a narrowing roster is obvious at a glance.
const rejections = new Map();
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++)
    for (let k = j + 1; k < ids.length; k++) {
      const result = inspectParty([ids[i], ids[j], ids[k]]);
      if (result.ok) continue;
      for (const reason of result.reasons) rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
    }

console.log('\nDRAFT POOL\n');
console.log(`  viable parties      ${pool.length} of ${total} (${((100 * pool.length) / total).toFixed(1)}%)`);
console.log(`  bosses              ${bossProfiles.length + 1}`);
console.log(`  encounters to verify ${pool.length * (bossProfiles.length + 1)}`);

console.log('\nREJECTION REASONS\n');
for (const [reason, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${reason}`);
}

// Variety check: a hero appearing in very few viable parties is effectively unplayable.
console.log('\nHERO APPEARANCE RATE IN VIABLE PARTIES\n');
const appearances = Object.fromEntries(ids.map(id => [id, 0]));
for (const party of pool) for (const id of party) appearances[id]++;
const sorted = [...Object.entries(appearances)].sort((a, b) => a[1] - b[1]);
for (const [id, count] of sorted) {
  const share = (100 * count) / pool.length;
  const bar = '#'.repeat(Math.round(share / 2));
  console.log(`  ${id.padEnd(12)} ${String(count).padStart(4)} (${share.toFixed(0).padStart(3)}%) ${bar}`);
}
const starved = sorted.filter(([, count]) => count < pool.length * 0.1);
if (starved.length) {
  console.log(`\n  WARNING: under-represented heroes: ${starved.map(([id]) => id).join(', ')}`);
  console.log('  These rarely appear in a random daily. Consider widening their kit.');
}
console.log();
