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
import {FALLBACK_TRACK, TRACK_PLAYBACK} from '../../dist/src/audio.js';
import type {AudioCue, MusicTrack, SoundId} from '../../src/audio.js';

const MUSIC_DIR = 'battle-music';
const SFX_DIR = 'battle-sfx';
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

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (buffers.has(url)) return buffers.get(url) ?? null;
  const existing = pending.get(url);
  if (existing) return existing;
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const bytes = await response.arrayBuffer();
      const decoded = await context!.decodeAudioData(bytes);
      buffers.set(url, decoded);
      return decoded;
    } catch {
      // Expected while the soundtrack is incomplete; cached so it is attempted once.
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

  const playback = TRACK_PLAYBACK[track] ?? TRACK_PLAYBACK[FALLBACK_TRACK];
  let buffer = await loadBuffer(`${base()}${MUSIC_DIR}/${playback.file}`);
  if (!buffer && track !== FALLBACK_TRACK) {
    // Not written yet: keep the main theme going rather than dropping to silence.
    buffer = await loadBuffer(`${base()}${MUSIC_DIR}/${TRACK_PLAYBACK[FALLBACK_TRACK].file}`);
  }
  if (!buffer || currentTrack !== track) return;

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
