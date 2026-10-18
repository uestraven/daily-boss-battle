# Art and audio specification

Daily Boss Battle is a 16-bit-style turn-based boss-battle game for web and mobile. This
document is the complete brief for its art and music: what to produce, at what size, in
what format. It is self-contained — no access to the codebase is needed.

All characters, bosses and designs are **original to this project**. Parody a genre
trope, never a specific character from an existing game.

---

## The one-page version

**Sprites.** The battle stage renders at a fixed internal **320 × 180** pixels, scaled up
by whole numbers. So sprites are small and must read as silhouettes.

| | Frame size | Sheet canvas |
| --- | --- | --- |
| Hero | **32 × 40** (48 × 40 if a weapon reaches well past the body) | frames-per-row × 40 tall per row |
| Boss | **96 × 96** | as above |

- PNG, transparent background, uniform grid, **one row per animation**, frames left to right.
- **Draw the character facing right.** The renderer mirrors heroes, who stand on the right
  and face the boss; the boss stands on the left and draws unflipped. Author one direction
  only — a sheet drawn facing left will render facing away from its opponent.
- **Transparent background, and no grid lines.** The cell border belongs to the tool you
  author in, not to the exported PNG. A baked-in background fills every frame and leaves
  the renderer nothing to composite against.
- **Author at the target size.** A large illustration reduced to 32 × 40 becomes mud. This
  has been tried and measured; there is no automated route.
- **Under 64 colours**, ideally 16–32. Hard-edged pixels: no anti-aliasing, no gradients,
  no semi-transparent pixels. A 1-pixel dark outline.
- **Heroes face left, bosses face right.**
- Feet on the bottom edge of each cell; body centre fixed across frames so the figure
  does not appear to slide.
- **No slashes, flares, glows or particles in the character frames.** Effects are a
  separate layer (see §2).

**Animations**, one row each. Only `idle` is required; the rest can be added later.

| Row | Clip | Loops | Frames | Fitted to | Per frame at 4 |
| --- | --- | --- | --- | --- | --- |
| 0 | `idle` | yes | 2–4 | its own cadence | 320 ms |
| 1 | `attack` | no | 3–5 | a 320 ms beat | 80 ms |
| 2 | `cast` | no | 3–4 | a 560 ms beat | 187 ms |
| 3 | `hurt` | no | 2 | a 240 ms beat | 120 ms |
| 4 | `ko` | no | 3–4 | a 720 ms beat, holds last frame | 240 ms |
| 5 | `victory` | yes | 2–3 | its own cadence | 400 ms |
| 6 | `item` | no | 2–3 | a 320 ms beat | 107 ms |

Row order is whatever the manifest says; the numbers above match the twelve hero and eight
boss sheets that ship. `item` is the one row none of them has yet — it is new, and until it
is drawn an item use borrows the `cast` pose.

Non-looping clips are **stretched to span their beat**, so pick a frame count that reads
well and ignore timing entirely.

The "per frame" column assumes four frames. Because a clip is fitted to its beat, frame
count and frame rate are the same decision: eight frames across the same beat is half the
time per frame. `PACE` in `src/presentation.ts` is the global dial for this, currently 2
(half the originally tuned speed) — eight frames then land at 80ms each, which reads.
`?speed=2` on the game URL restores the faster pace for comparison without a rebuild.

**Music.** Four looping tracks as **OGG Vorbis** (`battle_main`, `battle_phase_two`,
`victory`, `defeat`), 44.1 kHz stereo. **MIDI cannot ship** — no browser can play a `.mid`
file — so compose in MIDI and render through a soundfont. Plus 17 short sound effects.

**Who to draw:** 12 heroes and 8 bosses, listed in §4.

---

The rest of this document is the detail behind the above. The engine side is already
built and tested — `src/animation.ts`, `src/stage.ts` and `src/audio.ts`.

---

## 1. MIDI will not play in a browser

**No modern browser can play a `.mid` file.** There is no built-in synthesiser;
`<audio src="theme.mid">` fails in Chrome, Safari and Firefox alike. MIDI is a fine
*authoring* format, but it cannot be the shipping format.

Two ways forward.

