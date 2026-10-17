/** Party drafting: the pre-filter that keeps the offline verifier from wasting
 * cycles on teams that cannot function. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedParties, draftParty, heroCapabilities, inspectParty, isBalancedParty} from '../dist/src/draft.js';
import {heroes} from '../dist/src/roster.js';
import {bossProfiles} from '../dist/src/encounters.js';

test('capabilities are derived for every hero and none is capability-less', () => {
  assert.equal(Object.keys(heroCapabilities).length, heroes.length);
  for (const h of heroes) {
    assert.ok(Array.isArray(heroCapabilities[h.id]), h.id);
    assert.ok(heroCapabilities[h.id].length > 0, `${h.id} has no derived capability`);
    assert.deepEqual(heroCapabilities[h.id], [...heroCapabilities[h.id]].sort(), 'stable order');
  }
});

test('every hand-curated party from the shipped encounters is considered viable', () => {
  for (const p of bossProfiles) {
    const result = inspectParty(p.party);
    assert.ok(result.ok, `${p.id}: ${result.reasons.join('; ')}`);
  }
  const reference = inspectParty(['warden', 'brawler', 'magus']);
  assert.ok(reference.ok, reference.reasons.join('; '));
});

test('malformed parties are rejected with specific reasons', () => {
  assert.deepEqual(inspectParty(['warden', 'magus']).reasons, ['party must be exactly three heroes']);
  assert.ok(inspectParty(['warden', 'warden', 'magus']).reasons.includes('party must not repeat a hero'));
  assert.ok(inspectParty(['warden', 'magus', 'nobody']).reasons.some(r => r.includes('unknown hero')));
});

test('a party with no healing is rejected', () => {
  const party = ['lancer', 'vanguard', 'brawler'];
  assert.ok(party.every(id => !heroCapabilities[id].includes('sustain')));
  assert.ok(inspectParty(party).reasons.includes('no sustain: party cannot heal'));
});

test('a party with no answer to heavy armour is rejected', () => {
  const result = inspectParty(['warden', 'lancer', 'vanguard']);
  assert.ok(!result.ok);
  assert.ok(result.reasons.includes('no answer to high physical defense'));
});

test('an all-one-role party is rejected even when otherwise capable', () => {
  const strikers = heroes.filter(h => h.role === 'Striker').map(h => h.id);
  assert.ok(strikers.length >= 3);
  const party = [strikers[0], strikers[1], strikers[2]];
  const reasons = inspectParty(party).reasons;
  assert.ok(reasons.some(r => r.includes('share the Striker role')), reasons.join('; '));
});

test('the viable pool is a strict, non-trivial subset of all combinations', () => {
  const pool = balancedParties();
  const n = heroes.length;
  const total = (n * (n - 1) * (n - 2)) / 6;
  assert.ok(pool.length > 0);
  assert.ok(pool.length < total, 'the filter must actually reject something');
  assert.ok(pool.length > total * 0.25, 'the filter must not be so strict that variety dies');
  for (const party of pool) {
    assert.equal(party.length, 3);
    assert.deepEqual(party, [...party].sort(), 'parties are stored in stable order');
    assert.ok(isBalancedParty(party));
  }
  assert.equal(new Set(pool.map(p => p.join(','))).size, pool.length, 'no duplicate parties');
});

test('the pool order is stable across calls so seeded draws are reproducible', () => {
  assert.deepEqual(balancedParties(), balancedParties());
});

test('drafting is deterministic per seed and always yields a viable party', () => {
  for (const seed of ['2026-10-16', '2026-10-17', 'arbitrary-seed', '']) {
    const first = draftParty(seed);
    assert.deepEqual(draftParty(seed), first, `seed ${seed} is not reproducible`);
    assert.ok(isBalancedParty(first), `seed ${seed} drafted an unviable party`);
  }
});

test('drafting spreads across the pool rather than collapsing onto one team', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(draftParty(`day-${i}`).join(','));
  assert.ok(seen.size > 20, `only ${seen.size} distinct parties across 200 seeds`);
});

test('a roster too small or too narrow to form a viable party fails loudly', () => {
  assert.throws(() => draftParty('x', ['lancer', 'vanguard']), /No viable party/);
  assert.throws(() => draftParty('x', ['lancer', 'vanguard', 'brawler']), /No viable party/);
});
