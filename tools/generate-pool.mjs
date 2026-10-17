#!/usr/bin/env node
/** Verified-pool generator: the offline job that makes a random daily fair.
 *
 * Runs every (boss × viable party) combination through the gate suite and records
 * the ones that pass, with their difficulty tier and a winning witness. The app
 * draws its daily encounter only from this artifact, so a player can never be
 * dealt an unwinnable or trivial fight.
 *
 *   node tools/generate-pool.mjs                      full run, all bosses
 *   node tools/generate-pool.mjs --quick              reduced budgets, G4 skipped
 *   node tools/generate-pool.mjs --boss tide_maw      one boss
 *   node tools/generate-pool.mjs --limit 50           cap combinations (smoke test)
 *   node tools/generate-pool.mjs --out <path>         output path
 *   node tools/generate-pool.mjs --witnesses          embed winning witnesses
 *
 * Resumable: an existing output file is reused for combinations whose content
 * hash still matches, so a re-run after adding one boss only evaluates the new work.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {bossProfiles} = await import(`${root}/dist/src/encounters.js`);
const {buildEncounter, contentHash, encounterIdFor} = await import(`${root}/dist/src/generate.js`);
const {assessEncounter, tierFor, DEFAULT_GATES, QUICK_GATES} = await import(`${root}/dist/src/gates.js`);
const {balancedParties} = await import(`${root}/dist/src/draft.js`);

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const quick = args.includes('--quick');
const keepWitnesses = args.includes('--witnesses');
const onlyBoss = flag('--boss');
const limit = Number(flag('--limit', '0'));
const outPath = flag('--out', `${root}/dist-content/verified-pool.json`);
const config = quick ? QUICK_GATES : DEFAULT_GATES;

const hash = contentHash();
const bosses = (onlyBoss ? bossProfiles.filter(b => b.id === onlyBoss) : bossProfiles).map(b => b.id);
if (!bosses.length) {
  console.error(`No such boss: ${onlyBoss}`);
  process.exit(1);
}
const parties = balancedParties();

// Reuse prior results when the content they were computed from has not changed.
const prior = new Map();
if (existsSync(outPath)) {
  try {
    const old = JSON.parse(readFileSync(outPath, 'utf8'));
    if (old.contentHash === hash && old.gateConfig?.name === (quick ? 'quick' : 'full')) {
      for (const entry of [...(old.entries ?? []), ...(old.rejected ?? [])]) prior.set(entry.id, entry);
      console.log(`Reusing ${prior.size} cached assessment(s) for unchanged content.`);
    } else {
      console.log('Content or gate config changed; recomputing from scratch.');
    }
  } catch { /* unreadable prior pool: recompute */ }
}

let combinations = [];
for (const bossId of bosses) for (const party of parties) combinations.push({bossId, party});
if (limit > 0) {
  // Interleave across bosses so a capped smoke run still covers every boss.
  const byBoss = new Map();
  for (const c of combinations) {
    if (!byBoss.has(c.bossId)) byBoss.set(c.bossId, []);
    byBoss.get(c.bossId).push(c);
  }
  const interleaved = [];
  for (let i = 0; interleaved.length < limit; i++) {
    let added = false;
    for (const list of byBoss.values()) {
      if (list[i]) { interleaved.push(list[i]); added = true; }
      if (interleaved.length >= limit) break;
    }
    if (!added) break;
  }
  combinations = interleaved;
}

console.log(`\nVerified pool generation`);
console.log(`  content hash   ${hash}`);
console.log(`  gate config    ${quick ? 'quick' : 'full'} (expansions ${config.maxExpansions}, G4 probes ${config.forcedAbilityProbes})`);
console.log(`  bosses         ${bosses.length}`);
console.log(`  viable parties ${parties.length}`);
console.log(`  combinations   ${combinations.length}\n`);

const accepted = [];
const rejected = [];
const failureTally = new Map();
const started = Date.now();
let evaluated = 0, reused = 0, errors = 0;

for (const [index, {bossId, party}] of combinations.entries()) {
  const id = encounterIdFor(bossId, party);
  let entry = prior.get(id);
  if (entry) {
    reused++;
  } else {
    try {
      const def = buildEncounter(bossId, party, {contentVersion: `1.0-pool|${hash}`});
      const assessment = assessEncounter(def, config);
      entry = {
        id,
        bossId,
        party: [...party],
        passed: assessment.passed,
        failedGates: assessment.failedGates,
        difficulty: assessment.difficulty,
        tier: assessment.passed ? tierFor(assessment) : null,
        ...(keepWitnesses && assessment.witness ? {witness: assessment.witness} : {}),
      };
    } catch (e) {
      errors++;
      entry = {id, bossId, party: [...party], passed: false, failedGates: ['error'],
        error: String(e?.message ?? e), difficulty: null, tier: null};
    }
    evaluated++;
  }
  (entry.passed ? accepted : rejected).push(entry);
  for (const gate of entry.failedGates ?? []) failureTally.set(gate, (failureTally.get(gate) ?? 0) + 1);

  if ((index + 1) % 25 === 0 || index + 1 === combinations.length) {
    const elapsed = (Date.now() - started) / 1000;
    const rate = evaluated ? elapsed / evaluated : 0;
    const remaining = Math.round(rate * (combinations.length - index - 1));
    process.stdout.write(
      `\r  ${index + 1}/${combinations.length}  accepted ${accepted.length}  ` +
      `rejected ${rejected.length}  ${elapsed.toFixed(0)}s elapsed  ~${remaining}s left   `);
  }
}
process.stdout.write('\n');

const byTier = {};
const byBossCount = {};
for (const entry of accepted) {
  byTier[entry.tier] = (byTier[entry.tier] ?? 0) + 1;
  byBossCount[entry.bossId] = (byBossCount[entry.bossId] ?? 0) + 1;
}

const pool = {
  schemaVersion: 1,
  contentHash: hash,
  generatedAt: new Date().toISOString(),
  gateConfig: {name: quick ? 'quick' : 'full', ...config},
  summary: {
    combinations: combinations.length,
    accepted: accepted.length,
    rejected: rejected.length,
    errors,
    byTier,
    byBoss: byBossCount,
    failureTally: Object.fromEntries([...failureTally].sort((a, b) => b[1] - a[1])),
  },
  // Sorted so the artifact is reproducible and diffable.
  entries: accepted.sort((a, b) => (a.id < b.id ? -1 : 1)),
  rejected: rejected.sort((a, b) => (a.id < b.id ? -1 : 1)),
};

writeFileSync(outPath, `${JSON.stringify(pool, null, 2)}\n`);

console.log(`\n=== SUMMARY ===`);
console.log(`  accepted      ${accepted.length} / ${combinations.length} (${((100 * accepted.length) / combinations.length).toFixed(1)}%)`);
console.log(`  evaluated     ${evaluated}  reused ${reused}  errors ${errors}`);
console.log(`  elapsed       ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`  by tier       ${Object.entries(byTier).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'}`);
console.log(`  by boss       ${Object.entries(byBossCount).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'}`);
console.log(`\n  gate failures (combinations affected):`);
for (const [gate, n] of [...failureTally].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${gate}`);
}
const starvedBosses = bosses.filter(b => !byBossCount[b]);
if (starvedBosses.length) {
  console.log(`\n  WARNING: no viable party for: ${starvedBosses.join(', ')}`);
  console.log('  Retune with: node tools/tune-boss.mjs --boss <id>');
}
console.log(`\nWrote ${path.relative(root, outPath)}\n`);
