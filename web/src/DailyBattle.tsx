/** The player-facing daily battle screen. Portrait-first.
 *
 * Layout: stage on top, party status beneath it, command window in the bottom third —
 * everything reachable with one thumb. Replaces the old desktop `App.tsx` dev harness,
 * which remains on disk until this screen is proven on a device.
 *
 * Engine imports come from `dist/` because `src/` uses NodeNext `.js` specifiers that
 * Vite will not rewrite to `.ts`. `npm run web:dev` builds first, so this is consistent
 * rather than stale — see the README note.
 */
import {useCallback, useMemo, useState} from 'react';
import {BattleStage} from './BattleStage.js';
import {advanceToDecision, applyPlayerAction, createEncounter, nextBossCountdown,
  previewAction, starsForResult} from '../../dist/src/engine.js';
import {availableActions, eligibleTargets, previewDisplay, actionInput} from '../../dist/src/play-ui.js';
import {choreograph} from '../../dist/src/presentation.js';
import {dailyEncounter, selectDaily, targetTierFor, validatePool} from '../../dist/src/pool.js';
import {heroes} from '../../dist/src/roster.js';
import type {BeatScript} from '../../src/presentation.js';
import type {ActorId, BattleState, BattleStep, EncounterDefinition} from '../../src/types.js';
import type {OfferedAction} from '../../src/play-ui.js';
import type {VerifiedPool} from '../../src/pool.js';
import poolData from '../../dist-content/verified-pool.json';

const todayUtc = () => new Date().toISOString().slice(0, 10);
const ROLE_BY_ID: Record<string, string> = Object.fromEntries(heroes.map(h => [h.id, h.role]));

type Phase = {kind: 'choosing'} | {kind: 'playing'} | {kind: 'over'};

export default function DailyBattle() {
  const day = todayUtc();

  // The pool is a verified artifact; if it cannot serve today, say so rather than
  // silently falling back to an unverified encounter.
  const setup = useMemo(() => {
    try {
      const pool = validatePool(poolData as unknown as VerifiedPool);
      const entry = selectDaily(day, pool);
      if (!entry) return {error: `No verified encounter is available for ${day}.`} as const;
      return {def: dailyEncounter(day, pool), entry} as const;
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)} as const;
    }
  }, [day]);

  if ('error' in setup) {
    return (
      <main className="dbb-shell">
        <div className="rpg-window dbb-error">
          <h1>Daily Boss Battle</h1>
          <p>{setup.error}</p>
          <p className="dbb-hint">Rebuild the verified pool with <code>npm run pool:build</code>.</p>
        </div>
      </main>
    );
  }

  return <Battle def={setup.def} tier={setup.entry.tier ?? 'standard'} day={day} />;
}

