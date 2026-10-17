#!/usr/bin/env node
/** Reports which music and sound files are present, and flags any that are oversized.
 *
 *   npm run audio:check
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {load, repoPath} from './load.mjs';

const {requiredSounds, requiredTracks, TRACK_PLAYBACK} = await load('dist/src/audio.js');

/** What actually matters here.
 *
 * The looping theme is fetched before the first battle can start, so its size is a real
 * cost. Sound effects are loaded lazily on first use and are a few tens of KiB each, so
 * their size is noise — and judging them by bitrate is misleading, because a third-of-a-
 * second clip is mostly Ogg header and reads as 200+ kbps however it was encoded.
 *
 * So: budget the music, report the effects. */
const MUSIC_BUDGET_KB = 900;
/** Only worth mentioning for an effect that is both sizeable and richly encoded. */
const SFX_NOTE_KB = 96;
const SFX_NOTE_KBPS = 180;

/** Duration and size from the Ogg container, without decoding the audio. */
function probe(file) {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const kb = bytes.length / 1024;
  let rate = 0;
  const vorbis = bytes.indexOf(Buffer.from('vorbis', 'ascii'));
  if (vorbis >= 0) rate = bytes.readUInt32LE(vorbis + 6 + 5);
  else if (bytes.indexOf(Buffer.from('OpusHead', 'ascii')) >= 0) rate = 48000;
  let seconds = 0;
  if (rate > 0) {
    // The final Ogg page's granule position is the total sample count.
    for (let i = bytes.length - 4; i >= 0; i--) {
      if (bytes.toString('ascii', i, i + 4) !== 'OggS') continue;
      const granule = bytes.readUInt32LE(i + 6) + bytes.readUInt32LE(i + 10) * 4294967296;
      seconds = granule / rate;
      break;
    }
  }
  const kbps = seconds > 0 ? (bytes.length * 8) / seconds / 1000 : null;
  return {kb, seconds, kbps};
}
const rows = [];

for (const [track, playback] of Object.entries(TRACK_PLAYBACK)) {
  rows.push({kind: 'music', id: track, file: `battle-music/${playback.file}`,
    ...(probe(repoPath('web/public/battle-music', playback.file)) ?? {kb: null})});
}
for (const sound of requiredSounds()) {
  rows.push({kind: 'sfx', id: sound.id, file: `battle-sounds/${sound.id}.ogg`,
    purpose: sound.purpose,
    ...(probe(repoPath('web/public/battle-sounds', `${sound.id}.ogg`)) ?? {kb: null})});
}

console.log('\nAUDIO ASSETS\n');
console.log('       file                               size      length   bitrate');
let oversize = 0;
let total = 0;
for (const row of rows) {
  const hot = row.kb !== null && (row.kind === 'music'
    ? row.kb > MUSIC_BUDGET_KB
    : row.kb > SFX_NOTE_KB && (row.kbps ?? 0) > SFX_NOTE_KBPS);
  const status = row.kb === null ? '--  ' : hot ? 'BIG ' : 'OK  ';
  if (row.kb !== null) total += row.kb;
  if (hot) { oversize++; row.hot = true; }
  console.log(`  ${status} ${row.file.padEnd(34)} ` +
    `${row.kb === null ? '' : `${row.kb.toFixed(0).padStart(5)} KiB`}` +
    `${row.seconds ? `  ${row.seconds.toFixed(2).padStart(6)}s` : '         '}` +
    `${row.kbps ? `  ${row.kbps.toFixed(0).padStart(4)} kbps` : ''}`);
}
const musicRows = rows.filter(r => r.kind === 'music');
const sfxRows = rows.filter(r => r.kind === 'sfx');
console.log(`\n  music ${musicRows.filter(r => r.kb !== null).length}/${musicRows.length}` +
  `   sfx ${sfxRows.filter(r => r.kb !== null).length}/${sfxRows.length}` +
  `   total ${total.toFixed(0)} KiB`);

const musicKb = rows.filter(r => r.kind === 'music' && r.kb !== null)
  .reduce((n, r) => n + r.kb, 0);
const sfxKb = total - musicKb;
console.log(`  music ${musicKb.toFixed(0)} KiB fetched at battle start; ` +
  `effects ${sfxKb.toFixed(0)} KiB loaded lazily`);

if (oversize) {
  console.log('');
  for (const row of rows.filter(r => r.hot)) {
    console.log(`  ${row.file} is ${row.kb.toFixed(0)} KiB at ${row.kbps.toFixed(0)} kbps.` +
      (row.kind === 'music' ? ' It is fetched before the first battle can start.' : ''));
  }
  console.log('  Trim the bitrate rather than the content; q4 is ample at game-mix levels:');
  for (const row of rows.filter(r => r.hot)) {
    console.log(`    ffmpeg -i ${row.file} -c:a libvorbis -q:a 4 -ac 2 trimmed.ogg`);
  }
}
const {TRACK_FALLBACK} = await load('dist/src/audio.js');
const missingMusic = musicRows.filter(r => r.kb === null).map(r => r.id);
if (missingMusic.length) {
  console.log('\n  Missing tracks, and what plays instead:');
  for (const id of missingMusic) {
    const chain = [];
    let track = TRACK_FALLBACK[id] ?? 'silence';
    while (track !== 'silence') {
      const file = TRACK_PLAYBACK[track]?.file;
      const present = rows.some(r => r.file.endsWith(file ?? '\u0000') && r.kb !== null);
      if (present) { chain.push(file); break; }
      track = TRACK_FALLBACK[track] ?? 'silence';
    }
    console.log(`    ${id.padEnd(18)} ${chain.length ? chain.join(' -> ') : 'silence'}`);
  }
  console.log('  A finished battle falls silent rather than looping combat music.');
}
if (sfxRows.every(r => r.kb === null)) {
  console.log('\n  No sound effects yet. Cues are scheduled and silently skipped, so adding a');
  console.log('  file is all that is needed — no code change. Highest value first:');
  for (const row of sfxRows.slice(0, 5)) console.log(`    ${row.id.padEnd(16)} ${row.purpose}`);
}
console.log();
