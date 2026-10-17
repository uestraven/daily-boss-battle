/** The gate suite: the production definition of a fair, intense, multi-solution
 * encounter. Uses synthetic encounters with controlled outcomes so these assertions
 * do not move when live content is retuned. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_GATES, QUICK_GATES, TIER_MARGIN_P33, TIER_PUNISHING_ACTIONS,
  assessEncounter, tierFor} from '../dist/src/gates.js';
import {buildEncounter, bossIds} from '../dist/src/generate.js';
import {bossProfiles} from '../dist/src/encounters.js';
import {balancedParties} from '../dist/src/draft.js';

const GATE_IDS = ['winnable', 'non_trivial', 'multi_path', 'no_forced_ability', 'losable', 'length_band'];
const party = balancedParties()[0];
const clone = v => JSON.parse(JSON.stringify(v));
/** Small budgets: these tests assert gate logic, not search depth. */
const FAST = {...QUICK_GATES, beamWidth: 16, maxExpansions: 400, maxSolutions: 4, maxHeroActions: 24};

function profileWith(bossId, mutate) {
  const profile = clone(bossProfiles.find(b => b.id === bossId));
  mutate(profile);
  return profile;
}

test('an assessment reports every gate with a consistent failure list', () => {
  const assessment = assessEncounter(buildEncounter(bossIds[0], party), FAST);
  assert.deepEqual(Object.keys(assessment.gates).sort(), [...GATE_IDS].sort());
  for (const id of GATE_IDS) {
    assert.equal(typeof assessment.gates[id].ok, 'boolean', id);
    assert.equal(typeof assessment.gates[id].detail, 'string', id);
    assert.ok(assessment.gates[id].detail.length > 0, `${id} must explain itself`);
  }
  const failed = GATE_IDS.filter(id => !assessment.gates[id].ok).sort();
  assert.deepEqual([...assessment.failedGates].sort(), failed);
  assert.equal(assessment.passed, failed.length === 0);
  assert.equal(assessment.encounterId, buildEncounter(bossIds[0], party).id);
  assert.deepEqual(assessment.party, party);
});

test('an unwinnable encounter fails closed with no witness', () => {
  const unbeatable = profileWith('tide_maw', p => { p.stats.hp = 500_000; });
  const assessment = assessEncounter(buildEncounter(unbeatable, party), FAST);
  assert.equal(assessment.passed, false);
  assert.equal(assessment.gates.winnable.ok, false);
  assert.equal(assessment.difficulty, null);
  assert.equal(assessment.witness, null);
  // Nothing may be asserted about a fight nobody can win.
  assert.deepEqual([...assessment.failedGates].sort(), [...GATE_IDS].sort());
  for (const id of GATE_IDS.filter(g => g !== 'winnable')) {
    assert.match(assessment.gates[id].detail, /no verified win/);
  }
});

test('a trivial encounter is rejected for being trivial, not for being unwinnable', () => {
  const pushover = profileWith('tide_maw', p => {
    p.stats.hp = 120;
    for (const ability of p.abilities) if (typeof ability.power === 'number') ability.power = 1;
  });
  const assessment = assessEncounter(buildEncounter(pushover, party), FAST);
  assert.equal(assessment.gates.winnable.ok, true, 'it is winnable');
  assert.equal(assessment.passed, false, 'but it must not ship');
  assert.ok(assessment.failedGates.includes('length_band'), 'too short');
  assert.ok(assessment.difficulty.bestActions < DEFAULT_GATES.minActions);
});

test('an encounter a mindless policy can master fails non_trivial or losable', () => {
  const pushover = profileWith('tide_maw', p => {
    p.stats.hp = 300;
    for (const ability of p.abilities) if (typeof ability.power === 'number') ability.power = 1;
  });
  const assessment = assessEncounter(buildEncounter(pushover, party), FAST);
  const dumbGatesFailed = !assessment.gates.non_trivial.ok || !assessment.gates.losable.ok;
  assert.ok(dumbGatesFailed, 'a boss that cannot threaten anyone must be rejected');
});

test('assessment is deterministic for the same encounter', () => {
  const def = buildEncounter(bossIds[1] ?? bossIds[0], party);
  const first = assessEncounter(def, FAST);
  const second = assessEncounter(def, FAST);
  assert.deepEqual(first.gates, second.gates);
  assert.deepEqual(first.difficulty, second.difficulty);
  assert.deepEqual(first.witness, second.witness);
});

test('quick mode skips the forced-ability probe and full mode runs it', () => {
  const def = buildEncounter(bossIds[0], party);
  const quick = assessEncounter(def, {...FAST, forcedAbilityProbes: 0});
  assert.equal(quick.gates.no_forced_ability.ok, true);
  assert.match(quick.gates.no_forced_ability.detail, /skipped/);
  assert.equal(quick.cost.solverRuns, 1, 'one search when G4 is skipped');

  const full = assessEncounter(def, {...FAST, forcedAbilityProbes: 2});
  if (full.difficulty) {
    assert.ok(full.cost.solverRuns >= 1, 'G4 adds probe searches when there is a win to probe');
    assert.doesNotMatch(full.gates.no_forced_ability.detail, /skipped/);
  }
});

test('a verified witness is a three-star line or absent', () => {
  for (const bossId of bossIds.slice(0, 3)) {
    const assessment = assessEncounter(buildEncounter(bossId, party), FAST);
    if (assessment.witness) {
      assert.equal(assessment.difficulty.bestStars, 3, `${bossId} witness must be a three-star line`);
      assert.ok(assessment.witness.length > 0);
    }
  }
});

test('reported cost reflects the work actually done', () => {
  const assessment = assessEncounter(buildEncounter(bossIds[0], party), FAST);
  assert.ok(assessment.cost.expansions > 0);
  assert.ok(assessment.cost.solverRuns >= 1);
});

test('difficulty tiers partition on margin and length', () => {
  const base = {bestStars: 3, bestTick: 90, distinctStrategies: 4};
  const tier = (bestActions, marginPercent) => tierFor({difficulty: {...base, bestActions, marginPercent}});

  // Boundaries are margin terciles measured from a full pool run.
  assert.equal(tier(16, 45), 'approachable', 'high margin, short fight');
  assert.equal(tier(18, 28), 'standard', 'mid margin');
  assert.equal(tier(18, TIER_MARGIN_P33), 'punishing', 'at or below the p33 margin');
  assert.equal(tier(TIER_PUNISHING_ACTIONS, 60), 'punishing', 'a long fight is punishing regardless of margin');
  assert.equal(tier(24, 50), 'standard', 'high margin but too long to be approachable');
  assert.throws(() => tierFor({difficulty: null}), /Cannot tier/);

  // The three tiers must be reachable, or the weekday curve collapses.
  const reachable = new Set();
  for (let actions = 12; actions <= 32; actions++) {
    for (let margin = 0; margin <= 100; margin += 5) reachable.add(tier(actions, margin));
  }
  assert.deepEqual([...reachable].sort(), ['approachable', 'punishing', 'standard']);
});

test('gate thresholds are coherent', () => {
  for (const cfg of [DEFAULT_GATES, QUICK_GATES]) {
    assert.ok(cfg.minActions < cfg.maxActions);
    assert.ok(cfg.maxHeroActions >= cfg.maxActions, 'search depth must be able to reach the band');
    assert.ok(cfg.minDistinctStrategies >= 2, 'multiple strategies means at least two');
    assert.ok(cfg.maxSolutions >= cfg.minDistinctStrategies, 'cannot find N strategies in fewer solutions');
    assert.ok(cfg.maxExpansions > 0 && cfg.beamWidth > 0);
  }
});
