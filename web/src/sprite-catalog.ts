/** Visual assets only. Does not change any engine or encounter data. */
import manifest from './sprite-manifest.json';
import {validateSheet} from '../../dist/src/animation.js';
import type {SpriteSheet} from '../../src/animation.js';

export type SpriteKind = 'heroes' | 'bosses';
/** A manifest entry is an animation sheet plus a display name. Validated by
 * `validateSheet` from src/animation.ts before it is trusted. */
export type SpriteMeta = SpriteSheet & {name: string};

type ManifestSection = Record<string, SpriteMeta>;
const sections: Record<SpriteKind, ManifestSection> = {
  heroes: manifest.heroes as unknown as ManifestSection,
  bosses: manifest.bosses as unknown as ManifestSection,
};

export function spriteMeta(kind: SpriteKind, id: string): SpriteMeta | null {
  return sections[kind][id] ?? null;
}

/** Uses the Vite deployment base so GitHub Pages/subpath builds work too. */
export function spriteUrl(kind: SpriteKind, id: string): string | null {
  const info = spriteMeta(kind, id);
  if (!info) return null;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return `${base}battle-sprites/${info.file}`;
}

/** The validated animation sheet for an actor, or null when the manifest has no entry.
 * Validation happens here so a malformed sheet fails with a specific message at load
 * rather than drawing garbage mid-battle. */
export function spriteSheet(kind: SpriteKind, id: string): SpriteSheet | null {
  const meta = spriteMeta(kind, id);
  if (!meta) return null;
  return validateSheet(meta, `${kind}/${id}`);
}
