#!/usr/bin/env node
/** Turns a generated contact sheet into an exact sprite sheet.
 *
 * Image generators produce good poses on a bad grid: the art is fine, but frames drift in
 * both axes, the canvas is never the size you asked for, and the background is a flat key
 * colour rather than alpha. None of that is fixable in the generator, and all of it is
 * mechanical, so it is fixed here instead.
 *
 * What it does, in order:
 *   1. Keys the background colour out to transparency, with a tolerance so the
 *      anti-aliased fringe goes too rather than leaving a halo.
 *   2. Finds every figure as a connected component, which is what makes drifting frames
 *      recoverable -- no grid is assumed at any point.
 *   3. Sorts them into rows and columns by position, and fails loudly if the count is not
 *      rows x columns, because a silent miscount would scramble the animations.
 *   4. Scales every figure by one shared factor, chosen so the largest still fits, then
 *      re-packs onto an exact grid with feet on a common baseline.
 *
 * One shared scale matters: scaling each figure to fit its own cell would make the
 * character change size between frames.
 *
 *   node tools/pack-spritesheet.mjs <input.png> --out <output.png> \
 *     --grid 8x7 --cell 48x40 [--key ff00ff] [--colours 32]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {decodePng, encodePng} from './png.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const input = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true)
  ?? args[0];
if (!input || input.startsWith('--')) {
  console.error('usage: pack-spritesheet.mjs <input.png> --out <out.png> [--grid 8x7] [--cell 48x40]');
  process.exit(1);
}
const out = flag('out');
if (!out) { console.error('--out is required'); process.exit(1); }
const [cols, rows] = (flag('grid', '8x7')).split('x').map(Number);
const [cellW, cellH] = (flag('cell', '48x40')).split('x').map(Number);
const key = flag('key', 'ff00ff');
const keyRgb = [0, 2, 4].map(i => parseInt(key.slice(i, i + 2), 16));
const colourLimit = Number(flag('colours', '0')) || 0;
const minPixels = Number(flag('min-pixels', '400'));
/** How far from the key colour still counts as background, as a sum of channel distances.
 *
 * 180 is measured, not guessed: at 90 the output still carried a purple rim on every
 * sprite (3.4% of opaque pixels magenta-tinted), because the anti-aliased edge is a blend
 * of key and figure. 180 removes it entirely at a cost of 1.5% of the figure's pixels; 260
 * starts eating real art. It is safe because magenta is nowhere near this palette -- the
 * closest real colour is white, at a distance of 255. Choose a key colour that far from
 * the art and this stays true. */
const tolerance = Number(flag('tolerance', '180'));

const img = decodePng(readFileSync(input));
const {width: W, height: H, rgba} = img;

const isKey = i => {
  const d = Math.abs(rgba[i * 4] - keyRgb[0]) + Math.abs(rgba[i * 4 + 1] - keyRgb[1])
    + Math.abs(rgba[i * 4 + 2] - keyRgb[2]);
  return d <= tolerance;
};
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = isKey(i) ? 0 : 1;

// --- find figures ---------------------------------------------------------------------
const label = new Int32Array(W * H).fill(-1);
const stack = new Int32Array(W * H);
const comps = [];
for (let seed = 0; seed < W * H; seed++) {
  if (!mask[seed] || label[seed] >= 0) continue;
  const id = comps.length;
  let sp = 0;
  stack[sp++] = seed;
  label[seed] = id;
  let n = 0, minx = W, maxx = -1, miny = H, maxy = -1;
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W, y = (p - x) / W;
    n++;
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] && label[q] < 0) { label[q] = id; stack[sp++] = q; }
      }
    }
  }
  comps.push({id, n, minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1});
}

const figures = comps.filter(c => c.n >= minPixels);
console.log(`\n${input}`);
console.log(`  source        ${W}x${H}`);
console.log(`  figures found ${figures.length} (expected ${cols * rows})`);
if (figures.length !== cols * rows) {
  console.error(`\n  PROBLEM  found ${figures.length} figures, not ${cols * rows}.`);
  console.error('  Frames that touch merge into one component; frames that break up into');
  console.error('  separate pieces count twice. Either raise --min-pixels to ignore debris,');
  console.error('  or the sheet needs more space between poses.');
  const sizes = figures.map(f => `${f.w}x${f.h}`).join(' ');
  console.error(`  sizes: ${sizes}`);
  process.exit(1);
}

