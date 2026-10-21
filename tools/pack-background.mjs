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
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {decodePng, encodePng} from './png.mjs';
import {load, repoPath} from './load.mjs';

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

/** Where the characters stand, and who stands there.
 *
 * The verdict used to be a fixed brightness threshold -- darker than 45 was "OK" -- on the
 * assumption that a dark backdrop is a safe one. That is wrong, and wrong in a way that
 * mattered: what hides a sprite is a backdrop of *similar luminance*, not a bright one. A
 * dark figure against bright mist is a silhouette and reads beautifully.
 *
 * Judged on brightness alone the tool approved the Sunken Waterway, where the Warden's
 * median of 36 sits against a party zone of 35 -- a contrast of 1, which is a character
 * you cannot see -- and flagged the Broken Span as LOUD when every hero has 35+ of
 * separation on it, the best in the game. It also printed hardcoded sprite medians as
 * "reference" that had gone stale as the sheets were replaced: it claimed the Oracle was
 * 86 when its current sheet measures 48.
 *
 * So the zones are now measured against the real sheets, read off disk, and the verdict is
 * the worst-case contrast rather than the absolute level. The party zone is checked against
 * every hero because any party can be drawn for any boss; the boss zone against that
 * boss's own sheet, found from the output filename.
 */
const ZONES = [
  {label: 'behind the boss', x: 36, y: 8, w: 112, h: 96, against: 'boss'},
  {label: 'behind the party', x: 208, y: 56, w: 68, h: 92, against: 'heroes'},
  {label: 'under the HP bar', x: 16, y: 8, w: 288, h: 14, against: null},
];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const medianOf = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Median colour of a region, on three opponent-ish axes.
 *
 * Luminance alone was not enough, and it misled twice. It reported the Mad Harlequin as
 * 2 apart from its own arena -- alarming -- when the figure is bright magenta and the
 * backdrop desaturated brown, which the eye separates easily. It also named the Vanguard
 * and the Warden as the closest heroes on that arena when both are comfortable in colour,
 * while missing the Machinist, which genuinely is close.
 *
 * So: lightness, red-vs-green and yellow-vs-blue. Crude next to a real perceptual space,
 * but it ranks pairings the way looking at them does, which is the only thing asked of it.
 */
const colourOf = pixels => {
  const l = [], rg = [], yb = [];
  for (const [r, g, b] of pixels) { l.push(lum(r, g, b)); rg.push(r - g); yb.push((r + g) / 2 - b); }
  return {lum: medianOf(l), rg: medianOf(rg), yb: medianOf(yb)};
};
/** Distance between two median colours. */
const apart = (a, b) => Math.round(Math.hypot(a.lum - b.lum, a.rg - b.rg, a.yb - b.yb));

/** Median colour of a sheet's opaque pixels, or null when it cannot be read. */
function sheetColour(file) {
  try {
    const image = decodePng(readFileSync(file));
    const pixels = [];
    for (let i = 0; i < image.width * image.height; i++) {
      const o = i * 4;
      if (image.rgba[o + 3] > 8) pixels.push([image.rgba[o], image.rgba[o + 1], image.rgba[o + 2]]);
    }
    return pixels.length ? colourOf(pixels) : null;
  } catch { return null; }
}

/** Every sheet in a directory, as {id, colour}, skipping local `-test` sources. */
function sheetsIn(dir) {
  const found = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.png') || /[-_]test\.png$/.test(name)) continue;
      const colour = sheetColour(`${dir}/${name}`);
      if (colour) found.push({id: name.replace(/\.png$/, ''), colour});
    }
  } catch { /* directory absent: fall back to no comparison */ }
  return found;
}

const spriteRoot = repoPath('web/public/battle-sprites');
const heroSheets = sheetsIn(`${spriteRoot}/heroes`);
const bossSheets = sheetsIn(`${spriteRoot}/bosses`);
const arenaId = out.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
const bossSheet = bossSheets.find(b => b.id === arenaId) ?? null;

console.log('');
for (const z of ZONES) {
  const vals = [];
  const pixels = [];
  for (let y = z.y; y < z.y + z.h; y++) {
    for (let x = z.x; x < z.x + z.w; x++) {
      const i = (y * outW + x) * 4;
      vals.push(lum(dest[i], dest[i + 1], dest[i + 2]));
      pixels.push([dest[i], dest[i + 1], dest[i + 2]]);
    }
  }
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const p90 = vals[Math.floor(vals.length * 0.9)];
  const zoneColour = colourOf(pixels);

  // Busyness drives the verdict, because it is the thing nothing downstream can fix. The
  // sprites carry an outline rim precisely so they separate from a backdrop of similar
  // value, and that rim works regardless of luminance -- but no rim rescues a sprite
  // standing in front of high-frequency detail.
  //
  // Luminance contrast is reported rather than judged, because judging it is not possible:
  // the roster spans 37 to 131, so every backdrop level is within 25 of *some* hero. A
  // dark floor hides the Warden; a pale one hides the Brawler. Naming which heroes are
  // closest is useful; failing the art for it is not.
  let edges = 0;
  let edgeCount = 0;
  for (let y = z.y; y < z.y + z.h; y++) {
    for (let x = z.x; x < z.x + z.w - 1; x++) {
      const a = (y * outW + x) * 4;
      const b = (y * outW + x + 1) * 4;
      edges += Math.abs(lum(dest[a], dest[a + 1], dest[a + 2]) - lum(dest[b], dest[b + 1], dest[b + 2]));
      edgeCount++;
    }
  }
  const busyness = edgeCount ? edges / edgeCount : 0;
  // Shipping arenas measure 4.8 to 7.1 behind the party; 10.8 is the busiest accepted.
  const verdict = busyness <= 8 ? 'OK  ' : busyness <= 14 ? 'BUSY' : 'LOUD';

  const compare = z.against === 'heroes' ? heroSheets
    : z.against === 'boss' ? (bossSheet ? [bossSheet] : [])
    : [];
  let note = `  busyness ${busyness.toFixed(1).padStart(4)}`;
  if (compare.length) {
    const closest = compare
      .map(sheet => ({id: sheet.id, contrast: apart(sheet.colour, zoneColour)}))
      .sort((a, b) => a.contrast - b.contrast)
      .slice(0, 3)
      .map(c => `${c.id} ${c.contrast}`);
    note += `  least separation: ${closest.join(', ')}`;
  }
  console.log(`  ${verdict.padEnd(5)} ${z.label.padEnd(18)} lum ${median.toFixed(0).padStart(3)}` +
    `  90th ${p90.toFixed(0).padStart(3)}${note}`);
}
if (heroSheets.length) {
  console.log(`  (separation is colour distance across ${heroSheets.length} real hero sheets `
    + '-- lightness plus two chroma axes, not lightness alone.');
  console.log('   Verdict is busyness, which no outline rim can compensate for. Separation is');
  console.log('   reported, not judged: the roster spans the whole range, so every backdrop');
  console.log('   sits close to someone.)');
}

writeFileSync(out, encodePng(outW, outH, dest));
const seen = new Set();
for (let i = 0; i < outW * outH; i++) {
  seen.add((dest[i * 4] << 16) | (dest[i * 4 + 1] << 8) | dest[i * 4 + 2]);
}
console.log(`\n  wrote         ${out}  ${outW}x${outH}, ${seen.size} colours\n`);
