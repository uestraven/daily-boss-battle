/** Encounter gates: the definition of "fair, intense, and solvable more than one way".
 *
 * An encounter only reaches players after passing every gate here. This is what lets
 * the daily be genuinely random without being a coin flip, so these are production
 * rules, not a diagnostic script.
 *
 * The solver is a bounded beam heuristic and is never trusted on its own: every
 * winning line it reports is replayed through the authoritative engine before it
 * counts. A gate that cannot be established within budget fails closed.
 */
import {replay, starsForResult} from './engine.js';
import {runBaselinePolicy, solveEncounter} from './solver.js';
import type {BattleInput, EncounterDefinition} from './types.js';

export type GateId =
  | 'winnable'          // G1: a verified three-star line exists
  | 'non_trivial'       // G2: mindless attacking does not master it
  | 'multi_path'        // G3: several structurally different winning lines
  | 'no_forced_ability' // G4: no single ability is load-bearing for every line
  | 'losable'           // G5: a plausible greedy player does not master it
  | 'length_band';      // G6: the fight lasts a session, not a formality

export type GateVerdict = {ok: boolean; detail: string};

export type GateConfig = {
  beamWidth: number;
  maxHeroActions: number;
  maxExpansions: number;
  maxSolutions: number;
  /** Distinct ability-usage sets required among verified wins. */
  minDistinctStrategies: number;
  minActions: number;
  maxActions: number;
  /** How many of the most-used abilities to test for being forced. 0 skips G4. */
  forcedAbilityProbes: number;
};

export const DEFAULT_GATES: GateConfig = {
  beamWidth: 48,
  maxHeroActions: 36,
  maxExpansions: 5000,
  maxSolutions: 12,
  minDistinctStrategies: 3,
  minActions: 12,
  maxActions: 32,
  forcedAbilityProbes: 3,
};

/** Fast configuration for iteration: same gates, smaller budgets, G4 skipped. */
export const QUICK_GATES: GateConfig = {
  ...DEFAULT_GATES,
  maxExpansions: 1800,
  maxSolutions: 6,
  forcedAbilityProbes: 0,
};

export type VerifiedWin = {
  actions: BattleInput[];
  stars: number;
  tick: number;
  heroActions: number;
  /** Sorted unique ability ids. Two wins sharing this are the same strategy reordered. */
  usage: string[];
};

export type Assessment = {
  encounterId: string;
  bossId: string;
  party: string[];
  passed: boolean;
  failedGates: GateId[];
  gates: Record<GateId, GateVerdict>;
  difficulty: {
    bestStars: number;
    bestActions: number;
    bestTick: number;
    distinctStrategies: number;
    /** Party HP remaining on the best line, as a percentage. Lower means tighter. */
    marginPercent: number;
  } | null;
  /** Shortest verified three-star line, retained as the encounter's proof of fairness. */
  witness: BattleInput[] | null;
  cost: {expansions: number; solverRuns: number};
};

const usageOf = (actions: BattleInput[]): string[] =>
  [...new Set(actions.map(a => a.abilityId))].sort();

/** Replays a solver line through the engine and rejects any disagreement. */
function verify(def: EncounterDefinition, actions: BattleInput[]): VerifiedWin | null {
  const state = replay(def, actions).state;
  if (state.result !== 'victory') return null;
  return {
    actions,
    stars: starsForResult(state),
    tick: state.tick,
    heroActions: state.heroActionCount,
    usage: usageOf(actions),
  };
}

function searchWins(
  def: EncounterDefinition,
  cfg: GateConfig,
  forbiddenAbilities: string[] = [],
): {wins: VerifiedWin[]; expansions: number} {
  const report = solveEncounter(def, {
    beamWidth: cfg.beamWidth,
    maxHeroActions: cfg.maxHeroActions,
    maxExpansions: cfg.maxExpansions,
    maxSolutions: cfg.maxSolutions,
    forbiddenAbilities,
  });
  const wins: VerifiedWin[] = [];
  for (const solution of report.solutions) {
    const verified = verify(def, solution.actions);
    if (!verified) throw new Error(`Solver reported a win that failed engine replay: ${def.id}`);
    if (verified.stars !== solution.stars || verified.tick !== solution.tick) {
      throw new Error(`Solver and engine disagree on outcome: ${def.id}`);
    }
    wins.push(verified);
  }
  return {wins, expansions: report.expanded};
}

