/** Stage composition. All visual logic lives here rather than in the renderer, so it
 * can be asserted without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUND_OFFSET, STAGE, bossSlot, composeFrame, displayedValue, downAt, floatProgress, heroSlots,
  integerScale, shakeOffset, statusesAt, tintForRole} from '../dist/src/stage.js';
import {choreograph} from '../dist/src/presentation.js';
import {advanceToDecision, applyPlayerAction, createEncounter} from '../dist/src/engine.js';
import {bossIds, buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';
import {validateSheet} from '../dist/src/animation.js';
import {requiredEffects, validateEffectSheet} from '../dist/src/effects.js';
import {existsSync, readFileSync} from 'node:fs';
import {decodePng} from '../tools/png.mjs';

/** The real shipped manifest, so these assertions fail on the actual art, not a fixture. */
const manifest = JSON.parse(readFileSync(new URL('../web/src/sprite-manifest.json', import.meta.url), 'utf8'));
const effectManifest = JSON.parse(readFileSync(new URL('../web/src/effect-manifest.json', import.meta.url), 'utf8'));

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

test('the very first frame already references sprite art', () => {
  // The renderer only requests a sheet image when a draw command names one, so if the
  // idle frame omitted sheets, no art would even begin downloading until the first
  // action produced a script -- which is exactly how the stage came to sit on
  // silhouettes while fully-loaded art waited in the cache.
  const sheets = {};
  for (const id of Object.keys(def.actors)) {
    const meta = manifest.heroes[id] ?? manifest.bosses[id];
    if (meta) sheets[id] = validateSheet(meta, id);
  }
  const named = Object.keys(sheets);
  assert.ok(named.length >= 4, `expected the manifest to cover this encounter, got ${named}`);

  const frame = composeFrame({state: freshState(), script: null, timeMs: 0, sheets});
  for (const id of named) {
    const sprite = frame.commands.find(c => c.kind === 'sprite' && c.actorId === id);
    assert.ok(sprite, `${id} has no sprite command`);
    assert.ok(sprite.sheet, `${id} draws no sheet on the idle frame, so its art is never requested`);
    assert.equal(sprite.sheet.file, sheets[id].file);
    assert.equal(sprite.animation, 'idle');
    // A zero-area source rectangle would request the file and then blit nothing.
    assert.ok(sprite.sheet.sw > 0 && sprite.sheet.sh > 0, `${id} has an empty source rect`);
  }
});

test('every sheet the manifest declares exists on disk', () => {
  // A manifest entry naming a missing PNG degrades to a silhouette at runtime with no
  // error, so the mismatch has to be caught here.
  for (const [kind, section] of Object.entries({heroes: manifest.heroes, bosses: manifest.bosses})) {
    for (const [id, meta] of Object.entries(section)) {
      const file = new URL(`../web/public/battle-sprites/${meta.file}`, import.meta.url);
      assert.ok(existsSync(file), `${kind}/${id} declares ${meta.file}, which is not on disk`);
    }
  }
});

// --- Hit effect layer ---------------------------------------------------------------

const effectSheet = (over = {}) => ({
  file: 'slash.png', frameWidth: 64, frameHeight: 48, frames: 4,
  anchorX: 32, anchorY: 40, ...over,
});

/** A script with one hero hit landing on the boss. */
const hitScript = (abilityId = 'swing') => {
  const state = freshState();
  return {
    state,
    script: choreograph([
      ev('action_committed', {actorId: state.party[0], abilityId}),
      ev('damage', {actorId: state.party[0], targetId: state.bossId, abilityId,
        amount: 100, hpAfter: 900}),
    ], {maxHp: {[state.bossId]: 1000}}),
  };
};

