/** The abilities every hero has, listed once rather than twelve times.
 *
 * `signatureAbilities` drops these by design, because it exists to derive what makes heroes
 * *different*. But Attack, Guard and the items are what a player uses most, and Guard's rule
 * -- halves incoming damage until this hero next acts -- is exactly the sort no field
 * expresses and that `disclosure.actionPreview` hides from Normal. So they get one shared
 * panel at the top of the Codex.
 */
import {reference001} from '../../dist/src/reference.js';
import type {Ability} from '../../src/types.js';

export const universalAbilities: Ability[] =
  (Object.values(reference001.abilities) as Ability[]).filter(a => a.owner === 'any_hero');
