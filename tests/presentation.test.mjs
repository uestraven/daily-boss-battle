/** Battle choreography. The pacing is the product's feel, so it is asserted rather
 * than eyeballed: ordering, no-overlap-where-it-matters, tween endpoints, and the
 * dramatic stop on a phase change. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PACE, TIMING, beatsAt, choreograph, tweenValue} from '../dist/src/presentation.js';
import {advanceToDecision, applyPlayerAction, createEncounter} from '../dist/src/engine.js';
import {buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';
import {actionInput, availableActions} from '../dist/src/play-ui.js';

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
  // `channel_resolved` was in this list and has been deliberately removed: it is an actor
  // acting, so it now gets its own action phases. See the channelled-resolution test
  // below for why -- as bookkeeping it made the boss appear to strike simultaneously with
  // the hero who had just hit it.
  const script = choreograph([
    ev('ready', {actorId: 'monk'}),
    ev('momentum', {actorId: 'brawler', amount: 1}),
    ev('boss_counter_queued', {actorId: 'boss', details: 'rule'}),
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
  assert.ok(TIMING.strike <= 900 * PACE,
    `an attack beat should not exceed ${900 * PACE}ms at PACE ${PACE}`);
  // The strike is the only phase allowed to be long. If travel grows to match it the
  // action stops reading as a strike with approach and retreat around it, and starts
  // reading as three equally slow steps.
  assert.ok(TIMING.approach <= TIMING.strike && TIMING.retreat <= TIMING.strike,
    'travel should never outlast the strike it serves');
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

test('a resolved channel is choreographed as its own action, not the previous actor\'s', () => {
  // The bug this pins down: `channel_resolved` was treated as bookkeeping, and because
  // `strikeAt`/`indicatorAt` only advance on an actor action, the damage it carries
  // inherited the timings of whichever hero had just swung. A boss sweep landed at 750ms
  // and 830ms -- inside the hero's own strike -- every damage number in the batch stacked
  // at 1500ms, and the boss played no strike clip at all because no beat said it was
  // acting. On screen the boss appeared to counter simultaneously with being hit.
  const script = choreograph([
    ev('action_committed', {actorId: 'hero', abilityId: 'swing'}),
    ev('damage', {actorId: 'hero', targetId: 'boss', amount: 60, hpAfter: 940}),
    ev('channel_resolved', {actorId: 'boss', abilityId: 'sweep'}),
    ev('damage', {actorId: 'boss', targetId: 'hero', amount: 90, hpAfter: 210}),
  ]);

  const strikes = script.beats.filter(b => b.kind === 'strike');
  assert.deepEqual(strikes.map(b => b.actorId), ['hero', 'boss'],
    'the resolution gets a strike phase of its own, so the actor animates');

  const heroStrike = strikes[0];
  const bossStrike = strikes[1];
  assert.ok(bossStrike.at >= heroStrike.at + heroStrike.duration + TIMING.betweenActors,
    `the boss strike at ${bossStrike.at}ms must follow the hero's, which ends at `
    + `${heroStrike.at + heroStrike.duration}ms, with a gap`);

  // Each hit lands inside its own actor's strike, which is the invariant that was broken.
  for (const impact of script.beats.filter(b => b.kind === 'impact')) {
    const owner = strikes.find(s => s.actorId === impact.actorId);
    assert.ok(owner && impact.at >= owner.at && impact.at < owner.at + owner.duration,
      `${impact.actorId}'s impact at ${impact.at}ms must sit inside its own strike`);
  }

  // And the two sides' numbers are readable as separate events rather than stacked.
  const numbers = script.beats.filter(b => b.kind === 'damage_number');
  assert.equal(numbers.length, 2);
  assert.notEqual(numbers[0].at, numbers[1].at, 'the damage numbers must not coincide');
});

test('across real encounters, every hit lands inside its own actor\'s strike', () => {
  // The general form of the above, played through the engine rather than hand-built, so a
  // future event type that carries damage without being recognised as an action is caught
  // wherever it appears. Scanning turn by turn is what found `channel_resolved`.
  const bosses = ['crush_wall', 'blade_tyrant', 'ink_lurker', 'mad_harlequin', 'spell_weaver'];
  let checked = 0;
  for (const bossId of bosses) {
    const def = buildEncounter(bossId, ['machinist', 'warden', 'monk'],
      {id: 'timing', contentVersion: 'timing'});
    let step = advanceToDecision(createEncounter(def), def);
    for (let turn = 0; turn < 40 && !step.state.result; turn++) {
      const before = step.state.events.length;
      const actorId = step.readyHeroIds[0];
      if (!actorId) break;
      // Chosen through the same helpers the screen uses, so the action is always one the
      // actor can actually take. Hand-built inputs broke out of the loop after five hits
      // and the scan proved almost nothing.
      const offered = availableActions(step.state, def, actorId);
      const choice = offered.find(o => o.ability.kind === 'physical') ?? offered[0];
      if (!choice) break;
      try {
        step = applyPlayerAction(step.state,
          actionInput(step.state, actorId, choice.ability, def.bossId), def);
      } catch { break; }
      const script = choreograph(step.state.events.slice(before), {});
      const strikes = script.beats.filter(b => b.kind === 'strike');
      for (const impact of script.beats.filter(b => b.kind === 'impact' && b.actorId)) {
        // *Any* strike of that actor's, not its first: an actor legitimately acts twice in
        // one batch -- the boss commits a channel, then its resolution lands later in the
        // same batch -- and matching only the first reported a false failure.
        const mine = strikes.filter(s => s.actorId === impact.actorId);
        assert.ok(mine.length,
          `${bossId} turn ${turn}: ${impact.actorId} dealt damage with no strike at all`);
        const owner = mine.find(s => impact.at >= s.at && impact.at < s.at + s.duration);
        assert.ok(owner,
          `${bossId} turn ${turn}: ${impact.actorId}'s impact at ${impact.at}ms is outside `
          + `every strike of its own (${mine.map(s => `${s.at}..${s.at + s.duration}`).join(', ')})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `expected plenty of impacts to check, saw ${checked}`);
});

test('committing a channelled ability shows the wind-up, not a swing that lands nothing', () => {
  // The engine emits channel_started straight after the commit. Choreographing both gave
  // the actor a full approach-strike-retreat with no damage in it, immediately followed by
  // the cast -- 1500ms of pantomime that reads as a missed attack, and this game has no
  // miss mechanic at all, so it could only mislead.
  const script = choreograph([
    ev('action_committed', {actorId: 'boss', abilityId: 'sweep'}),
    ev('channel_started', {actorId: 'boss', abilityId: 'sweep'}),
  ]);
  assert.deepEqual(kinds(script), ['cast'],
    'the wind-up alone represents committing to a channel');

  // An unchannelled commit still gets its phases, so this did not disarm the normal case.
  // Filtered rather than sliced: beats are ordered by time, so the impact at 750ms sits
  // between the strike and the retreat.
  const direct = choreograph([
    ev('action_committed', {actorId: 'boss', abilityId: 'slam'}),
    ev('damage', {actorId: 'boss', targetId: 'monk', amount: 40, hpAfter: 260}),
  ]);
  assert.deepEqual(
    kinds(direct).filter(k => k === 'approach' || k === 'strike' || k === 'retreat'),
    ['approach', 'strike', 'retreat']);
});
