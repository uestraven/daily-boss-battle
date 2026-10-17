/** Attack effects as a separate layer.
 *
 * Slashes, impacts and spell flares are drawn from their own sheets, over the stage,
 * anchored on the target — not baked into the character's animation frames.
 *
 * This is both the SNES convention and the practical fix for a real problem: a sweeping
 * crescent slash is two or three times the width of a 32x40 character cell, so putting it
 * in the character sheet either clips it or forces an enormous frame in which the figure
 * is a few pixels tall. Separating the layers also means one slash effect serves every
 * sword user, which is far less art for a better result.
 */
import type {ActorId, Element} from './types.js';
import type {Beat, BeatScript} from './presentation.js';
import {beatsAt} from './presentation.js';

export type EffectSheet = {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** The effect's visual centre within a frame, aligned onto the target. */
  anchorX: number;
  anchorY: number;
  /** Drawn behind the actors instead of in front; useful for ground and aura effects. */
  behind?: boolean;
};

/** Effects are keyed by id; content maps abilities and elements onto them. */
export type EffectId = string;

export type EffectLibrary = Record<EffectId, EffectSheet>;

/** How an ability picks its effect. Looked up most specific first:
 * ability id, then element, then the generic physical or magical fallback. */
export type EffectBindings = {
  byAbility?: Record<string, EffectId>;
  byElement?: Partial<Record<Element, EffectId>>;
  physical?: EffectId;
  magical?: EffectId;
};

export const DEFAULT_BINDINGS: EffectBindings = {
  byElement: {
    fire: 'flare_fire', ice: 'flare_ice', lightning: 'flare_lightning',
    holy: 'flare_holy', dark: 'flare_dark',
  },
  physical: 'slash',
  magical: 'flare_neutral',
};

export function effectIdFor(
  binding: EffectBindings,
  options: {abilityId?: string; element?: Element; kind?: 'physical' | 'magical'},
): EffectId | null {
  if (options.abilityId && binding.byAbility?.[options.abilityId]) {
    return binding.byAbility[options.abilityId]!;
  }
  if (options.element && options.element !== 'neutral' && binding.byElement?.[options.element]) {
    return binding.byElement[options.element]!;
  }
  if (options.kind === 'magical' && binding.magical) return binding.magical;
  if (options.kind === 'physical' && binding.physical) return binding.physical;
  return null;
}

export type ActiveEffect = {
  id: EffectId;
  targetId: ActorId;
  /** Zero-based frame within the effect sheet. */
  frame: number;
  /** 0..1 through the effect. */
  progress: number;
  behind: boolean;
};

/** Effects currently playing, derived from impact beats so they land exactly with the
 * hit, the damage number and the shake. */
export function activeEffects(
  script: BeatScript | null,
  timeMs: number,
  options: {
    library: EffectLibrary;
    bindings?: EffectBindings;
    /** Ability metadata, so an impact can resolve its element and kind. */
    abilityInfo?: Record<string, {element?: Element; kind?: 'physical' | 'magical'}>;
    /** Stretches each effect over this many milliseconds. Impact beats are very short,
     * so an effect normally outlives the beat that spawned it. */
    durationMs?: number;
  },
): ActiveEffect[] {
  if (!script) return [];
  const bindings = options.bindings ?? DEFAULT_BINDINGS;
  const duration = options.durationMs ?? 260;
  const out: ActiveEffect[] = [];

  // Impacts are instants; an effect spawned by one runs for `duration` afterwards, so the
  // search window extends backwards rather than using beatsAt alone.
  const candidates: Beat[] = script.beats.filter(
    b => b.kind === 'impact' && timeMs >= b.at && timeMs < b.at + duration);

  for (const beat of candidates) {
    if (!beat.targetId) continue;
    const info = beat.abilityId ? options.abilityInfo?.[beat.abilityId] : undefined;
    const id = effectIdFor(bindings, {
      abilityId: beat.abilityId, element: info?.element, kind: info?.kind ?? 'physical',
    });
    if (!id) continue;
    const sheet = options.library[id];
    if (!sheet) continue;
    const progress = Math.min(1, Math.max(0, (timeMs - beat.at) / duration));
    out.push({
      id,
      targetId: beat.targetId,
      frame: Math.min(sheet.frames - 1, Math.floor(progress * sheet.frames)),
      progress,
      behind: sheet.behind ?? false,
    });
  }
  // Stable order so rendering is deterministic when two hits overlap.
  return out.sort((a, b) => (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Pixel rectangle to blit for an effect frame. */
export function effectRect(sheet: EffectSheet, effect: ActiveEffect):
  {x: number; y: number; width: number; height: number} {
  return {
    x: effect.frame * sheet.frameWidth, y: 0,
    width: sheet.frameWidth, height: sheet.frameHeight,
  };
}

/** Validates an effect sheet so a malformed manifest fails loudly at load. */
export function validateEffectSheet(sheet: unknown, label = 'effect'): EffectSheet {
  if (!sheet || typeof sheet !== 'object') throw new Error(`${label}: not an object`);
  const candidate = sheet as EffectSheet;
  if (!candidate.file) throw new Error(`${label}: missing file`);
  if (!(candidate.frameWidth > 0) || !(candidate.frameHeight > 0)) {
    throw new Error(`${label}: frame size must be positive`);
  }
  if (!(candidate.frames >= 1)) throw new Error(`${label}: needs at least one frame`);
  for (const field of ['anchorX', 'anchorY'] as const) {
    if (typeof candidate[field] !== 'number') throw new Error(`${label}: missing ${field}`);
  }
  if (candidate.anchorX < 0 || candidate.anchorX > candidate.frameWidth) {
    throw new Error(`${label}: anchorX outside the frame`);
  }
  if (candidate.anchorY < 0 || candidate.anchorY > candidate.frameHeight) {
    throw new Error(`${label}: anchorY outside the frame`);
  }
  return candidate;
}

/** The effects the default bindings can ask for. This is the commissioning list. */
export function requiredEffects(): {id: EffectId; purpose: string; suggestedFrame: string}[] {
  return [
    {id: 'slash', purpose: 'Generic physical hit; every weapon user', suggestedFrame: '64x48'},
    {id: 'flare_neutral', purpose: 'Non-elemental magical hit', suggestedFrame: '64x64'},
    {id: 'flare_fire', purpose: 'Fire damage', suggestedFrame: '64x64'},
    {id: 'flare_ice', purpose: 'Ice damage', suggestedFrame: '64x64'},
    {id: 'flare_lightning', purpose: 'Lightning damage', suggestedFrame: '64x64'},
    {id: 'flare_holy', purpose: 'Holy damage', suggestedFrame: '64x64'},
    {id: 'flare_dark', purpose: 'Dark damage', suggestedFrame: '64x64'},
  ];
}
