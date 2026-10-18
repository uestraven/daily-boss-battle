#!/usr/bin/env node
/** Reduces a generated backdrop to the stage's exact internal resolution.
 *
 * The stage blits a backdrop 1:1 at 320x180 and integer-scales the whole canvas
 * afterwards, so the art has to *be* 320x180 — there is no resampling step at runtime to
 * hide an odd size behind. Image generators cannot produce a canvas that small, so they
 * are asked for an exact multiple (1280x720 is 4x) and it is reduced here.
 *
 * Unlike the sprite packer there is no keying or component finding: a backdrop is opaque,
 * edge to edge, with nothing to separate. It is a box filter and a palette reduction.
 *
 *   node tools/pack-background.mjs <input.png> --out <output.png> [--colours 64]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {decodePng, encodePng} from './png.mjs';
import {load} from './load.mjs';

const {STAGE} = await load('dist/src/stage.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const input = args[0];
const out = flag('out');
if (!input || input.startsWith('--') || !out) {
  console.error('usage: pack-background.mjs <input.png> --out <out.png> [--colours 64]');
  process.exit(1);
}
const colourLimit = Number(flag('colours', '64')) || 0;

const img = decodePng(readFileSync(input));
const {width: W, height: H, rgba} = img;
const [outW, outH] = [STAGE.width, STAGE.height];

console.log(`\n${input}`);
console.log(`  source        ${W}x${H}`);
console.log(`  target        ${outW}x${outH}`);

const problems = [];
const advice = [];
// Aspect is the only hard requirement: a mismatch stretches the scene, and no amount of
// filtering recovers from that. Size is a quality question, not a correctness one.
const aspect = W / H, want = outW / outH;
if (Math.abs(aspect - want) > 0.01) {
  problems.push(`aspect is ${aspect.toFixed(3)} but the stage is ${want.toFixed(3)} ` +
    `(${outW}:${outH}). Reducing this would stretch the scene.`);
}
if (W % outW === 0 && H % outH === 0) {
  console.log(`  reduction     ${W / outW}x (exact)`);
} else {
  // Still a true area average, just over fractional source boundaries, which costs a
  // little crispness on hard edges rather than producing anything wrong.
  const factor = Math.round(W / outW);
  console.log(`  reduction     ${(W / outW).toFixed(3)}x (fractional)`);
  advice.push(`${W}x${H} is not a whole multiple of ${outW}x${outH}, so source pixels land ` +
    `on fractional boundaries and hard edges soften slightly. ` +
    `${outW * factor}x${outH * factor} would reduce exactly.`);
}
// Transparency in a backdrop means a hole in the world, which the flat fill would show
// through. Worth reporting rather than silently flattening.
let transparent = 0;
for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] < 250) transparent++;
if (transparent) {
  problems.push(`${transparent} pixels are not fully opaque; a backdrop must cover the stage`);
}
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  console.log('');
  process.exit(1);
}
for (const a of advice) console.log(`  ADVICE        ${a}`);

const sx = W / outW, sy = H / outH;
const dest = Buffer.alloc(outW * outH * 4);
for (let y = 0; y < outH; y++) {
  for (let x = 0; x < outW; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    const y0 = Math.floor(y * sy), y1 = Math.min(H, Math.ceil((y + 1) * sy));
    const x0 = Math.floor(x * sx), x1 = Math.min(W, Math.ceil((x + 1) * sx));
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const p = (j * W + i) * 4;
        r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2];
        n++;
      }
    }
    const d = (y * outW + x) * 4;
    dest[d] = Math.round(r / n);
    dest[d + 1] = Math.round(g / n);
    dest[d + 2] = Math.round(b / n);
    dest[d + 3] = 255;
  }
}

if (colourLimit > 0) {
  // Median cut, looped rather than spread: a full-bleed backdrop is 57,600 pixels and
  // Math.max(...) over that many arguments overflows the stack.
  const pixels = [];
  for (let i = 0; i < outW * outH; i++) {
    pixels.push([dest[i * 4], dest[i * 4 + 1], dest[i * 4 + 2]]);
  }
  let boxes = [pixels];
  while (boxes.length < colourLimit) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (!box || box.length < 2) { if (box) boxes.push(box); break; }
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
  console.log(`  palette       reduced to ${palette.length} colours`);
}

/** `--recede <0..1>` pushes the backdrop back behind the characters.
 *
 * Blends it toward the stage's own backdrop colour and drains saturation. A background
 * competing with the sprites for attention is the usual reason pixel characters look
 * pasted on: in the SNES games this imitates, the scenery is consistently lower contrast
 * and lower saturation than anything standing in front of it. */
const recede = Math.min(1, Math.max(0, Number(flag('recede', '0')) || 0));
if (recede > 0) {
  const [br, bg_, bb] = [0x0b, 0x0d, 0x16];
  for (let i = 0; i < outW * outH; i++) {
    const r = dest[i * 4], g = dest[i * 4 + 1], b = dest[i * 4 + 2];
    // Desaturate toward the pixel's own luminance first, then fade toward the backdrop.
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const dr = r + (l - r) * recede * 0.6;
    const dg = g + (l - g) * recede * 0.6;
    const db = b + (l - b) * recede * 0.6;
    dest[i * 4] = Math.round(dr + (br - dr) * recede);
    dest[i * 4 + 1] = Math.round(dg + (bg_ - dg) * recede);
    dest[i * 4 + 2] = Math.round(db + (bb - db) * recede);
  }
  console.log(`  recede        ${(recede * 100).toFixed(0)}% toward the stage backdrop`);
}

/** Where the characters stand. A backdrop brighter than the sprites in these rectangles
 * swallows them, and the darkest sheet so far has a median luminance of 38. */
const ZONES = [
  {label: 'behind the boss', x: 36, y: 8, w: 112, h: 96},
  {label: 'behind the party', x: 208, y: 56, w: 68, h: 92},
  {label: 'under the HP bar', x: 16, y: 8, w: 288, h: 14},
];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
console.log('');
for (const z of ZONES) {
  const vals = [];
  for (let y = z.y; y < z.y + z.h; y++) {
    for (let x = z.x; x < z.x + z.w; x++) {
      const i = (y * outW + x) * 4;
      vals.push(lum(dest[i], dest[i + 1], dest[i + 2]));
    }
  }
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const p90 = vals[Math.floor(vals.length * 0.9)];
  const verdict = median <= 45 ? 'OK  ' : median <= 70 ? 'BUSY' : 'LOUD';
  console.log(`  ${verdict} ${z.label.padEnd(18)} median luminance ${median.toFixed(0).padStart(3)}` +
    `  90th ${p90.toFixed(0).padStart(3)}`);
}
console.log('  (sprite medians for reference: Warden 38, Blademage 66, Oracle 86, Brawler 88.');
console.log('   A zone brighter than the sprite standing in it will swallow its silhouette.)');

writeFileSync(out, encodePng(outW, outH, dest));
const seen = new Set();
for (let i = 0; i < outW * outH; i++) {
  seen.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
}
console.log(`\n  wrote         ${out}  ${outW}x${outH}, ${seen.size} colours\n`);
