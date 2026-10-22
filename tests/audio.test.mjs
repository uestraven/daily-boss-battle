/** Audio cues derived from choreography. Asserts the contract a sound designer and a
 * renderer both depend on: which sound, when, how loud, and when the music changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {HEAVY_HIT_INTENSITY, PHASE_SILENCE_MS, TRACK_FALLBACK, TRACK_PLAYBACK, audioCues,
  musicChanges, requiredSounds, requiredTracks} from '../dist/src/audio.js';
import {TIMING, choreograph} from '../dist/src/presentation.js';
import {existsSync, readdirSync} from 'node:fs';
import {disclosureFor} from '../dist/src/disclosure.js';
import {CUE_DISCLOSURE} from '../dist/src/audio.js';

const musicDir = new URL('../web/public/battle-music/', import.meta.url);

const ev = (type, extra = {}) => ({tick: 1, type, ...extra});
const script = (events, opts = {}) => choreograph(events, opts);

test('a silent batch produces no cues', () => {
  assert.deepEqual(audioCues(script([])), []);
  assert.deepEqual(musicChanges(script([])), []);
});

test('a physical hit produces one hit cue at the moment of impact', () => {
  const s = script([
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 50, hpAfter: 950}),
  ], {maxHp: {boss: 1000}});
  const cues = audioCues(s);
  const hits = cues.filter(c => c.sound.startsWith('hit_'));
  assert.equal(hits.length, 1);
  const impact = s.beats.find(b => b.kind === 'impact');
  assert.equal(hits[0].at, impact.at, 'the hit sound lands with the impact, not the number');
});

test('a spell sounds magical and a sword sounds physical', () => {
  // Before ability kind was plumbed through, every hit played the physical sample, which
  // made a caster sound like a swordsman.
  const abilityInfo = {attack: {kind: 'physical'}, fire: {kind: 'magical'}};
  const hitSound = (abilityId, amount) => {
    const script = choreograph(
      [ev('damage', {actorId: 'a', targetId: 'b', abilityId, amount, hpAfter: 1000 - amount})],
      {maxHp: {b: 1000}});
    return audioCues(script, {abilityInfo}).find(c => c.sound.startsWith('hit_')).sound;
  };
  assert.equal(hitSound('attack', 60), 'hit_physical');
  assert.equal(hitSound('fire', 60), 'hit_magical');
  // Kind decides the family; weight only upgrades a physical hit.
  assert.equal(hitSound('attack', 800), 'hit_heavy');
  assert.equal(hitSound('fire', 800), 'hit_magical', 'a heavy spell is still a spell');
  // With no ability info the mapping degrades to physical rather than failing.
  const script = choreograph([ev('damage', {actorId: 'a', targetId: 'b', abilityId: 'fire',
    amount: 60, hpAfter: 940})], {maxHp: {b: 1000}});
  assert.equal(audioCues(script).find(c => c.sound.startsWith('hit_')).sound, 'hit_physical');
});

test('poison damage is audible and flashes, like any other damage', () => {
  const script = choreograph([ev('poison_pulse', {actorId: 'b', amount: 20, hpAfter: 980})],
    {maxHp: {b: 1000}});
  assert.ok(script.beats.some(b => b.kind === 'impact' && b.targetId === 'b'), 'it impacts');
  assert.ok(script.beats.some(b => b.kind === 'hurt' && b.targetId === 'b'), 'the target reacts');
  const cue = audioCues(script).find(c => c.sound.startsWith('hit_'));
  assert.ok(cue, 'poison makes a sound');
  assert.equal(cue.sound, 'hit_magical', 'poison is not a sword hit');
});

test('a heavy hit uses the heavy variant and is louder', () => {
  const light = audioCues(script([ev('damage', {actorId: 'b', targetId: 'm', amount: 5, hpAfter: 995})],
    {maxHp: {m: 1000}})).find(c => c.sound.startsWith('hit_'));
  const heavy = audioCues(script([ev('damage', {actorId: 'b', targetId: 'm', amount: 900, hpAfter: 100})],
    {maxHp: {m: 1000}})).find(c => c.sound.startsWith('hit_'));
  assert.equal(light.sound, 'hit_physical');
  assert.equal(heavy.sound, 'hit_heavy');
  assert.ok(heavy.gain > light.gain, 'heavier hits are louder');
  for (const cue of [light, heavy]) {
    assert.ok(cue.gain > 0 && cue.gain <= 1, `gain out of range: ${cue.gain}`);
  }
});

test('the heavy threshold is the documented one', () => {
  // Just under and just over the boundary must differ.
  const atIntensity = fraction => {
    const maxHp = 1000;
    const amount = Math.round(fraction * maxHp);
    return audioCues(script([ev('damage', {actorId: 'b', targetId: 'm', amount, hpAfter: maxHp - amount})],
      {maxHp: {m: maxHp}})).find(c => c.sound.startsWith('hit_'));
  };
  // Shake intensity is a cube-root curve, so pick clearly-separated fractions.
  assert.equal(atIntensity(0.01).sound, 'hit_physical');
  assert.equal(atIntensity(0.9).sound, 'hit_heavy');
  assert.ok(HEAVY_HIT_INTENSITY > 0 && HEAVY_HIT_INTENSITY < 1);
});

test('multi-hit abilities produce one cue per hit, in order', () => {
  const events = [ev('action_committed', {actorId: 'blademage', abilityId: 'volley'})];
  for (let i = 0; i < 4; i++) {
    events.push(ev('damage', {actorId: 'blademage', targetId: 'boss', amount: 40, hpAfter: 1000 - 40 * (i + 1)}));
  }
  const cues = audioCues(script(events, {maxHp: {boss: 1000}})).filter(c => c.sound.startsWith('hit_'));
  assert.equal(cues.length, 4);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].at > cues[i - 1].at, 'cues are distinct in time');
});

test('healing, KO, revive, status and telegraph each map to their own cue', () => {
  const cases = [
    [ev('heal', {actorId: 'o', targetId: 'm', amount: 50, hpAfter: 300}), 'heal'],
    [ev('mp_restored', {actorId: 'o', targetId: 'm', amount: 10}), 'mp_restore'],
    [ev('ko', {actorId: 'm'}), 'ko'],
    [ev('revived', {actorId: 'o', targetId: 'm'}), 'revive'],
    [ev('status_applied', {actorId: 'm', details: 'protect'}), 'status_on'],
    [ev('status_expired', {actorId: 'm', details: 'protect'}), 'status_off'],
    [ev('boss_intent', {actorId: 'b', abilityId: 'x'}), 'telegraph'],
    [ev('channel_started', {actorId: 'b', abilityId: 'x'}), 'cast_start'],
    [ev('boss_interrupted', {actorId: 'v', targetId: 'b'}), 'interrupt'],
    [ev('nullify_absorb', {actorId: 'n', amount: 8}), 'nullify'],
  ];
  for (const [event, expected] of cases) {
    const cues = audioCues(script([event], {maxHp: {m: 360}}));
    assert.ok(cues.some(c => c.sound === expected), `${event.type} should cue ${expected}`);
  }
});

test('bookkeeping events stay silent', () => {
  const cues = audioCues(script([
    ev('ready', {actorId: 'm'}),
    ev('momentum', {actorId: 'b', amount: 1}),
    ev('channel_resolved', {actorId: 'b', abilityId: 'x'}),
  ]));
  assert.deepEqual(cues, []);
});

test('text blips are opt-in and bounded by the text duration', () => {
  const s = script([ev('boss_intent', {actorId: 'b', abilityId: 'x'})],
    {names: {b: 'The Clockwork Emperor'}, abilityNames: {x: 'Piston Strike'}});
  assert.ok(!audioCues(s).some(c => c.sound === 'text_blip'), 'off by default');
  const blips = audioCues(s, {textBlips: true}).filter(c => c.sound === 'text_blip');
  assert.ok(blips.length > 1, 'typing produces repeated blips');
  const telegraph = s.beats.find(b => b.kind === 'telegraph');
  for (const blip of blips) {
    assert.ok(blip.at >= telegraph.at && blip.at < telegraph.at + telegraph.duration,
      'blips stay inside the text beat');
  }
  assert.ok(blips.every(b => b.gain < 0.4), 'blips sit under the mix');
});

test('cues are sorted and deterministic', () => {
  const events = [
    ev('action_committed', {actorId: 'monk', abilityId: 'attack'}),
    ev('damage', {actorId: 'monk', targetId: 'boss', amount: 300, hpAfter: 700}),
    ev('phase_change', {actorId: 'boss'}),
    ev('ko', {actorId: 'monk'}),
  ];
  const first = audioCues(script(events, {maxHp: {boss: 1000, monk: 360}}));
  const second = audioCues(script(events, {maxHp: {boss: 1000, monk: 360}}));
  assert.deepEqual(first, second);
  for (let i = 1; i < first.length; i++) assert.ok(first[i].at >= first[i - 1].at);
});

test('a phase change cuts the music, stings, then brings up phase two', () => {
  const s = script([
    ev('damage', {actorId: 'm', targetId: 'b', amount: 100, hpAfter: 500}),
    ev('phase_change', {actorId: 'b'}),
  ], {maxHp: {b: 1000}, names: {b: 'Tide Maw'}});

  const sting = audioCues(s).find(c => c.sound === 'phase_sting');
  assert.ok(sting, 'the transition has a sting');
  assert.equal(sting.gain, 1, 'at full volume');

  const changes = musicChanges(s);
  assert.equal(changes.length, 2, 'silence then phase two');
  assert.equal(changes[0].track, 'silence');
  assert.equal(changes[1].track, 'battle_phase_two');
  const phase = s.beats.find(b => b.kind === 'phase');
  assert.equal(changes[0].at, phase.at - PHASE_SILENCE_MS, 'music drops just before the sting');
  assert.ok(changes[1].at >= phase.at + phase.duration, 'phase two waits for the hold to finish');
});

test('victory and defeat switch the music once', () => {
  const win = musicChanges(script([ev('victory')]));
  assert.deepEqual(win, [{at: win[0].at, track: 'victory'}]);
  const loss = musicChanges(script([ev('defeat')]));
  assert.equal(loss[0].track, 'defeat');
  // Already on a track means no redundant change.
  assert.deepEqual(musicChanges(script([ev('victory')]), 'victory'), []);
});

test('music changes never repeat the current track', () => {
  const s = script([ev('phase_change', {actorId: 'b'}), ev('phase_change', {actorId: 'b'})]);
  const changes = musicChanges(s);
  for (let i = 1; i < changes.length; i++) {
    assert.notEqual(changes[i].track, changes[i - 1].track, 'consecutive changes must differ');
  }
});

test('the manifests are complete, unique, and documented', () => {
  const sounds = requiredSounds();
  assert.ok(sounds.length >= 15, 'the SFX list is the commissioning list');
  assert.equal(new Set(sounds.map(s => s.id)).size, sounds.length, 'no duplicate ids');
  for (const entry of sounds) {
    assert.ok(entry.purpose.length > 8, `${entry.id} needs a usable description`);
  }
  const tracks = requiredTracks();
  assert.ok(tracks.some(t => t.id === 'battle_main') && tracks.some(t => t.id === 'battle_phase_two'));
  assert.equal(new Set(tracks.map(t => t.id)).size, tracks.length);
});

test('every sound the mapper can emit is declared in the manifest', () => {
  // Drive a broad set of events and confirm no cue escapes the manifest.
  const declared = new Set(requiredSounds().map(s => s.id));
  const events = [
    ev('action_committed', {actorId: 'm', abilityId: 'attack'}),
    ev('damage', {actorId: 'm', targetId: 'b', amount: 900, hpAfter: 100}),
    ev('damage', {actorId: 'm', targetId: 'b', amount: 5, hpAfter: 95}),
    ev('heal', {actorId: 'o', targetId: 'm', amount: 20, hpAfter: 300}),
    ev('mp_restored', {actorId: 'o', targetId: 'm', amount: 8}),
    ev('channel_started', {actorId: 'b', abilityId: 'x'}),
    ev('status_applied', {actorId: 'm', details: 'protect'}),
    ev('status_expired', {actorId: 'm', details: 'protect'}),
    ev('boss_intent', {actorId: 'b', abilityId: 'x'}),
    ev('boss_interrupted', {actorId: 'v', targetId: 'b'}),
    ev('nullify_absorb', {actorId: 'n', amount: 8}),
    ev('poison_pulse', {actorId: 'm', amount: 10, hpAfter: 290}),
    ev('phase_change', {actorId: 'b'}),
    ev('ko', {actorId: 'm'}),
    ev('revived', {actorId: 'o', targetId: 'm'}),
    ev('victory'),
    ev('defeat'),
  ];
  const cues = audioCues(script(events, {maxHp: {b: 1000, m: 360}}), {textBlips: true});
  assert.ok(cues.length > 10);
  for (const cue of cues) {
    assert.ok(declared.has(cue.sound), `${cue.sound} is emitted but not in requiredSounds()`);
  }
});

test('a missing victory or defeat track falls silent, not back to battle music', () => {
  // The blanket fallback restarted the combat loop over a finished battle: on defeat the
  // battle theme simply kept playing, which is worse than no music at all.
  assert.equal(TRACK_FALLBACK.victory, 'silence');
  assert.equal(TRACK_FALLBACK.defeat, 'silence');
  // Mid-fight is the opposite: keeping the fight scored beats a silent phase two.
  assert.equal(TRACK_FALLBACK.battle_phase_two, 'battle_main');
  assert.equal(TRACK_FALLBACK.battle_main, 'silence', 'nothing to substitute for the main theme');
});

test('every fallback chain terminates', () => {
  for (const start of Object.keys(TRACK_FALLBACK)) {
    const seen = new Set();
    let track = start;
    while (track !== 'silence') {
      assert.ok(!seen.has(track), `fallback cycle through ${track}`);
      seen.add(track);
      assert.ok(track in TRACK_FALLBACK || track === 'silence', `${track} has no fallback`);
      track = TRACK_FALLBACK[track];
      assert.ok(seen.size <= Object.keys(TRACK_FALLBACK).length + 1, 'chain too long');
    }
  }
});

test('every declared track has playback settings and a fallback', () => {
  for (const track of Object.keys(TRACK_PLAYBACK)) {
    assert.ok(TRACK_FALLBACK[track] !== undefined, `${track} has no declared fallback`);
    assert.ok(TRACK_PLAYBACK[track].file.endsWith('.ogg'), `${track} should be an ogg`);
  }
  // And the manifest agrees with both.
  for (const entry of requiredTracks().filter(t => t.id !== 'silence')) {
    assert.ok(TRACK_PLAYBACK[entry.id], `${entry.id} is in the manifest but has no playback`);
  }
});

test('a lost battle asks for defeat music, having first gone quiet', () => {
  const script = choreograph([
    ev('damage', {actorId: 'boss', targetId: 'warden', abilityId: 'attack', amount: 400, hpAfter: 0}),
    ev('ko', {actorId: 'warden'}),
    ev('defeat'),
  ], {maxHp: {warden: 400}});
  const changes = musicChanges(script, 'battle_main');
  assert.equal(changes.at(-1).track, 'defeat', 'the last change is to defeat music');
  // Which, with no defeat.ogg present, resolves to silence rather than the battle theme.
  assert.equal(TRACK_FALLBACK.defeat, 'silence');
});

test('the phase-two theme is a real track now, not a fallback', () => {
  // It used to resolve to the main theme, so a phase change kept the same music playing.
  // With its own file the transition actually transitions.
  assert.equal(TRACK_PLAYBACK.battle_phase_two.file, 'battle_theme_phase_2.ogg');
  assert.notEqual(TRACK_PLAYBACK.battle_phase_two.file, TRACK_PLAYBACK.battle_main.file,
    'phase two must not point at the main theme');
  // The fallback stays as it is: if the file ever goes missing, keeping the fight scored
  // beats a silent phase two.
  assert.equal(TRACK_FALLBACK.battle_phase_two, 'battle_main');
});

test('every declared music file exists on disk', () => {
  // A track pointing at a filename nobody produced silently falls back, which is exactly
  // how the phase-two theme sat unused after it had been added.
  const present = new Set(existsSync(musicDir) ? readdirSync(musicDir) : []);
  const missing = [];
  for (const [id, playback] of Object.entries(TRACK_PLAYBACK)) {
    if (!present.has(playback.file)) missing.push(`${id} -> ${playback.file}`);
  }
  // victory.ogg and defeat.ogg are known gaps, declared and not yet produced. The point
  // of this test is that a *present* file is never left unreferenced by a typo.
  const orphans = [...present].filter(file =>
    file.endsWith('.ogg') && !Object.values(TRACK_PLAYBACK).some(p => p.file === file));
  assert.deepEqual(orphans, [],
    `music on disk that no track references: ${orphans.join(', ')}`);
  assert.ok(missing.length <= 2, `too many missing tracks: ${missing.join(', ')}`);
});

test('victory and defeat are scored once; the battle themes loop', () => {
  // A 3.8s result piece on a loop plays over and over while the player reads their stars
  // and shares their card. The battle themes are beds and must loop; these are not.
  assert.equal(TRACK_PLAYBACK.victory.loop, false);
  assert.equal(TRACK_PLAYBACK.defeat.loop, false);
  for (const track of ['battle_main', 'battle_phase_two']) {
    assert.notEqual(TRACK_PLAYBACK[track].loop, false, `${track} must keep looping`);
  }
});

test('winning and losing emit no sound cue, only a music change', () => {
  // They used to emit a sting as well -- and the sting file was a byte-identical copy of
  // the music file, fired on the same beat, so one clip played twice at once at two
  // different gains. Removing the cue is what makes the new tracks play cleanly.
  for (const [kind, hold] of [['victory', 'victoryHold'], ['defeat', 'defeatHold']]) {
    const script = {beats: [{at: 0, duration: TIMING[hold], kind, text: kind}], totalMs: 3000};
    assert.deepEqual(audioCues(script), [], `${kind} should emit no cue`);
    const changes = musicChanges(script);
    assert.deepEqual(changes.map(c => c.track), [kind],
      `${kind} should switch the music to its own track`);
  }
});

test('the sound manifest no longer commissions the result stings', () => {
  const ids = requiredSounds().map(s => s.id);
  assert.ok(!ids.includes('victory_fanfare'), 'victory_fanfare is the music track now');
  assert.ok(!ids.includes('defeat_sting'), 'defeat_sting is the music track now');
  // phase_sting stays: it punctuates a transition the music plays through.
  assert.ok(ids.includes('phase_sting'));
});

// --- disclosure ------------------------------------------------------------------------
//
// Audio is a disclosure channel. It was not treated as one: Normal mode hides the boss's
// announced action and every status badge, then played a telegraph sting at 0.7 and a
// status chime anyway, so a player could hear the boss commit and count ticks off it.
// These lock the fix, and `every disclosing cue is covered` is the one that matters --
// it fails when a new sound starts leaking rather than when this file goes stale.

const disclosingEvents = [
  ev('boss_intent', {actorId: 'b', abilityId: 'cleave'}),
  ev('status_applied', {actorId: 'm', status: 'poison', details: 'poison; expires at 9'}),
  ev('status_expired', {actorId: 'm', status: 'poison', details: 'poison'}),
];

test('Normal mode hears no telegraph, because the telegraph is a prediction', () => {
  const s = script(disclosingEvents);
  const normal = audioCues(s, {disclosure: disclosureFor('normal')}).map(c => c.sound);
  assert.ok(!normal.includes('telegraph'),
    'the sting announced that the boss had committed to something, which is the exact '
    + 'information Normal exists to withhold');
});

test('Normal mode still hears a status land, because that is a result', () => {
  // These were silenced along with the telegraph, keyed on the badge field. The effect was
  // that a boss could buff itself in Normal with no popup, no chime and no telegraph, and
  // the player's damage fell by a quarter with nothing to attribute it to -- the only
  // outcome in the game with no feedback at all.
  const s = script(disclosingEvents);
  const normal = audioCues(s, {disclosure: disclosureFor('normal')}).map(c => c.sound);
  for (const sound of ['status_on', 'status_off']) {
    assert.ok(normal.includes(sound), `${sound} must still be audible in Normal`);
  }
});

test('Easy mode hears all three, since it shows all three', () => {
  const s = script(disclosingEvents);
  const easy = audioCues(s, {disclosure: disclosureFor('easy')}).map(c => c.sound);
  for (const sound of ['telegraph', 'status_on', 'status_off']) {
    assert.ok(easy.includes(sound), `${sound} should play when the screen shows it`);
  }
});

test('omitting disclosure plays everything, for the authoring tools', () => {
  const s = script(disclosingEvents);
  const all = audioCues(s).map(c => c.sound);
  assert.ok(all.includes('telegraph') && all.includes('status_on') && all.includes('status_off'));
});

test('text blips do not type out a line the mode never prints', () => {
  // A blip per character announces both that a hidden line exists and how long it is.
  const s = script([ev('boss_intent', {actorId: 'b', abilityId: 'cleave'})]);
  const normal = audioCues(s, {disclosure: disclosureFor('normal'), textBlips: true});
  assert.equal(normal.filter(c => c.sound === 'text_blip').length, 0);
  const easy = audioCues(s, {disclosure: disclosureFor('easy'), textBlips: true});
  assert.ok(easy.filter(c => c.sound === 'text_blip').length > 0, 'Easy still types it');
});

test('every disclosing cue is covered by the disclosure table', () => {
  // The guard against the original bug recurring. Any beat kind that produces a cue is
  // compared between the two modes: a cue audible in both is acceptable only if somebody
  // decided it should be -- either by listing it as mode-blind here, or by giving it a
  // CUE_DISCLOSURE entry, which forces a per-mode position in disclosure.ts. A new
  // disclosing sound with no decision recorded anywhere fails.
  const decided = new Set(Object.values(CUE_DISCLOSURE));
  const modeBlind = new Set(['hit_physical', 'hit_magical', 'hit_heavy', 'heal', 'ko',
    'revive', 'mp_restore', 'cast_start', 'interrupt', 'nullify', 'phase_sting',
    // Audible in both modes by an explicit decision, recorded on `statusEvents`.
    ...(decided.has('statusEvents') ? ['status_on', 'status_off'] : [])]);
  const events = [
    ...disclosingEvents,
    ev('damage', {actorId: 'b', targetId: 'm', amount: 10, hpAfter: 100}),
    ev('heal', {actorId: 'm', targetId: 'm', amount: 10, hpAfter: 110}),
    ev('ko', {actorId: 'm'}),
    ev('revived', {actorId: 'm', targetId: 'm'}),
    ev('phase_change', {actorId: 'b', details: 'Phase 2'}),
  ];
  const s = script(events, {maxHp: {m: 360, b: 1000}});
  const heard = mode => new Set(audioCues(s, {disclosure: disclosureFor(mode)}).map(c => c.sound));
  const easy = heard('easy');
  const normal = heard('normal');
  for (const sound of easy) {
    if (!normal.has(sound)) continue;            // correctly gated
    assert.ok(modeBlind.has(sound),
      `${sound} plays in both modes: either add it to CUE_DISCLOSURE or declare it safe here`);
  }
});