test('an impact draws its effect, anchored on the target', () => {
  const {state, script} = hitScript();
  const impact = script.beats.find(b => b.kind === 'impact');
  const frame = composeFrame({
    state, script, timeMs: impact.at + 10,
    effects: {slash: effectSheet()},
    abilityInfo: {swing: {kind: 'physical'}},
  });
  const effects = frame.commands.filter(c => c.kind === 'effect');
  assert.equal(effects.length, 1, 'one hit, one effect');
  const [effect] = effects;
  assert.equal(effect.effectId, 'slash');
  assert.equal(effect.targetId, state.bossId);
  // Positioned by the sheet's own anchor against the boss slot, so a ground effect and an
  // overhead flare need no special-casing.
  assert.equal(effect.x, bossSlot.x - 32);
  assert.equal(effect.y, bossSlot.y - 40);
  assert.equal(effect.width, 64);
  assert.equal(effect.height, 48);
  assert.ok(effect.sheet.sw === 64 && effect.sheet.sh === 48);
});

test('an empty effect library emits nothing at all', () => {
  // This is the shipping state until art exists: no commands, so no requests and no
  // console noise, and the stage keeps its hit flash and shake.
  const {state, script} = hitScript();
  const impact = script.beats.find(b => b.kind === 'impact');
  for (const effects of [undefined, {}]) {
    const frame = composeFrame({state, script, timeMs: impact.at + 10, effects,
      abilityInfo: {swing: {kind: 'physical'}}});
    assert.equal(frame.commands.filter(c => c.kind === 'effect').length, 0);
  }
});

test('a binding with no matching sheet is skipped rather than drawn empty', () => {
  const {state, script} = hitScript('fire');
  const impact = script.beats.find(b => b.kind === 'impact');
  // The ability is magical, so it binds to flare_neutral, which is not in the library.
  const frame = composeFrame({state, script, timeMs: impact.at + 10,
    effects: {slash: effectSheet()}, abilityInfo: {fire: {kind: 'magical'}}});
  assert.equal(frame.commands.filter(c => c.kind === 'effect').length, 0);
});

test('a spell picks its elemental flare over the generic one', () => {
  const {state, script} = hitScript('fire');
  const impact = script.beats.find(b => b.kind === 'impact');
  const library = {
    flare_neutral: effectSheet({file: 'flare_neutral.png'}),
    flare_fire: effectSheet({file: 'flare_fire.png'}),
  };
  const frame = composeFrame({state, script, timeMs: impact.at + 10, effects: library,
    abilityInfo: {fire: {kind: 'magical', element: 'fire'}}});
  const [effect] = frame.commands.filter(c => c.kind === 'effect');
  assert.equal(effect.effectId, 'flare_fire');
});

test('effects marked behind draw under the actors, the rest over them', () => {
  const {state, script} = hitScript();
  const impact = script.beats.find(b => b.kind === 'impact');
  const order = behind => {
    const frame = composeFrame({state, script, timeMs: impact.at + 10,
      effects: {slash: effectSheet({behind})},
      abilityInfo: {swing: {kind: 'physical'}}});
    return {
      effect: frame.commands.findIndex(c => c.kind === 'effect'),
      boss: frame.commands.findIndex(c => c.kind === 'sprite' && c.actorId === state.bossId),
      hud: frame.commands.findIndex(c => c.kind === 'bar'),
    };
  };
  const under = order(true);
  assert.ok(under.effect < under.boss, 'a behind effect precedes the boss sprite');
  const over = order(false);
  assert.ok(over.effect > over.boss, 'a front effect follows the actors');
  assert.ok(over.effect < over.hud, 'but stays under the HUD, so numbers stay readable');
});