// --- sort into the grid ---------------------------------------------------------------
// By vertical centre into rows, then by horizontal centre within each row. Position is
// the only reliable signal: the sheet has no grid to read.
figures.sort((a, b) => (a.miny + a.maxy) - (b.miny + b.maxy));
const grid = [];
for (let r = 0; r < rows; r++) {
  const band = figures.slice(r * cols, (r + 1) * cols)
    .sort((a, b) => (a.minx + a.maxx) - (b.minx + b.maxx));
  grid.push(band);
}
for (let r = 0; r < rows; r++) {
  const band = grid[r];
  const tops = band.map(f => f.miny);
  const drift = Math.max(...tops) - Math.min(...tops);
  console.log(`  row ${r}  ${band.map(f => `${f.w}x${f.h}`).join(' ').padEnd(56)} top drift ${drift}px`);
}

// --- one shared scale -----------------------------------------------------------------
const maxW = Math.max(...figures.map(f => f.w));
const maxH = Math.max(...figures.map(f => f.h));
/** Keeps a margin on the sides and top so no frame's content sits on a cell boundary.
 * The bottom is deliberately exempt: feet belong on the baseline, which is the bottom row,
 * and that is what makes anchorY equal to the cell height. */
const pad = Number(flag('pad', '1'));
const scale = Math.min((cellW - 2 * pad) / maxW, (cellH - pad) / maxH);
console.log(`  largest figure ${maxW}x${maxH} -> scale ${scale.toFixed(4)} ` +
  `(${Math.round(maxW * scale)}x${Math.round(maxH * scale)} in a ${cellW}x${cellH} cell)`);

// --- resample and pack ----------------------------------------------------------------
const outW = cols * cellW, outH = rows * cellH;
const dest = Buffer.alloc(outW * outH * 4);

/** Area-average a source rectangle down to one destination pixel, ignoring keyed pixels
 * so the figure's colour is never averaged with the background it sat on. Premultiplying
 * by coverage is what keeps edges from darkening toward the key colour. */
const sampleBox = (x0, y0, x1, y1) => {
  let r = 0, g = 0, b = 0, hits = 0, total = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      total++;
      const i = y * W + x;
      if (!mask[i]) continue;
      r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2];
      hits++;
    }
  }
  if (!hits || !total) return null;
  // Majority coverage keeps the silhouette hard instead of fading it out over a
  // half-transparent rim, which is what reads as blur at this size.
  if (hits / total < 0.5) return null;
  return [Math.round(r / hits), Math.round(g / hits), Math.round(b / hits), 255];
};

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const f = grid[r][c];
    const dw = Math.max(1, Math.round(f.w * scale));
    const dh = Math.max(1, Math.round(f.h * scale));
    // Centred horizontally; feet on the cell's bottom edge, so every actor shares one
    // ground line and anchorY is simply the cell height.
    const ox = c * cellW + Math.floor((cellW - dw) / 2);
    const oy = r * cellH + (cellH - dh);
    for (let dy = 0; dy < dh; dy++) {
      for (let dx = 0; dx < dw; dx++) {
        const sx0 = f.minx + (dx / dw) * f.w, sx1 = f.minx + ((dx + 1) / dw) * f.w;
        const sy0 = f.miny + (dy / dh) * f.h, sy1 = f.miny + ((dy + 1) / dh) * f.h;
        const px = sampleBox(sx0, sy0, sx1, sy1);
        if (!px) continue;
        const di = ((oy + dy) * outW + (ox + dx)) * 4;
        dest[di] = px[0]; dest[di + 1] = px[1]; dest[di + 2] = px[2]; dest[di + 3] = px[3];
      }
    }
  }
}

// --- optional palette reduction -------------------------------------------------------
if (colourLimit > 0) {
  // Median cut, on the colours actually present. Pixel art reads better with fewer, more
  // deliberate colours, and resampling always invents more than the original had.
  const pixels = [];
  for (let i = 0; i < outW * outH; i++) {
    if (dest[i * 4 + 3] > 0) pixels.push([dest[i * 4], dest[i * 4 + 1], dest[i * 4 + 2]]);
  }
  let boxes = [pixels];
  while (boxes.length < colourLimit) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (!box || box.length < 2) { if (box) boxes.push(box); break; }
    const ranges = [0, 1, 2].map(ch => {
      const vals = box.map(p => p[ch]);
      return Math.max(...vals) - Math.min(...vals);
    });
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(box.length / 2);
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const palette = boxes.filter(b => b.length).map(box => {
    const sum = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
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
    dest[i * 4] = palette[best][0]; dest[i * 4 + 1] = palette[best][1]; dest[i * 4 + 2] = palette[best][2];
  }
  console.log(`  palette       reduced to ${palette.length} colours`);
}

const seen = new Set();
let opaque = 0;
for (let i = 0; i < outW * outH; i++) {
  if (!dest[i * 4 + 3]) continue;
  opaque++;
  seen.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
}
writeFileSync(out, encodePng(outW, outH, dest));
console.log(`  wrote         ${out}  ${outW}x${outH}, ${seen.size} colours, ` +
  `${(100 * opaque / (outW * outH)).toFixed(0)}% opaque\n`);
