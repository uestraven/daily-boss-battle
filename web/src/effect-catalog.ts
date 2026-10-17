/** Hit effect sheets available to the renderer.
 *
 * The manifest describes every effect the bindings can ask for, which is the commissioning
 * list; `shipped` names the subset whose art actually exists. Only the shipped subset is
 * handed to `composeFrame`, so an uncommissioned effect produces no draw command, no failed
 * request and no console noise — the stage simply keeps its hit flash and shake, exactly as
 * it does today.
 *
 * `npm run effects:check` fails when `shipped` and `web/public/battle-effects/` disagree, so
 * enabling a new effect is: drop the PNG in, add its id, run the check.
 */
import manifest from './effect-manifest.json';
import {validateEffectSheet} from '../../dist/src/effects.js';
import type {EffectLibrary, EffectSheet} from '../../src/effects.js';

type ManifestEffect = EffectSheet;

const declared = manifest.effects as unknown as Record<string, ManifestEffect>;
const shipped: readonly string[] = manifest.shipped as readonly string[];

/** Every effect the bindings can reference, art or not. The commissioning list. */
export function declaredEffects(): Record<string, EffectSheet> {
  return declared;
}

/** The library to render with: validated, and only what has art.
 *
 * Validation happens here so a malformed frame size fails with a specific message at load
 * rather than blitting from a nonsense rectangle mid-battle. A sheet listed in `shipped` but
 * absent from `effects` is skipped rather than throwing, because a missing effect must never
 * be able to take the battle down with it. */
export function effectLibrary(): EffectLibrary {
  const library: EffectLibrary = {};
  for (const id of shipped) {
    const sheet = declared[id];
    if (!sheet) continue;
    library[id] = validateEffectSheet(sheet, `effect/${id}`);
  }
  return library;
}

/** Relative URL for an effect sheet, honouring the Vite deployment base. */
export function effectUrl(file: string, base: string): string {
  return `${base.replace(/\/?$/, '/')}battle-effects/${file}`;
}
