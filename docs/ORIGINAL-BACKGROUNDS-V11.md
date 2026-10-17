# Battle Backgrounds — Asset Integration v1.1

## Scope

The artwork *integration layer* is implemented. **No background images ship with the
repository.** All six arenas are original art still to be produced; `npm run art:check`
reports every slot as missing until they are added, which is the expected state.

Backgrounds load from two sources:

1. **Bundled project PNGs:** add appropriately named images to
   `web/public/battle-backgrounds/`; Vite includes them in builds and they work with no
   network connectivity.
2. **Browser-local imports:** use `ADD BACKGROUND ART` inside an encounter. Load your own
   image or art sheet, select `Crop from sheet` if needed, drag a rectangle, then click
   `SAVE IN BROWSER`. This stores the PNG in IndexedDB under that boss ID, replacing the
   placeholder battlefield. It persists across battle restarts and does not affect local
   daily stats.

`EXPORT PNG FOR BUILD` downloads the cropped PNG under its expected filename. Copy it to
`web/public/battle-backgrounds/` to ship it with a build; IndexedDB content is *not*
distributed automatically.

**Precedence:** IndexedDB import > bundled PNG > explicit placeholder scene. No network
hotlinks at runtime. All three Blade Tyrant rulesets share the Broken Span arena. Pixel-art
arenas keep nearest-neighbour scaling; painted backdrops render without pixel-scale
filtering. Backgrounds display with `object-fit: contain` so nothing is cropped.

## Encounter-to-arena map

| Encounter | Arena | Style |
|---|---|---|
| Blade Tyrant (v0.6, v0.7, v0.8) | Broken Span — ruined bridge over a chasm | 16-bit pixel art |
| Tide Maw | Sunken Waterway — flooded cavern and lake | 16-bit pixel art |
| Ink Lurker | Drowned Theatre — abandoned stage | 16-bit pixel art |
| Crush Wall | Sealed Corridor — collapsing passage | 16-bit pixel art |
| Storm Keeper | Stormworks — lightning-struck pipe gallery | Painted backdrop |
| Spell Weaver | Gate Platform — rail platform at night | Painted backdrop |

Per-arena art direction, including composition notes, lives in
`web/src/background-catalog.ts`.

## Asset policy

Every background must be original work — commissioned, licensed for this use, or produced
in-house. Art extracted, captured, or traced from another company's game must not enter
this repository or a build, in whole or as a crop. Keep a provenance and licence record for
each file that ships.

## Setup

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
npm install
npm test
npm run art:check
npm run web:build
npm run web:dev
```

## Verification

- 78 combat regression tests and the golden replay are unchanged by the art layer.
- Web TypeScript compiles without errors.
- Crop workflow handles source images up to 25MB and exports PNG.
- Local images persist in IndexedDB, falling back to bundled images or a clearly
  indicated placeholder when absent.

## Final-art quality criteria

- Scenery only: **no baked-in command windows, hero sprites, or boss sprite.**
- 16:9, 1280 × 720 or wider; centre band kept visually quiet for the boss sprite.
- Pixel-art arenas: integer-scaled, no filtering, consistent palette depth across the six.
- Painted backdrops: consistent camera height and horizon with the pixel-art set.
- Legible on a 5-inch phone screen at full brightness and at 50% brightness.
