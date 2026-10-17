import {reference001} from './reference.js';
import type {EncounterDefinition} from './types.js';

// v0.7 is a candidate CONTENT variant. The v0.6 Reference 001 definition and
// engine implementation remain unchanged. Approved Focus ×2, boss HP 1400,
// Blade Storm delay 4, and no-items mastery are preserved.
const copy = <T>(data: T): T => JSON.parse(JSON.stringify(data)) as T;

export const tyrantVariant007: EncounterDefinition = {
  ...copy(reference001),
  id: 'reference-001-v07',
  contentVersion: '0.7-candidate',
  actors: {
    ...copy(reference001.actors),
    magus: {
      ...copy(reference001.actors.magus!),
      stats: {...copy(reference001.actors.magus!.stats), mp: 35},
    },
    blade_tyrant: {
      ...copy(reference001.actors.blade_tyrant!),
      stats: {...copy(reference001.actors.blade_tyrant!.stats), defense: 100, resistance: 100},
    },
  },
  // Blade Tyrant's armor rewards magical attacks, while the affinities give
  // Magus's elemental choices actual, predictable tactical differences.
  affinities: {
    ...copy(reference001.affinities ?? {}),
    blade_tyrant: {fire: 'resist', ice: 'weak', lightning: 'neutral'},
  },
  bossProgram: {
    ...copy(reference001.bossProgram),
    // The boss guards earlier so physical burst is a timing decision.
    phaseOne: ['heavy_slash', 'boss_protect', 'wind_slash'],
  },
};
