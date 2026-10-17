#!/usr/bin/env node
/** Hit effect sheets: what is commissioned, what has art, and whether they agree.
 *
 * The manifest's `shipped` list gates which effects reach the renderer, so an effect with
 * art but no listing is silently unused, and a listing with no art would make the renderer
 * request a file that is not there. Both are failures here, with the exact edit to make.
 *
 *   npm run effects:check
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {decodePng} from './png.mjs';
import {load, repoPath} from './load.mjs';

const {requiredEffects, validateEffectSheet} = await load('dist/src/effects.js');

const manifest = JSON.parse(readFileSync(repoPath('web/src/effect-manifest.json'), 'utf8'));
const declared = manifest.effects ?? {};
const shipped = new Set(manifest.shipped ?? []);
const dir = repoPath('web/public/battle-effects');
const onDisk = new Set(existsSync(dir)
  ? readdirSync(dir).filter(name => name.endsWith('.png'))
  : []);

const problems = [];
const advice = [];

console.log('\nHIT EFFECTS\n');
console.log('       id                 frame      frames  art');

const required = requiredEffects();
for (const entry of required) {
  const sheet = declared[entry.id];
  if (!sheet) {
    problems.push(`${entry.id} is in requiredEffects() but not in effect-manifest.json`);
    console.log(`  --   ${entry.id.padEnd(18)} (not declared)`);
    continue;
  }
  try {
    validateEffectSheet(sheet, `effect/${entry.id}`);
  } catch (error) {
    problems.push(error.message);
  }
  const present = onDisk.has(sheet.file);
  const listed = shipped.has(entry.id);
  // Measured against the real PNG, because a frame count that does not divide the image
  // blits from outside the sheet and shows a sliver of the next frame.
  let measured = '';
  if (present) {
    try {
      const image = decodePng(readFileSync(`${dir}/${sheet.file}`));
      const expectedWidth = sheet.frameWidth * sheet.frames;
      if (image.width !== expectedWidth) {
        problems.push(`${sheet.file} is ${image.width}px wide; ${sheet.frames} frames of ` +
          `${sheet.frameWidth}px needs ${expectedWidth}px`);
      }
      if (image.height !== sheet.frameHeight) {
        problems.push(`${sheet.file} is ${image.height}px tall but declares ` +
          `frameHeight ${sheet.frameHeight}`);
      }
      measured = `${image.width}x${image.height}`;
    } catch (error) {
      problems.push(`${sheet.file} is not a readable PNG: ${error.message}`);
    }
  }
  const status = present && listed ? `OK   live  ${measured}`
    : present && !listed ? 'WARN art present, not listed'
    : !present && listed ? 'FAIL listed, art missing'
    : '--   awaiting art';
  console.log(`  ${status.slice(0, 4).padEnd(5)}${entry.id.padEnd(18)} ` +
    `${(sheet.frameWidth + 'x' + sheet.frameHeight).padEnd(10)} ${String(sheet.frames).padEnd(7)} ` +
    `${status.slice(5)}`);

  if (present && !listed) {
    advice.push(`${sheet.file} exists but "${entry.id}" is not in the manifest's "shipped" ` +
      'list, so it is never drawn. Add it to enable the effect.');
  }
  if (!present && listed) {
    problems.push(`"${entry.id}" is listed as shipped but ${sheet.file} is not in ` +
      'web/public/battle-effects/, so the renderer would request a file that is not there');
  }
}

// Art nobody asks for is as much a mismatch as art that is missing.
const knownFiles = new Set(Object.values(declared).map(sheet => sheet.file));
for (const file of onDisk) {
  if (!knownFiles.has(file)) advice.push(`${file} is in battle-effects/ but no effect declares it`);
}

console.log('');
for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
for (const item of advice) console.log(`  ADVICE   ${item}`);

const live = required.filter(e => shipped.has(e.id) && onDisk.has(declared[e.id]?.file)).length;
console.log(`\n  ${live}/${required.length} effects live.`);
if (live === 0) {
  console.log('  No effect art yet, so composeFrame emits no effect commands at all and the');
  console.log('  stage keeps its hit flash and shake. Nothing is broken; nothing is drawn.');
  console.log('\n  Commissioning list:');
  for (const entry of required) {
    console.log(`    ${entry.id.padEnd(16)} ${entry.suggestedFrame.padEnd(8)} ${entry.purpose}`);
  }
}
console.log('');
process.exit(problems.length ? 1 : 0);
