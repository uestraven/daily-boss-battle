/** Which heroes the player has actually fielded, accumulated across days.
 *
 * The counterpart to `bestiary.ts`, and deliberately much simpler. A boss has to be
 * *studied* -- its affinities are measured by being hit for -- where a hero is simply met:
 * the day hands you three of the twelve, and over a couple of weeks you meet them all.
 *
 * Two deliberate limits on how far this locking goes.
 *
 * It unlocks whole heroes, never individual abilities. The Codex is the only place a Normal
 * player can learn what an ability does, since `disclosure.actionPreview` hides the in-battle
 * description -- so requiring someone to cast Fire II before being told what Fire II does
 * would be backwards. Fielding a hero opens their entry complete, reference included.
 *
 * And it hides nothing a player could have used. You can only field the three heroes the
 * day gives you, so a locked entry withholds no decision; the day's own party is treated as
 * met the moment the battle loads, because they are on screen in front of you. That is what
 * separates this from a paywall: it is a record of who you have fought alongside.
 *
 * Stored under its own key rather than folded into the bestiary. The two are saved at the
 * same moment and it was tempting to merge them, but the bestiary already ships with a
 * top-level shape keyed by boss id, and reshaping it to `{bosses, heroes}` would silently
 * normalise every existing record to nothing -- losing the progress this is meant to create.
 */

export type HeroDiscovery = {
  /** Battles this hero has been fielded in, counted when the battle ends. */
  fielded: number;
  /** Of those, the ones that were won. */
  victories: number;
};

export type RosterProgress = Record<string, HeroDiscovery>;

export const emptyHeroDiscovery = (): HeroDiscovery => ({fielded: 0, victories: 0});

/** Whether the player has met this hero at all. */
export const isMet = (d: HeroDiscovery | undefined): boolean => !!d && d.fielded > 0;

/** Records that a party was fielded, once their battle has concluded.
 *
 * Counted on conclusion rather than on load so an abandoned day does not quietly unlock
 * three heroes -- the entry says "fought alongside", and loading a screen is not that. The
 * exception is `seen` below, which is what keeps today's party legible while you play them.
 */
export function observeParty(
  previous: RosterProgress,
  party: readonly string[],
  result: 'victory' | 'defeat',
): RosterProgress {
  const next: RosterProgress = {...previous};
  for (const id of party) {
    const before = next[id] ?? emptyHeroDiscovery();
    next[id] = {
      fielded: before.fielded + 1,
      victories: before.victories + (result === 'victory' ? 1 : 0),
    };
  }
  return next;
}

/** Heroes to treat as unlocked right now: everything recorded, plus the day's own party.
 *
 * The party is included without being *written* to the store, so an abandoned day leaves no
 * trace and yet the three heroes you are looking at are never locked. Keeping the two apart
 * is what lets the record mean "fought alongside" while the screen still makes sense.
 */
export function metHeroes(progress: RosterProgress, todaysParty: readonly string[]): Set<string> {
  const met = new Set<string>(todaysParty);
  for (const [id, d] of Object.entries(progress)) if (isMet(d)) met.add(id);
  return met;
}

/** Rebuilds a stored record field by field, dropping anything forged or malformed.
 *
 * Same stance as the ledger and the bestiary: nothing in storage is trusted. The damage a
 * forged file can do is small -- it reveals a biography its owner would have seen anyway --
 * but a malformed one must not be able to crash the Codex, and "9 wins from 2 battles" must
 * not be able to print.
 */
export function normalizeRosterProgress(
  raw: unknown,
  knownHeroIds: readonly string[],
): RosterProgress {
  const out: RosterProgress = {};
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const id of knownHeroIds) {
    const entry = source[id];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<HeroDiscovery>;
    const fielded = Math.max(0, Math.floor(Number(e.fielded) || 0));
    const victories = Math.max(0, Math.floor(Number(e.victories) || 0));
    out[id] = {fielded, victories: Math.min(victories, fielded)};
  }
  return out;
}
