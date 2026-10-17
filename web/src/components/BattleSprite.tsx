import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { spriteMeta, spriteUrl } from '../sprite-catalog.js';
import type { SpriteKind } from '../sprite-catalog.js';

type Props = {
  kind: SpriteKind;
  actorId: string;
  alt: string;
  className: string;
  fallback: ReactNode;
  overrideUrl?: string;
};

/**
 * Reliable sprite replacement: do not show a broken-image symbol or a blank
 * battlefield when a permitted artwork file hasn't been added to the project.
 * Neither this component nor onLoad/onError changes combat state or timing.
 */
export function BattleSprite({ kind, actorId, alt, className, fallback, overrideUrl }: Props) {
  const meta = spriteMeta(kind, actorId);
  const url = overrideUrl ?? spriteUrl(kind, actorId);
  const [status, setStatus] = useState<'loading'|'ready'|'missing'>('loading');

  useEffect(() => setStatus('loading'), [url]);

  if (!url) return <>{fallback}</>;
  return <>
    {status !== 'ready' && fallback}
    {status !== 'missing' && <img
      key={url}
      className={`${className} rpg-original-sprite ${meta?.pixelArt ? 'rpg-sprite-pixel' : 'rpg-sprite-smooth'}`}
      src={url}
      alt={alt}
      draggable={false}
      loading="eager"
      decoding="async"
      onLoad={() => setStatus('ready')}
      onError={() => setStatus('missing')}
      style={{ display: status === 'ready' ? undefined : 'none' }}
    />}
  </>;
}

/** Use inside the existing boss-zone to preserve all other arena positioning. */
export function BattleBossSprite({ bossId, bossName, fallback }: {
  bossId: string;
  bossName: string;
  fallback: ReactNode;
}) {
  return <BattleSprite
    kind="bosses"
    actorId={bossId}
    alt={`${bossName} — battle sprite`}
    className="boss-figure rpg-boss-sprite-asset"
    fallback={fallback}
  />;
}
