/** The player-facing daily battle screen. Portrait-first.
 *
 * Layout: stage on top, party status beneath it, command window in the bottom third —
 * everything reachable with one thumb. Replaced the old desktop `App.tsx` dev harness,
 * now deleted.
 *
 * Engine imports come from `dist/` because `src/` uses NodeNext `.js` specifiers that
 * Vite will not rewrite to `.ts`. `npm run web:dev` builds first, so this is consistent
 * rather than stale — see the README note.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BattleStage, prefetchEffects} from './BattleStage.js';
import {advanceToDecision, applyPlayerAction, calculateDamage, createEncounter,
  nextBossCountdown, previewAction, starsForResult} from '../../dist/src/engine.js';
import {ABILITY_GROUPS, SUBMENU_GROUPS, availableActions, eligibleTargets, previewDisplay, actionInput} from '../../dist/src/play-ui.js';
import {choreograph} from '../../dist/src/presentation.js';
import {displayedValue, downAt, statusesAt} from '../../dist/src/stage.js';
import {poolCatalog, selectDaily, targetTierFor, validatePool} from '../../dist/src/pool.js';
import {applyOpeningState, isPresentationOnly, parseBattleParams, seedsOpeningState,
  wantsCustomEncounter} from '../../dist/src/battle-params.js';
import {buildEncounter} from '../../dist/src/generate.js';
import {dailyStatistics, ensureDay, localDateKey, playDailyAction, setDayMode, stepForDay} from '../../dist/src/daily.js';
import {loadLedger, saveLedger, clearLedger} from './storage.js';
import {ShareCard} from './ShareCard.js';
import {EmailSignup} from './EmailSignup.js';
import {resultCardInputFrom} from '../../dist/src/result-card.js';
import {audioCues, musicChanges, requiredSounds} from '../../dist/src/audio.js';
import {isMuted, playCues, playMusic, prefetchMusic, prefetchPhaseTwo, prefetchSounds, setMuted, unlockAudio} from './audio-player.js';
import {advanceToDecision as freshBattle} from '../../dist/src/engine.js';
import {heroes} from '../../dist/src/roster.js';
import {spriteSheet} from './sprite-catalog.js';
import {effectLibrary} from './effect-catalog.js';
import {backgroundForBoss, battleBackgrounds, hasBackgroundArt} from './background-catalog.js';
import {BackgroundStudio} from './BackgroundStudio.js';
import {Codex} from './Codex.js';
import {BANNER_HEIGHT, BANNER_SHIPPED, BANNER_WIDTH, bannerUrl} from './title-banner.js';
import {VersusScreen} from './VersusScreen.js';
import {STATUS_DISPLAY, visibleStatuses} from '../../dist/src/status-display.js';
import {logLines} from '../../dist/src/battle-log.js';
import {focusFirstItemIfNavigating, handleMenuKey} from './menu-keys.js';
import {clearBestiary, loadBestiary, saveBestiary} from './bestiary-store.js';
import {clearRosterProgress, loadRosterProgress, saveRosterProgress} from './roster-progress-store.js';
import {metHeroes, observeParty} from '../../dist/src/roster-progress.js';
import {heroIds} from '../../dist/src/roster.js';
import {emptyDiscovery, observeBattle} from '../../dist/src/bestiary.js';
import {bossIds} from '../../dist/src/generate.js';
import {disclosureFor} from '../../dist/src/disclosure.js';
import {abilityInfoFor} from '../../dist/src/animation.js';
import type {BeatScript} from '../../src/presentation.js';
import type {ActorId, BattleMode, BattleState, BattleStep, EncounterDefinition} from '../../src/types.js';
import type {DailyCatalog, DailyLedger} from '../../src/daily.js';
import type {AbilityGroup, OfferedAction} from '../../src/play-ui.js';

/** An offered action plus the NO EFFECT flag the screen computes for it. */
type MenuOption = OfferedAction & {noEffect: boolean};
import type {VerifiedPool} from '../../src/pool.js';
import poolData from '../../dist-content/verified-pool.json';

/** The player's own calendar date. See localDateKey: the date-to-encounter mapping is
 * still global, so this only decides when this browser rolls over, not what it gets. */
const today = () => localDateKey(new Date());
/** Every effect the choreography can ask for, derived from the sound manifest rather than
 * listed here, so a new cue is prefetched without anyone remembering to add it. */
const SOUND_IDS = requiredSounds().map(sound => sound.id);
const ROLE_BY_ID: Record<string, string> = Object.fromEntries(heroes.map(h => [h.id, h.role]));

type Phase = {kind: 'choosing'} | {kind: 'playing'} | {kind: 'over'};

/** Easy reveals what the interface knows; Normal withholds it. Neither changes the fight.
 *
 * The verified pool guarantees every daily encounter is winnable, but it proves that with
 * a solver that can see everything, so Normal is harder in a way the gates do not measure:
 * the win is still there, it is just no longer signposted. */
const MODE_BLURB: Record<BattleMode, {title: string; detail: string}> = {
  easy: {
    title: 'Easy',
    detail: 'Shows status effects, the boss\u2019s elemental weaknesses, its next attack, '
      + 'and what each action will do before you commit.',
  },
  normal: {
    title: 'Normal',
    detail: 'No status badges, no warning, no elemental hints, no damage figures. '
      + 'Read the fight yourself.',
  },
};
/** Bumped from v1 because the meaning of a stored value changed, not just the default.
 * v1 read "anything that is not 'normal'" as Easy, so every browser that had ever opened
 * the landing screen held a value that would still resolve to Easy under the new rule.
 * Discarding those is the only way the new default actually takes effect for the people
 * who have already visited. */