test('an effect outlives the instant beat that spawned it, then stops', () => {
  // Impact beats are ~110ms; an effect that only showed for that long would barely
  // register, so activeEffects extends its own window.
  const {state, script} = hitScript();
  const impact = script.beats.find(b => b.kind === 'impact');
  const at = offset => composeFrame({state, script, timeMs: impact.at + offset,
    effects: {slash: effectSheet()}, abilityInfo: {swing: {kind: 'physical'}},
    effectDurationMs: 300}).commands.filter(c => c.kind === 'effect');

  assert.equal(at(0).length, 1, 'starts with the hit');
  assert.ok(impact.duration < 300, 'the beat is shorter than the effect');
  assert.equal(at(impact.duration + 20).length, 1, 'still running after the beat ended');
  assert.equal(at(299).length, 1);
  assert.equal(at(300).length, 0, 'and ends');
  assert.equal(at(-1).length, 0, 'nothing before the hit');

  // Frames advance monotonically across the effect, ending on the last one.
  const frames = [0, 80, 160, 299].map(o => at(o)[0].frame);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i] >= frames[i - 1]);
  assert.equal(frames.at(-1), 3, 'the final frame is the last in the sheet, not past it');
});

test('every declared effect validates and is reachable from the default bindings', () => {
  // The manifest is the commissioning brief, so a malformed entry should fail here rather
  // than when the art finally arrives.
  const declared = effectManifest.effects;
  for (const entry of requiredEffects()) {
    const sheet = declared[entry.id];
    assert.ok(sheet, `${entry.id} is required but not declared in effect-manifest.json`);
    assert.doesNotThrow(() => validateEffectSheet(sheet, entry.id));
    assert.ok(sheet.file.endsWith('.png'));
  }
  // And nothing is declared that no binding can ever ask for.
  const reachable = new Set(requiredEffects().map(e => e.id));
  for (const id of Object.keys(declared)) {
    assert.ok(reachable.has(id), `${id} is declared but no binding reaches it`);
  }
});

test('shipped effects must have their art on disk', () => {
  // The gate that keeps the renderer from requesting a file that is not there.
  for (const id of effectManifest.shipped) {
    const sheet = effectManifest.effects[id];
    assert.ok(sheet, `"${id}" is shipped but not declared`);
    const file = new URL(`../web/public/battle-effects/${sheet.file}`, import.meta.url);
    assert.ok(existsSync(file), `"${id}" is listed as shipped but ${sheet.file} is missing`);
  }
});

// --- Arena backdrops ----------------------------------------------------------------

test('the background command names the arena, and its art only when it exists', () => {
  const state = freshState();
  // No file: the renderer draws the flat stage, which is the shipping state.
  const bare = composeFrame({state, script: null, timeMs: 0})
    .commands.find(c => c.kind === 'background');
  assert.ok(bare, 'there is always a background command to clear the frame');
  assert.equal(bare.file, undefined, 'no art means no file, so nothing is requested');

  const dressed = composeFrame({state, script: null, timeMs: 0,
    backgroundId: 'tide_maw', backgroundFile: 'tide_maw.png'})
    .commands.find(c => c.kind === 'background');
  assert.equal(dressed.id, 'tide_maw');
  assert.equal(dressed.file, 'tide_maw.png');
});

test('the background is the first command, so everything draws over it', () => {
  const state = freshState();
  const commands = composeFrame({state, script: null, timeMs: 0}).commands;
  assert.equal(commands[0].kind, 'background');
});

test('every boss has an arena briefed for it', () => {
  // backgroundForBoss falls back to another arena for an unknown boss, so a missing brief
  // shows the wrong scenery rather than failing. This is the assertion that catches it;
  // two bosses were silently using the Broken Span before it existed.
  const catalog = readFileSync(new URL('../web/src/background-catalog.ts', import.meta.url), 'utf8');
  for (const boss of bossIds) {
    assert.ok(new RegExp(`^ {2}${boss}: \\{`, 'm').test(catalog),
      `${boss} has no arena in background-catalog.ts`);
  }
});

test('shipped arenas must have their art on disk', () => {
  const catalog = readFileSync(new URL('../web/src/background-catalog.ts', import.meta.url), 'utf8');
  const block = catalog.match(/shippedBackgrounds: readonly BackgroundId\[\] = \[([^\]]*)\]/);
  assert.ok(block, 'shippedBackgrounds must stay greppable: the check tool reads it');
  for (const [, id] of [...block[1].matchAll(/'([^']+)'/g)]) {
    const file = new URL(`../web/public/battle-backgrounds/${id}.png`, import.meta.url);
    assert.ok(existsSync(file), `"${id}" is shipped but ${id}.png is missing`);
  }
});

