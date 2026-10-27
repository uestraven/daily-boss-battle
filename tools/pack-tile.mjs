#!/usr/bin/env node
/** Packs a generated dungeon tile down to the grid, and measures whether it actually tiles.
 *
 *   node tools/pack-tile.mjs <input.png> --out <out.png> [--size 16] [--colours 16]
 *     [--seam both|horizontal|vertical|none]
 *
 * A fourth packer, and the only one whose job is partly *measurement*. The other three
 * reduce art and report what they did; a tile has a correctness property no amount of
 * looking reliably catches. A portrait only has to look good. A floor tile has to meet
 * itself at every edge, twenty times across a room, and a seam that is invisible in one
 * tile is a visible grid once it repeats -- which is exactly the kind of fault that ships
 * because the single tile looked fine.
 *
 * So this reports a seam score and fails on a bad one. The score is *relative*: it compares
 * the difference across the wrap-around edge against the typical difference between
 * neighbouring rows or columns inside the tile. Absolute difference would be useless, since
 * a high-contrast flagstone has large internal deltas everywhere and a flat wall has almost
 * none -- the question is never "how different are these two edges" but "are they more
 * different than the tile's own texture would lead you to expect".
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
const size = Number(flag('size', '16'));
// Lower than a portrait's 28: a 16x16 tile is 256 pixels, and a palette anywhere near that
// count stops being a palette. Sixteen is generous for masonry.
const colourLimit = Number(flag('colours', '16')) || 0;
/** Which edges this tile has to meet itself on. A door tiles on neither. */
const seam = flag('seam', 'both');
const allowSeam = args.includes('--allow-seam');

if (!input || input.startsWith('--') || !out) {
  console.error('usage: pack-tile.mjs <input.png> --out <out.png> [--size 16] '
    + '[--colours 16] [--seam both|horizontal|vertical|none] [--allow-seam]');
  process.exit(2);
}

const img = decodePng(readFileSync(input));
const {width: W, height: H, rgba} = img;
if (W !== H) {
  console.error(`\n  PROBLEM  ${input} is ${W}x${H}. A tile must be square.`);
  process.exit(1);
}

const dest = Buffer.alloc(size * size * 4);
for (let dy = 0; dy < size; dy++) {
  for (let dx = 0; dx < size; dx++) {
    const x0 = Math.floor((dx * W) / size), x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * W) / size));
    const y0 = Math.floor((dy * H) / size), y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * H) / size));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3]; n++;
      }
    }
    const d = (dy * size + dx) * 4;
    dest[d] = Math.round(r / n);
    dest[d + 1] = Math.round(g / n);
    dest[d + 2] = Math.round(b / n);
    dest[d + 3] = Math.round(a / n);
  }
}

// --- palette reduction (median cut, as the other packers use) ---------------------------
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

const at = (x, y) => {
  const o = ((y + size) % size * size + (x + size) % size) * 4;
  return [dest[o], dest[o + 1], dest[o + 2]];
};
const delta = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** Mean difference between two adjacent columns, wrapping. */
const columnDelta = (x) => {
  let sum = 0;
  for (let y = 0; y < size; y++) sum += delta(at(x, y), at(x + 1, y));
  return sum / size;
};
const rowDelta = (y) => {
  let sum = 0;
  for (let x = 0; x < size; x++) sum += delta(at(x, y), at(x, y + 1));
  return sum / size;
};

/** How much worse the wrap-around edge is than a typical interior neighbour pair.
 *
 * 1.0 means the seam is as ordinary as any other boundary inside the tile, which is what
 * seamless means in practice. The median of the interior is the comparison rather than the
 * mean, so one strong internal feature -- a mortar line, the edge of a slab -- cannot raise
 * the bar and hide a real seam behind it. */
const seamScore = (edgeDelta, interior) => {
  const sorted = [...interior].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return edgeDelta / Math.max(1, median);
};

const horizontal = seamScore(columnDelta(size - 1),
  Array.from({length: size - 1}, (_, x) => columnDelta(x)));
const vertical = seamScore(rowDelta(size - 1),
  Array.from({length: size - 1}, (_, y) => rowDelta(y)));

const colours = new Set();
for (let i = 0; i < size * size; i++) {
  colours.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
}

console.log(`\n${input}`);
console.log(`  source        ${W}x${H} -> ${size}x${size} (${(W / size).toFixed(2)}x area average)`);
console.log(`  colours       ${colours.size} after the palette pass`);
console.log(`  seam          horizontal ${horizontal.toFixed(2)}x, vertical ${vertical.toFixed(2)}x`
  + '   (1.00x = as ordinary as any interior edge)');

// 2.5x is the threshold where a seam stops being texture and starts being a line. Chosen
// from the first real set rather than from theory, and recorded here so a later change to it
// is a decision rather than a tweak.
const LIMIT = 2.5;
const failures = [];
if ((seam === 'both' || seam === 'horizontal') && horizontal > LIMIT) {
  failures.push(`horizontal seam is ${horizontal.toFixed(2)}x a normal interior edge`);
}
if ((seam === 'both' || seam === 'vertical') && vertical > LIMIT) {
  failures.push(`vertical seam is ${vertical.toFixed(2)}x a normal interior edge`);
}

if (failures.length && !allowSeam) {
  console.error(`\n  PROBLEM  this tile does not meet itself.`);
  for (const f of failures) console.error(`           ${f}`);
  console.error('  Repeated across a room that reads as a visible grid. Regenerate with the');
  console.error('  seamless requirement, or pass --allow-seam if this tile is not meant to');
  console.error('  repeat (a door, a chest, a set piece).');
  process.exit(1);
}

writeFileSync(out, encodePng(size, size, dest));
console.log(`  wrote         ${out}`);
