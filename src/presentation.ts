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
import type {ActorId, BattleEvent} from './types.js';

export type BeatKind =
  | 'actor_step'     // actor moves forward to act
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

/** Single place to tune the feel of the whole game. Milliseconds. */
export const TIMING = {
  /** An attack clip is fitted to this, so it also sets the animation's frame rate:
   * four frames across 320ms is 80ms each, which reads. At 180ms it did not. */
  actorStep: 320,
  castWindUp: 560,
  /** The hit flash only. Deliberately short and sharp. */
  impact: 110,
  /** The target's reaction. Separate from the flash: a recoil needs time to register,
   * where a flash should not linger. */
  hurtReact: 240,
  damageNumberHold: 750,
  /** Health bars drain rather than snap; this is most of the perceived weight. */
  hpTween: 480,
  mpTween: 260,
  /** Consecutive hits of a multi-hit ability. */
  multiHitStagger: 150,
  koCollapse: 720,
  statusPopup: 300,
  /** A boss phase change stops everything. */
  phaseHold: 900,
  telegraph: 420,
  victoryHold: 1200,
  defeatHold: 1400,
  /** Gap between two separate actors acting in the same batch. */
  betweenActors: 200,
  /** Characters per second for typed message text. */
  textCharsPerSecond: 42,
  /** Floor so one-character messages are still readable. */
  minMessage: 220,
} as const;

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
  let hitRunBase = 0;

  const push = (beat: Omit<Beat, 'at'>, at = cursor): Beat => {
    const entry: Beat = {...beat, at};
    beats.push(entry);
    return entry;
  };

  for (const event of events) {
    const actor = event.actorId;
    const target = event.targetId;

    // A new actor taking the stage gets a beat of separation and a step forward.
    const isActorAction = event.type === 'action_committed' || event.type === 'channel_started';
    if (isActorAction && actor !== lastActor) {
      cursor += lastActor === undefined ? 0 : TIMING.betweenActors;
      lastActor = actor;
      consecutiveHits = 0;
    }

    switch (event.type) {
      case 'action_committed': {
        // Carries the ability so the renderer can pick a clip by what is being done. A
        // step beat without it leaves a spell and a potion indistinguishable from a swing.
        push({duration: TIMING.actorStep, kind: 'actor_step', actorId: actor,
          abilityId: event.abilityId, source: event.type});
        cursor += TIMING.actorStep;
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
        if (consecutiveHits === 0) hitRunBase = cursor;
        const at = hitRunBase + consecutiveHits * TIMING.multiHitStagger;
        const amount = event.amount ?? 0;
        const before = hp.get(target ?? '') ?? (event.hpAfter ?? 0) + amount;
        push({duration: TIMING.impact, kind: 'impact', actorId: actor, targetId: target,
          abilityId: event.abilityId, source: event.type}, at);
        push({duration: TIMING.hurtReact, kind: 'hurt', targetId: target,
          abilityId: event.abilityId, source: event.type}, at);
        push({duration: TIMING.damageNumberHold, kind: 'damage_number', targetId: target,
          amount, abilityId: event.abilityId, source: event.type}, at + TIMING.impact);
        push({duration: TIMING.hpTween, kind: 'hp_change', targetId: target,
          from: before, to: event.hpAfter ?? Math.max(0, before - amount), amount,
          source: event.type}, at + TIMING.impact);
        const intensity = shakeIntensity(amount, opts.maxHp?.[target ?? '']);
        if (intensity > 0) {
          push({duration: Math.round(120 + 180 * intensity), kind: 'shake', intensity,
            targetId: target, source: event.type}, at + TIMING.impact);
        }
        if (event.hpAfter !== undefined) hp.set(target ?? '', event.hpAfter);
        consecutiveHits++;
        cursor = Math.max(cursor, at + TIMING.impact + TIMING.hpTween, at + TIMING.hurtReact);
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
          text: event.details, source: event.type});
        cursor += TIMING.statusPopup;
        break;
      }
      case 'status_expired':
      case 'status_removed': {
        push({duration: TIMING.statusPopup, kind: 'status_off', actorId: actor ?? target,
          text: event.details, source: event.type});
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
        push({duration: TIMING.actorStep, kind: 'message',
          text: `${nameOf(actor, opts)} covers ${nameOf(target, opts)}`, source: event.type});
        cursor += TIMING.actorStep;
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
      default:
        // Bookkeeping events (ready, momentum, counters, channel_resolved) carry no
        // presentation of their own; their consequences arrive as their own events.
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
  'actor_step', 'cast', 'telegraph', 'impact', 'hurt', 'flash', 'shake',
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
