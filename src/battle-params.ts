/** Battle configuration from a query string, for testing any encounter on demand.
 *
 * The daily battle is deliberately not choosable: one encounter per date, the same for
 * everyone, proven winnable by the verified pool. That is right for players and useless
 * for testing presentation, because reaching a phase transition, a KO, a defeat screen or
 * a particular character's animations means waiting for the day that serves them. These
 * parameters address that by naming an encounter directly.
 *
 * Pure, and separate from the screen, so the parsing is unit-tested rather than discovered
 * by typing URLs. It returns `errors` instead of ignoring what it cannot read: a silently
 * dropped typo is the worst outcome here, because the screen would show a *valid* battle
 * that simply is not the one asked for, and the mistake would be invisible.
 *
 * Nothing here can affect a real result. The screen runs every sandbox battle through the
 * unranked path that already exists for replays, so the ledger is never written -- see
 * `SANDBOX` in DailyBattle.tsx. Mode is presentation-only by construction, so it is safe
 * to set from a URL for the same reason it is safe to set from the landing screen.
 */
import type {BattleMode} from './types.js';

export type SandboxRequest = {
  /** Boss to fight. Validated by `buildEncounter`, which knows the roster. */
  bossId?: string;
  /** Exactly three distinct hero ids. Also validated by `buildEncounter`. */
  party?: string[];
  /** Which day's verified encounter to serve, instead of today's. */
  day?: string;
  /** Boss HP as a fraction of max, applied to the opening state. */
  bossHpFraction?: number;
  /** Every hero's HP as a fraction of max, for reaching KO and defeat presentation. */
  partyHpFraction?: number;
  /** Sets the boss just *above* its phase-two threshold, so the next hit triggers the
   * transition. Above rather than below because the flash and the music change are driven
   * by the `phase_change` event, which only fires when damage crosses the line -- parking
   * the boss below the threshold would skip the very thing being tested. */
  poisedForPhaseTwo?: boolean;
  /** Overrides the stored mode, so Easy and Normal are both reachable from a link. */
  mode?: BattleMode;
};

export type BattleParams = {
  /** Null when no configuration parameter is present, which is the normal daily path. */
  sandbox: SandboxRequest | null;
  /** Human-readable problems. A non-empty list means something was asked for and not
   * honoured, which the screen should surface rather than quietly play a different fight. */
  errors: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a percentage in 1..100 and returns it as a fraction. */
function percent(raw: string, name: string, errors: string[]): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    errors.push(`${name}=${raw} is not a percentage between 1 and 100`);
    return undefined;
  }
  return value / 100;
}

/** Parses the battle-configuration parameters out of a query string.
 *
 * Accepts the string with or without a leading `?`. Unknown parameters are ignored
 * entirely rather than reported: the screen has several of its own (`dev`, `speed`,
 * `studio`), and a shared link may carry campaign parameters that are none of its
 * business. Only *malformed values for parameters it owns* are errors. */
/** Minimal query-string reader.
 *
 * Deliberately not `URLSearchParams`: this module is part of the engine side, which
 * compiles without the DOM lib and is meant to run anywhere -- a browser, Node, a future
 * native client. Reaching for a web global here would be the only environment assumption
 * in the whole directory. The subset needed is small and exact. */
function readParams(search: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    const decode = (text: string): string => {
      // `+` means space in a query string, which decodeURIComponent does not know.
      try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; }
    };
    // First occurrence wins, matching URLSearchParams.get.
    const key = decode(rawKey);
    if (!out.has(key)) out.set(key, decode(rawValue));
  }
  return out;
}

