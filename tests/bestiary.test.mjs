/** The bestiary: what the player has learned about each boss, across days.
 *
 * The property worth testing hardest is that it is a record of *experience* and not a
 * lookup table. A bestiary that listed every affinity would hand Normal mode exactly what
 * `disclosure.affinities` exists to withhold, for today's boss, mid-fight.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDiscovery, isDiscovered, normalizeBestiary, observeBattle, readAffinity}
  from '../dist/src/bestiary.js';
import {bossIds} from '../dist/src/generate.js';
import {readFileSync} from 'node:fs';

const ctx = (over = {}) => ({
  bossId: 'boss',
  elementOf: id => ({fire_spell: 'fire', ice_spell: 'ice', sword: undefined})[id],
  expectedFor: () => 100,
  ...over,
});

test('nothing is known before anything is seen', () => {
  const d = emptyDiscovery();
  assert.equal(isDiscovered(d), false);
  assert.deepEqual(d.affinities, {});
  assert.deepEqual(d.abilities, []);
  assert.equal(d.phaseTwoSeen, false);
});

test('an element is learned by using it, and only against this boss', () => {
  const after = observeBattle(emptyDiscovery(), [
    // Halved: a resistance, measured rather than looked up.
    {tick: 1, type: 'damage', targetId: 'boss', abilityId: 'fire_spell', amount: 50},
    // The same spell hitting a hero says nothing about the boss.
    {tick: 2, type: 'damage', targetId: 'hero', abilityId: 'ice_spell', amount: 50},
  ], ctx());
  assert.equal(after.affinities.fire, 'resist');
  assert.equal(after.affinities.ice, undefined, 'a hit on an ally taught us about the boss');
});

test('weak, resist, immune and neutral are all distinguished', () => {
  assert.equal(readAffinity(150, 100), 'weak');
  assert.equal(readAffinity(50, 100), 'resist');
  assert.equal(readAffinity(0, 100), 'immune');
  // Recorded rather than left blank: "you tried fire and nothing special happened" is
  // information, and an empty row would invite the player to keep testing it.
  assert.equal(readAffinity(98, 100), 'neutral');
  assert.equal(readAffinity(10, 0), null, 'with no baseline there is nothing to read');
});

test('a later reading corrects an earlier one', () => {
  // An ability can be resisted by one rule and amplified by another; the most recent
  // observation is the honest one.
  let d = observeBattle(emptyDiscovery(),
    [{tick: 1, type: 'damage', targetId: 'boss', abilityId: 'fire_spell', amount: 50}], ctx());
  assert.equal(d.affinities.fire, 'resist');
  d = observeBattle(d,
    [{tick: 2, type: 'damage', targetId: 'boss', abilityId: 'fire_spell', amount: 150}], ctx());
  assert.equal(d.affinities.fire, 'weak');
});

test('boss abilities are recorded once, including ones that never landed', () => {
  const after = observeBattle(emptyDiscovery(), [
    {tick: 1, type: 'action_committed', actorId: 'boss', abilityId: 'slash'},
    {tick: 2, type: 'action_committed', actorId: 'boss', abilityId: 'slash'},
    // A channel counts from its start: the player watched it wind up even if the fight
    // ended before it resolved.
    {tick: 3, type: 'channel_started', actorId: 'boss', abilityId: 'storm'},
    // A hero's own ability is not the boss's.
    {tick: 4, type: 'action_committed', actorId: 'hero', abilityId: 'cure'},
  ], ctx());
  assert.deepEqual(after.abilities, ['slash', 'storm']);
});

test('the second form is only known once it has been reached', () => {
  const before = observeBattle(emptyDiscovery(),
    [{tick: 1, type: 'damage', targetId: 'boss', abilityId: 'sword', amount: 10}], ctx());
  assert.equal(before.phaseTwoSeen, false);
  const after = observeBattle(before,
    [{tick: 2, type: 'phase_change', actorId: 'boss', details: 'Phase 2'}], ctx());
  assert.equal(after.phaseTwoSeen, true);
});

test('the fight is only counted when it ends', () => {
  const midFight = observeBattle(emptyDiscovery(), [], ctx());
  assert.equal(midFight.encounters, 0, 'a batch mid-battle must not count as an encounter');
  const won = observeBattle(emptyDiscovery(), [], ctx({result: 'victory'}));
  assert.equal(won.encounters, 1);
  assert.equal(won.victories, 1);
  const lost = observeBattle(won, [], ctx({result: 'defeat'}));
  assert.equal(lost.encounters, 2);
  assert.equal(lost.victories, 1);
});

test('a corrupt store cannot crash the Codex or invent progress', () => {
  const forged = {
    blade_tyrant: {encounters: 2, victories: 9, affinities: {fire: 'godlike'},
      abilities: ['real', 42, null], phaseTwoSeen: 'yes'},
    not_a_boss: {encounters: 99},
  };
  const clean = normalizeBestiary(forged, bossIds);
  assert.equal(clean.not_a_boss, undefined, 'an unknown boss id should be dropped');
  const bt = clean.blade_tyrant;
  // "9 wins from 2 fights" would print in the Codex.
  assert.equal(bt.victories, 2, 'victories cannot exceed encounters');
  assert.deepEqual(bt.affinities, {}, 'an invalid affinity reading should be dropped');
  assert.deepEqual(bt.abilities, ['real'], 'non-string ability ids should be dropped');
  assert.equal(bt.phaseTwoSeen, false, 'a truthy string is not true');
});

test('normalising junk yields an empty bestiary rather than throwing', () => {
  for (const junk of [null, undefined, 42, 'nope', []]) {
    assert.doesNotThrow(() => normalizeBestiary(junk, bossIds));
  }
});

test('the bestiary never reads the encounter definition', () => {
  // The guard that keeps this from becoming a disclosure leak. `observeBattle` is given
  // only callbacks and events; if it ever took the definition, it could list affinities the
  // player has not earned, which is what Normal mode exists to withhold.
  const source = readFileSync(new URL('../src/bestiary.ts', import.meta.url), 'utf8');
  assert.ok(!/EncounterDefinition/.test(source),
    'bestiary.ts imports the encounter definition, so it can now reveal unearned affinities');
  assert.ok(!/affinities\?\./.test(source), 'bestiary.ts reads def.affinities directly');
});
