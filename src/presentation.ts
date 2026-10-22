/** Battle choreography: turns the engine's event stream into a timed script of
 * presentation beats.
 *
 * The engine resolves an action instantly; a 16-bit JRPG does not. This module owns
 * the pacing that makes a turn feel weighty — the step forward, the hit flash, the
 * damage number, the HP bar draining over time, the full stop when a boss changes
 * phase. It is the difference between a spreadsheet and a battle.
 *
 * Deliberately renderer-agnostic and free of DOM, canvas, audio and timers: it emits
 * *what* to show and *when*, and a renderer decides *how*. The same script drives a
 * canvas stage, a React Native view, or the terminal client. Pure and deterministic,
 * so choreography is unit-testable rather than eyeballed.
 */
import type {ActorId, BattleEvent, StatusId} from './types.js';

export type BeatKind =
  | 'approach'       // actor slides out to striking distance
  | 'strike'         // the action itself, held at full extension
  | 'retreat'        // actor slides back to its slot
  | 'cast'           // spell/channel wind-up
  | 'impact'         // the moment of contact; renderers flash and play the hit sound
  | 'hurt'           // the target's reaction, which outlasts the flash
  | 'damage_number'  // floating number above a target
  | 'heal_number'
  | 'hp_change'      // tween a health bar between two values
  | 'mp_change'
  | 'shake'          // screen shake, intensity scaled to the hit
  | 'flash'          // full-screen flash
  | 'ko'             // actor collapses
  | 'revive'
  | 'status_on'
  | 'status_off'
  | 'message'        // typed text in the log window
  | 'telegraph'      // boss announces its next action
  | 'phase'          // boss phase transition: the big dramatic stop
  | 'hold'           // deliberate silence
  | 'victory'
  | 'defeat';

export type Beat = {
  /** Milliseconds from the start of this batch. */
  at: number;
  /** How long the beat runs. Zero-length beats are instantaneous cues. */
  duration: number;
  kind: BeatKind;
  actorId?: ActorId;
  targetId?: ActorId;
  /** The ability that produced this beat, where the source event carried one. Lets the
   * effects layer and a renderer choose per-ability visuals. */
  abilityId?: string;
  /** Which status a status_on / status_off beat concerns. */
  status?: StatusId;
  /** Set on the impact and damage_number of a critical hit, so the renderer can announce
   * it. A number twice the size of the last one with nothing to explain it reads as a
   * bug, which is the same complaint unexplained misses drew. */
  critical?: boolean;
  amount?: number;
  /** Health/mana tween endpoints, so a renderer needs no extra state. */
  from?: number;
  to?: number;
  /** 0..1, for shake and flash strength. */
  intensity?: number;
  text?: string;
  /** Source event type, for renderers that want to special-case specific effects. */
  source?: string;
};

export type BeatScript = {beats: Beat[]; totalMs: number};

/** Global pace dial. 1 means the table below is in real milliseconds.
 *
 * It was 2 for a while, doubling a table tuned at half these numbers. The four action
 * phases are now specified directly as the sequence a player should be able to count, so
 * the indirection stopped paying for itself and every value here is literal. `?speed=`
 * still scales playback at runtime for comparison. */
export const PACE = 1;

