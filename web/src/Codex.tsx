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
import {useRef, useState} from 'react';
import {heroIds, heroes} from '../../dist/src/roster.js';
import {HERO_LORE, CAPABILITY_LABEL, capabilityLabels} from '../../dist/src/lore.js';
import {heroCapabilities, signatureAbilities} from '../../dist/src/draft.js';
import {describeAbility} from '../../dist/src/ability-reference.js';
import {universalAbilities} from './ability-reference-shared.js';
import type {HeroId} from '../../src/roster.js';
import type {Capability} from '../../src/draft.js';
import {PORTRAIT_SIZE, hasPortrait, portraitUrl} from './portrait-catalog.js';
import {spriteSheet} from './sprite-catalog.js';
import {mediaUrl} from './media-url.js';
import {handleMenuKey} from './menu-keys.js';
import {bossProfiles} from '../../dist/src/encounters.js';
import {bossIds} from '../../dist/src/generate.js';
import {emptyDiscovery, isDiscovered} from '../../dist/src/bestiary.js';
import {battleBackgrounds} from './background-catalog.js';
import type {Bestiary, BossDiscovery} from '../../src/bestiary.js';

/** Boss and ability display names, from the content rather than written out again. */
const BOSS_NAMES: Record<string, string> =
  Object.fromEntries(bossProfiles.map(b => [b.id, b.name]));
const BOSS_ABILITY_NAMES: Record<string, string> = Object.fromEntries(
  bossProfiles.flatMap(b => Object.values(b.abilities ?? {}).map((a: any) => [a.id, a.name])));

/** Abilities belonging to one hero, by name.
 *
 * From `signatureAbilities`, not `heroAbilities`. The latter holds only the v0.9 roster, so
 * the three original heroes -- Warden, Brawler, Magus -- appeared to have no abilities at
 * all and the card claimed "basics only" for a Warden that has Cover, Cure and Protect.
 * `signatureAbilities` merges the roster with the reference encounter, which is the same
 * union `draft.ts` derives capabilities from, so the ability list and the tags above it
 * can no longer disagree. */
const abilitiesOf = (id: HeroId) => signatureAbilities.filter(a => a.owner === id);

