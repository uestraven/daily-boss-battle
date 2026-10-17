/** Pool-backed daily selection.
 *
 * The daily encounter is drawn from the verified pool produced by
 * `tools/generate-pool.mjs`, so a random boss and party are still guaranteed
 * winnable, non-trivial, and solvable more than one way.
 *
 * Every player sees the same encounter for a UTC date: selection is a pure
 * function of the date and the pool.
 *
 * This is the product path. `daily.ts` still carries the six curated templates,
 * which remain as the vetted regression corpus until the client migrates.
 */
import {buildEncounter} from './generate.js';
import type {ActorId, EncounterDefinition} from './types.js';
import type {Tier} from './gates.js';

export type PoolEntry = {
  id: string;
  bossId: string;
  party: ActorId[];
  passed: boolean;
  tier: Tier | null;
  difficulty: {bestStars: number; bestActions: number; bestTick: number;
    distinctStrategies: number; marginPercent: number} | null;
};

export type VerifiedPool = {
  schemaVersion: 1;
  contentHash: string;
  entries: PoolEntry[];
};

const DAY_MS = 86400000;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(day: string): number {
  if (!dateRe.test(day)) throw new Error('Expected YYYY-MM-DD');
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) {
    throw new Error('Invalid UTC date');
  }
  return Math.floor(timestamp / DAY_MS);
}

function mix32(v: number): number {
  v = (v ^ v >>> 16) >>> 0; v = Math.imul(v, 0x7feb352d) >>> 0;
  v = (v ^ v >>> 15) >>> 0; v = Math.imul(v, 0x846ca68b) >>> 0;
  return (v ^ v >>> 16) >>> 0;
}
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Seeded Fisher-Yates. Returns a fresh permutation; never mutates the input. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = mix32(state + 0x9e3779b9);
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** How many days must separate two appearances of the same boss. */
export const MIN_BOSS_GAP = 3;

/** One permutation of the boss list per cycle, so each boss appears exactly once
 * per cycle.
 *
 * A plain per-cycle shuffle can place a boss near the end of one cycle and near
 * the start of the next, which shipped the identical fight two days apart. The
 * fix repairs collisions by swapping only within the first K positions, drawing
 * replacements from the middle. The last K entries are therefore never touched,
 * so one cycle's tail does not depend on the repair applied to it — which is what
 * makes this consistent rather than circular. */
function cycleOrder(bossIds: readonly string[], cycle: number): string[] {
  const size = bossIds.length;
  const seedFor = (c: number) => mix32(stableHash('daily-boss-rotation') ^ mix32(c));
  if (size < 4) return shuffle(bossIds, seedFor(cycle));

  const guard = Math.min(MIN_BOSS_GAP - 1, Math.floor((size - 1) / 2));
  const order = shuffle(bossIds, seedFor(cycle));
  // The previous cycle's tail is its unrepaired tail, by the invariant above.
  const previousTail = new Set(shuffle(bossIds, seedFor(cycle - 1)).slice(size - guard));

  for (let i = 0; i < guard; i++) {
    if (!previousTail.has(order[i]!)) continue;
    for (let j = guard; j < size - guard; j++) {
      if (previousTail.has(order[j]!)) continue;
      [order[i], order[j]] = [order[j]!, order[i]!];
      break;
    }
  }
  return order;
}

/** The boss for a UTC date. Each boss appears once per cycle, never on back-to-back days. */
export function dailyBossFor(day: string, bossIds: readonly string[]): string {
  if (!bossIds.length) throw new Error('No bosses available');
  const sorted = [...bossIds].sort();
  const serial = dayNumber(day);
  const size = sorted.length;
  const cycle = Math.floor(serial / size);
  const offset = ((serial % size) + size) % size;
  return cycleOrder(sorted, cycle)[offset]!;
}

/** Target difficulty by weekday: a gentler start, a hard Saturday. */
export const TIER_CURVE: Tier[] = [
  'standard',     // Sunday
  'approachable', // Monday
  'approachable', // Tuesday
  'standard',     // Wednesday
  'standard',     // Thursday
  'standard',     // Friday
  'punishing',    // Saturday
];
export function targetTierFor(day: string): Tier {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return TIER_CURVE[weekday]!;
}

/** The verified encounter for a UTC date, or null if the pool cannot supply one. */
export function selectDaily(day: string, pool: VerifiedPool): PoolEntry | null {
  const playable = pool.entries.filter(e => e.passed);
  if (!playable.length) return null;

  const bossIds = [...new Set(playable.map(e => e.bossId))].sort();
  const bossId = dailyBossFor(day, bossIds);

  const forBoss = playable.filter(e => e.bossId === bossId).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!forBoss.length) return null;

  // Prefer the day's target tier; fall back to the whole set for that boss so a
  // thin pool degrades to "still verified" rather than "no daily at all".
  const target = targetTierFor(day);
  const candidates = forBoss.filter(e => e.tier === target);
  const chooseFrom = candidates.length ? candidates : forBoss;
  const index = mix32(stableHash(`${day}|${bossId}|${pool.contentHash}`)) % chooseFrom.length;
  return chooseFrom[index]!;
}

/** Builds the playable definition for a date. Throws if the pool cannot supply one. */
export function dailyEncounter(day: string, pool: VerifiedPool): EncounterDefinition {
  const entry = selectDaily(day, pool);
  if (!entry) throw new Error(`The verified pool has no encounter available for ${day}`);
  return buildEncounter(entry.bossId, entry.party, {
    id: `daily-${day}-${entry.bossId}`,
    contentVersion: `1.0-pool|${pool.contentHash}`,
  });
}

/** Validates a pool artifact before it is trusted as a content source. */
export function validatePool(input: unknown, expectedContentHash?: string): VerifiedPool {
  if (!input || typeof input !== 'object') throw new Error('Pool is not an object');
  const pool = input as Partial<VerifiedPool>;
  if (pool.schemaVersion !== 1) throw new Error(`Unsupported pool schema: ${String(pool.schemaVersion)}`);
  if (typeof pool.contentHash !== 'string' || !pool.contentHash) throw new Error('Pool is missing a content hash');
  if (!Array.isArray(pool.entries)) throw new Error('Pool has no entries array');
  if (expectedContentHash && pool.contentHash !== expectedContentHash) {
    throw new Error(
      `Pool is stale: built from content ${pool.contentHash}, current content is ${expectedContentHash}. ` +
      'Regenerate with: npm run pool:build');
  }
  for (const entry of pool.entries) {
    if (!entry || typeof entry.id !== 'string') throw new Error('Pool entry is missing an id');
    if (typeof entry.bossId !== 'string') throw new Error(`Pool entry ${entry.id} is missing bossId`);
    if (!Array.isArray(entry.party) || entry.party.length !== 3) {
      throw new Error(`Pool entry ${entry.id} does not have a three-hero party`);
    }
  }
  if (!pool.entries.some(e => e.passed)) throw new Error('Pool contains no passing entries');
  return pool as VerifiedPool;
}
