/** Dungeon rooms, puzzle pieces, and the rules that connect them.
 *
 * All pure, so all testable here. The two tests that matter most are at the bottom: a
 * breadth-first search proving every shipped dungeon is actually finishable, and a check
 * that the module never touches the battle engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entityAt, initialState, isGateOpen, isOpenGround, isPressed, parseDungeon, parseRoom,
  reachableIgnoringPuzzles, roomById, terrainAt, tryStep, unsolvableGates}
  from '../dist/src/dungeon.js';
import {DUNGEONS, FIRST_DUNGEON} from '../dist/src/dungeon-content.js';

const room = (terrain, legend = {}, rules = [], exits = []) =>
  parseRoom({id: 't', name: 'T', terrain, legend, rules, exits});
/** A one-room dungeon, for exercising a single rule. */
const solo = (terrain, legend, rules) =>
  parseDungeon({id: 'd', name: 'D', rooms: [room(terrain, legend, rules)]});

test('a room is read into terrain, entities and rules', () => {
  const r = room(['#####', '#@.A#', '#...#', '##B##'], {A: 'block'});
  assert.deepEqual(r.start, {x: 1, y: 1});
  assert.deepEqual(r.bossDoor, {x: 2, y: 3});
  assert.deepEqual(r.places.A, {x: 3, y: 1});
  assert.equal(terrainAt(r, 0, 0), '#');
});

test('a malformed room fails loudly rather than drawing garbage', () => {
  // Each of these is obvious here and baffling on screen.
  assert.throws(() => room(['####', '#@B#', '##']), /row 2 is 2 wide/);
  assert.throws(() => room(['#@#', '#Z#', '#B#']), /'Z'.*not in the legend/);
  assert.throws(() => room(['#@A#', '#A.#', '#B.#'], {A: 'block'}), /appears twice/);
  assert.throws(() => room(['#@#', '#B#', '#B#']), /two boss doors/);
  assert.throws(() => room(['#@#', '#?#', '#B#']), /unknown tile '\?'/);
  assert.throws(() => room([]), /no rows/);
  // A room larger than one screen would silently draw only its top-left corner.
  assert.throws(() => room([('#').repeat(21)]), /does not fit the 20x11 screen/);
  // A legend entry with nothing on the map, and a rule naming the wrong kind of thing.
  assert.throws(() => room(['#@B#'], {A: 'block'}), /legend has 'A' but the map does not/);
  assert.throws(() => room(['#@G#', '#..#', '#B.#'], {G: 'gate'},
    [{opens: 'G', when: {allPressed: ['Q']}}]), /names 'Q' as a plate/);
  assert.throws(() => room(['#@P#', '#..#', '#B.#'], {P: 'plate'},
    [{opens: 'P', when: {allPressed: ['P']}}]), /is not a gate/);
});

test('a dungeon needs a start, a boss door, and exits that lead somewhere', () => {
  assert.throws(() => parseDungeon({id: 'd', name: 'D', rooms: []}), /no rooms/);
  assert.throws(() => parseDungeon({id: 'd', name: 'D',
    rooms: [room(['#@.#'])]}), /no boss door anywhere/);
  const a = parseRoom({id: 'a', name: 'A', terrain: ['#@B#'],
    exits: [{at: {x: 2, y: 0}, toRoom: 'nowhere', toAt: {x: 1, y: 0}}]});
  assert.throws(() => parseDungeon({id: 'd', name: 'D', rooms: [a]}),
    /leads to 'nowhere'/);
});

test('a block is pushed, not walked through, and only onto open ground', () => {
  const d = solo(['######', '#@A..#', '#....#', '#...B#', '######'], {A: 'block'});
  const s = initialState(d);
  const pushed = tryStep(d, s, 'right');
  assert.equal(pushed.effect, 'pushed');
  assert.deepEqual(pushed.state.at, {x: 2, y: 1});
  assert.deepEqual(pushed.state.blocks.A, {x: 3, y: 1});
  // Pushed again until the wall stops it, and then the party stops too.
  const again = tryStep(d, pushed.state, 'right');
  assert.equal(again.effect, 'pushed');
  const stuck = tryStep(d, again.state, 'right');
  assert.equal(stuck.effect, 'blocked', 'a block against a wall must not be pushed into it');
  assert.deepEqual(stuck.state.at, again.state.at, 'nor may the party pass through it');
});

