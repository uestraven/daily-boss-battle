/** Tests for the battle-configuration query parameters.
 *
 * The point of these is that a typo must be *reported*, not ignored. A silently dropped
 * parameter means the screen plays a perfectly valid battle that is not the one asked for,
 * and there is nothing on screen to reveal the mistake.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOpeningState, isPresentationOnly, parseBattleParams, wantsCustomEncounter}
  from '../dist/src/battle-params.js';
import {buildEncounter} from '../dist/src/generate.js';
import {advanceToDecision, createEncounter} from '../dist/src/engine.js';

test('no parameters means the normal daily path', () => {
  for (const search of ['', '?', '?dev', '?speed=2&studio']) {
    const {sandbox, errors} = parseBattleParams(search);
    assert.equal(sandbox, null, `${search} should not request a sandbox`);
    assert.deepEqual(errors, []);
  }
});

test('a boss and party name a custom encounter', () => {
  const {sandbox, errors} = parseBattleParams('?boss=storm_keeper&party=machinist,warden,monk');
  assert.deepEqual(errors, []);
  assert.equal(sandbox.bossId, 'storm_keeper');
  assert.deepEqual(sandbox.party, ['machinist', 'warden', 'monk']);
  assert.ok(wantsCustomEncounter(sandbox));
});

test('a parsed boss and party actually build an encounter', () => {
  // The parser deliberately does not know the roster, so this is the check that what it
  // produces is accepted by the thing that does.
  const {sandbox} = parseBattleParams('?boss=clockwork_emperor&party=vanguard,nullifier,magus');
  const def = buildEncounter(sandbox.bossId, sandbox.party, {id: 'test', contentVersion: 'test'});
  assert.equal(def.bossId, 'clockwork_emperor');
  assert.deepEqual([...def.actors[def.bossId] ? Object.keys(def.actors) : []].sort(),
    ['clockwork_emperor', 'magus', 'nullifier', 'vanguard']);
});

test('whitespace and a trailing comma in a party are tolerated', () => {
  const {sandbox, errors} = parseBattleParams('?boss=tide_maw&party=monk, warden , oracle,');
  assert.deepEqual(errors, []);
  assert.deepEqual(sandbox.party, ['monk', 'warden', 'oracle']);
});

test('a party that is not three heroes is an error naming the parameter', () => {
  const short = parseBattleParams('?boss=tide_maw&party=monk,warden');
  assert.equal(short.sandbox.party, undefined);
  assert.match(short.errors[0], /lists 2 heroes/);

  const repeated = parseBattleParams('?boss=tide_maw&party=monk,monk,warden');
  assert.match(repeated.errors[0], /repeats a hero/);
});

test('half a request is an error rather than a guess at the other half', () => {
  // Filling in the missing half from today's encounter would produce a fight nobody asked
  // for, which is exactly the silent-substitution failure these errors exist to prevent.
  assert.match(parseBattleParams('?boss=tide_maw').errors.join(), /needs party=/);
  assert.match(parseBattleParams('?party=monk,warden,oracle').errors.join(), /needs boss=/);
});

test('a day must be a real calendar date', () => {
  assert.equal(parseBattleParams('?day=2026-12-25').sandbox.day, '2026-12-25');
  assert.match(parseBattleParams('?day=tomorrow').errors.join(), /not a YYYY-MM-DD date/);
  assert.match(parseBattleParams('?day=25-12-2026').errors.join(), /not a YYYY-MM-DD date/);
});

test('HP parameters are percentages, and nonsense is reported', () => {
  const ok = parseBattleParams('?bosshp=46&partyhp=25');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.sandbox.bossHpFraction, 0.46);
  assert.equal(ok.sandbox.partyHpFraction, 0.25);

  for (const bad of ['?bosshp=0', '?bosshp=101', '?bosshp=-5', '?bosshp=half']) {
    assert.match(parseBattleParams(bad).errors.join(), /percentage between 1 and 100/, bad);
  }
});

test('phase=2 poises the boss for the transition rather than skipping it', () => {
  assert.equal(parseBattleParams('?phase=2').sandbox.poisedForPhaseTwo, true);
  assert.equal(parseBattleParams('?phase=1').sandbox.poisedForPhaseTwo, false);
  assert.match(parseBattleParams('?phase=3').errors.join(), /not 1 or 2/);
});

test('mode is accepted only as easy or normal', () => {
  assert.equal(parseBattleParams('?mode=easy').sandbox.mode, 'easy');
  assert.equal(parseBattleParams('?mode=normal').sandbox.mode, 'normal');
  assert.match(parseBattleParams('?mode=hard').errors.join(), /not easy or normal/);
});

test('mode alone leaves the day rankable; anything else does not', () => {
  // A link that opens today's battle in Easy is still today's battle. If that were forced
  // unranked, a tester could never produce a real record through a link at all.
  assert.ok(isPresentationOnly(parseBattleParams('?mode=easy').sandbox));
  for (const search of ['?mode=easy&bosshp=50', '?mode=easy&day=2026-12-25',
    '?mode=easy&boss=tide_maw&party=monk,warden,oracle', '?phase=2', '?day=2026-12-25']) {
    assert.ok(!isPresentationOnly(parseBattleParams(search).sandbox),
      `${search} must not be treated as presentation-only`);
  }
});

test('phase=2 leaves the boss above its threshold, so a hit still triggers the change', () => {
  // The failure this guards is subtle and silent: parking the boss *below* the threshold
  // puts the fight in phase two without ever emitting phase_change, so the flash, the
  // hold and the music swap -- the entire reason to ask for phase two -- never happen.
  const {sandbox} = parseBattleParams('?phase=2');
  const def = buildEncounter('clockwork_emperor', ['vanguard', 'warden', 'monk'],
    {id: 'test', contentVersion: 'test'});
  const threshold = def.bossProgram.transitionPercent;
  const opening = advanceToDecision(createEncounter(def), def);
  const seeded = applyOpeningState(opening.state, sandbox, threshold);

  const boss = seeded.actors[def.bossId];
  const percent = (100 * boss.hp) / boss.stats.hp;
  assert.ok(percent > threshold,
    `boss at ${percent.toFixed(1)}% must be above the ${threshold}% threshold`);
  assert.ok(percent < threshold + 5, `boss at ${percent.toFixed(1)}% should be close to it`);
});

test('opening state is applied without mutating the state it was given', () => {
  const def = buildEncounter('tide_maw', ['monk', 'warden', 'oracle'],
    {id: 'test', contentVersion: 'test'});
  const opening = advanceToDecision(createEncounter(def), def);
  const bossBefore = opening.state.actors[def.bossId].hp;
  const heroBefore = opening.state.actors.monk.hp;

  const {sandbox} = parseBattleParams('?bosshp=46&partyhp=25');
  const seeded = applyOpeningState(opening.state, sandbox, def.bossProgram.transitionPercent);

  assert.equal(opening.state.actors[def.bossId].hp, bossBefore, 'original boss HP untouched');
  assert.equal(opening.state.actors.monk.hp, heroBefore, 'original hero HP untouched');
  assert.equal(seeded.actors[def.bossId].hp,
    Math.round(seeded.actors[def.bossId].stats.hp * 0.46));
  for (const id of seeded.party) {
    assert.equal(seeded.actors[id].hp, Math.round(seeded.actors[id].stats.hp * 0.25), id);
  }
});

test('seeded HP never reaches zero', () => {
  // A 0 HP actor is a KO the engine never emitted an event for, which leaves the state
  // internally inconsistent -- a down character the battle does not know is down.
  const def = buildEncounter('tide_maw', ['monk', 'warden', 'oracle'],
    {id: 'test', contentVersion: 'test'});
  const opening = advanceToDecision(createEncounter(def), def);
  const {sandbox} = parseBattleParams('?bosshp=1&partyhp=1');
  const seeded = applyOpeningState(opening.state, sandbox, def.bossProgram.transitionPercent);
  for (const id of [def.bossId, ...seeded.party]) {
    assert.ok(seeded.actors[id].hp >= 1, `${id} must have at least 1 HP`);
  }
});

test('a configured battle is playable through the engine', () => {
  // End to end: a query string becomes an encounter the engine will actually run, which is
  // the claim the screen depends on and cannot itself assert.
  const {sandbox, errors} = parseBattleParams('?boss=blade_tyrant&party=machinist,nullifier,vanguard&bosshp=30');
  assert.deepEqual(errors, []);
  const def = buildEncounter(sandbox.bossId, sandbox.party,
    {id: 'sandbox', contentVersion: 'sandbox'});
  let step = advanceToDecision(createEncounter(def), def);
  step = {...step, state: applyOpeningState(step.state, sandbox, def.bossProgram.transitionPercent)};
  assert.ok(step.state.actors[def.bossId].hp > 0);
  assert.ok(!step.state.result, 'the seeded battle has not already ended');
  assert.deepEqual([...step.state.party].sort(), ['machinist', 'nullifier', 'vanguard']);
});

test('an error is never silently dropped: a bad value still reports a sandbox request', () => {
  // The screen keys "show the error banner" off a non-null sandbox, so a request that is
  // entirely malformed must not look like the absence of a request.
  const {sandbox, errors} = parseBattleParams('?bosshp=nonsense');
  assert.notEqual(sandbox, null);
  assert.equal(errors.length, 1);
});
