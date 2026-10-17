/** Attack effects as their own layer, resolved from impact beats. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS, DEFAULT_EFFECT_MS, activeEffects, effectIdFor, effectRect, requiredEffects,
  validateEffectSheet} from '../dist/src/effects.js';
import {TIMING, choreograph} from '../dist/src/presentation.js';

const ev = (type, extra = {}) => ({tick: 1, type, ...extra});
const sheetOf = (overrides = {}) => ({
  file: 'effects/slash.png', frameWidth: 64, frameHeight: 48, frames: 4,
  anchorX: 32, anchorY: 40, ...overrides,
});
const library = {
  slash: sheetOf(),
  flare_fire: sheetOf({file: 'effects/flare_fire.png', frameWidth: 64, frameHeight: 64, frames: 5, anchorY: 56}),
  flare_neutral: sheetOf({file: 'effects/flare_neutral.png', frames: 5}),
};

test('an effect is larger than a character cell, which is the point', () => {
  // A 32x40 character cell cannot hold a sweeping slash; the separate layer can.
  assert.ok(library.slash.frameWidth > 32);
  for (const effect of requiredEffects()) {
    const [w, h] = effect.suggestedFrame.split('x').map(Number);
    assert.ok(w >= 64 && h >= 48, `${effect.id} suggested frame is too small to be worth separating`);
  }
});

test('bindings resolve most specific first', () => {
  const bindings = {...DEFAULT_BINDINGS, byAbility: {volley: 'slash'}};
  assert.equal(effectIdFor(bindings, {abilityId: 'volley', element: 'fire', kind: 'magical'}), 'slash',
    'an explicit ability binding wins');
  assert.equal(effectIdFor(bindings, {element: 'fire', kind: 'magical'}), 'flare_fire', 'then element');
  assert.equal(effectIdFor(bindings, {kind: 'magical'}), 'flare_neutral', 'then kind');
  assert.equal(effectIdFor(bindings, {kind: 'physical'}), 'slash');
  assert.equal(effectIdFor(bindings, {element: 'neutral', kind: 'physical'}), 'slash',
    'neutral is not an element');
  assert.equal(effectIdFor({}, {kind: 'physical'}), null, 'no binding, no effect');
});

test('an impact spawns an effect on its target that outlives the beat', () => {
  const script = choreograph([
    ev('action_committed', {actorId: 'blademage', abilityId: 'attack'}),
    ev('damage', {actorId: 'blademage', targetId: 'tide_maw', abilityId: 'attack', amount: 90, hpAfter: 2220}),
  ], {maxHp: {tide_maw: 2310}});
  const impact = script.beats.find(b => b.kind === 'impact');

  const at = t => activeEffects(script, t, {library, durationMs: 260});
  assert.deepEqual(at(impact.at - 1), [], 'nothing before the hit');
  const onHit = at(impact.at);
  assert.equal(onHit.length, 1);
  assert.equal(onHit[0].id, 'slash');
  assert.equal(onHit[0].targetId, 'tide_maw');
  assert.equal(onHit[0].frame, 0);
  // The impact beat is only 90ms; the effect keeps playing past it.
  assert.ok(impact.duration < 260);
  assert.equal(at(impact.at + 200).length, 1, 'still playing after the beat ended');
  assert.deepEqual(at(impact.at + 260), [], 'finished');
});

test('effect frames advance monotonically and every frame is shown', () => {
  const script = choreograph([
    ev('damage', {actorId: 'a', targetId: 'b', abilityId: 'attack', amount: 10, hpAfter: 90}),
  ], {maxHp: {b: 100}});
  const impact = script.beats.find(b => b.kind === 'impact');
  const seen = new Set();
  let previous = -1;
  for (let t = impact.at; t < impact.at + 260; t += 2) {
    const effect = activeEffects(script, t, {library, durationMs: 260})[0];
    assert.ok(effect.frame >= previous, `frame went backwards at ${t}`);
    assert.ok(effect.frame < library.slash.frames, 'frame within the sheet');
    previous = effect.frame;
    seen.add(effect.frame);
  }
  assert.equal(seen.size, library.slash.frames, `only showed ${[...seen].join(',')}`);
});

test('an elemental ability picks its elemental effect', () => {
  const script = choreograph([
    ev('damage', {actorId: 'magus', targetId: 'boss', abilityId: 'fire', amount: 100, hpAfter: 900}),
  ], {maxHp: {boss: 1000}});
  const impact = script.beats.find(b => b.kind === 'impact');
  const effects = activeEffects(script, impact.at, {
    library, abilityInfo: {fire: {element: 'fire', kind: 'magical'}},
  });
  assert.equal(effects[0].id, 'flare_fire');
});

test('an unknown effect id is skipped rather than drawn as nothing', () => {
  const script = choreograph([
    ev('damage', {actorId: 'a', targetId: 'b', abilityId: 'mystery', amount: 10, hpAfter: 90}),
  ], {maxHp: {b: 100}});
  const impact = script.beats.find(b => b.kind === 'impact');
  // Binding points at an effect the library does not contain.
  const effects = activeEffects(script, impact.at, {
    library: {}, bindings: {physical: 'nonexistent'},
  });
  assert.deepEqual(effects, []);
});

test('multi-hit abilities spawn one effect per hit, staggered', () => {
  const events = [ev('action_committed', {actorId: 'blademage', abilityId: 'volley'})];
  for (let i = 0; i < 4; i++) {
    events.push(ev('damage', {actorId: 'blademage', targetId: 'boss', abilityId: 'volley',
      amount: 40, hpAfter: 1000 - 40 * (i + 1)}));
  }
  const script = choreograph(events, {maxHp: {boss: 1000}});
  const impacts = script.beats.filter(b => b.kind === 'impact');
  // At the last impact, earlier effects are still fading, so several overlap. Uses the
  // default duration on purpose: that default is paced with the rest of the game, and
  // hardcoding a number here would silently stop testing overlap the moment the pace
  // changed -- which is exactly what happened when it was fixed at 260ms.
  assert.ok(DEFAULT_EFFECT_MS > TIMING.multiHitStagger,
    'an effect must outlast the gap between hits, or a volley cannot read as one flurry');
  const overlapping = activeEffects(script, impacts[3].at, {library});
  assert.ok(overlapping.length > 1, 'overlapping hits overlap their effects');
  assert.ok(overlapping.every(e => e.id === 'slash'));
});

test('effect ordering is deterministic when hits overlap', () => {
  const script = choreograph([
    ev('damage', {actorId: 'a', targetId: 'zeta', abilityId: 'attack', amount: 10, hpAfter: 90}),
    ev('damage', {actorId: 'a', targetId: 'alpha', abilityId: 'attack', amount: 10, hpAfter: 90}),
  ], {maxHp: {zeta: 100, alpha: 100}});
  const t = script.beats.find(b => b.kind === 'impact').at + 50;
  const first = activeEffects(script, t, {library, durationMs: 260});
  assert.deepEqual(first, activeEffects(script, t, {library, durationMs: 260}));
  assert.deepEqual(first.map(e => e.targetId), [...first.map(e => e.targetId)].sort());
});

test('a behind-the-actors effect is flagged for the renderer', () => {
  const script = choreograph([
    ev('damage', {actorId: 'a', targetId: 'b', abilityId: 'attack', amount: 10, hpAfter: 90}),
  ], {maxHp: {b: 100}});
  const impact = script.beats.find(b => b.kind === 'impact').at;
  assert.equal(activeEffects(script, impact, {library})[0].behind, false);
  const behind = activeEffects(script, impact, {library: {slash: sheetOf({behind: true})}});
  assert.equal(behind[0].behind, true);
});

test('no script means no effects', () => {
  assert.deepEqual(activeEffects(null, 0, {library}), []);
  assert.deepEqual(activeEffects({totalMs: 0, beats: []}, 0, {library}), []);
});

test('an effect rect indexes the sheet horizontally', () => {
  assert.deepEqual(effectRect(library.slash, {id: 'slash', targetId: 'b', frame: 2, progress: 0.5, behind: false}),
    {x: 128, y: 0, width: 64, height: 48});
});

test('effect sheet validation rejects malformed manifests', () => {
  assert.equal(validateEffectSheet(sheetOf()).file, 'effects/slash.png');
  assert.throws(() => validateEffectSheet(null), /not an object/);
  assert.throws(() => validateEffectSheet(sheetOf({file: undefined})), /missing file/);
  assert.throws(() => validateEffectSheet(sheetOf({frames: 0})), /at least one frame/);
  assert.throws(() => validateEffectSheet(sheetOf({frameWidth: 0})), /frame size/);
  assert.throws(() => validateEffectSheet(sheetOf({anchorX: undefined})), /missing anchorX/);
  assert.throws(() => validateEffectSheet(sheetOf({anchorY: 999})), /anchorY outside/);
});

test('the effect manifest is complete and documented', () => {
  const effects = requiredEffects();
  assert.equal(new Set(effects.map(e => e.id)).size, effects.length, 'no duplicate ids');
  // Every id the default bindings can produce must be in the commissioning list.
  const declared = new Set(effects.map(e => e.id));
  const reachable = [
    DEFAULT_BINDINGS.physical, DEFAULT_BINDINGS.magical,
    ...Object.values(DEFAULT_BINDINGS.byElement ?? {}),
  ].filter(Boolean);
  for (const id of reachable) assert.ok(declared.has(id), `${id} is bindable but not in requiredEffects()`);
  for (const effect of effects) assert.ok(effect.purpose.length > 8, `${effect.id} needs a description`);
});