### Render to OGG offline — recommended

Compose in MIDI, render once through a soundfont, ship the audio file.

```bash
# Fluidsynth, with any General MIDI or SNES-style soundfont
fluidsynth -ni soundfont.sf2 battle_main.mid -F battle_main.wav -r 44100
ffmpeg -i battle_main.wav -c:a libvorbis -q:a 5 -ac 2 battle_main.ogg
```

- **Deterministic.** Every player hears what you heard. A JS synth does not guarantee that.
- **Small and instant.** A 1-minute loop at Vorbis q5 is roughly 700 KB–1 MB. No
  multi-megabyte soundfont download, no WASM synth on first load.
- **Keeps your workflow.** You still author in MIDI; rendering is one command, scriptable.

Choose the soundfont deliberately — it is most of the 16-bit character. A General MIDI
font sounds like a 1998 web page; an SNES-era or sampled-chip font sounds like the game
this is trying to be.

### Play MIDI in the browser — not recommended for v1

`js-synthesizer` (libfluidsynth compiled to WASM) or Tone.js with `@tonejs/midi` can play
MIDI live. It preserves MIDI end-to-end and allows runtime changes, but costs a WASM synth
plus a soundfont — commonly 2–30 MB — on first load, for a web game whose entire current
payload is well under 1 MB. Revisit only if live remixing becomes a feature.

### Format and looping

- **OGG Vorbis** (`.ogg`) is the shipping format. Broad support, and unlike MP3 it has no
  encoder padding, which is what causes an audible click at a loop point.
  - Provide **`.m4a`/AAC as a fallback** only if Safari support proves to need it; test
    before assuming.
- **Loop with Web Audio, not `<audio loop>`.** `AudioBufferSourceNode.loop = true` on a
  decoded buffer is sample-accurate. The `<audio>` element can gap between iterations.
- **An intro that plays once, then a loop**, is supported: set `loopStart` and `loopEnd`
  on the buffer source, in seconds. Render it as a single file with the intro at the
  front and tell us the loop point. Very much the SNES convention.
- 44.1 kHz, stereo. Normalise to about −14 LUFS and leave headroom; the game mixes SFX
  on top.

### Files needed

Four tracks.

| File | Use |
| --- | --- |
| `battle_main.ogg` | Phase one battle theme; loops |
| `battle_phase_two.ogg` | Phase two; loops, more urgent. **The music cuts to silence, a sting plays, then this starts** — see below |
| `victory.ogg` | Victory theme |
| `defeat.ogg` | Defeat theme |

The phase transition is the dramatic beat of the fight. The engine emits silence
140 ms before the sting, holds for 900 ms, then starts phase two. Compose
`battle_phase_two.ogg` to enter cold on a strong downbeat; it is never cross-faded.

### Sound effects

Files go in `web/public/battle-sounds/`, named exactly after the cue id, as `.ogg`.
Music goes in `web/public/battle-music/`.

17 cues. Short, dry, and mixed below the music —
hit sounds fire on a 90 ms beat, and a four-hit ability fires one per hit 120 ms apart, so
anything with a long tail will smear.

Highest value first: `hit_physical`, `hit_heavy`, `hit_magical`, `heal`, `ko`,
`phase_sting`, `victory_fanfare`, `defeat_sting`. The rest can land later.

---

## 2. Animated attacks — yes, and here is the format

Animation is driven by the battle choreography, so it is automatically in sync with damage
numbers, screen shake and health drain. There is no separate animation timeline to align.

### Animation set

Seven clips per combatant. One row of the sheet per clip, frames left to right.

| Clip | Loops | Plays when | Suggested frames |
| --- | --- | --- | --- |
| `idle` | yes | default; **required** | 2–4 |
| `attack` | no | a physical ability: a swing, a lunge, a steal | 3–5 |
| `cast` | no | a spell, cure, buff, debuff or dispel | 3–4 |
| `item` | no | using a potion or tonic | 2–3 |
| `hurt` | no | taking a hit | 2 |
| `ko` | no | collapsing; holds its last frame | 3–4 |
| `victory` | yes | surviving heroes, after a win | 2–3 |

