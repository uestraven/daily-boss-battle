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

/** Checks the tolerance against the image rather than trusting it.
 *
 * The default of 180 assumes the background is the only thing near the key colour. That
 * fails whenever a character shares the key's hue, and it fails silently: the Oracle's
 * sheet keys a magenta background behind a figure shaded in lavender and pale purple, and
 * at tolerance 300 it removed 80% of the image. The figure count still came out at 64,
 * every per-frame check still passed, and the sheet was ruined -- a pile of disconnected
 * skin and hair fragments. Only rendering it showed that.
 *
 * So the distance histogram is read directly. A keyable image is bimodal: a tight
 * background cluster, a sparse valley of edge blends, then the character's mass. The
 * tolerance belongs in the valley. If it reaches into the character, say so and name a
 * better value -- that is cheap to compute and would have turned a silent ruin into a
 * one-line warning. */
(() => {
  const BUCKET = 10;
  const hist = new Array(Math.ceil(766 / BUCKET)).fill(0);
  let counted = 0;
  for (let i = 0; i < W * H; i++) {
    if (rgba[i * 4 + 3] <= 8) continue;
    const d = Math.abs(rgba[i * 4] - keyRgb[0]) + Math.abs(rgba[i * 4 + 1] - keyRgb[1])
      + Math.abs(rgba[i * 4 + 2] - keyRgb[2]);
    hist[Math.floor(d / BUCKET)]++;
    counted++;
  }
  if (!counted) return;
  const kept = mask.reduce((n, v) => n + v, 0);
  const keptPercent = (100 * kept) / counted;
  console.log(`  key           tolerance ${tolerance}, keeps ${keptPercent.toFixed(1)}% of the source`);

  // Sparse means "not plausibly a region of the image": below a fifth of a percent.
  const sparse = b => hist[b] < counted * 0.002;
  // Skip any sparse buckets before the background cluster. The cluster is not centred on
  // the key colour exactly -- this sheet's background is a noisy magenta whose mass sits
  // at 20-49, with only 0.1% at 0-9 -- so starting the scan at zero finds "the background
  // ends at 0" and recommends a tolerance of 5.
  let b = 0;
  while (b < hist.length && sparse(b)) b++;
  if (b >= hist.length) return;
  let backgroundEnds = b;
  while (backgroundEnds < hist.length && !sparse(backgroundEnds)) backgroundEnds++;
  let characterStarts = backgroundEnds;
  while (characterStarts < hist.length && sparse(characterStarts)) characterStarts++;
  if (characterStarts >= hist.length) return;

  let characterTotal = 0;
  let characterKeyed = 0;
  for (let k = characterStarts; k < hist.length; k++) characterTotal += hist[k];
  for (let k = characterStarts; k * BUCKET < tolerance && k < hist.length; k++) characterKeyed += hist[k];
  const erodedPercent = characterTotal ? (100 * characterKeyed) / characterTotal : 0;
  const valleyLow = backgroundEnds * BUCKET;
  const valleyHigh = characterStarts * BUCKET;
  const suggestion = Math.round((valleyLow + valleyHigh) / 2);
  if (tolerance >= valleyHigh) {
    // A warning, not a failure. Reaching into the artwork is sometimes the right call: the
    // Blademage's sheet has a faint projectile trail in exactly this band, and keeping it
    // bridges two frames into one 342px component, which collapses the shared scale and
    // renders every sprite at 16px. Lowering its tolerance to the "correct" valley made
    // that sheet far worse. So the tool reports what it sees and leaves the judgement to
    // whoever can look at the result.
    console.log(`\n  CHECK   tolerance ${tolerance} reaches past ${valleyHigh}, where this`);
    console.log(`  image's own colours begin (its background sits below ${valleyLow}). Roughly`);
    console.log(`  ${erodedPercent.toFixed(0)}% of the figure's pixels are being keyed away with it.`);
    console.log('  Sometimes deliberate -- faint trails in this band keep touching frames');
    console.log(`  apart -- but if the sheet looks wrong, try --tolerance ${suggestion} and`);
    console.log('  compare. Render it; the frame count will not tell you.');
  }
  if (tolerance < valleyLow) {
    console.log(`  key           NOTE tolerance ${tolerance} is below the background's spread `
      + `(${valleyLow}); expect a fringe. --tolerance ${suggestion} is clear of both.`);
  }
})();

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

/** Attaches sub-threshold pieces to the figure sharing their source cell.
 *
 * --min-pixels exists to drop scanner debris, and it ran before anything could claim a
 * small piece as part of a pose. That cost the Oracle the sparkles around her staff: 45
 * components in her attack row measure 8 to 399 pixels, which is 5 to 8 pixels once
 * scaled -- small, deliberate, and silently binned. They were missing at every tolerance,
 * so no sheet has ever shipped with them.
 *
 * Assignment is by source cell rather than by distance. A sparkle can sit well clear of
 * the staff, so a gap threshold loose enough to catch it would also reach into the next
 * frame; the cell boundary is exactly the line that must not be crossed. A piece is taken
 * only when its cell holds precisely one real figure, so an ambiguous case is left alone
 * rather than guessed at. */
