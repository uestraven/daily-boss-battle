# Hit effects

Original artwork only. Nothing in this directory may be extracted, captured, or traced
from another company's game.

Effects are a separate layer, drawn over the stage and anchored on the **target**, not
baked into a character's frames. One `slash.png` therefore serves every weapon user, and
a sweeping crescent can be wider than a character cell without clipping or shrinking the
figure.

## The commissioning list

One animation per file, a single horizontal row of frames, left to right.

| File | Cell | Frames | Serves | Priority |
| --- | --- | --- | --- | --- |
| `slash.png` | 64x48 | 4 | 30 damage abilities — every weapon user and unarmed striker | **first** |
| `flare_neutral.png` | 64x64 | 5 | 10 — every spell with no element of its own | second |
| `flare_fire.png` | 64x64 | 5 | 5 — Fire, Fire II, Cruel Jest | third |
| `flare_ice.png` | 64x64 | 5 | 4 — Blizzard x3, Razor Confetti | third |
| `flare_lightning.png` | 64x64 | 5 | 3 — Thunder x2, Tri-Bolt | third |
| `flare_holy.png` | 64x64 | 5 | 1 — Force Cannon | last |
| `flare_dark.png` | 64x64 | 5 | **nothing** — see below | skip |

`flare_dark` is declared and unreachable. `Element` includes `dark`, but no ability in the
roster, the reference set, or any of the eight bosses uses it, so the art could never be
drawn. Leave it until a dark ability exists.

## Key the background out in green, not magenta

Author on **solid `#00FF00`**, with clear green space between frames.

The sprite sheets use magenta and it has cost real artwork: the Oracle lost 39% of her
robe, the Spell Weaver's entire baton glow vanished, the Vanguard's white claw swipes were
erased. White sits only 255 from magenta in the packer's colour distance, and effect art is
almost entirely white and pale, so magenta is the worst possible choice here. Green is 510
from both white and red. Pack with `--key 00ff00`.

## Anchors and timing

`anchorY` in `web/src/effect-manifest.json` is measured from the top of the frame **down to
the point that lands on the target's feet**. So `slash` at 40-of-48 sits just above the
ground, and the flares at 48-of-64 centre on the body with headroom above. `anchorX` 32 is
the horizontal centre of both.

Frames are **stretched to fit the effect's duration** (`DEFAULT_EFFECT_MS`, 260 ms), so
choose a frame count that reads well rather than one matching a timing. At a quarter of a
second the shape has to be legible immediately: appear, peak, dissipate.

## Installing one

Art alone does not enable an effect. Add its id to `shipped` in
`web/src/effect-manifest.json`, then run `npm run effects:check` -- it fails if that list
and this directory disagree, so the two cannot drift. Until an id is listed, the renderer
is never offered the sheet: no draw command, no failed request, no console noise, and the
stage keeps its hit flash and shake.

`shipped` is currently empty, which means `composeFrame` has never emitted an effect
command. The first file added here is the first time that code path runs for real, so add
`slash` alone and look at it before commissioning the rest.