Which clip plays is decided by the **ability's kind**, not by who is acting: a magus
swinging a staff plays `attack`, and a knight drinking a potion plays `item`. The mapping
is `CLIP_FOR_KIND` in `src/animation.ts`.

**`cast` means "effort that is not a strike", so draw it to suit the character.** It covers
spells, cures, buffs, debuffs and Defend. For a caster that is a spellcast; for the Brawler,
whose entire kit is physical and who only reaches this row through Defend, it is a bracing
guard with the forearms crossed. A bear throwing a fireball would have been the literal
reading of the row name and the wrong picture. Check the character's kit before briefing
this row — `node -e` over `heroAbilities` will tell you which kinds they can actually use.

Only `idle` is mandatory. A missing clip degrades along a chain rather than vanishing —
`item` falls back to `cast`, then `attack`, then `idle`, and `ko` falls back to `hurt` —
so an idle-only sheet works and clips can land one at a time without ever showing an actor
standing still mid-action.

### Non-looping clips are stretched to fit their beat

**You choose the frame count; the engine fits the clip to however long the beat runs.** An
attack animation therefore can never finish early or overrun the hit it belongs to. Draw
what reads well and ignore timing.

For reference, the beats a clip is fitted to:

| Clip | Beat | Duration |
| --- | --- | --- |
| `attack` | actor step | 320 ms |
| `cast` | cast wind-up | 560 ms |
| `hurt` | reaction | 240 ms |
| `ko` | collapse | 720 ms |

Looping clips use their own `frameMs` instead (default 180 ms), since nothing bounds them.

A 5-frame attack across 320 ms is 64 ms per frame; four frames is 80 ms each. These
values were set by watching the placeholder animations — at the original 180 ms the attack
was 45 ms per frame and read as a flicker. Every duration lives in `TIMING` in
`src/presentation.ts`, one constant per beat, and the whole game follows.

To dial the pace in the browser without a rebuild, append `?speed=0.75` (slower) or
`?speed=1.5` (faster) to the URL.

### Effects go in their own layer, not the character sheet

**Do not draw slashes, flares or impacts into the character's animation frames.** A
sweeping crescent slash is two or three times the width of a 32 × 40 cell, so baking it in
either clips it or forces an enormous frame in which the figure is a few pixels tall. It
also makes the frames impossible to separate — a first attempt at the Blademage sheet had
its last three attack poses merge into a single 1165px-wide blob of overlapping effects.

Instead, effects are separate sheets drawn over the stage, anchored on the **target**:

- The character sheet holds the *pose* only — wind-up, swing, recovery. Small and simple.
- The effect sheet holds the slash or flare. Bigger frames, no cell constraint.
- One `slash` serves every weapon user, so it is far less art for a better result.

This is also the SNES convention, and it is what `src/effects.ts` implements. Effects are
spawned by impact beats, so they land exactly with the hit, the damage number and the
shake.

| Effect | Frame | Use |
| --- | --- | --- |
| `slash` | 64 × 48 | Generic physical hit; every weapon user |
| `flare_neutral` | 64 × 64 | Non-elemental magical hit |
| `flare_fire` | 64 × 64 | Fire damage |
| `flare_ice` | 64 × 64 | Ice damage |
| `flare_lightning` | 64 × 64 | Lightning damage |
| `flare_holy` | 64 × 64 | Holy damage |
| `flare_dark` | 64 × 64 | Dark damage |

4–6 frames each, one row, left to right, with `anchorX`/`anchorY` marking the point that
lands on the target's feet — so a value near the frame height sits the effect on the ground
and about half centres it on the body. `slash` alone is enough to make every physical attack
in the game read.

The layer is wired up and declared in `web/src/effect-manifest.json`, including frame sizes
and counts. **Enabling one takes two steps:** put the PNG in `web/public/battle-effects/`,
then add its id to the manifest's `shipped` array. Until an id is listed the renderer never
asks for it, so an uncommissioned effect costs nothing and the hit flash and shake carry the
moment on their own.

`npm run effects:check` reports the status of all seven, fails if `shipped` and the
directory disagree either way, and measures declared frame counts against the real PNG
width — a count that does not divide the image blits a sliver of the neighbouring frame.

