# Daily Boss Battle — Backlog

Proposed work, not yet committed to. Each entry records what was *measured* at the time it
was raised, so the next person to pick it up argues with evidence rather than re-deriving
it. Measurements are dated because content changes invalidate them.

Items are not in priority order. Where an entry says a number, it was read off the code or
a tool, not estimated.

---

## 1. Make phase two actually harder

**Raised 2026-10-22.** The complaint was "right now only the music changes, nothing else."

That is not quite true, and the truth is worse. Phase two already swaps the boss's entire
ability script -- `engine.ts:322-326` reads `phaseTwo`/`phaseTwoRepeat` as sequences
separate from `phaseOne`/`phaseOneRepeat` -- but the swap frequently makes the boss
*weaker*.

Expected power delivered per boss action, as `power x targets hit` against a three-hero
party, averaged over each phase's full script including its repeat tail:

| Boss | Phase 1 | Phase 2 | Change |
| --- | --- | --- | --- |
| `ink_lurker` | 123 | 240 | **+95%** |
| `mad_harlequin` | 86 | 147 | **+70%** |
| `storm_keeper` | 365 | 447 | +22% |
| `crush_wall` | 222 | 228 | +3% |
| `clockwork_emperor` | 440 | 450 | +2% |
| `blade_tyrant` | 230 | 220 | −5% |
| `tide_maw` | 309 | 287 | −7% |
| `spell_weaver` | 165 | 140 | **−15%** |

Only three of eight escalate meaningfully. The Blade Tyrant getting *weaker* is the likely
source of the original impression, because all three historical Blade Tyrant rulesets share
that encounter, making it the most-played fight in the game.

Raw ability power actually falls on seven of eight bosses, by up to 39%; rising AoE share is
what rescues the total. Phase two also uses *more* delayed abilities on several bosses, and
a delay grants reaction time, so phase two can legitimately feel calmer rather than merely
flat.

### Levers, cheapest first

1. **Rewrite the three regressive phase-two scripts.** Content only, no engine change. Worth
   doing regardless of what else is decided: a phase transition that reduces pressure is a
   bug in the content, not a balance preference.
2. **Make enrage phase-triggered.** `EnrageConfig` is already implemented, tested and
   applied in `harm()` as a flat outgoing-damage scale before the final floor -- but it keys
   on **tick, not phase**, and only `clockwork_emperor` and `mad_harlequin` have a curve at
   all. The other six bosses have none. Letting it trigger on the phase change is a small
   engine change that makes the transition mean something on every boss.
3. **Phase-two stat changes, especially speed.** `BossProgram` holds only the four ability
   lists and `transitionPercent`; there is no phase-based stat change of any kind. Speed is
   the strongest difficulty lever available because it is turn *frequency*, and it is
   entirely untouched. This is the largest change of the three: a new field plus engine
   handling.

### On the "requires a character rebalance" question

Do not guess at this -- the verified pool answers it empirically. Any content change
invalidates `contentHash()`, so the pool rebuilds and re-verifies every entry through the
seven gates. Baseline on 2026-10-22, from `npm run pool:check`:

```
passing entries 319
bosses covered  8/8
tiers           approachable 118  standard 133  punishing 68
daily probe     403/403 days playable
```

Make phase two harder, rebuild, and compare. If those numbers hold, the characters need
nothing. If the pool collapses, the gates name the boss and the gate that failed, which is
far better evidence than intuition -- and the failure *shape* matters: `punishing` falling
from 68 to 5 is a different problem from `approachable` falling to zero.

Suggested order: fix the three regressive scripts, rebuild and compare; then phase-triggered
enrage, rebuild and compare; then consider speed. Rebuilding after each step is what makes
any loss attributable.

---

## 2. Hard mode with true ATB

**Raised 2026-10-22.** Decided at the time: hard mode would carry **no winnability
guarantee**. That removes the only blocking objection, because the guarantee cannot survive
time pressure in any form.

Today the game is turn-based with an ATB *turn order* -- "wait mode" in Final Fantasy terms.
`drive()` in `engine.ts:429` advances ticks until a living hero's gauge fills, then returns
and stops dead. No wall clock is consulted anywhere in the engine; the only timers in the UI
drive animation playback, the music transition and a midnight check.

### What it would take

The engine is the easy part:

