/** Browser persistence for the daily ledger.
 *
 * Deliberately thin: all integrity lives in `src/daily.ts`, which recomputes every
 * record by replaying its action log. Nothing here is trusted — a hand-edited
 * localStorage entry cannot manufacture a result, it just fails normalisation and is
 * dropped. Results remain local and unverified until there is a server; the UI says so.
 */
import {emptyLedger, normalizeLedger} from '../../dist/src/daily.js';
import type {DailyCatalog, DailyLedger} from '../../src/daily.js';

const KEY = 'daily-boss-battle.ledger.v1';

/** Loads and validates the stored ledger. Any problem yields an empty ledger rather
 * than throwing, so a corrupt entry can never brick the app. */
export function loadLedger(catalog: DailyCatalog): DailyLedger {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyLedger();
    return normalizeLedger(JSON.parse(raw), catalog);
  } catch {
    return emptyLedger();
  }
}

/** Persists the ledger. Storage can fail (private mode, quota), and losing a write is
 * preferable to losing the battle in progress, so failures are swallowed. */
export function saveLedger(ledger: DailyLedger): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

/** Used by the dev panel to start the day over. */
export function clearLedger(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}
