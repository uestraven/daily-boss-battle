/** Encounter generation for arbitrary bosses and parties. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEncounter, bossIds, contentHash, encounterIdFor, encounterSeed} from '../dist/src/generate.js';
import {bossProfiles, practiceEncounters} from '../dist/src/encounters.js';
import {balancedParties} from '../dist/src/draft.js';
import {advanceToDecision, applyPlayerAction, createEncounter, replay} from '../dist/src/engine.js';

const pool = balancedParties();
const sample = [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];

test('an encounter can be generated for every boss and party combination sampled', () => {
  for (const bossId of bossIds) {
    for (const party of sample) {
      const def = buildEncounter(bossId, party);
      assert.equal(def.bossId, bossId);
      assert.deepEqual(def.party, party);
      assert.equal(Object.keys(def.actors).length, 4, 'three heroes plus the boss');
      for (const id of party) assert.ok(def.actors[id], `${id} missing from actors`);
      assert.ok(def.actors[bossId], 'boss missing from actors');
      assert.ok(def.bossProgram.fallbackAbility, 'generated encounters must declare a fallback');
      assert.equal(def.maxTicks, 2000);
    }
  }
});

test('every generated encounter reaches a first player decision', () => {
  for (const bossId of bossIds) {
    for (const party of sample) {
      const def = buildEncounter(bossId, party);
      const step = advanceToDecision(createEncounter(def), def);
      assert.ok(step.readyHeroIds.length > 0, `${bossId}/${party.join(',')} has no ready hero`);
      assert.ok(step.state.bossIntent, 'the boss must announce an intent');
    }
  }
});

test('generated encounters are playable and deterministic under replay', () => {
  const def = buildEncounter(bossIds[0], sample[0]);
  const inputs = [];
  let step = advanceToDecision(createEncounter(def), def);
  for (let n = 0; n < 12 && !step.terminal; n++) {
    const input = {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [def.bossId]};
    inputs.push(input);
    step = applyPlayerAction(step.state, input, def);
  }
  assert.deepEqual(replay(def, inputs).state, step.state);
});

test('generation is a pure function of boss and party', () => {
  const a = buildEncounter('tide_maw', sample[0]);
  const b = buildEncounter('tide_maw', sample[0]);
  assert.deepEqual(a, b);
});

test('each combination gets its own boss PRNG seed', () => {
  const seeds = new Set();
  for (const party of pool.slice(0, 30)) seeds.add(buildEncounter('tide_maw', party).bossAI.seed);
  assert.ok(seeds.size > 25, `expected near-unique seeds per party, got ${seeds.size} for 30 parties`);
  // Deterministic, and sensitive to party order as well as membership.
  assert.equal(encounterSeed(7, ['a', 'b', 'c']), encounterSeed(7, ['a', 'b', 'c']));
  assert.notEqual(encounterSeed(7, ['a', 'b', 'c']), encounterSeed(7, ['c', 'b', 'a']));
  assert.notEqual(encounterSeed(7, ['a', 'b', 'c']), encounterSeed(8, ['a', 'b', 'c']));
});

test('generated ids are stable and distinguish combinations', () => {
  assert.equal(encounterIdFor('tide_maw', ['a', 'b', 'c']), 'gen-tide_maw-a-b-c');
  const ids = new Set(pool.map(p => encounterIdFor('tide_maw', p)));
  assert.equal(ids.size, pool.length, 'ids must be unique per party');
});

test('invalid generation inputs are rejected loudly', () => {
  assert.throws(() => buildEncounter('no_such_boss', sample[0]), /Unknown boss/);
  assert.throws(() => buildEncounter(bossIds[0], ['warden', 'magus']), /exactly three heroes/);
  assert.throws(() => buildEncounter(bossIds[0], ['warden', 'warden', 'magus']), /must not repeat/);
  assert.throws(() => buildEncounter(bossIds[0], ['warden', 'magus', 'nobody']), /Unknown hero/);
});

test('boss reactive rules travel as data into generated encounters', () => {
  const wall = bossProfiles.find(b => b.id === 'crush_wall');
  assert.ok(wall.overrides?.length, 'crush_wall declares an override in its profile');
  const def = buildEncounter('crush_wall', sample[0]);
  assert.deepEqual(def.bossAI.overrides, wall.overrides);

  const lurker = bossProfiles.find(b => b.id === 'ink_lurker');
  assert.ok(lurker.counters?.length, 'ink_lurker declares a counter in its profile');
  assert.deepEqual(buildEncounter('ink_lurker', sample[0]).bossAI.counters, lurker.counters);
});

test('enrage is opt-in and overridable per generated encounter', () => {
  const party = sample[0];
  const plain = buildEncounter('tide_maw', party, {enrage: null});
  assert.equal(plain.enrage, undefined);
  const curve = {fromTick: 60, stepTicks: 20, percentPerStep: 20, maxPercent: 80};
  assert.deepEqual(buildEncounter('tide_maw', party, {enrage: curve}).enrage, curve);
});

test('generated encounters do not disturb the curated practice corpus', () => {
  for (const profile of bossProfiles) {
    const curated = practiceEncounters[profile.id];
    assert.equal(curated.id, `practice-${profile.id}-v09`);
    assert.equal(curated.bossAI.seed, profile.seed, 'curated seeds stay vetted and unmixed');
    const generated = buildEncounter(profile.id, [...profile.party].sort());
    assert.notEqual(generated.id, curated.id, 'generated content gets its own id');
  }
});

test('the content hash is stable and reflects content changes', () => {
  const before = contentHash();
  assert.equal(before, contentHash());
  assert.match(before, /^[0-9a-f]{8}-\d+$/);

  // Mutating a boss profile in memory must change the hash.
  const boss = bossProfiles.find(b => b.id === 'tide_maw');
  const original = boss.stats.hp;
  boss.stats.hp = original + 1;
  try {
    assert.notEqual(contentHash(), before, 'a stat change must change the content hash');
  } finally {
    boss.stats.hp = original;
  }
  assert.equal(contentHash(), before, 'restoring content restores the hash');
});
