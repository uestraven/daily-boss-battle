#!/usr/bin/env node
/** Sprite sheet linter.
 *
 * Decodes a PNG and checks it against the animation manifest: grid alignment, frame
 * occupancy, edge bleed, figure bounds against the declared anchor, and palette size.
 * Zero dependencies — PNG inflate comes from node:zlib.
 *
 * The palette check is the useful one for AI-generated or downscaled art: hand-authored
 * pixel art has tens of colours, a reduced illustration has thousands of anti-aliased
 * ones, and that is visible in the count long before it is visible to the eye.
 *
 *   npm run art:lint -- web/public/battle-sprites/heroes/blademage.png
 *   npm run art:lint -- <file> --frame 32x40 --rows idle:2,attack:4
 *   npm run art:lint -- <file> --id blademage        use the manifest entry
 */
import {readFileSync, existsSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import path from 'node:path';
import {load, repoPath, root} from './load.mjs';

// ---------------------------------------------------------------- PNG decoding
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decodes a non-interlaced, 8-bit PNG to {width, height, rgba}. */
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  let palette = null;
  let paletteAlpha = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') paletteAlpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('missing IHDR');
  if (header.bitDepth !== 8) throw new Error(`unsupported bit depth ${header.bitDepth}; use 8`);
  if (header.interlace) throw new Error('interlaced PNGs are not supported; save without Adam7');

  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);
  if (header.colorType === 3 && !palette) throw new Error('palette image without PLTE');

  const raw = inflateSync(Buffer.concat(idat));
  const {width, height} = header;
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);

  // Reverse the per-scanline filters.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let value = src[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown scanline filter ${filter}`);
      out[i] = value & 0xff;
    }
  }

  // Normalise to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (header.colorType === 6) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = lines[s + 3]; }
    else if (header.colorType === 2) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = 255; }
    else if (header.colorType === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = 255; }
    else if (header.colorType === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = lines[s + 1]; }
    else {
      const index = lines[s];
      rgba[d] = palette[index * 3]; rgba[d + 1] = palette[index * 3 + 1]; rgba[d + 2] = palette[index * 3 + 2];
      rgba[d + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
    }
  }
  return {width, height, rgba};
}

// ---------------------------------------------------------------- analysis
const ALPHA_FLOOR = 8; // below this a pixel counts as transparent

function cellStats(image, x0, y0, w, h) {
  let opaque = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  const colours = new Set();
  let edge = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * 4;
      if (image.rgba[i + 3] < ALPHA_FLOOR) continue;
      opaque++;
      colours.add((image.rgba[i] << 16) | (image.rgba[i + 1] << 8) | image.rgba[i + 2]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1) edge++;
    }
  }
  return {
    opaque, colours: colours.size, edge,
    bounds: opaque ? {x: minX - x0, y: minY - y0, width: maxX - minX + 1, height: maxY - minY + 1} : null,
  };
}

// ---------------------------------------------------------------- cli
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const target = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
if (!target) {
  console.error('Usage: npm run art:lint -- <file.png> [--frame 32x40] [--rows idle:2,attack:4] [--id blademage]');
  process.exit(2);
}
const file = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(2); }

// Frame size and clips come from the manifest when an id is given, otherwise from flags.
let frameWidth; let frameHeight; let clips = null; let anchorY = null; let source;
const id = flag('--id');
if (id) {
  const manifest = JSON.parse(readFileSync(repoPath('web/src/sprite-manifest.json'), 'utf8'));
  const entry = manifest.heroes?.[id] ?? manifest.bosses?.[id];
  if (!entry) { console.error(`No manifest entry for "${id}"`); process.exit(2); }
  ({frameWidth, frameHeight, anchorY} = entry);
  clips = entry.clips;
  source = `manifest entry "${id}"`;
} else {
  const frame = flag('--frame', '32x40');
  const match = /^(\d+)x(\d+)$/.exec(frame);
  if (!match) { console.error(`--frame must look like 32x40, got "${frame}"`); process.exit(2); }
  frameWidth = Number(match[1]); frameHeight = Number(match[2]);
  const rows = flag('--rows');
  if (rows) {
    clips = {};
    rows.split(',').forEach((spec, index) => {
      const [name, frames] = spec.split(':');
      clips[name] = {row: index, frames: Number(frames), loop: name === 'idle'};
    });
  }
  source = `--frame ${frameWidth}x${frameHeight}`;
}

let image;
try { image = decodePng(readFileSync(file)); }
catch (error) { console.error(`Could not read ${path.basename(file)}: ${error.message}`); process.exit(1); }

const problems = [];
const warnings = [];

console.log(`\n${path.relative(root, file) || file}`);
console.log(`  image        ${image.width} x ${image.height}`);
console.log(`  frame        ${frameWidth} x ${frameHeight}   (${source})`);

// --- grid alignment ----------------------------------------------------------
const cols = image.width / frameWidth;
const rows = image.height / frameHeight;
console.log(`  grid         ${image.width / frameWidth} x ${image.height / frameHeight} cells`);
if (!Number.isInteger(cols)) {
  problems.push(`width ${image.width} is not a multiple of frame width ${frameWidth} ` +
    `(nearest: ${Math.round(cols) * frameWidth})`);
}
if (!Number.isInteger(rows)) {
  problems.push(`height ${image.height} is not a multiple of frame height ${frameHeight} ` +
    `(nearest: ${Math.round(rows) * frameHeight})`);
}

