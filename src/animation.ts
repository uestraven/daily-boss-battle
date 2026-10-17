/** Sprite animation: which animation each actor is playing, and which frame of it.
 *
 * Derived from the choreography beats, so animation is automatically in sync with the
 * damage numbers, shake and health drain — there is no second timeline to keep aligned.
 * Pure and renderer-agnostic like the rest of the presentation layer, so frame selection
 * is unit-tested rather than eyeballed.
 *
 * Animations are **stretched to fit their beat** by default. The artist picks a frame
 * count that reads well and the engine fits it to however long the beat actually runs,
 * which means an attack animation can never finish early or overrun the hit it belongs
 * to. Looping animations (idle) use their own frame duration instead.
 */
import type {ActorId, BattleState} from './types.js';
import type {Beat, BeatScript} from './presentation.js';
import {beatsAt} from './presentation.js';

/** The animation set every combatant sheet must provide. */
export type AnimationName =
  | 'idle'      // looping; the default
  | 'attack'    // stepping in and striking
  | 'cast'      // channelled or magical wind-up
  | 'hurt'      // taking a hit
  | 'ko'        // collapsing, then staying down on its last frame
  | 'victory';  // looping; winners only

export const ANIMATION_NAMES: AnimationName[] = ['idle', 'attack', 'cast', 'hurt', 'ko', 'victory'];

export type AnimationClip = {
  /** Row index in the sheet, top to bottom. */
  row: number;
  /** Frames in this row, left to right. */
  frames: number;
  /** Looping clips repeat forever; non-looping clips hold their final frame. */
  loop: boolean;
  /** Milliseconds per frame, used only by looping clips. */
  frameMs?: number;
};

export type SpriteSheet = {
  file: string;
  frameWidth: number;
  frameHeight: number;
  /** Horizontal centre of the figure within a frame. */
  anchorX: number;
  /** The figure's feet within a frame, so sprites of different heights share a ground line. */
  anchorY: number;
  clips: Partial<Record<AnimationName, AnimationClip>>;
};

/** Default cadence for looping clips when a sheet does not state one. */
export const DEFAULT_LOOP_FRAME_MS = 180;

export type ActorAnimation = {
  name: AnimationName;
  /** Zero-based frame within the clip. */
  frame: number;
  /** 0..1 through the current clip; useful for blending or effect timing. */
  progress: number;
};

/** The highest-priority beat currently driving this actor, if any. */
function drivingBeat(actorId: ActorId, active: Beat[]): {beat: Beat; name: AnimationName} | null {
  // Priority matters: being knocked out outranks being hit, which outranks acting.
  const ko = active.find(b => b.kind === 'ko' && b.actorId === actorId);
  if (ko) return {beat: ko, name: 'ko'};

  // The dedicated reaction beat, not the impact: the flash is brief by design, and a
  // recoil bound to it was too short to see.
  const hurt = active.find(b => b.kind === 'hurt' && b.targetId === actorId);
  if (hurt) return {beat: hurt, name: 'hurt'};

  const cast = active.find(b => b.kind === 'cast' && b.actorId === actorId);
  if (cast) return {beat: cast, name: 'cast'};

  const step = active.find(b => b.kind === 'actor_step' && b.actorId === actorId);
  if (step) return {beat: step, name: 'attack'};

  // An actor whose hit is landing is mid-attack even after its step beat ended.
  const striking = active.find(b => b.kind === 'impact' && b.actorId === actorId);
  if (striking) return {beat: striking, name: 'attack'};

  return null;
}

/** Frame within a clip, given how far through it we are. */
export function frameFor(clip: AnimationClip, elapsedMs: number, beatDurationMs: number | null): ActorAnimation['frame'] {
  if (clip.frames <= 1) return 0;
  if (clip.loop || beatDurationMs === null) {
    const frameMs = clip.frameMs ?? DEFAULT_LOOP_FRAME_MS;
    return Math.floor(Math.max(0, elapsedMs) / frameMs) % clip.frames;
  }
  // Stretched to fit: the clip spans exactly the beat it belongs to.
  const span = Math.max(1, beatDurationMs);
  const progress = Math.min(1, Math.max(0, elapsedMs / span));
  return Math.min(clip.frames - 1, Math.floor(progress * clip.frames));
}

/** Resolves the animation for one actor at a playback position.
 *
 * `fallbackDown` lets the caller say "this actor is already down" for an actor that died
 * in an earlier batch, so it holds its KO pose rather than idling. */