const attachSmallPieces = (keepers, all) => {
  if (!keepers.length) return keepers;
  const cellW = W / cols;
  const cellH = H / rows;
  const cellOf = c => `${Math.floor((c.minx + c.w / 2) / cellW)},${Math.floor((c.miny + c.h / 2) / cellH)}`;
  const byCell = new Map();
  for (const figure of keepers) {
    const cell = cellOf(figure);
    byCell.set(cell, byCell.has(cell) ? null : figure);
  }
  const inks = keepers.map(c => c.n).sort((a, b) => a - b);
  const medianInk = inks[inks.length >> 1];
  let attached = 0;
  let pixels = 0;
  for (const piece of all) {
    if (piece.n >= minPixels) continue;
    // Single stray pixels are noise in anyone's book.
    if (piece.n < 8) continue;
    if (piece.n > medianInk * 0.4) continue;
    const host = byCell.get(cellOf(piece));
    if (!host) continue;
    host.ids = host.ids ?? new Set([host.id]);
    host.ids.add(piece.id);
    // Never downward. The resampler bottom-aligns a figure's box to the cell floor, so the
    // lowest pixel in that box *is* the ground line. The Oracle's walk has a gold mote
    // below her hem in two frames: attaching it dropped the box, which planted the mote on
    // the floor and lifted her body 8px off it -- a bounce mid-stride. A piece above or
    // beside the figure is decoration; a piece below its feet would be underground anyway,
    // so it is left outside the box and simply not drawn.
    host.minx = Math.min(host.minx, piece.minx);
    host.maxx = Math.max(host.maxx, piece.maxx);
    host.miny = Math.min(host.miny, piece.miny);
    host.w = host.maxx - host.minx + 1;
    host.h = host.maxy - host.miny + 1;
    host.n += piece.n;
    attached++;
    pixels += piece.n;
  }
  if (attached) {
    console.log(`  small pieces  kept ${attached} under --min-pixels ${minPixels} `
      + `(${pixels}px) by the cell they sit in`);
  }
  return keepers;
};
figures = attachSmallPieces(figures, comps);

/** Re-attaches a piece that broke off the figure it belongs to.
 *
 * The counterpart to splitMerged. A pose can come apart into more than one component --
 * a shield held clear of the body, a weapon head, a trailing cloak -- and then it counts
 * twice. Raising --min-pixels would hide the miscount by *deleting* the piece, which
 * silently drops part of the pose: the Vanguard's row 2 col 6 had a 50x50, 1101px fragment
 * that would have vanished that way.
 *
 * The test is containment: the fragment's box sits inside another figure's box. At eight
 * poses to a row no whole pose fits inside another's box, so containment means a part, not
 * a neighbour. That makes this safe to apply whatever the count, rather than only when it
 * happens to reconcile. A merged figure carries every label it is made of, because the
 * resampler keys on the label to avoid drawing a neighbour's pixels. */
const joinDetached = list => {
  // A pose never carries a fifth of the ink of a typical one, so anything that light is a
  // piece of something rather than a thing. Paired with touching boxes, that is enough to
  // reattach it safely.
  const inks = list.map(c => c.n).sort((a, b) => a - b);
  const medianInk = inks.length ? inks[inks.length >> 1] : 0;
  const fragmentary = c => medianInk > 0 && c.n < medianInk * 0.4;
  // Overlapping or near-touching, in either axis. Containment alone was too strict: the
  // Oracle's raised staff sticks out past its figure's box on two sides, overlapping
  // without being inside it.
  const touches = (a, b) => a !== b
    && a.minx <= b.maxx + 3 && b.minx <= a.maxx + 3
    && a.miny <= b.maxy + 3 && b.miny <= a.maxy + 3;

  const hosts = [...list].sort((x, y) => y.n - x.n);
  const merged = new Set();
  const joins = [];
  for (const piece of [...list].sort((x, y) => x.n - y.n)) {
    if (merged.has(piece) || !fragmentary(piece)) continue;
    const host = hosts.find(h => h.n > piece.n && !merged.has(h) && touches(piece, h));
    if (!host) continue;
    host.ids = host.ids ?? new Set([host.id]);
    host.ids.add(piece.id);
    // The host's box has to grow to cover the piece, or the resampler crops it back off --
    // but never downward, for the ground-line reason given in attachSmallPieces.
    host.minx = Math.min(host.minx, piece.minx);
    host.maxx = Math.max(host.maxx, piece.maxx);
    host.miny = Math.min(host.miny, piece.miny);
    host.w = host.maxx - host.minx + 1;
    host.h = host.maxy - host.miny + 1;
    host.n += piece.n;
    merged.add(piece);
    joins.push(`${piece.w}x${piece.h} (${piece.n}px) into ${host.w}x${host.h}`);
  }
  if (joins.length) {
    console.log(`  re-attached   ${joins.length} detached piece(s): ${joins.join(', ')}`);
  }
  return list.filter(f => !merged.has(f));
};
figures = joinDetached(figures);

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

