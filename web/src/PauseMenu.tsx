/** The party menu, over a paused battle.
 *
 * Opened from the header, closed with Escape or Back. What it shows is reference-grade and
 * therefore legal in both modes: who is in the party, their standing HP and MP, their base
 * stats, what each of their abilities does, and what is in the bag. All of it is either
 * already on screen or already in the Codex.
 *
 * The one thing it gates is **status badges**, on `disclosure.statuses`. Normal withholds
 * those deliberately -- they carry durations and are what let a player plan -- and a menu is
 * exactly where someone would go looking for the list the stage refuses to draw. Leaking
 * them here would undo the mode rather than inconvenience it.
 *
 * It shows nothing at all about the boss. Its HP bar is on the stage, and anything more --
 * stats, affinities, its program -- is what `disclosure.affinities` exists to withhold and
 * what the bestiary makes you earn by fighting.
 *
 * ### On "pausing"
 *
 * There is no clock to stop. The engine is turn-based: `drive()` halts the instant a hero is
 * ready and consults no wall clock, so between turns nothing is advancing and opening a menu
 * changes nothing mechanically.
 *
 * Which is why the button is disabled *during* playback rather than pausing it. Sound cues
 * are scheduled ahead of time on the AudioContext against `context.currentTime`, so freezing
 * the visual clock would not stop them: hits would land audibly over a frozen picture. The
 * same reason you cannot open the party menu mid-attack in the games this imitates.
 */
import {useEffect, useRef} from 'react';
import {describeAbility} from '../../dist/src/ability-reference.js';
import {signatureAbilities} from '../../dist/src/draft.js';
import {STATUS_DISPLAY, visibleStatuses} from '../../dist/src/status-display.js';
import {hasPortrait, portraitUrl, PORTRAIT_SIZE} from './portrait-catalog.js';
import {handleMenuKey} from './menu-keys.js';
import type {ActorState, ItemId, StatusId} from '../../src/types.js';
import type {Disclosure} from '../../src/disclosure.js';

/** Items in the bag, in a fixed order so the panel does not reshuffle as they are spent. */
const ITEM_ORDER: ItemId[] = ['potion', 'mana_vial', 'revive_tonic'];
const ITEM_NAMES: Record<ItemId, string> = {
  potion: 'Potion',
  mana_vial: 'Mana Vial',
  revive_tonic: 'Revive Tonic',
};
const ITEM_NOTES: Record<ItemId, string> = {
  potion: 'Restores health to one ally.',
  mana_vial: 'Restores MP to one ally.',
  revive_tonic: 'Brings back a fallen ally.',
};

const STAT_ROWS = [
  {key: 'attack', label: 'ATK'},
  {key: 'magic', label: 'MAG'},
  {key: 'defense', label: 'DEF'},
  {key: 'resistance', label: 'RES'},
  {key: 'speed', label: 'SPD'},
] as const;

export type PauseMenuProps = {
  party: readonly string[];
  actors: Record<string, ActorState | undefined>;
  names: Record<string, string>;
  /** Base stats, for the ceiling each bar is drawn against. */
  maxHp: Record<string, number>;
  inventory: Record<string, number>;
  /** Which hero ids the player has fielded, for the roles the Codex also gates. */
  disclosure: Disclosure;
  onClose: () => void;
};

