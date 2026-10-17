#!/usr/bin/env node
/** Generates valid placeholder sprite sheets for every combatant.
 *
 * These are not art. They are deliberately plain geometric figures — a readable
 * silhouette, a role colour, a weapon, and six genuinely different poses — drawn
 * pixel-by-pixel at the target resolution. The point is that they are *correct*: exact
 * grid, feet on the baseline, body centred, tight palette, hard pixels. That proves the
 * whole pipeline end to end and lets the game animate today, so real sheets are a
 * file swap rather than an integration project.
 *
 *   npm run art:placeholders
 *   npm run art:placeholders -- --only blademage
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {encodePng} from './png.mjs';
import {load, repoPath, root} from './load.mjs';

const {heroes} = await load('dist/src/roster.js');
const {bossProfiles} = await load('dist/src/encounters.js');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

/** Role palettes: a dark outline, two body tones, a skin tone and an accent. */
const ROLE_COLOURS = {
  Guardian:   {body: [0x4a, 0x72, 0xb0], light: [0x74, 0xa4, 0xe0], accent: [0xe8, 0xd8, 0x90]},
  Healer:     {body: [0x4e, 0x9c, 0x6e], light: [0x82, 0xd4, 0x9e], accent: [0xf0, 0xf0, 0xe0]},
  Striker:    {body: [0xb0, 0x7c, 0x38], light: [0xe0, 0xaa, 0x5c], accent: [0xf0, 0xe0, 0xa0]},
  Caster:     {body: [0x82, 0x56, 0xa8], light: [0xb0, 0x88, 0xd4], accent: [0x90, 0xe8, 0xf0]},
  Controller: {body: [0x3c, 0x96, 0x96], light: [0x68, 0xc8, 0xc8], accent: [0xf0, 0xf0, 0xd0]},
  Support:    {body: [0xa0, 0x98, 0x48], light: [0xd0, 0xc8, 0x70], accent: [0xf0, 0xf0, 0xe0]},
};
const BOSS_COLOURS = {body: [0x8c, 0x32, 0x50], light: [0xc0, 0x50, 0x74], accent: [0xf0, 0xd0, 0x60]};
const OUTLINE = [0x12, 0x10, 0x1c];
const SKIN = [0xe0, 0xb0, 0x88];
const STEEL = [0xc8, 0xd4, 0xe4];

/** A tiny mutable RGBA canvas with pixel-art primitives. */
function canvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  // Drawing is clipped to a region, so a pose can never bleed into the next cell no
  // matter what the pose maths produces. Guaranteeing this by construction beats tuning
  // every limb length until the linter stops complaining.
  let clip = {x: 0, y: 0, width, height};
  const setClip = region => { clip = region; };
  const inClip = (x, y) => x >= clip.x && y >= clip.y
    && x < clip.x + clip.width && y < clip.y + clip.height;
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height || !inClip(x, y)) return;
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  const rect = (x, y, w, h, colour) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(x + dx, y + dy, colour);
  };
  /** Bresenham, so a weapon is a clean pixel line rather than an anti-aliased one. */
  const line = (x0, y0, x1, y1, colour) => {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    for (;;) {
      put(x0, y0, colour);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  /** One-pixel dark outline around every opaque region. */
  const outline = () => {
    const copy = Buffer.from(data);
    const opaque = (x, y) => x >= 0 && y >= 0 && x < width && y < height
      && copy[(y * width + x) * 4 + 3] > 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (opaque(x, y)) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
          put(x, y, OUTLINE);
        }
      }
    }
  };
  return {data, put, rect, line, outline, setClip};
}

/** Draws one humanoid pose into a cell.
 *
 * `lean` shifts the upper body, `weaponAngle` swings the weapon, `drop` sinks the whole
 * figure. Together these make six visibly different poses from one routine. */
