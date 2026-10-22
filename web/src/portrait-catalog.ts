/** Codex portraits: one 64x64 image per hero.
 *
 * Gated on `shipped` exactly like the hit effects, and for the same reason. A portrait that
 * has not been drawn yet must cost no failed request and no console noise -- the card falls
 * back to the hero's own battle sprite, which is already loaded and is a perfectly good
 * likeness. So the Codex is complete and useful from the first day, and each portrait
 * upgrades one card as it arrives.
 *
 * `npm run portraits:check` fails when this list and `web/public/portraits/` disagree, so
 * the two cannot drift.
 */
import {heroIds} from '../../dist/src/roster.js';
import {bossIds} from '../../dist/src/generate.js';
import {mediaUrl} from './media-url.js';

/** Anything with a portrait: the twelve heroes and the eight bosses.
 *
 * Widened from `HeroId` when the bestiary arrived. A plain string rather than a union of
 * both, because `bossIds` is derived from the boss profiles at runtime and has no literal
 * type to union with -- and the `portraits:check` tool is what actually enforces that every
 * id here has a file, which a union could not do anyway. */
export type PortraitId = string;

/** Every id that should have a portrait, heroes first. */
export const portraitIds: readonly PortraitId[] = [...heroIds, ...bossIds];

/** Portraits are square and larger than a sprite frame, so a face reads at all. Drawn at
 * 64x64 and displayed at an integer multiple, like everything else on this stage. */
export const PORTRAIT_SIZE = 64;

/** Filename per hero, derived rather than listed: a per-hero line would be a second place
 * to forget a hero. */
export const portraitFile = (id: PortraitId): string => `${id}.png`;

/** Heroes whose portrait PNG is actually in `web/public/portraits/`.
 *
 * All twelve, as of 2026-10-22. The sprite fallback in `Codex.tsx` stays: it is what let the
 * Codex ship complete before any portrait existed, and it is the right behaviour for a
 * thirteenth hero added before their portrait is drawn. */
export const shippedPortraits: readonly PortraitId[] = ['warden','lancer','oracle','blademage',
  'channeler','nullifier','monk','machinist','vanguard','brawler','magus','thief',
  'blade_tyrant','tide_maw','ink_lurker','crush_wall','storm_keeper','spell_weaver',
  'mad_harlequin','clockwork_emperor'];

export const hasPortrait = (id: PortraitId): boolean => shippedPortraits.includes(id);

export const portraitUrl = (id: PortraitId): string => mediaUrl('portraits', portraitFile(id));

/** The commissioning list: every hero, and whether its portrait exists. */
export const portraitStatus = (): {id: PortraitId; file: string; shipped: boolean}[] =>
  portraitIds.map(id => ({id, file: portraitFile(id), shipped: hasPortrait(id)}));
