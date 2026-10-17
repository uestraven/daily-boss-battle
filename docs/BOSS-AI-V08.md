# Boss AI v0.8 — Scripted and seeded targeting (opt-in candidate)

**Scope:** Extend the existing headless engine and playable web interface with data-driven boss target rules, reproducible seeded slot selection, queued counters, conditional status responses and diagnostic telegraphs. The approved v0.6 reference encounter and the independent v0.7 candidate remain unchanged.

## Boss targeting contract

- **Scripts:** Each boss phase uses the existing explicit `bossProgram` action arrays. When `bossAI` is enabled, scripted actions are only consumed **when the boss actually commits them**, not when intent is shown.
- **Single slot:** `fixed_slot` targets one 1-based party position (including slot 4 in future parties). A KO'd fixed target yields no target; no silent retarget.
- **Sequential slots:** `sequential_slots` cycles through configured 1-based positions. It skips ineligible slots at intent selection; its cursor increments only when the selected scripted ability commits.
- **Seeded random slot:** `random_slot` samples uniformly via modulo over living slots using deterministic 32-bit integer mixing of `seed + boss-action index + phase + ability`. No `Math.random()` or wall-clock randomness. Roll stays locked once selected. Bias from modulo is negligible for 3–4 slots, but the selection is not cryptographic and isn't intended for wagering or security.
- **Last attacker:** `last_attacker` locks onto the actor who triggered the counter; subsequent attacks do not silently redirect that announced counter. If the target becomes KO'd before impact, it fizzles.
- **Other selectors:** `lowest_defense`, `lowest_hp`, `highest_attack`, `all_party`, `self`, `status_holder` (choose a living actor carrying a specified status).

**Determinism guarantee:** Same encounter definition, seed, committed actions, and replay history yield the same results. Different player choices can lead to different boss action histories and therefore different later target rolls. Damage and effects remain nonrandom.

## AI priority and one-ATB economy

1. A live **status override** qualifies if its declared status is present, its phase matches and any once-per-battle/cooldown restriction allows it.
2. Otherwise select the oldest eligible **queued counter** (the triggering attacker is captured in the queue).
3. Otherwise select the **next regular phase-script action**, without incrementing its cursor until commitment.
4. A configured ordinary single-target boss action defaults to `random_slot` if not explicitly assigned a selector.

A reactive ability **replaces** the next normal boss action. It does **not** add an immediate free attack, alter the boss gauge, or cancel an already committed channel. While waiting for the boss ATB, a new qualifying condition may replace the *uncommitted* intent; this replacement is logged and displayed. An already selected target is locked unless a documented event changes the action itself. Boss events and status expiration are processed in the prior locked tick order.

## Candidate Blade Tyrant v0.8

The 1,400 HP, Focus ×2, four-tick Blade Storm, and no-item three-star mastery remain. Physical/magical defenses, Magus's 35 MP and elemental affinities are inherited from v0.7.

- `Heavy Slash`: seeded random living slot instead of lowest Defense; initial seed `20261015` targets **party slot 2 (Brawler)**.
- `Wind Slash` and `Blade Storm`: whole party, no power splitting.
- `Precision Thrust`: added to later phase-two repeat, with cycling slots 1 → 2 → 3.
- `Counter Slash`: when a phase-two hero hit deals at least 95 damage, queue a 95-Power single-target physical counter at the next eligible boss action; target the triggering attacker; once per battle.
- `Shatter Guard`: when an active party member has `Protect`, the boss can spend **one normal ATB turn** removing that status from the protected hero; one use per battle. This uses the generic `dispel` effect. The status roster is unchanged. `Reflect` is an example of a future possible override trigger, **not** introduced into this encounter.

The variant is a **playtest candidate**, not an approved rebalance. It is intentionally not guaranteed to have the same difficulty or duration as v0.7. The candidate's solver witness uses 19 hero actions and wins on tick 65 with three survivors and no items. That shows one viable strategy but not optimality.

## Replay-safe state

The serialized `BattleState.bossAI` payload contains `lastAttackerId`, `pendingCounters`, `usedRules`, and `slotCursors`. The authoritative engine state also stores `BossIntent` with `origin`, `ruleId`, `selector`, and a plain-English `targetDescription`. All these fields survive JSON save/resume. The bounded solver's position fingerprint includes boss AI state and action ordinal, so it doesn't accidentally merge game states with different future seeded targets.

## Install on Windows 11

This is an overlay for a working **playable v0.8** installation (Engine v0.1 + Solver v0.2 + Balance v0.3 + Encounter v0.7 + UI v0.8). Use the ZIP filenames actually downloaded to your PC.

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
Expand-Archive -Path "$env:USERPROFILE\Downloads\Daily-Boss-Battle-Boss-AI-v0.8-Update.zip" -DestinationPath . -Force
npm install
npm run typecheck
npm test
node .\scripts\run-ai.mjs
npm run golden
npm run web:build
npm run web:dev
```

The browser's version dropdown now offers **v0.8 Scripted + Seeded AI** alongside the original **v0.7** and **v0.6**. It displays the selected target, target rule, and whether the intent is scripted, a counter, or a conditional override. The new variant uses its own local-storage key, so it does not overwrite existing playtest saves.

For a fresh installation, extract the **Full** ZIP into a new `daily-boss-battle` directory and run the same commands from `npm install` onward.

## Verification and caveats

- The Node/TypeScript engine checks are available in this environment; browser production build depends on locally installed React, Vite, and their types. Run `npm run web:build` on your Windows 11 machine.
- Existing tests and golden sequences remain unchanged. New tests cover seeded selection, 4-slot targeting, target lock, scripted sequence cursor, counter thresholds, reaction priorities, status dispel, status expiry, replay determinism, and the new golden witness.
- `node scripts/run-ai.mjs` regenerates `reports/encounter-v08-ai-comparison.json` using *bounded* searches and checks the fixture. These searches do not prove solvability for all future parties/seeds or human difficulty.
- No official Daily Challenge submission, network backend, or third-party art or music is included.
