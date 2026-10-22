/** Browser persistence for which heroes the player has fielded.
 *
 * As thin as `storage.ts` and `bestiary-store.ts`, and under its own key for the reason
 * recorded in `src/roster-progress.ts`: the bestiary already ships with a shape keyed by
 * boss id, and reshaping it to hold heroes too would normalise every existing record to
 * nothing -- destroying exactly the progress this exists to create.
 */
import {normalizeRosterProgress} from '../../dist/src/roster-progress.js';
import type {RosterProgress} from '../../src/roster-progress.js';

const KEY = 'daily-boss-battle.roster.v1';

export function loadRosterProgress(knownHeroIds: readonly string[]): RosterProgress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    return normalizeRosterProgress(JSON.parse(raw), knownHeroIds);
  } catch {
    return {};
  }
}

/** Failures are swallowed: losing a write costs a Codex entry, throwing costs the battle. */
export function saveRosterProgress(progress: RosterProgress): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** Dev-panel only, alongside "Forget bestiary". */
export function clearRosterProgress(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}
