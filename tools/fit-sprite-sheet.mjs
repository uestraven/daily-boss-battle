#!/usr/bin/env node
/** Mechanically converts a large multi-pose illustration into a grid-aligned sprite sheet.
 *
 * This does not turn an illustration into good pixel art — nothing automated does. What it
 * does is produce a *technically valid* sheet: exact canvas size, uniform grid, poses
 * cropped and centred, feet on the baseline, and a reduced palette. That is enough to see
 * the character animating in the game and to use as a base for hand cleanup.
 *
 * Zero dependencies: inflate and deflate from node:zlib.
 *
 *   node tools/fit-sprite-sheet.mjs <in.png> --rows idle:2,attack:4 --frame 32x40 --out <out.png>
 *   ... --colours 16     palette size (default 16)
 *   ... --pad 2          transparent margin inside each cell (default 2)
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {deflateSync, inflateSync} from 'node:zlib';
import path from 'node:path';
import {root} from './load.mjs';

// ---------------------------------------------------------------- PNG in
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8; let header = null; let palette = null; let paletteAlpha = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') header = {width: data.readUInt32BE(0), height: data.readUInt32BE(4),
      bitDepth: data[8], colorType: data[9], interlace: data[12]};
    else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') paletteAlpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }
  if (!header) throw new Error('missing IHDR');
  if (header.bitDepth !== 8) throw new Error(`bit depth ${header.bitDepth} unsupported`);
  if (header.interlace) throw new Error('interlaced PNG unsupported');
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[header.colorType];
  if (!channels) throw new Error(`colour type ${header.colorType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const {width, height} = header;
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels; const d = i * 4;
    if (header.colorType === 6) rgba.set(lines.subarray(s, s + 4), d);
    else if (header.colorType === 2) { rgba.set(lines.subarray(s, s + 3), d); rgba[d + 3] = 255; }
    else if (header.colorType === 0) { rgba.fill(lines[s], d, d + 3); rgba[d + 3] = 255; }
    else if (header.colorType === 4) { rgba.fill(lines[s], d, d + 3); rgba[d + 3] = lines[s + 1]; }
    else {
      const index = lines[s];
      rgba[d] = palette[index * 3]; rgba[d + 1] = palette[index * 3 + 1]; rgba[d + 2] = palette[index * 3 + 2];
      rgba[d + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
    }
  }
  return {width, height, rgba};
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter: none
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- analysis
const OPAQUE = 16;
const alphaAt = (img, x, y) => img.rgba[(y * img.width + x) * 4 + 3];

/** Horizontal bands of the image that contain content. */
function contentBands(img) {
  const counts = [];
  for (let y = 0; y < img.height; y++) {
    let n = 0;
    for (let x = 0; x < img.width; x++) if (alphaAt(img, x, y) > OPAQUE) n++;
    counts.push(n);
  }
  const bands = []; let start = null;
  for (let y = 0; y < img.height; y++) {
    const on = counts[y] > 2;
    if (on && start === null) start = y;
    if (!on && start !== null) { if (y - start > 8) bands.push([start, y - 1]); start = null; }
  }
  if (start !== null) bands.push([start, img.height - 1]);
  return bands;
}

/** Splits a band into `count` cells.
 *
 * Column projection alone fails when a raised or extended weapon bridges the gap between
 * two figures. So the split uses *body* density: a column is body if it has a lot of
 * content, which a thin blade does not. Peaks become body centres, and cells are cut at
 * the midpoints between them. */
function splitBand(img, [y0, y1], count) {
  const height = y1 - y0 + 1;
  const density = [];
  for (let x = 0; x < img.width; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (alphaAt(img, x, y) > OPAQUE) n++;
    density.push(n);
  }
  // Body columns carry a decent fraction of the band height.
  const bodyThreshold = height * 0.25;
  const clusters = []; let start = null;
  for (let x = 0; x < img.width; x++) {
    const on = density[x] >= bodyThreshold;
    if (on && start === null) start = x;
    if (!on && start !== null) { if (x - start > 8) clusters.push([start, x - 1]); start = null; }
  }
  if (start !== null) clusters.push([start, img.width - 1]);

  if (clusters.length !== count) {
    // Fall back to equal slices across the band's full content extent.
    let minX = img.width, maxX = 0;
    for (let x = 0; x < img.width; x++) if (density[x] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const width = (maxX - minX + 1) / count;
    return {
      cells: Array.from({length: count}, (_, i) =>
        [Math.round(minX + i * width), Math.round(minX + (i + 1) * width) - 1]),
      method: `equal slices (found ${clusters.length} body clusters, expected ${count})`,
    };
  }
  // Cut at midpoints between adjacent body centres.
  const centres = clusters.map(([a, b]) => (a + b) / 2);
  const cells = [];
  for (let i = 0; i < count; i++) {
    const left = i === 0 ? 0 : Math.round((centres[i - 1] + centres[i]) / 2);
    const right = i === count - 1 ? img.width - 1 : Math.round((centres[i] + centres[i + 1]) / 2) - 1;
    cells.push([left, right]);
  }
  return {cells, method: 'body-density split'};
}

/** Content bounds within a region. */
function bounds(img, x0, x1, y0, y1) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alphaAt(img, x, y) <= OPAQUE) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

