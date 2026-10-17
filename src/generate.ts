/** Encounter generation: build a playable encounter from any boss and any party.
 *
 * The curated `practice-*-v09` encounters stay frozen as the regression corpus —
 * their witnesses and seeds are vetted. Generated encounters are new content with
 * their own ids, drawn from the same boss and hero data, and are only published
 * after passing the gates in `gates.ts`.
 */
import {bossProfiles} from './encounters.js';
import {reference001} from './reference.js';
import {heroes, heroAbilities} from './roster.js';
import type {BossProfile} from './encounters.js';
import type {ActorId, EncounterDefinition, EnrageConfig} from './types.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const CONTENT_VERSION = '1.0-generated';
export const ENGINE_VERSION = '0.2.0-ai-opt-in';

/** Universal commands plus every hero signature ability. Filtering per party is
 * unnecessary: the engine validates ability ownership on every action. */
const abilityBook = {
  ...clone(reference001.abilities),
  ...Object.fromEntries(heroAbilities.map(a => [a.id, a])),
};

export const bossById: Record<string, BossProfile> =
  Object.fromEntries(bossProfiles.map(b => [b.id, b]));
export const bossIds: string[] = bossProfiles.map(b => b.id).sort();

function mix32(v: number): number {
  v = (v ^ v >>> 16) >>> 0; v = Math.imul(v, 0x7feb352d) >>> 0;
  v = (v ^ v >>> 15) >>> 0; v = Math.imul(v, 0x846ca68b) >>> 0;
  return (v ^ v >>> 16) >>> 0;
}
/** Per-combination boss PRNG seed, so the same boss does not reuse one targeting
 * pattern against every party. Deterministic: a combination always plays the same. */
export function encounterSeed(bossSeed: number, party: readonly ActorId[]): number {
  let h = (2166136261 ^ bossSeed) >>> 0;
  for (const ch of party.join(',')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return mix32(h);
}

export const encounterIdFor = (bossId: string, party: readonly ActorId[]): string =>
  `gen-${bossId}-${[...party].join('-')}`;

export type GenerateOptions = {
  id?: string;
  contentVersion?: string;
  /** Overrides the boss's own enrage curve; `null` disables enrage entirely. */
  enrage?: EnrageConfig | null;
  maxTicks?: number;
};

/** Builds an encounter for any boss and any three-hero party. Throws on unknown ids
 * or a wrong-sized party rather than silently producing an unplayable definition. */
export function buildEncounter(
  boss: BossProfile | string,
  party: readonly ActorId[],
  options: GenerateOptions = {},
): EncounterDefinition {
  const profile = typeof boss === 'string' ? bossById[boss] : boss;
  if (!profile) throw new Error(`Unknown boss: ${String(boss)}`);
  if (party.length !== 3) throw new Error(`A party must be exactly three heroes, got ${party.length}`);
  if (new Set(party).size !== party.length) throw new Error('A party must not repeat a hero');

  const actors: EncounterDefinition['actors'] = {};
  for (const id of party) {
    const hero = heroes.find(h => h.id === id);
    if (!hero) throw new Error(`Unknown hero: ${id}`);
    actors[id] = {
      name: hero.name,
      stats: clone(hero.stats),
      ...(hero.momentumCap ? {momentumCap: hero.momentumCap} : {}),
    };
  }
  if (party.includes(profile.id)) throw new Error(`Hero id collides with boss id: ${profile.id}`);
  actors[profile.id] = {name: profile.name, stats: clone(profile.stats)};

  const abilities = clone(abilityBook);
  for (const ability of profile.abilities) abilities[ability.id] = clone(ability);

  const bossAI: NonNullable<EncounterDefinition['bossAI']> = {
    seed: encounterSeed(profile.seed, party),
    defaultTarget: {kind: 'random_slot'},
    fallbackAbility: profile.fallback,
    targetRules: clone(profile.targets),
  };
  if (profile.overrides) bossAI.overrides = clone(profile.overrides);
  if (profile.counters) bossAI.counters = clone(profile.counters);

  const affinities: NonNullable<EncounterDefinition['affinities']> = {};
  if (profile.affinities) {
    affinities[profile.id] = {};
    for (const [element, value] of Object.entries(profile.affinities)) {
      if (value === 'weak' || value === 'resist' || value === 'immune') {
        affinities[profile.id]![element as 'fire' | 'ice' | 'lightning'] = value;
      }
    }
  }

  const enrage = options.enrage === null ? undefined : (options.enrage ?? profile.enrage);

  return {
    id: options.id ?? encounterIdFor(profile.id, party),
    engineVersion: ENGINE_VERSION,
    contentVersion: options.contentVersion ?? CONTENT_VERSION,
    party: [...party],
    bossId: profile.id,
    actors,
    abilities,
    inventory: {potion: 2, mana_vial: 1, revive_tonic: 1},
    affinities,
    bossProgram: {
      phaseOne: [...profile.phaseOne],
      phaseOneRepeat: [...profile.phaseOneRepeat],
      phaseTwo: [...profile.phaseTwo],
      phaseTwoRepeat: [...profile.phaseTwoRepeat],
      transitionPercent: profile.transitionPercent,
      fallbackAbility: profile.fallback,
    },
    ...(enrage ? {enrage} : {}),
    bossAI,
    maxTicks: options.maxTicks ?? 2000,
  };
}

/** Stable fingerprint of all content that can change an encounter's behavior.
 * The verified pool records this so CI can detect a stale pool. */
export function contentHash(): string {
  const material = JSON.stringify({
    heroes: heroes.map(h => [h.id, h.name, h.role, h.secondary ?? null, h.stats, h.momentumCap ?? 0]),
    // Sort the abilities themselves rather than mapped pairs: destructuring a pair
    // yields possibly-undefined elements under noUncheckedIndexedAccess.
    heroAbilities: [...heroAbilities].sort((x, y) => (x.id < y.id ? -1 : 1)).map(a => [a.id, a]),
    shared: Object.entries(clone(reference001.abilities)).sort(([a], [b]) => (a < b ? -1 : 1)),
    bosses: bossProfiles.map(b => [
      b.id, b.name, b.stats, b.phaseOne, b.phaseOneRepeat, b.phaseTwo, b.phaseTwoRepeat,
      b.transitionPercent, b.abilities, b.targets, b.affinities ?? null, b.seed, b.fallback,
      b.counters ?? null, b.overrides ?? null, b.enrage ?? null,
    ]),
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
  });
  // FNV-1a over the serialized content; collision risk is irrelevant for staleness detection.
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) h = Math.imul(h ^ material.charCodeAt(i), 16777619) >>> 0;
  return `${(h >>> 0).toString(16).padStart(8, '0')}-${material.length}`;
}
