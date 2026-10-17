/** Battle stage composition: turns battle state plus choreography beats into a flat
 * list of draw commands for one frame.
 *
 * Pure and renderer-agnostic, like `presentation.ts`. A canvas, WebGL or native view
 * executes the commands; none of the layout, shake, or float maths lives in the
 * renderer. That keeps the visual logic unit-testable on a machine with no browser.
 *
 * The stage is a fixed internal resolution, scaled by whole numbers only. That is what
 * makes pixel art look like pixel art instead of a blurry web page: at 320x180 the
 * stage integer-scales to 640x360, 960x540 and 1280x720 exactly.
 */
import type {ActorId, BattleState} from './types.js';
import type {Beat, BeatScript} from './presentation.js';
import {beatsAt, tweenValue} from './presentation.js';

/** Internal stage resolution. 16:9 so it letterboxes cleanly on any phone. */
export const STAGE = {width: 320, height: 180} as const;

/** Largest whole-number scale that fits the viewport, never below 1. */
export function integerScale(viewportWidth: number, viewportHeight: number): number {
  const fit = Math.min(viewportWidth / STAGE.width, viewportHeight / STAGE.height);
  return Math.max(1, Math.floor(fit));
}

export type Point = {x: number; y: number};

/** Hero formation: right-hand side, staggered so all three read as distinct.
 * Classic side-view arrangement — party right, enemy left. */
export function heroSlots(count: number): Point[] {
  const slots: Point[] = [];
  const baseX = 232;
  const baseY = 96;
  for (let i = 0; i < count; i++) {
    slots.push({x: baseX + (i % 2 === 1 ? 20 : 0), y: baseY + i * 26});
  }
  return slots;
}

/** The boss anchors left of centre, high enough to loom over the party. */
export const bossSlot: Point = {x: 92, y: 104};

/** Matches the sheet frame sizes in docs/ART-AND-AUDIO-SPEC.md, so placeholder
 * silhouettes occupy exactly the space real sprites will and layout cannot shift when
 * art lands. A sheet declaring different dimensions overrides these at draw time. */
export const SPRITE = {
  hero: {width: 32, height: 40},
  boss: {width: 96, height: 96},
} as const;

export type DrawCommand =
  | {kind: 'background'; id: string}
  /** No art yet: renderers draw a flat silhouette with the given tint. */
  | {kind: 'sprite'; actorId: ActorId; x: number; y: number; width: number; height: number;
     facing: 'left' | 'right'; tint: string; dim: boolean; flash: number; offsetY: number}
  | {kind: 'bar'; x: number; y: number; width: number; height: number; fraction: number; palette: 'hp' | 'mp' | 'atb'}
  | {kind: 'text'; x: number; y: number; text: string; align: 'left' | 'center' | 'right';
     palette: 'default' | 'damage' | 'heal' | 'warning'}
  | {kind: 'overlay'; alpha: number; palette: 'flash' | 'dim'};

export type Frame = {
  /** Whole-pixel screen offset for shake. Applied by the renderer to the whole stage. */
  shakeX: number;
  shakeY: number;
  commands: DrawCommand[];
};

export type ComposeInput = {
  state: BattleState;
  script: BeatScript | null;
  /** Playback position within the script, in milliseconds. */
  timeMs: number;
  /** Background identifier passed through to the renderer. */
  backgroundId?: string;
  /** Display names, for floating text. */
  names?: Record<ActorId, string>;
};

/** Deterministic pseudo-random in [-1, 1] from an integer. Shake must be reproducible
 * so a replay looks identical and the maths can be asserted in a test. */
