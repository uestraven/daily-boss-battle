/** Stage composition. All visual logic lives here rather than in the renderer, so it
 * can be asserted without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGE, bossSlot, composeFrame, displayedValue, floatProgress, heroSlots,
  integerScale, shakeOffset, tintForRole} from '../dist/src/stage.js';
import {choreograph} from '../dist/src/presentation.js';
import {advanceToDecision, applyPlayerAction, createEncounter} from '../dist/src/engine.js';
import {buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';

const def = buildEncounter('tide_maw', balancedParties()[0]);
const freshState = () => advanceToDecision(createEncounter(def), def).state;
const ev = (type, extra = {}) => ({tick: 1, type, ...extra});

test('the stage is a 16:9 fixed resolution', () => {
  assert.equal(STAGE.width / STAGE.height, 16 / 9);
  assert.ok(Number.isInteger(STAGE.width) && Number.isInteger(STAGE.height));
});

test('scaling is whole-number only and never degenerate', () => {
  assert.equal(integerScale(320, 180), 1);
  assert.equal(integerScale(640, 360), 2);
  assert.equal(integerScale(1280, 720), 4);
  // A viewport between scales rounds down rather than blurring.
  assert.equal(integerScale(700, 400), 2);
  // Smaller than the stage still renders at 1 instead of 0 or a fraction.
  assert.equal(integerScale(100, 50), 1);
  for (const [w, h] of [[360, 800], [390, 844], [1440, 900]]) {
    const scale = integerScale(w, h);
    assert.ok(Number.isInteger(scale) && scale >= 1, `${w}x${h} gave ${scale}`);
  }
});

test('actors are laid out inside the stage, party right and boss left', () => {
  const slots = heroSlots(3);
  assert.equal(slots.length, 3);
  for (const slot of slots) {
    assert.ok(slot.x > 0 && slot.x < STAGE.width, `x ${slot.x} off-stage`);
    assert.ok(slot.y > 0 && slot.y <= STAGE.height, `y ${slot.y} off-stage`);
    assert.ok(slot.x > STAGE.width / 2, 'party stands right of centre');
  }
  assert.ok(bossSlot.x < STAGE.width / 2, 'boss stands left of centre');
  // No two heroes occupy the same spot.
  assert.equal(new Set(slots.map(s => `${s.x},${s.y}`)).size, slots.length);
});

test('shake decays to nothing and is deterministic', () => {
  const beat = {at: 0, duration: 300, kind: 'shake', intensity: 1, targetId: 'x'};
  const start = shakeOffset(beat, 10);
  const end = shakeOffset(beat, 300);
  assert.deepEqual(end, {x: 0, y: 0}, 'settled by the end of the beat');
  assert.ok(Math.abs(start.x) + Math.abs(start.y) > 0, 'moves at the start');
  // Reproducible: a replay must look identical.
  assert.deepEqual(shakeOffset(beat, 120), shakeOffset(beat, 120));
  // Whole pixels only, or pixel art shimmers.
  for (let t = 0; t <= 300; t += 17) {
    const offset = shakeOffset(beat, t);
    assert.ok(Number.isInteger(offset.x) && Number.isInteger(offset.y), `fractional at ${t}`);
  }
});

test('shake amplitude scales with intensity', () => {
  const peak = intensity => {
    let max = 0;
    for (let t = 0; t <= 300; t += 5) {
      const o = shakeOffset({at: 0, duration: 300, kind: 'shake', intensity}, t);
      max = Math.max(max, Math.abs(o.x), Math.abs(o.y));
    }
    return max;
  };
  assert.ok(peak(1) > peak(0.2), 'a heavier hit shakes further');
  assert.equal(peak(0), 0, 'no intensity, no movement');
});

test('float progress spans exactly zero to one', () => {
  const beat = {at: 100, duration: 400, kind: 'damage_number'};
  assert.equal(floatProgress(beat, 100), 0);
  assert.equal(floatProgress(beat, 500), 1);
  assert.equal(floatProgress(beat, 50), 0, 'clamped before it starts');
  assert.equal(floatProgress(beat, 9999), 1, 'clamped after it ends');
  assert.ok(floatProgress(beat, 300) > 0 && floatProgress(beat, 300) < 1);
});

test('a frame always draws a background, the boss and every hero', () => {
  const state = freshState();
  const frame = composeFrame({state, script: null, timeMs: 0});
  assert.equal(frame.commands.filter(c => c.kind === 'background').length, 1);
  const sprites = frame.commands.filter(c => c.kind === 'sprite');
  assert.equal(sprites.length, state.party.length + 1, 'three heroes plus the boss');
  assert.ok(sprites.some(s => s.actorId === state.bossId && s.facing === 'right'));
  for (const id of state.party) {
    const sprite = sprites.find(s => s.actorId === id);
    assert.ok(sprite, `${id} not drawn`);
    assert.equal(sprite.facing, 'left', 'heroes face the enemy');
  }
});

test('every sprite is drawn fully inside the stage bounds', () => {
  const state = freshState();
  for (const sprite of composeFrame({state, script: null, timeMs: 0}).commands.filter(c => c.kind === 'sprite')) {
    assert.ok(sprite.x >= 0, `${sprite.actorId} x=${sprite.x} off left edge`);
    assert.ok(sprite.x + sprite.width <= STAGE.width, `${sprite.actorId} runs off the right edge`);
    assert.ok(sprite.y >= 0, `${sprite.actorId} y=${sprite.y} above the stage`);
    assert.ok(sprite.y + sprite.height <= STAGE.height, `${sprite.actorId} below the stage`);
  }
});

test('composition is pure: same inputs, same frame', () => {
  const state = freshState();
  const script = choreograph([
    ev('action_committed', {actorId: state.party[0], abilityId: 'attack'}),
    ev('damage', {actorId: state.party[0], targetId: state.bossId, amount: 120, hpAfter: 2000}),
  ], {maxHp: {[state.bossId]: 2310}});
  assert.deepEqual(
    composeFrame({state, script, timeMs: 250}),
    composeFrame({state, script, timeMs: 250}),
  );
});

test('a KO is drawn dimmed rather than removed', () => {
  const state = freshState();
  const victim = state.party[0];
  state.actors[victim].hp = 0;
  const sprites = composeFrame({state, script: null, timeMs: 0}).commands.filter(c => c.kind === 'sprite');
  const sprite = sprites.find(s => s.actorId === victim);
  assert.ok(sprite, 'a downed hero still occupies its slot');
  assert.equal(sprite.dim, true);
  assert.equal(sprites.find(s => s.actorId === state.party[1]).dim, false);
});

test('a damage number floats upward above its target', () => {
  const state = freshState();
  const script = choreograph([
    ev('damage', {actorId: state.party[0], targetId: state.bossId, amount: 250, hpAfter: 2060}),
  ], {maxHp: {[state.bossId]: 2310}});
  const numberBeat = script.beats.find(b => b.kind === 'damage_number');

  const textAt = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'text' && c.palette === 'damage');
  const early = textAt(numberBeat.at + 10);
  const late = textAt(numberBeat.at + numberBeat.duration - 10);
  assert.ok(early && late, 'the number is drawn for the whole beat');
  assert.equal(early.text, '250');
  assert.ok(late.y < early.y, 'it rises over time');
  assert.equal(early.align, 'center');
  // Gone once the beat ends.
  assert.equal(textAt(numberBeat.at + numberBeat.duration + 50), undefined);
});

test('the boss health bar drains through a live tween instead of snapping', () => {
  const state = freshState();
  const maxHp = state.actors[state.bossId].stats.hp;
  const script = choreograph([
    ev('damage', {actorId: state.party[0], targetId: state.bossId, amount: 500, hpAfter: maxHp - 500}),
  ], {maxHp: {[state.bossId]: maxHp}});
  const tween = script.beats.find(b => b.kind === 'hp_change');
  const fraction = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'bar' && c.palette === 'hp').fraction;

  assert.equal(Math.round(fraction(tween.at) * 1000), 1000, 'starts full');
  const mid = fraction(tween.at + tween.duration / 2);
  assert.ok(mid < 1 && mid > (maxHp - 500) / maxHp, 'mid-drain, between the endpoints');
  // After the tween the bar reflects actual state, which this stale state still has full.
  for (const t of [0, tween.at, tween.at + tween.duration, 99999]) {
    const value = fraction(t);
    assert.ok(value >= 0 && value <= 1, `fraction ${value} out of range at ${t}`);
  }
});

test('a phase flash emits a fading overlay', () => {
  const state = freshState();
  const script = choreograph([ev('phase_change', {actorId: state.bossId})], {names: {}});
  const flash = script.beats.find(b => b.kind === 'flash');
  const alphaAt = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'overlay' && c.palette === 'flash')?.alpha;
  const start = alphaAt(flash.at);
  const end = alphaAt(flash.at + flash.duration - 1);
  assert.ok(start > 0);
  assert.ok(end < start, 'the flash fades');
  for (const t of [flash.at, flash.at + 1, flash.at + flash.duration - 1]) {
    assert.ok(alphaAt(t) >= 0 && alphaAt(t) <= 1);
  }
});

test('simultaneous shakes pick the strongest rather than cancelling', () => {
  const state = freshState();
  const script = {
    totalMs: 300,
    beats: [
      {at: 0, duration: 300, kind: 'shake', intensity: 0.2, targetId: state.bossId},
      {at: 0, duration: 300, kind: 'shake', intensity: 1, targetId: state.bossId},
    ],
  };
  const frame = composeFrame({state, script, timeMs: 20});
  const strongOnly = composeFrame({
    state,
    script: {totalMs: 300, beats: [script.beats[1]]},
    timeMs: 20,
  });
  assert.deepEqual({x: frame.shakeX, y: frame.shakeY},
    {x: strongOnly.shakeX, y: strongOnly.shakeY});
});

test('a defeat dims the stage', () => {
  const state = freshState();
  assert.ok(!composeFrame({state, script: null, timeMs: 0}).commands.some(c => c.palette === 'dim'));
  state.result = 'defeat';
  assert.ok(composeFrame({state, script: null, timeMs: 0}).commands.some(c => c.palette === 'dim'));
});

test('role tints are distinct and defaulted safely', () => {
  const roles = ['Guardian', 'Healer', 'Striker', 'Caster', 'Controller', 'Support'];
  const tints = roles.map(tintForRole);
  assert.equal(new Set(tints).size, roles.length, 'each role reads differently');
  for (const tint of [...tints, tintForRole(undefined), tintForRole('Nonexistent')]) {
    assert.match(tint, /^#[0-9a-f]{6}$/i);
  }
});

test('frames compose over a real battle without producing invalid commands', () => {
  let step = advanceToDecision(createEncounter(def), def);
  const names = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.name]));
  const maxHp = Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.stats.hp]));
  let framesChecked = 0;

  for (let n = 0; n < 6 && !step.terminal; n++) {
    const before = step.state.events.length;
    step = applyPlayerAction(step.state,
      {actorId: step.readyHeroIds[0], abilityId: 'attack', targetIds: [def.bossId]}, def);
    const script = choreograph(step.state.events.slice(before), {names, maxHp});
    // Sample the whole batch at 60fps.
    for (let t = 0; t <= script.totalMs; t += 16) {
      const frame = composeFrame({state: step.state, script, timeMs: t});
      assert.ok(Number.isInteger(frame.shakeX) && Number.isInteger(frame.shakeY));
      for (const command of frame.commands) {
        assert.ok(command.kind, 'every command is typed');
        if (command.kind === 'bar') {
          assert.ok(command.fraction >= 0 && command.fraction <= 1, `bar ${command.fraction}`);
        }
        if (command.kind === 'overlay') {
          assert.ok(command.alpha >= 0 && command.alpha <= 1, `alpha ${command.alpha}`);
        }
        if (command.kind === 'text') assert.ok(command.text.length > 0);
      }
      framesChecked++;
    }
  }
  assert.ok(framesChecked > 100, `only sampled ${framesChecked} frames`);
});

test('REGRESSION: a meter never jumps upward during a damage batch', () => {
  // Battle state already holds the post-action value. Reading it directly made the bar
  // show the new value, snap back up as the tween began, then drain -- a visible flash.
  const state = freshState();
  const bossMax = state.actors[state.bossId].stats.hp;
  const script = choreograph([
    ev('action_committed', {actorId: state.party[0], abilityId: 'attack'}),
    ev('damage', {actorId: state.party[0], targetId: state.bossId, amount: 86, hpAfter: bossMax - 86}),
  ], {maxHp: {[state.bossId]: bossMax}});
  state.actors[state.bossId].hp = bossMax - 86;

  let previous = Infinity;
  for (let t = 0; t <= script.totalMs + 200; t += 8) {
    const fraction = composeFrame({state, script, timeMs: t}).commands
      .find(c => c.kind === 'bar' && c.palette === 'hp').fraction;
    const shown = fraction * bossMax;
    assert.ok(shown <= previous + 0.001, `bar rose from ${previous} to ${shown} at ${t}ms`);
    previous = shown;
  }
  // And it starts full, ending on the post-damage value.
  const at = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'bar').fraction * bossMax;
  assert.equal(Math.round(at(0)), bossMax, 'holds the pre-damage value until the tween runs');
  assert.equal(Math.round(at(script.totalMs + 100)), bossMax - 86, 'settles on the new value');
});

test('REGRESSION: chained multi-hit tweens never jump upward either', () => {
  const state = freshState();
  const bossMax = state.actors[state.bossId].stats.hp;
  const events = [ev('action_committed', {actorId: state.party[0], abilityId: 'volley'})];
  for (let i = 0; i < 4; i++) {
    events.push(ev('damage', {actorId: state.party[0], targetId: state.bossId,
      amount: 40, hpAfter: bossMax - 40 * (i + 1)}));
  }
  const script = choreograph(events, {maxHp: {[state.bossId]: bossMax}});
  state.actors[state.bossId].hp = bossMax - 160;

  let previous = Infinity;
  for (let t = 0; t <= script.totalMs + 200; t += 8) {
    const shown = composeFrame({state, script, timeMs: t}).commands
      .find(c => c.kind === 'bar').fraction * bossMax;
    assert.ok(shown <= previous + 0.001, `rose from ${previous} to ${shown} at ${t}ms`);
    previous = shown;
  }
});

test('displayedValue resolves the whole tween sequence, not just active beats', () => {
  const script = {
    totalMs: 1000,
    beats: [
      {at: 100, duration: 200, kind: 'hp_change', targetId: 'boss', from: 1000, to: 900},
      {at: 500, duration: 200, kind: 'hp_change', targetId: 'boss', from: 900, to: 700},
    ],
  };
  const at = t => displayedValue(script, 'boss', t, 700);
  assert.equal(at(0), 1000, 'before the first tween: its starting value');
  assert.equal(at(100), 1000, 'at the first tween start');
  assert.equal(at(300), 900, 'first tween complete');
  assert.equal(at(400), 900, 'between tweens: the last completed value');
  assert.equal(at(700), 700, 'second tween complete');
  assert.equal(at(5000), 700, 'after everything');
  const mid = at(200);
  assert.ok(mid < 1000 && mid > 900, 'interpolates inside a tween');
});

test('displayedValue falls back to state when there is nothing to animate', () => {
  assert.equal(displayedValue(null, 'boss', 0, 555), 555, 'no script');
  assert.equal(displayedValue({totalMs: 0, beats: []}, 'boss', 0, 555), 555, 'no beats');
  const other = {totalMs: 100, beats: [{at: 0, duration: 50, kind: 'hp_change', targetId: 'someone_else', from: 1, to: 0}]};
  assert.equal(displayedValue(other, 'boss', 10, 555), 555, 'tweens for a different actor');
});

test('REGRESSION: the defeat wash waits for the defeat beat', () => {
  // state.result is already terminal at the start of the batch that ends the battle, so
  // reading it directly washed the stage out before the killing blow had animated.
  const state = freshState();
  state.result = 'defeat';
  for (const id of state.party) state.actors[id].hp = 0;
  const script = choreograph([
    ev('damage', {actorId: state.bossId, targetId: state.party[0], amount: 300, hpAfter: 0}),
    ev('ko', {actorId: state.party[0]}),
    ev('defeat'),
  ], {maxHp: {[state.party[0]]: 330}});
  const defeatBeat = script.beats.find(b => b.kind === 'defeat');
  const dimAt = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'overlay' && c.palette === 'dim');

  assert.equal(dimAt(0), undefined, 'no wash at the start of the batch');
  assert.equal(dimAt(defeatBeat.at - 1), undefined, 'none right up to the defeat beat');
  assert.ok(dimAt(defeatBeat.at + 10), 'appears once the defeat beat lands');
  assert.ok(dimAt(defeatBeat.at + defeatBeat.duration).alpha
    > dimAt(defeatBeat.at + 10).alpha, 'fades in rather than snapping');
});

test('REGRESSION: a hero dying this batch stands until its KO beat', () => {
  const state = freshState();
  const victim = state.party[0];
  const fullHp = state.actors[victim].stats.hp;
  state.actors[victim].hp = 0; // final state: already dead
  const script = choreograph([
    ev('action_committed', {actorId: state.bossId, abilityId: 'attack'}),
    ev('damage', {actorId: state.bossId, targetId: victim, amount: fullHp, hpAfter: 0}),
    ev('ko', {actorId: victim}),
  ], {maxHp: {[victim]: fullHp}});
  const dimmed = t => composeFrame({state, script, timeMs: t}).commands
    .find(c => c.kind === 'sprite' && c.actorId === victim).dim;

  assert.equal(dimmed(0), false, 'still standing when the batch starts');
  assert.equal(dimmed(script.totalMs), true, 'down by the end');
  // The transition happens once, and only forward.
  let flips = 0;
  let previous = dimmed(0);
  for (let t = 0; t <= script.totalMs; t += 8) {
    const now = dimmed(t);
    if (now !== previous) { flips++; previous = now; }
  }
  assert.equal(flips, 1, `dim state flipped ${flips} times, expected exactly one`);
});

test('a hero already dead before this batch stays dimmed throughout', () => {
  const state = freshState();
  const corpse = state.party[0];
  state.actors[corpse].hp = 0;
  const script = choreograph([
    ev('damage', {actorId: state.party[1], targetId: state.bossId, amount: 50, hpAfter: 2260}),
  ], {maxHp: {[state.bossId]: 2310}});
  for (const t of [0, 100, script.totalMs]) {
    const sprite = composeFrame({state, script, timeMs: t}).commands
      .find(c => c.kind === 'sprite' && c.actorId === corpse);
    assert.equal(sprite.dim, true, `not dimmed at ${t}ms`);
  }
});

test('with no script the stage still reflects actual state', () => {
  const state = freshState();
  state.result = 'defeat';
  assert.ok(composeFrame({state, script: null, timeMs: 0}).commands
    .some(c => c.kind === 'overlay' && c.palette === 'dim'), 'idle defeat still washes out');
  state.result = null;
  state.actors[state.party[0]].hp = 0;
  assert.equal(composeFrame({state, script: null, timeMs: 0}).commands
    .find(c => c.kind === 'sprite' && c.actorId === state.party[0]).dim, true);
});
