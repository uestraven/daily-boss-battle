# Daily Boss Battle

A daily tactical-RPG challenge: one curated three-hero party, one boss, one shared
encounter per UTC day, decided by a deterministic ATB engine rather than reflexes.

**Target platform: mobile, Android first.** iOS follows in a later update. The React client
in `web/` is the playtest and layout reference for that build, not the shipping app — see
[What's next](#whats-next).

All characters, bosses, abilities, items, and artwork are original to this project.

Quick start (Node.js 22+):

```bash
npm install
npm test
npm run daily:check
npm run web:dev
```

## Status

| Area | State |
| --- | --- |
| Deterministic ATB engine | Implemented, 78 regression tests |
| Roster | 12 heroes, 6 bosses |
| Daily loop | Local only — six-day rotation from curated team/boss templates |
| Android client | Not started |
| Art | Slots and import pipeline implemented; no artwork produced yet |

**Daily results are locked only within one browser profile and are not server verified.**
The rotation draws from six curated team/boss combinations with reproducible winning
witnesses; it does not yet remix all 12 heroes. This is a playtest build, not a competitive
public release. Do not deploy it as a public ranked daily challenge.

## Engine

Platform-neutral **TypeScript tactical ATB engine** with one fully runnable reference
battle: **Warden + Brawler + Magus vs. Blade Tyrant**.

The engine is pure logic — no DOM, clocks, network, storage, or React. It drives the web
client today and is intended to drive the Android client unchanged.

Expected `npm test`: **78 tests passed, 0 failed**. Expected golden output: `victory`, tick
**65**, **19** hero actions, **5** boss action commitments, three stars. Final hero HP:
Warden **247**, Brawler **160**, Magus **116**. Boss HP **0**, inventory unchanged.

The suite needs no browser:

```bash
npm run build
node --test tests/engine.test.mjs
node scripts/run-golden.mjs
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/engine.ts` | Deterministic, immutable-step battle simulation; damage, status, ATB, telegraph, validation, replay |
| `src/types.ts` | Shared typed JSON-serializable battle contracts |
| `src/reference.ts` | Reference Encounter 001: characters, abilities, boss script, inventory |
| `src/roster.ts` | 12 hero profiles, stats, and signature techniques |
| `src/encounters.ts` | Practice encounters and boss AI scripts for the six bosses |
| `src/daily.ts` | Local daily-challenge service: rotation, attempts, results |
| `src/boss-ai.ts` | Seeded boss targeting, counters, and conditional overrides |
| `fixtures/` | Approved golden input sequences with expected results |
| `tests/` | 78 dependency-free Node tests |
| `scripts/` | Replay, balance, solver, roster, and art-check drivers |
| `web/` | React playtest client and layout reference |
| `docs/` | Design and implementation notes per version |

## Minimal API

```ts
import { reference001 } from './dist/src/reference.js';
import { createEncounter, advanceToDecision, previewAction, applyPlayerAction, replay } from './dist/src/engine.js';

let step = advanceToDecision(createEncounter(reference001), reference001);
// First decision occurs at tick 8, when Brawler is ready.
const action = { actorId: 'brawler', abilityId: 'attack', targetIds: ['blade_tyrant'] };
const preview = previewAction(step.state, action, reference001); // pure, exact immediate damage
step = applyPlayerAction(step.state, action, reference001);
```

The reducer **never mutates** the provided state. Serializing a `BattleState` with
`JSON.stringify` and later parsing it is enough to resume, given the same immutable
encounter/ruleset version.

## Determinism contract

- All ATB calculations use integer virtual ticks; heroes have priority when newly ready
  alongside the boss.
- Scheduled delayed impacts and status expiry are handled before new ATB readiness.
- Attack results have no random damage, random crits, or misses. Element multipliers and
  combat modifiers are applied **before one final floor**.
- The boss announces an ability and locked targets; boss phase changes preserve an
  already-announced action.
- Wrong targets or missing resources cause rejection with **no state or time change**.
- Seeded boss targeting (`random_slot`) is keyed on boss action count, phase, and ability
  id. **Renaming an ability id changes its targeting sequence** — treat ids as part of the
  content contract.
- No real-time waiting, frame clocks, browser APIs, network, React, or storage dependencies.

## Frozen design vs. provisional tuning

Approved Encounter 001 tuning: Blade Tyrant HP **1,400**, Magus Focus **×2**, Blade Storm
**4-tick channel**, and three-star mastery condition **no item use**. The **remaining
numerical powers, MP costs, statuses and boss scripts are prototype tuning constants**, not
permanent balance decisions.

## Roster

12 heroes — Warden, Lancer, Oracle, Blademage, Channeler, Nullifier, Monk, Machinist,
Vanguard, Brawler, Magus, Thief — and six bosses: Blade Tyrant, Tide Maw, Ink Lurker, Crush
Wall, Storm Keeper, Spell Weaver.

Each boss has a fixed demonstration party under **BATTLE VERSION** in the browser client.
Full kits, encounter rosters, solver results and limitations:
[docs/ROSTER-V09.md](docs/ROSTER-V09.md).

```bash
npm test
npm run roster:check
npm run golden
npm run web:dev
```

## Producing art and audio

**[docs/ART-AND-AUDIO-SPEC.md](docs/ART-AND-AUDIO-SPEC.md)** is the brief: sheet layout,
frame counts, anchors, file naming, audio formats and looping.

Two things worth knowing before starting:

- **MIDI cannot be the shipping format.** No browser has a built-in synthesiser, so
  `.mid` will not play anywhere. Compose in MIDI, render once through a soundfont to OGG.
  The spec has the fluidsynth command.
- **Animated attacks are supported.** Animation is driven by the battle choreography, so
  it is automatically in sync with damage numbers, shake and health drain. Non-looping
  clips are **stretched to fit their beat**, so an attack animation can never finish early
  or overrun its hit — pick a frame count that reads well and ignore timing.

`src/animation.ts` resolves which clip and frame each actor is on; `validateSheet()`
rejects a malformed manifest entry with a specific message at load. Only an `idle` clip is
required — a missing clip degrades to idle, so sheets can gain animations incrementally.

## Art pipeline

Arena and sprite slots exist for all six bosses, with an in-browser crop/import tool and a
bundled-PNG path. **No artwork ships with this repository** — every slot is empty and
`npm run art:check` reports them as missing until original art is produced.

Art direction per arena: [docs/ORIGINAL-BACKGROUNDS-V11.md](docs/ORIGINAL-BACKGROUNDS-V11.md)
and `web/src/background-catalog.ts`. Asset rules:
`web/public/battle-backgrounds/README.md`.

## Content pipeline

The daily encounter is **random but verified**. A random boss and a random party would
normally risk dealing someone an unwinnable or trivial fight, so the whole cross-product
of (boss × viable party) is evaluated offline and only passing combinations ship.

```bash
npm run draft:check      # which three-hero parties are viable, and why the rest are not
npm run tune             # sweep boss HP/power to find gate-passing settings
npm run pool:build       # evaluate every combination and write the verified pool
npm run pool:check       # fail if the committed pool is stale or a boss is unreachable
npm run witnesses:record # re-solve curated witnesses after content is retuned
```

**The six gates** (`src/gates.ts`) are the definition of a fight worth shipping. An
encounter enters the pool only if all six hold:

| Gate | Requirement |
| --- | --- |
| `winnable` | a verified three-star line exists |
| `non_trivial` | attack-only does not master it |
| `multi_path` | ≥3 structurally different winning lines |
| `no_forced_ability` | no single ability is load-bearing for every line |
| `losable` | a greedy policy does not master it |
| `length_band` | the best line is 12–32 actions, a 3–6 minute session |
| `no_dead_kit` | no hero's signature offence is nullified by this boss |

The solver is a bounded beam heuristic and is never trusted alone: **every line it reports
is replayed through the authoritative engine** before it counts, and a gate that cannot be
established within budget fails closed.

`tools/generate-pool.mjs` writes `dist-content/verified-pool.json`, stamped with a
`contentHash` of all behavior-affecting content plus the gate suite's identity
(`GATE_IDS` and `GATES_VERSION`) — content alone is not enough, because the gates are
code and a new gate must invalidate cached verdicts. Bump `GATES_VERSION` when the logic
inside an existing gate changes. `npm run pool:check` refuses a pool built
from different content than the repo holds — that gate is what stops a retuned boss from
reaching players unverified.

**Daily selection** (`src/pool.ts`) draws from the pool: a boss rotation where every boss
appears once per cycle and never within `MIN_BOSS_GAP` days (gap 3 requires ≥6 bosses),
then a party chosen to match a per-weekday difficulty tier. Selection is a pure function of
the UTC date, so every player gets the same encounter.

**Content is data.** Boss stats, phase scripts, target selectors, reactive counters and
overrides, and enrage curves are all fields on `BossProfile`; adding a boss edits no
builder and no engine code. `buildEncounter(boss, party)` works for any combination.

## Presentation layer

The engine resolves an action instantly; a 16-bit JRPG does not. `src/presentation.ts`
turns the engine's event stream into a timed script of **beats** — step forward, hit
flash, damage number, health bar draining over 400ms, the full stop when a boss changes
phase. That pacing is the game's feel, so it is pure, deterministic and unit-tested
rather than eyeballed.

It is deliberately renderer-agnostic: it emits *what* to show and *when*, and a renderer
decides *how*. The same script drives a canvas stage, a React Native view, or the
terminal client. `TIMING` is the single place to tune the whole game's feel.

```ts
const script = choreograph(events, {names, maxHp, abilityNames, speed});
for (const beat of beatsAt(script, now)) draw(beat);       // render loop
const hp = tweenValue(hpBeat, now);                        // eased bar drain
```

`src/audio.ts` maps beats onto timed sound cues and music transitions, including the
music cut around a phase sting. `npm run audio:manifest` prints the commissioning list
(17 SFX, 4 tracks) derived from the code that plays them, so it cannot drift from the game.

## Web client

`npm run web:dev` serves the portrait-first daily battle screen: stage on top, party
status beneath, commands in the bottom third, 44px touch targets throughout.

- `src/stage.ts` composes each frame into a flat list of draw commands — layout, shake
  and float maths, all pure and unit-tested headlessly. Shake is deterministic (hashed,
  not random) so a replay looks identical.
- `web/src/BattleStage.tsx` only executes those commands on a canvas and runs the clock.
  The canvas is the fixed internal resolution (320x180, 16:9) scaled by whole numbers
  with `image-rendering: pixelated`, which is what keeps pixel art crisp.
- `web/src/DailyBattle.tsx` is the screen; it draws today's encounter from the verified
  pool and refuses to run rather than falling back to an unverified one.

Target platforms are **Android 16 (API 36) first, then iOS 26**. API 36 enforces
edge-to-edge and iOS 26 draws under the home indicator, so the screen uses
`viewport-fit=cover` with `env(safe-area-inset-*)` padding rather than assuming a
rectangular viewport.

Two known warts. Engine imports in `web/` come from `dist/` because `src/` uses NodeNext
`.js` specifiers that Vite will not rewrite to `.ts`; `web:dev` builds first, so it is
consistent rather than stale, but engine edits need a rebuild to appear. And the old
desktop harness `web/src/App.tsx` is still on disk, now unreferenced — it carries the
background-import studio and battle-version switcher, and can be deleted once those are
either ported or abandoned.

## v1 scope: a daily website

v1 is a website, desktop and mobile web, no accounts and no server:

- **One battle a day**, the same for everyone, drawn from the verified pool.
- **Replaying is allowed.** The first completed attempt is recorded as the day's result;
  further attempts are unranked and never overwrite it. The shared card always reports
  the recorded result, so sharing cannot be used to inflate an outcome.
- **Share as an image.** The result screen renders a square PNG card and offers Web Share
  (mobile), copy-image, copy-text and download, so at least one route works in every
  browser. The card is spoiler-light by design: outcome, mastery and effort, never the
  winning line. A test asserts the ability names never appear on it.
- **Optional email reminders.** Provider-agnostic: the form POSTs to whatever
  `VITE_REMINDER_ENDPOINT` names, so a hosted form service can be swapped without code
  changes. With no endpoint configured the form does not render, rather than silently
  discarding addresses. No key is committed.
- **Desktop and mobile.** Portrait-first single column under 900px; a two-column grid
  above it, with the stage at a larger whole-number scale. The stage's fixed internal
  resolution is identical either way — only the frame changes.

Deliberately out of scope for v1: accounts, server-side verification, leaderboards, push
notifications and native app packaging.

## The daily loop

The screen is backed by the daily ledger, so it behaves like a daily game rather than a
battle sandbox:

- **One recorded attempt per UTC day.** The first completed battle is the day's result,
  shown with streaks and star total. Replays are offered but stay unranked.
- **Resumable.** Close the tab mid-fight and it resumes at exactly the same decision,
  because the ledger replays the stored action log rather than trusting a snapshot.
- **Tamper-evident.** Editing localStorage cannot manufacture a result: normalisation
  recomputes every record by replay and drops anything that does not reproduce.

One ledger serves both content sources. `DailyCatalog` abstracts "which encounter is
today's", so the verified pool reuses the curated path's integrity model instead of
growing a second one — `poolCatalog(pool)` for the product path, `curatedCatalog` for the
frozen regression templates. A record from one is never accepted by the other, and a pool
rebuild changes the catalog version, which invalidates stored results for encounters that
no longer exist.

Results are local and unverified until there is a server, and the UI says so.

## Playing it now

A zero-dependency terminal client runs the real daily loop — no browser, no React:

```bash
npm run play                        # today's verified daily
npm run play -- --day 2026-10-24    # a specific day
npm run play -- --practice tide_maw # practice a boss
npm run play -- --seed anything     # draft a random party
npm run play -- --speed 3           # faster animation
npm run play -- --instant           # no animation delays
```

`npm run web:dev` binds all interfaces, so a phone on the same network can open it at
`http://<your-ip>:5173`. Testing on the real Android target answers the questions that
matter — touch latency, 60fps, safe-area insets — without needing a native wrapper yet.

It shows the boss's announced intent and tick countdown, previews exact damage with
`p <n>` before you commit, and replays your action log on exit to confirm the result
reproduces. It drives the same choreography layer the real client will, so it is a
genuine feel test, not a mock.

## Development

The tools run on Windows as well as POSIX: they load built modules through
`tools/load.mjs`, because dynamic `import()` of an absolute path throws
`ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows (`C:` parses as a URL scheme).

```bash
npm run verify           # typecheck + tests + behavior guard + golden replay
npm test                 # 109 tests, no browser needed
npm run behavior:check   # fail if simulation behavior moved
npm run behavior:record  # re-record the baseline after an intended change
npm run draft:check      # viable-party pool report and rejection reasons
```

**The behavior guard.** `tools/behavior-snapshot.mjs` hashes the observable behavior of
every shipped encounter — full event logs, outcome state, and the complete cross-product
damage table — into `reports/behavior-baseline.json`. It exists so refactors can be proven
behavior-neutral even when they change types or state shape, which unit tests alone cannot
show. If `behavior:check` fails and the change was intended, run `behavior:record` and
review the diff in the commit.

**Content is data; the engine is content-agnostic.** The engine branches on no character
id. A hero's momentum capacity comes from `momentumCap` on the roster entry, an elemental
rider from `riderElement` on the ability, and a boss's unaffordable-ability fallback from
`fallbackAbility` on the encounter. `tests/foundation.test.mjs` adds a brand-new hero
entirely as data and asserts the engine honours it, so this property cannot regress.

**Daily results are verified by replay.** A daily record stores its action log, and
`normalizeLedger` recomputes the battle from that log — the stored state is only a cache.
Editing a saved result cannot manufacture a win. See `tests/daily-integrity.test.mjs`.

## What's next

- Android client: package the engine behind a native or hybrid shell, Play Store target.
- Server-verified daily results, official-attempt persistence, and anti-cheat.
- Original art for six arenas, 12 hero sprites, and six boss sprites.
- Full-roster daily remixing instead of six curated templates.
- Push notifications, telemetry, accessibility passes, and mobile persistence testing.
- iOS build after Android ships.