// --- palette -----------------------------------------------------------------
const whole = cellStats(image, 0, 0, image.width, image.height);
console.log(`  colours      ${whole.colours} distinct`);
if (whole.colours > 256) {
  problems.push(`${whole.colours} distinct colours. Hand-authored pixel art at this size ` +
    `uses tens, not hundreds. This many means anti-aliasing from a downscaled illustration, ` +
    `which will read as mud at ${frameWidth}x${frameHeight}.`);
} else if (whole.colours > 64) {
  warnings.push(`${whole.colours} colours is high for a ${frameWidth}x${frameHeight} sprite; ` +
    `a tighter palette reads more clearly and looks more deliberate.`);
}
const coverage = whole.opaque / (image.width * image.height);
console.log(`  coverage     ${(coverage * 100).toFixed(1)}% opaque`);

// --- per-frame ---------------------------------------------------------------
if (clips && Number.isInteger(cols) && Number.isInteger(rows)) {
  console.log('\n  clip      row  frame  opaque  bounds (x,y,w,h)        notes');
  for (const [name, clip] of Object.entries(clips)) {
    if (clip.row >= rows) {
      problems.push(`clip "${name}" declares row ${clip.row}, but the image only has ${rows} rows`);
      continue;
    }
    if (clip.frames > cols) {
      problems.push(`clip "${name}" declares ${clip.frames} frames, but a row only holds ${cols}`);
    }
    for (let frame = 0; frame < Math.min(clip.frames, cols); frame++) {
      const stats = cellStats(image, frame * frameWidth, clip.row * frameHeight, frameWidth, frameHeight);
      const notes = [];
      if (stats.opaque === 0) {
        notes.push('EMPTY');
        problems.push(`clip "${name}" frame ${frame} is empty`);
      } else {
        if (stats.edge > 0) {
          notes.push(`${stats.edge}px on the cell edge`);
          warnings.push(`clip "${name}" frame ${frame} touches the cell edge in ${stats.edge} places; ` +
            `content will clip or bleed into the neighbouring frame`);
        }
        if (anchorY !== null && stats.bounds) {
          const feet = stats.bounds.y + stats.bounds.height;
          if (Math.abs(feet - anchorY) > 2) {
            notes.push(`feet at y=${feet}, anchorY=${anchorY}`);
            warnings.push(`clip "${name}" frame ${frame}: figure bottom is y=${feet} but anchorY is ` +
              `${anchorY}; the actor will float or sink relative to the others`);
          }
        }
      }
      const b = stats.bounds;
      console.log(`  ${name.padEnd(9)} ${String(clip.row).padStart(3)} ${String(frame).padStart(6)} ` +
        `${String(stats.opaque).padStart(7)}  ${(b ? `${b.x},${b.y},${b.width},${b.height}` : '-').padEnd(22)}  ${notes.join('; ')}`);
    }
  }

  // Consistent horizontal placement matters: a figure that shifts between frames jitters.
  for (const [name, clip] of Object.entries(clips)) {
    if (clip.row >= rows) continue;
    const centres = [];
    for (let frame = 0; frame < Math.min(clip.frames, cols); frame++) {
      const stats = cellStats(image, frame * frameWidth, clip.row * frameHeight, frameWidth, frameHeight);
      if (stats.bounds) centres.push(stats.bounds.x + stats.bounds.width / 2);
    }
    if (centres.length > 1) {
      const spread = Math.max(...centres) - Math.min(...centres);
      if (spread > frameWidth * 0.25) {
        warnings.push(`clip "${name}": the figure's horizontal centre moves ${spread.toFixed(0)}px ` +
          `across frames; it will appear to slide. Keep the body anchored and move limbs.`);
      }
    }
  }
} else if (clips) {
  console.log('\n  (per-frame checks skipped: the grid does not divide evenly)');
}

// --- verdict -----------------------------------------------------------------
// The report is about the image, not about this tool. Say so plainly: an exit code and
// the word FAIL otherwise read as though the linter itself broke.
console.log();
for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
for (const warning of warnings) console.log(`  ADVICE   ${warning}`);
console.log();

const gridBroken = !Number.isInteger(cols) || !Number.isInteger(rows);
const looksGenerated = whole.colours > 256;

if (!problems.length && !warnings.length) {
  console.log('  VERDICT: usable as-is. Grid, frames, alignment and palette all check out.');
} else if (!problems.length) {
  console.log('  VERDICT: usable. The advice above would improve it but nothing is broken.');
} else if (gridBroken && looksGenerated) {
  console.log('  VERDICT: this is an illustration, not a sprite sheet.');
  console.log();
  console.log('  That is a statement about the image, not an error in this tool. The image has');
  console.log(`  no ${frameWidth}x${frameHeight} grid and far too many colours to be pixel art at that size.`);
  console.log('  There is no automated fix: a large illustration reduced to sprite size loses the');
  console.log('  detail that made it readable. It has to be drawn at the target size.');
  console.log();
  // Target canvas comes from the declared clips, not from the oversized source image.
  const wantCols = clips ? Math.max(...Object.values(clips).map(c => c.frames)) : 4;
  const wantRows = clips ? Object.keys(clips).length : 2;
  console.log('  Keep this image as reference for costume, palette and silhouette, then redraw:');
  console.log(`    canvas ${wantCols * frameWidth} x ${wantRows * frameHeight} ` +
    `(${wantCols} x ${wantRows} cells of ${frameWidth} x ${frameHeight}), under 64 colours,`);
  console.log('    hard-edged pixels, feet on each cell baseline, no effects in the frames.');
  console.log('  See docs/ART-AND-AUDIO-SPEC.md for the full brief.');
} else if (gridBroken) {
  console.log('  VERDICT: the canvas is not a clean grid, so the frames cannot be indexed.');
  console.log(`  Resize the canvas to an exact multiple of ${frameWidth} x ${frameHeight} and re-run.`);
} else {
  console.log('  VERDICT: it is a grid, but some frames need fixing. See the problems above.');
}
console.log();
process.exit(problems.length ? 1 : 0);
