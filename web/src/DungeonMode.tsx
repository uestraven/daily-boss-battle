/** Dungeon mode: walk a room, reach the boss door, fight what is behind it.
 *
 * The first testable slice of backlog item 10, and deliberately the smallest one that
 * answers the question the item exists to ask -- whether walking to a fight is worth
 * having. No trash encounters, no chests, no items, one hand-authored room.
 *
 * Three of the decisions recorded in that backlog entry are honoured here:
 *
 * **The walk is unrecorded.** Nothing here touches the ledger, so `DailyRecord.inputs`
 * needs no room transitions in it and a replay of the day is unaffected. The fight behind
 * the door is then the ordinary ranked daily, which is right rather than a loophole: see
 * below.
 *
 * **The boss encounter is unchanged.** Walking spends no resources -- no HP, no MP, no items
 * -- so the fight behind the door is byte-identical to the one the daily would have given,
 * and `gates.ts` still proves exactly what it proved. That is what makes this a prelude
 * rather than a rearchitecture, and why the result earned through it is honest.
 *
 * **Its own entry, not the daily.** Reached by `?dungeon`, so it cannot regress the two
 * minute session the landing card promises.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {initialState, roomById, tryStep} from '../../dist/src/dungeon.js';
import {FIRST_DUNGEON} from '../../dist/src/dungeon-content.js';
import type {Direction, DungeonState, StepOutcome} from '../../src/dungeon.js';
import {DungeonStage, prefetchTiles} from './DungeonStage.js';

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

export function DungeonMode({onEnterBoss, onQuit, bossName}: {
  onEnterBoss: () => void;
  onQuit: () => void;
  bossName: string;
}) {
  const dungeon = FIRST_DUNGEON;
  const [state, setState] = useState<DungeonState>(() => initialState(dungeon));
  const [effect, setEffect] = useState<StepOutcome['effect']>('moved');
  const room = roomById(dungeon, state.room);

  /** The latest callbacks, so the key handler never closes over a dead render.
   *
   * The lesson from the matchup screen, which locked the game by capturing a callback that
   * went stale. Here a stale `onEnterBoss` would mean reaching the door did nothing, which
   * in a dungeon with no other way out is the same soft lock wearing a different hat. */
  const enter = useRef(onEnterBoss);
  enter.current = onEnterBoss;
  const quit = useRef(onQuit);
  quit.current = onQuit;

  // A room is drawn the instant this mounts, so an on-demand tile request would give the
  // first frame bare floor. 16 KiB for the four.
  useEffect(() => { prefetchTiles(); }, []);

  const move = useCallback((direction: Direction) => {
    setState(current => {
      const out = tryStep(dungeon, current, direction);
      setEffect(out.effect);
      // Checked here rather than in an effect so it cannot fire twice for one step, which
      // would start two battles.
      if (out.effect === 'boss_door') window.setTimeout(() => enter.current?.(), 260);
      return out.state;
    });
  }, [dungeon]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { quit.current?.(); return; }
      if (event.key === 'r' || event.key === 'R') {
        // A reset, because a pushed block can make a room unsolvable and a player who has
        // done that needs a way out that is not quitting the dungeon. Cheap precisely
        // because state is rebuilt rather than undone.
        setState(initialState(dungeon));
        setEffect('moved');
        return;
      }
      const direction = KEYS[event.key];
      if (!direction) return;
      // Arrow keys scroll a page by default, which on a one-screen room is the difference
      // between walking and the view jumping out from under you.
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, dungeon]);

  const message = effect === 'boss_door' ? `The way is open. ${bossName} waits beyond.`
    : effect === 'locked' ? 'Locked. Something opens this.'
    : effect === 'unlocked' ? 'The lock gives way.'
    : effect === 'took_key' ? 'Took a key.'
    : effect === 'lever' ? 'The mechanism shifts.'
    : effect === 'pushed' ? 'The stone grinds forward.'
    : effect === 'blocked' ? 'Solid stone.'
    : effect === 'changed_room' ? room.name
    : `Find the way down. ${bossName} is somewhere past it.`;

  return (
    <main className="dbb-shell dbb-shell-wide dbb-shell-dungeon">
      <header className="dbb-header">
        <span className="dbb-brand">✦ {dungeon.name}</span>
        <span className="dbb-header-right">
          <span className="dbb-day">
            {room.name} · {state.steps} steps{state.keys > 0 ? ` · ${state.keys} key` : ''}
          </span>
          <button className="dbb-menu-button" aria-label="Reset this room"
            title="Reset this room (R)"
            onClick={() => { setState(initialState(dungeon)); setEffect('moved'); }}>⟲</button>
          <button className="dbb-menu-button" aria-label="Leave the dungeon"
            onClick={() => quit.current?.()}>✕</button>
        </span>
      </header>

      <DungeonStage room={room} state={state} />

      <p className="dungeon-hint" aria-live="polite">{message}</p>

      {/* Touch controls, because a phone has no arrow keys and this is the first screen in
        * the game that needs directional input at all. Laid out as a d-pad rather than a row
        * so a thumb can find them without looking. */}
      <div className="dungeon-pad" role="group" aria-label="Move">
        <button aria-label="Up" onClick={() => move('up')}>▲</button>
        <div className="dungeon-pad-mid">
          <button aria-label="Left" onClick={() => move('left')}>◀</button>
          <button aria-label="Right" onClick={() => move('right')}>▶</button>
        </div>
        <button aria-label="Down" onClick={() => move('down')}>▼</button>
      </div>
    </main>
  );
}