// --- When an actor reads as down -----------------------------------------------------

test('an actor reads as down only once the killing blow has landed', () => {
  // The defect this guards: the party panel read actor.hp === 0 straight from state,
  // which is already the post-batch state, so a hero dimmed the instant the action was
  // committed -- several hundred milliseconds before the attack animation reached them.
  const state = freshState();
  const victim = state.party[0];
  const maxHp = state.actors[victim].stats.hp;
  const script = choreograph([
    ev('action_committed', {actorId: state.bossId, abilityId: 'attack'}),
    ev('damage', {actorId: state.bossId, targetId: victim, abilityId: 'attack',
      amount: maxHp, hpAfter: 0}),
    ev('ko', {actorId: victim}),
  ], {maxHp: {[victim]: maxHp}});

  const tween = script.beats.find(b => b.kind === 'hp_change' && b.targetId === victim);
  assert.ok(tween, 'the hit produces an hp tween');
  assert.ok(tween.at > 0, 'and it does not begin at time zero');

  // `0` is the final hp, which is what the panel passes in.
  assert.equal(downAt(script, victim, 0, 0), false, 'not down before the attack begins');
  assert.equal(downAt(script, victim, tween.at - 1, 0), false, 'nor at the moment of impact');
  assert.equal(downAt(script, victim, tween.at + tween.duration, 0), true,
    'down once the drain completes');
  assert.equal(downAt(script, victim, script.totalMs, 0), true, 'and stays down');
});

test('a survivor never reads as down, and a corpse always does', () => {
  const state = freshState();
  const id = state.party[0];
  const script = choreograph([
    ev('damage', {actorId: state.bossId, targetId: id, amount: 10, hpAfter: 90}),
  ], {maxHp: {[id]: 100}});
  for (const t of [0, 100, script.totalMs]) {
    assert.equal(downAt(script, id, t, 90), false);
  }
  // With no script at all -- between turns -- the state is the only truth available.
  assert.equal(downAt(null, id, 0, 0), true);
  assert.equal(downAt(null, id, 0, 90), false);
});

test('the canvas and the panel cannot disagree about who is down', () => {
  // Both go through downAt now; this asserts composeFrame's dimming matches it exactly,
  // since two separate rules were how the panel drifted ahead in the first place.
  const state = freshState();
  const victim = state.party[0];
  const maxHp = state.actors[victim].stats.hp;
  state.actors[victim].hp = 0;
  const script = choreograph([
    ev('damage', {actorId: state.bossId, targetId: victim, amount: maxHp, hpAfter: 0}),
    ev('ko', {actorId: victim}),
  ], {maxHp: {[victim]: maxHp}});

  for (const t of [0, 200, 400, 700, 1200, script.totalMs]) {
    const sprite = composeFrame({state, script, timeMs: t}).commands
      .find(c => c.kind === 'sprite' && c.actorId === victim);
    assert.equal(sprite.dim, downAt(script, victim, t, 0), `disagreement at ${t}ms`);
  }
});

// --- Status badges, resolved against playback ----------------------------------------

test('a status appears when the spell granting it plays, not when it is chosen', () => {
  const id = 'oracle';
  const script = choreograph([
    ev('action_committed', {actorId: id, abilityId: 'protect_spell'}),
    ev('status_applied', {actorId: id, status: 'protect', details: 'protect; expires at 40'}),
  ], {});
  const on = script.beats.find(b => b.kind === 'status_on');
  assert.ok(on && on.at > 0, 'the badge has a moment to appear at');
  assert.equal(on.status, 'protect', 'the beat carries the id, not just prose');

  // `{protect: ...}` is the post-batch state, which is all the screen has.
  const final = {protect: {expiresAt: 40}};
  assert.deepEqual(statusesAt(script, id, 0, final), [], 'nothing before the spell plays');
  assert.deepEqual(statusesAt(script, id, on.at - 1, final), []);
  assert.deepEqual(statusesAt(script, id, on.at, final), ['protect'], 'on at the beat');
  assert.deepEqual(statusesAt(script, id, script.totalMs, final), ['protect']);
});

