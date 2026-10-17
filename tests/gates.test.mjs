/** The gate suite: the production definition of a fair, intense, multi-solution
 * encounter. Uses synthetic encounters with controlled outcomes so these assertions
 * do not move when live content is retuned. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_GATES, GATES_VERSION, GATE_IDS, QUICK_GATES, TIER_MARGIN_P33,
  TIER_PUNISHING_ACTIONS, assessEncounter, heroesWithDeadKits, tierFor} from '../dist/src/gates.js';
import {buildEncounter, bossIds} from '../dist/src/generate.js';
import {bossProfiles} from '../dist/src/encounters.js';
import {balancedParties} from '../dist/src/draft.js';


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
  // Nothing may be asserted about a fight nobody can win -- except the cheap gates that
  // need no search and therefore still have a real answer.
  const searchGates = GATE_IDS.filter(id => id !== 'no_dead_kit');
  assert.deepEqual([...assessment.failedGates].sort(), [...searchGates].sort());
  for (const id of searchGates.filter(g => g !== 'winnable')) {
    assert.match(assessment.gates[id].detail, /no verified win/);
  }
  assert.ok(assessment.gates.no_dead_kit, 'the search-free gate still reports');
  assert.doesNotMatch(assessment.gates.no_dead_kit.detail, /no verified win/);
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

test('G7 catches a hero whose signature offence the boss nullifies', () => {
  // Storm Keeper is fire-immune; the Channeler's only offensive spells are fire. The
  // fight stays winnable through the other two heroes, so the search gates pass, but
  // one of three heroes cannot hurt the boss at all.
  const dead = heroesWithDeadKits(buildEncounter('storm_keeper', ['blademage', 'channeler', 'lancer']));
  assert.deepEqual(dead, ['channeler']);

  const clean = heroesWithDeadKits(buildEncounter('tide_maw', ['blademage', 'channeler', 'lancer']));
  assert.deepEqual(clean, [], 'no immunity, no dead kit');
});

test('G7 ignores the universal Attack, which every hero has', () => {
  // If Attack counted, no hero would ever register as nullified and the gate would be
  // inert. Build a boss immune to everything the party's signatures use.
  const def = buildEncounter('storm_keeper', ['blademage', 'channeler', 'lancer']);
  const attack = Object.values(def.abilities).find(a => a.id === 'attack');
  assert.equal(attack.owner, 'any_hero', 'Attack is universal');
  assert.ok(heroesWithDeadKits(def).includes('channeler'),
    'the gate must look past Attack to the hero own kit');
});

test('G7 is reported as a gate and blocks a combination', () => {
  const def = buildEncounter('storm_keeper', ['blademage', 'channeler', 'lancer']);
  const assessment = assessEncounter(def, {...FAST, forcedAbilityProbes: 0});
  assert.equal(assessment.gates.no_dead_kit.ok, false);
  assert.match(assessment.gates.no_dead_kit.detail, /channeler/);
  assert.ok(assessment.failedGates.includes('no_dead_kit'));
  assert.equal(assessment.passed, false, 'a dead kit must keep the combination out of the pool');
});

test('G7 is evaluated even when there is no verified win', () => {
  // The cheap gates should still report a real verdict rather than being masked.
  const unbeatable = JSON.parse(JSON.stringify(bossProfiles.find(b => b.id === 'storm_keeper')));
  unbeatable.stats.hp = 500_000;
  const assessment = assessEncounter(
    buildEncounter(unbeatable, ['blademage', 'channeler', 'lancer']), FAST);
  assert.equal(assessment.gates.winnable.ok, false);
  assert.equal(assessment.gates.no_dead_kit.ok, false, 'G7 has its own answer');
  assert.match(assessment.gates.no_dead_kit.detail, /channeler/);
  assert.ok(assessment.failedGates.includes('no_dead_kit'),
    'a dead kit is reported even when the fight is unwinnable');
});

test('the gate suite declares its own identity for cache invalidation', () => {
  // The pool cache keys on these: a new gate or changed logic must invalidate it.
  assert.ok(Number.isInteger(GATES_VERSION) && GATES_VERSION >= 1);
  assert.equal(new Set(GATE_IDS).size, GATE_IDS.length, 'no duplicate gate ids');
  const assessment = assessEncounter(buildEncounter(bossIds[0], party), FAST);
  assert.deepEqual([...Object.keys(assessment.gates)].sort(), [...GATE_IDS].sort(),
    'GATE_IDS must match what an assessment actually reports');
});
