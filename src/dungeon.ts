/** Dungeon rooms, puzzle pieces, and the rules that connect them.
 *
 * Pure and engine-free, which is the point of it being here. A dungeon is a *prelude* to a
 * battle rather than a change to one -- backlog item 10, decision 1 -- so nothing in this
 * file may touch the battle engine. Walking and solving spend no HP, MP or items, so the
 * encounter behind the boss door is byte-identical to the one the daily would have given and
 * `gates.ts` still proves exactly what it proved.
 *
 * ### Three layers, because a maze needs no state and a puzzle is nothing but state
 *
 * The first version of this file was a single immutable grid of strings. That is enough for
 * a maze and cannot express a puzzle at all: a switch is on or off, a block has been pushed
 * or has not, a gate is open or shut. So:
 *
 *   terrain    immutable. Walls, floor, where you start, where the boss waits.
 *   entities   things with a position and possibly a state. Blocks, plates, gates, levers,
 *              keys, locks.
 *   rules      declarative links. "Gate G opens when P and Q are both pressed."
 *
 * The split is what lets a puzzle be *authored as data* rather than coded. Nothing in this
 * module knows about any particular puzzle, and adding one requires no code.
 *
 * ### Authoring
 *
 * Terrain is drawn as rows of characters, because a dungeon is edited by eye and a tile that
 * is wrong should be wrong in a way you can see in the source:
 *
 *   #  wall          .  floor         @  start (first room only)
 *   B  boss door     space  void (outside the room; solid)
 *
 * Any uppercase letter other than `B` is an entity, and the letter *is* its id -- so a rule
 * can name it and the map still reads as a picture. `legend` says what each letter is:
 *
 *   terrain: ['########',
 *             '#@..K..#',
 *             '#.####.#',
 *             '#..P..X#',
 *             '####G###'],
 *   legend:  {K: 'key', P: 'plate', X: 'lock', G: 'gate'},
 *   rules:   [{opens: 'G', when: {allPressed: ['P']}}],
 *
 * One room is one screen. The stage fits 20x11 tiles at 16px, and rooms connect through
 * exits rather than scrolling, which is both how most SNES dungeons worked and the reason
 * this needs no camera.
 */

export type Point = {x: number; y: number};
export type Direction = 'up' | 'down' | 'left' | 'right';

export type EntityKind =
  /** Pushed one tile at a time, if the tile beyond is free. Holds a plate down. */
  | 'block'
  /** Pressed while a block or the party stands on it. */
  | 'plate'
  /** Blocks movement until its rules open it. */
  | 'gate'
  /** Toggles when stepped on, and stays as it was left. */
  | 'lever'
  /** Picked up by stepping on it. */
  | 'key'
  /** Blocks movement until opened with any key held. */
  | 'lock';

export type Rule = {
  /** The gate this rule can open. */
  opens: string;
  when:
    | {allPressed: readonly string[]}
    | {anyPressed: readonly string[]}
    | {lever: string};
};

export type Exit = {
  /** The tile that leads out. */
  at: Point;
  /** Room id to arrive in, and where to stand on arrival. */
  toRoom: string;
  toAt: Point;
};

export type DungeonRoom = {
  id: string;
  name: string;
  width: number;
  height: number;
  terrain: readonly string[];
  /** Entity kind per letter. The letter is the entity's id. */
  legend: Readonly<Record<string, EntityKind>>;
  /** Where each entity starts, by letter. */
  places: Readonly<Record<string, Point>>;
  rules: readonly Rule[];
  exits: readonly Exit[];
  start: Point | null;
  bossDoor: Point | null;
};

export type Dungeon = {
  id: string;
  name: string;
  rooms: readonly DungeonRoom[];
  firstRoom: string;
};

/** Everything that can change. Terrain never appears here; that is the whole point.
 *
 * Blocks carry their *current* position rather than an offset, so a room's initial state and
 * a half-solved one are the same shape -- which is what makes a reset mean "rebuild the
 * initial state" rather than "undo a list of moves". */
export type DungeonState = {
  room: string;
  at: Point;
  facing: Direction;
  /** Current position of every block, by letter. */
  blocks: Readonly<Record<string, Point>>;
  /** Which levers are thrown. */
  levers: Readonly<Record<string, boolean>>;
  /** Keys picked up. Keys are interchangeable: a lock needs *a* key, not a specific one,
   * because a dungeon where the wrong key fits nothing is a dungeon about inventory
   * management rather than about the puzzle. */
  keys: number;
  /** Entity letters consumed or opened, so a key is not picked up twice and a lock stays
   * open once opened. */
  spent: readonly string[];
  steps: number;
};

