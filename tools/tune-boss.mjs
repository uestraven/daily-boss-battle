#!/usr/bin/env node
/** Boss tuning search.
 *
 * Sweeps boss HP and ability power against a sample of drafted parties and reports
 * which settings land encounters inside the gate-passing band. Use it when adding a
 * boss or when the gates reject existing content, instead of guessing at numbers.
 *
 *   node tools/tune-boss.mjs                      sweep every boss
 *   node tools/tune-boss.mjs --boss tide_maw      sweep one boss
 *   node tools/tune-boss.mjs --parties 6          samples per candidate (default 4)
 *   node tools/tune-boss.mjs --apply              print ready-to-paste stat lines
 */
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {bossProfiles} = await import(`${root}/dist/src/encounters.js`);
const {buildEncounter} = await import(`${root}/dist/src/generate.js`);
const {assessEncounter, QUICK_GATES} = await import(`${root}/dist/src/gates.js`);
const {balancedParties} = await import(`${root}/dist/src/draft.js`);

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const only = flag('--boss');
const sampleCount = Number(flag('--parties', '4'));

// Searches both directions: new content is often over-tuned, not under-tuned.
const HP_MULTIPLIERS = [0.55, 0.7, 0.85, 1, 1.6, 2.2, 2.8, 3.4];
const POWER_MULTIPLIERS = [0.6, 0.75, 0.9, 1, 1.2, 1.45];

const clone = v => JSON.parse(JSON.stringify(v));

/** Evenly spread sample parties, stable across runs. */
const pool = balancedParties();
const samples = Array.from({length: sampleCount}, (_, i) =>
  pool[Math.floor((i * pool.length) / sampleCount)]);

function scaled(profile, hpMultiplier, powerMultiplier) {
  const next = clone(profile);
  next.stats.hp = Math.round(profile.stats.hp * hpMultiplier);
  for (const ability of next.abilities) {
    if (typeof ability.power === 'number') ability.power = Math.round(ability.power * powerMultiplier);
  }
  return next;
}

function evaluate(profile, hpMultiplier, powerMultiplier) {
  const tuned = scaled(profile, hpMultiplier, powerMultiplier);
  const rows = [];
  for (const party of samples) {
    try {
      const assessment = assessEncounter(buildEncounter(tuned, party), QUICK_GATES);
      rows.push(assessment);
    } catch (e) {
      rows.push({passed: false, failedGates: ['error'], difficulty: null, error: String(e.message ?? e)});
    }
  }
  const passed = rows.filter(r => r.passed).length;
  const actions = rows.map(r => r.difficulty?.bestActions).filter(n => typeof n === 'number');
  const failures = new Map();
  for (const row of rows) for (const gate of row.failedGates) failures.set(gate, (failures.get(gate) ?? 0) + 1);
  return {
    passed,
    total: rows.length,
    medianActions: actions.length ? actions.sort((a, b) => a - b)[Math.floor(actions.length / 2)] : null,
    actionRange: actions.length ? [actions[0], actions[actions.length - 1]] : null,
    failures: [...failures].sort((a, b) => b[1] - a[1]),
  };
}

const targets = only ? bossProfiles.filter(b => b.id === only) : bossProfiles;
if (!targets.length) {
  console.error(`No such boss: ${only}. Known: ${bossProfiles.map(b => b.id).join(', ')}`);
  process.exit(1);
}

const recommendations = [];
for (const profile of targets) {
  console.log(`\n=== ${profile.id}  (current HP ${profile.stats.hp}) ===`);
  console.log('  hp×   pow×   pass   medianActions  range      dominant failures');
  const results = [];
  for (const hp of HP_MULTIPLIERS) {
    for (const power of POWER_MULTIPLIERS) {
      const r = evaluate(profile, hp, power);
      results.push({hp, power, ...r});
      console.log(
        `  ${String(hp).padEnd(5)} ${String(power).padEnd(6)} ${String(`${r.passed}/${r.total}`).padStart(5)}` +
        `   ${String(r.medianActions ?? '-').padStart(13)}  ${String(r.actionRange ? r.actionRange.join('-') : '-').padEnd(10)} ` +
        r.failures.map(([g, n]) => `${g}×${n}`).join(' '));
    }
  }
  // Prefer the highest pass rate, then the median action count nearest the band centre.
  const centre = (QUICK_GATES.minActions + QUICK_GATES.maxActions) / 2;
  const best = [...results].sort((a, b) =>
    b.passed - a.passed ||
    Math.abs((a.medianActions ?? 99) - centre) - Math.abs((b.medianActions ?? 99) - centre))[0];
  recommendations.push({profile, best});
  console.log(`  -> best: hp×${best.hp} pow×${best.power} (${best.passed}/${best.total} pass, median ${best.medianActions} actions)`);
}

console.log('\n=== RECOMMENDED STATS ===\n');
for (const {profile, best} of recommendations) {
  const tuned = scaled(profile, best.hp, best.power);
  console.log(`${profile.id}: hp ${profile.stats.hp} -> ${tuned.stats.hp}   (pow ×${best.power}, ${best.passed}/${best.total} sampled parties pass)`);
  if (args.includes('--apply')) {
    for (const ability of tuned.abilities) {
      const before = profile.abilities.find(a => a.id === ability.id);
      if (typeof ability.power === 'number' && before.power !== ability.power) {
        console.log(`    ${ability.id}: power ${before.power} -> ${ability.power}`);
      }
    }
  }
}
console.log();
