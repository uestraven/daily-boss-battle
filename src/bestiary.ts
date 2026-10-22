/** What the player has learned about each boss, accumulated across days.
 *
 * Eight bosses with distinct affinities, two-phase programs, counter rules and ability sets,
 * and none of it was discoverable: a player could fight the Storm Keeper six times and never
 * be told it is immune to fire, because Normal hides affinities and nothing records what was
 * seen. The daily format has no progression hook at all, and this is the one the content
 * already supports.
 *
 * Built so it cannot become a disclosure leak. A bestiary that simply listed every affinity
 * would hand Normal exactly what `disclosure.affinities` exists to withhold -- for *today's*
 * boss, mid-fight. So nothing here is derived from the encounter definition. Everything is
 * folded from events the player has already witnessed: you know the Blade Tyrant resists
 * fire because you watched a fire spell land weakly, and until you have, the entry says so.
 * That makes it a record of experience rather than a lookup table, and it is why it can be
 * shown in both modes.
 *
 * Pure and keyed on events, so the fold is testable and the browser half stays a thin
 * localStorage wrapper -- the same split `storage.ts` uses for the ledger.
 */
import type {BattleEvent, Element} from './types.js';

export type BossDiscovery = {
  /** Times this boss has been fought to a conclusion. */
  encounters: number;
  /** Times it has been beaten. */
  victories: number;
  /** Elements the player has actually used against it, and what happened.
   *
   * Keyed by element so a second observation can correct a first: an ability can be resisted
   * by one rule and amplified by another, and the most recent reading is the honest one. */
  affinities: Partial<Record<Element, 'weak' | 'resist' | 'immune' | 'neutral'>>;
  /** Ability ids the boss has been seen to use. */
  abilities: string[];
  /** Whether its second form has ever been reached. */
  phaseTwoSeen: boolean;
};

export type Bestiary = Record<string, BossDiscovery>;

export const emptyDiscovery = (): BossDiscovery =>
  ({encounters: 0, victories: 0, affinities: {}, abilities: [], phaseTwoSeen: false});

/** How a damage number reads as an affinity.
 *
 * Inferred from the *observed* multiplier rather than read from the definition, which is
 * what keeps this a record of what the player saw. Zero damage from a real hit is immunity;
 * the engine's weak and resist steps are x3/2 and x1/2, so the thresholds sit either side
 * with room for the single final rounding floor.
 *
 * `expected` is the damage the same ability would have done with no affinity applied. The
 * caller computes it, because only the caller has the attacker and defender stats -- this
 * module deliberately never sees the encounter.
 */
export function readAffinity(observed: number, expected: number):
  'weak' | 'resist' | 'immune' | 'neutral' | null {
  if (expected <= 0) return null;          // nothing to compare against
  if (observed === 0) return 'immune';
  const ratio = observed / expected;
  if (ratio >= 1.3) return 'weak';
  if (ratio <= 0.7) return 'resist';
  // Deliberately recorded rather than left blank: "you have tried fire and it did nothing
  // special" is information, and an empty row would invite the player to keep testing it.
  return 'neutral';
}

export type Observation = {
  /** Element of the ability that landed, when it had one. */
  element?: Element;
  /** Damage observed, and what it would have been with no affinity. */
  observed?: number;
  expected?: number;
};

/** Folds one battle's events into a boss's record.
 *
 * `elementOf` and `expectedFor` are supplied by the caller for the same reason as above:
 * they need the encounter, and this module must not have it.
 */
export function observeBattle(
  previous: BossDiscovery,
  events: readonly BattleEvent[],
  context: {
    bossId: string;
    /** The element of an ability, if any. */
    elementOf: (abilityId: string) => Element | undefined;
    /** Damage the ability would have done to this boss with no affinity applied. */
    expectedFor: (abilityId: string, targetId: string) => number;
    /** Whether the battle ended in a win. Undefined while it is still running. */
    result?: 'victory' | 'defeat' | null;
  },
): BossDiscovery {
  const next: BossDiscovery = {
    ...previous,
    affinities: {...previous.affinities},
    abilities: [...previous.abilities],
  };

  for (const event of events) {
    if (event.type === 'phase_change' && event.actorId === context.bossId) {
      next.phaseTwoSeen = true;
    }
    // Abilities the boss was seen to use. `action_committed` and `channel_started` are the
    // two ways it begins one; a channelled ability must count from its start, because the
    // player watched it wind up even if the fight ended before it landed.
    if ((event.type === 'action_committed' || event.type === 'channel_started')
      && event.actorId === context.bossId && event.abilityId
      && !next.abilities.includes(event.abilityId)) {
      next.abilities.push(event.abilityId);
    }
    // An element learned by using it. Only hits *on the boss* count: a fire spell that hit a
    // hero says nothing about the boss.
    if (event.type === 'damage' && event.targetId === context.bossId && event.abilityId) {
      const element = context.elementOf(event.abilityId);
      if (element && element !== 'neutral') {
        const reading = readAffinity(event.amount ?? 0,
          context.expectedFor(event.abilityId, event.targetId));
        if (reading) next.affinities[element] = reading;
      }
    }
  }

  if (context.result) {
    next.encounters = previous.encounters + 1;
    if (context.result === 'victory') next.victories = previous.victories + 1;
  }
  next.abilities.sort();
  return next;
}

/** Drops anything a hand-edited store could have invented.
 *
 * Same stance as the ledger: nothing in storage is trusted. A forged bestiary cannot do
 * much harm -- it reveals content the owner could have seen by playing -- but a malformed
 * one must not be able to crash the Codex, so every field is rebuilt rather than spread.
 */
export function normalizeBestiary(raw: unknown, knownBossIds: readonly string[]): Bestiary {
  const out: Bestiary = {};
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  const valid = new Set(['weak', 'resist', 'immune', 'neutral']);
  for (const id of knownBossIds) {
    const entry = source[id];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<BossDiscovery>;
    const affinities: BossDiscovery['affinities'] = {};
    for (const [element, reading] of Object.entries(e.affinities ?? {})) {
      if (typeof reading === 'string' && valid.has(reading)) {
        affinities[element as Element] = reading as 'weak';
      }
    }
    out[id] = {
      encounters: Math.max(0, Math.floor(Number(e.encounters) || 0)),
      victories: Math.max(0, Math.floor(Number(e.victories) || 0)),
      affinities,
      abilities: Array.isArray(e.abilities) ? e.abilities.filter(a => typeof a === 'string').sort() : [],
      phaseTwoSeen: e.phaseTwoSeen === true,
    };
    // Victories cannot exceed encounters; a store claiming otherwise is corrupt, and the
    // Codex would print "9 wins from 2 fights".
    if (out[id]!.victories > out[id]!.encounters) out[id]!.victories = out[id]!.encounters;
  }
  return out;
}

/** Whether anything at all is known about a boss, for choosing between an entry and a
 * silhouette. */
export const isDiscovered = (d: BossDiscovery | undefined): boolean =>
  !!d && (d.encounters > 0 || d.abilities.length > 0 || Object.keys(d.affinities).length > 0);
