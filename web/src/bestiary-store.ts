/** Browser persistence for the bestiary.
 *
 * As thin as `storage.ts`, and for the same reason: the logic lives in `src/bestiary.ts`,
 * nothing here is trusted, and `normalizeBestiary` rebuilds every field so a hand-edited
 * entry cannot crash the Codex. A forged bestiary can only reveal content its owner could
 * have seen by playing, so it is not worth defending further than that.
 *
 * Separate key from the ledger, deliberately. The ledger is *this day's* record and is
 * cleared by the dev panel's "Reset day"; the bestiary accumulates across days and should
 * survive that, or testing a fight would wipe the only progression the game has.
 */
import {emptyDiscovery, normalizeBestiary} from '../../dist/src/bestiary.js';
import type {Bestiary, BossDiscovery} from '../../src/bestiary.js';

const KEY = 'daily-boss-battle.bestiary.v1';

export function loadBestiary(knownBossIds: readonly string[]): Bestiary {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    return normalizeBestiary(JSON.parse(raw), knownBossIds);
  } catch {
    return {};
  }
}

/** Persists the bestiary. Failures are swallowed: losing a write costs a line in the Codex,
 * where throwing would cost the battle in progress. */
export function saveBestiary(bestiary: Bestiary): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(bestiary));
    return true;
  } catch {
    return false;
  }
}

export const discoveryFor = (bestiary: Bestiary, bossId: string): BossDiscovery =>
  bestiary[bossId] ?? emptyDiscovery();

/** Dev-panel only: forget everything, to see the undiscovered state again. */
export function clearBestiary(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}
