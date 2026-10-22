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
import type {HeroId} from '../../src/roster.js';
import {mediaUrl} from './media-url.js';

/** Portraits are square and larger than a sprite frame, so a face reads at all. Drawn at
 * 64x64 and displayed at an integer multiple, like everything else on this stage. */
export const PORTRAIT_SIZE = 64;

/** Filename per hero, derived rather than listed: a per-hero line would be a second place
 * to forget a hero. */
export const portraitFile = (id: HeroId): string => `${id}.png`;

/** Heroes whose portrait PNG is actually in `web/public/portraits/`.
 *
 * Empty until the art arrives. Every card falls back to the battle sprite until then, which
 * is why shipping the Codex does not have to wait for twelve images. */
export const shippedPortraits: readonly HeroId[] = [];

export const hasPortrait = (id: HeroId): boolean => shippedPortraits.includes(id);

export const portraitUrl = (id: HeroId): string => mediaUrl('portraits', portraitFile(id));

/** The commissioning list: every hero, and whether its portrait exists. */
export const portraitStatus = (): {id: HeroId; file: string; shipped: boolean}[] =>
  heroIds.map((id: HeroId) => ({id, file: portraitFile(id), shipped: hasPortrait(id)}));
