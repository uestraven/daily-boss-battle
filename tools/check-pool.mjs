#!/usr/bin/env node
/** Pool freshness gate.
 *
 * Fails if the committed verified pool was built from different content than the
 * repository currently contains. This is the check that stops an unverified daily
 * encounter from ever reaching a player: retune a boss without regenerating, and
 * CI refuses the build.
 *
 *   node tools/check-pool.mjs
 *   node tools/check-pool.mjs --path dist-content/verified-pool.json
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {load, repoPath, root} from './load.mjs';

const {contentHash, bossIds} = await load('dist/src/generate.js');
const {validatePool, selectDaily, dailyEncounter} = await load('dist/src/pool.js');
const {advanceToDecision, createEncounter} = await load('dist/src/engine.js');

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--path');
const poolPath = flagIndex === -1
  ? repoPath('dist-content/verified-pool.json')
  : path.resolve(args[flagIndex + 1]);

/** Repo-relative when inside the repo, absolute otherwise, so the path stays readable. */
const show = p => {
  const rel = path.relative(root, p);
  return rel.startsWith('..') ? p : rel;
};

if (!existsSync(poolPath)) {
  console.error(`No verified pool at ${show(poolPath)}`);
  console.error('Build one with:  npm run pool:build');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(poolPath, 'utf8'));
const expected = contentHash();

let pool;
try {
  pool = validatePool(raw, expected);
} catch (e) {
  console.error(`Pool check failed: ${e.message}`);
  process.exit(1);
}

const passing = pool.entries.filter(e => e.passed);
const bossesCovered = new Set(passing.map(e => e.bossId));
const missing = bossIds.filter(id => !bossesCovered.has(id));
const sizeKb = (statSync(poolPath).size / 1024).toFixed(0);

console.log(`\nVerified pool: ${show(poolPath)} (${sizeKb} KiB)`);
console.log(`  content hash    ${pool.contentHash}  (matches current content)`);
console.log(`  passing entries ${passing.length}`);
console.log(`  bosses covered  ${bossesCovered.size}/${bossIds.length}`);
if (raw.summary?.byTier) {
  console.log(`  tiers           ${Object.entries(raw.summary.byTier).map(([k, v]) => `${k} ${v}`).join('  ')}`);
}

// A pool that validates but cannot serve a daily is still a broken pool.
//
// The horizon starts at today rather than a fixed date, because the question this answers
// is "can the deployed site serve every day it is about to serve". A fixed historical
// window would keep passing while the next year was broken. Distant dates are probed too,
// since the day-to-entry mapping must not degrade once the cycle has turned over many
// times.
const HORIZON_DAYS = 400;
const dayStringsFrom = (start, count) => Array.from({length: count}, (_, i) => {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const probeDays = [
  ...dayStringsFrom(today, HORIZON_DAYS),
  // Far enough out to catch anything that drifts or overflows with the day index.
  ...['2030-02-28', '2032-02-29', '2040-12-31'],
];

const unservable = [];
const bossByDay = new Map();
for (const day of probeDays) {
  const entry = selectDaily(day, pool);
  if (!entry) { unservable.push(`${day} (no entry selected)`); continue; }
  // Serving an entry that did not pass the gates would defeat the whole offline
  // verification scheme, so check the flag rather than trusting selection.
  if (!entry.passed) { unservable.push(`${day} (selected an unverified entry)`); continue; }
  bossByDay.set(day, entry.bossId);
  try {
    const def = dailyEncounter(day, pool);
    const step = advanceToDecision(createEncounter(def), def);
    if (!step.readyHeroIds.length) unservable.push(`${day} (no ready hero)`);
  } catch (e) {
    unservable.push(`${day} (${e.message})`);
  }
}

if (unservable.length) {
  console.error(`\n  ${unservable.length} of ${probeDays.length} probe days cannot be served:`);
  for (const day of unservable.slice(0, 10)) console.error(`    ${day}`);
  process.exit(1);
}
console.log(`  daily probe     ${probeDays.length}/${probeDays.length} days playable ` +
  `(${probeDays[0]} onward)`);

// Repeating a boss on consecutive days is the most visible way the schedule can feel
// broken, and the collision repair in cycleOrder is subtle enough to be worth asserting.
const horizon = probeDays.slice(0, HORIZON_DAYS);
const repeats = horizon.filter((day, i) =>
  i > 0 && bossByDay.get(day) === bossByDay.get(horizon[i - 1]));
if (repeats.length) {
  console.error(`\n  FAIL: the same boss appears on consecutive days: ${repeats.slice(0, 5).join(', ')}`);
  process.exit(1);
}
const appearances = new Map();
for (const day of horizon) {
  appearances.set(bossByDay.get(day), (appearances.get(bossByDay.get(day)) ?? 0) + 1);
}
const starved = bossIds.filter(id => !appearances.has(id));
if (starved.length) {
  console.error(`\n  FAIL: these bosses never appear in ${HORIZON_DAYS} days: ${starved.join(', ')}`);
  process.exit(1);
}
const counts = [...appearances.values()];
console.log(`  schedule        no repeats; all ${appearances.size} bosses appear ` +
  `(${Math.min(...counts)}-${Math.max(...counts)} times each)`);

if (missing.length) {
  console.error(`\n  FAIL: no verified encounter for: ${missing.join(', ')}`);
  console.error('  These bosses can never appear. Retune them:');
  for (const id of missing) console.error(`    node tools/tune-boss.mjs --boss ${id}`);
  process.exit(1);
}

console.log('\nPool is fresh and every boss is reachable.\n');