function Battle({def, tier, day}: {def: EncounterDefinition; tier: string; day: string}) {
  const [step, setStep] = useState<BattleStep>(() => advanceToDecision(createEncounter(def), def));
  const [script, setScript] = useState<BeatScript | null>(null);
  const [phase, setPhase] = useState<Phase>({kind: 'choosing'});
  const [selected, setSelected] = useState<OfferedAction | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const names = useMemo(
    () => Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.name])),
    [def],
  );
  const maxHp = useMemo(
    () => Object.fromEntries(Object.entries(def.actors).map(([id, a]) => [id, a.stats.hp])),
    [def],
  );
  const abilityNames = useMemo(
    () => Object.fromEntries(Object.values(def.abilities).map(a => [a.id, a.name])),
    [def],
  );

  const state = step.state;
  const actorId: ActorId | undefined = step.readyHeroIds[0];
  const boss = state.actors[state.bossId]!;
  const countdown = nextBossCountdown(state);

  const commit = useCallback((input: {actorId: string; abilityId: string; targetIds: string[]}) => {
    const before = state.events.length;
    const next = applyPlayerAction(state, input, def);
    const batch = next.state.events.slice(before);
    setScript(choreograph(batch, {names, maxHp, abilityNames}));
    setStep(next);
    setSelected(null);
    setPhase({kind: 'playing'});
    setLog(previous => [
      ...batch.filter(e => e.type === 'damage' || e.type === 'heal' || e.type === 'ko')
        .map(e => e.type === 'ko'
          ? `${names[e.actorId ?? ''] ?? 'Someone'} is down`
          : `${names[e.actorId ?? ''] ?? ''} → ${names[e.targetId ?? ''] ?? ''}: ${e.type === 'heal' ? '+' : '−'}${e.amount}`),
      ...previous,
    ].slice(0, 24));
  }, [state, def, names, maxHp, abilityNames]);

  const onPlaybackEnd = useCallback(() => {
    setPhase(step.terminal ? {kind: 'over'} : {kind: 'choosing'});
  }, [step.terminal]);

  const offered = useMemo(
    () => (actorId ? availableActions(state, def, actorId).filter(o => o.enabled) : []),
    [state, def, actorId],
  );
  const targets = useMemo(
    () => (selected && actorId ? eligibleTargets(state, actorId, selected.ability) : []),
    [selected, actorId, state],
  );
  const preview = useMemo(() => {
    if (!selected || !actorId) return null;
    try {
      const input = actionInput(state, actorId, selected.ability);
      return previewDisplay(state, def, input, previewAction(state, input, def));
    } catch {
      return null;
    }
  }, [selected, actorId, state, def]);

  const stars = starsForResult(state);

  return (
    <main className="dbb-shell">
      <header className="dbb-header">
        <span className="dbb-brand">✦ DAILY BOSS BATTLE</span>
        <span className="dbb-day">{day} · {tier}</span>
      </header>

      <section className="dbb-boss rpg-window">
        <div className="dbb-boss-name">{def.actors[state.bossId]!.name}</div>
        <div className="dbb-boss-hp">{boss.hp.toLocaleString()} / {boss.stats.hp.toLocaleString()}</div>
        {countdown && (
          <div className="dbb-telegraph">
            ▶ {abilityNames[countdown.abilityId] ?? countdown.abilityId}
            {' → '}
            {(state.bossIntent?.targetIds ?? []).map(id => names[id]).join(', ') || '—'}
            {countdown.impactIn !== undefined
              ? ` · impact in ${countdown.impactIn}`
              : countdown.readyIn === 0 ? ' · now' : ` · ready in ${countdown.readyIn}`}
          </div>
        )}
      </section>

      <BattleStage
        state={state}
        script={script}
        onPlaybackEnd={onPlaybackEnd}
        roles={ROLE_BY_ID}
      />

      <section className="dbb-party">
        {state.party.map(id => {
          const actor = state.actors[id]!;
          const ready = actor.ready && actor.hp > 0;
          return (
            <div key={id} className={`dbb-hero rpg-window${ready ? ' is-ready' : ''}${actor.hp === 0 ? ' is-down' : ''}`}>
              <div className="dbb-hero-name">{names[id]}</div>
              <div className="dbb-meter"><i style={{width: `${(100 * actor.hp) / actor.stats.hp}%`}} /></div>
              <div className="dbb-hero-numbers">
                <span>{actor.hp}/{actor.stats.hp}</span>
                {actor.stats.mp > 0 && <span>MP {actor.mp}</span>}
                {actor.momentum > 0 && <span>◆{actor.momentum}</span>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="dbb-commands rpg-window">
        {phase.kind === 'playing' && <div className="dbb-busy">…</div>}

        {phase.kind === 'over' && (
          <div className="dbb-result">
            <strong>{step.terminal === 'victory' ? 'VICTORY' : 'DEFEAT'}</strong>
            <span className="dbb-stars">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</span>
            <span className="dbb-hint">{state.heroActionCount} actions · tick {state.tick}</span>
          </div>
        )}

        {phase.kind === 'choosing' && actorId && !selected && (
          <>
            <div className="dbb-prompt">{names[actorId]}</div>
            <ul className="rpg-menu-list">
              {offered.map(option => (
                <li key={option.ability.id}>
                  <button className="rpg-menu-item" onClick={() => setSelected(option)}>
                    <span>{option.ability.name}</span>
                    <span className="rpg-menu-cost">
                      {option.ability.mpCost ? `${option.ability.mpCost} MP` : ''}
                      {option.ability.momentumCost ? ` ◆${option.ability.momentumCost}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {phase.kind === 'choosing' && actorId && selected && (
          <>
            <div className="dbb-prompt">{selected.ability.name}</div>
            {preview && (
              <ul className="dbb-preview">
                {preview.lines.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            )}
            <div className="dbb-targets">
              {(targets.length > 1 ? targets : [targets[0]]).filter(Boolean).map(targetId => (
                <button
                  key={targetId}
                  className="rpg-menu-item"
                  onClick={() => commit(actionInput(state, actorId, selected.ability, targetId))}
                >
                  {selected.ability.target.startsWith('all_') ? 'Confirm' : names[targetId!]}
                </button>
              ))}
              <button className="rpg-menu-back" onClick={() => setSelected(null)}>Back</button>
            </div>
          </>
        )}
      </section>

      <section className="dbb-log">
        {log.map((line, index) => <div key={index} className="dbb-log-line">{line}</div>)}
      </section>
    </main>
  );
}
