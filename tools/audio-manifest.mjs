#!/usr/bin/env node
/** Prints the sound and music commissioning list, derived from the code that plays
 * them so it cannot drift from the game. Hand this to a sound designer.
 *
 *   npm run audio:manifest
 *   npm run audio:manifest -- --csv
 */
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {requiredSounds, requiredTracks, HEAVY_HIT_INTENSITY} = await import(`${root}/dist/src/audio.js`);
const {TIMING} = await import(`${root}/dist/src/presentation.js`);

if (process.argv.includes('--csv')) {
  console.log('kind,id,purpose');
  for (const s of requiredSounds()) console.log(`sfx,${s.id},"${s.purpose}"`);
  for (const t of requiredTracks()) if (t.id !== 'silence') console.log(`music,${t.id},"${t.purpose}"`);
} else {
  console.log(`\nDAILY BOSS BATTLE — AUDIO MANIFEST\n`);
  console.log(`SOUND EFFECTS (${requiredSounds().length})\n`);
  for (const s of requiredSounds()) console.log(`  ${s.id.padEnd(18)}${s.purpose}`);
  const tracks = requiredTracks().filter(t => t.id !== 'silence');
  console.log(`\nMUSIC (${tracks.length})\n`);
  for (const t of tracks) console.log(`  ${t.id.padEnd(18)}${t.purpose}`);
  console.log(`\nTIMING NOTES\n`);
  console.log(`  Hit sounds fire on the impact beat, ${TIMING.impact}ms long.`);
  console.log(`  Heavy variant triggers at >=${Math.round(HEAVY_HIT_INTENSITY * 100)}% shake intensity.`);
  console.log(`  Multi-hit abilities fire one cue per hit, ${TIMING.multiHitStagger}ms apart.`);
  console.log(`  A phase change cuts music, stings, then starts phase two after ${TIMING.phaseHold}ms.`);
  console.log(`  Health bars drain over ${TIMING.hpTween}ms; sounds should not outlast that.`);
  console.log(`  Text types at ${TIMING.textCharsPerSecond} chars/sec if blips are enabled.\n`);
}
