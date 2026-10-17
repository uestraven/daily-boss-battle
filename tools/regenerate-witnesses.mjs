#!/usr/bin/env node
/** Regenerates the curated daily witnesses after boss content is retuned.
 *
 * A witness is a solver-found winning line, replayed through the authoritative
 * engine, stored with its exact expected outcome. Retuning a boss invalidates the
 * old line, so this re-solves each curated encounter and rewrites the fixture.
 *
 *   node tools/regenerate-witnesses.mjs            rewrite the fixture
 *   node tools/regenerate-witnesses.mjs --dry-run  report without writing
 *
 * Fails loudly rather than writing a fixture it could not verify.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {practiceEncounters} = await import(`${root}/dist/src/encounters.js`);
const {tyrantAI008} = await import(`${root}/dist/src/ai-variant.js`);
const {solveEncounter} = await import(`${root}/dist/src/solver.js`);
const {replay, starsForResult} = await import(`${root}/dist/src/engine.js`);

const dryRun = process.argv.includes('--dry-run');
const fixturePath = `${root}/fixtures/daily-witnesses-v10.json`;
const existing = JSON.parse(readFileSync(fixturePath, 'utf8'));

/** Maintains exactly the witnesses the fixture already declares; it never invents new
 * entries. The curated fixture is the frozen legacy corpus for the six original daily
 * templates — bosses added later are pool content and are verified by the gate suite
 * instead (see tools/generate-pool.mjs). */
const encounterFor = key => (key === 'blade_tyrant' ? tyrantAI008 : practiceEncounters[key]);
const targets = Object.keys(existing)
  .filter(key => {
    const def = encounterFor(key);
    if (!def) console.warn(`${key}: no encounter found; leaving its witness untouched`);
    return Boolean(def);
  })
  .map(key => [key, encounterFor(key)]);
if (!targets.length) {
  console.error('The witness fixture declares no maintainable entries.');
  process.exit(1);
}

const BUDGETS = [
  {beamWidth: 48, maxHeroActions: 36, maxExpansions: 6000, maxSolutions: 6},
  {beamWidth: 96, maxHeroActions: 44, maxExpansions: 20000, maxSolutions: 6},
  {beamWidth: 160, maxHeroActions: 52, maxExpansions: 60000, maxSolutions: 6},
];

const output = {...existing};
const failures = [];

for (const [key, def] of targets) {
  const previous = existing[key];

  // blade_tyrant's line is vetted and its content is untouched; keep it verbatim
  // if it still replays to the expected result.
  if (previous?.actions) {
    try {
      const state = replay(def, previous.actions).state;
      if (state.result === 'victory' && starsForResult(state) === previous.expected?.stars
        && state.tick === previous.expected?.finalTick) {
        output[key] = previous;
        console.log(`${key.padEnd(15)} unchanged (existing witness still valid: ${previous.actions.length} actions, ${previous.expected.stars}★)`);
        continue;
      }
    } catch { /* fall through to re-solve */ }
  }

  let chosen = null;
  for (const budget of BUDGETS) {
    const report = solveEncounter(def, budget);
    // Prefer the best mastery available, then the shortest line.
    const verified = [];
    for (const solution of report.solutions) {
      const state = replay(def, solution.actions).state;
      if (state.result !== 'victory') throw new Error(`${key}: solver line failed engine replay`);
      verified.push({actions: solution.actions, stars: starsForResult(state), tick: state.tick,
        heroActions: state.heroActionCount, itemUses: state.itemUses});
    }
    const best = verified.sort((a, b) => b.stars - a.stars || a.heroActions - b.heroActions)[0];
    if (best) { chosen = best; if (best.stars === 3) break; }
  }

  if (!chosen) {
    failures.push(`${key}: no winning line found within the largest budget`);
    console.log(`${key.padEnd(15)} FAILED — no win found`);
    continue;
  }

  output[key] = {
    encounterId: def.id,
    actions: chosen.actions,
    expected: {
      finalTick: chosen.tick,
      actionCount: chosen.heroActions,
      itemUses: chosen.itemUses,
      stars: chosen.stars,
      result: 'victory',
    },
  };
  const note = chosen.stars === 3 ? '' : '   (no three-star line found)';
  console.log(`${key.padEnd(15)} ${chosen.heroActions} actions, tick ${chosen.tick}, ${chosen.stars}★${note}`);
}

if (failures.length) {
  console.error(`\n${failures.length} encounter(s) could not be witnessed:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nRetune these bosses before regenerating: node tools/tune-boss.mjs --boss <id>');
  process.exit(1);
}

if (dryRun) {
  console.log('\n--dry-run: fixture not written');
} else {
  writeFileSync(fixturePath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\nWrote ${Object.keys(output).length} witnesses to fixtures/daily-witnesses-v10.json`);
}
