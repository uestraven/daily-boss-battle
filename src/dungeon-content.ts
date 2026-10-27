/** The dungeons themselves, kept apart from the rules that run them.
 *
 * Separate from `dungeon.ts` for the same reason `lore.ts` is separate from `roster.ts`: one
 * is a mechanism and the other is content, and the worst time to be scrolling past a room
 * layout is while changing how pushing works. Nothing here is code -- every room is data,
 * which is the property that lets puzzles be designed without touching the engine.
 *
 * Authoring, in brief. `#` wall, `.` floor, `@` start, `B` boss door, space is outside the
 * room. Any other uppercase letter is an entity whose id *is* that letter, declared in
 * `legend`, so a rule can name it and the map still reads as a picture. Rooms are at most
 * 20x11, which is one screen; they connect through `exits` rather than scrolling.
 *
 * Several rules on one gate are an OR, so a gate can have two solutions.
 */
import {parseDungeon, parseRoom} from './dungeon.js';

/** Three rooms, one per primitive, as a shape to design against rather than a real dungeon.
 *
 * Each room is deliberately one idea: a block and a plate, a lever, a key and a lock. A real
 * dungeon would combine them, but a demo that combines them cannot tell you which piece
 * feels wrong.
 */
const entry = parseRoom({
  id: 'entry',
  name: 'Sealed Antechamber',
  // Push the block down onto the plate, which opens the gate across the middle.
  terrain: [
    '####################',
    '#@.................#',
    '#..................#',
    '#.....A.....P......#',
    '#..................#',
    '#########G##########',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
  legend: {A: 'block', P: 'plate', G: 'gate'},
  rules: [{opens: 'G', when: {allPressed: ['P']}}],
  exits: [{at: {x: 18, y: 9}, toRoom: 'levers', toAt: {x: 1, y: 1}}],
});

const levers = parseRoom({
  id: 'levers',
  name: 'Hall of Counterweights',
  // Two levers, one gate each, and the key behind them. Either gate reaches the key, so
  // this room has two solutions -- which is what the OR between rules on a gate is for.
  terrain: [
    '####################',
    '#@.................#',
    '#.L..............M.#',
    '#..................#',
    '####G#########H#####',
    '#........K.........#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
  legend: {L: 'lever', M: 'lever', G: 'gate', H: 'gate', K: 'key'},
  rules: [
    {opens: 'G', when: {lever: 'L'}},
    {opens: 'H', when: {lever: 'M'}},
  ],
  exits: [{at: {x: 18, y: 9}, toRoom: 'vault', toAt: {x: 1, y: 1}}],
});

const vault = parseRoom({
  id: 'vault',
  name: 'The Locked Way',
  // The key from the last room opens the way to the boss. Walking into a lock with a key
  // opens it and spends the key; without one, it simply refuses.
  terrain: [
    '####################',
    '#@.................#',
    '#..................#',
    '#..................#',
    '#########X##########',
    '#........B.........#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
  legend: {X: 'lock'},
  rules: [],
  exits: [],
});

export const FIRST_DUNGEON = parseDungeon({
  id: 'sealed_corridor',
  name: 'The Sealed Corridor',
  rooms: [entry, levers, vault],
  firstRoom: 'entry',
});

export const DUNGEONS: readonly ReturnType<typeof parseDungeon>[] = [FIRST_DUNGEON];
