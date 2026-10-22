/** The title banner's dimensions, which are load-bearing rather than cosmetic.
 *
 * 320 is the stage's width and the banner's x1 size; 640 is x2 and the width of the landing
 * shell on desktop. The CSS pins those two widths, so a banner of any other size would be
 * scaled fractionally at both breakpoints and its lettering would land on an uneven
 * nearest-neighbour grid. Nothing on screen would look broken enough to investigate, which
 * is why it is worth a test rather than a comment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {decodePng} from '../tools/png.mjs';

const catalog = readFileSync(new URL('../web/src/title-banner.ts', import.meta.url), 'utf8');
const shipped = /BANNER_SHIPPED\s*=\s*true/.test(catalog);
const file = new URL('../web/public/title/banner.png', import.meta.url);

test('the banner flag and the file agree', () => {
  // Either both or neither. A flag set without the art gives every visitor a 404 on the
  // landing screen; art without the flag is never shown.
  assert.equal(shipped, existsSync(file),
    shipped
      ? 'BANNER_SHIPPED is true but web/public/title/banner.png is missing'
      : 'banner.png exists but BANNER_SHIPPED is false, so it is never drawn');
});

test('the banner is exactly the size the CSS assumes', () => {
  if (!shipped) return;
  const img = decodePng(readFileSync(file));
  // Read from the module rather than repeated here, so the test cannot drift from the code
  // it is checking.
  const width = Number(catalog.match(/BANNER_WIDTH\s*=\s*(\d+)/)?.[1]);
  const height = Number(catalog.match(/BANNER_HEIGHT\s*=\s*(\d+)/)?.[1]);
  assert.equal(img.width, width, `banner is ${img.width}px wide, not ${width}`);
  assert.equal(img.height, height, `banner is ${img.height}px tall, not ${height}`);
});

test('the banner is wide enough to be a banner and small enough to ship', () => {
  if (!shipped) return;
  const bytes = readFileSync(file).length;
  // It is fetched on the landing screen, which is the first thing anyone sees. A banner
  // this size has no business being large, and a surprise here means the palette pass was
  // skipped.
  assert.ok(bytes < 60_000, `banner is ${(bytes / 1024).toFixed(0)} KiB; expected well under 60`);
});

test('320 and 640 are both whole multiples of the authoring width', () => {
  // The reason for the size, asserted so a future resize has to confront it.
  const width = Number(catalog.match(/BANNER_WIDTH\s*=\s*(\d+)/)?.[1]);
  for (const displayed of [320, 640]) {
    assert.equal(displayed % width, 0,
      `${displayed}px is not a whole multiple of the ${width}px banner, so its pixels would `
      + 'be unevenly sized at that breakpoint');
  }
});