/** Single place to tune the feel of the whole game. Milliseconds, literal. */
export const TIMING = {
  // --- the action sequence ---------------------------------------------------------
  // One action reads as four equal phases, in this order, so it is followable rather
  // than simultaneous. Previously the walk and the swing were the *same* beat and the
  // damage arrived during the swing, which is why nothing had an apparent order.
  /** Acting character slides from its slot to striking distance. */
  approach: 500,
  /** The attack, cast or item clip plays, held at full extension. Contact lands inside.
   *
   * Longer than the phases either side of it on purpose: this is the beat carrying the
   * animation the player wants to watch, where approach and retreat are just travel. At
   * 750 an eight-frame clip runs at 94ms a frame instead of 62, which is close to a
   * hand-animated cadence rather than a flick. */
  strike: 750,
  /** Slides back to its slot. */
  retreat: 500,
  /** Only now do the damage numbers rise and the health bars drain. */
  indicator: 500,

  // --- within those phases ---------------------------------------------------------
  /** The hit flash. Deliberately short and sharp, inside the strike. */
  impact: 180,
  /** The target's reaction. Separate from the flash: a recoil needs time to register,
   * where a flash should not linger. */
  hurtReact: 400,
  /** Successive hits of a multi-hit ability, and successive targets of a sweep. Small
   * enough that four of them still fit inside one strike phase. */
  multiHitStagger: 80,
  /** How long a damage number stays up. Matches the indicator phase it belongs to. */
  damageNumberHold: 500,
  /** Health bars drain rather than snap, within the indicator phase. */
  hpTween: 450,
  mpTween: 520,

  // --- everything else -------------------------------------------------------------
  castWindUp: 1120,
  koCollapse: 1440,
  statusPopup: 600,
  /** A boss phase change stops everything. */
  phaseHold: 1800,
  telegraph: 840,
  victoryHold: 2400,
  defeatHold: 2800,
  /** Gap between two separate actors acting in the same batch. */
  betweenActors: 400,
  /** Characters per second for typed message text. */
  textCharsPerSecond: 21,
  /** Floor so one-character messages are still readable. */
  minMessage: 440,
} as const;

/** The full span of one action, approach through indicator. */
export const ACTION_MS =
  TIMING.approach + TIMING.strike + TIMING.retreat + TIMING.indicator;

export type ChoreographOptions = {
  /** Playback multiplier. 2 means twice as fast; used for hold-to-skip. */
  speed?: number;
  /** Max HP per actor, so damage can be scaled to a fraction for shake intensity. */
  maxHp?: Record<ActorId, number>;
  /** Display names for message text. */
  names?: Record<ActorId, string>;
  /** Ability display names, keyed by id. */
  abilityNames?: Record<string, string>;
  /** Drop message beats; useful for a renderer with its own log. */
  silent?: boolean;
};

const nameOf = (id: ActorId | undefined, opts: ChoreographOptions): string =>
  (id && opts.names?.[id]) ?? id ?? 'Someone';
const abilityOf = (id: string | undefined, opts: ChoreographOptions): string =>
  (id && opts.abilityNames?.[id]) ?? id ?? 'an ability';

/** Shake intensity from damage as a fraction of the target's max HP, so a big hit
 * reads as big regardless of the absolute numbers in play. */
function shakeIntensity(amount: number, maxHp: number | undefined): number {
  if (!amount) return 0;
  const fraction = maxHp && maxHp > 0 ? amount / maxHp : 0.1;
  // Cube-root curve: small hits still register, large hits saturate.
  return Math.min(1, Math.max(0.12, Math.cbrt(fraction) * 1.1));
}

const messageDuration = (text: string): number =>
  Math.max(TIMING.minMessage, Math.round((1000 * text.length) / TIMING.textCharsPerSecond));

/**
 * Builds the beat script for one batch of events — typically the events produced by
 * a single player action, including everything the boss did in response.
 */