/** The figure's feet and torso width within a region.
 *
 * The bounding box is the wrong reference: an extended or lowered weapon makes the box
 * taller and wider than the body, so fitting the box scales the body down and lifts the
 * feet off the baseline. Body columns carry a lot of content; a thin blade does not. */
function bodyMetrics(img, x0, x1, y0, y1) {
  const height = y1 - y0 + 1;
  const density = [];
  for (let x = x0; x <= x1; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (alphaAt(img, x, y) > OPAQUE) n++;
    density.push(n);
  }
  const threshold = Math.max(4, height * 0.2);
  let bodyMinX = -1, bodyMaxX = -1;
  density.forEach((n, i) => {
    if (n < threshold) return;
    if (bodyMinX < 0) bodyMinX = x0 + i;
    bodyMaxX = x0 + i;
  });
  if (bodyMinX < 0) return null;
  // Feet: the lowest opaque row inside the body columns.
  let feet = y0;
  for (let y = y1; y >= y0; y--) {
    let n = 0;
    for (let x = bodyMinX; x <= bodyMaxX; x++) if (alphaAt(img, x, y) > OPAQUE) n++;
    if (n > 1) { feet = y; break; }
  }
  // Head: the highest opaque row inside the body columns.
  let head = y1;
  for (let y = y0; y <= y1; y++) {
    let n = 0;
    for (let x = bodyMinX; x <= bodyMaxX; x++) if (alphaAt(img, x, y) > OPAQUE) n++;
    if (n > 1) { head = y; break; }
  }
  return {minX: bodyMinX, maxX: bodyMaxX, feet, head, height: feet - head + 1,
    centre: (bodyMinX + bodyMaxX) / 2};
}

/** Box-samples a source region into a destination cell, then binarises alpha.
 * Averaging beats nearest-neighbour when reducing 10x: nearest drops most of the
 * silhouette, averaging keeps the shape, and the palette step hardens it again. */
function sampleInto(img, src, dest, out, outWidth) {
  for (let dy = 0; dy < dest.height; dy++) {
    for (let dx = 0; dx < dest.width; dx++) {
      const sx0 = src.x + Math.floor((dx * src.width) / dest.width);
      const sx1 = src.x + Math.max(sx0 + 1, Math.floor(((dx + 1) * src.width) / dest.width));
      const sy0 = src.y + Math.floor((dy * src.height) / dest.height);
      const sy1 = src.y + Math.max(sy0 + 1, Math.floor(((dy + 1) * src.height) / dest.height));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < img.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < img.width; sx++) {
          const i = (sy * img.width + sx) * 4;
          const alpha = img.rgba[i + 3];
          if (alpha > OPAQUE) { r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; a += alpha; }
          n++;
        }
      }
      if (!n || a === 0) continue;
      const opaqueCount = a / 255;
      // A destination pixel is solid only if most of its source area was solid.
      if (opaqueCount / n < 0.35) continue;
      const d = ((dest.y + dy) * outWidth + dest.x + dx) * 4;
      out[d] = Math.round(r / opaqueCount);
      out[d + 1] = Math.round(g / opaqueCount);
      out[d + 2] = Math.round(b / opaqueCount);
      out[d + 3] = 255;
    }
  }
}

/** Median-cut palette reduction, then map every pixel to its nearest palette entry. */
function quantise(rgba, size) {
  const pixels = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (!pixels.length) return 0;
  let boxes = [pixels];
  while (boxes.length < size) {
    // Split the box with the widest channel range.
    let target = -1, bestRange = -1, bestChannel = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; target = index; bestChannel = c; }
      }
    });
    if (target < 0 || bestRange <= 0) break;
    const box = boxes[target];
    box.sort((p, q) => p[bestChannel] - q[bestChannel]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }
  const palette = boxes.filter(b => b.length).map(box => {
    const sum = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
    return sum.map(v => Math.round(v / box.length));
  });
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    let best = 0, bestDistance = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const dr = rgba[i] - palette[p][0], dg = rgba[i + 1] - palette[p][1], db = rgba[i + 2] - palette[p][2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) { bestDistance = distance; best = p; }
    }
    rgba[i] = palette[best][0]; rgba[i + 1] = palette[best][1]; rgba[i + 2] = palette[best][2];
  }
  return palette.length;
}

// ---------------------------------------------------------------- cli
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const input = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input) {
  console.error('Usage: node tools/fit-sprite-sheet.mjs <in.png> --rows idle:2,attack:4 [--frame 32x40] [--out out.png]');
  process.exit(2);
}
const frameSpec = /^(\d+)x(\d+)$/.exec(flag('--frame', '32x40'));
if (!frameSpec) { console.error('--frame must look like 32x40'); process.exit(2); }
const frameWidth = Number(frameSpec[1]); const frameHeight = Number(frameSpec[2]);
const rowSpec = (flag('--rows', 'idle:2,attack:4')).split(',').map(spec => {
  const [name, frames] = spec.split(':');
  return {name, frames: Number(frames)};
});
const colours = Number(flag('--colours', '16'));
const pad = Number(flag('--pad', '2'));
const outPath = flag('--out', input.replace(/\.png$/, '.sheet.png'));