/** Runs every gate against one encounter. Pure and deterministic. */
export function assessEncounter(def: EncounterDefinition, config: Partial<GateConfig> = {}): Assessment {
  const cfg: GateConfig = {...DEFAULT_GATES, ...config};
  const gates = {} as Record<GateId, GateVerdict>;
  let solverRuns = 0;
  let expansions = 0;

  // --- G1 winnable -------------------------------------------------------------
  const base = searchWins(def, cfg);
  solverRuns++; expansions += base.expansions;
  const threeStar = base.wins.filter(w => w.stars === 3);
  const best = [...threeStar].sort((a, b) => a.heroActions - b.heroActions)[0]
    ?? [...base.wins].sort((a, b) => b.stars - a.stars || a.heroActions - b.heroActions)[0];

  gates.winnable = threeStar.length > 0
    ? {ok: true, detail: `${threeStar.length} verified three-star line(s); shortest ${threeStar.reduce((m, w) => Math.min(m, w.heroActions), 99)} actions`}
    : {ok: false, detail: base.wins.length
        ? `wins found but none reached three stars (best ${Math.max(...base.wins.map(w => w.stars))})`
        : 'no win found within search budget'};

  // Without a verified win the remaining gates are unanswerable: fail closed.
  if (!best) {
    const failed: GateId[] = ['winnable', 'non_trivial', 'multi_path', 'no_forced_ability', 'losable', 'length_band'];
    for (const id of failed) gates[id] ??= {ok: false, detail: 'not evaluated: no verified win'};
    return {
      encounterId: def.id, bossId: def.bossId, party: [...def.party],
      passed: false, failedGates: failed, gates, difficulty: null, witness: null,
      cost: {expansions, solverRuns},
    };
  }

  // --- G2 non-trivial ----------------------------------------------------------
  const attackOnly = runBaselinePolicy(def, 'attack_only', 120);
  gates.non_trivial = (attackOnly.result !== 'victory' || attackOnly.stars <= 1)
    ? {ok: true, detail: `attack-only: ${attackOnly.result}${attackOnly.result === 'victory' ? ` at ${attackOnly.stars}★` : ''}`}
    : {ok: false, detail: `attack-only mastered it at ${attackOnly.stars}★`};

  // --- G5 losable --------------------------------------------------------------
  const greedy = runBaselinePolicy(def, 'greedy_damage', 120);
  gates.losable = (greedy.result !== 'victory' || greedy.stars < 3)
    ? {ok: true, detail: `greedy: ${greedy.result}${greedy.result === 'victory' ? ` at ${greedy.stars}★` : ''}`}
    : {ok: false, detail: 'a greedy policy reached three stars; no decisions required'};

  // --- G3 multi-path -----------------------------------------------------------
  const distinct = new Set(base.wins.map(w => w.usage.join('+')));
  gates.multi_path = distinct.size >= cfg.minDistinctStrategies
    ? {ok: true, detail: `${distinct.size} distinct ability-usage sets across ${base.wins.length} verified wins`}
    : {ok: false, detail: `only ${distinct.size} distinct strategy/strategies (need ${cfg.minDistinctStrategies})`};

  // --- G6 length band ----------------------------------------------------------
  gates.length_band = (best.heroActions >= cfg.minActions && best.heroActions <= cfg.maxActions)
    ? {ok: true, detail: `best line is ${best.heroActions} actions`}
    : {ok: false, detail: `best line is ${best.heroActions} actions, outside ${cfg.minActions}-${cfg.maxActions}`};

  // --- G4 no forced ability ----------------------------------------------------
  // Forbid each of the most-used signature abilities in turn. If removing one
  // eliminates every win, that ability is the single answer and the fight is a lock.
  if (cfg.forcedAbilityProbes <= 0) {
    gates.no_forced_ability = {ok: true, detail: 'skipped (quick mode)'};
  } else {
    const frequency = new Map<string, number>();
    for (const win of base.wins) for (const id of win.usage) frequency.set(id, (frequency.get(id) ?? 0) + 1);
    const candidates = [...frequency.entries()]
      .filter(([id]) => def.abilities[id] && def.abilities[id]!.owner !== 'any_hero')
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, cfg.forcedAbilityProbes)
      .map(([id]) => id);

    const forced: string[] = [];
    for (const abilityId of candidates) {
      const probe = searchWins(def, cfg, [abilityId]);
      solverRuns++; expansions += probe.expansions;
      if (!probe.wins.length) forced.push(abilityId);
    }
    gates.no_forced_ability = forced.length === 0
      ? {ok: true, detail: candidates.length ? `no single answer among ${candidates.join(', ')}` : 'no signature abilities used'}
      : {ok: false, detail: `forced ability: ${forced.join(', ')} — removing it eliminates every win`};
  }

  const failedGates = (Object.keys(gates) as GateId[]).filter(id => !gates[id].ok);
  const bestState = replay(def, best.actions).state;
  const partyHP = def.party.reduce((n, id) => n + bestState.actors[id]!.hp, 0);
  const partyMax = def.party.reduce((n, id) => n + bestState.actors[id]!.stats.hp, 0);

  return {
    encounterId: def.id,
    bossId: def.bossId,
    party: [...def.party],
    passed: failedGates.length === 0,
    failedGates,
    gates,
    difficulty: {
      bestStars: best.stars,
      bestActions: best.heroActions,
      bestTick: best.tick,
      distinctStrategies: distinct.size,
      marginPercent: Math.round((100 * partyHP) / partyMax),
    },
    witness: best.stars === 3 ? best.actions : null,
    cost: {expansions, solverRuns},
  };
}

/** Difficulty tier used by the daily picker to shape a week's curve.
 *
 * Boundaries are the margin terciles measured across a full pool run (p33 = 20%,
 * p67 = 36% party HP remaining), so the three tiers are roughly equal in size.
 * Absolute thresholds were tried first and produced only 6 `approachable` entries
 * out of 169, which left the gentler weekdays permanently falling back.
 *
 * Re-derive these after a large content retune:
 *   npm run pool:build && node -e "...quantiles of difficulty.marginPercent..."
 */
export type Tier = 'approachable' | 'standard' | 'punishing';
export const TIER_MARGIN_P33 = 20;
export const TIER_MARGIN_P67 = 36;
/** A long fight is punishing however much HP survives it. */
export const TIER_PUNISHING_ACTIONS = 27;
/** An approachable day should also be a short one. */
export const TIER_APPROACHABLE_MAX_ACTIONS = 20;

export function tierFor(a: Assessment): Tier {
  if (!a.difficulty) throw new Error('Cannot tier an encounter with no verified win');
  const {bestActions, marginPercent} = a.difficulty;
  if (marginPercent <= TIER_MARGIN_P33 || bestActions >= TIER_PUNISHING_ACTIONS) return 'punishing';
  if (marginPercent >= TIER_MARGIN_P67 && bestActions <= TIER_APPROACHABLE_MAX_ACTIONS) return 'approachable';
  return 'standard';
}