1. **A function to let time pass while a hero waits.** `drive` minus its hero-ready early
   return: the boss acts when its gauge fills, `tickOnce` continues to handle poison pulses
   and status expiry. It reuses the existing primitives entirely.
2. **A tick on `BattleInput`.** Today it is `{actorId, abilityId, targetIds}` and `replay`
   depends on the engine halting at identical points. Recording the tick an action landed on
   makes a run exactly replayable again. The concept already exists -- `solver.ts` tracks
   `actionTicks` beside every witness line.
3. **`'hard'` in `BattleMode`.** `disclosure.ts` is a *total* record, so the compiler refuses
   to build until a position is stated on all five disclosure fields.

Determinism is **not** threatened, which is the counter-intuitive part. The engine stays
pure: the same `(tick, action)` sequence yields an identical result. The only
non-determinism is *which* tick the input lands on, and recording it removes that.

### Ranked or unranked decides most of the cost

A complete unranked path already exists -- `web/src/DailyBattle.tsx:174` threads `unranked`
through and the ledger is never written. Replays and URL-overridden battles use it today.

- **Unranked** drops item 2 entirely: nothing is replayed, so nothing needs verifying, no
  `DailyRecord` change, no star semantics to decide, and `mode` stays presentation-only in
  the recorded sense.
- **Ranked** adds back the log format change, replay honouring ticks, and a product decision
  about awarding stars for a fight nothing proves winnable.

Roughly the difference between a weekend and a week and a half.

### The parts that are actually hard

**The presentation model, not the engine.** A decision currently produces a *batch* of
events choreographed into a 2250ms cinematic with input blocked (`phase: 'playing'`,
`DailyBattle.tsx:517`). True ATB needs animation and input to coexist, since the player
cannot be frozen for 2.25s per action while the boss's gauge fills. That means a real-time
tick pump, animating gauges, and handling input that arrives mid-resolution. It is more work
than every engine change combined.

**Tuning.** The pool contains only encounters verified winnable in *wait* mode, tuned to be
exactly winnable with unlimited thinking time. Under a clock some will not be merely hard
but flatly impossible, in a way that reads as broken rather than brutal. If hard mode is
meant to be beatable, it wants its own tuning pass -- a solver and balance question, and
probably the largest piece of real work in the whole idea.

Without the winnability guarantee, hard mode is also no longer restricted to the clock: boss
speed, HP and extra phases are all available, none of which could be touched while the gates
applied. Timing may not even be the most interesting lever.

**Recommendation: start unranked.** The feel is reachable in a weekend, it answers whether
real-time ATB is fun inside a 2250ms choreography, and nothing about the daily record or the
verification story has to change while finding out.

---

## 3. Page weight

**Raised 2026-10-22.** Needs `ffmpeg`, which the Linux dev box does not have.

`battle_theme.ogg` is 1220 KiB at 167 kbps and is fetched **before the first battle can
start**; `battle_theme_phase_2.ogg` is 1213 KiB at 166 kbps. Re-encoding both at q4 saves
roughly 1.2 MB. `npm run audio:check` prints the exact commands.

The original six sound effects are also stereo at 144-213 kbps for material that is
monophonic anyway -- 149 KiB where the nine added later cost 58 KiB in total. Re-encoding
them mono at q4 saves about 100 KiB. Every sound effect is fetched on page load.

Do this **before** commissioning per-boss music, so sixteen tracks are encoded correctly the
first time rather than shipping ~19 MB.

---

## 4. Per-boss music

**Raised 2026-10-21.** All sixteen prompts have been supplied (two per boss: a theme and a
phase-two variant).

Needs the code change first. `MusicTrack` is a closed union -- `'battle_main' |
'battle_phase_two' | 'victory' | 'defeat' | 'silence'` -- and `TRACK_PLAYBACK` maps those to
fixed filenames. There is no path from a boss id to a theme. Until that exists there is
nowhere to put sixteen tracks.

---

## 5. Three features that ship but can never run

Each is a few lines to either wire up or formally retire. Listed together because they share
a shape: declared, reachable-looking, and dead.

- **Boss `victory` clips.** `animation.ts` gates victory on `id !== state.bossId`, so the
  boss is structurally excluded. All eight boss sheets declare the clip. Suggestion: retire
  it -- a boss celebrating the player's win is odd.
- **`flare_dark`.** `Element` includes `dark`, but no ability in the roster, the reference
  set or any of the eight bosses uses it, so the art could never be drawn. Declared in the
  effect manifest and deliberately unshipped.
