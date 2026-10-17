# Art and audio specification

What to produce, in what format, so assets drop into the game without rework. The engine
side is already built and tested — see `src/animation.ts`, `src/stage.ts` and
`src/audio.ts`.

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

Four tracks. `npm run audio:manifest` prints this list from the code that plays them, so
it cannot drift.

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

17 cues, also listed by `npm run audio:manifest`. Short, dry, and mixed below the music —
hit sounds fire on a 90 ms beat, and a four-hit ability fires one per hit 120 ms apart, so
anything with a long tail will smear.

Highest value first: `hit_physical`, `hit_heavy`, `hit_magical`, `heal`, `ko`,
`phase_sting`, `victory_fanfare`, `defeat_sting`. The rest can land later.

---

## 2. Animated attacks — yes, and here is the format

Animation is driven by the battle choreography, so it is automatically in sync with damage
numbers, screen shake and health drain. There is no separate animation timeline to align.

### Animation set

Six clips per combatant. One row of the sheet per clip, frames left to right.

| Clip | Loops | Plays when | Suggested frames |
| --- | --- | --- | --- |
| `idle` | yes | default; **required** | 2–4 |
| `attack` | no | stepping in and striking | 3–5 |
| `cast` | no | channelled or magical wind-up | 3–4 |
| `hurt` | no | taking a hit | 2 |
| `ko` | no | collapsing; holds its last frame | 3–4 |
| `victory` | yes | surviving heroes, after a win | 2–3 |

Only `idle` is mandatory. A missing clip degrades to `idle` rather than drawing nothing,
so you can ship idle-only sheets and add clips incrementally.

### Non-looping clips are stretched to fit their beat

**You choose the frame count; the engine fits the clip to however long the beat runs.** An
attack animation therefore can never finish early or overrun the hit it belongs to. Draw
what reads well and ignore timing.

For reference, the beats a clip is fitted to:

| Clip | Beat | Duration |
| --- | --- | --- |
| `attack` | actor step | 180 ms |
| `cast` | cast wind-up | 420 ms |
| `hurt` | impact | 90 ms |
| `ko` | collapse | 520 ms |

Looping clips use their own `frameMs` instead (default 180 ms), since nothing bounds them.

A 5-frame attack across 180 ms is 36 ms per frame — fast. If an attack should read more
slowly, say so and `TIMING.actorStep` in `src/presentation.ts` can be raised; it is one
constant and the whole game follows.

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

4–6 frames each, one row, left to right, with `anchorX`/`anchorY` marking the effect's
visual centre. `slash` alone is enough to make every physical attack in the game read.

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

### Who to draw

8 bosses and 12 heroes. `npm run draft:check` lists the heroes; `npm run pool:check` the
bosses. All names and designs are original to this project — see the IP rule in the
technical plan: parody a trope, never a specific character.

Highest value first: the three heroes and one boss of a single day's encounter make one
complete-looking battle, which is worth far more than twenty idle-only sheets.

---

## 3. Arenas

Six backgrounds, one per boss, briefed in `web/public/battle-backgrounds/README.md` with
per-arena composition notes in `web/src/background-catalog.ts`. 16:9, 1280 × 720 or wider,
and **keep the centre band quiet** — the boss sprite sits there and must stay readable.
