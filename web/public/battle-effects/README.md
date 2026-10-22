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

### Keying is not enough: despill

Keying answers "is this pixel background", which is binary. It does not answer "how much of
the key is mixed into this pixel", and for soft art the answer is a lot. The neutral flare's
expanding ring is a thin white glow laid over green, so every surviving ring pixel is a
white-green average -- correctly kept as art, over 300 from pure green, and visibly green on
screen. The palette pass then spent two of its twelve slots preserving the tint.

`pack-effect.mjs` therefore despills by default: in the key's dominant channel, no pixel may
exceed what the other two channels support, so a white-green blend returns to white while a
deliberately warm or cool pixel is untouched. Pass `--no-despill` only for art that is
genuinely the key's hue, such as a green poison cloud keyed on green.

## Anchors and timing

`anchorY` in `web/src/effect-manifest.json` is measured from the top of the frame **down to
the point that lands on the target's feet**, and `anchorX` 32 is the horizontal centre of
every sheet. The shipped values were measured from the art rather than guessed, because what
`anchorY` should be depends entirely on where the animation's own contact point sits:

| Effect | `anchorY` | Measured from |
| --- | --- | --- |
| `slash` | 48 | arc core at y=30, which the 48 cap puts 18px up -- mid-torso on a 40px hero |
| `flare_neutral` | 52 | burst core at y=32, lifted 20px to mid-torso |
| `flare_ice` | 52 | burst core at y=32, same |
| `flare_fire` | 63 | flames rise from the frame's bottom edge; that edge is the ground |
| `flare_lightning` | 53 | widest row of the impact flash (48 of 64 px at y=53) |
| `flare_holy` | 53 | centre of the ground ring (rows 51-55 are widest at 38px) |

A ground effect and an overhead flare share one code path because the anchor is always the
target's feet; only these numbers differ. Re-measure after any repack -- a change of scale
moves the contact point.

At its peak frame a 64x64 flare fully covers a 40px hero, since the layer draws opaque at
alpha 1. That is intended: it is one frame of five, the frames either side are smaller, and
full occlusion on impact is what the era did.

Frames are **stretched to fit the effect's duration** (`DEFAULT_EFFECT_MS`, 260 ms), so
choose a frame count that reads well rather than one matching a timing. At a quarter of a
second the shape has to be legible immediately: appear, peak, dissipate.

## Installing one

Generator output does not go in this directory. Keep the raw sheet in
`art-reference/effects/<id>-source.png` and pack it down to the cell size:

```sh
node tools/pack-effect.mjs art-reference/effects/slash-source.png \
  --out web/public/battle-effects/slash.png --frames 4 --cell 64x48
node tools/pack-effect.mjs art-reference/effects/flare_fire-source.png \
  --out web/public/battle-effects/flare_fire.png --frames 5 --cell 64x64
```

`pack-effect.mjs` exists separately from `pack-spritesheet.mjs` because the two want
opposite things. The sprite packer re-centres every pose onto a common ground line, which is
right for a figure that must not drift between its idle and its attack and **wrong** for an
effect, whose internal motion is the content: re-centring each frame would delete the sweep
of an arc and make the effect jitter in place. So the effect packer finds the union of every
frame's artwork, scales that union once, and draws each frame at its own position inside it.

Art alone does not enable an effect. Add its id to `shipped` in
`web/src/effect-manifest.json`, then run `npm run effects:check` -- it fails if that list
and this directory disagree, so the two cannot drift. Until an id is listed, the renderer
is never offered the sheet: no draw command, no failed request, no console noise, and the
stage keeps its hit flash and shake.
