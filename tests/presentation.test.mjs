/** Battle choreography. The pacing is the product's feel, so it is asserted rather
 * than eyeballed: ordering, no-overlap-where-it-matters, tween endpoints, and the
 * dramatic stop on a phase change. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PACE, TIMING, beatsAt, choreograph, tweenValue} from '../dist/src/presentation.js';
import {advanceToDecision, applyPlayerAction, createEncounter} from '../dist/src/engine.js';
import {buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';

const ev = (type, extra = {}) => ({tick: 1, type, ...extra});
const kinds = script => script.beats.map(b => b.kind);

test('an empty event batch produces an empty script', () => {
  const script = choreograph([]);
  assert.deepEqual(script.beats, []);
  assert.equal(script.totalMs, 0);
});

test('a single hit expands into step, impact, number, bar drain and shake', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'tide_maw', amount: 120, hpAfter: 880}),
  ], {maxHp: {tide_maw: 1000}});

  for (const kind of ['strike', 'impact', 'damage_number', 'hp_change', 'shake']) {
    assert.ok(kinds(script).includes(kind), `missing ${kind}`);
  }
  // The step must precede the impact, and the impact must precede the number.
  const at = kind => script.beats.find(b => b.kind === kind).at;
  assert.ok(at('strike') < at('impact'), 'actor steps before it connects');
  assert.ok(at('impact') <= at('damage_number'), 'number appears on or after impact');
  assert.ok(at('impact') <= at('hp_change'), 'bar drains on or after impact');
});

test('a health bar tween carries both endpoints and eases to its target', () => {
  const script = choreograph([
    ev('damage', {actorId: 'boss', targetId: 'monk', amount: 60, hpAfter: 300}),
  ], {maxHp: {monk: 360}});
  const tween = script.beats.find(b => b.kind === 'hp_change');
  assert.equal(tween.from, 360, 'derives the pre-hit value');
  assert.equal(tween.to, 300);
  assert.equal(tweenValue(tween, tween.at), 360, 'starts at the old value');
  assert.equal(Math.round(tweenValue(tween, tween.at + tween.duration)), 300, 'ends at the new value');
  const mid = tweenValue(tween, tween.at + tween.duration / 2);
  assert.ok(mid < 360 && mid > 300, 'interpolates between the endpoints');
  // Eased, so more than half the distance is covered by the halfway point.
  assert.ok(mid < 330, 'decelerating ease, not linear');
});

test('shake intensity scales with the fraction of max HP removed', () => {
  const hit = (amount, maxHp) => choreograph(
    [ev('damage', {actorId: 'boss', targetId: 'monk', amount, hpAfter: maxHp - amount})],
    {maxHp: {monk: maxHp}},
  ).beats.find(b => b.kind === 'shake');

  const small = hit(10, 1000);
  const large = hit(500, 1000);
  assert.ok(large.intensity > small.intensity, 'a bigger hit shakes harder');
  assert.ok(small.intensity > 0, 'even a small hit registers');
  for (const beat of [small, large]) {
    assert.ok(beat.intensity > 0 && beat.intensity <= 1, `intensity out of range: ${beat.intensity}`);
  }
  // Scaling is relative: the same absolute damage on a bigger pool shakes less.
  assert.ok(hit(100, 2000).intensity < hit(100, 200).intensity);
});

test('multi-hit damage is staggered rather than stacked on one instant', () => {
  const events = [ev('action_committed', {actorId: 'blademage', abilityId: 'volley'})];
  for (let i = 0; i < 4; i++) {
    events.push(ev('damage', {actorId: 'blademage', targetId: 'boss', amount: 40, hpAfter: 1000 - 40 * (i + 1)}));
  }
  const script = choreograph(events, {maxHp: {boss: 1000}});
  const impacts = script.beats.filter(b => b.kind === 'impact').map(b => b.at);
  assert.equal(impacts.length, 4);
  assert.equal(new Set(impacts).size, 4, 'each hit lands at its own moment');
  for (let i = 1; i < impacts.length; i++) {
    assert.equal(impacts[i] - impacts[i - 1], TIMING.multiHitStagger);
  }
});

test('a phase change is a full dramatic stop', () => {
  const script = choreograph([
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 100, hpAfter: 500}),
    ev('phase_change', {actorId: 'boss', details: 'Phase 2'}),
    ev('damage', {actorId: 'boss', targetId: 'monk', amount: 50, hpAfter: 310}),
  ], {maxHp: {boss: 1000, monk: 360}, names: {boss: 'Tide Maw'}});

  const phase = script.beats.find(b => b.kind === 'phase');
  assert.ok(phase, 'a phase beat is emitted');
  assert.ok(phase.duration >= TIMING.phaseHold, 'the hold is long enough to land');
  assert.ok(script.beats.some(b => b.kind === 'flash' && b.intensity === 1), 'full flash on transition');

  // Nothing from after the transition may be scheduled during the hold.
  const holdEnd = phase.at + phase.duration;
  const after = script.beats.filter(b => b.at >= phase.at && b.kind === 'impact');
  for (const beat of after) {
    assert.ok(beat.at >= holdEnd, 'the next action waits for the hold to finish');
  }
});

test('separate actors in one batch are given breathing room', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 50, hpAfter: 950}),
    ev('action_committed', {actorId: 'boss', abilityId: 'tentacle'}),
    ev('damage', {actorId: 'boss', targetId: 'monk', amount: 70, hpAfter: 290}),
  ], {maxHp: {boss: 1000, monk: 360}});
  const steps = script.beats.filter(b => b.kind === 'strike');
  assert.equal(steps.length, 2);
  assert.ok(steps[1].at > steps[0].at + TIMING.strike, 'the second actor waits its turn');
});

test('beats are ordered by time, with a stable tiebreak', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 90, hpAfter: 910}),
    ev('phase_change', {actorId: 'boss'}),
    ev('ko', {actorId: 'monk'}),
  ], {maxHp: {boss: 1000}});
  for (let i = 1; i < script.beats.length; i++) {
    assert.ok(script.beats[i].at >= script.beats[i - 1].at, 'non-decreasing timeline');
  }
  // Identical input gives an identical script.
  const again = choreograph([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 90, hpAfter: 910}),
    ev('phase_change', {actorId: 'boss'}),
    ev('ko', {actorId: 'monk'}),
  ], {maxHp: {boss: 1000}});
  assert.deepEqual(script, again);
});

test('typed text is given enough time to read', () => {
  const short = choreograph([ev('boss_intent', {actorId: 'b', abilityId: 'x'})],
    {names: {b: 'Ox'}, abilityNames: {x: 'Hit'}});
  const long = choreograph([ev('boss_intent', {actorId: 'b', abilityId: 'x'})],
    {names: {b: 'The Extraordinarily Verbose Clockwork Emperor'},
      abilityNames: {x: 'Catastrophic Overwhelming Piston Barrage'}});
  const d = s => s.beats.find(b => b.kind === 'telegraph').duration;
  assert.ok(d(long) > d(short), 'longer text holds longer');
  assert.ok(d(short) >= TIMING.minMessage, 'short text still readable');
});

test('playback speed scales the whole timeline', () => {
  const events = [
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 80, hpAfter: 920}),
  ];
  const normal = choreograph(events, {maxHp: {boss: 1000}});
  const fast = choreograph(events, {maxHp: {boss: 1000}, speed: 2});
  assert.ok(fast.totalMs < normal.totalMs);
  assert.ok(Math.abs(fast.totalMs - normal.totalMs / 2) <= 2, 'halved within rounding');
  assert.equal(fast.beats.length, normal.beats.length, 'speed changes timing, not content');
});

test('silent mode drops log messages but keeps the action', () => {
  const events = [
    ev('cover_redirect', {actorId: 'warden', targetId: 'magus'}),
    ev('damage', {actorId: 'boss', targetId: 'warden', amount: 50, hpAfter: 350}),
  ];
  const loud = choreograph(events, {maxHp: {warden: 400}});
  const quiet = choreograph(events, {maxHp: {warden: 400}, silent: true});
  assert.ok(loud.beats.some(b => b.kind === 'message'));
  assert.ok(!quiet.beats.some(b => b.kind === 'message'));
  assert.ok(quiet.beats.some(b => b.kind === 'impact'), 'the hit is still shown');
});

test('bookkeeping events produce no presentation of their own', () => {
  const script = choreograph([
    ev('ready', {actorId: 'monk'}),
    ev('momentum', {actorId: 'brawler', amount: 1}),
    ev('boss_counter_queued', {actorId: 'boss', details: 'rule'}),
    ev('channel_resolved', {actorId: 'boss', abilityId: 'x'}),
  ]);
  assert.deepEqual(script.beats, [], 'no beats for internal bookkeeping');
});

test('beatsAt returns exactly the beats live at a moment', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 100, hpAfter: 900}),
  ], {maxHp: {boss: 1000}});
  assert.deepEqual(beatsAt(script, -1), []);
  assert.deepEqual(beatsAt(script, script.totalMs + 1), []);
  const step = script.beats.find(b => b.kind === 'strike');
  assert.ok(beatsAt(script, step.at).includes(step), 'inclusive at the start');
  assert.ok(!beatsAt(script, step.at + step.duration).includes(step), 'exclusive at the end');
});

test('a real engine batch choreographs into a sane, bounded timeline', () => {
  const def = buildEncounter('tide_maw', balancedParties()[0]);
  const names = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.name]));
  const maxHp = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.stats.hp]));
  const abilityNames = Object.fromEntries(Object.values(def.abilities).map(a => [a.id, a.name]));

  let step = advanceToDecision(createEncounter(def), def);
  let batches = 0;
  for (let n = 0; n < 8 && !step.terminal; n++) {
    const before = step.state.events.length;
    step = applyPlayerAction(step.state,
      {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [def.bossId]}, def);
    const script = choreograph(step.state.events.slice(before), {names, maxHp, abilityNames});
    batches++;
    assert.ok(script.beats.length > 0, 'a real action always has something to show');
    assert.ok(script.totalMs > 0);
    // A single exchange must not stall the game.
    assert.ok(script.totalMs < 9000, `batch ${n} would take ${script.totalMs}ms`);
    for (const beat of script.beats) {
      assert.ok(Number.isFinite(beat.at) && beat.at >= 0, 'beat has a real timestamp');
      assert.ok(Number.isFinite(beat.duration) && beat.duration >= 0);
      if (beat.kind === 'hp_change') {
        assert.ok(Number.isFinite(beat.from) && Number.isFinite(beat.to), 'tween has endpoints');
        assert.ok(beat.to >= 0, 'health never tweens below zero');
      }
    }
  }
  assert.ok(batches >= 4, 'exercised several real batches');
});

test('clip frame rates are slow enough to read', () => {
  // Measured against the placeholder animations: at 45ms per frame the attack read as a
  // flicker rather than a swing. These bounds keep a retune from going back there.
  const perFrame = (beatMs, frames) => beatMs / frames;
  assert.ok(perFrame(TIMING.strike, 5) >= 55,
    `a 5-frame attack is ${perFrame(TIMING.strike, 5).toFixed(0)}ms per frame; too fast to read`);
  assert.ok(perFrame(TIMING.strike, 4) >= 70,
    `a 4-frame attack is ${perFrame(TIMING.strike, 4).toFixed(0)}ms per frame`);
  assert.ok(perFrame(TIMING.hurtReact, 2) >= 90,
    `a 2-frame reaction is ${perFrame(TIMING.hurtReact, 2).toFixed(0)}ms per frame`);
  assert.ok(perFrame(TIMING.koCollapse, 4) >= 140,
    `a 4-frame collapse is ${perFrame(TIMING.koCollapse, 4).toFixed(0)}ms per frame`);
  // ...but not so slow that a turn drags.
  // Bounded against the pace dial rather than an absolute: the point is that the tuning
  // has not drifted, and the global pace is a deliberate, separate decision.
  assert.ok(TIMING.strike <= 500 * PACE,
    `an attack beat should not exceed ${500 * PACE}ms at PACE ${PACE}`);
  assert.ok(TIMING.hurtReact <= TIMING.damageNumberHold, 'the recoil should not outlast its number');
  assert.ok(TIMING.impact < TIMING.hurtReact, 'the flash is sharp; the reaction is not');
});

test('the hurt reaction is its own beat, outlasting the flash', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'boss', abilityId: 'tentacle'}),
    ev('damage', {actorId: 'boss', targetId: 'warden', amount: 60, hpAfter: 340}),
  ], {maxHp: {warden: 400}});
  const impact = script.beats.find(b => b.kind === 'impact');
  const hurt = script.beats.find(b => b.kind === 'hurt');
  assert.ok(hurt, 'a reaction beat is emitted');
  assert.equal(hurt.targetId, 'warden');
  assert.equal(hurt.at, impact.at, 'it starts with the hit');
  assert.ok(hurt.duration > impact.duration,
    'it lasts longer than the flash, which is the point of separating them');
  // And the batch is long enough to contain it.
  assert.ok(script.totalMs >= hurt.at + hurt.duration);
});