test('a plate is pressed by a block or by standing on it, and a gate obeys its rules', () => {
  const d = solo(
    ['########', '#@A.P..#', '#......#', '####G..#', '#.....B#', '########'],
    {A: 'block', P: 'plate', G: 'gate'},
    [{opens: 'G', when: {allPressed: ['P']}}]);
  const r = roomById(d, d.firstRoom);
  let s = initialState(d);
  assert.equal(isPressed(r, s, 'P'), false);
  assert.equal(isGateOpen(r, s, 'G'), false);
  assert.equal(isOpenGround(r, s, r.places.G.x, r.places.G.y), false, 'a shut gate blocks');
  // Two pushes: the block starts at x=2 and the plate is at x=4.
  for (let i = 0; i < 2; i++) s = tryStep(d, s, 'right').state;
  assert.deepEqual(s.blocks.A, r.places.P);
  assert.equal(isPressed(r, s, 'P'), true);
  assert.equal(isGateOpen(r, s, 'G'), true);
  assert.equal(isOpenGround(r, s, r.places.G.x, r.places.G.y), true, 'an open gate does not');
});

test('a lever toggles on entry only, so standing on it does not flap', () => {
  const d = solo(['######', '#@L..#', '#....#', '##G.B#', '######'],
    {L: 'lever', G: 'gate'}, [{opens: 'G', when: {lever: 'L'}}]);
  const r = roomById(d, d.firstRoom);
  let s = initialState(d);
  const on = tryStep(d, s, 'right');
  assert.equal(on.effect, 'lever');
  assert.equal(on.state.levers.L, true);
  assert.equal(isGateOpen(r, on.state, 'G'), true);
  // Stepping off and back on toggles it again; staying put does not.
  const off = tryStep(d, on.state, 'right');
  assert.equal(off.state.levers.L, true, 'walking away must not flip it back');
  const back = tryStep(d, off.state, 'left');
  assert.equal(back.state.levers.L, false, 'stepping on again toggles');
});

test('a key is taken once and a lock spends one', () => {
  const d = solo(['######', '#@K..#', '#....#', '##X.B#', '######'], {K: 'key', X: 'lock'});
  let s = initialState(d);
  const took = tryStep(d, s, 'right');
  assert.equal(took.effect, 'took_key');
  assert.equal(took.state.keys, 1);
  // The key is gone, so walking back over it does not yield a second.
  const again = tryStep(d, tryStep(d, took.state, 'right').state, 'left');
  assert.equal(again.state.keys, 1, 'a key must not be collectable twice');
});

test('a lock refuses without a key and stays open after', () => {
  const d = solo(['######', '#@...#', '#....#', '#X..B#', '######'], {X: 'lock'});
  const r = roomById(d, d.firstRoom);
  const keyless = {...initialState(d), at: {x: 1, y: 2}};
  assert.equal(tryStep(d, keyless, 'down').effect, 'locked');
  const opened = tryStep(d, {...keyless, keys: 1}, 'down');
  assert.equal(opened.effect, 'unlocked');
  assert.equal(opened.state.keys, 0, 'the key is spent');
  assert.equal(isOpenGround(r, opened.state, 1, 3), true, 'and the way stays open');
});

test('leaving a room resets its blocks', () => {
  // A room is one puzzle. Carrying a half-pushed block out and back in is how a puzzle
  // becomes unsolvable with nothing on screen to say so.
  const first = parseRoom({id: 'a', name: 'A',
    terrain: ['######', '#@A..#', '#....#', '######'],
    legend: {A: 'block'},
    exits: [{at: {x: 4, y: 2}, toRoom: 'b', toAt: {x: 1, y: 1}}]});
  const second = parseRoom({id: 'b', name: 'B',
    terrain: ['######', '#...B#', '#....#', '######'],
    exits: [{at: {x: 1, y: 2}, toRoom: 'a', toAt: {x: 1, y: 2}}]});
  const d = parseDungeon({id: 'd', name: 'D', rooms: [first, second], firstRoom: 'a'});
  const home = roomById(d, 'a').places.A;

  let s = initialState(d);
  assert.deepEqual(s.blocks.A, home);
  s = tryStep(d, s, 'right').state;           // push the block one tile
  assert.notDeepEqual(s.blocks.A, home, 'the block should have moved');

  s = tryStep(d, s, 'down').state;            // drop to the exit row
  s = tryStep(d, s, 'right').state;
  const out = tryStep(d, s, 'right');
  assert.equal(out.effect, 'changed_room');
  assert.equal(out.state.room, 'b');

  const back = tryStep(d, out.state, 'down');
  assert.equal(back.effect, 'changed_room');
  assert.equal(back.state.room, 'a');
  assert.deepEqual(back.state.blocks.A, home,
    'returning to a room must rebuild its blocks from the map, not restore where they were '
    + 'left -- a block pushed into a corner would otherwise make the room unsolvable');
});

test('a blocked step still turns to face what stopped it', () => {
  // Otherwise a wall is indistinguishable from a dropped input.
  const d = solo(['###', '#@#', '#B#'], {});
  const out = tryStep(d, initialState(d), 'left');
  assert.equal(out.effect, 'blocked');
  assert.equal(out.state.facing, 'left');
  assert.deepEqual(out.state.at, initialState(d).at);
});

