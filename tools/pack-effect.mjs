#!/usr/bin/env node
/** Packs a generated hit-effect animation onto an exact sheet.
 *
 * Separate from pack-spritesheet.mjs because the two want opposite things. A character
 * sheet re-centres every pose and sits it on a common ground line, which is exactly right
 * for a figure that must not drift between its idle and its attack. An effect is a single
 * animation whose *internal motion is the content*: a slash arc grows and sweeps, a
 * lightning bolt strikes and withdraws. Re-centring each frame would delete that motion
 * and make the effect jitter in place.
 *
 * So this preserves layout. It slices the source into equal frames, finds the union of
 * every frame's artwork, scales that union once, and draws each frame's art at its own
 * position inside it. Frame to frame, nothing moves that did not move in the source.
 *
 *   node tools/pack-effect.mjs <input.png> --out <out.png> --frames 4 --cell 64x48
 *     [--key 00ff00] [--tolerance 300] [--colours 12] [--no-despill]
 *
 * The key defaults to green, not magenta. Effect art is overwhelmingly white and pale,
 * and white sits only 255 from magenta in this distance -- close enough that a magenta key
 * erased a third of one character sheet and all of another's glow. Green is 510 from both
 * white and red.
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
const frames = Number(flag('frames', '0'));
const [cellW, cellH] = flag('cell', '64x64').split('x').map(Number);
const keyHex = flag('key', '00ff00');
const tolerance = Number(flag('tolerance', '300'));
const colourLimit = Number(flag('colours', '12')) || 0;
// Despill is on by default and only for a key that actually dominates one channel, which
// is every chroma key worth using. `--no-despill` is there for art that is genuinely the
// key's hue -- a green poison cloud keyed on green -- where suppressing it deletes content.
const despill = !args.includes('--no-despill');

if (!input || input.startsWith('--') || !out || !frames) {
  console.error('usage: pack-effect.mjs <input.png> --out <out.png> --frames 4 '
    + '--cell 64x48 [--key 00ff00] [--tolerance 300] [--colours 12] [--no-despill]');
  process.exit(2);
}

const keyRgb = [0, 2, 4].map(i => parseInt(keyHex.slice(i, i + 2), 16));
const img = decodePng(readFileSync(input));
const {width: W, height: H, rgba} = img;

/** Manhattan distance from the key colour, the same measure the sprite packer uses. */
const isKey = p => {
  const o = p * 4;
  if (rgba[o + 3] <= 8) return true;
  return Math.abs(rgba[o] - keyRgb[0]) + Math.abs(rgba[o + 1] - keyRgb[1])
    + Math.abs(rgba[o + 2] - keyRgb[2]) <= tolerance;
};

const srcCellW = W / frames;
if (!Number.isInteger(srcCellW)) {
  console.log(`  note          ${W}px over ${frames} frames is ${srcCellW.toFixed(2)}px each; `
    + 'slicing on rounded boundaries');
}

// Each frame's artwork box, in coordinates local to its own frame.
const boxes = [];
for (let f = 0; f < frames; f++) {
  const x0 = Math.floor(f * srcCellW);
  const x1 = Math.floor((f + 1) * srcCellW);
  let minx = Infinity, maxx = -1, miny = Infinity, maxy = -1;
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      if (isKey(y * W + x)) continue;
      const local = x - x0;
      if (local < minx) minx = local;
      if (local > maxx) maxx = local;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (maxx < 0) {
    console.error(`\n  PROBLEM  frame ${f + 1} of ${frames} is entirely background.`);
    console.error('  Either the frame count is wrong or the key is eating the artwork.');
    console.error(`  Keyed everything within ${tolerance} of #${keyHex}.`);
    process.exit(1);
  }
  boxes.push({x0, minx, maxx, miny, maxy});
}

// The union box is the common frame: every frame's art is placed relative to it, which is
// what keeps the animation's own movement intact.
const unionMinX = Math.min(...boxes.map(b => b.minx));
const unionMaxX = Math.max(...boxes.map(b => b.maxx));
const unionMinY = Math.min(...boxes.map(b => b.miny));
const unionMaxY = Math.max(...boxes.map(b => b.maxy));
const unionW = unionMaxX - unionMinX + 1;
const unionH = unionMaxY - unionMinY + 1;

// One scale for the whole animation, fitting the union inside the cell.
const scale = Math.min(cellW / unionW, cellH / unionH);
const drawW = Math.max(1, Math.round(unionW * scale));
const drawH = Math.max(1, Math.round(unionH * scale));
// Centred, so the manifest's anchorX/anchorY describe a predictable point.
const offX = Math.floor((cellW - drawW) / 2);
const offY = Math.floor((cellH - drawH) / 2);

const outW = cellW * frames;
const outH = cellH;
const dest = Buffer.alloc(outW * outH * 4);

/** Averages the source pixels behind one destination pixel, ignoring background.
 *
 * Majority coverage or nothing: a pixel more than half background stays transparent, which
 * keeps an effect's edge hard instead of fading it out over a half-transparent rim. That
 * soft rim is what reads as blur at this size. */
