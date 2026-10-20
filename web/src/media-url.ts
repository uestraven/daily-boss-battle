/** URLs for the game's media, carrying the build revision.
 *
 * Everything under `public/` ships under a name that never changes — `heroes/oracle.png`,
 * `battle-music/victory.ogg` — and the service worker serves those stale-while-revalidate.
 * A returning player therefore keeps the *previous* build's bytes for one more visit
 * unless the URL itself changes. For a recoloured sprite that is a cosmetic lag. For a
 * replaced file it is a bug: a sheet that grew from 7 rows to 8 drew the wrong clip and
 * then nothing, and a replaced victory theme simply played the old one.
 *
 * Both of those happened. The second happened *after* the first was fixed, because the fix
 * was applied at each call site — the stage's three loaders and the sprite catalogue — and
 * audio was a fourth place nobody thought of. Hence one helper: the revision is not
 * something to remember at a call site, and a new media directory gets it by construction.
 *
 * The format matters as much as the presence. Two builders that version the same file
 * differently produce two cache entries and two downloads, so every caller goes through
 * here.
 */

const base = (): string => import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** A versioned URL for a file in one of the media directories.
 *
 * `directory` is the folder under `public/`, e.g. `battle-music`. `file` may contain
 * subdirectories, as the sprite sheets do (`heroes/oracle.png`). */
export function mediaUrl(directory: string, file: string): string {
  return `${base()}${directory}/${file}?v=${__ASSET_REV__}`;
}
