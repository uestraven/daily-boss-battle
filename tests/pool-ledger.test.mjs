/** The verified pool driving the daily ledger.
 *
 * This is the product loop: one attempt per UTC day, resumable mid-battle, locked once
 * finished, and provable by replay. It reuses the curated path's integrity model rather
 * than growing a second one, so these tests assert the generalisation actually holds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dailyStatistics, emptyLedger, ensureDay, normalizeLedger, playDailyAction,
  stepForDay} from '../dist/src/daily.js';
import {poolCatalog, selectDaily, validatePool} from '../dist/src/pool.js';
import {starsForResult} from '../dist/src/engine.js';

const pool = validatePool(JSON.parse(
  readFileSync(new URL('../dist-content/verified-pool.json', import.meta.url), 'utf8')));
const catalog = poolCatalog(pool);
const DAY = '2026-10-17';
const clone = v => structuredClone(v);

/** Plays a day to completion with a simple policy, through the ledger. */
function playOut(day = DAY, limit = 120) {
  let ledger = ensureDay(emptyLedger(), day, catalog);
  let step = stepForDay(ledger, day, catalog);
  for (let n = 0; n < limit && !step.terminal; n++) {
    const actorId = step.readyHeroIds[0];
    const played = playDailyAction(ledger, day,
      {actorId, abilityId: 'attack', targetIds: [step.state.bossId]}, catalog);
    ledger = played.ledger;
    step = played.step;
  }
  return {ledger, step};
}

test('the pool catalog resolves a distinct, verified encounter per day', () => {
  for (let i = 0; i < 14; i++) {
    const day = new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10);
    const def = catalog.definitionFor(day);
    const entry = selectDaily(day, pool);
    assert.equal(def.id, `daily-${day}-${entry.bossId}`);
    assert.equal(catalog.keyFor(day), entry.id, 'the ledger key identifies the combination');
    assert.ok(def.contentVersion.includes(pool.contentHash));
  }
  assert.ok(catalog.version.includes(pool.contentHash), 'catalog version pins the content');
});

test('a day starts at a real decision and is not yet complete', () => {
  const ledger = ensureDay(emptyLedger(), DAY, catalog);
  const record = ledger.records[DAY];
  assert.equal(record.completed, false);
  assert.equal(record.result, null);
  assert.equal(record.stars, null);
  assert.deepEqual(record.inputs, []);
  assert.ok(stepForDay(ledger, DAY, catalog).readyHeroIds.length > 0);
});

test('ensureDay is idempotent and never restarts a day', () => {
  const first = ensureDay(emptyLedger(), DAY, catalog);
  assert.equal(ensureDay(first, DAY, catalog), first, 'same object when already present');
  const played = playDailyAction(first, DAY,
    {actorId: stepForDay(first, DAY, catalog).readyHeroIds[0], abilityId: 'attack',
      targetIds: [catalog.definitionFor(DAY).bossId]}, catalog).ledger;
  const after = ensureDay(played, DAY, catalog);
  assert.equal(after.records[DAY].inputs.length, 1, 'progress is not wiped');
});

test('an in-progress day resumes at exactly the same decision', () => {
  let ledger = ensureDay(emptyLedger(), DAY, catalog);
  const def = catalog.definitionFor(DAY);
  for (let n = 0; n < 3; n++) {
    const step = stepForDay(ledger, DAY, catalog);
    ledger = playDailyAction(ledger, DAY,
      {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [def.bossId]}, catalog).ledger;
  }
  const live = stepForDay(ledger, DAY, catalog);
  // Round-trip through storage, exactly as the browser does.
  const restored = normalizeLedger(JSON.parse(JSON.stringify(ledger)), catalog);
  assert.ok(restored.records[DAY], 'the record survives normalisation');
  assert.equal(restored.records[DAY].inputs.length, 3);
  const resumed = stepForDay(restored, DAY, catalog);
  assert.deepEqual(resumed.state, live.state, 'resumed state is identical');
  assert.deepEqual(resumed.readyHeroIds, live.readyHeroIds);
});