Set `behind: true` on a sheet to draw it under the actors instead of over them, which is
what a ground crack or an aura wants. Front effects draw over the actors but under the HUD,
so a flare can never hide a damage number.

### Value, not just hue

The stage backdrop is `#0b0d16` and its ground band `#1b2033` — luminance 13 and 32 on a
0-255 scale. A character has to sit clearly above that or it sinks into the floor, and at
roughly 30px tall the silhouette is most of what survives.

Measured median luminance of the sheets so far: Oracle 86, Brawler 88, Blademage 66,
Warden 38. The Warden is a black panther, and 33% of its pixels are darker than the ground
band it stands on, against 0-18% for the others. It reads, but only by its gold belt and
bracers.

So when briefing a dark character, ask for the value range explicitly: a lighter midtone
for the body, or a rim light along the back and shoulders to separate it from the
background. "Black panther" is a colour note; "a black panther lit from behind so its
outline stays visible on a near-black floor" is a drawing instruction.

### The route that worked

The Oracle sheet was produced by an image generator and packed mechanically, which is now a
repeatable path. The generator cannot be made to hit an exact canvas, align a grid, or keep
a limited palette — three attempts confirmed that — so do not ask it to. Ask it for the
thing it is good at and fix the geometry afterwards:

1. Prompt for a **large** sheet on a flat `#FF00FF` background. Not transparency: the two
   attempts that asked for it came back with the editor's checkerboard flattened into the
   pixels, and one was a JPEG renamed to `.png`, which cannot carry alpha at all. A solid
   key colour is the one thing a generator gets right every time.
2. Run `node tools/pack-spritesheet.mjs <sheet> --out <dest> --grid 8x7 --cell 48x40
   --colours 32`. It keys the background out, finds each figure as a connected component —
   so drifting frames do not matter and no grid is assumed — then scales everything by one
   shared factor and re-packs onto an exact grid with feet on a common baseline.
3. Lint it: `npm run art:lint -- <dest> --frame 48x40 --rows idle:8,attack:8,...`.

The packer refuses rather than guesses if the figure count is not rows × columns, because a
silent miscount would scramble the animations into each other. Two things it will fix on its
own first:

- **A thrust whose weapon tip touches the next frame** merges two figures into one
  component. It cuts at the narrowest column inside the component, which is the bridge, and
  only when a component is far wider than the median and the seam carries little ink — so a
  legitimately wide pose is never halved. Reported when it happens.
- **`--flip-x`** mirrors a sheet authored facing left. Generators get the facing wrong
  often enough to be worth a flag rather than another round of art; the Blademage arrived
  facing left while the Oracle and Brawler did not.

**Boss sheets take six rows, not seven, and a cell wider than it is tall.** Bosses never
reach `item` — they do not drink potions. And one shared scale means the *widest* pose sets
the size of every frame: Storm Keeper's trident thrust is 245px against a 162px idle, so a
square 96×96 cell rendered him at 62×62 and wasted a third of the space. At 112×96 the same
art lands at 73×78. Measure before choosing: 128×96 would have been better still, except
the boss lifts 6px during its own attack step, which put the trident behind the HP bar.

Known limits of this route: the generator bakes spell sparkles into the cast frames, which
the effects layer would otherwise draw itself, and it ignores "no effects in the frames"
when asked. Minor at 40px. More importantly the output is a *resample* of smooth art rather
than hand-placed pixels, so it reads well at 4x but will not hold up to close inspection the
way authored pixel art would.

### How to actually produce a sheet

Ranked by what gets a finished-looking game soonest.

**1. Licensed asset pack — best value by far.** itch.io sells complete pixel-art character
packs with full animation sets already built, typically $5–30 for dozens of characters.
Mana Seed by Seliel the Shaper, the Oryx sets and the various "tiny RPG character" packs
are all consistent, animated, and licensed for commercial game use. The 12 heroes here are
archetypes — knight, mage, healer, rogue — which maps onto a generic fantasy pack almost
directly. **Check the licence permits commercial use and redistribution inside a game**;
most do, some forbid reselling the art itself, which is not what we are doing.