function wobble(seed: number): number {
  let h = (seed * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Decaying oscillation: strongest at the start of the beat, settled by the end. */
export function shakeOffset(beat: Beat, timeMs: number): Point {
  if (beat.duration <= 0) return {x: 0, y: 0};
  const progress = Math.min(1, Math.max(0, (timeMs - beat.at) / beat.duration));
  const decay = 1 - progress;
  const amplitude = (beat.intensity ?? 0) * 6 * decay * decay;
  // Step the seed so the wobble changes a few times per beat rather than every frame.
  const step = Math.floor((timeMs - beat.at) / 40);
  return {
    x: Math.round(amplitude * wobble(step * 2 + 1)),
    y: Math.round(amplitude * wobble(step * 2 + 2) * 0.6),
  };
}

/** How far a damage number has floated, 0 at spawn and 1 when it fades. */
export function floatProgress(beat: Beat, timeMs: number): number {
  if (beat.duration <= 0) return 1;
  return Math.min(1, Math.max(0, (timeMs - beat.at) / beat.duration));
}

const TINTS: Record<string, string> = {
  boss: '#b4476a',
  Guardian: '#5b8fd4',
  Healer: '#6fc48a',
  Striker: '#d8a04a',
  Caster: '#a874cf',
  Controller: '#4ec0c0',
  Support: '#c9c05a',
  default: '#8899aa',
};

/** The value a meter should show at a playback position.
 *
 * Reading battle state directly is wrong during playback: the state already holds the
 * post-action value, so before a tween begins the meter would show the new value, jump
 * back up to the old one as the tween starts, and drain again — a visible flash. This
 * resolves the whole tween sequence instead:
 *   before the first tween -> its `from`
 *   inside a tween         -> the eased interpolation
 *   between/after tweens   -> the most recently completed `to`
 *   no tweens at all       -> the fallback (actual state)
 */
export function displayedValue(
  script: BeatScript | null,
  actorId: ActorId,
  timeMs: number,
  fallback: number,
  kind: 'hp_change' | 'mp_change' = 'hp_change',
): number {
  if (!script) return fallback;
  const tweens = script.beats
    .filter(b => b.kind === kind && b.targetId === actorId && b.from !== undefined)
    .sort((a, b) => a.at - b.at);
  if (!tweens.length) return fallback;

  const first = tweens[0]!;
  if (timeMs < first.at) return first.from!;

  let value = fallback;
  for (const tween of tweens) {
    if (timeMs >= tween.at + tween.duration) value = tween.to ?? value;
    else if (timeMs >= tween.at) return tweenValue(tween, timeMs);
    else break;
  }
  return value;
}

/** Composes a single frame. Pure: identical inputs give an identical frame. */
export function composeFrame(input: ComposeInput): Frame {
  const {state, script, timeMs} = input;
  const active: Beat[] = script ? beatsAt(script, timeMs) : [];
  const commands: DrawCommand[] = [];

  commands.push({kind: 'background', id: input.backgroundId ?? state.bossId});

  // --- shake: strongest active beat wins, so simultaneous hits do not cancel out ---
  let shakeX = 0;
  let shakeY = 0;
  const shakes = active.filter(b => b.kind === 'shake');
  if (shakes.length) {
    const strongest = shakes.reduce((a, b) => ((b.intensity ?? 0) > (a.intensity ?? 0) ? b : a));
    const offset = shakeOffset(strongest, timeMs);
    shakeX = offset.x;
    shakeY = offset.y;
  }

  // --- actors ---
  const flashFor = (actorId: ActorId): number => {
    const hit = active.find(b => b.kind === 'impact' && b.targetId === actorId);
    if (!hit) return 0;
    return 1 - Math.min(1, Math.max(0, (timeMs - hit.at) / Math.max(1, hit.duration)));
  };
  /** A stepping actor leans toward its target. */
  const stepFor = (actorId: ActorId): number => {
    const step = active.find(b => b.kind === 'actor_step' && b.actorId === actorId);
    if (!step) return 0;
    const progress = Math.min(1, Math.max(0, (timeMs - step.at) / Math.max(1, step.duration)));
    return Math.round(6 * Math.sin(progress * Math.PI));
  };

  /** Down according to playback, not according to the final state. */
  const downNow = (id: ActorId, actualHp: number): boolean =>
    displayedValue(script, id, timeMs, actualHp) <= 0;

  const boss = state.actors[state.bossId];
  if (boss) {
    commands.push({
      kind: 'sprite', actorId: state.bossId,
      x: bossSlot.x - SPRITE.boss.width / 2, y: bossSlot.y - SPRITE.boss.height,
      width: SPRITE.boss.width, height: SPRITE.boss.height,
      facing: 'right', tint: TINTS.boss!, dim: downNow(state.bossId, boss.hp),
      flash: flashFor(state.bossId), offsetY: -stepFor(state.bossId),
    });
  }

  const slots = heroSlots(state.party.length);
  state.party.forEach((id, index) => {
    const actor = state.actors[id];
    const slot = slots[index];
    if (!actor || !slot) return;
    commands.push({
      kind: 'sprite', actorId: id,
      x: slot.x - SPRITE.hero.width / 2 - stepFor(id), y: slot.y - SPRITE.hero.height,
      width: SPRITE.hero.width, height: SPRITE.hero.height,
      facing: 'left', tint: TINTS.default!, dim: downNow(id, actor.hp),
      flash: flashFor(id), offsetY: 0,
    });
  });

  // --- boss health bar across the top ---
  if (boss) {
    const shown = displayedValue(script, state.bossId, timeMs, boss.hp);
    commands.push({
      kind: 'bar', x: 16, y: 12, width: STAGE.width - 32, height: 6,
      fraction: Math.max(0, Math.min(1, shown / Math.max(1, boss.stats.hp))), palette: 'hp',
    });
  }

  // --- floating numbers ---
  for (const beat of active) {
    if (beat.kind !== 'damage_number' && beat.kind !== 'heal_number') continue;
    const index = state.party.indexOf(beat.targetId ?? '');
    const anchor = beat.targetId === state.bossId ? bossSlot : (slots[index] ?? bossSlot);
    const rise = Math.round(18 * floatProgress(beat, timeMs));
    const height = beat.targetId === state.bossId ? SPRITE.boss.height : SPRITE.hero.height;
    commands.push({
      kind: 'text', x: anchor.x, y: anchor.y - height - 4 - rise, align: 'center',
      text: beat.kind === 'heal_number' ? `+${beat.amount ?? 0}` : `${beat.amount ?? 0}`,
      palette: beat.kind === 'heal_number' ? 'heal' : 'damage',
    });
  }

  // --- full-screen flash, strongest wins ---
  const flashes = active.filter(b => b.kind === 'flash');
  if (flashes.length) {
    const strongest = flashes.reduce((a, b) => ((b.intensity ?? 0) > (a.intensity ?? 0) ? b : a));
    const progress = Math.min(1, Math.max(0, (timeMs - strongest.at) / Math.max(1, strongest.duration)));
    commands.push({kind: 'overlay', alpha: (strongest.intensity ?? 0) * (1 - progress), palette: 'flash'});
  }

  // --- a defeated party dims the whole stage, once the defeat beat has landed ---
  // Keyed on the timeline, not on `state.result`: the state is already terminal at the
  // start of the batch that ends the battle, so reading it directly washed the stage out
  // before the killing blow had even animated.
  const defeatBeat = script?.beats.find(b => b.kind === 'defeat');
  const defeated = defeatBeat ? timeMs >= defeatBeat.at : (!script && state.result === 'defeat');
  if (defeated) {
    const progress = defeatBeat
      ? Math.min(1, (timeMs - defeatBeat.at) / Math.max(1, defeatBeat.duration))
      : 1;
    commands.push({kind: 'overlay', alpha: 0.55 * progress, palette: 'dim'});
  }

  return {shakeX, shakeY, commands};
}

/** Role tint for a hero, so a renderer can colour placeholder silhouettes consistently
 * until real sprites exist. */
export function tintForRole(role: string | undefined): string {
  return (role && TINTS[role]) ?? TINTS.default!;
}
