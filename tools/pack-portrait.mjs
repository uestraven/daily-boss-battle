#!/usr/bin/env node
/** Packs a generated character portrait down to a 64x64 Codex face.
 *
 *   node tools/pack-portrait.mjs <input.png> --out <out.png> [--size 64] [--colours 28]
 *
 * A third packer, because a portrait wants something neither of the others does.
 *
 * `pack-spritesheet.mjs` finds figures, keys out a background and bottom-aligns each pose
 * on a common ground line -- all wrong here: a portrait has no background to remove, no
 * ground line, and must not be re-cropped to its subject, because the framing *is* the
 * composition. `pack-effect.mjs` preserves an animation's internal motion across frames,
 * and a portrait is one still image.
 *
 * So this is the simple case, and the only thing it has to get right is the reduction:
 * 1254px down to 64 is a 19.6x area average, which invents colours the source never had.
 * The palette pass is what keeps the result reading as pixel art rather than as a
 * photograph someone shrank.
 *
 * No chroma key, deliberately. A portrait keeps its own background, which sidesteps the
 * whole class of erosion the magenta key caused on five sprite sheets -- white sits only
 * 255 from magenta in that colour distance, and these faces are full of pale tones.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {decodePng, encodePng} from './png.mjs';

const args = process.argv.slice(2);
const input = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = flag('out');
const size = Number(flag('size', '64'));
// Higher than an effect's twelve: a face needs skin, hair, cloth and a background, and a
// dozen steps posterises a cheek into bands. Low enough to stay in period.
const colourLimit = Number(flag('colours', '28')) || 0;
/** Stretch the tonal range before quantising. Off unless asked for. */
const levels = args.includes('--levels');
/** Where the brightest real tone should land after a stretch. */
const levelsTarget = Number(flag('levels-target', '215'));
/** Ship a portrait with almost no tonal range anyway. */
const allowDark = args.includes('--allow-dark');

if (!input || input.startsWith('--') || !out) {
  console.error('usage: pack-portrait.mjs <input.png> --out <out.png> [--size 64] '
    + '[--colours 28]');
  process.exit(2);
}

const img = decodePng(readFileSync(input));
const {width: W, height: H, rgba} = img;

// Square sources only. A rectangular one would have to be cropped, and choosing *where* to
// crop a face is an art decision this tool has no business making silently.
if (W !== H) {
  console.error(`\n  PROBLEM  ${input} is ${W}x${H}, not square.`);
  console.error('  Crop it to a square before packing: cropping a face is an art decision,');
  console.error('  and a tool guessing at it will cut off the top of someone\'s head.');
  process.exit(1);
}

const dest = Buffer.alloc(size * size * 4);

/** Area average of the source block behind one destination pixel.
 *
 * Every pixel is opaque, so unlike the sprite and effect packers there is no coverage test
 * and no transparency to preserve -- which is why a portrait never develops the half-
 * transparent rim that reads as blur at this scale. */
for (let dy = 0; dy < size; dy++) {
  for (let dx = 0; dx < size; dx++) {
    const x0 = Math.floor((dx * W) / size), x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * W) / size));
    const y0 = Math.floor((dy * H) / size), y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * H) / size));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
      }
    }
    const d = (dy * size + dx) * 4;
    dest[d] = Math.round(r / n);
    dest[d + 1] = Math.round(g / n);
    dest[d + 2] = Math.round(b / n);
    dest[d + 3] = 255;
  }
}

