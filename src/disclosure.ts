/** What each battle mode is allowed to show the player.
 *
 * Easy and Normal differ only in *disclosure*. Everything Easy adds is information the
 * interface already holds; neither mode changes a single number in the fight, which is
 * what keeps the verified pool's winnability proof valid for both and lets a replay from
 * either mode verify against the same action log.
 *
 * This exists as a table rather than a boolean because a boolean did not work. The screen
 * had one `reveals` flag whose comment said "the whole difficulty policy, in one place"
 * and listed four things hanging off it -- and the action preview, which prints the exact
 * damage an ability will do and names the boss's newly announced attack, was a fifth that
 * nobody had enumerated. It showed in Normal for as long as the mode existed. A flag
 * cannot tell you what you forgot to attach to it; a record of named fields can, because
 * adding a field forces a decision for every mode and the test below fails until both are
 * filled in.
 *
 * So: when a new piece of information reaches the player, add a field here first.
 *
 * "Reaches the player", not "appears on screen" -- which is what this said, and the
 * wording cost us. Audio is a disclosure channel too, and because it is not on screen it
 * was never checked against this table: Normal mode hid the status badges and the boss's
 * announced action, then played a status chime and a 0.7-gain telegraph sting anyway, so a
 * player could hear the boss commit to something and count ticks from it. `CUE_DISCLOSURE`
 * in src/audio.ts now maps the affected cues onto the fields below, and an audio test
 * fails when a new sound plays in both modes without a decision being recorded.
 */
import type {BattleMode} from './types.js';

export type Disclosure = {
  /** The persistent status badges on actors: poison, buffs, debuffs, and how long each
   * has left. Predictive information -- it is what lets a player plan around a duration. */
  statuses: boolean;
  /** The announcement that a status was *just applied or has just expired*, as a popup on
   * the actor and a chime.
   *
   * Separate from `statuses` because the two are different kinds of information, and
   * conflating them made Normal mode inexplicable. A badge tells you Protect is up and has
   * nine ticks left; this tells you Protect went up at all. Gated together, a boss could
   * buff itself in Normal with nothing on screen, no sound, and no telegraph -- the
   * player's damage simply fell by a quarter for no stated reason.
   *
   * That is the one outcome in the game that behaved like this. A nullified spell announces
   * itself in both modes, so does an interrupted cast, and a zero-damage hit prints NO
   * EFFECT in Normal precisely because it is the only way the player ever learns an element
   * does nothing here. The rule those follow is: Normal withholds *predictions*, never
   * *results*. Status events are results.
   *
   * True in both modes today. The field exists anyway, because this file's contract is that
   * a mode must state a position on every piece of information that reaches the player --
   * and a harder mode is on the backlog that may well want to withhold it. */
  statusEvents: boolean;
  /** The boss's announced next action, its targets, and the tick countdown. */
  telegraph: boolean;
  /** The boss's elemental resistances and weaknesses. */
  affinities: boolean;
  /** The NO EFFECT marker on an ability that would do nothing to this boss. */
  noEffect: boolean;
  /** The pre-commit preview panel: exact damage and healing figures for the action about
   * to be taken, any status it would apply, and whether it provokes the boss into
   * announcing something new. All of it is derived from the live fight state, so it is the
   * single biggest disclosure in the interface -- it answers "what will this do" without
   * the player having to find out. */
  actionPreview: boolean;
};

/** Easy reveals everything the interface knows; Normal withholds the predictions.
 *
 * Not "withholds all of it", which is what this said and what the table used to do. Normal
 * keeps back what would let a player plan -- the telegraph, the badges with their durations,
 * affinities, the damage preview -- and still reports what actually happened. See
 * `statusEvents` for the case that proved the distinction matters.
 *
 * Deliberately total rather than a partial override of a default: a mode has to state a
 * position on every field, so a new field cannot default its way into the harder mode. */
const DISCLOSURE: Record<BattleMode, Disclosure> = {
  easy: {
    statuses: true,
    statusEvents: true,
    telegraph: true,
    affinities: true,
    noEffect: true,
    actionPreview: true,
  },
  normal: {
    statuses: false,
    // Deliberately on. Hiding the badge keeps the planning information back; hiding the
    // announcement as well left the player's damage dropping with no stated cause.
    statusEvents: true,
    telegraph: false,
    affinities: false,
    noEffect: false,
    actionPreview: false,
  },
};

export function disclosureFor(mode: BattleMode): Disclosure {
  return DISCLOSURE[mode];
}

/** Every field name, for tests and for anything that wants to enumerate the policy. */
export const DISCLOSURE_FIELDS = Object.keys(DISCLOSURE.easy) as (keyof Disclosure)[];
