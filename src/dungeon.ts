/** Dungeon maps: the grid, what blocks it, and how a party moves through it.
 *
 * Pure and engine-free, which is the whole point of putting it here. A dungeon is a
 * *prelude* to a battle rather than a change to one -- see backlog item 10 -- so nothing in
 * this file touches `BattleState`, and the encounter a player eventually reaches is the same
 * verified encounter the daily would have given them. That is what keeps the winnability
 * proof in `gates.ts` valid: it proves each encounter winnable from a fresh start, and
 * walking to a door does not spend any resources.
 *
 * Maps are rows of characters rather than a structured format, because a dungeon is edited
 * by eye. A tile that is wrong is wrong in a way you can see in the source.
 *
 *   # wall      . floor      D boss door      @ start
 *
 * At 16px tiles the stage fits 20x11, which is close to the SNES norm of 16x14 at 256x224,
 * so a room is one screen and needs no scrolling. That is a deliberate limit for now: a
 * scrolling camera is a second problem and this one is worth being sure of first.
 */

export type TileKind = 'wall' | 'floor' | 'door' | 'start';

export type Point = {x: number; y: number};

export type DungeonMap = {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Row-major, `height` strings of `width` characters. */
  rows: readonly string[];
  /** Where the party begins. */
  start: Point;
  /** The boss door. Reaching it ends the dungeon and begins the fight. */
  door: Point;
};

const KIND_BY_CHAR: Record<string, TileKind> = {
  '#': 'wall',
  '.': 'floor',
  D: 'door',
  '@': 'start',
};

/** Reads a map from its rows, refusing anything a renderer or a player could trip over.
 *
 * Fails loudly rather than tolerating a bad map. A dungeon with no door is unfinishable and
 * a ragged one would draw garbage at the edges, and both are the kind of fault that is
 * obvious in a test and baffling on a screen.
 */
export function parseMap(id: string, name: string, rows: readonly string[]): DungeonMap {
  if (rows.length === 0) throw new Error(`${id}: map has no rows`);
  const width = rows[0]!.length;
  if (width === 0) throw new Error(`${id}: map rows are empty`);
  let start: Point | null = null;
  let door: Point | null = null;

  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`${id}: row ${y} is ${row.length} wide, expected ${width}`);
    }
    [...row].forEach((char, x) => {
      const kind = KIND_BY_CHAR[char];
      if (!kind) throw new Error(`${id}: unknown tile '${char}' at ${x},${y}`);
      if (kind === 'start') {
        if (start) throw new Error(`${id}: two start tiles`);
        start = {x, y};
      }
      if (kind === 'door') {
        if (door) throw new Error(`${id}: two boss doors`);
        door = {x, y};
      }
    });
  });

  if (!start) throw new Error(`${id}: no start tile`);
  if (!door) throw new Error(`${id}: no boss door, so the dungeon cannot be finished`);
  return {id, name, width, height: rows.length, rows: [...rows], start, door};
}

export const tileAt = (map: DungeonMap, x: number, y: number): TileKind | null => {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return KIND_BY_CHAR[map.rows[y]![x]!] ?? null;
};

/** Whether the party can stand here.
 *
 * The door is walkable: stepping onto it is how the dungeon ends, and a door you bump into
 * would need a separate "interact" verb for no gain. Off-map is not walkable, so the edge of
 * the map is a wall whether or not it was drawn as one -- a map missing its border is then a
 * cosmetic fault rather than a way to walk into the void. */
export function isWalkable(map: DungeonMap, x: number, y: number): boolean {
  const kind = tileAt(map, x, y);
  return kind === 'floor' || kind === 'start' || kind === 'door';
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const STEPS: Record<Direction, Point> = {
  up: {x: 0, y: -1},
  down: {x: 0, y: 1},
  left: {x: -1, y: 0},
  right: {x: 1, y: 0},
};

/** One step, or the same position if something is in the way.
 *
 * Returns the facing regardless of whether the step succeeded, because turning to face a
 * wall you just walked into is what every game of this kind does and its absence reads as
 * the input being dropped. */
export function step(map: DungeonMap, from: Point, direction: Direction):
  {position: Point; facing: Direction; blocked: boolean} {
  const delta = STEPS[direction];
  const next = {x: from.x + delta.x, y: from.y + delta.y};
  if (!isWalkable(map, next.x, next.y)) {
    return {position: from, facing: direction, blocked: true};
  }
  return {position: next, facing: direction, blocked: false};
}

export const atDoor = (map: DungeonMap, at: Point): boolean =>
  at.x === map.door.x && at.y === map.door.y;

/** Whether every floor tile can actually be reached from the start, and the door with them.
 *
 * A flood fill, run by the test rather than at load. A sealed-off door is the one map fault
 * that looks perfectly fine on screen and makes the dungeon unfinishable, which is exactly
 * the shape of bug worth spending a test on. */
export function reachableFrom(map: DungeonMap, from: Point = map.start): Set<string> {
  const seen = new Set<string>();
  const queue: Point[] = [from];
  while (queue.length) {
    const at = queue.pop()!;
    const key = `${at.x},${at.y}`;
    if (seen.has(key) || !isWalkable(map, at.x, at.y)) continue;
    seen.add(key);
    for (const delta of Object.values(STEPS)) {
      queue.push({x: at.x + delta.x, y: at.y + delta.y});
    }
  }
  return seen;
}

/** The first room: one screen, no scrolling, a door at the far end.
 *
 * Hand-authored rather than generated. A generated dungeon is a separate problem and this
 * one is here to answer whether walking to a fight is worth having at all -- which a single
 * honest room answers as well as a hundred.
 */
export const FIRST_ROOM = parseMap('sealed_corridor', 'Sealed Corridor', [
  '####################',
  '#..................#',
  '#.####.#####.####..#',
  '#.#..........#.....#',
  '#.#.####.###.#.###.#',
  '#...#......#...#.D.#',
  '#.###.####.#####.#.#',
  '#.....#..........#.#',
  '#.#####.########.#.#',
  '#@................##',
  '####################',
]);

export const DUNGEONS: readonly DungeonMap[] = [FIRST_ROOM];
