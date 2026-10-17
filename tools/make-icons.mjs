#!/usr/bin/env node
/** Generates the app icon set.
 *
 * Each size is drawn natively from scaled geometry rather than rendered large and
 * downscaled — the same lesson the sprite work taught: reducing a detailed image to 32px
 * produces mud, and an icon is judged at 48px on a home screen.
 *
 * The motif is a single upright sword on a dark field. At icon sizes only a silhouette
 * survives, so one bold shape beats any amount of detail, and a sword reads as "battle"
 * without needing text.
 *
 *   npm run icons
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {encodePng} from './png.mjs';
import {repoPath, root} from './load.mjs';

const COLOURS = {
  ground: [0x0b, 0x0d, 0x16],
  groundLight: [0x16, 0x1b, 0x2e],
  edge: [0x8e, 0x9b, 0xb3],
  blade: [0xdc, 0xe6, 0xf4],
  bladeShade: [0x8d, 0xa2, 0xc4],
  gold: [0xd9, 0xa5, 0x2a],
  goldLight: [0xf5, 0xdc, 0x78],
  grip: [0x3a, 0x2a, 0x1c],
};

/** Draws the icon at an exact pixel size.
 *
 * `inset` is the fraction of the canvas left empty around the motif. Maskable icons need
 * their content inside the centre ~80%, because the platform may crop to a circle. */
/** Below this, the icon needs chunkier proportions rather than the same shapes scaled:
 * a blade that is 13% of a 192px canvas is 25px and reads fine, but 4px at 32px reads as
 * a scratch. Favicons get a bolder variant. */
const BOLD_BELOW = 64;

function drawIcon(size, {inset = 0.08, roundCorners = true} = {}) {
  const bold = size < BOLD_BELOW;
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };
  const rect = (x, y, w, h, colour) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(Math.round(x + dx), Math.round(y + dy), colour);
  };

  // Background. A maskable icon must be fully bled to the edges, since the platform
  // crops it; a regular icon gets rounded corners so it looks deliberate when not masked.
  // A border costs pixels the motif needs at small sizes.
  const radius = roundCorners && !bold ? Math.round(size * 0.18) : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (radius) {
        // Skip pixels outside the rounded rectangle.
        const cx = x < radius ? radius : x >= size - radius ? size - 1 - radius : x;
        const cy = y < radius ? radius : y >= size - radius ? size - 1 - radius : y;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      }
      // A soft vertical gradient, quantised so it stays flat and poster-like.
      const band = Math.floor((y / size) * 4);
      put(x, y, band >= 3 ? COLOURS.groundLight : COLOURS.ground);
    }
  }

  // Slate edge, only on the unmasked variant where the border is visible.
  if (radius) {
    const t = Math.max(1, Math.round(size * 0.025));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = x < radius ? radius : x >= size - radius ? size - 1 - radius : x;
        const cy = y < radius ? radius : y >= size - radius ? size - 1 - radius : y;
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        const inCorner = x < radius || x >= size - radius || y < radius || y >= size - radius;
        const nearEdge = inCorner
          ? d2 <= radius ** 2 && d2 >= (radius - t) ** 2
          : x < t || x >= size - t || y < t || y >= size - t;
        if (nearEdge && (!inCorner || d2 <= radius ** 2)) put(x, y, COLOURS.edge);
      }
    }
  }

  // Sword geometry, all proportional to the usable area.
  const usable = size * (1 - inset * 2);
  const left = size * inset;
  const top = size * inset;
  const centreX = Math.round(size / 2);

  const p = bold
    ? {blade: 0.26, bladeTop: 0.04, bladeH: 0.56, guardW: 0.82, guardH: 0.14, gripH: 0.22,
       gripW: 0.16, pommel: 0.22}
    : {blade: 0.13, bladeTop: 0.06, bladeH: 0.58, guardW: 0.52, guardH: 0.085, gripH: 0.19,
       gripW: 0.075, pommel: 0.12};
  const bladeW = Math.max(bold ? 5 : 2, Math.round(usable * p.blade));
  const bladeTop = Math.round(top + usable * p.bladeTop);
  const bladeH = Math.round(usable * p.bladeH);
  const guardY = bladeTop + bladeH;
  const guardW = Math.max(bold ? 11 : 4, Math.round(usable * p.guardW));
  const guardH = Math.max(bold ? 3 : 2, Math.round(usable * p.guardH));
  const gripH = Math.round(usable * p.gripH);
  const gripW = Math.max(bold ? 3 : 2, Math.round(usable * p.gripW));
  const pommel = Math.max(bold ? 5 : 2, Math.round(usable * p.pommel));

  // Blade, with a tapered tip and a lit edge down one side.
  const tip = bold ? Math.max(2, Math.round(bladeW * 0.8)) : Math.round(bladeW * 1.4);
  for (let i = 0; i < tip; i++) {
    const w = Math.max(1, Math.round((bladeW * (i + 1)) / tip));
    rect(centreX - Math.floor(w / 2), bladeTop + i, w, 1, COLOURS.blade);
  }
  rect(centreX - Math.floor(bladeW / 2), bladeTop + tip, bladeW, bladeH - tip, COLOURS.blade);
  rect(centreX + Math.ceil(bladeW / 2) - Math.max(1, Math.round(bladeW * 0.35)),
    bladeTop + tip, Math.max(1, Math.round(bladeW * 0.35)), bladeH - tip, COLOURS.bladeShade);

  // Crossguard, grip, pommel.
  rect(centreX - Math.floor(guardW / 2), guardY, guardW, guardH, COLOURS.gold);
  rect(centreX - Math.floor(guardW / 2), guardY, guardW, Math.max(1, Math.round(guardH * 0.4)),
    COLOURS.goldLight);
  rect(centreX - Math.floor(gripW / 2), guardY + guardH, gripW, gripH, COLOURS.grip);
  rect(centreX - Math.floor(pommel / 2), guardY + guardH + gripH, pommel, pommel, COLOURS.gold);

  return rgba;
}

const TARGETS = [
  {file: 'icon-192.png', size: 192, options: {}},
  {file: 'icon-512.png', size: 512, options: {}},
  // Maskable: content pulled well inside, background bled to the edge.
  {file: 'icon-192-maskable.png', size: 192, options: {inset: 0.22, roundCorners: false}},
  {file: 'icon-512-maskable.png', size: 512, options: {inset: 0.22, roundCorners: false}},
  // iOS reads this one; it is composited on an opaque tile, so no rounded corners.
  {file: 'apple-touch-icon.png', size: 180, options: {inset: 0.12, roundCorners: false}},
  {file: 'favicon-32.png', size: 32, options: {inset: 0.06}},
  {file: 'favicon-16.png', size: 16, options: {inset: 0.0}},
];

const dir = repoPath('web/public/icons');
mkdirSync(dir, {recursive: true});
console.log('');
for (const target of TARGETS) {
  const rgba = drawIcon(target.size, target.options);
  const png = encodePng(target.size, target.size, rgba);
  writeFileSync(path.join(dir, target.file), png);
  console.log(`  ${target.file.padEnd(26)} ${target.size}x${target.size}  ${(png.length / 1024).toFixed(1)} KiB`);
}
console.log(`\n  wrote ${TARGETS.length} icons to ${path.relative(root, dir)}\n`);
