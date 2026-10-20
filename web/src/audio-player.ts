/** Web Audio playback for music and sound cues.
 *
 * All timing decisions live in `src/audio.ts`, which is pure and tested; this only loads
 * buffers and plays them. Three browser realities shape it:
 *
 *  - **Autoplay is blocked** until a user gesture, so the context is created lazily on
 *    the first interaction rather than at load.
 *  - **Looping must use Web Audio**, not the audio element: an AudioBufferSourceNode with
 *    `loop = true` is sample-accurate, where `<audio loop>` can gap audibly.
 *  - **Assets may not exist yet.** A missing file is normal during production, so a failed
 *    load falls back to the main theme for music and silently no-ops for a cue.
 */
import {TRACK_FALLBACK, TRACK_PLAYBACK} from '../../dist/src/audio.js';
import type {AudioCue, MusicTrack, SoundId} from '../../src/audio.js';
import {mediaUrl} from './media-url.js';

const MUSIC_DIR = 'battle-music';
const SFX_DIR = 'battle-sounds';
const MUTE_KEY = 'daily-boss-battle.muted.v1';

/** Versioned, so a replaced track is a new URL. Without this the service worker serves
 * the previous build's bytes for the same filename, which is exactly what happened when
 * the victory theme was replaced: the new file shipped and the old one played. */
const musicUrl = (file: string): string => mediaUrl(MUSIC_DIR, file);
const soundUrl = (sound: string): string => mediaUrl(SFX_DIR, `${sound}.ogg`);

let context: AudioContext | null = null;
let musicGain: GainNode | null = null;
let effectGain: GainNode | null = null;
let currentTrack: MusicTrack = 'silence';
let currentSource: AudioBufferSourceNode | null = null;
let muted = readMuted();

const buffers = new Map<string, AudioBuffer | null>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

// Downloading is kept separate from decoding because only decoding needs an AudioContext,
// and the context cannot exist before a user gesture. Fusing the two meant the 1.2 MB
// theme did not even begin downloading until the moment it was supposed to start playing.
const bytes = new Map<string, ArrayBuffer | null>();
const bytesPending = new Map<string, Promise<ArrayBuffer | null>>();

function readMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

/** Creates the context. Must be called from a user gesture or it will start suspended. */
export function unlockAudio(): void {
  if (context) { void context.resume(); return; }
  const Ctor = window.AudioContext
    ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return;
  context = new Ctor();
  musicGain = context.createGain();
  effectGain = context.createGain();
  musicGain.gain.value = muted ? 0 : 1;
  effectGain.gain.value = muted ? 0 : 1;
  musicGain.connect(context.destination);
  effectGain.connect(context.destination);
}

export function isMuted(): boolean { return muted; }

export function setMuted(value: boolean): void {
  muted = value;
  try { window.localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* ignore */ }
  if (musicGain) musicGain.gain.value = value ? 0 : 1;
  if (effectGain) effectGain.gain.value = value ? 0 : 1;
}

/** Downloads a file, needing no AudioContext. Safe to call at page load. */
function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  if (bytes.has(url)) return Promise.resolve(bytes.get(url) ?? null);
  const existing = bytesPending.get(url);
  if (existing) return existing;
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.arrayBuffer();
      bytes.set(url, data);
      return data;
    } catch {
      // Expected while the soundtrack is incomplete; cached so it is attempted once.
      bytes.set(url, null);
      return null;
    } finally {
      bytesPending.delete(url);
    }
  })();
  bytesPending.set(url, task);
  return task;
}

/** Starts downloading the battle theme without playing it, so the bytes are already here
 * when the first gesture unlocks the context. Skipped when muted: nothing will be heard,
 * so spending a mobile visitor's data on it would be rude. */
export function prefetchMusic(): void {
  if (muted) return;
  const playback = TRACK_PLAYBACK.battle_main;
  if (playback) void fetchBytes(musicUrl(playback.file));
}

/** Starts downloading the phase-two theme, for when the fight gets there.
 *
 * Deliberately separate from prefetchMusic and called later. Each theme is over a
 * megabyte, so fetching both at page load would spend 2.4 MB of a visitor's data before
 * they have pressed anything. Fetching it only at the phase change is the other extreme
 * and the bug this avoids: the switch is exactly when the bytes are needed, so the
 * transition would land silent while it downloaded. Called once the battle is under way,
 * which gives it the whole of phase one to arrive. */
export function prefetchPhaseTwo(): void {
  if (muted) return;
  const playback = TRACK_PLAYBACK.battle_phase_two;
  if (playback) void fetchBytes(musicUrl(playback.file));
  // The result tracks too, for the same reason one step further on. They are needed the
  // instant a battle ends, and fetching them then makes the victory theme start a beat
  // after the victory screen. 191 KiB between them, against a fight that lasts minutes.
  // Music is only ever *late* in this situation, never dropped the way a cue is -- but
  // late on the one screen a player stops to read is still worth avoiding.
  for (const track of ['victory', 'defeat'] as const) {
    const outcome = TRACK_PLAYBACK[track];
    if (outcome) void fetchBytes(musicUrl(outcome.file));
  }
}

