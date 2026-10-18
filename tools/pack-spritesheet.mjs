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
/** Hex colour for the silhouette outline, `auto`, or empty for none. Parsed up here
 * because the scale calculation has to reserve room for it. */
const outlineFlag = flag('outline', '');

/** A dark outline separates a light character from a dark stage. It does nothing at all
 * for a dark character, because the outline, the character and the floor are then all the
 * same value -- the Magus is a navy robe at median luminance 39 on floors at 21-29, and a
 * near-black rim left it invisible. Those need a *light* rim instead.
 *
 * `--outline auto` picks by the sheet's own median luminance. The light value is measured,
 * not chosen by taste: against a floor at ~25, luminance 70 barely separates and 166 reads
 * as a selection highlight stuck on the sprite. 97 is the one that looks like art. */
const OUTLINE_DARK = '140f1c';
const OUTLINE_LIGHT = '55608a';
const OUTLINE_LIGHT_BELOW = 45;

const img = decodePng(readFileSync(input));
const {width: W, height: H} = img;

/** `--flip-x` mirrors the source before anything else looks at it.
 *
 * Sheets must be authored facing right; the renderer mirrors heroes, who face the boss on
 * their left. A generator told to face right will sometimes face left anyway -- it did on
 * the Blademage -- and the result renders facing away from its opponent. Flipping here
 * keeps the fix in one deterministic place instead of asking for the art again, and doing
 * it up front means the component finder, the bounding boxes and the resampler all see
 * the corrected image. */
const flipX = args.includes('--flip-x');
const rgba = flipX ? (() => {
  const out = Buffer.alloc(img.rgba.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const from = (y * W + (W - 1 - x)) * 4;
      const to = (y * W + x) * 4;
      img.rgba.copy(out, to, from, from + 4);
    }
  }
  return out;
})() : img.rgba;

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

let figures = comps.filter(c => c.n >= minPixels);

/** Splits a component that is really two frames touching.
 *
 * The most likely merge by far is a thrust whose weapon tip reaches into the next cell: a
 * long sword or trident bridges two figures through a few pixels. Refusing is correct when
 * the sheet is genuinely ambiguous, but here the fix is unambiguous -- cut at the narrowest
 * column inside the component, which is the bridge itself.
 *
 * Only attempted on components far wider than the median, and only at a column carrying a
 * small fraction of the typical ink, so a legitimately wide pose is never cut in half.
 * Each half keeps whatever pixels fall in its own box, so a sword tip may stay at the edge
 * of a neighbour's cell; that is invisible at final size and better than losing the frame. */
const splitMerged = (list, expected) => {
  const widths = [...list.map(c => c.w)].sort((a, b) => a - b);
  const medianW = widths[Math.floor(widths.length / 2)] ?? 0;
  const out = [];
  let splits = 0;
  // Only split while components are actually missing, so a wide-but-whole pose is safe.
  let need = expected - list.length;
  for (const c of list) {
    if (need > 0 && c.w > medianW * 1.5) {
      // Per-column ink for this component only, so a neighbour cannot hide the seam.
      const cols = new Array(c.w).fill(0);
      for (let y = c.miny; y <= c.maxy; y++) {
        for (let x = c.minx; x <= c.maxx; x++) {
          if (label[y * W + x] === c.id) cols[x - c.minx]++;
        }
      }
      const lo = Math.floor(c.w * 0.25), hi = Math.ceil(c.w * 0.75);
      let seam = -1, seamInk = Infinity;
      for (let i = lo; i < hi; i++) if (cols[i] < seamInk) { seamInk = cols[i]; seam = i; }
      const typical = cols.reduce((a, b) => a + b, 0) / c.w;
      if (seam >= 0 && seamInk <= typical * 0.2) {
        const halves = [[c.minx, c.minx + seam], [c.minx + seam + 1, c.maxx]].map(([x0, x1]) => {
          // Cutting the bridge orphans whatever crossed it -- typically the tip of the
          // neighbour's weapon, which would otherwise float at the edge of this cell as a
          // stray nub. Re-label within the half and keep only the largest piece, which is
          // the figure; the orphan is dropped the same way debris is.
          const seen = new Set();
          let best = null;
          for (let sy = c.miny; sy <= c.maxy; sy++) {
            for (let sx = x0; sx <= x1; sx++) {
              const start = sy * W + sx;
              if (label[start] !== c.id || seen.has(start)) continue;
              let sp = 0;
              stack[sp++] = start;
              seen.add(start);
              let mnx = W, mxx = -1, mny = H, mxy = -1, n = 0;
              while (sp > 0) {
                const q = stack[--sp];
                const qx = q % W, qy = (q - qx) / W;
                n++;
                if (qx < mnx) mnx = qx;
                if (qx > mxx) mxx = qx;
                if (qy < mny) mny = qy;
                if (qy > mxy) mxy = qy;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = qx + dx, ny = qy + dy;
                    if (nx < x0 || nx > x1 || ny < c.miny || ny > c.maxy) continue;
                    const r = ny * W + nx;
                    if (label[r] === c.id && !seen.has(r)) { seen.add(r); stack[sp++] = r; }
                  }
                }
              }
              if (!best || n > best.n) {
                best = {id: c.id, n, minx: mnx, maxx: mxx, miny: mny, maxy: mxy,
                  w: mxx - mnx + 1, h: mxy - mny + 1};
              }
            }
          }
          return best;
        }).filter(h => h && h.n >= minPixels);
        if (halves.length === 2) {
          out.push(...halves);
          splits++;
          need--;
          console.log(`  split         a ${c.w}px component into ${halves[0].w}px and ` +
            `${halves[1].w}px at a ${seamInk}px seam (two frames were touching)`);
          continue;
        }
      }
    }
    out.push(c);
  }
  return splits ? out : list;
};
if (figures.length < cols * rows) figures = splitMerged(figures, cols * rows);
console.log(`\n${input}`);
console.log(`  source        ${W}x${H}${flipX ? '  (mirrored by --flip-x)' : ''}`);
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
 * and that is what makes anchorY equal to the cell height.
 *
 * An outline is traced *outward* after scaling, so it consumes a pixel of this margin on
 * every side. Without accounting for it the outline lands exactly on the cell boundary,
 * which is what the linter then reports for almost every frame. */