function drawFigure(c, cell, frame, palette, options) {
  const {x: ox, y: oy, width: cw, height: ch} = cell;
  // Reserve a 2px transparent margin inside the cell for the outline to live in.
  const margin = 2;
  c.setClip({x: ox + margin, y: oy + margin, width: cw - margin * 2, height: ch - margin * 2});
  const {lean = 0, weaponAngle = -30, drop = 0, armRaise = 0, collapsed = false} = options;
  // 3px, not 2: the outline pass adds a ring around everything drawn, and that ring must
  // also stay inside the cell or it bleeds into the neighbouring frame.
  const pad = 3;
  const baseline = oy + ch - pad;
  const centre = ox + Math.floor(cw / 2);
  const scale = Math.max(1, Math.floor(ch / 20));

  if (collapsed) {
    // Flat on the ground: a low mound plus a dropped weapon.
    const h = 3 * scale;
    const w = 9 * scale;
    c.rect(centre - Math.floor(w / 2), baseline - h, w, h, palette.body);
    c.rect(centre - Math.floor(w / 2), baseline - h, 3 * scale, h, palette.light);
    c.line(centre + Math.floor(w / 2) - scale, baseline - 1, centre + Math.floor(w / 2) + scale, baseline - 1, STEEL);
    c.outline();
    return;
  }

  const legH = 4 * scale;
  const bodyH = 6 * scale;
  const headH = 3 * scale;
  const bodyW = 6 * scale;
  const top = baseline - legH - bodyH - headH + drop;

  // Legs, planted.
  c.rect(centre - 2 * scale, baseline - legH, Math.max(1, scale), legH, palette.body);
  c.rect(centre + scale, baseline - legH, Math.max(1, scale), legH, palette.body);
  // Torso, leaning.
  c.rect(centre - Math.floor(bodyW / 2) + lean, baseline - legH - bodyH, bodyW, bodyH, palette.body);
  // Cloak or trim down one side, for silhouette asymmetry.
  c.rect(centre + Math.floor(bodyW / 2) - 2 * scale + lean, baseline - legH - bodyH,
    2 * scale, bodyH + 2, palette.light);
  // Head.
  c.rect(centre - Math.floor(headH / 2) - scale + lean, top, headH + scale, headH, SKIN);
  // Hair as an accent block on top.
  c.rect(centre - Math.floor(headH / 2) - scale + lean, top, headH + scale, Math.max(1, scale), palette.accent);
  // Weapon arm and blade: angle is what reads as the attack.
  const handX = centre - Math.floor(bodyW / 2) + lean - 1;
  const handY = baseline - legH - Math.floor(bodyH / 2) - armRaise;
  const reach = 5 * scale;
  const radians = (weaponAngle * Math.PI) / 180;
  c.line(handX, handY,
    Math.round(handX + Math.cos(radians) * reach),
    Math.round(handY + Math.sin(radians) * reach), STEEL);
  c.rect(handX - 1, handY - 1, 2, 2, palette.accent);
  c.outline();
}

/** The six clips, as pose parameters. Rows match the manifest. */
const CLIPS = [
  {name: 'idle', frames: 2, loop: true, frameMs: 320, pose: f => ({weaponAngle: -25, drop: f, lean: 0})},
  {name: 'attack', frames: 4, loop: false,
    pose: f => [{weaponAngle: -95, armRaise: 3, lean: -1}, {weaponAngle: -35, armRaise: 1, lean: 1},
      {weaponAngle: 25, armRaise: -1, lean: 2}, {weaponAngle: -20, lean: 0}][f]},
  {name: 'cast', frames: 3, loop: false,
    pose: f => ({weaponAngle: -80, armRaise: 2 + f, lean: 0, drop: -f})},
  {name: 'hurt', frames: 2, loop: false,
    pose: f => ({weaponAngle: -10, lean: 2 + f, drop: f})},
  {name: 'ko', frames: 3, loop: false,
    pose: f => (f === 2 ? {collapsed: true} : {weaponAngle: 10 + f * 20, lean: 3 + f * 2, drop: 2 + f * 3})},
  {name: 'victory', frames: 2, loop: true, frameMs: 400,
    pose: f => ({weaponAngle: -100, armRaise: 4 + f, lean: 0, drop: -f})},
];

function buildSheet({frameWidth, frameHeight, palette}) {
  const cols = Math.max(...CLIPS.map(c => c.frames));
  const width = cols * frameWidth;
  const height = CLIPS.length * frameHeight;
  const c = canvas(width, height);
  CLIPS.forEach((clip, row) => {
    for (let frame = 0; frame < clip.frames; frame++) {
      drawFigure(c, {x: frame * frameWidth, y: row * frameHeight, width: frameWidth, height: frameHeight},
        frame, palette, clip.pose(frame));
    }
  });
  return {width, height, data: c.data, cols};
}

const targets = [
  ...heroes.map(h => ({
    id: h.id, kind: 'heroes', frameWidth: 32, frameHeight: 40,
    palette: ROLE_COLOURS[h.role] ?? ROLE_COLOURS.Striker,
  })),
  ...bossProfiles.map(b => ({
    id: b.id, kind: 'bosses', frameWidth: 96, frameHeight: 96, palette: BOSS_COLOURS,
  })),
].filter(t => !only || t.id === only);

if (!targets.length) { console.error(`No combatant called "${only}"`); process.exit(2); }

const manifestPath = repoPath('web/src/sprite-manifest.json');
const manifest = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(manifestPath, 'utf8')));

console.log('');
for (const target of targets) {
  const sheet = buildSheet(target);
  const dir = repoPath('web/public/battle-sprites', target.kind);
  mkdirSync(dir, {recursive: true});
  writeFileSync(path.join(dir, `${target.id}.png`), encodePng(sheet.width, sheet.height, sheet.data));

  const entry = manifest[target.kind][target.id];
  entry.file = `${target.kind}/${target.id}.png`;
  entry.frameWidth = target.frameWidth;
  entry.frameHeight = target.frameHeight;
  entry.anchorX = Math.floor(target.frameWidth / 2);
  entry.anchorY = target.frameHeight - 2;
  entry.clips = Object.fromEntries(CLIPS.map((clip, row) => [clip.name,
    {row, frames: clip.frames, loop: clip.loop, ...(clip.frameMs ? {frameMs: clip.frameMs} : {})}]));
  console.log(`  ${target.id.padEnd(19)} ${sheet.width}x${sheet.height}  ` +
    `${sheet.cols} x ${CLIPS.length} cells of ${target.frameWidth}x${target.frameHeight}`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n  wrote ${targets.length} sheet(s) and updated the manifest`);
console.log('  These are placeholders: correct, not pretty. Replace the PNGs with real art.\n');
