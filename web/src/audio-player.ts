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

const MUSIC_DIR = 'battle-music';
const SFX_DIR = 'battle-sounds';
const MUTE_KEY = 'daily-boss-battle.muted.v1';

const base = (): string => import.meta.env.BASE_URL.replace(/\/?$/, '/');

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

/** Starts downloading audio without playing it, so the bytes are already here when the
 * first gesture unlocks the context. Skipped when muted: nothing will be heard, so
 * spending a mobile visitor's data on it would be rude. */
export function prefetchMusic(): void {
  if (muted) return;
  const playback = TRACK_PLAYBACK.battle_main;
  if (playback) void fetchBytes(`${base()}${MUSIC_DIR}/${playback.file}`);
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
    buffer = attempt ? await loadBuffer(`${base()}${MUSIC_DIR}/${attempt.file}`) : null;
    if (buffer) break;
    candidate = TRACK_FALLBACK[candidate] ?? 'silence';
  }
  // A later request may have superseded this one while files were loading.
  if (!buffer || candidate === 'silence' || currentTrack !== track) return;
  const playback = TRACK_PLAYBACK[candidate]!;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  if (playback.loopStart !== undefined) source.loopStart = playback.loopStart;
  if (playback.loopEnd !== undefined) source.loopEnd = playback.loopEnd;
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
      const buffer = await loadBuffer(`${base()}${SFX_DIR}/${cue.sound}.ogg`);
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
    result[`music/${track}`] = Boolean(await loadBuffer(`${base()}${MUSIC_DIR}/${playback.file}`));
  }
  for (const sound of sounds) {
    result[`sfx/${sound}`] = Boolean(await loadBuffer(`${base()}${SFX_DIR}/${sound}.ogg`));
  }
  return result;
}