const image = decodePng(readFileSync(path.resolve(process.cwd(), input)));
const bands = contentBands(image);
console.log(`\nsource ${image.width} x ${image.height}, ${bands.length} content band(s)`);
if (bands.length < rowSpec.length) {
  console.error(`Found ${bands.length} bands but --rows declares ${rowSpec.length}. ` +
    `Make sure the poses are in separate horizontal rows with a clear gap.`);
  process.exit(1);
}

const cols = Math.max(...rowSpec.map(r => r.frames));
const outWidth = cols * frameWidth;
const outHeight = rowSpec.length * frameHeight;
const out = Buffer.alloc(outWidth * outHeight * 4);

// Plan every frame first, so one scale can be applied to all of them. A per-frame fit
// would shrink poses whose weapon extends furthest, making the body size and the feet
// line jump between frames.
const plan = [];
rowSpec.forEach((row, rowIndex) => {
  const band = bands[rowIndex];
  const {cells, method} = splitBand(image, band, row.frames);
  console.log(`\n  row ${rowIndex} "${row.name}": ${row.frames} frames, ${method}`);
  cells.forEach(([x0, x1], frame) => {
    const box = bounds(image, x0, x1, band[0], band[1]);
    const body = bodyMetrics(image, x0, x1, band[0], band[1]);
    if (!box || !body) { console.log(`    frame ${frame}: empty source region`); return; }
    plan.push({rowIndex, frame, name: row.name, box, body});
  });
});
if (!plan.length) { console.error('No usable frames found.'); process.exit(1); }

// One scale for the whole sheet. Sizing purely by body height makes poses whose weapon
// extends furthest wider than the cell, so they clip; the scale is therefore the most
// restrictive of "tallest body fills the cell" and "widest/tallest bounding box fits".
// Bodies end up smaller than the cell, which is the honest consequence of a pose whose
// weapon reaches well beyond the figure.
const targetBodyHeight = frameHeight - pad * 2;
const tallestBody = Math.max(...plan.map(p => p.body.height));
const widestBox = Math.max(...plan.map(p => p.box.width));
const tallestBox = Math.max(...plan.map(p => p.box.height));
const byBody = targetBodyHeight / tallestBody;
const byWidth = (frameWidth - pad * 2) / widestBox;
const byHeight = (frameHeight - pad * 2) / tallestBox;
const scale = Math.min(byBody, byWidth, byHeight);
const limiting = scale === byBody ? 'body height' : scale === byWidth ? 'pose width' : 'pose height';

for (const item of plan) {
  const {rowIndex, frame, box, body} = item;
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  // Align the BODY's feet to the baseline and its centre to the cell centre, then place
  // the bounding box relative to that. A weapon may then extend past the cell and clip,
  // which is correct: the body is what must stay consistent.
  const baseline = frameHeight - pad;
  const feetOffsetInBox = Math.round((body.feet - box.y) * scale);
  const centreOffsetInBox = Math.round((body.centre - box.x) * scale);
  let destX = frame * frameWidth + Math.round(frameWidth / 2) - centreOffsetInBox;
  let destY = rowIndex * frameHeight + baseline - feetOffsetInBox;
  // Keep the box from spilling into a neighbouring cell.
  const cellLeft = frame * frameWidth;
  destX = Math.max(cellLeft, Math.min(destX, cellLeft + frameWidth - width));
  destY = Math.max(rowIndex * frameHeight, Math.min(destY, rowIndex * frameHeight + frameHeight - height));
  sampleInto(image, box, {x: destX, y: destY, width, height}, out, outWidth);
  console.log(`    row ${rowIndex} frame ${frame}: body ${body.height}px -> ` +
    `${Math.round(body.height * scale)}px, box ${width}x${height} at ` +
    `(${destX - cellLeft},${destY - rowIndex * frameHeight})`);
}
console.log(`\n  uniform scale ${scale.toFixed(3)}, limited by ${limiting}`);
console.log(`  tallest body ${tallestBody}px -> ${Math.round(tallestBody * scale)}px of ${targetBodyHeight}px available`);
if (limiting !== 'body height') {
  console.log(`  NOTE: a pose reaches ${widestBox}x${tallestBox}px around a ${tallestBody}px body, so the`);
  console.log(`        figure cannot fill the cell. Either widen the frame or draw the weapon tighter.`);
}

const used = quantise(out, colours);
writeFileSync(path.resolve(process.cwd(), outPath), encodePng(outWidth, outHeight, out));
console.log(`\nwrote ${path.relative(root, path.resolve(process.cwd(), outPath))} ` +
  `— ${outWidth} x ${outHeight}, ${used} colours\n`);
console.log('This is a mechanical conversion, not finished pixel art. Hand-clean it in an');
console.log('editor: tighten silhouettes, redraw the outline, and fix the blade.\n');