const MODE_KEY = 'daily-boss-battle.mode.v2';

/** Normal is the default: the game it is meant to be. Easy is opt-in, and only an explicit
 * past choice brings it back — an unrecognised stored value falls to Normal rather than
 * being treated as consent to the easier interface. */
const readMode = (): BattleMode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'easy' ? 'easy' : 'normal';
  } catch { return 'normal'; }
};

/** `?dev` enables presentation-testing controls. Phase two, KOs and the defeat screen
 * are all hard to reach by playing well, which makes them hard to verify; these jump
 * straight to the state under test. No daily result is persisted by this screen, so
 * nothing here can corrupt a record. */
const PARAMS = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV = PARAMS.has('dev');
/** Opens the background authoring tool. Off the main path on purpose: it is a tool for
 * producing art, not part of the game, and its only previous entry point was the deleted
 * App.tsx harness, which left it unreachable. */
const STUDIO = PARAMS.has('studio');
/** `?speed=` scales playback: 1 is normal, 0.5 half speed, 2 double. For dialling in the
 * animation pace against real art without a rebuild. */
const SPEED = (() => {
  const raw = Number(PARAMS.get('speed'));
  return Number.isFinite(raw) && raw > 0 ? Math.min(4, Math.max(0.25, raw)) : 1;
})();

/** Battle configuration from the URL: `?boss=`, `?party=`, `?day=`, `?bosshp=`,
 * `?partyhp=`, `?phase=`, `?mode=`. Parsed and validated in src/battle-params.ts.
 *
 * Any of these other than `?mode=` alone makes the attempt **unranked**: the screen seeds
 * the same `replay` state that the replay button uses, and the action handler's replay
 * branch never touches the ledger. So a configured battle cannot overwrite a day's record
 * or its streak, which is what makes it safe to leave these enabled in production -- and
 * being enabled in production is the point, because the service worker, real devices and
 * the deployed asset paths are exactly what cannot be tested locally. */
const CONFIG = parseBattleParams(
  typeof window !== 'undefined' ? window.location.search : '');