test('reaching the boss door reports it rather than moving on', () => {
  const d = solo(['####', '#@B#', '####'], {});
  assert.equal(tryStep(d, initialState(d), 'right').effect, 'boss_door');
});

test('no shipped room has a gate that nothing can open', () => {
  // A puzzle that cannot be solved looks exactly like one that can.
  for (const dungeon of DUNGEONS) {
    for (const r of dungeon.rooms) {
      assert.deepEqual(unsolvableGates(r), [],
        `${dungeon.id}/${r.id}: gates with no rule: ${unsolvableGates(r).join(', ')}`);
    }
  }
});

test('every shipped room is laid out so a solution could exist', () => {
  // Optimistic: treats gates and locks as passable, so it asks whether the room is
  // *connected* rather than whether it is solved. A pessimistic fill would call every
  // unsolved puzzle broken.
  for (const dungeon of DUNGEONS) {
    for (const r of dungeon.rooms) {
      const from = r.start ?? r.exits[0]?.at ?? {x: 1, y: 1};
      const reached = reachableIgnoringPuzzles(r, from);
      for (const [letter, at] of Object.entries(r.places)) {
        assert.ok(reached.has(`${at.x},${at.y}`),
          `${dungeon.id}/${r.id}: '${letter}' (${r.legend[letter]}) is walled off entirely`);
      }
      if (r.bossDoor) {
        assert.ok(reached.has(`${r.bossDoor.x},${r.bossDoor.y}`),
          `${dungeon.id}/${r.id}: the boss door is walled off`);
      }
    }
  }
});

test('every shipped dungeon is actually finishable', () => {
  // The test this architecture exists to make possible. A breadth-first search over the
  // whole reachable state space -- position, blocks, levers, keys, rooms -- so "solvable"
  // is proven rather than hoped, and a puzzle designed later that cannot be solved fails
  // here rather than being discovered by a player who gave up.
  for (const dungeon of DUNGEONS) {
    const key = s => `${s.room}|${s.at.x},${s.at.y}|${JSON.stringify(s.blocks)}`
      + `|${JSON.stringify(s.levers)}|${s.keys}|${[...s.spent].sort().join(',')}`;
    let frontier = [initialState(dungeon)];
    const seen = new Set([key(frontier[0])]);
    let solved = false;
    for (let depth = 0; depth < 400 && frontier.length && !solved; depth++) {
      const next = [];
      for (const state of frontier) {
        for (const dir of ['up', 'down', 'left', 'right']) {
          const out = tryStep(dungeon, state, dir);
          if (out.effect === 'boss_door') { solved = true; break; }
          const k = key(out.state);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(out.state);
        }
        if (solved) break;
      }
      frontier = next;
    }
    assert.ok(solved,
      `${dungeon.id}: the boss door cannot be reached from the start. Explored ${seen.size} `
      + 'states, which means a puzzle in it has no solution.');
  }
});

test('the dungeon never touches the battle engine', () => {
  // A dungeon is a prelude, not a change to the fight: walking spends nothing, so the
  // encounter behind the door is byte-identical to the daily's and gates.ts still proves
  // what it proves. The moment this module can reach BattleState it can spend resources
  // before the boss. Comments stripped, so the header explaining the rule is not read as
  // breaking it.
  for (const file of ['dungeon.ts', 'dungeon-content.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['engine.js', 'BattleState', 'EncounterDefinition', 'applyPlayerAction']) {
      assert.ok(!source.includes(forbidden), `${file} references ${forbidden}`);
    }
  }
});

test('entityAt reads moved blocks from state and everything else from the map', () => {
  const d = solo(['######', '#@A.P#', '#...B#', '######'], {A: 'block', P: 'plate'});
  const r = roomById(d, d.firstRoom);
  const s = initialState(d);
  assert.equal(entityAt(r, s, 2, 1)?.kind, 'block');
  assert.equal(entityAt(r, s, 4, 1)?.kind, 'plate');
  const after = tryStep(d, s, 'right').state;
  assert.equal(entityAt(r, after, 2, 1), null, 'the block is no longer where it was');
  assert.equal(entityAt(r, after, 3, 1)?.kind, 'block', 'it is where it was pushed to');
});

test('the demo dungeon exercises each primitive at least once', () => {
  // So it stays a shape to design against rather than quietly becoming one idea.
  const kinds = new Set(FIRST_DUNGEON.rooms.flatMap(r => Object.values(r.legend)));
  for (const kind of ['block', 'plate', 'gate', 'lever', 'key', 'lock']) {
    assert.ok(kinds.has(kind), `the demo dungeon no longer demonstrates ${kind}`);
  }
});
