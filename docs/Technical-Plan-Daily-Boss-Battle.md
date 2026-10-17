Technical plan: Daily Boss Battle

1. The product, concretely

One session per UTC day, 3–6 minutes, 15–30 hero actions. Everyone in the world gets the same encounter that day — that's what makes a daily worth discussing. Open the app, see today's boss revealed with a title card, get dealt a random-but-viable party of three, fight, win or lose, result locked. Come back tomorrow.

Intensity comes from information, not reflexes: the boss announces its next move and its locked targets with a tick countdown, you see exactly how much damage is coming and onto whom, and you choose. Your engine already does this (bossIntent, nextBossCountdown, previewAction giving exact pre-commit damage). The core tension mechanic is built — the plan exploits it rather than inventing new systems.

Scoring stays your 3-star model (win / ≥2 survivors / all 3 survivors with no items), which gives a reason to replay mentally after a sloppy win.

2. The central idea: random encounters, verified offline

Your current design pins integrity to six hand-curated templates with committed witnesses. "Random boss, random team" breaks that — you can't hand-verify a combinatorial space. But you don't need to, because the space is small enough to verify exhaustively, offline:

┌──────────────────────────────────────────────────┬────────────────────┬────────┬────────────┬──────────────────────┐
│                      Roster                      │ Parties (choose 3) │ Bosses │ Encounters │ Verify @ 3s, 8 cores │
├──────────────────────────────────────────────────┼────────────────────┼────────┼────────────┼──────────────────────┤
│ 12 heroes                                        │ 220                │ 8      │ 1,760      │ ~11 min              │
├──────────────────────────────────────────────────┼────────────────────┼────────┼────────────┼──────────────────────┤
│ 18 heroes                                        │ 816                │ 16     │ 13,056     │ ~1.4 h               │
├──────────────────────────────────────────────────┼────────────────────┼────────┼────────────┼──────────────────────┤
│ 18 heroes, full gate suite (~5 solver runs each) │ 816                │ 16     │ 65,280     │ ~7 h                 │
└──────────────────────────────────────────────────┴────────────────────┴────────┴────────────┴──────────────────────┘

An overnight job, re-run only when content changes. The output is a verified pool manifest shipped inside the app: the allowlist of (party, boss) pairs that passed, each tagged with difficulty. The daily seed picks from that manifest. Randomness is real; fairness is proven, not hoped for.

This is the plan's best leverage because it's not speculative — solver.ts (beam search, multiple solutions), balance.ts (counterfactual probes with forbiddenAbilities, baseline policies) and reports/ already do exactly this work. You're promoting dev tooling into a content gate.

The gates that define "intense, multiple strategies"

An encounter enters the pool only if all of these hold. Each maps to code you have:

┌──────────────────────┬──────────────────────────────────────────────────────────────────────┬────────────────────────────────────────┐
│         Gate         │                              Definition                              │             Implemented by             │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G1 Winnable          │ ≥1 three-star line found within budget                               │ solveEncounter                         │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G2 Non-trivial       │ attack-only baseline loses, or wins with ≤1 star                     │ runBaselinePolicy('attack_only')       │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G3 Multi-path        │ ≥3 winning lines with different ability-usage sets, not reorderings  │ solveEncounter + usage-set dedupe      │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G4 No forced answer  │ for each signature ability, forbidding it still leaves a win         │ analyzeEncounter counterfactual probes │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G5 Genuinely losable │ a plausible greedy policy (always biggest hit, heal under 30%) loses │ new baseline policy, ~30 lines         │
├──────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────┤
│ G6 Length band       │ best line is 15–30 hero actions                                      │ solver output                          │
└──────────────────────┴──────────────────────────────────────────────────────────────────────┴────────────────────────────────────────┘

G6 alone would reject tide_maw and ink_lurker as they stand today. G5 is the one you don't have yet and the one that guarantees "multiple ways to lose."

Difficulty tiering falls out for free: bucket by best-line length and win margin, then have the daily picker walk a difficulty curve across the week (gentler Monday, brutal Saturday) instead of drawing uniformly.

3. Engine changes

Ordered by whether they block content work. Do these before expanding content, because every one of them gets more expensive once there are 18 heroes and 16 bosses.

Decouple content from the engine — blocking. engine.ts:45,117,122 branch on source.id==='blademage' / 'brawler', and :252,:270 hardcode 'heavy_slash' as a fallback. Move to ability-level flags (momentumGain — which is already declared and already ignored, plus elementRider:'ice') and a per-encounter fallbackAbility. Until this lands, adding a hero means editing the simulation core. ~2 days.

Action-log persistence + replay verification — blocking for any shared/competitive framing. Store inputs: BattleInput[] in the record and verify results by replaying them. Today a forged state passes validation (I demonstrated a 3-star win at tick 8 with zero actions). This also makes future server verification nearly free: the client posts an action log, the server replays it with the same engine. ~3 days.

Party draft constraints — new, small. Random-but-balanced needs a cheap pre-filter so the verifier isn't burning cycles on obviously broken teams: require at least one sustain source, at least one of physical/magical damage each, and no three-of-the-same-archetype draws. The real balance guarantee is the verification pool; this just cuts search waste. ~2 days.