test('a status that ends mid-batch is shown until it does', () => {
  const id = 'blademage';
  const script = choreograph([
    ev('action_committed', {actorId: id, abilityId: 'ready'}),
    ev('status_applied', {actorId: id, status: 'focus', details: 'focus; expires at 30'}),
    ev('action_committed', {actorId: id, abilityId: 'strike'}),
    ev('status_removed', {actorId: id, status: 'focus', details: 'focus'}),
  ], {});
  const on = script.beats.find(b => b.kind === 'status_on');
  const off = script.beats.find(b => b.kind === 'status_off');
  assert.ok(on.at > 0 && on.at < off.at);
  // Applied and spent within one batch, so the final state does not have it at all.
  assert.deepEqual(statusesAt(script, id, 0, {}), [], 'not yet granted');
  assert.deepEqual(statusesAt(script, id, on.at, {}), ['focus'], 'granted');
  assert.deepEqual(statusesAt(script, id, off.at - 1, {}), ['focus'], 'still held');
  assert.deepEqual(statusesAt(script, id, off.at, {}), [], 'spent');
});

test('a status held from before the batch shows throughout', () => {
  // There is no beat for it: it was applied turns ago, so the final state is the evidence.
  const script = choreograph([ev('damage', {actorId: 'b', targetId: 'monk', amount: 10, hpAfter: 90})],
    {maxHp: {monk: 100}});
  const final = {haste: {expiresAt: 99}};
  for (const t of [0, 200, script.totalMs]) {
    assert.deepEqual(statusesAt(script, 'monk', t, final), ['haste']);
  }
});

test('a status expiring later in the batch is still shown now', () => {
  const id = 'monk';
  const script = choreograph([
    ev('action_committed', {actorId: id, abilityId: 'attack'}),
    ev('status_expired', {actorId: id, status: 'protect', details: 'protect'}),
  ], {});
  const off = script.beats.find(b => b.kind === 'status_off');
  // Gone by the end, so absent from the final state; present until the beat.
  assert.deepEqual(statusesAt(script, id, 0, {}), ['protect']);
  assert.deepEqual(statusesAt(script, id, off.at - 1, {}), ['protect']);
  assert.deepEqual(statusesAt(script, id, off.at, {}), []);
});

test('a status toggling twice in one batch unwinds in the right order', () => {
  // Newest-first processing is what makes this work; forwards would land on the wrong set.
  const id = 'thief';
  const script = choreograph([
    ev('action_committed', {actorId: id, abilityId: 'open'}),
    ev('status_applied', {actorId: id, status: 'surge', details: 'surge'}),
    ev('action_committed', {actorId: id, abilityId: 'a'}),
    ev('status_removed', {actorId: id, status: 'surge', details: 'surge'}),
    ev('action_committed', {actorId: id, abilityId: 'b'}),
    ev('status_applied', {actorId: id, status: 'surge', details: 'surge'}),
  ], {});
  const beats = script.beats.filter(b => b.kind === 'status_on' || b.kind === 'status_off')
    .sort((a, b) => a.at - b.at);
  assert.equal(beats.length, 3);
  assert.ok(beats[0].at > 0, 'the batch opens with an action, so there is a "before"');
  const final = {surge: {expiresAt: 50}};
  assert.deepEqual(statusesAt(script, id, 0, final), [], 'not yet granted');
  assert.deepEqual(statusesAt(script, id, beats[0].at, final), ['surge']);
  assert.deepEqual(statusesAt(script, id, beats[1].at, final), [], 'spent');
  assert.deepEqual(statusesAt(script, id, beats[2].at, final), ['surge'], 'granted again');
});

