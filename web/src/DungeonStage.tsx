/** Draws a dungeon room, on the same canvas terms as the battle stage.
 *
 * 16px tiles into the stage's 320x180, which is 20x11 visible and one screen per room. Same
 * whole-number scaling as `BattleStage`, so the two screens sit at identical pixel sizes and
 * switching between them does not resize the game.
 *
 * ### Walls are two tiles doing one job
 *
 * A top-down dungeon wall is seen from two angles at once: its top surface, and the vertical
 * face turned toward the player. Which to draw is decided by the tile *below*: a wall with
 * floor beneath it shows its face, and a wall with more wall beneath it shows its top. That
 * one rule is what makes a flat grid read as having height, and it is why the tileset needed
 * `wall_top` and `wall_face` as separate pieces rather than one wall tile.
 *
 * ### The party marker is a placeholder, deliberately
 *
 * The hero sheets are *battle* sheets: `walk` is a side-on approach and there is no
 * 4-directional overworld cycle in the roster. A 48x40 battle frame against a 16px tile is
 * 2.2 tiles tall, so using one would be worse than an honest placeholder. This draws a
 * marker that shows position and facing, which is all that movement needs to be testable --
 * the same arrangement that let the Codex ship before any portrait existed.
 */
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {atDoor, tileAt} from '../../dist/src/dungeon.js';
import type {Direction, DungeonMap, Point} from '../../src/dungeon.js';
import {mediaUrl} from './media-url.js';

export const TILE = 16;
export const DUNGEON_STAGE = {width: 320, height: 176} as const;

const TILE_FILES = {
  floor: 'floor.png',
  wall_top: 'wall_top.png',
  wall_face: 'wall_face.png',
  door: 'door_closed.png',
} as const;

/** One cache for the four tiles, keyed by URL as the battle stage caches its sheets.
 *
 * Module level so a remount does not refetch, and with a repaint notice so a tile arriving
 * after the first paint is drawn rather than waited for -- the same shape as the sprite
 * cache, and the reason the effects needed prefetching. */
const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

function tileImage(file: string): HTMLImageElement | null {
  const url = mediaUrl('dungeon-tiles', file);
  const cached = cache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const image = new Image();
  image.addEventListener('load', () => { for (const l of listeners) l(); }, {once: true});
  image.src = url;
  cache.set(url, image);
  return null;
}

/** Starts the four tiles loading before a room is drawn.
 *
 * A room is drawn immediately on entering, so an on-demand request would give the first
 * frame an empty floor. Cheap -- 16 KiB for the set -- and exactly the lesson the hit
 * effects taught. */
export function prefetchTiles(): void {
  for (const file of Object.values(TILE_FILES)) tileImage(file);
}

export function DungeonStage({map, at, facing}: {
  map: DungeonMap;
  at: Point;
  facing: Direction;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [loadTick, setLoadTick] = useState(0);

  useEffect(() => {
    const listener = () => setLoadTick(t => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const {width} = wrap.getBoundingClientRect();
      // Whole numbers only, as everywhere else: a fractional scale on a 16px tile grid puts
      // some tiles a pixel wider than their neighbours and the grid becomes visible.
      setScale(Math.max(1, Math.floor(width / DUNGEON_STAGE.width)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    // Black rather than the stage's backdrop: unlit stone is what is behind a dungeon wall,
    // and it means a missing tile reads as dark rather than as a hole.
    context.fillStyle = '#05060b';
    context.fillRect(0, 0, DUNGEON_STAGE.width, DUNGEON_STAGE.height);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const kind = tileAt(map, x, y);
        if (!kind) continue;
        let file: string | null = null;
        if (kind === 'floor' || kind === 'start') file = TILE_FILES.floor;
        else if (kind === 'door') file = TILE_FILES.door;
        else if (kind === 'wall') {
          // The rule that gives a flat grid height: a wall with floor below it is seen from
          // the side, and one with wall below it is seen from above.
          const below = tileAt(map, x, y + 1);
          const facingCamera = below !== 'wall' && below !== null;
          file = facingCamera ? TILE_FILES.wall_face : TILE_FILES.wall_top;
        }
        if (!file) continue;
        const image = tileImage(file);
        if (!image) continue;
        context.drawImage(image, 0, 0, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
      }
    }

    // The party marker. Inset from the tile so the floor shows around it, which is what
    // makes a step read as a step rather than as the whole square changing colour.
    const px = at.x * TILE, py = at.y * TILE;
    context.fillStyle = '#0b0d16';
    context.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
    context.fillStyle = atDoor(map, at) ? '#a6e7bb' : '#e8c886';
    context.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    // Facing, as a notch on the leading edge: without it a marker cannot show which way the
    // last input went, and a blocked step then looks like a dropped input.
    context.fillStyle = '#fff';
    const mid = Math.floor(TILE / 2) - 1;
    if (facing === 'up') context.fillRect(px + mid, py + 2, 2, 2);
    if (facing === 'down') context.fillRect(px + mid, py + TILE - 4, 2, 2);
    if (facing === 'left') context.fillRect(px + 2, py + mid, 2, 2);
    if (facing === 'right') context.fillRect(px + TILE - 4, py + mid, 2, 2);
  }, [map, at, facing, scale, loadTick]);

  return (
    <div className="dungeon-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="dungeon-canvas"
        width={DUNGEON_STAGE.width}
        height={DUNGEON_STAGE.height}
        style={{
          width: DUNGEON_STAGE.width * scale,
          height: DUNGEON_STAGE.height * scale,
        }}
        role="img"
        aria-label={`${map.name}, at ${at.x},${at.y} facing ${facing}`}
      />
    </div>
  );
}