test('a finished day is locked against further play', () => {
  const {ledger, step} = playOut();
  assert.ok(step.terminal, 'the policy reached a result');
  const record = ledger.records[DAY];
  assert.equal(record.completed, true);
  assert.equal(record.result, step.terminal);
  assert.equal(record.stars, starsForResult(step.state));
  assert.throws(() => playDailyAction(ledger, DAY,
    {actorId: record.state.party[0], abilityId: 'attack', targetIds: [record.state.bossId]}, catalog),
    /locked/);
});

test('a finished day survives a storage round-trip with its result intact', () => {
  const {ledger} = playOut();
  const restored = normalizeLedger(JSON.parse(JSON.stringify(ledger)), catalog);
  assert.ok(restored.records[DAY], 'an honest finished record is accepted');
  assert.equal(restored.records[DAY].result, ledger.records[DAY].result);
  assert.equal(restored.records[DAY].stars, ledger.records[DAY].stars);
  assert.deepEqual(restored.records[DAY].state, ledger.records[DAY].state);
});

test('a forged pool-backed result is rejected', () => {
  const {ledger} = playOut();
  const real = ledger.records[DAY];

  // Claim a win with no supporting actions.
  const empty = clone(real);
  empty.inputs = [];
  empty.result = 'victory';
  empty.completed = true;
  empty.stars = 3;
  assert.equal(normalizeLedger({schema: 1, records: {[DAY]: empty}}, catalog).records[DAY], undefined);

  // Inflate the star count on an honest log.
  const inflated = clone(real);
  inflated.stars = (real.stars ?? 0) === 3 ? 2 : 3;
  assert.equal(normalizeLedger({schema: 1, records: {[DAY]: inflated}}, catalog).records[DAY], undefined);

  // Flip the result.
  const flipped = clone(real);
  flipped.result = real.result === 'victory' ? 'defeat' : 'victory';
  assert.equal(normalizeLedger({schema: 1, records: {[DAY]: flipped}}, catalog).records[DAY], undefined);
});

test('a record from a different catalog version is dropped', () => {
  // A pool rebuild changes the content hash, so yesterday's records must not be trusted
  // as results for encounters that no longer exist.
  const {ledger} = playOut();
  const stale = clone(ledger.records[DAY]);
  stale.catalogVersion = '1.0-pool|stale-hash';
  assert.equal(normalizeLedger({schema: 1, records: {[DAY]: stale}}, catalog).records[DAY], undefined);
});

test('the curated and pool catalogs do not accept each other records', () => {
  const {ledger} = playOut();
  // Default catalog is the curated six; a pool record must not validate against it.
  assert.equal(normalizeLedger(JSON.parse(JSON.stringify(ledger))).records[DAY], undefined,
    'pool record rejected by the curated catalog');
});

test('statistics accumulate across pool-backed days', () => {
  let ledger = emptyLedger();
  const days = [];
  for (let i = 0; i < 3; i++) {
    const day = new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10);
    days.push(day);
    const played = playOut(day);
    ledger = {schema: 1, records: {...ledger.records, ...played.ledger.records}};
  }
  const stats = dailyStatistics(ledger, days[days.length - 1]);
  assert.equal(stats.completed, 3, 'all three days counted');
  assert.equal(stats.wins + stats.losses, 3);
  assert.equal(stats.participationStreak, 3, 'consecutive days form a streak');
  assert.ok(stats.stars >= 0);
});

test('a day the pool cannot serve fails loudly rather than silently', () => {
  const emptyPool = {schemaVersion: 1, contentHash: 'x', entries: []};
  const broken = {
    version: 'x',
    keyFor: day => { throw new Error(`no encounter for ${day}`); },
    definitionFor: day => { throw new Error(`no encounter for ${day}`); },
  };
  assert.throws(() => ensureDay(emptyLedger(), DAY, broken), /no encounter/);
  // And normalisation treats it as an untrustworthy record rather than crashing.
  assert.deepEqual(normalizeLedger({schema: 1, records: {[DAY]: {day: DAY}}}, broken), emptyLedger());
  assert.equal(emptyPool.entries.length, 0);
});
