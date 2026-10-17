# Daily Boss Battle — Encounter Design v0.7 (candidate)

This package adds a **content-only, opt-in** candidate for Reference Encounter 001, plus replay witnesses, comparison tooling and tests. **Nothing in the approved v0.6 reference, combat engine, solver or balance v0.3 modules is overwritten.** The numerical changes below are proposals, *not newly approved locked decisions*.

## Goal

Create a more tactical Blade Tyrant fight using existing deterministic engine primitives: timed protection, meaningful elemental choices, finite magic resources, Momentum, Focus and defensive counterplay. Keep the already approved constraints intact: 1,000-gauge integer-tick ATB, player-priority Wait mode, truthful telegraphs, deterministic damage, 1,400 Blade Tyrant HP, 2× Focus, four-tick Blade Storm, no shared items for three-star mastery, and one boss ATB gauge.

## Content delta (not an engine change)

| Parameter | Approved reference v0.6 | Candidate v0.7 | Why test it |
| --- | ---: | ---: | --- |
| Encounter ID | `reference-001` | `reference-001-v07` | Explicit versioning; original preserved |
| Blade Tyrant HP | 1,400 | 1,400 | Do not alter approved HP |
| Blade Tyrant Defense | 55 | 100 | Reduce effectiveness of Attack spam; reward skillful Momentum spending |
| Blade Tyrant Resistance | 60 | 100 | Control ice-weakness burst magnitude |
| Magus starting/max MP | 54 | 35 | Make spell economy relevant; no regen |
| Blade Tyrant Fire affinity | Neutral | Resist ×0.5 | Discourage blindly selecting Fire |
| Blade Tyrant Ice affinity | Neutral | Weak ×1.5 | Give Blizzard an encounter identity |
| Blade Tyrant Lightning affinity | Neutral | Neutral ×1 | Preserve a middle option |
| Phase 1 action sequence | Heavy Slash → Wind Slash → Protect | Heavy Slash → Protect → Wind Slash | Put physical mitigation earlier |
| Phase 2 sequence | Haste → Blade Storm → Heavy Slash | Unchanged | Preserve delayed-cast validation |
| Focus | ×2 next magic | Unchanged | Preserve approved Focus multiplier |
| Shared items | 2 Potion, 1 Mana Vial, 1 Revive Tonic | Unchanged | Preserve approved stock |
| Three-star condition | All heroes alive, zero item uses | Unchanged | Preserve approved mastery condition |

**Exact spell preview against Blade Tyrant (unfocused):** Fire 35, Blizzard 105, Thunder 70 damage. With Focus, corresponding damage doubles, if the focus status is still active when the spell resolves. These values follow the locked formula: `floor(Power × Magic / (50 + Resistance) × affinity × Focus)` with integer rounding once. The boss's early Protect applies to physical, not magical attacks.

## Verified alternative winning fixtures

Two persisted, **independently replayed through the authoritative engine** three-star witnesses are supplied:

- `fixtures/variant-v07-focus.json`: **21 hero actions; victory at tick 72; three survivors; zero items; 7 Magus MP remaining**. Uses one Focus, four Blizzards, two Combo Rush and one Spin Kick.
- `fixtures/variant-v07-no_focus.json`: **21 hero actions; victory at tick 72; three survivors; zero items; 0 Magus MP remaining**. Uses five Blizzards, two Combo Rush and one Spin Kick.

Both finish with 233 total party HP remaining and 6 boss action commitments. Focus's demonstrated upside is **one spell's MP saved**, not faster victory in these specific witnesses. That is a *real tradeoff* but not proof that Focus will be a common or optimal human choice.

## Same-budget bounded search comparison

Under beam width 48, at most 5,000 expansions per probe, 32 max hero actions, both variants were tested with the same search parameters. This is the best **verified witness observed**, not a proven optimum or an impossibility result.

| Counterfactual | Approved reference | v0.7 candidate |
| --- | --- | --- |
| Unrestricted | 3 stars / 17 actions | 3 stars / 21 actions |
| Without Focus | 3 stars / 17 actions | 3 stars / 21 actions |
| Without Brawler specials | 3 stars / 21 actions | 3 stars / 23 actions |
| Without Cover | 2 stars / 17 actions | 2 stars / 21 actions |
| Without healing | 3 stars / 17 actions | 3 stars / 21 actions |
| Without items | 3 stars / 17 actions | 3 stars / 21 actions |
| Without Focus and Brawler specials | 3 stars / 21 actions | 3 stars / 26 actions |

### Interpretation

1. The candidate takes more hero actions in best discovered solutions; that's **more sustained resource pressure**, not automatic evidence of a better puzzle.
2. Removing both setup/burst mechanics increases the best discovered winning route from 21 to 26 actions in v0.7; these moves are *rewarding*, not mandatory. In v0.6 this changes 17 to 21.
3. Two valid three-star routes make Focus a real conservation choice. Nevertheless a no-Focus route still wins at the same tick/action count, so the ability does **not** yet create an unambiguously superior solution.
4. The absence of a no-Cover three-star search witness does **not** prove Cover is required.
5. Healing is still avoidable in searched three-star solutions. We should test additional damage patterns and human play before approval.
6. The heuristic solver normalizes Fire/Blizzard/Thunder in its strategic signature and may undercount distinct elemental plans. Elemental previews and witnessed sequences are replay-verified; do not interpret the stored solution count as number of distinct player strategies.
7. Both variants' boss attacks and target rules remain deterministic. No new statuses or hidden turns were added.

## Windows 11 installation

This is an **overlay** for an existing directory containing Engine v0.1 + Solver v0.2 + Balance v0.3. From PowerShell:

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
Expand-Archive -Path "$env:USERPROFILE\Downloads\daily-boss-battle-encounter-v0.7.zip" -DestinationPath . -Force
npm run typecheck
npm test
node .\scripts\run-variant.mjs
npm run golden
```

Expected: **36 tests pass** (the previous 29 plus seven new tests), and `npm run golden` still produces the original v0.6 win at tick 65 in 19 actions. The comparison runner also writes `reports/encounter-v07-comparison.json`.

Optional lower-budget comparison (speed vs breadth):

```powershell
node .\scripts\run-variant.mjs 24 2200 32
```

Inputs are `beamWidth`, `maxExpansions`, `maxHeroActions`. Higher search budgets are not proof of exhaustive search.

## File manifest

- `src/variant.ts`: independent candidate encounter definition.
- `fixtures/variant-v07-focus.json`: full 21-action Focus golden witness + expected ticks.
- `fixtures/variant-v07-no_focus.json`: full 21-action no-Focus witness + expected ticks.
- `tests/variant.test.mjs`: seven additional regression tests.
- `scripts/run-variant.mjs`: regenerates side-by-side search/balance report and verifies both witnesses.
- `reports/encounter-v07-comparison.json`: example deterministic comparison result.
- `docs/ENCOUNTER-V07.md`: this note.

## Release gate before adopting v0.7

Do not replace Reference 001 with v0.7 on the strength of beam search alone. Review whether the increased duration is fun, whether ice weakness makes other spells uninteresting, and whether the fight should require an intentional heal or defensive status response. Manual playtests and more search seeds/budgets should determine whether to tune boss defenses and Magus MP further. The content remains *candidate* until approved.
