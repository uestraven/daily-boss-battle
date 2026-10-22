/** How each status reads to the player.
 *
 * In `src/` rather than with the web code because two things need it and only one of them
 * is a renderer: the badges on the stage, and `ability-reference.ts`, which explains what
 * an ability's status actually *does*. "Applies surge for 24 ticks" is opaque without the
 * hint beside it, and duplicating these strings to avoid the move would have guaranteed the
 * two copies disagreed. Nothing in here touches the DOM.
 *
 * Typed as a complete `Record<StatusId, ...>`, so adding a status to the engine fails to
 * compile until someone decides what the player sees. Twelve statuses were fully
 * implemented and none were displayed at all, which is the kind of gap a total record
 * prevents from recurring.
 *
 * `tone` groups them for colour rather than naming a colour, so the palette lives in CSS:
 *   buff    — something good, yours or the boss's
 *   debuff  — something bad happening to the holder
 *   charge  — stored potential that will be spent on the next action
 *   hidden  — real state, deliberately not shown
 *
 * Guarding an ally is **not** here: cover lives in `state.covers` as a guardian/protected
 * pair rather than a status, so it needs its own badge and its own timeline handling. Not
 * done; it would be the next thing worth adding.
 */
import type {StatusId} from './types.js';

export type StatusTone = 'buff' | 'debuff' | 'charge' | 'hidden';

export type StatusDisplay = {
  /** Short enough for a badge on a phone. */
  label: string;
  tone: StatusTone;
  /** Shown on hover and as the accessible description. States the mechanical effect,
   * because a badge nobody understands is decoration. */
  hint: string;
};

export const STATUS_DISPLAY: Record<StatusId, StatusDisplay> = {
  protect: {label: 'Protect', tone: 'buff', hint: 'Takes less physical damage'},
  shell: {label: 'Shell', tone: 'buff', hint: 'Takes less magical damage'},
  haste: {label: 'Haste', tone: 'buff', hint: 'Acts more often'},
  defend: {label: 'Defend', tone: 'buff', hint: 'Braced; ends on this character\'s next action'},
  slow: {label: 'Slow', tone: 'debuff', hint: 'Acts less often'},
  poison: {label: 'Poison', tone: 'debuff', hint: 'Loses health over time'},
  silence: {label: 'Silence', tone: 'debuff', hint: 'Cannot cast spells'},
  focus: {label: 'Focus', tone: 'charge', hint: 'Next ability is strengthened, then spent'},
  surge: {label: 'Surge', tone: 'charge', hint: 'Magical damage increased'},
  elemental_edge: {label: 'Edge', tone: 'charge', hint: 'Next attack carries an element, then spent'},
  nullify: {label: 'Nullify', tone: 'charge', hint: 'Absorbs the next spell and converts it to MP'},
  // An internal marker for "mid-channel, so untargetable". The engine deliberately emits
  // no status event for it, and the channelling indicator already communicates the jump.
  airborne: {label: 'Airborne', tone: 'hidden', hint: 'Mid-flight and untargetable'},
};

/** Statuses worth a badge, in the order they should read: what helps, what hurts, then
 * what is stored up. Sorting by tone rather than alphabetically keeps the eye in one place
 * as statuses come and go. */
const TONE_ORDER: Record<StatusTone, number> = {buff: 0, debuff: 1, charge: 2, hidden: 3};

export function visibleStatuses(ids: readonly StatusId[]): StatusId[] {
  return ids
    .filter(id => STATUS_DISPLAY[id].tone !== 'hidden')
    .sort((a, b) => TONE_ORDER[STATUS_DISPLAY[a].tone] - TONE_ORDER[STATUS_DISPLAY[b].tone]
      || (a < b ? -1 : a > b ? 1 : 0));
}