test('statuses are only read for the actor they belong to', () => {
  const script = choreograph([
    ev('status_applied', {actorId: 'oracle', status: 'protect', details: 'protect'}),
  ], {});
  const on = script.beats.find(b => b.kind === 'status_on');
  // The warden's own badge must not be driven by the oracle's beat.
  assert.deepEqual(statusesAt(script, 'warden', on.at, {protect: {expiresAt: 40}}), ['protect']);
  assert.deepEqual(statusesAt(script, 'warden', 0, {protect: {expiresAt: 40}}), ['protect']);
});

test('badge order is stable, so it cannot flicker between frames', () => {
  const final = {surge: {}, protect: {}, poison: {}, haste: {}};
  const first = statusesAt(null, 'x', 0, final);
  assert.deepEqual(first, statusesAt(null, 'x', 0, {poison: {}, haste: {}, protect: {}, surge: {}}),
    'order cannot depend on insertion order of the state object');
  assert.deepEqual([...first].sort(), first, 'and is deterministic');
});

test('with no script, the state is the only truth', () => {
  assert.deepEqual(statusesAt(null, 'x', 0, {poison: {expiresAt: 9}}), ['poison']);
  assert.deepEqual(statusesAt(null, 'x', 0, {}), []);
});

test('the whole cast stands on stage, in depth order, clear of the HUD', () => {
  // GROUND_OFFSET moves everyone down to meet real arena floors, which is exactly the
  // kind of change that can push the nearest hero off the bottom or the boss behind the
  // health bar. These are the bounds it must not cross.
  const manifest = JSON.parse(readFileSync(
    new URL('../web/src/sprite-manifest.json', import.meta.url), 'utf8'));
  const slots = heroSlots(3);

  // Feet strictly increase, so the stagger still reads front-to-back.
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i].y > slots[i - 1].y, 'each hero stands nearer than the last');
  }

  const heroHeight = Math.max(...Object.values(manifest.heroes).map(s => s.frameHeight));
  const nearest = slots[slots.length - 1];
  assert.ok(nearest.y <= STAGE.height, `nearest hero's feet at ${nearest.y} are off-stage`);
  assert.ok(nearest.y - heroHeight >= 0, 'the tallest hero cell fits above its feet');

  // The boss health bar occupies y 12..18, and the boss lifts up to 6px during its own
  // attack step. Measured against where the art actually starts, not the cell: a boss cell
  // is 96 tall but the figure sits on the baseline, so its first opaque row is far down
  // the cell. Testing the cell rect reports an overlap that does not exist.
  const bossHeight = Math.max(...Object.values(manifest.bosses).map(s => s.frameHeight));
  for (const [id, sheet] of Object.entries(manifest.bosses)) {
    if (sheet.frameHeight !== bossHeight) continue;
    const img = decodePng(readFileSync(
      new URL(`../web/public/battle-sprites/${sheet.file}`, import.meta.url)));
    let firstInk = sheet.frameHeight;
    for (let y = 0; y < sheet.frameHeight && firstInk === sheet.frameHeight; y++) {
      for (let x = 0; x < sheet.frameWidth; x++) {
        if (img.rgba[((y * img.width) + x) * 4 + 3] > 8) { firstInk = y; break; }
      }
    }
    const topWhenStepping = bossSlot.y - sheet.frameHeight + firstInk - 6;
    assert.ok(topWhenStepping > 18,
      `${id} reaches y ${topWhenStepping} mid-step, overlapping the health bar`);
  }

  // A damage number spawns above the actor and rises 18px; off the top is never useful.
  assert.ok(bossSlot.y - bossHeight - 4 - 18 >= 0,
    'the boss damage number rises off the top of the stage');
});

test('the ground offset is a deliberate value, not drift', () => {
  // Locked because it was chosen by compositing against real arena art. If a future
  // layout change moves it, that should be a decision someone makes on purpose.
  assert.equal(GROUND_OFFSET, 14);
  assert.equal(bossSlot.y, 104 + GROUND_OFFSET);
  assert.equal(heroSlots(1)[0].y, 96 + GROUND_OFFSET);
});
