/** The engine's behavioural version.
 *
 * Its own module so that content can state it without importing the generator. Three
 * files declare an `engineVersion` on an encounter -- the generator, the legacy practice
 * encounters, and the AI variant -- and the engine refuses to advance a state whose
 * version does not match, which is the guard that stops a stored result being replayed
 * against different rules.
 *
 * That guard only works if all three agree. They did not: two of them held the string
 * literally, so bumping the generator's copy for critical hits made every legacy and
 * practice encounter fail as a version mismatch. One exported constant removes the
 * possibility.
 *
 * Bump this whenever a change alters what the engine computes, because every recorded
 * action log replays through it and a silent behaviour change would make old results
 * irreproducible without saying so.
 */
export const ENGINE_VERSION = '0.3.0-criticals';
