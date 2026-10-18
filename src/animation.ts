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
import type {AbilityKind, ActorId, BattleState} from './types.js';
import type {Beat, BeatScript} from './presentation.js';
import {beatsAt} from './presentation.js';

/** The animation set every combatant sheet must provide. */
export type AnimationName =
  | 'idle'      // looping; the default
  | 'attack'    // stepping in and striking
  | 'cast'      // channelled or magical wind-up
  | 'item'      // reaching for a pouch; optional, falls back to idle
  | 'hurt'      // taking a hit
  | 'ko'        // collapsing, then staying down on its last frame
  | 'victory';  // looping; winners only

export const ANIMATION_NAMES: AnimationName[] =
  ['idle', 'attack', 'cast', 'item', 'hurt', 'ko', 'victory'];

/** Which clip an acting actor plays, by what kind of thing it is doing.
 *
 * Without this, every action resolved to `attack`: a fireball, a cure and a potion all
 * played the sword swing, while the `cast` row sat in the sheet unused. The mapping is
 * data rather than branching so it can be asserted exhaustively, and so a new
 * `AbilityKind` fails to compile until someone decides how it should look. */
export const CLIP_FOR_KIND: Record<AbilityKind, AnimationName> = {
  // Closing the distance and connecting.
  physical: 'attack',
  steal: 'attack',
  airborne: 'attack',
  // Anything channelled through will, not steel.
  magical: 'cast',
  heal: 'cast',
  status: 'cast',
  dispel: 'cast',
  nullify: 'cast',
  cover: 'cast',
  focus: 'cast',
  // Rummaging in a pouch looks like neither.
  item: 'item',
};

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
/** What to draw when a sheet lacks the clip the action asked for, most specific first.
 *
 * Each list ends at `idle`, which `validateSheet` guarantees exists. The chains matter
 * because dropping straight to idle would make a sheet without an `item` row show an actor
 * standing perfectly still while a potion takes effect — a worse reading than the wrong
 * animation it replaced. Falling back to `cast` keeps a gesture on screen, and a swing
 * stays distinct from it. */
export const CLIP_FALLBACK: Record<AnimationName, readonly AnimationName[]> = {
  idle: ['idle'],
  attack: ['attack', 'idle'],
  cast: ['cast', 'attack', 'idle'],
  item: ['item', 'cast', 'attack', 'idle'],
  hurt: ['hurt', 'idle'],
  ko: ['ko', 'hurt', 'idle'],
  victory: ['victory', 'idle'],
};

/** Ability kinds, keyed by ability id. Only `kind` is read, so a caller can pass the same
 * ability table the audio layer uses. */
export type AbilityInfo = Record<string, {kind?: AbilityKind} | undefined>;

/** The clip for an action beat. Falls back to `attack` when the ability is unknown, which
 * is how it behaved before kinds were threaded through, so a missing table degrades to the
 * old look rather than to a frozen idle pose. */
function clipForAction(beat: Beat, abilityInfo?: AbilityInfo): AnimationName {
  const kind = beat.abilityId ? abilityInfo?.[beat.abilityId]?.kind : undefined;
  return kind ? CLIP_FOR_KIND[kind] : 'attack';
}

function drivingBeat(
  actorId: ActorId, active: Beat[], abilityInfo?: AbilityInfo,
): {beat: Beat; name: AnimationName} | null {
  // Priority matters: being knocked out outranks being hit, which outranks acting.
  const ko = active.find(b => b.kind === 'ko' && b.actorId === actorId);
  if (ko) return {beat: ko, name: 'ko'};

  // The dedicated reaction beat, not the impact: the flash is brief by design, and a
  // recoil bound to it was too short to see.
  const hurt = active.find(b => b.kind === 'hurt' && b.targetId === actorId);
  if (hurt) return {beat: hurt, name: 'hurt'};

  // A channelled wind-up is a cast whatever it ends in: the clip is the wind-up pose, and
  // the strike itself arrives later as its own impact beat.
  const cast = active.find(b => b.kind === 'cast' && b.actorId === actorId);
  if (cast) return {beat: cast, name: 'cast'};

  const step = active.find(b => b.kind === 'actor_step' && b.actorId === actorId);
  if (step) return {beat: step, name: clipForAction(step, abilityInfo)};

  // An actor whose hit is landing is still mid-action after its step beat ended.
  const striking = active.find(b => b.kind === 'impact' && b.actorId === actorId);
  if (striking) return {beat: striking, name: clipForAction(striking, abilityInfo)};

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
    /** Lets an action pick its clip by ability kind. Omitted, every action looks physical. */
    abilityInfo?: AbilityInfo;
    /** A clock for *looping* clips, which must keep running when nothing is happening.
     *
     * `timeMs` is the position inside the current batch: it restarts at zero every batch
     * and stops advancing between turns, which is right for a clip fitted to a beat and
     * wrong for a loop. Driving idle from it left every character frozen mid-breath while
     * the player chose an action. Pass a monotonic clock here and the loops keep going.
     *
     * Defaults to `timeMs`, so a caller that does not care gets the old behaviour. */
    idleMs?: number;
  },
): ActorAnimation {
  const {script, timeMs, sheet} = options;
  const clips = sheet?.clips;
  const available = (name: AnimationName): AnimationName => {
    for (const candidate of CLIP_FALLBACK[name]) {
      if (clips?.[candidate]) return candidate;
    }
    return 'idle';
  };

  const active = script ? beatsAt(script, timeMs) : [];
  const driver = drivingBeat(actorId, active, options.abilityInfo);

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
    // Looping, so it runs off the monotonic clock rather than the batch position.
    name = available('victory');
    elapsed = options.idleMs ?? timeMs;
    beatDuration = null;
  } else {
    name = 'idle';
    elapsed = options.idleMs ?? timeMs;
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
    downIds?: readonly ActorId[]; idleMs?: number; abilityInfo?: AbilityInfo},
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
      ...(options.idleMs !== undefined ? {idleMs: options.idleMs} : {}),
      ...(options.abilityInfo ? {abilityInfo: options.abilityInfo} : {}),
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
