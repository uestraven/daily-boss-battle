/** Art-direction brief and expected image filenames for the encounter arenas, one per
 * boss. `npm run art:check` fails if a boss has no arena, which is how the Mad Harlequin
 * and the Clockwork Emperor were found silently falling back to the Broken Span.
 * Every background is original artwork commissioned or produced for Daily Boss Battle.
 * This module carries no third-party provenance and links to no external asset source:
 * drop an original PNG at the listed filename, or import one through Background Studio.
 */
export const battleBackgrounds = {
  blade_tyrant: {
    scene:'Broken Span', style:'16-bit pixel art', place:'Ruined stone bridge over an open chasm',
    file:'blade_tyrant.png', imageRendering:'pixelated' as const,
    hint:'A narrow bridge deck crossing the frame, open sky and drop behind it. Keep the centre band clear so the boss sprite reads against empty space.',
  },
  tide_maw: {
    scene:'Sunken Waterway', style:'16-bit pixel art', place:'Flooded cavern with a subterranean lake',
    file:'tide_maw.png', imageRendering:'pixelated' as const,
    hint:'Standing water across the lower third, wet rock walls framing the sides. Cool blues and greens so the tentacle silhouettes stay legible.',
  },
  ink_lurker: {
    scene:'Drowned Theatre', style:'16-bit pixel art', place:'Abandoned stage, house lights dimmed',
    file:'ink_lurker.png', imageRendering:'pixelated' as const,
    hint:'A raised stage with heavy drapes at the edges and seating lost to shadow. Warm highlight at centre stage, dark wings for the ambush.',
  },
  crush_wall: {
    scene:'Sealed Corridor', style:'16-bit pixel art', place:'Collapsing passage with a closing far wall',
    file:'crush_wall.png', imageRendering:'pixelated' as const,
    hint:'Strong one-point perspective down a tunnel so the far wall feels like it is advancing. The boss itself is a separate sprite layer.',
  },
  storm_keeper: {
    scene:'Stormworks', style:'Painted backdrop', place:'Lightning-struck pipe gallery on a mountainside',
    file:'storm_keeper.png', imageRendering:'auto' as const,
    hint:'Industrial pipework and catwalks under a charged sky. Cold rim light and arcing discharge to telegraph the lightning phase.',
  },
  spell_weaver: {
    scene:'Gate Platform', style:'Painted backdrop', place:'Rail platform at a border gate, night',
    file:'spell_weaver.png', imageRendering:'auto' as const,
    hint:'A long platform with a waiting train and lamp-lit gatehouse beyond. Night palette with warm lamps so elemental spell flashes pop.',
  },
  mad_harlequin: {
    scene:'Carnival Row', style:'16-bit pixel art', place:'Shuttered fairground after closing',
    file:'mad_harlequin.png', imageRendering:'pixelated' as const,
    hint:'Striped tent canvas and dead bulb strings against a dark sky, streamers caught mid-fall. Garish colour pushed to the edges so the centre stays quiet: this fight is about delayed punishment, and the telegraph text must stay readable over it.',
  },
  clockwork_emperor: {
    scene:'Gear Vault', style:'Painted backdrop', place:'Machine hall of meshing gears and pressure lines',
    file:'clockwork_emperor.png', imageRendering:'auto' as const,
    hint:'Vast brass gearwork receding behind a riveted floor plate, steam bleeding from joints. Warm metal against deep shadow, with the largest gear off-centre so the boss silhouette is not lost against it.',
  },
} as const;
export type BackgroundId = keyof typeof battleBackgrounds;
export const backgroundIds = Object.keys(battleBackgrounds) as BackgroundId[];
export const backgroundForBoss = (bossId:string):BackgroundId => {
  if (bossId in battleBackgrounds) return bossId as BackgroundId;
  return 'blade_tyrant'; // all three historical Blade Tyrant rulesets share the same arena
};
export const bundledBackgroundUrl = (id:BackgroundId,base:string) => `${base}battle-backgrounds/${battleBackgrounds[id].file}`;

/** Arenas whose PNG is actually in `web/public/battle-backgrounds/`.
 *
 * Only these are offered to the stage, so an uncommissioned arena costs no failed request
 * and leaves the flat backdrop in place rather than flashing an empty frame. Drop the art
 * in, add the id here, and run `npm run art:check` -- it fails when this list and the
 * directory disagree, so it cannot drift. Same arrangement as effect art. */
export const shippedBackgrounds: readonly BackgroundId[] = ['blade_tyrant','clockwork_emperor','storm_keeper','tide_maw'];

export const hasBackgroundArt = (id:BackgroundId):boolean => shippedBackgrounds.includes(id);