const TERRAIN = {WALL: '#', FLOOR: '.', START: '@', BOSS: 'B', VOID: ' '} as const;

const isEntityChar = (char: string): boolean =>
  char >= 'A' && char <= 'Z' && char !== TERRAIN.BOSS;

/** Reads a room, refusing anything a renderer or a player could trip over.
 *
 * Fails loudly rather than tolerating a bad room. Every check here is for a fault that is
 * obvious in a test and baffling on a screen: a ragged row draws garbage at the edge, an
 * entity letter with no legend entry draws nothing and blocks nothing, and a rule naming a
 * gate that does not exist is a puzzle that cannot be solved.
 */
export function parseRoom(input: {
  id: string;
  name: string;
  terrain: readonly string[];
  legend?: Readonly<Record<string, EntityKind>>;
  rules?: readonly Rule[];
  exits?: readonly Exit[];
}): DungeonRoom {
  const {id, name, terrain} = input;
  const legend = input.legend ?? {};
  const rules = input.rules ?? [];
  const exits = input.exits ?? [];

  if (terrain.length === 0) throw new Error(`${id}: room has no rows`);
  const width = terrain[0]!.length;
  if (width === 0) throw new Error(`${id}: room rows are empty`);
  if (width > 20 || terrain.length > 11) {
    // One room is one screen, which is why there is no camera. A larger room would silently
    // draw only its top-left corner.
    throw new Error(`${id}: ${width}x${terrain.length} does not fit the 20x11 screen`);
  }

  let start: Point | null = null;
  let bossDoor: Point | null = null;
  const places: Record<string, Point> = {};

  terrain.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`${id}: row ${y} is ${row.length} wide, expected ${width}`);
    }
    [...row].forEach((char, x) => {
      if (char === TERRAIN.START) {
        if (start) throw new Error(`${id}: two start tiles`);
        start = {x, y};
        return;
      }
      if (char === TERRAIN.BOSS) {
        if (bossDoor) throw new Error(`${id}: two boss doors`);
        bossDoor = {x, y};
        return;
      }
      if (isEntityChar(char)) {
        if (!legend[char]) throw new Error(`${id}: '${char}' at ${x},${y} is not in the legend`);
        if (places[char]) throw new Error(`${id}: '${char}' appears twice; letters are ids`);
        places[char] = {x, y};
        return;
      }
      if (char !== TERRAIN.WALL && char !== TERRAIN.FLOOR && char !== TERRAIN.VOID) {
        throw new Error(`${id}: unknown tile '${char}' at ${x},${y}`);
      }
    });
  });

  for (const letter of Object.keys(legend)) {
    if (!places[letter]) throw new Error(`${id}: legend has '${letter}' but the map does not`);
  }
  for (const rule of rules) {
    if (legend[rule.opens] !== 'gate') {
      throw new Error(`${id}: rule opens '${rule.opens}', which is not a gate in this room`);
    }
    const named = 'lever' in rule.when ? [rule.when.lever]
      : 'allPressed' in rule.when ? rule.when.allPressed : rule.when.anyPressed;
    for (const letter of named) {
      const kind = legend[letter];
      const wanted = 'lever' in rule.when ? 'lever' : 'plate';
      if (kind !== wanted) {
        throw new Error(`${id}: rule names '${letter}' as a ${wanted}, but it is ${kind ?? 'absent'}`);
      }
    }
  }
  for (const exit of exits) {
    if (exit.at.x < 0 || exit.at.y < 0 || exit.at.x >= width || exit.at.y >= terrain.length) {
      throw new Error(`${id}: exit at ${exit.at.x},${exit.at.y} is outside the room`);
    }
  }

  return {id, name, width, height: terrain.length, terrain: [...terrain], legend,
    places, rules, exits, start, bossDoor};
}

export function parseDungeon(input: {
  id: string; name: string; rooms: readonly DungeonRoom[]; firstRoom?: string;
}): Dungeon {
  const {id, name, rooms} = input;
  if (rooms.length === 0) throw new Error(`${id}: dungeon has no rooms`);
  const byId = new Map(rooms.map(r => [r.id, r]));
  if (byId.size !== rooms.length) throw new Error(`${id}: two rooms share an id`);
  const firstRoom = input.firstRoom ?? rooms.find(r => r.start)?.id;
  if (!firstRoom) throw new Error(`${id}: no room has a start tile`);
  if (!byId.get(firstRoom)?.start) throw new Error(`${id}: first room '${firstRoom}' has no start`);
  if (!rooms.some(r => r.bossDoor)) {
    throw new Error(`${id}: no boss door anywhere, so the dungeon cannot be finished`);
  }
  for (const room of rooms) {
    for (const exit of room.exits) {
      if (!byId.has(exit.toRoom)) {
        throw new Error(`${room.id}: exit leads to '${exit.toRoom}', which does not exist`);
      }
    }
  }
  return {id, name, rooms: [...rooms], firstRoom};
}

