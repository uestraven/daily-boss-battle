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
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BattleStage} from './BattleStage.js';
import {advanceToDecision, applyPlayerAction, calculateDamage, createEncounter,
  nextBossCountdown, previewAction, starsForResult} from '../../dist/src/engine.js';
import {availableActions, eligibleTargets, previewDisplay, actionInput} from '../../dist/src/play-ui.js';
import {choreograph} from '../../dist/src/presentation.js';
import {displayedValue} from '../../dist/src/stage.js';
import {poolCatalog, selectDaily, targetTierFor, validatePool} from '../../dist/src/pool.js';
import {dailyStatistics, ensureDay, playDailyAction, stepForDay} from '../../dist/src/daily.js';
import {loadLedger, saveLedger, clearLedger} from './storage.js';
import {ShareCard} from './ShareCard.js';
import {EmailSignup} from './EmailSignup.js';
import {resultCardInputFrom} from '../../dist/src/result-card.js';
import {advanceToDecision as freshBattle} from '../../dist/src/engine.js';
import {heroes} from '../../dist/src/roster.js';
import {spriteSheet} from './sprite-catalog.js';
import type {BeatScript} from '../../src/presentation.js';
import type {ActorId, BattleState, BattleStep, EncounterDefinition} from '../../src/types.js';
import type {DailyCatalog, DailyLedger} from '../../src/daily.js';
import type {OfferedAction} from '../../src/play-ui.js';
import type {VerifiedPool} from '../../src/pool.js';
import poolData from '../../dist-content/verified-pool.json';

const todayUtc = () => new Date().toISOString().slice(0, 10);
const ROLE_BY_ID: Record<string, string> = Object.fromEntries(heroes.map(h => [h.id, h.role]));

type Phase = {kind: 'choosing'} | {kind: 'playing'} | {kind: 'over'};

/** `?dev` enables presentation-testing controls. Phase two, KOs and the defeat screen
 * are all hard to reach by playing well, which makes them hard to verify; these jump
 * straight to the state under test. No daily result is persisted by this screen, so
 * nothing here can corrupt a record. */
const DEV = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');