const pad = Number(flag('pad', outlineFlag ? '2' : '1'));
const scale = Math.min((cellW - 2 * pad) / maxW, (cellH - pad) / maxH);
console.log(`  largest figure ${maxW}x${maxH} -> scale ${scale.toFixed(4)} ` +
  `(${Math.round(maxW * scale)}x${Math.round(maxH * scale)} in a ${cellW}x${cellH} cell)`);

// --- resample and pack ----------------------------------------------------------------
const outW = cols * cellW, outH = rows * cellH;
const dest = Buffer.alloc(outW * outH * 4);

/** Area-average a source rectangle down to one destination pixel.
 *
 * Restricted to the figure's own connected component, not merely to non-key pixels. A wide
 * pose has a wide bounding box, and a neighbour's weapon tip can fall inside it -- sampling
 * the whole mask drew those strays as detached fragments at the edge of the cell. Keying on
 * the label means a frame can only ever draw its own figure, which also discards whatever
 * was orphaned by a split. */
const sampleBox = (x0, y0, x1, y1, id) => {
  let r = 0, g = 0, b = 0, hits = 0, total = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      total++;
      const i = y * W + x;
      if (label[i] !== id) continue;
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
        const px = sampleBox(sx0, sy0, sx1, sy1, f.id);
        if (!px) continue;
        const di = ((oy + dy) * outW + (ox + dx)) * 4;
        dest[di] = px[0]; dest[di + 1] = px[1]; dest[di + 2] = px[2]; dest[di + 3] = px[3];
      }
    }
  }
}

// --- optional silhouette outline ------------------------------------------------------
/** `--outline` traces a hard dark edge around every figure.
 *
 * This is what SNES sprites had and these do not. On a flat near-black stage a sprite's
 * own edge is enough, because there is nothing to confuse it with. On a detailed backdrop
 * both the sprite edge and the scenery behind it are a pixel of noise each, and the
 * silhouette stops existing. One dark pixel all the way round restores it regardless of
 * what is behind.
 *
 * Drawn outward into transparent pixels, so it never eats the art -- the figure gets 1px
 * bigger rather than 1px of detail poorer. The outline colour is deliberately not pure
 * black: a near-black tinted toward the character keeps it from looking like a sticker. */
let outline = outlineFlag;
if (outline === 'auto') {
  const vals = [];
  for (let i = 0; i < outW * outH; i++) {
    if (!dest[i * 4 + 3]) continue;
    vals.push(0.2126 * dest[i * 4] + 0.7152 * dest[i * 4 + 1] + 0.0722 * dest[i * 4 + 2]);
  }
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)] ?? 255;
  outline = median < OUTLINE_LIGHT_BELOW ? OUTLINE_LIGHT : OUTLINE_DARK;
  console.log(`  outline       median luminance ${median.toFixed(0)} -> ` +
    `${median < OUTLINE_LIGHT_BELOW ? 'light' : 'dark'} rim #${outline}`);
}
if (outline) {
  const [or_, og, ob] = [0, 2, 4].map(i => parseInt(outline.slice(i, i + 2), 16));
  let traced = 0;
  // Per cell, with everything outside the cell treated as empty. Scanning the whole sheet
  // let a figure near its right margin write an outline pixel into the next cell, which
  // both dirties that frame and makes the linter report almost every frame as touching an
  // edge. A frame's outline belongs to that frame.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cellW, y0 = r * cellH;
      const inside = (x, y) => x >= x0 && y >= y0 && x < x0 + cellW && y < y0 + cellH;
      const solid = (x, y) => inside(x, y) && dest[((y * outW) + x) * 4 + 3] > 0;
      const edge = [];
      for (let y = y0; y < y0 + cellH; y++) {
        for (let x = x0; x < x0 + cellW; x++) {
          if (solid(x, y)) continue;
          // 4-connected: an 8-connected outline reads as a fat halo at this size.
          if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
            edge.push(y * outW + x);
          }
        }
      }
      for (const i of edge) {
        dest[i * 4] = or_; dest[i * 4 + 1] = og; dest[i * 4 + 2] = ob; dest[i * 4 + 3] = 255;
      }
      traced += edge.length;
    }
  }
  console.log(`  outline       ${traced} px traced in #${outline}, clipped to each cell`);
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
    // Looped rather than Math.max(...vals): a 96x96 boss sheet has ~119k opaque pixels,
    // and spreading that many arguments overflows the call stack. A hero sheet has ~27k
    // and squeaked under the limit, so this only showed up on the first boss.
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
