# Daily Boss Battle — Encounter validation harness v0.2

This package adds a bounded, **deterministic beam-search solver** to the tested v0.1 engine. It does **not change** the combat reducer, golden witness, reference data, or prior tests. It uses the existing `advanceToDecision`, `previewAction`, and `applyPlayerAction` APIs.

## Windows 11 installation

Extract the *additive overlay* ZIP into your existing `daily-boss-battle` directory (not its parent):

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
Expand-Archive -Path "$env:USERPROFILE\Downloads\daily-boss-battle-solver-v0.2.zip" -DestinationPath . -Force
npm test
node .\scripts\run-solver.mjs
npm run golden
```

If your checkout is elsewhere, change only the `cd` path. The archive deliberately omits `package.json`, `package-lock.json`, and every existing engine file. The `npm test` script rebuilds the TypeScript before testing the new suite. No external service or database is needed.

Optional shortcut:

```powershell
npm pkg set 'scripts.solve=npm run build && node scripts/run-solver.mjs'
npm run solve
```

## What it validates

- Enumerates legal actions through the existing validator; no random battle outcomes.
- Searches a bounded graph of battle states, ranking states by boss damage, party survival, available resources, and tactical setup.
- Replays each winning action list using the authoritative reducer, rejecting inconsistent results.
- Tests the original golden battle and new search results independently.
- Runs diagnostic baseline policies: Attack-only, Defend-only, and greedy immediate damage.
- Allows constrained searches such as forbidding Cover or Focus to probe dependency on a mechanic.
- Serializes an example results report to `reports/reference-001-search.json` (the `reports/` folder is generated locally).

## Important limitations

**This is not a complete solver.** Beam search prunes states. No solution within the node/action budget does not imply unwinnability. Finding multiple winning action lists does not automatically prove meaningful strategic diversity. Balance and human difficulty are *not* established merely by finding a winning solution. A fuller validator needs exhaustive search on reduced state spaces, more exhaustive edge-case tests, and human playtesting.

The report distinguishes `beamPruned`, `budgetExhausted`, and `depthLimitReached` so that coverage is transparent. `maxExpansions` bounds the number of expanded decision states; `maxHeroActions` bounds depth. `maxTicks` remains enforced by the underlying battle engine. Evaluation is deterministic and the state fingerprint excludes historical event logs, which do not affect future combat logic.

The default search is deliberately conservative (beam width 96, 24 hero actions, 18,000 expansion budget, eight stored witnesses). Change these options when investigating more difficult encounters; runtime and memory will rise.

## Observed findings on the reference encounter

- Original golden replay: **3 stars, 19 hero actions, tick 65**.
- Bounded solver: a **3-star, no-item victory in 17 hero actions, tick 60**, with additional winning action sequences.
- Under the same bounded settings, excluding Magus's `focus` still admits a 3-star solution.
- Excluding Brawler's `combo_rush` and `spin_kick` still admits a 3-star solution (in approximately 21 actions at default search width).
- Attack-only and Defend-only policies lose; greedy immediate-damage policy wins with **1 star**.

**Balance takeaway:** Character signature techniques are not yet consistently needed for high-scoring victories. Preserve the currently approved tuning decisions (Blade Tyrant HP 1400, Focus multiplier ×2, Blade Storm four-tick cast, no-items mastery), but consider revising enemy threats, resource constraints, and tactical objectives. Any changed numerical values are new design proposals and must be approved and versioned. Do not silently rewrite historical golden battles.

## What is in the overlay

- `src/solver.ts`: bounded beam search, legal action generation, state fingerprinting, baseline policies.
- `tests/solver.test.mjs`: six regression tests for reproducibility, legal moves, independent replay, search restrictions, honest budget reporting, and baseline policies.
- `scripts/run-solver.mjs`: terminal report and JSON export.
- `docs/ENCOUNTER-VALIDATION.md`: this guide.

`npm test` should now show **24 passing tests** (18 original + 6 additional). `npm run golden` should still show the original 19-action result.

## Next milestone

Turn these observed findings into explicit balance acceptance criteria (e.g., at least two *mechanically different* winning approaches, no single action trivializing multiple puzzle archetypes, clear counterplay before lethal telegraphs) and then tune **a versioned copy** of Reference 001. Do not change the approved reference values or published daily challenges in place.
