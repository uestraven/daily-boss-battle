# Codex portraits

Original artwork only. Nothing in this directory may be extracted, captured, or traced
from another company's game.

One **64x64** PNG per hero, named for the hero id: `warden.png`, `lancer.png`, and so on.
`npm run portraits:check` lists the full set and fails on a size mismatch or a file that
disagrees with `shippedPortraits`.

## No chroma key

Unlike the sprite sheets and the hit effects, a portrait keeps its own background, so there
is nothing to key out and none of the erosion risk that comes with it. Author on a plain
dark slate background. This matters: the magenta key cost real artwork on five sheets --
white sits only 255 from magenta in the packer's colour distance -- and a portrait avoids
the whole problem by never needing a key.

## Art has to be enabled, not just present

Add the hero's id to `shippedPortraits` in `web/src/portrait-catalog.ts`. Until it is
listed, the Codex card falls back to that hero's **battle sprite**, cropped to its idle
frame. That fallback is deliberate rather than a placeholder: the sprite is a real likeness,
it is already in the image cache, and it means the Codex was complete and useful before any
portrait existed. Each portrait upgrades one card as it arrives, and an uncommissioned one
costs no failed request and no console noise.

## Source files

Keep the generator's full-size output in `art-reference/portraits/`, which is gitignored,
and commit only the packed 64x64. Same arrangement as the sprite sheets, the arenas and the
effects.
