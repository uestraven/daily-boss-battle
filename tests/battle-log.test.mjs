/** The battle log, which is two things at once: what a player reads back to understand a
 * turn, and -- because the stage is a `<canvas>` -- the entire accessible account of the
 * fight. It had covered ten of the engine's twenty-nine event types. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOGGED_EVENT_TYPES, SILENT_EVENT_TYPES, logLines} from '../dist/src/battle-log.js';

/** Every event type the engine can emit, read from the engine itself.
 *
 * Derived by reading the source because `BattleEvent.type` is a plain `string` and there is
 * no union to be exhaustive against. Crude, and still the only authoritative list there is
 * -- the same reasoning behind `pwa:check` grepping for the service worker registration. */
const engineEventTypes = () => {
  const src = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/event\((?:s|state|next),'([a-z_]+)'/g)) found.add(m[1]);
  return [...found].sort();
};

test('the engine still emits the event types this test can find', () => {
  // Guards the guard. If the `event(...)` call shape ever changes, the regex above would
  // quietly match nothing and every coverage assertion below would pass vacuously.
  const types = engineEventTypes();
  assert.ok(types.length > 20,
    `only found ${types.length} event types in engine.ts; the parser has probably stopped `
    + 'matching, which would make the coverage checks below meaningless');
  for (const expected of ['damage', 'heal', 'status_applied', 'ko', 'phase_change']) {
    assert.ok(types.includes(expected), `expected to find ${expected}`);
  }
});

test('every engine event type has a decision recorded in the log', () => {
  const known = new Set(LOGGED_EVENT_TYPES);
  const missing = engineEventTypes().filter(t => !known.has(t));
  assert.deepEqual(missing, [],
    `these event types reach the player with no decision about the log: ${missing.join(', ')}. `
    + 'Add a line for each in src/battle-log.ts, or map it to null with the reason it needs '
    + 'none.');
});

test('the log stays silent only on predictions and bookkeeping', () => {
  // The silent list is where an omission would hide, so it is asserted by name rather than
  // merely counted. A result must never end up here.
  assert.deepEqual([...SILENT_EVENT_TYPES].sort(),
    ['boss_counter_queued', 'boss_intent', 'boss_intent_changed', 'elemental_edge_consumed',
      'focus_consumed', 'momentum', 'ready']);
});

test('the log never carries the boss telegraph', () => {
  // The one thing it must not do. The log is ungated by disclosure, so a line about the
  // boss's *announced next action* would leak into Normal, which exists to withhold it.
  const lines = logLines([
    {tick: 1, type: 'boss_intent', actorId: 'boss', abilityId: 'cleave'},
    {tick: 1, type: 'boss_intent_changed', actorId: 'boss', abilityId: 'cleave'},
  ], {actors: {boss: 'Blade Tyrant'}, abilities: {cleave: 'Cleave'}});
  assert.deepEqual(lines, []);
});

test('the statuses that were missing now produce lines', () => {
  const names = {actors: {b: 'Blade Tyrant', m: 'Monk'}, abilities: {}};
  const lines = logLines([
    {tick: 1, type: 'status_applied', actorId: 'b', status: 'protect', details: 'protect; expires at 60'},
    {tick: 1, type: 'status_expired', actorId: 'b', status: 'protect', details: 'protect'},
    {tick: 1, type: 'status_removed', actorId: 'b', targetId: 'b', status: 'protect', details: 'protect'},
    {tick: 1, type: 'poison_pulse', actorId: 'm', amount: 15, hpAfter: 300},
    {tick: 1, type: 'phase_change', actorId: 'b', details: 'Phase 2'},
    {tick: 1, type: 'mp_restored', actorId: 'm', targetId: 'm', amount: 8},
    {tick: 1, type: 'cover_redirect', actorId: 'b', targetId: 'm'},
    {tick: 1, type: 'boss_fallback', actorId: 'b', details: 'Insufficient MP'},
  ], names);
  assert.equal(lines.length, 8, `expected a line each, got ${JSON.stringify(lines)}`);
  // The status name has to reach the page, or the line says a status happened without
  // saying which -- the exact failure the old log had.
  assert.ok(lines[0].includes('protect'), lines[0]);
  // And the engine's debug string must not: "protect; expires at 60" is not player copy.
  assert.ok(!lines.some(l => l.includes('expires at')), 'the details string reached the log');
});

test('an action names itself and its consequences are indented under it', () => {
  // What makes a multi-target ability legible: three damage lines under one named action,
  // rather than three attacks in a row.
  const lines = logLines([
    {tick: 1, type: 'action_committed', actorId: 'b', abilityId: 'sweep'},
    {tick: 1, type: 'damage', actorId: 'b', targetId: 'm', amount: 30, hpAfter: 100},
    {tick: 1, type: 'damage', actorId: 'b', targetId: 'w', amount: 28, hpAfter: 200},
  ], {actors: {b: 'Boss', m: 'Monk', w: 'Warden'}, abilities: {sweep: 'Flywheel Sweep'}});
  assert.equal(lines[0], 'Boss uses Flywheel Sweep');
  assert.ok(lines[1].startsWith('·') && lines[2].startsWith('·'),
    'consequences should be marked as belonging to the action above them');
});

test('a critical and a no-effect hit are distinguishable in text', () => {
  const names = {actors: {m: 'Monk'}, abilities: {}};
  const [crit] = logLines([{tick: 1, type: 'damage', targetId: 'm', amount: 80, critical: true}], names);
  const [zero] = logLines([{tick: 1, type: 'damage', targetId: 'm', amount: 0}], names);
  assert.ok(/CRITICAL/.test(crit), crit);
  assert.ok(/no effect/.test(zero), zero);
});

test('an unknown event type is skipped rather than throwing', () => {
  // A log is not worth taking a battle down for; the coverage test is what stops an
  // omission going unnoticed.
  assert.doesNotThrow(() => logLines([{tick: 1, type: 'something_new'}], {actors: {}, abilities: {}}));
});
