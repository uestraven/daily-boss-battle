/** Audio cues derived from battle choreography.
 *
 * Renderer- and engine-agnostic: this maps presentation beats onto timed sound cues
 * and music transitions. It plays nothing itself, so it stays pure and testable, and
 * the same cue list drives a web client, a native client, or a mixing session.
 *
 * It also defines the sound manifest — `requiredSounds()` is the list to commission,
 * derived from the code that uses them rather than maintained by hand.
 */
import type {Beat, BeatScript} from './presentation.js';
import type {AbilityInfo} from './animation.js';
import {readsAsMagical} from './effects.js';

export type SoundId =
  | 'hit_physical'
  | 'hit_magical'
  | 'hit_heavy'      // reserved for hits above the heavy threshold
  | 'cast_start'
  | 'heal'
  | 'mp_restore'
  | 'ko'
  | 'revive'
  | 'status_on'
  | 'status_off'
  | 'telegraph'
  | 'interrupt'
  | 'nullify'
  | 'phase_sting'
  | 'text_blip'
  | 'victory_fanfare'
  | 'defeat_sting';

export type MusicTrack = 'battle_main' | 'battle_phase_two' | 'victory' | 'defeat' | 'silence';

export type AudioCue = {
  /** Milliseconds from the start of the batch, matching the beat timeline. */
  at: number;
  sound: SoundId;
  /** 0..1 playback gain. Heavier hits are louder. */
  gain: number;
};

export type MusicChange = {at: number; track: MusicTrack};

/** Playback shape for a music file.
 *
 * A JRPG theme is often an intro that plays once followed by a section that repeats.
 * Web Audio supports that directly via loopStart/loopEnd on a buffer source, in seconds,
 * which is sample-accurate — unlike the <audio> element, which can gap between
 * iterations. Omit the loop points to loop the whole file. */
export type TrackPlayback = {
  file: string;
  /** Seconds. Playback jumps back here at loopEnd. */
  loopStart?: number;
  /** Seconds. Defaults to the end of the buffer. */
  loopEnd?: number;
  /** 0..1 mix level relative to the sound effects. */
  gain?: number;
};

/** A hit at or above this fraction of a health bar uses the heavy variant. */
export const HEAVY_HIT_INTENSITY = 0.55;
/** Silence either side of a phase sting, so the transition lands. */
export const PHASE_SILENCE_MS = 140;

export type AudioOptions = {
  /** Suppresses per-character text blips, which some players find grating. */
  textBlips?: boolean;
  /** Milliseconds between blips while a text beat types out. */
  blipIntervalMs?: number;
  /** Ability metadata, so an impact can tell a spell from a sword swing. Without it
   * every hit sounds physical, which is wrong for a caster. Accepts the full
   * `AbilityKind` so one table can serve both the mixer and clip selection. */
  abilityInfo?: AbilityInfo;
};

const gainFor = (intensity: number | undefined, floor = 0.45): number => {
  const i = intensity ?? 0.3;
  return Math.round(100 * Math.min(1, Math.max(floor, floor + (1 - floor) * i))) / 100;
};

/** Maps one beat onto its cue, or null when the beat is silent. */
function cueFor(beat: Beat, options: AudioOptions): AudioCue | null {
  switch (beat.kind) {
    case 'impact': {
      // Kind decides the family, weight decides the variant: a spell always sounds
      // magical, and a heavy *physical* hit gets the heavier sample. Intensity is
      // carried by the paired shake beat, which the caller merges in first.
      const intensity = beat.intensity ?? 0.3;
      const kind = beat.abilityId ? options.abilityInfo?.[beat.abilityId]?.kind : undefined;
      // Shared with the effects layer, so a hit that flares also sounds like a spell.
      const magical = readsAsMagical(kind) || beat.source === 'poison_pulse';
      // A critical always takes the heavy sample regardless of the shake it computed:
      // it is a louder event by definition, and the audio is the first cue the player
      // gets, landing with the impact rather than with the number half a second later.
      const sound: SoundId = magical ? 'hit_magical'
        : (beat.critical || intensity >= HEAVY_HIT_INTENSITY) ? 'hit_heavy' : 'hit_physical';
      return {at: beat.at, sound, gain: gainFor(intensity)};
    }
    case 'cast': return {at: beat.at, sound: 'cast_start', gain: 0.6};
    case 'heal_number': return {at: beat.at, sound: 'heal', gain: 0.65};
    case 'mp_change': return {at: beat.at, sound: 'mp_restore', gain: 0.6};
    case 'ko': return {at: beat.at, sound: 'ko', gain: 0.85};
    case 'revive': return {at: beat.at, sound: 'revive', gain: 0.75};
    case 'status_on': return {at: beat.at, sound: 'status_on', gain: 0.5};
    case 'status_off': return {at: beat.at, sound: 'status_off', gain: 0.45};
    case 'telegraph': return {at: beat.at, sound: 'telegraph', gain: 0.7};
    case 'phase': return {at: beat.at, sound: 'phase_sting', gain: 1};
    case 'victory': return {at: beat.at, sound: 'victory_fanfare', gain: 1};
    case 'defeat': return {at: beat.at, sound: 'defeat_sting', gain: 1};
    case 'message':
      if (beat.source === 'boss_interrupted') return {at: beat.at, sound: 'interrupt', gain: 0.8};
      if (beat.source === 'nullify_absorb') return {at: beat.at, sound: 'nullify', gain: 0.8};
      return null;
    default:
      return null;
  }
}

