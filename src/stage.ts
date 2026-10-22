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
import type {ActorId, BattleState, StatusId} from './types.js';
import type {Beat, BeatScript} from './presentation.js';
import {beatsAt, tweenValue} from './presentation.js';
import {animationFor, frameRect} from './animation.js';
import type {AbilityInfo} from './animation.js';
import {activeEffects, effectRect} from './effects.js';
import type {EffectBindings, EffectLibrary} from './effects.js';
import type {AnimationName, SpriteSheet} from './animation.js';
import type {Disclosure} from './disclosure.js';

/** Internal stage resolution. 16:9 so it letterboxes cleanly on any phone. */
export const STAGE = {width: 320, height: 180} as const;

/** Largest whole-number scale that fits the viewport, never below 1. */
export function integerScale(viewportWidth: number, viewportHeight: number): number {
  const fit = Math.min(viewportWidth / STAGE.width, viewportHeight / STAGE.height);
  return Math.max(1, Math.floor(fit));
}

export type Point = {x: number; y: number};

/** How far down the whole cast sits, against the layout that was tuned on a flat stage.
 *
 * With a flat backdrop any foot line looked plausible, because there was no floor to
 * disagree with. Real arena art has an actual ground plane, and against it the cast stood
 * about this far above it — floating, with a band of empty floor beneath them.
 *
 * Chosen by compositing candidates against the Stormworks catwalk rather than by eye: +8
 * was still visibly short, and +20 pushed the nearest hero into the foreground pipework.
 *
 * It also recovered the boss's damage numbers. Those spawn at `foot - spriteHeight - 4`
 * and rise 18px, which previously put them at y=-14 — off the top of the stage and never
 * seen. At this offset they peak at y=0 and stay on screen. */
export const GROUND_OFFSET = 14;

/** Hero formation: right-hand side, staggered so all three read as distinct.
 * Classic side-view arrangement — party right, enemy left. */
export function heroSlots(count: number): Point[] {
  const slots: Point[] = [];
  const baseX = 232;
  const baseY = 96 + GROUND_OFFSET;
  for (let i = 0; i < count; i++) {
    slots.push({x: baseX + (i % 2 === 1 ? 20 : 0), y: baseY + i * 26});
  }
  return slots;
}

/** The boss anchors left of centre, high enough to loom over the party. */
export const bossSlot: Point = {x: 92, y: 104 + GROUND_OFFSET};

/** Matches the sheet frame sizes in docs/ART-AND-AUDIO-SPEC.md, so placeholder
 * silhouettes occupy exactly the space real sprites will and layout cannot shift when
 * art lands. A sheet declaring different dimensions overrides these at draw time. */
export const SPRITE = {
  hero: {width: 32, height: 40},
  boss: {width: 96, height: 96},
} as const;

export type DrawCommand =
  /** `file` is the backdrop image to blit, present only when that arena's art exists.
   * Without it the renderer draws the flat stage, which is the shipping state. */
  | {kind: 'background'; id: string; file?: string}
  /** `sheet` names the image and the source rectangle to blit. Absent means no sheet is
   * available, and the renderer falls back to a flat silhouette in `tint`. */
  | {kind: 'sprite'; actorId: ActorId; x: number; y: number; width: number; height: number;
     facing: 'left' | 'right'; tint: string; dim: boolean; flash: number; offsetY: number;
     sheet?: {file: string; sx: number; sy: number; sw: number; sh: number};
     animation?: AnimationName}
  | {kind: 'bar'; x: number; y: number; width: number; height: number; fraction: number; palette: 'hp' | 'mp' | 'atb'}
  | {kind: 'text'; x: number; y: number; text: string; align: 'left' | 'center' | 'right';
     palette: 'default' | 'damage' | 'heal' | 'warning'}
  | {kind: 'overlay'; alpha: number; palette: 'flash' | 'dim'}
  /** A hit effect from its own sheet, anchored on the target. Separate from the character
   * sheet because a sweeping slash is wider than a 32x40 cell, and because one slash then
   * serves every weapon user. */
  | {kind: 'effect'; effectId: string; targetId: ActorId; x: number; y: number;
     width: number; height: number; frame: number; progress: number; behind: boolean;
     sheet: {file: string; sx: number; sy: number; sw: number; sh: number}};

export type Frame = {
  /** Whole-pixel screen offset for shake. Applied by the renderer to the whole stage. */
  shakeX: number;
  shakeY: number;
  commands: DrawCommand[];
};

