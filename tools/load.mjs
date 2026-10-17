/** Shared module loader for the tools in this directory.
 *
 * Dynamic `import()` of an absolute filesystem path must go through a file:// URL.
 * On Windows a bare path like `C:\repo\dist\src\engine.js` makes Node throw
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME`, because `C:` parses as a URL scheme. `pathToFileURL`
 * is the portable form, so every tool loads built modules through `load()` rather than
 * interpolating a path into an import specifier.
 */
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/** Repository root, derived from this file's own location. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path to a repo-relative file, using the platform's separator. */
export const repoPath = (...parts) => path.join(root, ...parts);

/** Imports a built module by repo-relative path, e.g. `load('dist/src/engine.js')`. */
export const load = relative => import(pathToFileURL(repoPath(relative)).href);