// --- tonal range -----------------------------------------------------------------------
//
// A large area average destroys small specular detail, and for a dark subject that detail
// is the only light there is. The Warden's source reaches 0-255, but its 95th percentile is
// 69 and its 99th is 120: the brightness lives in isolated eye glints, a buckle and a few
// strands of fur sheen. At a 19.6x reduction a single bright pixel is averaged with 383 dark
// neighbours and ceases to exist, so the packed face topped out at luminance 73 and read as
// a silhouette.
//
// No linear filter can preserve a one-pixel highlight at that coverage -- the information
// genuinely does not fit in the output. What *is* recoverable is the structure already
// there: 73 levels of fur form, compressed into the bottom quarter of the range. A levels
// stretch is exactly the remedy for that, and the only honest one.
//
// Anchored on percentiles, not the absolute min and max, so one stray pixel at either end
// cannot set the whole mapping.
if (levels) {
  const lumOf = i => (dest[i * 4] * 299 + dest[i * 4 + 1] * 587 + dest[i * 4 + 2] * 114) / 1000;
  const sorted = [];
  for (let i = 0; i < size * size; i++) sorted.push(lumOf(i));
  sorted.sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  const black = at(0.005);
  const white = at(0.995);
  const span = Math.max(1, white - black);
  const gain = levelsTarget / span;
  console.log(`  levels        ${black.toFixed(0)}-${white.toFixed(0)} -> 0-${levelsTarget} `
    + `(gain ${gain.toFixed(2)}x)`);
  for (let i = 0; i < size * size; i++) {
    // Scale the channels together by one luminance-derived gain rather than stretching each
    // channel independently: per-channel stretching shifts hue, and a black panther turning
    // blue is a worse outcome than a dark one.
    for (const c of [0, 1, 2]) {
      const v = (dest[i * 4 + c] - black) * gain;
      dest[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

const distinctBefore = (() => {
  const s = new Set();
  for (let i = 0; i < size * size; i++) {
    s.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
  }
  return s.size;
})();

// --- palette reduction -----------------------------------------------------------------
// Median cut, as in pack-effect.mjs, including the looped range-finding: spreading a large
// pixel array into Math.max overflows the stack, which is how this first failed.
if (colourLimit > 0) {
  const pixels = [];
  for (let i = 0; i < size * size; i++) {
    pixels.push([dest[i * 4], dest[i * 4 + 1], dest[i * 4 + 2]]);
  }
  let boxes = [pixels];
  while (boxes.length < colourLimit) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (!box || box.length < 2) { if (box) boxes.push(box); break; }
    const ranges = [0, 1, 2].map(ch => {
      let lo = Infinity, hi = -Infinity;
      for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
      return hi - lo;
    });
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(box.length / 2);
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const palette = boxes.filter(b => b.length).map(box => {
    const sum = box.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return sum.map(v => Math.round(v / box.length));
  });
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = [dest[i * 4], dest[i * 4 + 1], dest[i * 4 + 2]];
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const d = (r - palette[p][0]) ** 2 + (g - palette[p][1]) ** 2 + (b - palette[p][2]) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    dest[i * 4] = palette[best][0];
    dest[i * 4 + 1] = palette[best][1];
    dest[i * 4 + 2] = palette[best][2];
  }
}

const colours = new Set();
let lumSum = 0, lumMin = 255, lumMax = 0;
for (let i = 0; i < size * size; i++) {
  colours.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
  const lum = (dest[i * 4] * 299 + dest[i * 4 + 1] * 587 + dest[i * 4 + 2] * 114) / 1000;
  lumSum += lum;
  if (lum < lumMin) lumMin = lum;
  if (lum > lumMax) lumMax = lum;
}
const mean = lumSum / (size * size);

console.log(`\n${input}`);
console.log(`  source        ${W}x${H} -> ${size}x${size} (${(W / size).toFixed(1)}x area average)`);
console.log(`  colours       ${distinctBefore} after scaling -> ${colours.size} after the palette pass`);
console.log(`  luminance     mean ${mean.toFixed(0)}, range ${lumMin.toFixed(0)}-${lumMax.toFixed(0)}`);

// A portrait with almost no tonal range is a silhouette, not a face: either the source is
// very dark or the reduction has collapsed it. Worth reporting rather than discovering on
// screen, where twelve cards make one flat face hard to spot.
if (lumMax - lumMin < 60) {
  console.log('  ADVICE        under 60 points of tonal range; this will read as a');
  console.log('                silhouette at 64px rather than as a face');
}

writeFileSync(out, encodePng(size, size, dest));
console.log(`  wrote         ${out}`);
