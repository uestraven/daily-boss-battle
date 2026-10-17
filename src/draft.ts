/** Party drafting: decides which three-hero teams are viable enough to be worth
 * verifying. This is a cheap pre-filter, not a balance guarantee — the guarantee
 * comes from the offline solver gates. Its job is to stop the verifier burning
 * cycles on teams that obviously cannot function (no healing, no way through armor).
 *
 * Capabilities are derived from ability data, never hand-tagged, so a roster or
 * ability change cannot silently desynchronise from the draft rules.
 */
import {reference001} from './reference.js';
import {heroes, heroAbilities} from './roster.js';
import type {Ability, ActorId} from './types.js';

export type Capability = 'sustain' | 'physical' | 'magical' | 'pierce' | 'support' | 'control';

/** Every ability any hero owns, from both the reference encounter and the v0.9 roster. */
export const signatureAbilities: Ability[] = [
  ...Object.values(reference001.abilities),
  ...heroAbilities,
].filter(a => a.owner !== 'any_hero');

function capabilitiesOf(heroId: ActorId): Set<Capability> {
  const owned = signatureAbilities.filter(a => a.owner === heroId);
  const caps = new Set<Capability>();
  for (const a of owned) {
    if (a.kind === 'heal') caps.add('sustain');
    if (a.kind === 'physical' && (a.power ?? 0) > 0) caps.add('physical');
    if (a.kind === 'magical' && (a.power ?? 0) > 0) caps.add('magical');
    if ((a.pierceDefensePercent ?? 0) > 0) caps.add('pierce');
    if (a.kind === 'status' && a.target !== 'self') caps.add('support');
    if (a.kind === 'dispel' || a.kind === 'steal' || a.kind === 'nullify' || a.kind === 'cover') caps.add('control');
  }
  return caps;
}

export const heroCapabilities: Record<ActorId, Capability[]> = Object.fromEntries(
  heroes.map(h => [h.id, [...capabilitiesOf(h.id)].sort()]),
);

function has(party: readonly ActorId[], cap: Capability): boolean {
  return party.some(id => heroCapabilities[id]?.includes(cap));
}

/** Why a party is or is not worth verifying. Reasons are stable strings for test assertions. */
export function inspectParty(party: readonly ActorId[]): {ok: boolean; reasons: string[]} {
  const reasons: string[] = [];
  if (party.length !== 3) reasons.push('party must be exactly three heroes');
  if (new Set(party).size !== party.length) reasons.push('party must not repeat a hero');
  for (const id of party) if (!heroCapabilities[id]) reasons.push(`unknown hero: ${id}`);
  if (reasons.length) return {ok: false, reasons};

  // Without healing, any encounter long enough to be interesting is a coin flip.
  if (!has(party, 'sustain')) reasons.push('no sustain: party cannot heal');
  // Needs a real damage source beyond the universal Attack.
  if (!has(party, 'physical') && !has(party, 'magical')) reasons.push('no signature damage ability');
  // High-defense bosses need either magic or armour penetration to be beatable.
  if (!has(party, 'magical') && !has(party, 'pierce')) reasons.push('no answer to high physical defense');

  const roles = party.map(id => heroes.find(h => h.id === id)!.role);
  if (new Set(roles).size === 1) reasons.push(`all three heroes share the ${roles[0]} role`);

  return {ok: reasons.length === 0, reasons};
}

export const isBalancedParty = (party: readonly ActorId[]): boolean => inspectParty(party).ok;

/** All viable three-hero parties, in a stable order so seeded draws are reproducible. */
export function balancedParties(roster: readonly ActorId[] = heroes.map(h => h.id)): ActorId[][] {
  const ids = [...roster].sort();
  const out: ActorId[][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (let k = j + 1; k < ids.length; k++) {
        const party = [ids[i]!, ids[j]!, ids[k]!];
        if (isBalancedParty(party)) out.push(party);
      }
  return out;
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

/** Deterministic viable party for a seed string. Same seed always yields the same team. */
export function draftParty(seed: string, roster?: readonly ActorId[]): ActorId[] {
  const pool = balancedParties(roster);
  if (!pool.length) throw new Error('No viable party exists for this roster');
  return [...pool[mix32(stableHash(seed)) % pool.length]!];
}