/** Gets every effect ready before its first use.
 *
 * Effects were loaded at the moment they were needed, and playCues drops a cue whose
 * scheduled time has already passed while its file was loading. So the *first* occurrence
 * of each sound raced its own download and usually lost: the heal cue sits 1500ms into a
 * potion's batch, and a potion is rare enough that the sound was never heard at all. The
 * hit cues at 750ms had the same race and were simply less noticeable, being followed by
 * dozens more that hit a warm cache.
 *
 * Called twice, which is the point. At page load there is no AudioContext yet -- it cannot
 * exist before a user gesture -- so only the bytes are fetched, which needs no context.
 * Called again from the gesture that unlocks audio, the bytes are already here and decode
 * straight away, so everything is a decoded buffer well before the first action resolves.
 *
 * The whole effect set is 146 KiB, two orders smaller than one music track, so there is no
 * reason to be selective. Sounds with no file yet cost one 404 each, cached as a null so
 * it is never retried; that number shrinks as the set is commissioned. */
export function prefetchSounds(sounds: readonly SoundId[]): void {
  if (muted) return;
  for (const sound of sounds) {
    const url = soundUrl(sound);
    // With a context, loadBuffer fetches *and* decodes. Without one, take the bytes now.
    if (context) void loadBuffer(url);
    else void fetchBytes(url);
  }
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (buffers.has(url)) return buffers.get(url) ?? null;
  // No context yet is a temporary state, not a verdict about the file, so return without
  // caching: recording a null here would silence the track for the rest of the session.
  if (!context) return null;
  const existing = pending.get(url);
  if (existing) return existing;
  const active = context;
  const task = (async () => {
    try {
      const data = await fetchBytes(url);
      // A genuinely absent file is cached as null, so it is attempted only once.
      if (!data) { buffers.set(url, null); return null; }
      // decodeAudioData takes ownership of the buffer it is given, so decode a copy and
      // leave the cached download intact for any later decode.
      const decoded = await active.decodeAudioData(data.slice(0));
      buffers.set(url, decoded);
      // The compressed copy is dead weight once decoded.
      bytes.delete(url);
      return decoded;
    } catch {
      // Undecodable is as good as absent, and equally permanent.
      buffers.set(url, null);
      return null;
    } finally {
      pending.delete(url);
    }
  })();
  pending.set(url, task);
  return task;
}

/** Switches the music. Idempotent: asking for the track already playing does nothing,
 * so a repeated timeline entry cannot restart the loop. */
export async function playMusic(track: MusicTrack): Promise<void> {
  if (!context || track === currentTrack) return;
  currentTrack = track;
  currentSource?.stop();
  currentSource = null;
  if (track === 'silence') return;

  // Walk the fallback chain until a file exists or it reaches silence. Substituting the
  // battle theme for a missing victory or defeat track would restart combat music over a
  // finished battle, so those chains end in silence instead.
  let candidate: MusicTrack = track;
  let buffer: AudioBuffer | null = null;
  const seen = new Set<MusicTrack>();
  while (candidate !== 'silence' && !seen.has(candidate)) {
    seen.add(candidate);
    const attempt = TRACK_PLAYBACK[candidate];
    buffer = attempt ? await loadBuffer(musicUrl(attempt.file)) : null;
    if (buffer) break;
    candidate = TRACK_FALLBACK[candidate] ?? 'silence';
  }
  // A later request may have superseded this one while files were loading.
  if (!buffer || candidate === 'silence' || currentTrack !== track) return;
  const playback = TRACK_PLAYBACK[candidate]!;

  const source = context.createBufferSource();
  source.buffer = buffer;
  // The battle themes loop; the victory and defeat pieces play once and stop. Loop points
  // only mean anything when looping, so they are only applied then.
  source.loop = playback.loop ?? true;
  if (source.loop) {
    if (playback.loopStart !== undefined) source.loopStart = playback.loopStart;
    if (playback.loopEnd !== undefined) source.loopEnd = playback.loopEnd;
  }
  const gain = context.createGain();
  gain.gain.value = playback.gain ?? 0.7;
  source.connect(gain);
  gain.connect(musicGain!);
  source.start();
  currentSource = source;
}

export function stopMusic(): void {
  currentSource?.stop();
  currentSource = null;
  currentTrack = 'silence';
}

/** Schedules one batch of cues relative to now. A cue whose file is missing is skipped. */
export function playCues(cues: readonly AudioCue[]): void {
  if (!context || muted || !cues.length) return;
  const startedAt = context.currentTime;
  for (const cue of cues) {
    void (async () => {
      const buffer = await loadBuffer(soundUrl(cue.sound));
      if (!buffer || !context) return;
      const when = startedAt + cue.at / 1000;
      // Already passed while the file was loading: skip rather than play out of sync.
      if (when < context.currentTime - 0.05) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = cue.gain;
      source.connect(gain);
      gain.connect(effectGain!);
      source.start(Math.max(when, context.currentTime));
    })();
  }
}

/** Which sound files are actually present. Useful for a production checklist. */
export async function probeAssets(sounds: readonly SoundId[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const [track, playback] of Object.entries(TRACK_PLAYBACK)) {
    result[`music/${track}`] = Boolean(await loadBuffer(musicUrl(playback.file)));
  }
  for (const sound of sounds) {
    result[`sfx/${sound}`] = Boolean(await loadBuffer(soundUrl(sound)));
  }
  return result;
}
