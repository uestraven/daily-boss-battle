/** The Codex: twelve hero cards, so the roster is discoverable outside a battle.
 *
 * Static content only. Base stats and ability names are manual-grade reference -- identical
 * on every day, for every party, in every mode -- so this is not a `disclosure.ts` channel
 * and needs no field there. See the header of `src/lore.ts` for where that line sits: the
 * thing it must not show is anything derived from the live fight, which is the action
 * preview's job and is withheld in Normal.
 *
 * Each card prefers a drawn portrait and falls back to the hero's battle sprite, which is a
 * real likeness and is already in the image cache, so the screen is complete before any
 * portrait exists.
 */
import {useState} from 'react';
import {heroIds, heroAbilities, heroes} from '../../dist/src/roster.js';
import {HERO_LORE} from '../../dist/src/lore.js';
import type {HeroId} from '../../src/roster.js';
import {PORTRAIT_SIZE, hasPortrait, portraitUrl} from './portrait-catalog.js';
import {spriteSheet} from './sprite-catalog.js';
import {mediaUrl} from './media-url.js';

/** Abilities belonging to one hero, by name.
 *
 * The three original heroes -- Warden, Brawler, Magus -- carry no entries in
 * `heroAbilities`; theirs live in the shared reference set, because they predate it. So an
 * empty list here is normal and must read as "basics only" rather than as a gap. */
const abilitiesOf = (id: HeroId): string[] =>
  heroAbilities.filter(a => a.owner === id).map(a => a.name);

const STAT_BARS = [
  {key: 'hp', label: 'HP', max: 400},
  {key: 'attack', label: 'ATK', max: 100},
  {key: 'magic', label: 'MAG', max: 110},
  {key: 'defense', label: 'DEF', max: 90},
  {key: 'speed', label: 'SPD', max: 130},
] as const;

/** Sprite fallback for a hero with no portrait yet.
 *
 * Shows the idle frame by cropping the sheet with CSS rather than drawing to a canvas: the
 * Codex is a document, not a stage, and a background-position crop needs no clock, no
 * repaint and no second copy of the animation logic. */
function SpriteFace({id}: {id: HeroId}) {
  const sheet = spriteSheet('heroes', id);
  if (!sheet) return <div className="dbb-codex-face is-empty" aria-hidden="true" />;
  const {frameWidth, frameHeight, file} = sheet;
  // Whole-number scale only, so the pixels stay square.
  const scale = Math.max(1, Math.floor(PORTRAIT_SIZE / Math.max(frameWidth, frameHeight)));
  const rows = Math.max(...Object.values(sheet.clips).map(c => (c?.row ?? 0) + 1), 1);
  return (
    <div
      className="dbb-codex-face"
      aria-hidden="true"
      style={{
        backgroundImage: `url(${mediaUrl('battle-sprites', file)})`,
        // Scaling the whole sheet and showing the top-left cell crops to the idle frame:
        // `background-size` has to describe the *sheet*, not the frame, or the crop lands
        // mid-pose. Rows come from the manifest rather than the 8-row convention, so a
        // sheet that ever gains a row does not silently shift every face.
        backgroundSize: `auto ${frameHeight * scale * rows}px`,
        backgroundPosition: 'left top',
        backgroundRepeat: 'no-repeat',
        width: `${frameWidth * scale}px`,
        height: `${frameHeight * scale}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

function Card({id}: {id: HeroId}) {
  const hero = heroes.find(h => h.id === id);
  if (!hero) return null;
  const lore = HERO_LORE[id];
  const abilities = abilitiesOf(id);
  return (
    <article className="dbb-codex-card rpg-window">
      <div className="dbb-codex-head">
        {hasPortrait(id)
          ? <img className="dbb-codex-portrait" src={portraitUrl(id)} alt={hero.name}
              width={PORTRAIT_SIZE} height={PORTRAIT_SIZE} />
          : <SpriteFace id={id} />}
        <div className="dbb-codex-title">
          <h2>{hero.name}</h2>
          <p className="dbb-codex-role">
            {hero.role}{hero.secondary ? ` · ${hero.secondary}` : ''}
          </p>
        </div>
      </div>

      <p className="dbb-codex-bio">{lore?.biography}</p>

      <dl className="dbb-codex-stats">
        {STAT_BARS.map(bar => {
          const value = hero.stats[bar.key];
          return (
            <div className="dbb-codex-stat" key={bar.key}>
              <dt>{bar.label}</dt>
              <dd>
                <span className="dbb-codex-bar">
                  <span className="dbb-codex-bar-fill"
                    style={{width: `${Math.min(100, Math.round((value / bar.max) * 100))}%`}} />
                </span>
                <b>{value}</b>
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="dbb-codex-skills">
        <span>Abilities</span>
        {/* Basics only is a real answer, not a missing one -- see `abilitiesOf`. */}
        {abilities.length ? abilities.join(' · ') : 'Attack, Guard and items only'}
      </p>
    </article>
  );
}

export function Codex({onClose}: {onClose: () => void}) {
  const [role, setRole] = useState<string>('All');
  const roles = ['All', ...new Set(heroes.map(h => h.role))];
  const shown = (heroIds as readonly HeroId[])
    .filter(id => role === 'All' || heroes.find(h => h.id === id)?.role === role);

  return (
    <main className="dbb-shell dbb-shell-codex">
      <header className="dbb-header">
        <span className="dbb-brand">✦ CODEX</span>
        <button type="button" className="rpg-menu-back" onClick={onClose}>Back</button>
      </header>

      <nav className="dbb-codex-filter" aria-label="Filter by role">
        {roles.map(r => (
          <button type="button" key={r} className={r === role ? 'is-active' : ''}
            onClick={() => setRole(r)}>{r}</button>
        ))}
      </nav>

      <div className="dbb-codex-list">
        {shown.map(id => <Card key={id} id={id} />)}
      </div>
    </main>
  );
}
