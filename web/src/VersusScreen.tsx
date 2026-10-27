/** The matchup screen: boss against party, between pressing Begin and the first turn.
 *
 * Deliberately unskippable, on the Mega Man stage-intro precedent. Those work because they
 * are short, identical every time and visually rewarding, so they become rhythm rather than
 * interruption -- and this is a daily game, where rhythm is the point.
 *
 * What makes an unskippable timed screen defensible rather than merely tolerated is that
 * **nothing here is exclusive to it**. The boss name, the three hero names and all four
 * portraits are on the battle screen and in the Codex seconds later. So a screen reader cut
 * off mid-announcement, or a player who looked away, loses nothing. If anything ever becomes
 * available only on this screen, it stops being decoration and the skip argument returns.
 *
 * No numbers, for the same reason. A matchup screen is a tempting place for a stat block,
 * and boss HP or affinities here would hand Normal mode exactly what `disclosure.affinities`
 * and `disclosure.actionPreview` exist to withhold.
 *
 * It also earns its keep as a loading cover. Sprite sheets, the arena backdrop and the
 * effect sheets all begin loading when the stage first paints; two seconds here is two
 * seconds of warm cache, so the first attack of the fight is the first one that looks
 * right -- the same problem `prefetchEffects` exists to solve, approached from the other
 * end.
 */
import {useEffect, useRef} from 'react';
import {hasPortrait, portraitUrl, PORTRAIT_SIZE} from './portrait-catalog.js';

/** How long the matchup screen holds.
 *
 * 3000ms, matched to the sting rather than chosen. `versus.wav` is 3.304s long but goes
 * inaudible at 2.92s -- 2.88s of bars at 180.30 BPM plus a decay tail -- so 3000 lets it
 * finish and decay with 80ms of quiet before the battle theme takes over. 3400 would add
 * 400ms of silence to every launch; 2600 cut the last note.
 *
 * Measured from the file rather than taken from the table that generated it: the musical
 * length and the file length differ by the tail, and it is the audible end that the screen
 * has to cover. */
export const VERSUS_MS = 3000;

export type VersusCombatant = {id: string; name: string};

export function VersusScreen({boss, party, onDone}: {
  boss: VersusCombatant;
  party: readonly VersusCombatant[];
  onDone: () => void;
}) {
  /** The latest `onDone`, so the timer below can depend on nothing.
   *
   * This is the whole fix for a screen that locked the game. The timer effect originally
   * depended on `onDone`, which the parent passes as an inline arrow -- a new function
   * identity on every render. `DailyBattle` re-renders every 70ms from the interval that
   * drives idle animation, so the effect re-ran twenty times a second, each run clearing its
   * own timer and starting a fresh 2600ms one. It could never fire, and the matchup screen
   * stayed up forever with no way past it.
   *
   * Making the parent's callback stable with `useCallback` would also have fixed it, and it
   * is done there too -- but a screen that traps the player if its parent re-renders is too
   * sharp an edge to leave pointing outward. The ref makes this component correct whatever
   * it is handed. */
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // Empty deps deliberately: the timer is set once, on mount, and nothing about a
    // re-render should restart it. Cleared on unmount so a remount -- the screen rebuilds at
    // local midnight -- cannot leave a timer to fire into a battle already in progress.
    const timer = window.setTimeout(() => done.current?.(), VERSUS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const face = (c: VersusCombatant, className: string) => (
    hasPortrait(c.id)
      ? <img className={className} src={portraitUrl(c.id)} alt=""
          width={PORTRAIT_SIZE} height={PORTRAIT_SIZE} />
      // No portrait is not worth a fallback sprite here: the name carries it, and a
      // half-drawn matchup screen is worse than a plain one.
      : <div className={`${className} is-empty`} aria-hidden="true" />
  );

  return (
    // `role="status"` rather than `alert`: it is an announcement, not an interruption, and
    // assertive would talk over whatever the reader was saying. The whole screen is one
    // sentence so it is announced as a unit instead of four disconnected names.
    <main className="dbb-shell dbb-versus" role="status"
      aria-label={`${boss.name} versus ${party.map(p => p.name).join(', ')}`}>
      <div className="dbb-versus-side is-boss">
        {face(boss, 'dbb-versus-portrait')}
        <p className="dbb-versus-name">{boss.name}</p>
      </div>

      <p className="dbb-versus-vs" aria-hidden="true">VS</p>

      <div className="dbb-versus-side is-party">
        {party.map(hero => (
          <div className="dbb-versus-hero" key={hero.id}>
            {face(hero, 'dbb-versus-portrait is-hero')}
            <p className="dbb-versus-name">{hero.name}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