export function animationFor(
  actorId: ActorId,
  options: {
    script: BeatScript | null;
    timeMs: number;
    sheet?: SpriteSheet;
    down?: boolean;
    victorious?: boolean;
  },
): ActorAnimation {
  const {script, timeMs, sheet} = options;
  const clips = sheet?.clips;
  const available = (name: AnimationName): AnimationName => (clips && clips[name] ? name : 'idle');

  const active = script ? beatsAt(script, timeMs) : [];
  const driver = drivingBeat(actorId, active);

  let name: AnimationName;
  let elapsed: number;
  let beatDuration: number | null;

  if (driver) {
    name = available(driver.name);
    elapsed = timeMs - driver.beat.at;
    beatDuration = driver.beat.duration;
  } else if (options.down) {
    // Hold the last frame of the collapse.
    name = available('ko');
    elapsed = Number.MAX_SAFE_INTEGER / 2;
    beatDuration = 1;
  } else if (options.victorious) {
    name = available('victory');
    elapsed = timeMs;
    beatDuration = null;
  } else {
    name = 'idle';
    elapsed = timeMs;
    beatDuration = null;
  }

  const clip = clips?.[name];
  if (!clip) return {name, frame: 0, progress: 0};

  const frame = frameFor(clip, elapsed, clip.loop ? null : beatDuration);
  const progress = clip.loop || beatDuration === null
    ? 0
    : Math.min(1, Math.max(0, elapsed / Math.max(1, beatDuration)));
  return {name, frame, progress};
}

/** Every actor's animation for a frame, ready to hand to a renderer. */
export function animationsFor(
  state: BattleState,
  options: {script: BeatScript | null; timeMs: number; sheets?: Record<ActorId, SpriteSheet>;
    downIds?: readonly ActorId[]},
): Record<ActorId, ActorAnimation> {
  const down = new Set(options.downIds ?? []);
  const result: Record<ActorId, ActorAnimation> = {};
  for (const id of [...state.party, state.bossId]) {
    result[id] = animationFor(id, {
      script: options.script,
      timeMs: options.timeMs,
      sheet: options.sheets?.[id],
      down: down.has(id),
      victorious: state.result === 'victory' && id !== state.bossId && !down.has(id),
    });
  }
  return result;
}

/** Pixel rectangle to blit for a frame. */
export function frameRect(sheet: SpriteSheet, animation: ActorAnimation):
  {x: number; y: number; width: number; height: number} {
  const clip = sheet.clips[animation.name];
  const row = clip?.row ?? 0;
  return {
    x: animation.frame * sheet.frameWidth,
    y: row * sheet.frameHeight,
    width: sheet.frameWidth,
    height: sheet.frameHeight,
  };
}

/** Validates a sheet before it is trusted, so a malformed manifest fails loudly at load
 * rather than drawing garbage. */
export function validateSheet(sheet: unknown, label = 'sheet'): SpriteSheet {
  if (!sheet || typeof sheet !== 'object') throw new Error(`${label}: not an object`);
  const candidate = sheet as SpriteSheet;
  for (const field of ['file', 'frameWidth', 'frameHeight', 'anchorX', 'anchorY'] as const) {
    if (candidate[field] === undefined) throw new Error(`${label}: missing ${field}`);
  }
  if (!(candidate.frameWidth > 0) || !(candidate.frameHeight > 0)) {
    throw new Error(`${label}: frame size must be positive`);
  }
  if (!candidate.clips || typeof candidate.clips !== 'object') throw new Error(`${label}: missing clips`);
  if (!candidate.clips.idle) throw new Error(`${label}: an idle clip is required`);
  for (const [name, clip] of Object.entries(candidate.clips)) {
    if (!ANIMATION_NAMES.includes(name as AnimationName)) throw new Error(`${label}: unknown clip "${name}"`);
    if (!clip || !(clip.frames >= 1)) throw new Error(`${label}: clip "${name}" needs at least one frame`);
    if (!(clip.row >= 0)) throw new Error(`${label}: clip "${name}" needs a row`);
  }
  if (candidate.anchorX < 0 || candidate.anchorX > candidate.frameWidth) {
    throw new Error(`${label}: anchorX outside the frame`);
  }
  if (candidate.anchorY < 0 || candidate.anchorY > candidate.frameHeight) {
    throw new Error(`${label}: anchorY outside the frame`);
  }
  return candidate;
}
