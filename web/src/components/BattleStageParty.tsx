import type {ActorId, BattleEvent, BattleState, EncounterDefinition} from '../../../src/types.js';

type Props = {
  state: BattleState;
  def: EncounterDefinition;
  selectedHeroId: ActorId;
  readyHeroIds: ActorId[];
  onChooseHero: (id: ActorId) => void;
  /** Optional paths to approved sprite artwork (not provided by this update). */
  spriteUrls?: Partial<Record<ActorId, string>>;
  /** Only effects produced by the most recent battle step; display only. */
  recentEvents?: BattleEvent[];
};

function Figure({name, url}: {name: string; url?: string}) {
  if (url) {
    return <img className="retro-stage-sprite" src={url} alt="" draggable={false}/>;
  }
  // Neutral original placeholder, NOT a ripped Boss Battle character sprite.
  return <svg className="retro-stage-fallback" viewBox="0 0 36 50" role="presentation" aria-hidden="true" shapeRendering="crispEdges">
    <path d="M13 3h10v5h3v9h-3v4H13v-4h-3V8h3z" fill="#D7DAE6"/>
    <path d="M10 9h3v8h-3zm15 0h3v8h-3z" fill="#6B7B9F"/>
    <path d="M12 21h14v4h4v13h-5v-9h-1v13H12V29h-1v9H6V25h6z" fill="#7B91C3"/>
    <path d="M12 40h5v7H8v-4h4zm8 0h5v3h4v4h-9z" fill="#BCC7E1"/>
    <path d="M9 28h5v4H9zm10 0h5v4h-5z" fill="#2D436A"/>
    <title>{name} placeholder sprite</title>
  </svg>;
}

function StageImpacts({events}: {events: BattleEvent[]}) {
  // Battle log is the authoritative accessible history. These are decorative pops.
  return <div className="retro-stage-impacts" aria-hidden="true">
    {events.slice(-3).map((event, index) => {
      if (event.type !== 'damage' && event.type !== 'heal') return null;
      const text = `${event.type === 'damage' ? '−' : '+'}${event.amount ?? 0}`;
      return <span key={`${event.tick}-${event.type}-${event.actorId ?? ''}-${index}`} className={`retro-stage-impact ${event.type === 'heal' ? 'is-heal' : ''}`}>{text}</span>;
    })}
  </div>;
}

export function BattleStageParty({state, def, selectedHeroId, readyHeroIds, onChooseHero, spriteUrls, recentEvents = []}: Props) {
  return <div className="retro-stage-party" role="group" aria-label="Hero battle formation">
    {state.party.map(id => {
      const actor = state.actors[id];
      if (!actor) return null;
      const name = def.actors[id]?.name.split(' ')[0] ?? id;
      const ready = actor.hp > 0 && readyHeroIds.includes(id);
      const selected = id === selectedHeroId && ready && !state.result;
      const airborne = Boolean(actor.statuses.airborne);
      const effects = recentEvents.filter(e => e.targetId === id && (e.type === 'damage' || e.type === 'heal'));
      return <button key={id} className={[
          'retro-stage-hero', selected ? 'is-selected' : '', ready ? 'is-ready' : '',
          actor.hp <= 0 ? 'is-ko' : '', airborne ? 'is-airborne' : ''
        ].filter(Boolean).join(' ')}
        type="button" disabled={!ready || Boolean(state.result)}
        onClick={() => onChooseHero(id)}
        aria-label={`${name}: ${actor.hp} of ${actor.stats.hp} HP${ready ? ', ready to act' : ''}`}
        aria-pressed={selected}>
        <span className="retro-stage-sprite-wrap">
          <Figure name={name} url={spriteUrls?.[id]}/>
        </span>
        <span className="retro-stage-hero-label">{selected ? '▶ ' : ''}{name}</span>
        {ready && <span className="retro-stage-ready" aria-hidden="true"/>}
        <StageImpacts events={effects}/>
      </button>;
    })}
  </div>;
}

export function BattleStageBossImpacts({state, recentEvents = []}: {state: BattleState; recentEvents?: BattleEvent[]}) {
  if (state.result === 'defeat') return null;
  const effects = recentEvents.filter(e => e.targetId === state.bossId && (e.type === 'damage' || e.type === 'heal'));
  return <div className="retro-boss-impacts"><StageImpacts events={effects}/></div>;
}
