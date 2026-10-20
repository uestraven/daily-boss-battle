/** Arena backdrops: which bosses have one briefed, which have art, and whether the
 * `shippedBackgrounds` gate agrees with the directory.
 *
 * The boss list and the arena list are both derived rather than typed in here. The old
 * version hardcoded six names, which is exactly why the Mad Harlequin and the Clockwork
 * Emperor went unnoticed with no arena of their own, silently falling back to the Broken
 * Span.
 *
 *   npm run art:check
 */
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {decodePng} from '../tools/png.mjs';
import {load, repoPath, root} from '../tools/load.mjs';

const {bossIds} = await load('dist/src/generate.js');
const {STAGE} = await load('dist/src/stage.js');

// The catalog is TypeScript, so read the ids and filenames out of the source rather than
// adding a build step for a check tool.
const source = readFileSync(repoPath('web/src/background-catalog.ts'), 'utf8');
const catalogBody = source.slice(source.indexOf('battleBackgrounds = {'));
const arenas = new Map();
for (const match of catalogBody.matchAll(/^ {2}(\w+): \{([\s\S]*?)^ {2}\},$/gm)) {
  const file = match[2].match(/file:'([^']+)'/);
  const scene = match[2].match(/scene:'([^']+)'/);
  if (file) arenas.set(match[1], {file: file[1], scene: scene?.[1] ?? '?'});
}
const shippedBlock = source.match(/shippedBackgrounds: readonly BackgroundId\[\] = \[([^\]]*)\]/);
const shipped = new Set([...(shippedBlock?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]));

const folder = repoPath('web/public/battle-backgrounds');
const onDisk = new Set(existsSync(folder)
  ? readdirSync(folder).filter(name => name.endsWith('.png'))
  : []);

const problems = [];
const advice = [];

console.log('\nARENA BACKDROPS\n');
console.log('       boss                arena                 art');

for (const boss of bossIds) {
  const arena = arenas.get(boss);
  if (!arena) {
    // A boss with no arena does not fail loudly at runtime: backgroundForBoss falls back
    // to another arena, so the wrong scenery just appears.
    problems.push(`${boss} has no arena in background-catalog.ts, so backgroundForBoss ` +
      'falls back to another boss\'s scenery');
    console.log(`  --   ${boss.padEnd(19)} (none briefed)`);
    continue;
  }
  const present = onDisk.has(arena.file);
  const listed = shipped.has(boss);
  let detail = 'awaiting art';
  if (present) {
    try {
      const image = decodePng(readFileSync(path.join(folder, arena.file)));
      // Drawn 1:1 at the internal resolution, so anything else is either resampled or
      // cropped. Exact is the only size that is right.
      if (image.width !== STAGE.width || image.height !== STAGE.height) {
        problems.push(`${arena.file} is ${image.width}x${image.height}; the stage blits it ` +
          `1:1 and needs exactly ${STAGE.width}x${STAGE.height}`);
      }
      detail = `${image.width}x${image.height}`;
    } catch (error) {
      problems.push(`${arena.file} is not a readable PNG: ${error.message}`);
      detail = 'unreadable';
    }
  }
  const status = present && listed ? 'OK' : present && !listed ? 'WARN' : !present && listed ? 'FAIL' : '--';
  console.log(`  ${status.padEnd(5)}${boss.padEnd(19)} ${arena.scene.padEnd(21)} ${detail}`);

  if (present && !listed) {
    advice.push(`${arena.file} exists but "${boss}" is not in shippedBackgrounds, so the ` +
      'flat stage is still drawn. Add it to enable the arena.');
  }
  if (!present && listed) {
    problems.push(`"${boss}" is in shippedBackgrounds but ${arena.file} is not in ` +
      'web/public/battle-backgrounds/, so the renderer would request a file that is not there');
  }
}

const briefedFiles = new Set([...arenas.values()].map(a => a.file));
for (const file of onDisk) {
  // A `-test` or `_test` suffix is the documented name for a full-resolution source kept
  // beside the packed arena: gitignored, never shipped, and deliberately not declared by
  // any arena. Reporting those is noise, and a check that reports things the convention
  // says are fine is a check people stop reading.
  if (/[-_]test\.png$/.test(file)) continue;
  if (!briefedFiles.has(file)) advice.push(`${file} is in battle-backgrounds/ but no arena declares it`);
}
// An arena briefed for a boss that no longer exists is dead weight in the brief.
for (const [id] of arenas) {
  if (!bossIds.includes(id)) advice.push(`arena "${id}" is briefed but is not a boss`);
}

console.log('');
for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
for (const item of advice) console.log(`  ADVICE   ${item}`);

const live = bossIds.filter(b => shipped.has(b) && onDisk.has(arenas.get(b)?.file)).length;
console.log(`\n  ${live}/${bossIds.length} arenas live.`);
if (live === 0) {
  console.log(`  No backdrop art yet, so the stage draws its flat colour and ground band.`);
  console.log(`  Author at exactly ${STAGE.width}x${STAGE.height}: it is blitted 1:1 and the whole`);
  console.log('  canvas is integer-scaled afterwards, so there is no resampling to hide behind.');
  console.log('  Per-arena direction is in web/src/background-catalog.ts.');
}
console.log(`\n  Browser-imported backgrounds live in IndexedDB and are not counted here.`);
console.log(`  Directory: ${path.relative(root, folder)}\n`);
process.exit(problems.length ? 1 : 0);
