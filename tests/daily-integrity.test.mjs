/** Daily result integrity: the action log is authoritative and the stored state is
 * a derived cache, so hand-editing a saved ledger cannot manufacture a result. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_DAILY_INPUTS, dailyDefinition, dailyKeyFor, emptyLedger, ensureDay,
  normalizeLedger, playDailyAction, stepForDay} from '../dist/src/daily.js';
import {starsForResult} from '../dist/src/engine.js';

const witnesses = JSON.parse(readFileSync(new URL('../fixtures/daily-witnesses-v10.json', import.meta.url), 'utf8'));
const DAY = '2026-10-16';
const clone = v => structuredClone(v);
const normalizeOne = record => normalizeLedger({schema: 1, records: {[DAY]: record}}).records[DAY];

function honestWin(day = DAY) {
  let ledger = ensureDay(emptyLedger(), day);
  for (const action of witnesses[dailyKeyFor(day)].actions) ledger = playDailyAction(ledger, day, action).ledger;
  return ledger;
}

test('a played-out win survives normalization and keeps its action log', () => {
  const record = honestWin().records[DAY];
  assert.equal(record.result, 'victory');
  assert.ok(record.inputs.length > 0);
  const accepted = normalizeOne(record);
  assert.ok(accepted, 'an honest record must be accepted');
  assert.equal(accepted.result, 'victory');
  assert.equal(accepted.stars, record.stars);
  assert.deepEqual(accepted.inputs, record.inputs);
});

test('a fabricated winning state with an empty action log is rejected', () => {
  const def = dailyDefinition(DAY);
  const forged = clone(ensureDay(emptyLedger(), DAY).records[DAY]);
  forged.state.actors[def.bossId].hp = 0;
  forged.state.result = 'victory';
  forged.state.itemUses = 0;
  for (const id of forged.state.party) forged.state.actors[id].hp = forged.state.actors[id].stats.hp;
  forged.result = 'victory';
  forged.completed = true;
  forged.stars = starsForResult(forged.state);
  assert.equal(forged.stars, 3, 'the forgery really does claim three stars');
  assert.equal(normalizeOne(forged), undefined, 'a result with no supporting action log must be rejected');
});

test('an inflated star count on an otherwise honest log is rejected', () => {
  const record = clone(honestWin().records[DAY]);
  record.stars = record.stars === 3 ? 2 : 3;
  assert.equal(normalizeOne(record), undefined);
});

test('a flipped result on an otherwise honest log is rejected', () => {
  const record = clone(honestWin().records[DAY]);
  record.result = 'defeat';
  assert.equal(normalizeOne(record), undefined);
});

test('claiming completion of an in-progress battle is rejected', () => {
  let ledger = ensureDay(emptyLedger(), DAY);
  ledger = playDailyAction(ledger, DAY, witnesses[dailyKeyFor(DAY)].actions[0]).ledger;
  const record = clone(ledger.records[DAY]);
  record.completed = true;
  record.result = 'victory';
  record.stars = 3;
  assert.equal(normalizeOne(record), undefined);
});

test('a corrupted state field is ignored because state is recomputed from the log', () => {
  const honest = honestWin().records[DAY];
  const corrupted = clone(honest);
  const victim = corrupted.state.party[0];
  corrupted.state.actors[victim].hp = 1;
  corrupted.state.tick = 9999;
  const accepted = normalizeOne(corrupted);
  assert.ok(accepted, 'the record is still valid: only the derived cache was touched');
  assert.equal(accepted.state.actors[victim].hp, honest.state.actors[victim].hp, 'hp recomputed from the log');
  assert.equal(accepted.state.tick, honest.state.tick, 'tick recomputed from the log');
  assert.deepEqual(accepted.state, honest.state);
});

test('an illegal action in the log is rejected rather than partially applied', () => {
  const record = clone(ensureDay(emptyLedger(), DAY).records[DAY]);
  record.inputs = [{actorId: 'warden', abilityId: 'not_a_real_ability', targetIds: []}];
  assert.equal(normalizeOne(record), undefined);
});

test('an action log longer than the replay bound is rejected', () => {
  const record = clone(ensureDay(emptyLedger(), DAY).records[DAY]);
  record.inputs = Array.from({length: MAX_DAILY_INPUTS + 1},
    () => ({actorId: 'warden', abilityId: 'attack', targetIds: ['blade_tyrant']}));
  assert.equal(normalizeOne(record), undefined);
});

test('a non-array action log is rejected', () => {
  for (const bad of [undefined, null, 'attack', 42, {}]) {
    const record = clone(ensureDay(emptyLedger(), DAY).records[DAY]);
    record.inputs = bad;
    assert.equal(normalizeOne(record), undefined, `inputs=${JSON.stringify(bad)}`);
  }
});

test('a log replayed against the wrong day is rejected', () => {
  const other = '2026-10-18';
  assert.notEqual(dailyKeyFor(DAY), dailyKeyFor(other), 'the two days must use different encounters');
  const record = clone(honestWin().records[DAY]);
  // Re-label the record as another day; its log belongs to a different encounter.
  record.day = other;
  record.key = dailyKeyFor(other);
  record.definitionId = dailyDefinition(other).id;
  assert.equal(normalizeLedger({schema: 1, records: {[other]: record}}).records[other], undefined);
});

test('an in-progress battle round-trips and resumes at the same decision', () => {
  let ledger = ensureDay(emptyLedger(), DAY);
  const actions = witnesses[dailyKeyFor(DAY)].actions;
  const output = playDailyAction(ledger, DAY, actions[0]);
  const restored = normalizeLedger(JSON.parse(JSON.stringify(output.ledger)));
  assert.equal(restored.records[DAY].inputs.length, 1);
  assert.deepEqual(stepForDay(restored, DAY).state, output.step.state);
});
