# Implementation notes: Reference Encounter 001

## Locked rules represented by v0.1

- Three heroes and one boss, one uniform 1,000-point ATB model; virtual integer ticks, Wait mode, choice among simultaneously ready heroes.
- All regular actors have one action per ready event; no extra boss turns, and boss channels prevent ATB recharging until the **next tick after impact**.
- Attack/defense/element/math use shared deterministic formulas, integer fractional multipliers and one floor. Protect ×3/4, Shell ×3/4, Defend ×1/2, weakness ×3/2, resistance ×1/2, immunity ×0; Fire/Blizzard/Thunder are distinct `element` data values.
- Heal = floor(power × caster.Magic / 100); capped by missing HP.
- Locked target IDs for boss intent. Ineligible targets fizzle; Warden's Cover is the only target redirection in the reference battle.
- Fixed items, one ATB action to use; Revive Tonic revives at `ceil(maxHP/4)` and ATB 0 at the instant of revival.
- Disclosed phase transition; incoming intent stays locked until resolved; MP-based boss fallback selected/announced before it becomes the active intent.
- Ready heroes act before a newly ready boss at same tick; scheduled impacts resolve before readiness. On tick 60, Blade Tyrant Protect expires and Blade Storm lands before Warden can cast Cure.
- Brawler gains max 2 Momentum through successful Attack, spends it on Combo Rush/Spin Kick; Magus Focus consumed by the next offensive spell, or expires at tick limit.

## Simulation sequence

1. `createEncounter(def)` creates pristine JSON-serializable `BattleState` and announces initial boss intent.
2. `advanceToDecision(state, def)` clones state and runs tick-by-tick until **any hero needs input**, or the battle ends. It may execute boss turns automatically while no hero is ready.
3. `previewAction(state, input, def)` performs the current action in an isolated clone and returns immediate predicted effects and scheduling; conditional delayed impacts are flagged, not incorrectly presented as guaranteed numeric damage.
4. `applyPlayerAction(state, input, def)` clones, validates, executes and then advances until another player decision or outcome.
5. `replay(def, actions)` supplies the actions to that public API in order; actions do not carry an authoritative tick. Golden expectedTick values are **asserted by the test**, never used to force the simulation clock.

The `BattleStep.events` property is the **new events since the current call**, while `BattleStep.state.events` is the full deterministic history. This prototype stores the entire event history in state for convenient verification; a production client may separate immutable logs from snapshots for efficiency.

## Explicit timing conventions

- At the beginning of a virtual tick, poison pulses run (including one due on its expiration tick).
- Other timed statuses then expire (`[applicationTick, expirationTick)` window).
- Delayed effects due on that tick resolve, in `(tick, actorId, sequence)` order.
- Surviving eligible actors receive that tick's ATB charge, with status-adjusted Speed. Actors that acted or finished channeling this tick start charging on the **next** tick.
- Player decisions proceed while virtual time is paused, then boss ready actions run when no ready hero remains.
- A dead boss cannot carry out future pending attacks. Revivals return at zero gauge, with charging allowed from the following tick.

## Ruleset and data versions

Both `engineVersion` and `contentVersion` are checked before advancing a saved state. Changes to formulas, status ordering, targeting or action behavior must create a **new engine version**; encounter-tuning edits create a **new content version**. Keep a manifest of old versions when publishing actual daily challenges or replays.

## Safety and correctness boundaries

This is a functional proof of concept, not a production-hardened online authority. In particular, there is no cryptographic signature on client results, no input schema validator for untrusted network JSON, and no semantic proof of alternate wins or prevention of stalling. Numeric safety assumes curated integer stats and powers within the supplied bounds; a production content pipeline should validate these limits. Integrations must not trust scores reported by untrusted clients.

Node 22+ is recommended for Windows 11. The package uses built-in `node:test`, so only TypeScript itself is required to rebuild.
