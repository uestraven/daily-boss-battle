/** Dungeon maps: the grid, collision, and the two faults that look fine on screen.
 *
 * The map logic is pure and engine-free on purpose -- a dungeon is a prelude to a battle
 * rather than a change to one -- so all of it is testable here without a DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DUNGEONS, FIRST_ROOM, atDoor, isWalkable, parseMap, reachableFrom, step, tileAt}
  from '../dist/src/dungeon.js';
import {readFileSync} from 'node:fs';

test('a map is read into a grid with a start and a door', () => {
  const m = parseMap('t', 'Test', ['####', '#@.#', '#.D#', '####']);
  assert.deepEqual(m.start, {x: 1, y: 1});
  assert.deepEqual(m.door, {x: 2, y: 2});
  assert.equal(m.width, 4);
  assert.equal(m.height, 4);
});

test('a malformed map fails loudly rather than drawing garbage', () => {
  // Each of these is obvious in a test and baffling on a screen.
  assert.throws(() => parseMap('t', 'T', ['####', '#@.#', '###']), /row 2 is 3 wide/);
  assert.throws(() => parseMap('t', 'T', ['#@#', '#.#']), /no boss door/);
  assert.throws(() => parseMap('t', 'T', ['#D#', '#.#']), /no start tile/);
  assert.throws(() => parseMap('t', 'T', ['#@#', '#D#', '#D#']), /two boss doors/);
  assert.throws(() => parseMap('t', 'T', ['#@#', '#X#', '#D#']), /unknown tile 'X'/);
  assert.throws(() => parseMap('t', 'T', []), /no rows/);
});

test('walls block, floor and the door do not', () => {
  const m = FIRST_ROOM;
  assert.equal(isWalkable(m, m.start.x, m.start.y), true, 'the start must be standable');
  // The door is walkable: stepping onto it is how the dungeon ends, and a door you bump
  // into would need a separate interact verb for no gain.
  assert.equal(isWalkable(m, m.door.x, m.door.y), true);
  assert.equal(tileAt(m, 0, 0), 'wall');
  assert.equal(isWalkable(m, 0, 0), false);
});

test('off the map is solid, whether or not a border was drawn', () => {
  // So a map missing its border is a cosmetic fault rather than a way to walk into the void.
  const m = parseMap('t', 'T', ['@.D']);
  assert.equal(isWalkable(m, -1, 0), false);
  assert.equal(isWalkable(m, 3, 0), false);
  assert.equal(isWalkable(m, 0, -1), false);
  assert.equal(isWalkable(m, 0, 1), false);
});

test('a blocked step keeps the position but still turns', () => {
  // Turning to face a wall you walked into is what every game of this kind does, and its
  // absence reads as the input having been dropped.
  const m = parseMap('t', 'T', ['###', '#@#', '#D#']);
  const result = step(m, m.start, 'left');
  assert.deepEqual(result.position, m.start);
  assert.equal(result.blocked, true);
  assert.equal(result.facing, 'left');
});

test('an open step moves exactly one tile', () => {
  const m = parseMap('t', 'T', ['#####', '#@..#', '#...D', '#####']);
  const right = step(m, m.start, 'right');
  assert.deepEqual(right.position, {x: 2, y: 1});
  assert.equal(right.blocked, false);
  const down = step(m, right.position, 'down');
  assert.deepEqual(down.position, {x: 2, y: 2});
});

test('every walkable tile in a shipped map can be reached from its start', () => {
  // The one map fault that looks perfectly fine on screen and makes the dungeon
  // unfinishable. A flood fill is cheap; discovering a sealed-off door by walking is not.
  for (const map of DUNGEONS) {
    const reached = reachableFrom(map);
    let walkable = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) walkable++;
    }
    assert.equal(reached.size, walkable,
      `${map.id}: ${walkable - reached.size} walkable tiles are sealed off from the start`);
    assert.ok(reached.has(`${map.door.x},${map.door.y}`),
      `${map.id}: the boss door cannot be reached, so the dungeon cannot be finished`);
  }
});

test('a shipped map fits one screen, so no camera is needed yet', () => {
  // 20x11 at 16px tiles is the stage's 320x176. A larger map would need a scrolling camera,
  // which is a second problem and would silently draw only its top-left corner today.
  for (const map of DUNGEONS) {
    assert.ok(map.width <= 20, `${map.id} is ${map.width} tiles wide; the screen fits 20`);
    assert.ok(map.height <= 11, `${map.id} is ${map.height} tiles tall; the screen fits 11`);
  }
});

test('the door is somewhere worth walking to', () => {
  // A door next to the start makes the dungeon a formality. Measured as path distance
  // rather than straight-line, because a door three tiles away around a wall is still three
  // tiles away.
  for (const map of DUNGEONS) {
    const manhattan = Math.abs(map.door.x - map.start.x) + Math.abs(map.door.y - map.start.y);
    assert.ok(manhattan >= 10,
      `${map.id}: the door is ${manhattan} tiles from the start, which is barely a walk`);
  }
});

test('atDoor is true only on the door', () => {
  const m = FIRST_ROOM;
  assert.equal(atDoor(m, m.door), true);
  assert.equal(atDoor(m, m.start), false);
});

test('the dungeon never imports the engine', () => {
  // It is a prelude, not a change to the fight. The moment this module touches BattleState
  // it can spend resources before the boss, and `gates.ts` stops proving what it proves --
  // which is decision 1 of backlog item 10 and the whole reason this design was chosen.
  // Comments stripped first: the module's own header explains that it must not touch
  // BattleState, and reading that explanation as a violation is a test marking its own
  // documentation wrong.
  const source = readFileSync(new URL('../src/dungeon.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['engine.js', 'BattleState', 'EncounterDefinition', 'applyPlayerAction']) {
    assert.ok(!source.includes(forbidden),
      `dungeon.ts references ${forbidden}; walking must not be able to touch the fight`);
  }
});