export default function DailyBattle() {
  // A tab left open past local midnight was stuck on yesterday's battle, because the date
  // was read once on mount. Poll for the change, and check on focus, which is when it is
  // most likely to have happened.
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(previous => {
      const now = today();
      return now === previous ? previous : now;
    });
    const timer = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  // A URL may ask for another day's encounter. The ledger still keys off the real date, so
  // this only changes which fight is loaded -- and because any such request is unranked,
  // no record is written under a date the player was not actually on.
  const subject = CONFIG.sandbox?.day ?? day;

  // The pool is a verified artifact; if it cannot serve today, say so rather than
  // silently falling back to an unverified encounter.
  const setup = useMemo(() => {
    // A malformed parameter is reported instead of being dropped. Playing on with a valid
    // but different battle is the one outcome guaranteed to waste someone's time.
    if (CONFIG.errors.length) {
      return {error: `Cannot read the battle configuration:\n${CONFIG.errors.join('\n')}`} as const;
    }
    try {
      const pool = validatePool(poolData as unknown as VerifiedPool);
      const catalog = poolCatalog(pool);
      const request = CONFIG.sandbox;

      // A named boss and party bypass the pool entirely. buildEncounter owns the
      // validation -- unknown ids, a hero that collides with the boss -- and its errors
      // land in the panel below.
      if (request && wantsCustomEncounter(request)) {
        const def = buildEncounter(request.bossId!, request.party!, {
          id: `sandbox-${request.bossId}-${request.party!.join('-')}`,
          contentVersion: `sandbox|${pool.contentHash}`,
        });
        return {catalog, def, entry: null, unranked: true} as const;
      }

      const entry = selectDaily(subject, pool);
      if (!entry) return {error: `No verified encounter is available for ${subject}.`} as const;
      return {
        catalog, entry, def: catalog.definitionFor(subject),
        unranked: request ? !isPresentationOnly(request) : false,
      } as const;
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)} as const;
    }
  }, [subject]);

  if ('error' in setup) {
    return (
      <main className="dbb-shell">
        <div className="rpg-window dbb-error">
          <h1>Daily Boss Battle</h1>
          <p style={{whiteSpace: 'pre-line'}}>{setup.error}</p>
          {CONFIG.errors.length ? (
            <p className="dbb-hint">
              Expected <code>?boss=storm_keeper&amp;party=machinist,warden,monk</code>,
              {' '}<code>?day=YYYY-MM-DD</code>, <code>?bosshp=46</code>,
              {' '}<code>?partyhp=25</code>, <code>?phase=2</code>, <code>?mode=easy</code>.
            </p>
          ) : (
            <p className="dbb-hint">Rebuild the verified pool with <code>npm run pool:build</code>.</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <Battle
      // Remounts when the configured encounter changes, not just the date, so editing a
      // parameter in the address bar starts a clean battle rather than grafting new
      // actors onto the old state.
      key={`${subject}|${setup.def.id}`}
      def={setup.def}
      catalog={setup.catalog}
      tier={setup.entry?.tier ?? 'standard'}
      day={day}
      unranked={setup.unranked}
    />
  );
}

function Battle({def, catalog, tier, day, unranked}:
  {def: EncounterDefinition; catalog: DailyCatalog; tier: string; day: string;
   unranked: boolean}) {
  // The ledger is the source of truth: it replays each stored action log, so a battle in
  // progress resumes exactly and a finished day stays finished.
  const [ledger, setLedger] = useState<DailyLedger>(() => ensureDay(loadLedger(catalog), day, catalog));
  /** The mode this day is being played under. A day already under way keeps the mode it
   * was started with, so it cannot be switched mid-fight to reveal a telegraph. */
  /** The record's own mode comes first, ahead of `?mode=`. A day already under way keeps
   * the mode it started with, and `?mode=` alone is still a *ranked* attempt -- so letting
   * the URL win would be a way to flip a ranked fight to Easy mid-battle and reveal the
   * telegraph, which is the exact thing this ordering exists to prevent. On a fresh day,
   * or in an unranked sandbox, there is no record and the parameter applies. */
  const [mode, setMode] = useState<BattleMode>(() => unranked
    // An unranked battle is not the recorded day, so the day's stored mode says nothing
    // about it and the parameter is free to apply.
    ? CONFIG.sandbox?.mode ?? readMode()
    : ledger.records[day]?.mode ?? CONFIG.sandbox?.mode ?? readMode());
  /** The landing screen stands between arriving and playing, so the mode is a deliberate
   * choice rather than a default nobody saw. Skipped for a day already in progress or
   * finished: the choice was made, and re-asking would imply it could be changed. */
  const [showLanding, setShowLanding] = useState(() => {
    // A URL that names a battle or a mode has already made both choices the landing screen
    // asks for, so stopping to ask again is pure friction. The landing screen itself is
    // still reachable the ordinary way, on the real daily.
    if (unranked || CONFIG.sandbox?.mode) return false;
    const existing = ledger.records[day];
    return !existing || (existing.inputs.length === 0 && !existing.completed);
  });
  /** The matchup screen, shown once between pressing Begin and the first turn.
   *
   * State rather than a route, and only ever set by `beginBattle`: a replay must not play it
   * again, and neither must a reload of a day already in progress. Nobody wants the same
   * two seconds twice. */
  const [showVersus, setShowVersus] = useState(false);
  /** Stable, so the matchup screen's timer is not restarted by this component re-rendering
   * -- which it does twenty times a second while the idle clock runs. */
  const dismissVersus = useCallback(() => setShowVersus(false), []);

  /** The command panel, for arrow-key navigation and for moving focus as menus change. */
  const commandRef = useRef<HTMLElement | null>(null);

  /** What the player has learned about each boss, across every day they have played.
   *
   * Kept separate from the ledger and under its own key: the ledger is today's record and
   * the dev panel's "Reset day" clears it, while this accumulates and should survive that,
   * or testing a fight would wipe the only progression the game has. */
  const [bestiary, setBestiary] = useState(() => loadBestiary(bossIds));

  /** Which heroes the player has fought alongside. Counted when a battle concludes, so an
   * abandoned day unlocks nobody -- but the day's own party is always treated as met, since
   * they are on screen. See `src/roster-progress.ts`. */
  const [rosterProgress, setRosterProgress] = useState(() => loadRosterProgress(heroIds));

  /** The Codex, over the top of whatever screen opened it.
   *
   * Local state so it can never touch ranking -- see the button that sets it. */
  const [showCodex, setShowCodex] = useState(false);
  const [step, setStep] = useState<BattleStep>(() => stepForDay(ledger, day, catalog));
  const [script, setScript] = useState<BeatScript | null>(null);
  const [phase, setPhase] = useState<Phase>({kind: 'choosing'});
  const [selected, setSelected] = useState<OfferedAction | null>(null);
  /** Which submenu is open, or null at the root. Reset whenever the turn passes, so a new
   * character always starts at the top of its own menu. */
  const [openGroup, setOpenGroup] = useState<AbilityGroup | null>(null);

  /** When a submenu opens or closes, carry a keyboard player's focus into the new panel.
   *
   * Guarded so it only acts when focus is already inside the menu: focusing on every panel
   * change would hijack a mouse user mid-click and scroll a phone to the command window.
   * Keyed on the depth rather than on the panel contents, so re-rendering for an unrelated
   * reason does not move the cursor out from under someone. */
  useEffect(() => {
    focusFirstItemIfNavigating(commandRef.current);
  }, [openGroup, selected?.ability.id]);
  const [log, setLog] = useState<string[]>([]);
  /** Playback position for the current batch. Shared by the canvas and the DOM meters,
   * so a health bar can never disagree with the stage about how far a tween has run. */
  const [timeMs, setTimeMs] = useState(0);
  /** A clock that never stops, for looping clips.
   *
   * `timeMs` restarts at zero each batch and stops between turns, so idle animations were
   * frozen mid-breath for as long as the player took to choose. This runs the whole time
   * the screen is mounted, including during playback -- which matters, because switching
   * idle from one clock to the other at the end of a batch would pop the frame. */
  const [idleMs, setIdleMs] = useState(0);
  /** An unranked replay, kept out of the ledger so it cannot overwrite the day's
   * recorded result. v1 deliberately lets anyone replay as much as they like.
   *
   * A URL-configured battle starts here too, which is the whole of its isolation: the
   * action handler's `if (replay)` branch plays against the engine directly and never
   * calls saveLedger, so no amount of testing can touch a real record. Seeded in the
   * initialiser rather than an effect so the first paint is already the configured
   * battle -- via an effect, the day's real encounter would flash up first. */
  const [replay, setReplay] = useState<BattleStep | null>(
    () => unranked ? seededBattle(def) : null);
  const [mutedState, setMutedState] = useState(() => isMuted());
  /** Autoplay is blocked until a gesture, so the theme cannot start on load. Any gesture
   * counts though, so it starts on the first touch anywhere rather than waiting for an
   * action to be committed. */
  const audioStarted = useRef(false);
  const terminalRef = useRef<BattleStep['terminal']>(step.terminal);
  /** Readings taken just before a batch, held while it animates.
   *
   * HP has `hp_change` beats, so `displayedValue` can place it anywhere on the timeline.
   * MP spend, momentum, turn readiness and the boss's next intent have no beat at all, so
   * reading them from `state` showed the aftermath the instant an action was committed --
   * the next telegraph appearing while the current attack was still winding up. Held at
   * their pre-batch values instead, and released when playback ends. */
  const [held, setHeld] = useState<{
    mp: Record<string, number>; momentum: Record<string, number>;
    ready: Record<string, boolean>; phase: number;
    /** The whole telegraph as one unit. Holding only the target list would have paired
     * last turn's targets with this turn's ability name, which is worse than either. */
    telegraph: {countdown: NonNullable<ReturnType<typeof nextBossCountdown>>;
                targetIds: readonly string[]} | null;
  } | null>(null);

  /** Start the download now. It needs no AudioContext, so it does not have to wait for a
   * gesture, and the theme is by far the largest asset: deferring the request until the
   * moment the music should start meant it arrived seconds late. */
  useEffect(() => {
    prefetchMusic();
    // Bytes only at this point: decoding needs an AudioContext, which cannot exist until a
    // gesture. The gesture handler calls this again to decode them.
    prefetchSounds(SOUND_IDS);
  }, []);

  /** Unlock on the first gesture anywhere and start the theme. Called from the command
   * menu, the mute button and the commit path, so whichever happens first wins. */
  const startAudio = useCallback(() => {
    unlockAudio();
    // Now that a context exists the prefetched bytes can be decoded, so no cue has to race
    // its own download. Cheap and idempotent: anything already decoded is a cache hit.
    prefetchSounds(SOUND_IDS);
    // Muted means the mute button owns starting the music, so it is not wasted at gain 0.
    if (audioStarted.current || isMuted()) return;
    audioStarted.current = true;
    void playMusic('battle_main');
    // The fight is under way, so start pulling the phase-two theme now rather than at the
    // transition. It is another megabyte, and the switch is the one moment it must not
    // still be downloading.
    prefetchPhaseTwo();
  }, []);

  // Sampled rather than run at 60fps: idle clips hold each frame for 160ms, so a 70ms
  // tick is already twice the rate needed and costs ~14 renders a second instead of 60.
  // Nothing else on this screen moves between turns, so the difference is the idle loop's
  // entire cost. Hidden tabs are throttled by the browser.
  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => setIdleMs(performance.now() - startedAt), 70);
    return () => window.clearInterval(timer);
  }, []);

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
        // The animation has caught up with the state, so stop holding anything back.
        setHeld(null);
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
  /** Real ability kinds, shared by the mixer and clip selection: it is what lets a spell
   * sound and look different from a sword swing, and a potion from both. Previously
   * flattened to magical-or-physical, which was enough for two sound families but erased
   * every distinction an animation needs.
   *
   * `element` has to travel with it. Without it every spell in the game drew
   * `flare_neutral`: `effectIdFor` tries `byElement` before falling back to the generic
   * magical flare, so an undefined element silently skipped the entire elemental table and
   * flare_fire, flare_ice, flare_lightning and flare_holy could never be reached. The
   * mixer was unaffected, which is why this looked wrong but sounded right -- it keys on
   * `kind` alone. Built by `abilityInfoFor` rather than inline here, so the shape is
   * asserted by the test suite instead of living in a .tsx no test can import. */
  const abilityInfo = useMemo(() => abilityInfoFor(def.abilities), [def]);
  /** Hit effects that have art. Empty until the sheets are commissioned, in which case
   * composeFrame emits no effect commands at all. */
  const effects = useMemo(() => effectLibrary(), []);
  /** Warm the effect sheets before anything needs one.
   *
   * Same reason as the sounds above, and more urgent: an effect lives for 400ms, far less
   * than it takes to fetch and decode a PNG, so requesting one on demand guarantees its
   * first occurrence draws nothing at all. See `prefetchEffects`. */
  useEffect(() => { prefetchEffects(effects); }, [effects]);
  /** This arena's backdrop, if its art exists. Undefined leaves the flat stage, which is
   * what ships until the backgrounds are drawn. */
  const backgroundFile = useMemo(() => {
    const arena = backgroundForBoss(def.bossId);
    return hasBackgroundArt(arena) ? battleBackgrounds[arena].file : undefined;
  }, [def]);
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

  /** The difficulty policy, read from the one table that defines it.
   *
   * Everything Easy adds is *information the interface already has*, never a change to the
   * fight. This used to be a single `reveals` boolean whose comment claimed it was the
   * whole policy and listed the four things hanging off it -- while the action preview,
   * which prints exact damage and names the boss's newly announced attack, showed in
   * Normal the entire time. A boolean cannot tell you what was never attached to it. Each
   * disclosure is now a named field in src/disclosure.ts, so a new one has to state a
   * position for both modes before it compiles. */
  const show = disclosureFor(mode);

  /** Non-null only while a batch is animating, so every read below has one rule. */
  const pending = phase.kind === 'playing' ? held : null;

  const active = replay ?? step;
  terminalRef.current = active.terminal;
  const state = active.state;
  const actorId: ActorId | undefined = active.readyHeroIds[0];
  const boss = state.actors[state.bossId]!;
  const countdown = nextBossCountdown(state);
  const beginBattle = useCallback((chosen: BattleMode) => {
    setMode(chosen);
    // Nothing persists for an unranked battle -- not the day's mode, not the preference.
    // The landing screen is already skipped in that case, so this is belt and braces: it
    // makes "a sandbox never writes storage" true of the code rather than true only of
    // the route currently taken to reach it.
    if (!unranked) {
      try { window.localStorage.setItem(MODE_KEY, chosen); } catch { /* private mode */ }
      // Recorded against the day as well as remembered as a preference, so the result card
      // can say which interface it was earned under.
      setLedger(previous => {
        const next = setDayMode(previous, day, chosen);
        saveLedger(next);
        return next;
      });
    }
    setShowLanding(false);
    // Shown here rather than inside the landing screen, so the only route to it is pressing
    // Begin. The battle state is already live behind it, which is what lets it double as a
    // loading cover for the sheets and the backdrop.
    setShowVersus(true);
    // The tap that starts the battle is a user gesture, which is exactly what autoplay
    // needs, so the theme can begin here rather than waiting for the first action.
    startAudio();
  }, [day, startAudio, unranked]);

  /** Status badges for one actor, resolved against playback rather than the state the
   * batch ended in -- the same rule as the health bars, so a buff cannot appear before the
   * spell that granted it has played. */
  const statusBadges = useCallback((id: ActorId) => {
    if (!show.statuses) return null;
    const ids = visibleStatuses(statusesAt(script, id, timeMs, state.actors[id]?.statuses ?? {}));
    if (!ids.length) return null;
    return (
      <div className="dbb-statuses">
        {ids.map(status => {
          const display = STATUS_DISPLAY[status];
          return (
            <span key={status} className={`dbb-status is-${display.tone}`} title={display.hint}
              aria-label={`${display.label}: ${display.hint}`}>
              {display.label}
            </span>
          );
        })}
      </div>
    );
  }, [show.statuses, script, timeMs, state]);

  /** The telegraph as the player should see it now: last turn's while this turn animates,
   * so the boss's next move is not revealed before the current one has landed. */
  const shownTelegraph = !show.telegraph ? null : pending
    ? pending.telegraph
    : countdown ? {countdown, targetIds: state.bossIntent?.targetIds ?? []} : null;

  const commit = useCallback((input: {actorId: string; abilityId: string; targetIds: string[]}) => {
    const before = state.events.length;
    // Taken while `state` is still the pre-batch state, which the lines below replace.
    setHeld({
      mp: Object.fromEntries(state.party.map(id => [id, state.actors[id]?.mp ?? 0])),
      momentum: Object.fromEntries(state.party.map(id => [id, state.actors[id]?.momentum ?? 0])),
      ready: Object.fromEntries(state.party.map(id => [id, state.actors[id]?.ready ?? false])),
      phase: state.phase,
      telegraph: (() => {
        const countdown = nextBossCountdown(state);
        return countdown ? {countdown, targetIds: state.bossIntent?.targetIds ?? []} : null;
      })(),
    });
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
    const nextScript = choreograph(batch, {names, maxHp, abilityNames, speed: SPEED});
    setScript(nextScript);

    // Audio is driven by the same choreography the visuals use, so a hit sound cannot
    // drift from the hit it belongs to -- and by the same disclosure, so it cannot
    // announce what the screen is withholding.
    startAudio();
    playCues(audioCues(nextScript, {abilityInfo, disclosure: show}));
    for (const change of musicChanges(nextScript, 'battle_main')) {
      window.setTimeout(() => void playMusic(change.track), Math.max(0, change.at));
    }
    setSelected(null);
    setPhase({kind: 'playing'});
    // Outcomes that are not damage were absent from the log entirely, so a turn that
    // achieved nothing left no record of having happened. A fizzle, an absorbed spell and
    // a blocked hit are exactly the results a player needs to read back.
    // One line per thing that happened, from `src/battle-log.ts`. The mapping lives there
    // rather than here because the log is the only textual account of a fight -- what a
    // player reads back, and the whole accessible representation of a `<canvas>` stage --
    // and it had drifted to covering ten of twenty-nine event types while buried in this
    // component where no test could see it.
    setLog(previous => [
      ...logLines(batch, {actors: names, abilities: abilityNames}),
      ...previous,
    ].slice(0, 24));

    // Fold what was just witnessed into the bestiary.
    //
    // `expectedFor` recomputes the damage with the ability's element stripped, which is what
    // makes an affinity a *measurement* rather than a lookup: the player learns the Blade
    // Tyrant resists fire because the number they watched was half what it should have been.
    // Nothing here reads `def.affinities`, and that is the point -- reading it would hand
    // Normal mode exactly what `disclosure.affinities` exists to withhold.
    setBestiary(previous => {
      const bossId = def.bossId;
      const updated = observeBattle(previous[bossId] ?? emptyDiscovery(), batch, {
        bossId,
        elementOf: abilityId => def.abilities[abilityId]?.element,
        expectedFor: (abilityId, targetId) => {
          const ability = def.abilities[abilityId];
          const source = next.state.actors[input.actorId];
          const target = next.state.actors[targetId];
          if (!ability || !source || !target) return 0;
          if (ability.kind !== 'physical' && ability.kind !== 'magical') return 0;
          const {element: _dropped, ...withoutElement} = ability;
          try { return calculateDamage(def, source, target, withoutElement); }
          catch { return 0; }
        },
        ...(next.terminal ? {result: next.terminal} : {}),
      });
      const merged = {...previous, [bossId]: updated};
      saveBestiary(merged);
      return merged;
    });

    // The party is recorded only once the battle has concluded: the entry says "fought
    // alongside", and loading a screen is not that.
    if (next.terminal) {
      setRosterProgress(previous => {
        const merged = observeParty(previous, state.party, next.terminal!);
        saveRosterProgress(merged);
        return merged;
      });
    }
  }, [state, ledger, day, catalog, def, replay, names, maxHp, abilityNames]);

  /** Elemental affinities are decisive information — a fire-immune boss makes a fire-only
   * caster useless — and the player cannot infer them without spending a turn finding out.
   * Which is exactly why they belong to Easy: in Normal, spending that turn *is* the
   * fight. */
  const affinityNotes = useMemo(() => {
    if (!show.affinities) return [];
    const table = def.affinities?.[def.bossId] ?? {};
    return Object.entries(table)
      .filter(([, affinity]) => affinity && affinity !== 'neutral')
      .map(([element, affinity]) => ({element, affinity: affinity as string}));
  }, [def, show.affinities]);

  const offered = useMemo(() => {
    if (!actorId) return [];
    return availableActions(state, def, actorId).filter(o => o.enabled).map(option => {
      // Flag offensive abilities that would land for nothing against this boss. Easy only:
      // this is the affinity table restated per ability, so showing it in Normal would
      // hand over the same information the tags are withheld for. Not computed at all
      // there, which also keeps a dimmed menu item from leaking it without the label.
      const isOffensive = option.ability.kind === 'physical' || option.ability.kind === 'magical';
      let noEffect = false;
      if (show.noEffect && isOffensive && (option.ability.power ?? 0) > 0) {
        const actor = state.actors[actorId];
        const boss = state.actors[state.bossId];
        if (actor && boss) noEffect = calculateDamage(def, actor, boss, option.ability, state.tick) <= 0;
      }
      return {...option, noEffect};
    });
  }, [state, def, actorId, show.noEffect]);
  /** Offered actions bucketed by menu group, preserving the order availableActions gave
   * them. A group with nothing in it is simply absent, so the Brawler never sees a Magic
   * command it cannot use. */
  const grouped = useMemo(() => {
    const by = new Map<AbilityGroup, MenuOption[]>();
    for (const option of offered) {
      const list = by.get(option.group);
      if (list) list.push(option);
      else by.set(option.group, [option]);
    }
    return by;
  }, [offered]);

  // A new character gets its own menu from the top; leaving a stale submenu open would
  // show one hero's spells under another's name.
  useEffect(() => { setOpenGroup(null); }, [actorId]);

  const targets = useMemo(
    () => (selected && actorId ? eligibleTargets(state, actorId, selected.ability) : []),
    [selected, actorId, state],
  );
  const preview = useMemo(() => {
    if (!selected || !actorId) return null;
    // Normal withholds this entirely. Every line of it is read off the live fight state --
    // the exact damage against this boss, a status it would apply, the boss reacting by
    // announcing something new -- so it answers "what will this do" without the player
    // having to spend a turn finding out, which in Normal is the fight.
    if (!show.actionPreview) return null;
    try {
      const input = actionInput(state, actorId, selected.ability);
      return previewDisplay(state, def, input, previewAction(state, input, def));
    } catch {
      return null;
    }
  }, [selected, actorId, state, def, show.actionPreview]);

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
      // The record's own mode, not the current setting: the card must describe the attempt
      // that was recorded, which may have been a different day or a different choice.
      ...(record.mode ? {mode: record.mode} : {}),
      url: window.location.host || undefined,
    });
  }, [record, day, def]);

  if (STUDIO) {
    return (
      <main className="dbb-shell dbb-shell-wide">
        <BackgroundStudio
          initialId={backgroundForBoss(def.bossId)}
          onClose={() => { window.location.search = ''; }}
          onChange={() => { /* imports live in IndexedDB; the stage reads bundled art */ }}
        />
      </main>
    );
  }

  if (showCodex) {
    return (
      <Codex
        onClose={() => setShowCodex(false)}
        bestiary={bestiary}
        met={metHeroes(rosterProgress, state.party)}
        progress={rosterProgress}
      />
    );
  }

  // After the landing screen and before the battle. Unskippable by design; see VersusScreen.
  if (showVersus) {
    return (
      <VersusScreen
        boss={{id: def.bossId, name: names[def.bossId] ?? def.bossId}}
        party={state.party.map(id => ({id, name: names[id] ?? id}))}
        onDone={dismissVersus}
      />
    );
  }

  if (showLanding) {
    return (
      <main className="dbb-shell dbb-landing">
        {/* The banner replaces the text header rather than sitting above it: two titles is
          * one too many. Until the art exists the header stands alone, which is why this is
          * a flag rather than an <img> with an onError -- a 404 on every landing visit is
          * noise, and the fallback is the current screen rather than a broken image. */}
        {BANNER_SHIPPED ? (
          <h1 className="dbb-landing-banner">
            <img src={bannerUrl()} width={BANNER_WIDTH} height={BANNER_HEIGHT}
              alt="Daily Boss Battle" />
          </h1>
        ) : (
          <header className="dbb-header">
            <span className="dbb-brand">✦ DAILY BOSS BATTLE</span>
          </header>
        )}

        <section className="dbb-landing-card rpg-window">
          <p className="dbb-landing-day">{day}</p>
          <h1 className="dbb-landing-title">Today&rsquo;s battle</h1>
          <p className="dbb-landing-lede">
            One fight, the same for everyone, decided by choices rather than reflexes.
            {' '}Difficulty: <strong>{tier}</strong>.
          </p>

          <fieldset className="dbb-modes">
            <legend>Choose how much the interface tells you</legend>
            {(['easy', 'normal'] as const).map(option => (
              <label key={option} className={`dbb-mode${mode === option ? ' is-chosen' : ''}`}>
                <input
                  type="radio" name="dbb-mode" value={option}
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                <span className="dbb-mode-title">{MODE_BLURB[option].title}</span>
                <span className="dbb-mode-detail">{MODE_BLURB[option].detail}</span>
              </label>
            ))}
          </fieldset>

          <p className="dbb-landing-note">
            Both modes fight the same boss with the same party. Easy only shows you more;
            it does not weaken the fight. Your result records which one you chose.
          </p>

          <button className="dbb-begin" onClick={() => beginBattle(mode)}>
            Begin battle
          </button>

          {/* Held as state rather than a URL parameter on purpose: `battle-params.ts` makes
            * any parameter other than `?mode=` mark the attempt unranked, so a `?codex`
            * would have to be threaded through `isPresentationOnly` to avoid quietly costing
            * someone their ranked run. A linkable Codex can come later. */}
          <button type="button" className="dbb-codex-open" onClick={() => setShowCodex(true)}>
            Meet the heroes
          </button>

          {stats.completed > 0 && (
            <p className="dbb-landing-stats">
              {stats.completed} played · {stats.wins} won · {stats.participationStreak} day streak
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    // Capture phase, so the theme starts on the first touch even if a child stops the
    // event. Firing repeatedly is harmless: startAudio is idempotent.
    <main className="dbb-shell dbb-shell-battle" onPointerDownCapture={startAudio}>
      {unranked && (
        // Says so on screen, because an unverified pairing may well be unwinnable: the
        // pool covers 263 of the 1760 boss-and-party combinations, and the rest carry no
        // guarantee at all. Without this, an impossible fight reads as a balance bug.
        <div className="dbb-sandbox" role="status">
          SANDBOX · unranked, nothing recorded ·{' '}
          {def.actors[def.bossId]!.name} vs {state.party.map(id => names[id]).join(', ')}
          {CONFIG.sandbox && wantsCustomEncounter(CONFIG.sandbox)
            ? ' · not from the verified pool, so it may be unwinnable' : ''}
        </div>
      )}
      <header className="dbb-header">
        <span className="dbb-brand">✦ DAILY BOSS BATTLE</span>
        <span className="dbb-header-right">
          <span className="dbb-day">{day} · {tier} · {MODE_BLURB[mode].title}</span>
          <button
            className="dbb-mute"
            aria-label={mutedState ? 'Unmute' : 'Mute'}
            aria-pressed={mutedState}
            onClick={() => {
              unlockAudio();
              const next = !mutedState;
              setMuted(next);
              setMutedState(next);
              // Unmuting before the first action should still start the theme.
              if (!next && !audioStarted.current) {
                audioStarted.current = true;
                void playMusic('battle_main');
              }
            }}
          >{mutedState ? '🔇' : '🔊'}</button>
        </span>
      </header>

      <section className="dbb-boss rpg-window">
        <div className="dbb-boss-name">{def.actors[state.bossId]!.name}</div>
        <div className="dbb-boss-hp">
          {Math.round(displayedValue(script, state.bossId, timeMs, boss.hp)).toLocaleString()}
          {' / '}{boss.stats.hp.toLocaleString()}
        </div>
        {statusBadges(state.bossId)}
        {affinityNotes.length > 0 && (
          <div className="dbb-affinity">
            {affinityNotes.map(note => (
              <span key={note.element} className={`dbb-affinity-tag is-${note.affinity}`}>
                {note.element} {note.affinity}
              </span>
            ))}
          </div>
        )}
        {shownTelegraph && (
          <div className="dbb-telegraph">
            ▶ {abilityNames[shownTelegraph.countdown.abilityId] ?? shownTelegraph.countdown.abilityId}
            {' → '}
            {shownTelegraph.targetIds.map(id => names[id]).join(', ') || '—'}
            {shownTelegraph.countdown.impactIn !== undefined
              ? ` · impact in ${shownTelegraph.countdown.impactIn}`
              : shownTelegraph.countdown.readyIn === 0
                ? ' · now' : ` · ready in ${shownTelegraph.countdown.readyIn}`}
          </div>
        )}
      </section>

      <BattleStage state={state} script={script} timeMs={timeMs} idleMs={idleMs}
        roles={ROLE_BY_ID} sheets={sheets} abilityInfo={abilityInfo} effects={effects}
        backgroundFile={backgroundFile} disclosure={show} />

      <section className="dbb-party">
        {state.party.map(id => {
          const actor = state.actors[id]!;
          const shownHp = Math.round(displayedValue(script, id, timeMs, actor.hp));
          // Down according to playback, the same way the canvas decides it. Reading
          // actor.hp here dimmed the panel the moment an action was committed, ahead of
          // the attack that caused it.
          const down = downAt(script, id, timeMs, actor.hp);
          const shownMp = pending?.mp[id] ?? actor.mp;
          const shownMomentum = pending?.momentum[id] ?? actor.momentum;
          const ready = (pending ? pending.ready[id] : actor.ready) && !down;
          return (
            <div key={id} className={`dbb-hero rpg-window${ready ? ' is-ready' : ''}${down ? ' is-down' : ''}`}>
              <div className="dbb-hero-name">{names[id]}</div>
              <div className="dbb-meter"><i style={{width: `${(100 * shownHp) / actor.stats.hp}%`}} /></div>
              <div className="dbb-hero-numbers">
                <span>{shownHp}/{actor.stats.hp}</span>
                {actor.stats.mp > 0 && <span>MP {shownMp}</span>}
                {shownMomentum > 0 && <span>◆{shownMomentum}</span>}
              </div>
              {statusBadges(id)}
            </div>
          );
        })}
      </section>

      {/* Arrow keys to move, Enter to choose, Escape to back out -- the keyboard this genre
        * trained people to expect. Every entry is already a real <button>, so Tab and Enter
        * worked; what was missing was not having to press Tab nine times to reach the ninth
        * ability. Escape unwinds one level at a time, matching the on-screen Back. */}
      <section
        className="dbb-commands rpg-window"
        ref={commandRef}
        onKeyDown={event => {
          const consumed = handleMenuKey(event, commandRef.current, {
            onBack: selected ? () => setSelected(null)
              : openGroup ? () => setOpenGroup(null)
              : undefined,
          });
          // Only swallow what was acted on, so Tab, Enter and typing are untouched.
          if (consumed) event.preventDefault();
        }}
      >
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
              {/* The other place a player is plausibly curious about the roster: they have
                * just fought alongside three of them. */}
              <button className="rpg-menu-item" onClick={() => setShowCodex(true)}>Meet the heroes</button>
            </div>
            {cardInput && <ShareCard input={cardInput} />}
            <EmailSignup />
            <span className="dbb-hint">
              Results are stored in this browser only and are not server verified.
            </span>
          </div>
        )}

        {!showResult && phase.kind === 'choosing' && actorId && !selected && !openGroup && (
          <>
            <div className="dbb-prompt">{names[actorId]}</div>
            <ul className="rpg-menu-list">
              {ABILITY_GROUPS.filter(group => grouped.has(group)).map(group => {
                const options = grouped.get(group)!;
                const opensSubmenu = SUBMENU_GROUPS.includes(group);
                // Attack and Defend are single verbs: no submenu, straight to targeting.
                const only = opensSubmenu ? null : options[0]!;
                const usable = options.some(option => option.enabled);
                return (
                  <li key={group}>
                    <button
                      className={`rpg-menu-item${usable ? '' : ' is-unavailable'}`}
                      data-menu-item=""
                      disabled={!usable}
                      onClick={() => (only ? setSelected(only) : setOpenGroup(group))}
                    >
                      <span>{group}</span>
                      <span className="rpg-menu-cost">
                        {opensSubmenu
                          ? `${options.filter(o => o.enabled).length} ▸`
                          : only && only.ability.mpCost ? `${only.ability.mpCost} MP` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {!showResult && phase.kind === 'choosing' && actorId && !selected && openGroup && (
          <>
            <div className="dbb-prompt">{names[actorId]} · {openGroup}</div>
            <ul className="rpg-menu-list">
              {(grouped.get(openGroup) ?? []).map(option => (
                <li key={option.ability.id}>
                  <button
                    className={`rpg-menu-item${option.noEffect ? ' is-no-effect' : ''}` +
                      `${option.enabled ? '' : ' is-unavailable'}`}
                    disabled={!option.enabled}
                    data-menu-item=""
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
              <li>
                <button className="rpg-menu-item is-back" data-menu-item="" onClick={() => setOpenGroup(null)}>
                  <span>◂ Back</span>
                </button>
              </li>
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
                  data-menu-item=""
                  onClick={() => commit(actionInput(state, actorId, selected.ability, targetId))}
                >
                  {selected.ability.target.startsWith('all_') ? 'Confirm' : names[targetId!]}
                </button>
              ))}
              <button className="rpg-menu-back" data-menu-item="" onClick={() => setSelected(null)}>Back</button>
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
            {/* Separate from "Reset day" on purpose: the bestiary accumulates across days,
              * so wiping it has to be a deliberate act rather than a side effect of
              * replaying a fight. */}
            <button onClick={() => { clearBestiary(); window.location.reload(); }}>Forget bestiary</button>
            <button onClick={() => { clearRosterProgress(); window.location.reload(); }}>Forget heroes</button>
          </div>
          <div className="dbb-dev-hint">
            Phase {state.phase} · transition at {def.bossProgram.transitionPercent}% ·
            {' '}attack from just above it to see the flash-and-hold ·
            {' '}stars {stars} · speed {SPEED}x · {record?.completed ? 'recorded' : 'in progress'}
            {replay ? ' · unranked replay' : ''}
          </div>
        </section>
      )}

      {/* The stage is a <canvas>, so a screen reader perceives nothing of the fight at all.
        * This list is the entire accessible account of it, which is why it is a live region
        * rather than decoration. `polite` because a battle produces several lines at once
        * and `assertive` would interrupt the reader mid-sentence on every one of them. */}
      <section className="dbb-log" aria-live="polite" aria-label="Battle log">
        {log.map((line, index) => <div key={index} className="dbb-log-line">{line}</div>)}
      </section>
    </main>
  );
}

/** A fresh battle with the URL's requested opening state already applied.
 *
 * Built from the same primitives as the `?dev` buttons, so a state reachable by clicking
 * is also reachable by link -- which is what makes it shareable and bookmarkable, and
 * testable on a phone where there is no console. */
function seededBattle(def: EncounterDefinition): BattleStep {
  const step = freshBattle(createEncounter(def), def);
  const request = CONFIG.sandbox;
  if (!request || !seedsOpeningState(request)) return step;
  // The rule itself lives in src/battle-params.ts, where it is unit-tested -- notably that
  // `phase=2` parks the boss just above its threshold so the next hit triggers the
  // transition, rather than below it where the transition would never fire.
  return {...step, state: applyOpeningState(step.state, request, def.bossProgram.transitionPercent)};
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