/** Drops surplus frames from any row that has more than the grid allows.
 *
 * A generator asked for eight frames a row can give nine. The Lancer's last row does: its
 * ninth pose is the loop's closing frame, a 97% silhouette match for the first, where two
 * genuinely adjacent poses in that row match only 63%. So the extra is a duplicate and
 * dropping it loses nothing -- but the packer refused the sheet outright rather than
 * saying so.
 *
 * Rows are banded by vertical centre and the leftmost `cols` kept in each, because frames
 * read left to right; a surplus frame is therefore the rightmost, which is where a closing
 * duplicate sits. Every drop is named, since this is a guess about intent and the operator
 * is the one who can check it. Only runs when there is a surplus, so a correct sheet takes
 * exactly the path it always did. */
const trimExtraPerRow = list => {
  if (list.length <= cols * rows) return list;
  const bandOf = f => Math.min(rows - 1, Math.floor(((f.miny + f.maxy) / 2) / (H / rows)));
  const bands = new Map();
  for (const f of list) {
    const b = bandOf(f);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push(f);
  }
  const kept = [];
  const dropped = [];
  for (const [band, members] of [...bands.entries()].sort((a, b) => a[0] - b[0])) {
    members.sort((a, b) => (a.minx + a.maxx) - (b.minx + b.maxx));
    kept.push(...members.slice(0, cols));
    for (const extra of members.slice(cols)) dropped.push(`row ${band + 1} at x=${extra.minx}`);
  }
  if (dropped.length) {
    console.log(`  extra frames  dropped ${dropped.length} beyond ${cols} per row: `
      + `${dropped.join(', ')}`);
    console.log('                check these are surplus; the rightmost of a row is usually');
    console.log('                a closing duplicate of its first frame');
  }
  return kept;
};
figures = trimExtraPerRow(figures);
console.log(`\n${input}`);
console.log(`  source        ${W}x${H}${flipX ? '  (mirrored by --flip-x)' : ''}`);
console.log(`  figures found ${figures.length} (expected ${cols * rows})`);
if (figures.length !== cols * rows) {
  console.error(`\n  PROBLEM  found ${figures.length} figures, not ${cols * rows}.`);
  console.error('  Frames that touch merge into one component; frames that break up into');
  console.error('  separate pieces count twice. Either raise --min-pixels to ignore debris,');
  console.error('  or the sheet needs more space between poses.');
  // Positions, not just sizes. A bare size list says something is wrong without saying
  // where to look, which means opening the source and hunting by eye. The source row and
  // column are what actually locate the offender, so they are printed first, and the odd
  // sizes are flagged against the median so the stray reads at a glance.
  // Flagged on pixel count, not on height. A KO or prone row is legitimately short and
  // wide -- the Vanguard's row 6 poses are 46-70px tall against a 126px median -- but it
  // still carries a full figure's worth of pixels. Area is what separates a real pose from
  // a fragment.
  const areas = [...figures].map(f => f.n).sort((a, b) => a - b);
  const medianN = areas[areas.length >> 1];
  const cellW = W / cols, cellH = H / rows;
  console.error('\n  every figure, by position in the source:');
  for (const f of [...figures].sort((a, b) => (a.miny + a.maxy) - (b.miny + b.maxy)
    || (a.minx + a.maxx) - (b.minx + b.maxx))) {
    const row = Math.floor((f.miny + f.h / 2) / cellH);
    const col = Math.floor((f.minx + f.w / 2) / cellW);
    const odd = f.n < medianN * 0.4 ? '   <-- far fewer pixels than a pose; a fragment'
      : f.w > cellW * 1.4 ? '   <-- much wider than a cell; two frames merged'
      : '';
    console.error(`    row ${row} col ${col}  ${String(f.w).padStart(3)}x${String(f.h).padStart(3)}`
      + `  at (${f.minx},${f.miny})  ${String(f.n).padStart(5)} px${odd}`);
  }
  console.error(`\n  median figure ${medianN}px of ink. --min-pixels is currently ${minPixels}.`);
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
const sampleBox = (x0, y0, x1, y1, ids) => {
  let r = 0, g = 0, b = 0, hits = 0, total = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      total++;
      const i = y * W + x;
      if (!ids.has(label[i])) continue;
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
        const px = sampleBox(sx0, sy0, sx1, sy1, f.ids ?? new Set([f.id]));
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