/** Timed sound cues for a choreographed batch, in play order. */
export function audioCues(script: BeatScript, options: AudioOptions = {}): AudioCue[] {
  // An impact's weight lives on its paired shake beat; fold it in so a cue can pick
  // the heavy variant without the renderer having to correlate beats itself.
  const merged = script.beats.map(beat => {
    if (beat.kind !== 'impact') return beat;
    const shake = script.beats.find(b => b.kind === 'shake'
      && b.targetId === beat.targetId && b.at >= beat.at && b.at <= beat.at + beat.duration + 1);
    return shake ? {...beat, intensity: shake.intensity} : beat;
  });

  const cues: AudioCue[] = [];
  for (const beat of merged) {
    const cue = cueFor(beat, options);
    if (cue) cues.push(cue);
  }

  if (options.textBlips) {
    const interval = options.blipIntervalMs ?? 55;
    for (const beat of script.beats) {
      if (!beat.text) continue;
      if (beat.kind !== 'message' && beat.kind !== 'telegraph' && beat.kind !== 'phase') continue;
      for (let offset = 0; offset < beat.duration; offset += interval) {
        cues.push({at: beat.at + offset, sound: 'text_blip', gain: 0.25});
      }
    }
  }

  return cues.sort((a, b) => a.at - b.at || (a.sound < b.sound ? -1 : 1));
}

/** Music transitions for a batch.
 *
 * A phase change cuts to silence, lets the sting breathe, then brings up the
 * phase-two theme — the moment a 16-bit boss fight earns its reputation. */
export function musicChanges(script: BeatScript, current: MusicTrack = 'battle_main'): MusicChange[] {
  const changes: MusicChange[] = [];
  let track = current;
  const set = (at: number, next: MusicTrack) => {
    if (next === track) return;
    changes.push({at: Math.max(0, at), track: next});
    track = next;
  };
  for (const beat of script.beats) {
    if (beat.kind === 'phase') {
      set(beat.at - PHASE_SILENCE_MS, 'silence');
      set(beat.at + beat.duration, 'battle_phase_two');
    } else if (beat.kind === 'victory') {
      set(beat.at, 'victory');
    } else if (beat.kind === 'defeat') {
      set(beat.at, 'defeat');
    }
  }
  return changes;
}

/** The sound manifest: every cue this module can emit, with what it is for.
 * This is the commissioning list, derived from the code rather than hand-kept. */
export function requiredSounds(): {id: SoundId; purpose: string}[] {
  return [
    {id: 'hit_physical', purpose: 'Standard weapon or fist connecting'},
    {id: 'hit_magical', purpose: 'Elemental or non-physical damage'},
    {id: 'hit_heavy', purpose: `Hits at or above ${Math.round(HEAVY_HIT_INTENSITY * 100)}% shake intensity`},
    {id: 'cast_start', purpose: 'Channelled ability winding up'},
    {id: 'heal', purpose: 'Restorative magic or item'},
    {id: 'mp_restore', purpose: 'Mana restored'},
    {id: 'ko', purpose: 'An actor collapses'},
    {id: 'revive', purpose: 'An actor is brought back'},
    {id: 'status_on', purpose: 'Buff or debuff applied'},
    {id: 'status_off', purpose: 'Status expires or is removed'},
    {id: 'telegraph', purpose: 'Boss announces its next action'},
    {id: 'interrupt', purpose: 'A committed boss cast is cancelled'},
    {id: 'nullify', purpose: 'A spell is absorbed'},
    {id: 'phase_sting', purpose: 'Boss phase transition; music cuts around it'},
    {id: 'text_blip', purpose: 'Per-character typing blip, opt-in'},
    {id: 'victory_fanfare', purpose: 'Battle won'},
    {id: 'defeat_sting', purpose: 'Battle lost'},
  ];
}

/** Default playback for each track. Loop points are filled in once the real files exist;
 * with none set, the whole file loops. */
export const TRACK_PLAYBACK: Record<Exclude<MusicTrack, 'silence'>, TrackPlayback> = {
  battle_main: {file: 'battle_theme.ogg', gain: 0.7},
  // Named for the pair it belongs to rather than the track id, matching battle_theme.ogg.
  battle_phase_two: {file: 'battle_theme_phase_2.ogg', gain: 0.75},
  victory: {file: 'victory.ogg', gain: 0.8},
  defeat: {file: 'defeat.ogg', gain: 0.7},
};

/** What to play when a track's own file does not exist yet.
 *
 * This has to be per-track, not one global fallback. Substituting the main theme for
 * phase two keeps the fight scored, which is what you want mid-battle. Substituting it
 * for victory or defeat restarts the combat loop over a finished battle, which is worse
 * than silence — so those fall silent until their own music exists. */
export const TRACK_FALLBACK: Record<Exclude<MusicTrack, 'silence'>, MusicTrack> = {
  battle_main: 'silence',
  battle_phase_two: 'battle_main',
  victory: 'silence',
  defeat: 'silence',
};

/** The music manifest. */
export function requiredTracks(): {id: MusicTrack; purpose: string}[] {
  return [
    {id: 'battle_main', purpose: 'Phase one battle theme; loops'},
    {id: 'battle_phase_two', purpose: 'Phase two battle theme; loops, more urgent'},
    {id: 'victory', purpose: 'Victory theme'},
    {id: 'defeat', purpose: 'Defeat theme'},
    {id: 'silence', purpose: 'Not a file: an explicit stop used around stings'},
  ];
}
