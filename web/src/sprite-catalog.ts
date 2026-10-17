/** Visual assets only. Does not change any engine or encounter data. */
import manifest from './sprite-manifest.json';

export type SpriteKind = 'heroes' | 'bosses';
export type SpriteMeta = {
  name: string;
  file: string;
  pixelArt: boolean;
};

type ManifestSection = Record<string, SpriteMeta>;
const sections: Record<SpriteKind, ManifestSection> = {
  heroes: manifest.heroes,
  bosses: manifest.bosses
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
