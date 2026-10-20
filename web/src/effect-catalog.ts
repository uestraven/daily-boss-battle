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
import {mediaUrl} from './media-url.js';

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

/** URL for an effect sheet.
 *
 * Through the shared helper, so it carries the build revision and matches the format the
 * stage's loader uses for the same file. It has no callers today -- effect art is 0 of 7 --
 * and that is exactly why it is worth routing now: the next caller would otherwise
 * reintroduce an unversioned path, which is how the replaced victory theme ended up
 * serving the old one. */
export function effectUrl(file: string): string {
  return mediaUrl('battle-effects', file);
}
