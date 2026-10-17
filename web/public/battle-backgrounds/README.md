# Battle backgrounds

Original artwork only. Nothing in this directory may be extracted, captured, or traced
from another company's game.

Place one PNG per boss, using these exact filenames:

| File | Arena | Style |
| --- | --- | --- |
| `blade_tyrant.png` | Broken Span — ruined bridge over a chasm | 16-bit pixel art |
| `tide_maw.png` | Sunken Waterway — flooded cavern | 16-bit pixel art |
| `ink_lurker.png` | Drowned Theatre — abandoned stage | 16-bit pixel art |
| `crush_wall.png` | Sealed Corridor — collapsing passage | 16-bit pixel art |
| `storm_keeper.png` | Stormworks — lightning-struck pipe gallery | Painted backdrop |
| `spell_weaver.png` | Gate Platform — rail platform at night | Painted backdrop |

Per-arena art direction lives in `web/src/background-catalog.ts`. The game UI draws the
boss, party, and menu layers on top, so a background should contain scenery only — no
HUD, no window frames, no character art.

Target 1280 × 720 or wider at a 16:9 ratio. Backgrounds are drawn with
`object-fit: contain`, so nothing is cropped on phone screens. Keep the centre band
visually quiet: the boss sprite sits there and needs to stay readable.

Two ways to get a file here:

- Export from the app: `ADD BACKGROUND ART` → import your own image → crop →
  `EXPORT PNG FOR BUILD`, then move the file into this folder.
- Drop a finished PNG in directly.

Run `npm run art:check` to confirm what is installed. Vite bundles everything under
`web/public/` automatically, including offline builds.