export type ComposeInput = {
  state: BattleState;
  script: BeatScript | null;
  /** Playback position within the script, in milliseconds. Restarts at zero each batch. */
  timeMs: number;
  /** Monotonic clock for looping clips, so idle keeps breathing between turns. Defaults
   * to timeMs, which freezes whenever no batch is playing. */
  idleMs?: number;
  /** Background identifier passed through to the renderer. */
  backgroundId?: string;
  /** Backdrop image filename, when the arena's art exists. */
  backgroundFile?: string;
  /** Display names, for floating text. */
  names?: Record<ActorId, string>;
  /** Animation sheets per actor. An actor without one is drawn as a silhouette, so the
   * game stays playable while art is incomplete. */
  sheets?: Record<ActorId, SpriteSheet>;
  /** Role per hero, for silhouette tinting. */
  roles?: Record<ActorId, string>;
  /** Ability kinds, so a spell, a potion and a sword swing each pick their own clip.
   * Omitted, every action falls back to looking physical. */
  abilityInfo?: AbilityInfo;
  /** Effect sheets available to draw. Empty or omitted means no effect layer, which is
   * how it behaves until the art exists. */
  effects?: EffectLibrary;
  /** How abilities choose an effect. Defaults to DEFAULT_BINDINGS. */
  effectBindings?: EffectBindings;
  /** How long each effect runs. Impact beats are near-instant, so an effect outlives the
   * beat that spawned it. */
  effectDurationMs?: number;
  /** What the player may be shown. Omitted, everything draws, which is what the authoring
   * tools and the stage tests want. The live client passes the real mode's policy. */
  disclosure?: Disclosure;
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

/** Which statuses an actor should show *at this point in playback*.
 *
 * Works backwards from the state the batch ended in, which is the only state the screen
 * has, undoing every status change that has not happened yet. A status applied later in
 * the batch is removed; one that expires later is put back. Processed newest-first so a
 * status that toggles twice in one batch unwinds correctly.
 *
 * This is why every status change needed an event carrying its id: a bare delete left no
 * beat, so a consumed status appeared to drop at the start of the batch rather than at the
 * moment it was spent. */
export function statusesAt(
  script: BeatScript | null,
  actorId: ActorId,
  timeMs: number,
  finalStatuses: Partial<Record<StatusId, unknown>>,
): StatusId[] {
  const shown = new Set(Object.keys(finalStatuses) as StatusId[]);
  if (script) {
    const future = script.beats
      .filter(b => (b.kind === 'status_on' || b.kind === 'status_off')
        && b.actorId === actorId && b.status !== undefined && b.at > timeMs)
      .sort((a, b) => b.at - a.at);
    for (const beat of future) {
      if (beat.kind === 'status_on') shown.delete(beat.status!);
      else shown.add(beat.status!);
    }
  }
  // Sorted so the badge order cannot flicker between frames.
  return [...shown].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether an actor reads as down *at this point in playback*, rather than in the state
 * the batch ended in.
 *
 * Exported because the DOM party panel needs the same answer the canvas does. Reading
 * `actor.hp === 0` there dimmed a hero the instant an action was committed, before the
 * attack that killed them had even begun animating. */
export function downAt(
  script: BeatScript | null, actorId: ActorId, timeMs: number, actualHp: number,
): boolean {
  return displayedValue(script, actorId, timeMs, actualHp) <= 0;
}

/** Composes a single frame. Pure: identical inputs give an identical frame. */
export function composeFrame(input: ComposeInput): Frame {
  const {state, script, timeMs} = input;
  const active: Beat[] = script ? beatsAt(script, timeMs) : [];
  const commands: DrawCommand[] = [];

  commands.push({
    kind: 'background', id: input.backgroundId ?? state.bossId,
    ...(input.backgroundFile ? {file: input.backgroundFile} : {}),
  });

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
  /** How far an acting actor walks toward its target, in stage pixels.
   *
   * 6 was barely perceptible against a ~30px character -- the approach phase looked like
   * a twitch rather than a walk. At 18 the step is over half a body width and reads as
   * crossing ground, which is what the phase is for. Applies to heroes only; the boss
   * holds its ground, so a hero's furthest reach of x=186 stays clear of the widest
   * boss's x=148. */
  const STEP_DISTANCE = 18;

  /** Where an acting actor is between its slot and striking distance, 0 to 1.
   *
   * Read straight off the three action phases now, which is what makes the motion
   * followable: out during `approach`, planted through `strike`, back during `retreat`.
   * It used to be inferred -- first from whichever beats were active, which ended the
   * lean before the blow landed, then from the impact positions, which worked but
   * described the motion only indirectly. The phases say it outright.
   *
   * Eased at both ends so the slide accelerates away and decelerates home rather than
   * moving at a constant rate. */
  const stepFor = (actorId: ActorId): number => {
    const phase = active.find(b => b.actorId === actorId
      && (b.kind === 'approach' || b.kind === 'strike' || b.kind === 'retreat'));
    if (!phase) return 0;
    const progress = Math.min(1, Math.max(0,
      (timeMs - phase.at) / Math.max(1, phase.duration)));
    const lean = phase.kind === 'strike'
      ? 1
      : phase.kind === 'approach'
        ? Math.sin((progress * Math.PI) / 2)
        : Math.cos((progress * Math.PI) / 2);
    return Math.round(STEP_DISTANCE * lean);
  };


  /** Down according to playback, not according to the final state. */
  const downNow = (id: ActorId, actualHp: number): boolean =>
    downAt(script, id, timeMs, actualHp);

  /** Builds the sprite command for an actor, using its sheet when one exists.
   *
   * The sheet's own frame size wins over the placeholder constants, so a character whose
   * weapon needs a wider cell works without touching the layout. Position is derived from
   * the sheet's anchor, which is what keeps actors of different heights on one ground
   * line. */
  const spriteFor = (
    id: ActorId, slot: Point, fallback: {width: number; height: number},
    facing: 'left' | 'right', tint: string, down: boolean, extraOffsetY: number,
  ): DrawCommand => {
    const sheet = input.sheets?.[id];
    const animation = sheet
      ? animationFor(id, {script, timeMs, sheet, down, abilityInfo: input.abilityInfo,
          ...(input.idleMs !== undefined ? {idleMs: input.idleMs} : {}),
          victorious: state.result === 'victory' && id !== state.bossId && !down})
      : undefined;
    const width = sheet?.frameWidth ?? fallback.width;
    const height = sheet?.frameHeight ?? fallback.height;
    const anchorX = sheet?.anchorX ?? Math.floor(width / 2);
    const anchorY = sheet?.anchorY ?? height;
    const rect = sheet && animation ? frameRect(sheet, animation) : null;
    return {
      kind: 'sprite', actorId: id,
      x: slot.x - anchorX, y: slot.y - anchorY,
      width, height, facing, tint, dim: down,
      flash: flashFor(id), offsetY: extraOffsetY,
      ...(rect ? {sheet: {file: sheet!.file, sx: rect.x, sy: rect.y, sw: rect.width, sh: rect.height}} : {}),
      ...(animation ? {animation: animation.name} : {}),
    };
  };

  const boss = state.actors[state.bossId];
  const slots = heroSlots(state.party.length);

  /** Where an actor stands, for anything anchored onto it. */
  const anchorFor = (actorId: ActorId | undefined): Point => {
    if (actorId === state.bossId) return bossSlot;
    const index = state.party.indexOf(actorId ?? '');
    return slots[index] ?? bossSlot;
  };

  /** Effect commands for one layer. Anchored on the target's feet so a sheet's own anchor
   * decides how high the effect sits, which is what lets a ground effect and an overhead
   * flare share one code path. */
  const effectCommands = (behind: boolean): DrawCommand[] => {
    if (!input.effects) return [];
    const playing = activeEffects(script, timeMs, {
      library: input.effects, bindings: input.effectBindings,
      abilityInfo: input.abilityInfo, durationMs: input.effectDurationMs,
    });
    const out: DrawCommand[] = [];
    for (const effect of playing) {
      if (effect.behind !== behind) continue;
      const sheet = input.effects[effect.id];
      if (!sheet) continue;
      const rect = effectRect(sheet, effect);
      const anchor = anchorFor(effect.targetId);
      out.push({
        kind: 'effect', effectId: effect.id, targetId: effect.targetId,
        x: anchor.x - sheet.anchorX, y: anchor.y - sheet.anchorY,
        width: sheet.frameWidth, height: sheet.frameHeight,
        // The source rect already encodes the frame; carrying the index too keeps the
        // command self-describing for a renderer that wants it.
        frame: effect.frame, progress: effect.progress, behind,
        sheet: {file: sheet.file, sx: rect.x, sy: rect.y, sw: rect.width, sh: rect.height},
      });
    }
    return out;
  };

  commands.push(...effectCommands(true));

  if (boss) {
    // The boss does not walk. It is several times the size of a hero and stays planted
    // while the party comes to it, which is both how large enemies read in the games this
    // imitates and the only sensible answer here: its step used to be a *vertical* offset,
    // so scaling the walk up would have had it levitating rather than advancing.
    // Its attack is carried by the clip, the hit flash and the shake instead.
    commands.push(spriteFor(state.bossId, bossSlot, SPRITE.boss, 'right', TINTS.boss!,
      downNow(state.bossId, boss.hp), 0));
  }

  state.party.forEach((id, index) => {
    const actor = state.actors[id];
    const slot = slots[index];
    if (!actor || !slot) return;
    // A hero steps toward the enemy, which is to its left.
    const stepped = {x: slot.x - stepFor(id), y: slot.y};
    commands.push(spriteFor(id, stepped, SPRITE.hero, 'left',
      tintForRole(input.roles?.[id]), downNow(id, actor.hp), 0));
  });

  commands.push(...effectCommands(false));

  // --- boss health bar across the top ---
  if (boss) {
    const shown = displayedValue(script, state.bossId, timeMs, boss.hp);
    commands.push({
      kind: 'bar', x: 16, y: 12, width: STAGE.width - 32, height: 6,
      fraction: Math.max(0, Math.min(1, shown / Math.max(1, boss.stats.hp))), palette: 'hp',
    });
  }

  // --- battle messages ---
  // Every outcome that is not damage announces itself through a message beat: a fizzle
  // says "No effect", a Nullifier says it swallowed the spell, an interrupt says it broke
  // the cast. None of it was drawn, so an action that did nothing looked identical to one
  // that was never taken -- which is the whole feedback for a wasted turn.
  //
  // Centred under the health bar rather than floating on the actor: the text is a
  // sentence, and at 320px wide there is nowhere near an actor to put one.
  //
  // `telegraph` and `revive` carry a sentence too and were dropped here for the same
  // reason, which made three of the new sound effects unlearnable: a cue is only
  // intuitive if something visible happens with it, and the telegraph sting fired against
  // a completely static screen. The original hit and heal sounds never had this problem
  // because a floating number lands with them.
  for (const beat of active) {
    const sentence = beat.kind === 'message' || beat.kind === 'telegraph'
      || beat.kind === 'revive';
    if (!sentence || !beat.text) continue;
    // The telegraph line names the boss's next ability, which is the single thing Normal
    // mode most deliberately withholds.
    if (beat.kind === 'telegraph' && input.disclosure && !input.disclosure.telegraph) continue;
    commands.push({
      kind: 'text', x: Math.round(STAGE.width / 2), y: 32, align: 'center',
      text: beat.text, palette: 'warning',
    });
  }

  // --- status popups ---
  // Floating on the actor rather than centred, because unlike the sentences above these
  // are one word and belong to one character.
  //
  // Drawn from `beat.status`, never `beat.text`: the text on a status beat is the engine's
  // `details` string -- "poison; expires at 64" -- which is a debug line that happens to
  // be human-readable, not player-facing copy.
  for (const beat of active) {
    if (beat.kind !== 'status_on' && beat.kind !== 'status_off') continue;
    if (!beat.status) continue;
    if (input.disclosure && !input.disclosure.statuses) continue;
    const anchor = anchorFor(beat.actorId ?? beat.targetId);
    const height = (beat.actorId ?? beat.targetId) === state.bossId
      ? SPRITE.boss.height : SPRITE.hero.height;
    const rise = Math.round(18 * floatProgress(beat, timeMs));
    commands.push({
      kind: 'text', x: anchor.x, y: anchor.y - height - 4 - rise, align: 'center',
      text: beat.kind === 'status_on'
        ? beat.status.toUpperCase()
        : `${beat.status.toUpperCase()} ENDS`,
      palette: 'warning',
    });
  }

  // --- floating numbers ---
  for (const beat of active) {
    if (beat.kind !== 'damage_number' && beat.kind !== 'heal_number') continue;
    const anchor = anchorFor(beat.targetId);
    const rise = Math.round(18 * floatProgress(beat, timeMs));
    const height = beat.targetId === state.bossId ? SPRITE.boss.height : SPRITE.hero.height;
    commands.push({
      kind: 'text', x: anchor.x, y: anchor.y - height - 4 - rise, align: 'center',
      // Zero damage is an outcome, not a number: an immune element or a hit absorbed
      // entirely. "0" floating off a boss reads as a glitch, where "NO EFFECT" reads as
      // information -- and in Normal mode, where affinities are hidden, it is the only
      // way the player ever learns an element does nothing here.
      // A critical says so rather than just being a bigger number. Doubled damage with
      // no label is indistinguishable from a damage bug -- the same reason a zero reads
      // as 'NO EFFECT' rather than '0'.
      text: beat.kind === 'heal_number'
        ? `+${beat.amount ?? 0}`
        : (beat.amount ?? 0) === 0 ? 'NO EFFECT'
        : beat.critical ? `CRITICAL ${beat.amount}` : `${beat.amount}`,
      palette: beat.kind === 'heal_number' ? 'heal'
        : (beat.amount ?? 0) === 0 ? 'warning'
        : beat.critical ? 'warning' : 'damage',
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