**2. Commission one sheet, then match it.** $30–80 buys one hero sheet from a pixel artist
(itch.io community, Pixel Joint, r/gameDevClassifieds). Use it to fix the style, then
either commission the rest or draw to match. Fastest route to *good*, and this document is
self-contained enough to hand over as the brief.

**3. Draw it.** Aseprite ($20) is the standard; Piskel and LibreSprite are free. Put an
existing illustration on a reference layer, scale it down beside the canvas, and draw over
it at native size. Six frames of a 32 × 40 character is a couple of hours, and tracing
from a reference you already like is the quick version.

**What does not work:** a general-purpose image generator. They cannot hit exact pixel
dimensions, cannot hold a grid, and anti-alias everything. Pixel-art-specific tools
(PixelLab, Retro Diffusion, a local model with a pixel-art LoRA) target small canvases
natively and are worth a try; general ones are not.

### Author at the target resolution

A large illustration reduced to 32 × 40 does not become pixel art; it becomes mud. Set the
canvas to 32 × 40 and draw there, zoomed in. If a tool only produces large images, treat
its output as **concept art** — a reference for silhouette, palette and costume — and
redraw at native size.

`npm run art:lint -- <file> --frame 32x40 --rows idle:2,attack:4` reports this
mechanically. The colour count is the giveaway: hand-authored pixel art at this size uses
tens of colours; a downscaled illustration uses thousands.

`tools/fit-sprite-sheet.mjs` can mechanically convert a large multi-pose illustration into
a grid-aligned, palette-reduced sheet. **It was tried and the result is unusable**: a 15x
reduction plus a 16-colour palette eats every highlight and leaves a dark silhouette. The
tool remains useful for *measurement* — it is what established that the Blademage poses
need a 48-wide cell — but not for producing shippable art. There is no automated route
from illustration to pixel art.

### A weapon that reaches past the body needs a wider cell

Frame size is **per sheet**, declared in the manifest, so characters need not share one.
Measured on the Blademage poses, whose sword reaches about as far as the figure is tall:

| Frame | Result |
| --- | --- |
| 32 x 40 | limited by pose width; body reaches only 26 of 36px available |
| 40 x 40 | limited by pose width; body reaches 34 of 36px |
| **48 x 40** | limited by body height; **the figure fills the cell** |

So either draw the weapon tighter to the body and keep 32 x 40, or use 48 x 40 and let the
sword have room. The Blademage manifest entry is set to 48 x 40 for this reason.

### Sheet layout and sizing

The stage renders at a fixed internal **320 × 180**, scaled up by whole numbers only. So
sprites are small and every pixel counts.

| | Recommended frame | Notes |
| --- | --- | --- |
| Hero | **32 × 40** | Drawn around 28 × 36 today |
| Boss | **96 × 96** | Up to 112 × 112 for a large silhouette |