- **`text_blip`.** `soundCues` only emits it when `options.textBlips` is true, and nothing in
  the app sets that flag -- it exists only as a type declaration. The sound ships and is
  prefetched. Enabling typing blips is a one-line change.

Related nit: the timing notes say text types at 21 chars/sec, but `blipIntervalMs` defaults
to 55ms, which is 18.2. Only matters if blips are enabled.

---

## 6. Hero sprite scale is inconsistent

**Raised 2026-10-22.** The Lancer was fixed; the cause is general.

Idle figure heights span 28px to 38px across the twelve heroes -- a 36% range -- because
`pack-spritesheet.mjs` scales each sheet independently to fit *its own* most extreme pose.
On-screen size therefore depends on how wide or tall a character's biggest gesture happens to
be, which is arbitrary from the player's side.

The Lancer was the worst height-limited case: its leap is 152px against a 118px standing
pose, because it is the hero with the `airborne` mechanic. Repacking at a 64x48 cell took its
idle from 30px to 36px, alongside the Warden's 35px.

The **Blademage** is now the smallest at 28px, and is width-limited rather than
height-limited: the source added on 2026-10-22 has a 340px-wide attack frame -- a slash trail
baked into the sprite -- which packs the figure down to 22px, worse than what ships. The
shipped sheet came from a later source that is not in `art-reference/`.

Two routes:

- **Per-hero**, as done for the Lancer: widen the cell for the offender. Cheap, targeted, and
  leaves the spread in place.
- **Pack every hero to a common standing height.** The real fix, and it needs all twelve
  current sources. Repacking is where the Oracle's mid-walk bounce and the Vanguard's missing
  claw swipes came from, so it wants doing deliberately rather than in passing.

A third option specific to the Blademage: teach the packer to let one outlier frame clip
rather than letting it set the scale. Reasonable now that slash trails have their own effect
layer and need not be baked into a sprite.

---

## 7. Give the six Strikers a tempo axis

**Raised 2026-10-22.** Noticed as "way too many Striker characters". The labelling half is
fixed; this entry is the part that needs a design decision.

Role distribution was Striker 6, Caster 2, Controller 2, Guardian 1, Healer 1 -- half the
roster under one label. The Codex now shows **capability tags** instead, derived from ability
data, which splits those six into three groups and says something a player can act on:

| Capability set | Heroes |
| --- | --- |
| physical | lancer, vanguard, brawler |
| physical + pierce | blademage, machinist |
| magical + physical + pierce | monk |

What remains is that **Lancer, Vanguard and Brawler are capability-identical**, so no derived
label will ever separate them. They are genuinely different to play, along an axis that
exists nowhere in the code:

- **Lancer** -- delayed burst. `jump` has `delayTicks: 8` and `airborneDuringDelay`, so it
  trades tempo for a large hit and dodges anything ground-targeted while airborne.
- **Brawler** -- a ramp. `combo_rush` spends momentum, which accrues over the fight, so its
  output is back-loaded.
- **Vanguard** -- immediate. The highest raw attack in the roster (96) with no setup and no
  delay.

That is Burst / Ramp / Sustained, and it is a real taxonomy. The question is whether it
should be *surfaced* as a label, or whether the three should be pushed further apart
mechanically so the distinction is felt rather than read.

### What it costs

Surfacing it as a label is cheap but invalidates the pool: `role` is hashed by
`contentHash` (`generate.ts:137`), so changing any role string forces a rebuild and
re-verification of all 319 entries. That rebuild carries **zero balance risk** -- measured,
the role rule gates 0 of 220 trios on its own, and removing it entirely leaves the same 158
viable parties -- so the rebuild reproduces identical entries under a new hash. Pure compute.

Changing the characters *mechanically* is the real work, and it is the usual loop: edit,
rebuild the pool, compare against the 2026-10-22 baseline in item 1.

### Related

The shared-role rule in `inspectParty` is now documented as inert and kept rather than
deleted, because redistributing roles would make it meaningful again. `tests/draft.test.mjs`
asserts it gates nothing today, so if it starts rejecting a party that is a deliberate change
somebody has to acknowledge rather than a silent shrinking of the verified pool.

---

## 8. Waiting on a domain

`Content-Security-Policy` headers and an absolute `og:image` URL. Neither can be finished
until the production domain is settled.