Soft enrage timer — new. Without it, stalling is a dominant strategy and "intense" evaporates. A per-encounter tick threshold after which boss damage scales up. ~1 day, needs new tests.

Keep one boss per fight. engine.ts:181 hardcodes opposing=[s.bossId] and checkTerminal reads s.actors[s.bossId], so multi-enemy fights are an engine generalization, not a content change. It's also the product name. Twin-boss and summoned-adds fights are a post-v1 engine change (~1 week); don't take it on now.

Audit fixes to fold in: swap localeCompare at engine.ts:322 for code-unit ordering (locale-sensitive comparison in the determinism core — harmless on today's Node, a silent divergence risk the moment the engine runs under a different JS runtime); add the missing defeat-path and maxTicks softlock tests; wire CI to run the 78 tests.

4. Content system

Replace hand-written encounters.ts literals with data files plus a generator.

content/
  heroes/*.json          18 hero definitions (stats, abilities, archetype tags)
  bosses/*.json          16 boss definitions (stats, scripts, AI rules, phases)
  abilities/*.json        shared + signature abilities
tools/
  generate-pool.mjs      cross-product → gate suite → verified-pool.json
  verify-pool.mjs        CI check: pool matches current content hash
dist-content/
  verified-pool.json     shipped artifact (ids + difficulty tags only; small)

The pool artifact ships as ids and tags, not full encounters — the app rebuilds each encounter deterministically from content files, so it stays a few hundred KB at most.

CI gate: if content changes and the pool wasn't regenerated, fail the build. That prevents shipping an unverified daily, which is the one bug that would actually embarrass you publicly.

5. The SNES feel — where it's actually won

This is a presentation project pretending to be an engine project. The engine is done; the feel is not.

Fixed internal resolution, integer-scaled. Render the battle stage to a 427×240 (or 320×180) canvas with nearest-neighbour scaling, letterboxed. No reflowing layout, no fractional pixels. Your current CSS window system (retro-windows.css, 387 lines) is genuinely good and worth keeping for menus — but it must align to the same pixel grid or the illusion breaks.

Animation and feedback at 60fps over turn-based logic. The logic is instantaneous; the presentation must not be. Required: damage numbers that pop and arc, hit flash, screen shake scaled to damage, HP bars that tick down over ~400ms rather than snapping, a boss phase-2 transition that stops the music and holds a beat, character sprites that step forward to attack. Your engine already emits a full BattleEvent stream per action — build the presentation layer as an event-queue consumer that animates events in sequence. Clean separation, and it makes the 982-char-line App.tsx rewrite unavoidable in a good way.

Text that types out, with a per-character blip and a chunky advance arrow. Non-negotiable for the era.

Audio is 50% of the feel and the most underestimated line item. Needed: title, battle A, boss phase 2, victory fanfare, defeat, menu — plus ~25 SFX. Commission original chiptune/sampled-era music. Budget real money and real calendar time here; a silent build will feel wrong no matter how good the sprites are.

Portrait-first. The current 1280×720 desktop reference canvas is wrong for the product. Design for a 360×800 phone held one-handed: boss and arena up top, party status and command window in the bottom third, 44px minimum touch targets.

6. Mobile packaging

Recommendation: rewrite the UI as a portrait-first React app at fixed internal resolution, ship via Capacitor to the Play Store. Keep src/ untouched.

Reasoning: the UI is being rewritten regardless — what exists is a desktop playtest harness with dev dropdowns, so "reuse the web client" was never actually on the table. Given a rewrite either way, Capacitor keeps one codebase serving both the web playtest loop and the Android build, keeps CSS available for the window aesthetic, and gets a real downloadable app in weeks rather than months. Your engine is pure TypeScript with zero platform coupling, so it runs unmodified in a webview, in React Native, or anywhere else — the packaging choice is reversible, which is exactly why it shouldn't be agonized over now.

Alternatives, honestly: React Native (+react-native-skia for the stage) gives better input latency and audio timing and reuses the engine verbatim, at roughly 4–6 extra weeks of UI work — worth it only if Capacitor proves inadequate. Native Kotlin means porting the engine and abandoning the 78 tests as executable spec; not worth it. Godot/Unity means rewriting the engine entirely; no.

Set explicit migration triggers up front: if measured touch-to-feedback latency exceeds ~80ms, or music/SFX can't stay sample-synced through phase transitions, or sustained 60fps shake isn't achievable on a mid-range device, move the stage to RN/Skia. Decide with a measurement, not a vibe.

iOS comes after Android ships, from the same Capacitor project.

7. Content slate and the IP line

You just spent a session removing Final Fantasy. "Caricatures of classic heroes and villains" walks straight back toward that cliff, so make the rule explicit and enforce it.

The rule: parody the archetype, never the character. The amnesiac mercenary with an absurdly oversized sword is a trope and is fine. A silver-haired swordsman with one black wing named something Sephiroth-adjacent is a specific character and is not. Trope-level traits — job classes, elemental magic tiers, dragoon jumps, cackling mage-villains, armored tyrants — are genre furniture. A specific character's name, silhouette, signature weapon, catchphrase, or distinctive visual gimmick is theirs.

Heroes: 6 archetype families × 3 variants — Guardian, Lancer, Monk, Black-mage, White-mage, Rogue, plus Machinist, Blademaster, Summoner, Gunner, Beastmaster, Bard to fill 18. You already have 12 under role-archetype names from the rename; they expand naturally.

Bosses (8 for v1, 16 eventually), each defined by a mechanic rather than a likeness: the Mad Harlequin (chaos, random targeting), the Clockwork Emperor (adds and self-repair), the Sealed Wall (damage race under a closing timer), the Devouring God (multi-phase endurance), the Four-Armed Collector (weapon-cycling with telegraphed patterns), the Tentacled Opportunist (status pressure), the Lich (revives unless interrupted), the Rival (mirrors your party's archetypes).

Add a content review gate to the pipeline: each new character ships with a one-line written answer to "which trope, and which specific character am I not?" Cheap now, very expensive to retrofit after a store launch.

8. Integrity

v1 (local, no accounts): action-log persistence, replay verification, one attempt per day, honest in-app copy that results are local and unverified. Accept that clearing app storage resets the day — don't pretend otherwise in the UI.

v2 (if you want streaks and leaderboards to mean anything): thin backend that serves the daily seed and verifies submitted action logs by replaying them server-side with the same engine module. This is the payoff for keeping the engine pure and platform-free, and it's why the action-log change in §3 is listed as blocking rather than nice-to-have.

9. Phases

┌─────────────────┬──────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────┬──────────────────────────────────┐
│      Phase      │                               Work                               │                  Exit criteria                  │              Effort              │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│                 │ Content/engine decoupling, action log + replay verify, enrage    │ Adding a hero touches no file in src/engine.ts; │                                  │
│ 0. Foundation   │ timer, draft constraints, defeat + softlock tests, CI,           │  forged ledger rejected; CI green               │ 2 wks                            │
│                 │ localeCompare                                                    │                                                 │                                  │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│ 1. Content      │ Content files, generator, G1–G6 gate suite, verified-pool        │ Overnight job emits a pool; every entry passes  │ 3–4 wks                          │
│ pipeline        │ artifact, pool-freshness CI gate                                 │ all six gates; 12 heroes / 8 bosses in data     │                                  │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│ 2. Presentation │ Fixed-res canvas stage, event-queue animation layer, text        │ Side-by-side with a real SNES JRPG battle,      │ 4–6 wks                          │
│                 │ system, portrait UI, audio integration                           │ nothing reads as "web page"                     │                                  │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│ 3. Mobile ship  │ Capacitor, Android build, storage, daily notification, Play      │ Installable APK, 60fps mid-range device,        │ 2–3 wks                          │
│                 │ Store listing and review                                         │ latency within trigger thresholds               │                                  │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│ 4. Art & audio  │ 12 hero sheets, 8 boss sheets, 8 arenas, UI set, ~25 SFX, 6      │ Asset manifest complete and licensed            │ Runs parallel from Phase 1,      │
│                 │ tracks                                                           │                                                 │ calendar-bound by contractors    │
├─────────────────┼──────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────┼──────────────────────────────────┤
│ 5. Backend      │ Seed service, server-side replay verification, streaks           │ Server rejects a tampered log                   │ 2–3 wks                          │
│ (optional)      │                                                                  │                                                 │                                  │
└─────────────────┴──────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────┴──────────────────────────────────┘

Phases 0–3 are roughly 11–15 weeks of engineering for one developer. Phase 4 is the long pole and does not compress with more code.

10. Risks, ranked

Art and audio are the real project. 12 hero sheets × ~5 poses, 8 animated bosses, 8 arenas, UI, effects, 6 tracks, 25 SFX. At commission rates this is plausibly $15–30k and several months of contractor calendar time. Everything in §1–§9 is tractable; this is what decides whether it ships. Mitigation: ship a vertical slice with 8 heroes and 4 bosses, art-complete, rather than 18 and 16 with placeholders.

Six distinct battles is not a daily game. Even with the verification pool, if content stays at today's scale players exhaust it in a week — and optimal solutions for the current six are already committed in reports/. The pool size, not the engine, determines retention. 16 bosses × constrained parties is the minimum viable variety.

"Random but fair" fails quietly if the gates are weak. A player who gets an unwinnable daily and loses their streak will not come back. The gate suite is load-bearing; treat G1–G6 as production code with their own tests, not as a script.

Scope temptation. Multi-enemy fights, equipment, progression, PvP are all natural next thoughts and all out of scope. The product is one boss, one party, one attempt, one day.

11. What I'd cut for v1

Ship 8 heroes, 6 bosses, art-complete, Android only, local-only results, no accounts, no leaderboard. That is ~220 verified encounters with constrained drafting — enough that the first month feels fresh — and it tests the only question that matters: does anyone come back on day three? Build the verification pipeline at full strength from the start (it costs the same at any content scale and determines whether expansion is cheap), but keep the shipped slate small until the loop is proven.