- One PNG per combatant, transparent background, no padding between frames.
- Frames are a uniform grid: `frameWidth × frameHeight`, row per clip.
- **Heroes face left, bosses face right.** The party stands right of centre, the boss left.
- Declare `anchorX` (the figure's horizontal centre) and `anchorY` (the soles of its feet)
  within a frame. The stage aligns actors on a ground line by anchor, so sheets of
  different heights sit correctly without per-sprite fudging.

### Manifest

One entry per combatant in `web/src/sprite-manifest.json`:

```json
{
  "warden": {
    "file": "heroes/warden.png",
    "frameWidth": 32, "frameHeight": 40,
    "anchorX": 16, "anchorY": 40,
    "clips": {
      "idle":    {"row": 0, "frames": 2, "loop": true, "frameMs": 200},
      "attack":  {"row": 1, "frames": 4, "loop": false},
      "cast":    {"row": 2, "frames": 3, "loop": false},
      "hurt":    {"row": 3, "frames": 2, "loop": false},
      "ko":      {"row": 4, "frames": 3, "loop": false},
      "victory": {"row": 5, "frames": 2, "loop": true, "frameMs": 250}
    }
  }
}
```

`validateSheet()` rejects a malformed entry at load with a specific message, rather than
drawing garbage. Run `npm run art:check` to see which sheets are present and valid.

---

## 3. Who to draw

All names and designs original. The description is what the character does in combat, as
a hook for the design.

### Heroes — 32 × 40 (48 × 40 where a weapon reaches past the body)

| Id | Name | Role | Combat identity |
| --- | --- | --- | --- |
| `warden` | The Warden | Guardian | Covers allies; emergency healing |
| `lancer` | The Lancer | Striker | Leaps airborne, lands a delayed blow |
| `oracle` | The Oracle | Healer | Healing, buffs, precision archery |
| `blademage` | The Blademage | Striker | Enchants the blade; rapid multi-hit volley |
| `channeler` | The Channeler | Caster | Surge-powered elemental magic |
| `nullifier` | The Nullifier | Controller | Intercepts and absorbs enemy spells |
| `monk` | The Monk | Striker | Martial, armour-piercing, holy strikes |
| `machinist` | The Machinist | Striker | Mechanical tools, drills through armour |
| `vanguard` | The Vanguard | Striker | Rising cut; a timed interrupt |
| `brawler` | The Brawler | Striker | Builds momentum, spends it on burst |
| `magus` | The Magus | Caster | Elemental attack magic, focused casting |
| `thief` | The Thief | Controller | Steals, then strikes harder for it |

### Bosses — 96 × 96

| Id | Name | Combat identity |
| --- | --- | --- |
| `tide_maw` | Tide Maw | Flooded-cavern horror; tentacles that weaken |
| `ink_lurker` | Ink Lurker | Tentacles, blinding ink, status timing |
| `crush_wall` | Crush Wall | An advancing wall; telegraphed crushes, a damage race |
| `storm_keeper` | Storm Keeper | Lightning magic; repairs itself; immune to fire |
| `spell_weaver` | Spell Weaver | Elemental magic; silences casters |
| `mad_harlequin` | The Mad Harlequin | Gleeful chaos; silence and delayed punishment |
| `clockwork_emperor` | The Clockwork Emperor | Armoured siege engine that self-repairs |
| `blade_tyrant` | The Blade Tyrant | Telegraphed blade storms; a guarded stance |

**Start with one complete encounter** — three heroes, one boss, one arena, one track and
the eight highest-value sound effects. One battle that looks and sounds finished is worth
far more than twenty idle-only sheets, and it reveals whether the frame sizes read at this
scale while that is still cheap to change.

## 4. Arenas

One background per boss. **16:9, 1280 × 720 or wider.** Scenery only — no HUD, no window
frames, no character art; the game draws those on top. **Keep the centre band quiet**: the
boss sprite sits there and must stay readable. Drawn with `object-fit: contain`, so nothing
is cropped on a phone.

| Boss | Arena | Style | Brief |
| --- | --- | --- | --- |
| Blade Tyrant | Broken Span | 16-bit pixel art | A narrow ruined bridge deck crossing the frame, open sky and a drop behind it. Centre band clear so the boss reads against empty space. |
| Tide Maw | Sunken Waterway | 16-bit pixel art | Flooded cavern. Standing water across the lower third, wet rock walls framing the sides. Cool blues and greens so tentacle silhouettes stay legible. |
| Ink Lurker | Drowned Theatre | 16-bit pixel art | Abandoned stage, house lights dimmed. Heavy drapes at the edges, seating lost to shadow. Warm highlight at centre stage, dark wings for the ambush. |
| Crush Wall | Sealed Corridor | 16-bit pixel art | Collapsing passage. Strong one-point perspective down a tunnel so the far wall feels like it is advancing. The wall itself is a separate sprite. |
| Storm Keeper | Stormworks | Painted backdrop | Lightning-struck pipe gallery on a mountainside. Industrial pipework and catwalks under a charged sky; cold rim light and arcing discharge. |
| Spell Weaver | Gate Platform | Painted backdrop | Rail platform at a border gate, at night. A waiting train and lamp-lit gatehouse beyond. Night palette with warm lamps so spell flashes pop. |

The four pixel-art arenas share one palette depth and one horizon height. The two painted
backdrops keep that camera height but are not pixelated. The Mad Harlequin and The
Clockwork Emperor have no arena brief yet; they can reuse another until one exists.