export const roomById = (dungeon: Dungeon, id: string): DungeonRoom => {
  const room = dungeon.rooms.find(r => r.id === id);
  if (!room) throw new Error(`${dungeon.id}: no room '${id}'`);
  return room;
};

/** The state a dungeon starts in. Rebuilt rather than undone, which is what makes a reset
 * trivial and a half-solved room the same shape as a fresh one. */
export function initialState(dungeon: Dungeon): DungeonState {
  const room = roomById(dungeon, dungeon.firstRoom);
  return {
    room: room.id,
    at: room.start!,
    facing: 'right',
    blocks: blocksOf(room),
    levers: {},
    keys: 0,
    spent: [],
    steps: 0,
  };
}

/** Starting positions of a room's blocks. */
const blocksOf = (room: DungeonRoom): Record<string, Point> => {
  const out: Record<string, Point> = {};
  for (const [letter, kind] of Object.entries(room.legend)) {
    if (kind === 'block') out[letter] = room.places[letter]!;
  }
  return out;
};

export const terrainAt = (room: DungeonRoom, x: number, y: number): string | null => {
  if (x < 0 || y < 0 || x >= room.width || y >= room.height) return null;
  return room.terrain[y]![x]!;
};

/** The entity standing on a tile, if any -- blocks from state, everything else from the map.
 *
 * Blocks come from state and the rest from `places` because only blocks move. Reading both
 * through one function means a caller never has to remember which. */
export function entityAt(room: DungeonRoom, state: DungeonState, x: number, y: number):
  {letter: string; kind: EntityKind} | null {
  for (const [letter, at] of Object.entries(state.blocks)) {
    if (at.x === x && at.y === y) return {letter, kind: 'block'};
  }
  for (const [letter, at] of Object.entries(room.places)) {
    if (room.legend[letter] === 'block') continue;
    if (at.x === x && at.y === y) {
      if (state.spent.includes(letter)) continue;
      return {letter, kind: room.legend[letter]!};
    }
  }
  return null;
}

/** Whether a plate is held down: by a block, or by the party standing on it. */
export function isPressed(room: DungeonRoom, state: DungeonState, letter: string): boolean {
  const at = room.places[letter];
  if (!at || room.legend[letter] !== 'plate') return false;
  if (state.at.x === at.x && state.at.y === at.y) return true;
  return Object.values(state.blocks).some(b => b.x === at.x && b.y === at.y);
}

/** Whether a gate is open, by its rules. Several rules on one gate are an OR: any satisfied
 * rule opens it, which is what lets a gate have two solutions. */
export function isGateOpen(room: DungeonRoom, state: DungeonState, letter: string): boolean {
  const applicable = room.rules.filter(r => r.opens === letter);
  // A gate with no rules is scenery that never opens, which is a map fault rather than a
  // puzzle -- `parseRoom` cannot catch it because a gate may legitimately be opened by a
  // rule in... no: rules are per room, so this is caught by `unsolvableGates` below.
  if (applicable.length === 0) return false;
  return applicable.some(rule => {
    if ('lever' in rule.when) return state.levers[rule.when.lever] === true;
    if ('allPressed' in rule.when) {
      return rule.when.allPressed.every(p => isPressed(room, state, p));
    }
    return rule.when.anyPressed.some(p => isPressed(room, state, p));
  });
}

/** Gates in a room that no rule can ever open. A puzzle that cannot be solved looks exactly
 * like one that can, so this is for tests rather than for load time. */
export function unsolvableGates(room: DungeonRoom): string[] {
  return Object.entries(room.legend)
    .filter(([letter, kind]) => kind === 'gate' && !room.rules.some(r => r.opens === letter))
    .map(([letter]) => letter);
}

/** Whether the party could stand here. Does not consider blocks: pushing is resolved
 * separately, because "there is a block here" is a different answer from "you cannot go
 * here". */
export function isOpenGround(room: DungeonRoom, state: DungeonState, x: number, y: number):
  boolean {
  const terrain = terrainAt(room, x, y);
  if (terrain === null || terrain === TERRAIN.WALL || terrain === TERRAIN.VOID) return false;
  const entity = entityAt(room, state, x, y);
  if (!entity) return true;
  if (entity.kind === 'gate') return isGateOpen(room, state, entity.letter);
  if (entity.kind === 'lock') return false;      // opened by stepping into it, not walked through
  if (entity.kind === 'block') return false;     // pushed, not walked through
  return true;                                   // plates, levers and keys are standable
}