const capsOf = (id: HeroId): Capability[] => (heroCapabilities[id] ?? []) as Capability[];

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
          {/* Capability tags rather than the role. Six of twelve heroes read "Striker",
            * which separates nobody; these are derived from ability data and say something
            * a player can act on. `title` carries the explanation without spending card
            * space on it. */}
          <p className="dbb-codex-tags">
            {capsOf(id).length === 0
              ? <span className="dbb-codex-tag">Basics only</span>
              : capabilityLabels(capsOf(id)).map(label => {
                  const cap = (Object.keys(CAPABILITY_LABEL) as Capability[])
                    .find(c => CAPABILITY_LABEL[c].label === label)!;
                  return (
                    <span className="dbb-codex-tag" key={label}
                      title={CAPABILITY_LABEL[cap].hint}>{label}</span>
                  );
                })}
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

      {/* What each ability *does*, not just its name.
        * `play-ui.ts` already describes abilities well, but those lines live in the action
        * preview, which Normal turns off -- so a Normal player could never learn what
        * Tri-Bolt or Nullify does, in a battle or out of one. These are derived from the
        * ability record, so a tuned power value cannot leave the text behind. */}
      <section className="dbb-codex-skills">
        <h3>Abilities</h3>
        {abilities.length === 0
          // Basics only is a real answer, not a missing one -- see `abilitiesOf`.
          ? <p className="dbb-codex-skill-none">Attack, Guard and items only</p>
          : <dl className="dbb-codex-skill-list">
              {abilities.map(ability => {
                const {facts, note} = describeAbility(ability);
                return (
                  <div className="dbb-codex-skill" key={ability.id}>
                    <dt>{ability.name}</dt>
                    <dd>
                      <span className="dbb-codex-skill-facts">{facts.join(' · ')}</span>
                      {note && <span className="dbb-codex-skill-note">{note}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>}
      </section>
    </article>
  );
}

/** One boss entry: what the player has earned the right to see.
 *
 * Everything here comes from the player's own record, never from the encounter definition.
 * An affinity appears because they watched a number come back wrong, not because the game
 * looked it up -- which is what lets the bestiary exist in Normal at all. */
function BossCard({id, discovery}: {id: string; discovery: BossDiscovery}) {
  const sheet = spriteSheet('bosses', id);
  const known = isDiscovered(discovery);
  const arena = battleBackgrounds[id as keyof typeof battleBackgrounds];
  const readings = Object.entries(discovery.affinities) as [string, string][];
  return (
    <article className={`dbb-codex-card dbb-codex-boss rpg-window${known ? '' : ' is-unknown'}`}>
      <div className="dbb-codex-head">
        {/* The same art either way: an undiscovered boss is its own silhouette, which costs
          * no second image and reads as "something is there" rather than as a gap. */}
        <div className={`dbb-codex-face${known ? '' : ' is-silhouette'}`}
          aria-hidden="true"
          style={sheet ? {
            backgroundImage: `url(${mediaUrl('battle-sprites', sheet.file)})`,
            backgroundSize: `auto ${sheet.frameHeight * 8}px`,
            backgroundPosition: 'left top',
            backgroundRepeat: 'no-repeat',
            width: '64px', height: '64px',
          } : {}} />
        <div className="dbb-codex-title">
          <h2>{known ? (BOSS_NAMES[id] ?? id) : '???'}</h2>
          <p className="dbb-codex-tags">
            {known
              ? <>
                  <span className="dbb-codex-tag">{discovery.encounters} fought</span>
                  <span className="dbb-codex-tag">{discovery.victories} beaten</span>
                  {discovery.phaseTwoSeen && <span className="dbb-codex-tag">second form seen</span>}
                </>
              : <span className="dbb-codex-tag">Not yet encountered</span>}
          </p>
        </div>
      </div>

      {!known
        ? <p className="dbb-codex-bio">Fight this boss to begin its entry.</p>
        : <>
            {arena && <p className="dbb-codex-bio">Arena: {arena.scene}.</p>}
            <section className="dbb-codex-skills">
              <h3>What you have learned</h3>
              {readings.length === 0
                ? <p className="dbb-codex-skill-none">
                    No elements tried yet — hit it with one to find out.
                  </p>
                : <p className="dbb-codex-tags">
                    {readings.map(([element, reading]) => (
                      <span className={`dbb-codex-tag is-${reading}`} key={element}>
                        {element}: {reading}
                      </span>
                    ))}
                  </p>}
            </section>
            <section className="dbb-codex-skills">
              <h3>Attacks you have seen</h3>
              {discovery.abilities.length === 0
                ? <p className="dbb-codex-skill-none">None yet.</p>
                : <p className="dbb-codex-skill-facts">
                    {discovery.abilities.map(a => BOSS_ABILITY_NAMES[a] ?? a).join(' · ')}
                  </p>}
            </section>
          </>}
    </article>
  );
}

export function Codex({onClose, bestiary}: {onClose: () => void; bestiary: Bestiary}) {
  /** Heroes or bosses. Two different questions -- "who can I field" and "what am I
   * fighting" -- so they are tabs rather than one long scroll. */
  const [tab, setTab] = useState<'heroes' | 'bosses'>('heroes');
  /** Filtering by capability rather than role, for the reason the tags replaced it: a
   * "Striker" filter would return half the roster, where "Pierces armour" returns the two
   * heroes who answer an armoured boss. Each option also carries the count, so an empty
   * result is never a surprise. */
  const [filter, setFilter] = useState<Capability | 'All'>('All');
  const options = (Object.keys(CAPABILITY_LABEL) as Capability[]);
  const countFor = (c: Capability) =>
    (heroIds as readonly HeroId[]).filter(id => capsOf(id).includes(c)).length;
  const shown = (heroIds as readonly HeroId[])
    .filter(id => filter === 'All' || capsOf(id).includes(filter));
  const filterRef = useRef<HTMLElement | null>(null);

  return (
    // Escape closes the Codex from anywhere inside it, which is what a reader reaches for
    // after scrolling to the bottom of twelve cards.
    <main
      className="dbb-shell dbb-shell-codex"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          onClose();
          event.preventDefault();
        }
      }}
    >
      <header className="dbb-header">
        <span className="dbb-brand">✦ CODEX</span>
        <button type="button" className="rpg-menu-back" onClick={onClose}>Back</button>
      </header>

      <nav className="dbb-codex-filter" aria-label="Section">
        <button type="button" className={tab === 'heroes' ? 'is-active' : ''}
          onClick={() => setTab('heroes')}>Heroes {heroIds.length}</button>
        <button type="button" className={tab === 'bosses' ? 'is-active' : ''}
          onClick={() => setTab('bosses')}>
          Bosses {bossIds.filter((id: string) => isDiscovered(bestiary[id])).length}/{bossIds.length}
        </button>
      </nav>

      {/* Horizontal, so Left and Right move along the filters as well as Up and Down. */}
      {tab === 'heroes' && (
        <nav
          className="dbb-codex-filter"
          aria-label="Filter by capability"
          ref={filterRef}
          onKeyDown={event => {
            if (handleMenuKey(event, filterRef.current, {horizontal: true})) event.preventDefault();
          }}
        >
          <button type="button" data-menu-item="" className={filter === 'All' ? 'is-active' : ''}
            onClick={() => setFilter('All')}>All {heroIds.length}</button>
          {options.map(c => (
            <button type="button" key={c} data-menu-item="" className={c === filter ? 'is-active' : ''}
              title={CAPABILITY_LABEL[c].hint}
              onClick={() => setFilter(c)}>{CAPABILITY_LABEL[c].label} {countFor(c)}</button>
          ))}
        </nav>
      )}

      {/* Shown only on the unfiltered view: it belongs to the roster as a whole, and
        * repeating it above a filtered list of two heroes would read as a result. */}
      {tab === 'heroes' && filter === 'All' && (
        <section className="dbb-codex-card dbb-codex-shared rpg-window">
          <h2>Every hero can</h2>
          <dl className="dbb-codex-skill-list">
            {universalAbilities.map(ability => {
              const {facts, note} = describeAbility(ability);
              return (
                <div className="dbb-codex-skill" key={ability.id}>
                  <dt>{ability.name}</dt>
                  <dd>
                    <span className="dbb-codex-skill-facts">{facts.join(' · ')}</span>
                    {note && <span className="dbb-codex-skill-note">{note}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      <div className="dbb-codex-list">
        {tab === 'heroes'
          ? shown.map(id => <Card key={id} id={id} />)
          : bossIds.map((id: string) => (
              <BossCard key={id} id={id} discovery={bestiary[id] ?? emptyDiscovery()} />
            ))}
      </div>
    </main>
  );
}
