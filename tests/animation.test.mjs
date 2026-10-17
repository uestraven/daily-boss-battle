/** Sprite animation selection. Frame choice is driven entirely by the choreography
 * beats, so it is asserted here rather than eyeballed in a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ANIMATION_NAMES, DEFAULT_LOOP_FRAME_MS, animationFor, animationsFor, frameFor,
  frameRect, validateSheet} from '../dist/src/animation.js';
import {choreograph} from '../dist/src/presentation.js';
import {advanceToDecision, createEncounter} from '../dist/src/engine.js';
import {buildEncounter} from '../dist/src/generate.js';
import {balancedParties} from '../dist/src/draft.js';

const ev = (type, extra = {}) => ({tick: 1, type, ...extra});

const sheet = {
  file: 'heroes/warden.png',
  frameWidth: 32, frameHeight: 40, anchorX: 16, anchorY: 40,
  clips: {
    idle: {row: 0, frames: 2, loop: true, frameMs: 200},
    attack: {row: 1, frames: 4, loop: false},
    cast: {row: 2, frames: 3, loop: false},
    hurt: {row: 3, frames: 2, loop: false},
    ko: {row: 4, frames: 3, loop: false},
    victory: {row: 5, frames: 2, loop: true, frameMs: 250},
  },
};

const def = buildEncounter('tide_maw', balancedParties()[0]);
const freshState = () => advanceToDecision(createEncounter(def), def).state;

test('an idle actor loops its idle clip', () => {
  const a = animationFor('warden', {script: null, timeMs: 0, sheet});
  assert.equal(a.name, 'idle');
  assert.equal(a.frame, 0);
  // Loops on its own cadence, not stretched to anything.
  assert.equal(animationFor('warden', {script: null, timeMs: 200, sheet}).frame, 1);
  assert.equal(animationFor('warden', {script: null, timeMs: 400, sheet}).frame, 0, 'wraps');
});

test('an attack animation is stretched to span exactly its beat', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'warden', abilityId: 'attack'}),
  ], {});
  const step = script.beats.find(b => b.kind === 'actor_step');
  const at = t => animationFor('warden', {script, timeMs: t, sheet});

  assert.equal(at(step.at).name, 'attack');
  assert.equal(at(step.at).frame, 0, 'starts on the first frame');
  assert.equal(at(step.at + step.duration - 1).frame, sheet.clips.attack.frames - 1,
    'reaches the last frame exactly as the beat ends');
  // Monotonic: frames never go backwards within one beat.
  let previous = -1;
  for (let t = step.at; t < step.at + step.duration; t += 5) {
    const frame = at(t).frame;
    assert.ok(frame >= previous, `frame went backwards at ${t}`);
    previous = frame;
  }
});

test('every frame of a stretched clip is actually shown', () => {
  const script = choreograph([ev('action_committed', {actorId: 'warden', abilityId: 'attack'})], {});
  const step = script.beats.find(b => b.kind === 'actor_step');
  const seen = new Set();
  for (let t = step.at; t < step.at + step.duration; t += 1) {
    seen.add(animationFor('warden', {script, timeMs: t, sheet}).frame);
  }
  assert.equal(seen.size, sheet.clips.attack.frames, `only showed frames ${[...seen].join(',')}`);
});

test('taking a hit plays hurt, and outranks attacking', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'boss', abilityId: 'tentacle'}),
    ev('damage', {actorId: 'boss', targetId: 'warden', amount: 60, hpAfter: 340}),
  ], {maxHp: {warden: 400}});
  const impact = script.beats.find(b => b.kind === 'impact');
  assert.equal(animationFor('warden', {script, timeMs: impact.at, sheet}).name, 'hurt');
  // The attacker is mid-attack at the same instant.
  assert.equal(animationFor('boss', {script, timeMs: impact.at, sheet}).name, 'attack');
});

test('a KO outranks everything and then holds its last frame', () => {
  const script = choreograph([
    ev('damage', {actorId: 'boss', targetId: 'warden', amount: 400, hpAfter: 0}),
    ev('ko', {actorId: 'warden'}),
  ], {maxHp: {warden: 400}});
  const ko = script.beats.find(b => b.kind === 'ko');
  assert.equal(animationFor('warden', {script, timeMs: ko.at, sheet}).name, 'ko');
  assert.equal(animationFor('warden', {script, timeMs: ko.at, sheet}).frame, 0, 'collapse starts');
  assert.equal(animationFor('warden', {script, timeMs: ko.at + ko.duration - 1, sheet}).frame,
    sheet.clips.ko.frames - 1, 'collapse completes');
  // Already down from an earlier batch: holds the final frame, does not idle.
  const held = animationFor('warden', {script: null, timeMs: 0, sheet, down: true});
  assert.equal(held.name, 'ko');
  assert.equal(held.frame, sheet.clips.ko.frames - 1);
});

test('casting plays the cast clip', () => {
  const script = choreograph([ev('channel_started', {actorId: 'magus', abilityId: 'fire'})], {});
  const cast = script.beats.find(b => b.kind === 'cast');
  assert.equal(animationFor('magus', {script, timeMs: cast.at + 10, sheet}).name, 'cast');
});

test('a victorious survivor loops its victory clip', () => {
  const a = animationFor('warden', {script: null, timeMs: 500, sheet, victorious: true});
  assert.equal(a.name, 'victory');
  assert.equal(a.frame, 500 / 250 % 2, 'loops on its own cadence');
});

test('a missing clip degrades to idle instead of drawing nothing', () => {
  const minimal = {...sheet, clips: {idle: {row: 0, frames: 1, loop: true}}};
  const script = choreograph([ev('action_committed', {actorId: 'warden', abilityId: 'attack'})], {});
  const step = script.beats.find(b => b.kind === 'actor_step');
  const a = animationFor('warden', {script, timeMs: step.at, sheet: minimal});
  assert.equal(a.name, 'idle', 'falls back rather than failing');
  assert.equal(a.frame, 0);
});

test('with no sheet at all the result is still well formed', () => {
  const a = animationFor('warden', {script: null, timeMs: 0});
  assert.ok(ANIMATION_NAMES.includes(a.name));
  assert.equal(a.frame, 0);
  assert.equal(a.progress, 0);
});

test('frameFor handles single-frame and looping clips', () => {
  assert.equal(frameFor({row: 0, frames: 1, loop: false}, 999, 100), 0, 'one frame is always frame 0');
  const looping = {row: 0, frames: 3, loop: true};
  assert.equal(frameFor(looping, 0, null), 0);
  assert.equal(frameFor(looping, DEFAULT_LOOP_FRAME_MS, null), 1, 'uses the default cadence');
  assert.equal(frameFor(looping, DEFAULT_LOOP_FRAME_MS * 3, null), 0, 'wraps');
  // Negative time cannot produce a negative frame.
  assert.equal(frameFor(looping, -50, null), 0);
});

test('a frame rect indexes the sheet by row and column', () => {
  const rect = frameRect(sheet, {name: 'attack', frame: 2, progress: 0.5});
  assert.deepEqual(rect, {x: 2 * 32, y: 1 * 40, width: 32, height: 40});
  assert.deepEqual(frameRect(sheet, {name: 'idle', frame: 0, progress: 0}),
    {x: 0, y: 0, width: 32, height: 40});
});

test('animationsFor covers every actor in the battle', () => {
  const state = freshState();
  const animations = animationsFor(state, {script: null, timeMs: 0});
  assert.deepEqual(Object.keys(animations).sort(), [...state.party, state.bossId].sort());
  for (const animation of Object.values(animations)) {
    assert.ok(ANIMATION_NAMES.includes(animation.name));
    assert.ok(Number.isInteger(animation.frame) && animation.frame >= 0);
  }
});

test('animationsFor marks already-dead actors as down', () => {
  const state = freshState();
  const corpse = state.party[0];
  state.actors[corpse].hp = 0;
  const sheets = Object.fromEntries([...state.party, state.bossId].map(id => [id, sheet]));
  const animations = animationsFor(state, {script: null, timeMs: 0, sheets, downIds: [corpse]});
  assert.equal(animations[corpse].name, 'ko');
  assert.equal(animations[state.party[1]].name, 'idle');
});

test('a real battle batch never produces an invalid animation', () => {
  const state = freshState();
  const script = choreograph([
    ev('action_committed', {actorId: state.party[0], abilityId: 'attack'}),
    ev('damage', {actorId: state.party[0], targetId: state.bossId, amount: 90, hpAfter: 2220}),
    ev('action_committed', {actorId: state.bossId, abilityId: 'maw_tentacle'}),
    ev('damage', {actorId: state.bossId, targetId: state.party[1], amount: 120, hpAfter: 210}),
  ], {maxHp: {[state.bossId]: 2310, [state.party[1]]: 330}});
  const sheets = Object.fromEntries([...state.party, state.bossId].map(id => [id, sheet]));

  for (let t = 0; t <= script.totalMs; t += 8) {
    for (const [id, animation] of Object.entries(animationsFor(state, {script, timeMs: t, sheets}))) {
      const clip = sheet.clips[animation.name];
      assert.ok(clip, `${id}: no clip for ${animation.name} at ${t}ms`);
      assert.ok(animation.frame < clip.frames,
        `${id}: frame ${animation.frame} beyond ${clip.frames} of ${animation.name} at ${t}ms`);
    }
  }
});

test('sheet validation rejects malformed manifests', () => {
  assert.equal(validateSheet(sheet).file, sheet.file);
  assert.throws(() => validateSheet(null), /not an object/);
  assert.throws(() => validateSheet({...sheet, file: undefined}), /missing file/);
  assert.throws(() => validateSheet({...sheet, frameWidth: 0}), /frame size/);
  assert.throws(() => validateSheet({...sheet, clips: undefined}), /missing clips/);
  assert.throws(() => validateSheet({...sheet, clips: {attack: sheet.clips.attack}}), /idle clip is required/);
  assert.throws(() => validateSheet({...sheet, clips: {...sheet.clips, wiggle: {row: 9, frames: 2}}}),
    /unknown clip/);
  assert.throws(() => validateSheet({...sheet, clips: {...sheet.clips, attack: {row: 1, frames: 0}}}),
    /at least one frame/);
  assert.throws(() => validateSheet({...sheet, anchorY: 999}), /anchorY outside/);
});