const sample = (fx0, fy0, fx1, fy1, frameX0) => {
  let r = 0, g = 0, b = 0, hits = 0, total = 0;
  for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
    for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      total++;
      const p = y * W + x;
      if (isKey(p)) continue;
      r += rgba[p * 4]; g += rgba[p * 4 + 1]; b += rgba[p * 4 + 2];
      hits++;
    }
  }
  if (!hits || !total || hits / total < 0.5) return null;
  return suppressSpill([Math.round(r / hits), Math.round(g / hits), Math.round(b / hits)]);
};

/** Removes the key colour's contribution from a pixel that was kept.
 *
 * Keying answers "is this pixel background", which is binary. It does not answer "how much
 * of the key is mixed into this pixel", and for soft art the answer is a lot: the neutral
 * flare's expanding ring is a thin white glow laid over green, so each surviving pixel is a
 * white-green average. Those pixels are over 300 from pure green -- correctly kept as art --
 * yet come out visibly green, and the palette pass then spends two of its twelve slots
 * preserving the tint.
 *
 * The fix is the standard despill: in the key's dominant channel, no pixel may exceed what
 * the other two channels support. Green 200 beside red 180 and blue 170 becomes green 180,
 * so a white-green blend goes back to white while a deliberately warm or cool pixel, whose
 * green was never the maximum, is untouched. */
const dominant = keyRgb.indexOf(Math.max(...keyRgb));
const suppressSpill = px => {
  if (!despill || keyRgb[dominant] <= 128) return px;
  const others = [0, 1, 2].filter(i => i !== dominant).map(i => px[i]);
  const cap = Math.max(others[0], others[1]);
  if (px[dominant] > cap) px[dominant] = cap;
  return px;
};

for (let f = 0; f < frames; f++) {
  const {x0} = boxes[f];
  for (let dy = 0; dy < drawH; dy++) {
    for (let dx = 0; dx < drawW; dx++) {
      // Destination pixel back to the union box, then into this frame's own pixels.
      const sx0 = x0 + unionMinX + (dx / drawW) * unionW;
      const sx1 = x0 + unionMinX + ((dx + 1) / drawW) * unionW;
      const sy0 = unionMinY + (dy / drawH) * unionH;
      const sy1 = unionMinY + ((dy + 1) / drawH) * unionH;
      const px = sample(sx0, sy0, sx1, sy1, x0);
      if (!px) continue;
      const ox = f * cellW + offX + dx;
      const oy = offY + dy;
      if (ox < 0 || oy < 0 || ox >= outW || oy >= outH) continue;
      const d = (oy * outW + ox) * 4;
      dest[d] = px[0]; dest[d + 1] = px[1]; dest[d + 2] = px[2]; dest[d + 3] = 255;
    }
  }
}

// --- palette reduction ----------------------------------------------------------------
//
// Box-averaging a 9x reduction invents colours the source never had: the slash came out of
// it with 1024 distinct colours over about 1200 opaque pixels, which is a smooth gradient
// rather than the two or three deliberate shade steps an effect wants. Twelve is enough
// for a white core, a mid tone, an edge and a rim.
if (colourLimit > 0) {
  const pixels = [];
  for (let i = 0; i < outW * outH; i++) {
    if (dest[i * 4 + 3] > 0) pixels.push([dest[i * 4], dest[i * 4 + 1], dest[i * 4 + 2]]);
  }
  let boxes = [pixels];
  while (boxes.length < colourLimit) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (!box || box.length < 2) { if (box) boxes.push(box); break; }
    // Looped rather than spreading into Math.max: that overflows the stack on a large
    // pixel set, which is how it first failed in the sprite packer.
    const ranges = [0, 1, 2].map(ch => {
      let lo = Infinity, hi = -Infinity;
      for (const p of box) {
        if (p[ch] < lo) lo = p[ch];
        if (p[ch] > hi) hi = p[ch];
      }
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
  for (let i = 0; i < outW * outH; i++) {
    if (!dest[i * 4 + 3]) continue;
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

console.log(`\n${input}`);
console.log(`  source        ${W}x${H}, ${frames} frames of ${Math.round(srcCellW)}x${H}`);
console.log(`  union art     ${unionW}x${unionH} -> scale ${scale.toFixed(4)} `
  + `(${drawW}x${drawH} in a ${cellW}x${cellH} cell)`);
console.log(`  per frame     ${boxes.map(b => `${b.maxx - b.minx + 1}x${b.maxy - b.miny + 1}`).join('  ')}`);
console.log('  layout        preserved: each frame drawn at its own place in the union box');

const colours = new Set();
let opaque = 0;
for (let i = 0; i < outW * outH; i++) {
  if (dest[i * 4 + 3] <= 8) continue;
  opaque++;
  colours.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
}
// A frame that lost everything is worth failing on rather than shipping blank.
for (let f = 0; f < frames; f++) {
  let n = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = f * cellW; x < (f + 1) * cellW; x++) if (dest[(y * outW + x) * 4 + 3] > 8) n++;
  }
  if (n < 4) {
    console.error(`\n  PROBLEM  frame ${f + 1} came out with ${n} pixels. Scale too small, `
      + 'or the key is eating it.');
    process.exit(1);
  }
}

writeFileSync(out, encodePng(outW, outH, dest));
console.log(`  wrote         ${out}  ${outW}x${outH}, ${colours.size} colours, `
  + `${Math.round((100 * opaque) / (outW * outH))}% opaque`);