export function parseBattleParams(search: string): BattleParams {
  const params = readParams(search);
  const get = (name: string): string | null => params.has(name) ? params.get(name)! : null;
  const errors: string[] = [];
  const request: SandboxRequest = {};

  const boss = get('boss');
  if (boss !== null) {
    if (!boss.trim()) errors.push('boss= is empty');
    else request.bossId = boss.trim();
  }

  const party = get('party');
  if (party !== null) {
    const ids = party.split(',').map((id: string) => id.trim()).filter(Boolean);
    // Checked here as well as in buildEncounter so the message names the parameter. The
    // engine's own error is about a party, which is less useful when the cause is a typo
    // in a URL -- a trailing comma, say.
    if (ids.length !== 3) {
      errors.push(`party=${party} lists ${ids.length} heroes; a party is exactly three`);
    } else if (new Set(ids).size !== ids.length) {
      errors.push(`party=${party} repeats a hero`);
    } else {
      request.party = ids;
    }
  }

  // A party without a boss, or the reverse, is almost certainly a half-finished URL. The
  // alternative is to fill the other half from today's encounter, which would silently
  // produce a fight nobody asked for.
  if (request.bossId && party === null) {
    errors.push('boss= needs party= as well, naming three heroes');
  }
  if (request.party && boss === null) {
    errors.push('party= needs boss= as well');
  }

  const day = get('day');
  if (day !== null) {
    if (!DATE_RE.test(day)) errors.push(`day=${day} is not a YYYY-MM-DD date`);
    else if (Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) {
      errors.push(`day=${day} is not a real date`);
    } else request.day = day;
  }

  const bossHp = get('bosshp');
  if (bossHp !== null) {
    const fraction = percent(bossHp, 'bosshp', errors);
    if (fraction !== undefined) request.bossHpFraction = fraction;
  }

  const partyHp = get('partyhp');
  if (partyHp !== null) {
    const fraction = percent(partyHp, 'partyhp', errors);
    if (fraction !== undefined) request.partyHpFraction = fraction;
  }

  const phase = get('phase');
  if (phase !== null) {
    if (phase === '2') request.poisedForPhaseTwo = true;
    else if (phase === '1') request.poisedForPhaseTwo = false;
    else errors.push(`phase=${phase} is not 1 or 2`);
  }

  const mode = get('mode');
  if (mode !== null) {
    if (mode === 'easy' || mode === 'normal') request.mode = mode;
    else errors.push(`mode=${mode} is not easy or normal`);
  }

  const asked = Object.keys(request).length > 0 || errors.length > 0;
  return {sandbox: asked ? request : null, errors};
}

/** Applies a request's opening state to a battle state, in place on a copy.
 *
 * Lives here rather than in the screen so the one subtle rule in it is testable: `phase=2`
 * sets the boss just *above* its transition threshold, not below. The flash, the hold and
 * the music change are all driven by the `phase_change` event, which fires when damage
 * crosses the line -- so parking the boss below the threshold skips the transition and
 * leaves the thing being tested unobservable. One hit from just above it triggers
 * everything.
 *
 * Takes the threshold as a number rather than reading an EncounterDefinition, so it stays
 * free of the content types and is trivial to call from a test. */
export function applyOpeningState<S extends {
  bossId: string;
  party: string[];
  actors: Record<string, {hp: number; stats: {hp: number}}>;
}>(state: S, request: SandboxRequest, transitionPercent: number): S {
  const next: S = JSON.parse(JSON.stringify(state)) as S;
  const setHp = (id: string, fraction: number): void => {
    const actor = next.actors[id];
    if (!actor) return;
    // Never zero: an actor at 0 HP is a KO the engine never emitted an event for, which
    // would leave the state internally inconsistent.
    actor.hp = Math.max(1, Math.round(actor.stats.hp * fraction));
  };

  if (request.poisedForPhaseTwo) setHp(next.bossId, Math.min(1, (transitionPercent + 2) / 100));
  // An explicit percentage wins over `phase=`, being the more specific instruction.
  if (request.bossHpFraction !== undefined) setHp(next.bossId, request.bossHpFraction);
  if (request.partyHpFraction !== undefined) {
    for (const id of next.party) setHp(id, request.partyHpFraction);
  }
  return next;
}

/** Whether a request changes the opening state at all. */
export function seedsOpeningState(request: SandboxRequest): boolean {
  return request.bossHpFraction !== undefined
    || request.partyHpFraction !== undefined
    || request.poisedForPhaseTwo === true;
}

/** Whether a request needs a custom encounter built rather than a day's pool entry. */
export function wantsCustomEncounter(request: SandboxRequest): boolean {
  return Boolean(request.bossId && request.party);
}

/** Whether a request only sets presentation, so the real daily can still be played ranked.
 *
 * `mode` alone is the case that matters: a link that opens the day's own battle in Easy is
 * still that day's battle, and forcing it unranked would mean a tester could never produce
 * a real record through a link. Anything touching the encounter or the opening state makes
 * the attempt unranked. */
export function isPresentationOnly(request: SandboxRequest): boolean {
  return request.mode !== undefined
    && request.bossId === undefined && request.party === undefined
    && request.day === undefined
    && request.bossHpFraction === undefined && request.partyHpFraction === undefined
    && request.poisedForPhaseTwo === undefined;
}
