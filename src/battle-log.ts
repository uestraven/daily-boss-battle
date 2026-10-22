/** The battle log: one readable line per thing that happened.
 *
 * In `src/` rather than in the screen because it is the only *textual* account of a fight
 * and that makes it two things at once. It is what a player reads back to understand a
 * turn, and -- since the stage is a `<canvas>` and therefore invisible to a screen reader
 * -- it is the entire accessible representation of the game. Neither job is served by a
 * switch buried in a component that no test can reach.
 *
 * It had grown to cover ten of the engine's twenty-nine event types. The ten were the ones
 * somebody had needed at some point; the omissions included every status change, the phase
 * transition, poison ticks, covers and MP restores. So the log would say "Boss uses
 * Protect" and then fall silent about Protect taking hold -- which is the same complaint as
 * turns that seemed like nothing happened, in the one place built to answer it.
 *
 * `LOGGED` below is the full decision, event type by event type, so a new event type fails
 * the test in `tests/battle-log.test.mjs` until somebody states whether it belongs here.
 *
 * Deliberately *not* gated by disclosure. Everything the log reports has already happened
 * and is already on screen; a mode that hid the written record of a hit it had just
 * animated would be withholding nothing and merely being obtuse. The one thing it must
 * never carry is a *prediction*, which is why `boss_intent` is excluded by name below.
 */
import type {BattleEvent} from './types.js';

export type LogNames = {
  /** Display name per actor id. */
  actors: Record<string, string>;
  /** Display name per ability id. */
  abilities: Record<string, string>;
};

/** Every engine event, and what the log does with it.
 *
 * `null` means deliberately silent, with the reason beside it. A line beginning `·` is a
 * consequence of the action named above it, which is what keeps a multi-target ability from
 * reading as three separate attacks.
 */
type LineFor = (event: BattleEvent, n: {who: (id?: string) => string;
  ability: (id?: string) => string}) => string | null;

const LOGGED: Record<string, LineFor | null> = {
  // --- actions ------------------------------------------------------------------------
  // Naming the action is what makes a multi-target ability legible: Flywheel Sweep hits all
  // three heroes, and without this its three damage lines read as three separate attacks.
  action_committed: (e, n) => `${n.who(e.actorId)} uses ${n.ability(e.abilityId)}`,
  channel_started: (e, n) => `${n.who(e.actorId)} begins ${n.ability(e.abilityId)}`,
  channel_resolved: (e, n) => `${n.ability(e.abilityId)} lands`,

  // --- outcomes -----------------------------------------------------------------------
  damage: (e, n) => e.amount === 0
    ? `· ${n.who(e.targetId)}: no effect`
    : e.critical
      ? `· ${n.who(e.targetId)}: −${e.amount} CRITICAL`
      : `· ${n.who(e.targetId)}: −${e.amount}`,
  heal: (e, n) => `· ${n.who(e.targetId)}: +${e.amount}`,
  mp_restored: (e, n) => `· ${n.who(e.targetId ?? e.actorId)}: +${e.amount} MP`,
  poison_pulse: (e, n) => `· ${n.who(e.actorId)}: −${e.amount} from poison`,
  ko: (e, n) => `· ${n.who(e.actorId)} is down`,
  revived: (e, n) => `· ${n.who(e.targetId)} is back up`,
  fizzle: () => '· no effect',

  // --- statuses -----------------------------------------------------------------------
  // The largest omission. A status is the one outcome whose whole point is that it persists,
  // so a log that records the cast but not the effect is actively misleading.
  status_applied: (e, n) => `· ${n.who(e.actorId)} gains ${e.status ?? 'a status'}`,
  status_expired: (e, n) => `· ${e.status ?? 'a status'} fades from ${n.who(e.actorId)}`,
  status_removed: (e, n) => `· ${e.status ?? 'a status'} is stripped from `
    + `${n.who(e.targetId ?? e.actorId)}`,

  // --- interference -------------------------------------------------------------------
  nullify_absorb: (e, n) => `· ${n.who(e.actorId)} absorbs it (+${e.amount} MP)`,
  boss_interrupted: (e, n) => `· ${n.who(e.actorId)} interrupts ${n.who(e.targetId)}`,
  cover_set: (e, n) => `· ${n.who(e.actorId)} will cover ${n.who(e.targetId)}`,
  cover_redirect: (e, n) => `· ${n.who(e.actorId)} takes the hit for ${n.who(e.targetId)}`,
  steal_success: (e, n) => `· ${n.who(e.actorId)} steals ${e.details ?? 'an item'}`,

  // --- the boss's own turn ------------------------------------------------------------
  phase_change: (e, n) => `${n.who(e.actorId)} changes form`,
  boss_fallback: (e, n) => `· ${n.who(e.actorId)} cannot muster its attack`,

  // --- the end ------------------------------------------------------------------------
  victory: () => 'Victory',
  defeat: () => 'Defeat',

  // --- deliberately silent ------------------------------------------------------------
  // A prediction, not a result. The log is a record of what happened, and `boss_intent` is
  // a statement about what has not happened yet -- which Normal mode exists to withhold and
  // Easy already shows in the telegraph panel. Logging it would leak it into both modes.
  boss_intent: null,
  boss_intent_changed: null,
  // Pure bookkeeping, with no consequence a player could act on. Each is either an internal
  // counter or the mechanical half of something already logged above.
  ready: null,
  momentum: null,
  boss_counter_queued: null,
  focus_consumed: null,
  elemental_edge_consumed: null,
};

/** Event types the log knows about, for the test that checks none has been forgotten. */
export const LOGGED_EVENT_TYPES: readonly string[] = Object.keys(LOGGED);

/** Event types deliberately not written to the log. */
export const SILENT_EVENT_TYPES: readonly string[] =
  Object.entries(LOGGED).filter(([, v]) => v === null).map(([k]) => k);

/** Lines for one batch of events, oldest first. */
export function logLines(events: readonly BattleEvent[], names: LogNames): string[] {
  const who = (id?: string) => names.actors[id ?? ''] ?? 'Someone';
  const ability = (id?: string) => names.abilities[id ?? ''] ?? id ?? 'something';
  const out: string[] = [];
  for (const event of events) {
    // An unknown event type is skipped rather than throwing: a log is not worth taking a
    // battle down for. The test is what stops one going unnoticed.
    const line = LOGGED[event.type]?.(event, {who, ability});
    if (line) out.push(line);
  }
  return out;
}