function HeroPanel({id, actor, name, maxHpValue, disclosure}: {
  id: string;
  actor: ActorState;
  name: string;
  maxHpValue: number;
  disclosure: Disclosure;
}) {
  const abilities = signatureAbilities.filter(a => a.owner === id);
  const statuses = disclosure.statuses
    ? visibleStatuses(Object.keys(actor.statuses ?? {}) as StatusId[])
    : [];
  const down = actor.hp <= 0;
  return (
    <article className={`dbb-pause-hero rpg-window${down ? ' is-down' : ''}`}>
      <div className="dbb-pause-hero-head">
        {hasPortrait(id) && (
          <img className="dbb-pause-portrait" src={portraitUrl(id)} alt=""
            width={PORTRAIT_SIZE} height={PORTRAIT_SIZE} />
        )}
        <div className="dbb-pause-vitals">
          <h3>{name}</h3>
          {/* The same numbers the party rail shows, so the menu is a bigger view of the
            * battle rather than a second source of truth that could disagree with it. */}
          <p className="dbb-pause-bar-row">
            <span className="dbb-pause-bar-label">HP</span>
            <span className="dbb-pause-bar">
              <span className="dbb-pause-bar-fill is-hp"
                style={{width: `${Math.max(0, Math.min(100, (actor.hp / maxHpValue) * 100))}%`}} />
            </span>
            <b>{actor.hp}/{maxHpValue}</b>
          </p>
          <p className="dbb-pause-bar-row">
            <span className="dbb-pause-bar-label">MP</span>
            <span className="dbb-pause-bar">
              <span className="dbb-pause-bar-fill is-mp"
                style={{width: `${actor.stats.mp ? Math.max(0, Math.min(100, (actor.mp / actor.stats.mp) * 100)) : 0}%`}} />
            </span>
            <b>{actor.mp}/{actor.stats.mp}</b>
          </p>
          {down && <p className="dbb-pause-down">Down</p>}
        </div>
      </div>

      {/* Only in Easy. Normal withholds the badges on purpose -- they carry durations and
        * are what let a player plan -- and a menu is exactly where someone would come
        * looking for the list the stage refuses to draw. */}
      {disclosure.statuses && statuses.length > 0 && (
        <p className="dbb-pause-statuses">
          {statuses.map(status => (
            <span className="dbb-pause-status" key={status}
              title={STATUS_DISPLAY[status].hint}>{STATUS_DISPLAY[status].label}</span>
          ))}
        </p>
      )}

      <dl className="dbb-pause-stats">
        {STAT_ROWS.map(row => (
          <div className="dbb-pause-stat" key={row.key}>
            <dt>{row.label}</dt>
            <dd>{actor.stats[row.key]}</dd>
          </div>
        ))}
      </dl>

      <section className="dbb-pause-moves">
        <h4>Abilities</h4>
        {abilities.length === 0
          ? <p className="dbb-pause-none">Attack, Guard and items only</p>
          : <dl>
              {abilities.map(ability => {
                const {facts, note} = describeAbility(ability);
                return (
                  <div className="dbb-pause-move" key={ability.id}>
                    <dt>{ability.name}</dt>
                    <dd>
                      <span>{facts.join(' · ')}</span>
                      {note && <span className="dbb-pause-move-note">{note}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>}
      </section>
    </article>
  );
}

export function PauseMenu({party, actors, names, maxHp, inventory, disclosure, onClose}: PauseMenuProps) {
  const rootRef = useRef<HTMLElement | null>(null);

  /** The latest `onClose`, so the key handler below never goes stale.
   *
   * The same guard the matchup screen needed: `DailyBattle` re-renders twenty times a second
   * while the idle clock runs, and a callback captured once would be a closure over a dead
   * render. Here the consequence would be a menu that cannot be closed -- which, over a
   * battle that cannot be advanced behind it, is a soft lock. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // Focus the panel on open so Escape and the arrow keys reach it without a click first,
    // and so a screen reader is moved into the menu rather than left behind on the battle.
    rootRef.current?.focus?.();
  }, []);

  const items = ITEM_ORDER.filter(id => (inventory[id] ?? 0) > 0);

  return (
    <div className="dbb-pause-backdrop" role="presentation">
      <section
        className="dbb-pause rpg-window"
        role="dialog"
        aria-modal="true"
        aria-label="Party menu"
        tabIndex={-1}
        ref={rootRef}
        onKeyDown={event => {
          if (handleMenuKey(event, rootRef.current, {onBack: () => close.current?.()})) {
            event.preventDefault();
          }
        }}
      >
        <header className="dbb-pause-head">
          <h2>Party</h2>
          <button type="button" className="rpg-menu-back" data-menu-item=""
            onClick={() => close.current?.()}>Close</button>
        </header>

        <div className="dbb-pause-party">
          {party.map(id => {
            const actor = actors[id];
            if (!actor) return null;
            return (
              <HeroPanel key={id} id={id} actor={actor} name={names[id] ?? id}
                maxHpValue={maxHp[id] ?? actor.stats.hp} disclosure={disclosure} />
            );
          })}
        </div>

        <section className="dbb-pause-items rpg-window">
          <h3>Items</h3>
          {items.length === 0
            // An empty bag is a fact worth stating: the alternative reads as a broken panel.
            ? <p className="dbb-pause-none">Nothing left.</p>
            : <dl>
                {items.map(id => (
                  <div className="dbb-pause-item" key={id}>
                    <dt>{ITEM_NAMES[id]} <b>x{inventory[id]}</b></dt>
                    <dd>{ITEM_NOTES[id]}</dd>
                  </div>
                ))}
              </dl>}
          <p className="dbb-pause-hint">
            The bag is shared by the whole party and does not refill between turns.
          </p>
        </section>
      </section>
    </div>
  );
}