export default function DailyBattle() {
  const day = todayUtc();

  // The pool is a verified artifact; if it cannot serve today, say so rather than
  // silently falling back to an unverified encounter.
  const setup = useMemo(() => {
    try {
      const pool = validatePool(poolData as unknown as VerifiedPool);
      const entry = selectDaily(day, pool);
      if (!entry) return {error: `No verified encounter is available for ${day}.`} as const;
      const catalog = poolCatalog(pool);
      return {catalog, def: catalog.definitionFor(day), entry} as const;
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

  return <Battle def={setup.def} catalog={setup.catalog} tier={setup.entry.tier ?? 'standard'} day={day} />;
}

function Battle({def, catalog, tier, day}:
  {def: EncounterDefinition; catalog: DailyCatalog; tier: string; day: string}) {
  // The ledger is the source of truth: it replays each stored action log, so a battle in
  // progress resumes exactly and a finished day stays finished.
  const [ledger, setLedger] = useState<DailyLedger>(() => ensureDay(loadLedger(catalog), day, catalog));
  const [step, setStep] = useState<BattleStep>(() => stepForDay(ledger, day, catalog));
  const [script, setScript] = useState<BeatScript | null>(null);
  const [phase, setPhase] = useState<Phase>({kind: 'choosing'});
  const [selected, setSelected] = useState<OfferedAction | null>(null);
  const [log, setLog] = useState<string[]>([]);
  /** Playback position for the current batch. Shared by the canvas and the DOM meters,
   * so a health bar can never disagree with the stage about how far a tween has run. */
  const [timeMs, setTimeMs] = useState(0);
  /** An unranked replay, kept out of the ledger so it cannot overwrite the day's
   * recorded result. v1 deliberately lets anyone replay as much as they like. */
  const [replay, setReplay] = useState<BattleStep | null>(null);
  const terminalRef = useRef<BattleStep['terminal']>(step.terminal);

  // Drive the clock while a batch is playing, then hand control back to the player.
  useEffect(() => {
    if (!script) return;
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      setTimeMs(elapsed);
      if (elapsed >= script.totalMs) {
        setPhase(terminalRef.current ? {kind: 'over'} : {kind: 'choosing'});
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script]);

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
  /** Validated sheets for whoever has one. A sheet that is missing or malformed is simply
   * omitted, and that actor keeps its silhouette. */
  const sheets = useMemo(() => {
    const result: Record<string, ReturnType<typeof spriteSheet>> = {};
    for (const id of def.party) {
      try { const sheet = spriteSheet('heroes', id); if (sheet) result[id] = sheet; } catch { /* skip */ }
    }
    try {
      const boss = spriteSheet('bosses', def.bossId);
      if (boss) result[def.bossId] = boss;
    } catch { /* skip */ }
    return result as Record<string, NonNullable<ReturnType<typeof spriteSheet>>>;
  }, [def]);

  const active = replay ?? step;
  terminalRef.current = active.terminal;
  const state = active.state;
  const actorId: ActorId | undefined = active.readyHeroIds[0];
  const boss = state.actors[state.bossId]!;
  const countdown = nextBossCountdown(state);

  const commit = useCallback((input: {actorId: string; abilityId: string; targetIds: string[]}) => {
    const before = state.events.length;
    let next: BattleStep;
    if (replay) {
      // Unranked: played against the engine directly, never recorded.
      next = applyPlayerAction(state, input, def);
      setReplay(next);
    } else {
      // Official attempt: goes through the ledger, which records the action log that
      // proves the result.
      const played = playDailyAction(ledger, day, input, catalog);
      next = played.step;
      setLedger(played.ledger);
      saveLedger(played.ledger);
      setStep(next);
    }
    const batch = next.state.events.slice(before);
    setTimeMs(0);
    setScript(choreograph(batch, {names, maxHp, abilityNames}));
    setSelected(null);
    setPhase({kind: 'playing'});
    setLog(previous => [
      ...batch.filter(e => e.type === 'damage' || e.type === 'heal' || e.type === 'ko')
        .map(e => e.type === 'ko'
          ? `${names[e.actorId ?? ''] ?? 'Someone'} is down`
          : `${names[e.actorId ?? ''] ?? ''} → ${names[e.targetId ?? ''] ?? ''}: ${e.type === 'heal' ? '+' : '−'}${e.amount}`),
      ...previous,
    ].slice(0, 24));
  }, [state, ledger, day, catalog, def, replay, names, maxHp, abilityNames]);

  /** Elemental affinities are decisive information — a fire-immune boss makes a
   * fire-only caster useless — and the player cannot infer them. Surface them. */
  const affinityNotes = useMemo(() => {
    const table = def.affinities?.[def.bossId] ?? {};
    return Object.entries(table)
      .filter(([, affinity]) => affinity && affinity !== 'neutral')
      .map(([element, affinity]) => ({element, affinity: affinity as string}));
  }, [def]);

  const offered = useMemo(() => {
    if (!actorId) return [];
    return availableActions(state, def, actorId).filter(o => o.enabled).map(option => {
      // Flag offensive abilities that would land for nothing against this boss.
      const isOffensive = option.ability.kind === 'physical' || option.ability.kind === 'magical';
      let noEffect = false;
      if (isOffensive && (option.ability.power ?? 0) > 0) {
        const actor = state.actors[actorId];
        const boss = state.actors[state.bossId];
        if (actor && boss) noEffect = calculateDamage(def, actor, boss, option.ability, state.tick) <= 0;
      }
      return {...option, noEffect};
    });
  }, [state, def, actorId]);
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
  const record = ledger.records[day];
  const stats = useMemo(() => dailyStatistics(ledger, day), [ledger, day]);
  /** Show the result panel once the active battle has finished playing out. */
  const showResult = Boolean(active.terminal) && phase.kind !== 'playing';
  const resultOutcome = active.terminal ?? record?.result ?? 'defeat';
  const resultStars = replay ? stars : (record?.stars ?? stars);

  const startReplay = useCallback(() => {
    setReplay(freshBattle(createEncounter(def), def));
    setScript(null);
    setSelected(null);
    setTimeMs(0);
    setPhase({kind: 'choosing'});
  }, [def]);

  /** The shared card always reports the recorded result for the day, not a replay, so
   * sharing cannot be used to inflate an outcome. */
  const cardInput = useMemo(() => {
    if (!record?.completed) return null;
    return resultCardInputFrom(record.state, {
      day,
      bossName: def.actors[def.bossId]!.name,
      partyNames: record.state.party.map(id => def.actors[id]?.name ?? id),
      stars: record.stars ?? 0,
      url: window.location.host || undefined,
    });
  }, [record, day, def]);

  return (
    <main className="dbb-shell">
      <header className="dbb-header">
        <span className="dbb-brand">✦ DAILY BOSS BATTLE</span>
        <span className="dbb-day">{day} · {tier}</span>
      </header>

      <section className="dbb-boss rpg-window">
        <div className="dbb-boss-name">{def.actors[state.bossId]!.name}</div>
        <div className="dbb-boss-hp">
          {Math.round(displayedValue(script, state.bossId, timeMs, boss.hp)).toLocaleString()}
          {' / '}{boss.stats.hp.toLocaleString()}
        </div>
        {affinityNotes.length > 0 && (
          <div className="dbb-affinity">
            {affinityNotes.map(note => (
              <span key={note.element} className={`dbb-affinity-tag is-${note.affinity}`}>
                {note.element} {note.affinity}
              </span>
            ))}
          </div>
        )}
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

      <BattleStage state={state} script={script} timeMs={timeMs} roles={ROLE_BY_ID} sheets={sheets} />

      <section className="dbb-party">
        {state.party.map(id => {
          const actor = state.actors[id]!;
          const ready = actor.ready && actor.hp > 0;
          const shownHp = Math.round(displayedValue(script, id, timeMs, actor.hp));
          return (
            <div key={id} className={`dbb-hero rpg-window${ready ? ' is-ready' : ''}${actor.hp === 0 ? ' is-down' : ''}`}>
              <div className="dbb-hero-name">{names[id]}</div>
              <div className="dbb-meter"><i style={{width: `${(100 * shownHp) / actor.stats.hp}%`}} /></div>
              <div className="dbb-hero-numbers">
                <span>{shownHp}/{actor.stats.hp}</span>
                {actor.stats.mp > 0 && <span>MP {actor.mp}</span>}
                {actor.momentum > 0 && <span>◆{actor.momentum}</span>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="dbb-commands rpg-window">
        {phase.kind === 'playing' && <div className="dbb-busy">…</div>}

        {showResult && (
          <div className="dbb-result">
            <strong>{resultOutcome === 'victory' ? 'VICTORY' : 'DEFEAT'}</strong>
            <span className="dbb-stars">
              {'★'.repeat(resultStars)}{'☆'.repeat(3 - resultStars)}
            </span>
            {replay
              ? <span className="dbb-hint">Replay — your recorded result for today stands.</span>
              : <span className="dbb-hint">Today&apos;s result is recorded.</span>}
            <div className="dbb-stats">
              <span>played {stats.completed}</span>
              <span>won {stats.wins}</span>
              <span>streak {stats.participationStreak}</span>
              <span>win streak {stats.victoryStreak}</span>
              <span>{stats.stars}★ total</span>
            </div>
            <div className="dbb-targets">
              <button className="rpg-menu-item" onClick={startReplay}>Play again (unranked)</button>
            </div>
            {cardInput && <ShareCard input={cardInput} />}
            <EmailSignup />
            <span className="dbb-hint">
              Results are stored in this browser only and are not server verified.
            </span>
          </div>
        )}

        {!showResult && phase.kind === 'choosing' && actorId && !selected && (
          <>
            <div className="dbb-prompt">{names[actorId]}</div>
            <ul className="rpg-menu-list">
              {offered.map(option => (
                <li key={option.ability.id}>
                  <button
                    className={`rpg-menu-item${option.noEffect ? ' is-no-effect' : ''}`}
                    onClick={() => setSelected(option)}
                  >
                    <span>{option.ability.name}</span>
                    <span className="rpg-menu-cost">
                      {option.noEffect && <b className="dbb-no-effect">NO EFFECT</b>}
                      {option.ability.mpCost ? ` ${option.ability.mpCost} MP` : ''}
                      {option.ability.momentumCost ? ` ◆${option.ability.momentumCost}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {!showResult && phase.kind === 'choosing' && actorId && selected && (
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

      {DEV && (
        <section className="dbb-dev rpg-window">
          <div className="dbb-dev-label">DEV · presentation testing</div>
          <div className="dbb-dev-row">
            <button onClick={() => setStep(nudgeBoss(step, def, 0.52))}>Boss → 52%</button>
            <button onClick={() => setStep(nudgeBoss(step, def, 0.46))}>Boss → 46%</button>
            <button onClick={() => setStep(nudgeBoss(step, def, 0.04))}>Boss → 4%</button>
            <button onClick={() => setStep(hurtParty(step, 0.25))}>Party → 25%</button>
            <button onClick={() => { clearLedger(); window.location.reload(); }}>Reset day</button>
          </div>
          <div className="dbb-dev-hint">
            Phase {state.phase} · transition at {def.bossProgram.transitionPercent}% ·
            {' '}attack from just above it to see the flash-and-hold ·
            {' '}stars {stars} · {record?.completed ? 'recorded' : 'in progress'}
            {replay ? ' · unranked replay' : ''}
          </div>
        </section>
      )}

      <section className="dbb-log">
        {log.map((line, index) => <div key={index} className="dbb-log-line">{line}</div>)}
      </section>
    </main>
  );
}

/** Sets the boss to a fraction of max HP, for reaching a phase transition on demand. */
function nudgeBoss(step: BattleStep, def: EncounterDefinition, fraction: number): BattleStep {
  const state: BattleState = JSON.parse(JSON.stringify(step.state));
  const boss = state.actors[state.bossId]!;
  boss.hp = Math.max(1, Math.round(boss.stats.hp * fraction));
  return {...step, state};
}

/** Drops the party to a fraction of max HP, for reaching KO and defeat presentation. */
function hurtParty(step: BattleStep, fraction: number): BattleStep {
  const state: BattleState = JSON.parse(JSON.stringify(step.state));
  for (const id of state.party) {
    const actor = state.actors[id]!;
    actor.hp = Math.max(1, Math.round(actor.stats.hp * fraction));
  }
  return {...step, state};
}