export function choreograph(events: readonly BattleEvent[], options: ChoreographOptions = {}): BeatScript {
  const opts = options;
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const beats: Beat[] = [];
  let cursor = 0;
  let lastActor: ActorId | undefined;
  /** Running HP per actor so hp_change beats carry both endpoints. */
  const hp = new Map<ActorId, number>();
  /** A run of consecutive damage events is staggered from a shared base time, so the
   * hits of a multi-hit ability land in quick succession with overlapping tweens. */
  let consecutiveHits = 0;
  /** Where the current action's strike phase begins, and where its indicator phase does.
   * Damage lands inside the former; its numbers and bar drain belong to the latter. */
  let strikeAt = 0;
  let indicatorAt = 0;

  const push = (beat: Omit<Beat, 'at'>, at = cursor): Beat => {
    const entry: Beat = {...beat, at};
    beats.push(entry);
    return entry;
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const actor = event.actorId;
    const target = event.targetId;
    const next = events[index + 1];

    // A new actor taking the stage gets a beat of separation and a step forward.
    //
    // `channel_resolved` counts. It is a channelled ability *landing* -- the boss's
    // telegraphed attack arriving, or a lancer coming down from a jump -- which is an
    // actor acting, not bookkeeping. Leaving it out was a real bug: see the case below.
    const isActorAction = event.type === 'action_committed'
      || event.type === 'channel_started'
      || event.type === 'channel_resolved';
    if (isActorAction && actor !== lastActor) {
      cursor += lastActor === undefined ? 0 : TIMING.betweenActors;
      lastActor = actor;
      consecutiveHits = 0;
    }

    switch (event.type) {
      // A channelled ability landing is choreographed exactly like a committed action, and
      // for the same reason: the damage has to sit inside a strike phase of its own.
      //
      // Treating it as bookkeeping was a bug with teeth. `strikeAt` and `indicatorAt` only
      // move on an actor action, so a resolution inherited whichever hero had just swung:
      // the boss's channelled sweep landed at 750ms and 830ms, *inside* the hero's own
      // strike, every damage number in the batch stacked up at 1500ms, and the boss played
      // no strike clip at all because no beat said it was acting. It read as the boss
      // countering simultaneously -- which is exactly what it was doing.
      case 'channel_resolved':
      case 'action_committed': {
        // Committing a *channelled* ability is presented by its wind-up alone. The engine
        // emits `channel_started` immediately after the commit, so without this the actor
        // walked out, swung, and walked back while nothing landed -- 1500ms of pantomime
        // that reads as a missed attack -- and only then began to channel. The cast beat
        // that follows is the honest presentation of committing to a channel.
        if (event.type === 'action_committed'
          && next?.type === 'channel_started' && next.actorId === actor) break;

        // Three beats, not one. Each carries the ability so the renderer can pick a clip
        // by what is being done: without it a spell and a potion are indistinguishable
        // from a swing.
        push({duration: TIMING.approach, kind: 'approach', actorId: actor,
          abilityId: event.abilityId, source: event.type});
        strikeAt = cursor + TIMING.approach;
        push({duration: TIMING.strike, kind: 'strike', actorId: actor,
          abilityId: event.abilityId, source: event.type}, strikeAt);
        push({duration: TIMING.retreat, kind: 'retreat', actorId: actor,
          abilityId: event.abilityId, source: event.type}, strikeAt + TIMING.strike);
        indicatorAt = strikeAt + TIMING.strike + TIMING.retreat;
        cursor = indicatorAt;
        break;
      }
      case 'channel_started': {
        push({duration: TIMING.castWindUp, kind: 'cast', actorId: actor,
          abilityId: event.abilityId,
          text: `${nameOf(actor, opts)} begins ${abilityOf(event.abilityId, opts)}`, source: event.type});
        cursor += TIMING.castWindUp;
        break;
      }
      case 'damage': {
        // Contact sits a little past the middle of the strike, so the clip has visibly
        // committed before anything is taken off. Successive hits -- a multi-hit ability,
        // or the several targets of a sweep -- stagger from there and still fit inside it.
        const stagger = consecutiveHits * TIMING.multiHitStagger;
        const at = strikeAt + Math.round(TIMING.strike * 0.5) + stagger;
        // Numbers and the bar drain wait for the indicator phase, after the retreat, so
        // the four phases stay separable instead of overlapping into one blur.
        const shownAt = indicatorAt + stagger;
        const amount = event.amount ?? 0;
        const before = hp.get(target ?? '') ?? (event.hpAfter ?? 0) + amount;
        push({duration: TIMING.impact, kind: 'impact', actorId: actor, targetId: target,
          abilityId: event.abilityId, source: event.type,
          ...(event.critical ? {critical: true} : {})}, at);
        push({duration: TIMING.hurtReact, kind: 'hurt', targetId: target,
          abilityId: event.abilityId, source: event.type}, at);
        push({duration: TIMING.damageNumberHold, kind: 'damage_number', targetId: target,
          amount, abilityId: event.abilityId, source: event.type,
          ...(event.critical ? {critical: true} : {})}, shownAt);
        push({duration: TIMING.hpTween, kind: 'hp_change', targetId: target,
          from: before, to: event.hpAfter ?? Math.max(0, before - amount), amount,
          source: event.type}, shownAt);
        const intensity = shakeIntensity(amount, opts.maxHp?.[target ?? '']);
        if (intensity > 0) {
          push({duration: Math.round(120 + 180 * intensity), kind: 'shake', intensity,
            targetId: target, source: event.type}, at + TIMING.impact);
        }
        if (event.hpAfter !== undefined) hp.set(target ?? '', event.hpAfter);
        consecutiveHits++;
        // The action ends when its indicator phase does, so the next actor does not begin
        // while this one's numbers are still on screen.
        cursor = Math.max(cursor, shownAt + TIMING.damageNumberHold,
          shownAt + TIMING.hpTween, at + TIMING.hurtReact);
        break;
      }
      case 'heal': {
        consecutiveHits = 0;
        const amount = event.amount ?? 0;
        const before = hp.get(target ?? '') ?? (event.hpAfter ?? 0) - amount;
        push({duration: TIMING.damageNumberHold, kind: 'heal_number', targetId: target, amount,
          source: event.type});
        push({duration: TIMING.hpTween, kind: 'hp_change', targetId: target,
          from: before, to: event.hpAfter ?? before + amount, amount, source: event.type});
        if (event.hpAfter !== undefined) hp.set(target ?? '', event.hpAfter);
        cursor += TIMING.hpTween;
        break;
      }
      case 'mp_restored': {
        consecutiveHits = 0;
        push({duration: TIMING.mpTween, kind: 'mp_change', targetId: target,
          amount: event.amount ?? 0, source: event.type});
        cursor += TIMING.mpTween;
        break;
      }
      case 'ko': {
        consecutiveHits = 0;
        push({duration: TIMING.koCollapse, kind: 'ko', actorId: actor,
          text: `${nameOf(actor, opts)} is down`, source: event.type});
        cursor += TIMING.koCollapse;
        break;
      }
      case 'revived': {
        consecutiveHits = 0;
        push({duration: TIMING.koCollapse, kind: 'revive', targetId: target,
          text: `${nameOf(target, opts)} revives`, source: event.type});
        cursor += TIMING.koCollapse;
        break;
      }
      case 'status_applied': {
        consecutiveHits = 0;
        push({duration: TIMING.statusPopup, kind: 'status_on', actorId: actor,
          status: event.status, text: event.details, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'status_expired':
      case 'status_removed': {
        push({duration: TIMING.statusPopup, kind: 'status_off', actorId: actor ?? target,
          status: event.status, text: event.details, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'phase_change': {
        consecutiveHits = 0;
        // The dramatic stop: flash, hold, then resume. Renderers swap the music here.
        push({duration: TIMING.impact, kind: 'flash', intensity: 1, source: event.type});
        push({duration: TIMING.phaseHold, kind: 'phase', actorId: actor,
          text: `${nameOf(actor, opts)} changes form`, source: event.type}, cursor + TIMING.impact);
        cursor += TIMING.impact + TIMING.phaseHold;
        lastActor = undefined;
        break;
      }
      case 'boss_intent': {
        consecutiveHits = 0;
        push({duration: TIMING.telegraph, kind: 'telegraph', actorId: actor,
          text: `${nameOf(actor, opts)} readies ${abilityOf(event.abilityId, opts)}`, source: event.type});
        cursor += TIMING.telegraph;
        break;
      }
      case 'victory': {
        push({duration: TIMING.victoryHold, kind: 'victory', text: 'Victory', source: event.type});
        cursor += TIMING.victoryHold;
        break;
      }
      case 'defeat': {
        push({duration: TIMING.defeatHold, kind: 'defeat', text: 'Defeat', source: event.type});
        cursor += TIMING.defeatHold;
        break;
      }
      case 'poison_pulse': {
        consecutiveHits = 0;
        const amount = event.amount ?? 0;
        // Poison is damage, so it gets the same impact and reaction treatment as a hit;
        // without these it landed silently and without a flash.
        push({duration: TIMING.impact, kind: 'impact', targetId: actor, source: event.type});
        push({duration: TIMING.hurtReact, kind: 'hurt', targetId: actor, source: event.type});
        push({duration: TIMING.damageNumberHold, kind: 'damage_number', targetId: actor, amount,
          source: event.type}, cursor + TIMING.impact);
        push({duration: TIMING.hpTween, kind: 'hp_change', targetId: actor,
          from: (event.hpAfter ?? 0) + amount, to: event.hpAfter ?? 0, amount, source: event.type});
        cursor += TIMING.hpTween;
        break;
      }
      case 'boss_interrupted': {
        consecutiveHits = 0;
        push({duration: TIMING.impact, kind: 'flash', intensity: 0.7, source: event.type});
        push({duration: TIMING.statusPopup, kind: 'message',
          text: `${nameOf(target, opts)}'s cast is interrupted`, source: event.type}, cursor + TIMING.impact);
        cursor += TIMING.impact + TIMING.statusPopup;
        break;
      }
      case 'cover_redirect': {
        consecutiveHits = 0;
        push({duration: TIMING.statusPopup, kind: 'message',
          text: `${nameOf(actor, opts)} covers ${nameOf(target, opts)}`, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'nullify_absorb': {
        consecutiveHits = 0;
        push({duration: TIMING.statusPopup, kind: 'message',
          text: `${nameOf(actor, opts)} nullifies the spell`, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'fizzle': {
        consecutiveHits = 0;
        push({duration: TIMING.statusPopup, kind: 'message', text: 'No effect', source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      // Two outcomes that had no presentation at all, so the turn they happened on looked
      // like nothing happened. Both are results, so both announce in either mode.
      case 'steal_success': {
        consecutiveHits = 0;
        // The item is in `details`; without this the Thief's whole reason for existing
        // resolved in silence, with only an inventory count moving to show for it.
        push({duration: TIMING.statusPopup, kind: 'message',
          text: `${nameOf(actor, opts)} steals ${event.details ?? 'an item'}`,
          source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'boss_fallback': {
        consecutiveHits = 0;
        // The boss could not afford what it had planned and substituted something else. A
        // player who had read the telegraph watched a different attack arrive with no
        // explanation; in Normal, where no telegraph was read, the boss merely did something
        // weaker for no visible reason.
        push({duration: TIMING.statusPopup, kind: 'message',
          text: `${nameOf(actor, opts)} cannot muster its attack`, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      default:
        // Bookkeeping events (ready, momentum, counter queues) carry no presentation of
        // their own; their consequences arrive as their own events. `channel_resolved`
        // used to be listed here and is handled above: it is an actor acting, and the
        // damage it carries needs a strike phase of its own to land in.
        break;
    }
  }

  // Message beats are optional so a renderer with its own log can suppress them.
  const kept = opts.silent ? beats.filter(b => b.kind !== 'message') : beats;

  // Typed text needs enough time to actually read.
  for (const beat of kept) {
    if (beat.text && (beat.kind === 'message' || beat.kind === 'telegraph' || beat.kind === 'phase')) {
      beat.duration = Math.max(beat.duration, messageDuration(beat.text));
    }
  }

  const scaled = kept
    .map(b => ({...b, at: Math.round(b.at / speed), duration: Math.round(b.duration / speed)}))
    .sort((a, b) => a.at - b.at || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const totalMs = scaled.reduce((end, b) => Math.max(end, b.at + b.duration), 0);
  return {beats: scaled, totalMs};
}

/** Stable ordering for beats that share a timestamp, so playback is deterministic
 * and a flash never lands after the shake it belongs to. */
const KIND_ORDER: BeatKind[] = [
  'approach', 'strike', 'retreat', 'cast', 'telegraph', 'impact', 'hurt', 'flash', 'shake',
  'damage_number', 'heal_number', 'hp_change', 'mp_change',
  'status_on', 'status_off', 'ko', 'revive', 'message', 'phase', 'hold', 'victory', 'defeat',
];

/** Beats active at a given playback time. The core query for a render loop. */
export function beatsAt(script: BeatScript, timeMs: number): Beat[] {
  return script.beats.filter(b => timeMs >= b.at && timeMs < b.at + b.duration);
}

/** Interpolated value for a tween beat at a playback time, eased so bars decelerate. */
export function tweenValue(beat: Beat, timeMs: number): number {
  if (beat.from === undefined || beat.to === undefined) return beat.to ?? 0;
  if (beat.duration <= 0) return beat.to;
  const raw = Math.min(1, Math.max(0, (timeMs - beat.at) / beat.duration));
  const eased = 1 - (1 - raw) ** 3;
  return beat.from + (beat.to - beat.from) * eased;
}
