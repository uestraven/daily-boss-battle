#!/usr/bin/env node
/** Reports which music and sound files are present, and flags any that are oversized.
 *
 *   npm run audio:check
 */
import {existsSync, statSync} from 'node:fs';
import {load, repoPath} from './load.mjs';

const {requiredSounds, requiredTracks, TRACK_PLAYBACK} = await load('dist/src/audio.js');

/** A looping track is downloaded before the first battle can start, so size matters more
 * here than in a game that streams. */
const MUSIC_BUDGET_KB = 900;
const SFX_BUDGET_KB = 60;

const sizeOf = file => (existsSync(file) ? statSync(file).size / 1024 : null);
const rows = [];

for (const [track, playback] of Object.entries(TRACK_PLAYBACK)) {
  const path = repoPath('web/public/battle-music', playback.file);
  rows.push({kind: 'music', id: track, file: `battle-music/${playback.file}`,
    kb: sizeOf(path), budget: MUSIC_BUDGET_KB});
}
for (const sound of requiredSounds()) {
  const path = repoPath('web/public/battle-sfx', `${sound.id}.ogg`);
  rows.push({kind: 'sfx', id: sound.id, file: `battle-sfx/${sound.id}.ogg`,
    kb: sizeOf(path), budget: SFX_BUDGET_KB, purpose: sound.purpose});
}

console.log('\nAUDIO ASSETS\n');
let present = 0;
let oversize = 0;
let total = 0;
for (const row of rows) {
  const status = row.kb === null ? '--  ' : row.kb > row.budget ? 'BIG ' : 'OK  ';
  if (row.kb !== null) { present++; total += row.kb; }
  if (status === 'BIG ') oversize++;
  console.log(`  ${status} ${row.file.padEnd(34)} ${row.kb === null ? '' : `${row.kb.toFixed(0)} KiB`}`);
}
const musicRows = rows.filter(r => r.kind === 'music');
const sfxRows = rows.filter(r => r.kind === 'sfx');
console.log(`\n  music ${musicRows.filter(r => r.kb !== null).length}/${musicRows.length}` +
  `   sfx ${sfxRows.filter(r => r.kb !== null).length}/${sfxRows.length}` +
  `   total ${total.toFixed(0)} KiB`);

if (oversize) {
  console.log(`\n  ${oversize} file(s) over budget. A looping track is fetched before the first`);
  console.log('  battle can start, so trim the bitrate rather than the music:');
  console.log('    ffmpeg -i in.ogg -c:a libvorbis -q:a 4 -ac 2 out.ogg');
}
const missingMusic = musicRows.filter(r => r.kb === null).map(r => r.id);
if (missingMusic.length) {
  console.log(`\n  Missing tracks fall back to the main theme at runtime, so the game still`);
  console.log(`  sounds intentional: ${missingMusic.join(', ')}`);
}
if (sfxRows.every(r => r.kb === null)) {
  console.log('\n  No sound effects yet. Cues are scheduled and silently skipped, so adding a');
  console.log('  file is all that is needed — no code change. Highest value first:');
  for (const row of sfxRows.slice(0, 5)) console.log(`    ${row.id.padEnd(16)} ${row.purpose}`);
}
console.log();
