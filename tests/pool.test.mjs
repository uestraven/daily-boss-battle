/** Verified-pool selection: a random daily that is still the same for everyone,
 * still winnable, and never repeats a boss within MIN_BOSS_GAP days. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_BOSS_GAP, TIER_CURVE, dailyBossFor, dailyEncounter, selectDaily,
  targetTierFor, validatePool} from '../dist/src/pool.js';
import {advanceToDecision, createEncounter} from '../dist/src/engine.js';
import {balancedParties} from '../dist/src/draft.js';
import {bossIds, contentHash} from '../dist/src/generate.js';

const DAY_MS = 86400000;
const dayAt = serial => new Date(serial * DAY_MS).toISOString().slice(0, 10);

/** A synthetic pool so these tests do not depend on live tuning or a built artifact. */
function makePool(bosses, {tier = 'standard', perBoss = 4} = {}) {
  const parties = balancedParties().slice(0, perBoss);
  const entries = [];
  for (const bossId of bosses) {
    for (const party of parties) {
      entries.push({
        id: `gen-${bossId}-${party.join('-')}`,
        bossId, party: [...party], passed: true, tier,
        difficulty: {bestStars: 3, bestActions: 20, bestTick: 90, distinctStrategies: 4, marginPercent: 45},
      });
    }
  }
  return {schemaVersion: 1, contentHash: 'test-hash', entries};
}

test('each boss appears once per cycle and never within the minimum gap', () => {
  for (const size of [6, 8, 12, 16]) {
    const bosses = Array.from({length: size}, (_, i) => `b${String(i + 1).padStart(2, '0')}`);
    const anchor = Math.floor(20000 / size) * size;
    const sequence = [];
    for (let i = 0; i < size * 20; i++) sequence.push(dailyBossFor(dayAt(anchor + i), bosses));

    for (let c = 0; c < 20; c++) {
      const cycle = sequence.slice(c * size, (c + 1) * size);
      assert.equal(new Set(cycle).size, size, `size ${size}, cycle ${c} repeats a boss`);
    }
    const lastSeen = new Map();
    let minGap = Infinity;
    for (const [i, boss] of sequence.entries()) {
      if (lastSeen.has(boss)) minGap = Math.min(minGap, i - lastSeen.get(boss));
      lastSeen.set(boss, i);
    }
    assert.ok(minGap >= MIN_BOSS_GAP, `size ${size}: min gap ${minGap} < ${MIN_BOSS_GAP}`);
  }
});

test('boss selection is deterministic and independent of input ordering', () => {
  const bosses = ['d', 'a', 'c', 'b', 'f', 'e'];
  const day = '2026-10-17';
  const first = dailyBossFor(day, bosses);
  assert.equal(dailyBossFor(day, bosses), first);
  assert.equal(dailyBossFor(day, [...bosses].reverse()), first);
});

test('boss selection rejects an empty roster and malformed dates', () => {
  assert.throws(() => dailyBossFor('2026-10-17', []), /No bosses/);
  for (const bad of ['2026-13-01', '2026-02-30', 'nonsense', '']) {
    assert.throws(() => dailyBossFor(bad, bossIds), /Expected YYYY-MM-DD|Invalid UTC date/);
  }
});

test('the difficulty curve covers every weekday and peaks on Saturday', () => {
  assert.equal(TIER_CURVE.length, 7);
  assert.equal(targetTierFor('2026-10-24'), 'punishing', 'Saturday');
  assert.equal(targetTierFor('2026-10-19'), 'approachable', 'Monday');
  for (let i = 0; i < 7; i++) {
    const tier = targetTierFor(dayAt(20000 + i));
    assert.ok(['approachable', 'standard', 'punishing'].includes(tier));
  }
});