export type StepOutcome = {
  state: DungeonState;
  /** What the step did, for the screen to narrate. */
  effect: 'moved' | 'blocked' | 'pushed' | 'unlocked' | 'locked' | 'took_key'
    | 'lever' | 'changed_room' | 'boss_door';
};

const STEPS: Record<Direction, Point> = {
  up: {x: 0, y: -1}, down: {x: 0, y: 1}, left: {x: -1, y: 0}, right: {x: 1, y: 0},
};

/** One step, resolved against terrain, entities and rules.
 *
 * Returns the facing even when blocked: turning to face a wall you walked into is what every
 * game of this kind does, and its absence reads as the input having been dropped.
 */
export function tryStep(dungeon: Dungeon, state: DungeonState, direction: Direction):
  StepOutcome {
  const room = roomById(dungeon, state.room);
  const delta = STEPS[direction];
  const target = {x: state.at.x + delta.x, y: state.at.y + delta.y};
  const facing = direction;
  const turned = {...state, facing};

  const entity = entityAt(room, state, target.x, target.y);

  // A block: push it if the tile beyond is clear. Resolved before walkability, because a
  // block is the one thing you move by walking into rather than being stopped by.
  if (entity?.kind === 'block') {
    const beyond = {x: target.x + delta.x, y: target.y + delta.y};
    if (!isOpenGround(room, state, beyond.x, beyond.y)) {
      return {state: turned, effect: 'blocked'};
    }
    const blocks = {...state.blocks, [entity.letter]: beyond};
    return {
      state: {...turned, at: target, blocks, steps: state.steps + 1},
      effect: 'pushed',
    };
  }

  // A lock: opened by walking into it with a key, and it then stays open.
  if (entity?.kind === 'lock') {
    if (state.keys <= 0) return {state: turned, effect: 'locked'};
    return {
      state: {...turned, keys: state.keys - 1, spent: [...state.spent, entity.letter]},
      effect: 'unlocked',
    };
  }

  if (!isOpenGround(room, state, target.x, target.y)) {
    return {state: turned, effect: 'blocked'};
  }

  let next: DungeonState = {...turned, at: target, steps: state.steps + 1};
  let effect: StepOutcome['effect'] = 'moved';

  if (entity?.kind === 'key') {
    next = {...next, keys: next.keys + 1, spent: [...next.spent, entity.letter]};
    effect = 'took_key';
  } else if (entity?.kind === 'lever') {
    // Toggled on entry only, so standing on a lever does not flip it repeatedly.
    next = {...next, levers: {...next.levers, [entity.letter]: !next.levers[entity.letter]}};
    effect = 'lever';
  }

  if (room.bossDoor && target.x === room.bossDoor.x && target.y === room.bossDoor.y) {
    return {state: next, effect: 'boss_door'};
  }

  const exit = room.exits.find(e => e.at.x === target.x && e.at.y === target.y);
  if (exit) {
    const arriving = roomById(dungeon, exit.toRoom);
    return {
      state: {
        ...next,
        room: arriving.id,
        at: exit.toAt,
        // Blocks reset to their starting places on leaving a room. A room is one puzzle, and
        // carrying a half-pushed block out of it and back in is how a puzzle becomes
        // unsolvable with no way to tell.
        blocks: blocksOf(arriving),
      },
      effect: 'changed_room',
    };
  }

  return {state: next, effect};
}

/** Tiles reachable from a point, ignoring puzzle state.
 *
 * Deliberately optimistic: it treats every gate as openable and every lock as unlockable,
 * because it answers "is this room laid out so a solution could exist" rather than "is it
 * solvable now". A pessimistic fill would call every unsolved puzzle broken. */
export function reachableIgnoringPuzzles(room: DungeonRoom, from: Point): Set<string> {
  const seen = new Set<string>();
  const queue: Point[] = [from];
  while (queue.length) {
    const at = queue.pop()!;
    const key = `${at.x},${at.y}`;
    if (seen.has(key)) continue;
    const terrain = terrainAt(room, at.x, at.y);
    if (terrain === null || terrain === TERRAIN.WALL || terrain === TERRAIN.VOID) continue;
    seen.add(key);
    for (const delta of Object.values(STEPS)) {
      queue.push({x: at.x + delta.x, y: at.y + delta.y});
    }
  }
  return seen;
}

export const TERRAIN_CHARS = TERRAIN;