test('daily selection is deterministic and returns a passing entry', () => {
  const pool = makePool(bossIds);
  for (let i = 0; i < 30; i++) {
    const day = dayAt(20000 + i);
    const entry = selectDaily(day, pool);
    assert.ok(entry, day);
    assert.ok(entry.passed);
    assert.deepEqual(selectDaily(day, pool), entry, 'selection must be reproducible');
    assert.equal(entry.bossId, dailyBossFor(day, bossIds), 'selection honours the rotation');
  }
});

test('selection prefers the target tier when the pool offers it', () => {
  const bosses = bossIds.slice(0, 6);
  const mixed = makePool(bosses, {tier: 'standard'});
  for (const entry of mixed.entries.filter((_, i) => i % 2 === 0)) entry.tier = 'punishing';
  for (let i = 0; i < 21; i++) {
    const day = dayAt(20000 + i);
    const target = targetTierFor(day);
    const entry = selectDaily(day, mixed);
    const available = mixed.entries.filter(e => e.bossId === entry.bossId && e.tier === target);
    if (available.length) assert.equal(entry.tier, target, `${day} ignored an available ${target} entry`);
  }
});

test('a pool with only off-tier entries still yields a verified daily', () => {
  const pool = makePool(bossIds, {tier: 'approachable'});
  const saturday = '2026-10-24';
  assert.equal(targetTierFor(saturday), 'punishing');
  const entry = selectDaily(saturday, pool);
  assert.ok(entry, 'must degrade to an available tier rather than no daily');
  assert.equal(entry.tier, 'approachable');
});

test('rejected entries are never selected', () => {
  const pool = makePool(bossIds);
  for (const entry of pool.entries) entry.passed = false;
  pool.entries[5].passed = true;
  for (let i = 0; i < 20; i++) {
    const entry = selectDaily(dayAt(20000 + i), pool);
    if (entry) assert.equal(entry.id, pool.entries[5].id);
  }
});

test('an empty pool yields no daily rather than an unverified one', () => {
  assert.equal(selectDaily('2026-10-17', {schemaVersion: 1, contentHash: 'x', entries: []}), null);
  assert.throws(() => dailyEncounter('2026-10-17', {schemaVersion: 1, contentHash: 'x', entries: []}),
    /no encounter available/);
});

test('a selected daily builds into a playable encounter', () => {
  const pool = makePool(bossIds);
  for (let i = 0; i < 10; i++) {
    const day = dayAt(20000 + i);
    const def = dailyEncounter(day, pool);
    assert.equal(def.id, `daily-${day}-${selectDaily(day, pool).bossId}`);
    assert.ok(def.contentVersion.includes(pool.contentHash));
    const step = advanceToDecision(createEncounter(def), def);
    assert.ok(step.readyHeroIds.length > 0);
  }
});

test('pool validation rejects malformed and stale artifacts', () => {
  const good = makePool(bossIds);
  assert.equal(validatePool(good).schemaVersion, 1);
  assert.equal(validatePool(good, 'test-hash').contentHash, 'test-hash');

  assert.throws(() => validatePool(null), /not an object/);
  assert.throws(() => validatePool({schemaVersion: 2, contentHash: 'x', entries: []}), /Unsupported pool schema/);
  assert.throws(() => validatePool({schemaVersion: 1, entries: []}), /missing a content hash/);
  assert.throws(() => validatePool({schemaVersion: 1, contentHash: 'x'}), /no entries array/);
  assert.throws(() => validatePool({schemaVersion: 1, contentHash: 'x', entries: [{id: 'a', bossId: 'b', party: ['x']}]}),
    /three-hero party/);
  assert.throws(() => validatePool({...good, entries: good.entries.map(e => ({...e, passed: false}))}),
    /no passing entries/);
  // Staleness is the gate that stops a pool outliving the content it was built from.
  assert.throws(() => validatePool(good, 'different-hash'), /stale/);
});

test('the live content hash is a usable staleness key', () => {
  const hash = contentHash();
  assert.throws(() => validatePool(makePool(bossIds), hash), /stale/);
  assert.equal(validatePool({...makePool(bossIds), contentHash: hash}, hash).contentHash, hash);
});
