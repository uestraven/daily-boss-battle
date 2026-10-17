# Daily Boss Battle — Battle Balance v0.3

**Additive overlay:** Apply this to the existing v0.1 combat engine after installing Solver v0.2. No engine, encounter, witness, or existing solver source is replaced. This milestone adds *diagnostics*, not new combat mechanics.

## Install on Windows 11 (PowerShell)

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
Expand-Archive -Path "$env:USERPROFILE\Downloads\daily-boss-battle-balance-v0.3.zip" -DestinationPath . -Force
npm test
npm run golden
npm run solve
node .\scripts\run-balance.mjs
```

If your project lives elsewhere, change only `cd`. Existing `package.json`, `package-lock.json`, TypeScript configuration, and source files stay unchanged. The overlay includes a sample generated report under `reports/reference-001-balance-v03.json`. Rerunning the command replaces that sample locally.

**Expected:** 29 tests pass (original 18 + Solver's 6 + this overlay's 5); original golden still wins at tick 65 with 19 actions; the new balance script writes `reports/reference-001-balance-v03.json`.

Optional shorter command:

```powershell
npm pkg set 'scripts.balance=npm run build && node scripts/run-balance.mjs'
npm run balance
```

After you edit the TypeScript source, run `npm run build` before invoking `node .\scripts\run-balance.mjs` directly.

## What the report does

The new `src/balance.ts` provides:

- `auditWitness(def, actions)`: independently replays the whole action list with the authoritative reducer and summarizes HP, MP, boss and party damage, healing, item usage, actions by ability, and phase events.
- `analyzeEncounter(def, goldenActions, options)`: runs the golden witness and seven bounded counterfactual searches, independently replays all returned winning traces, then writes advisory findings. There are no game-balance mutations.
- Seven probes: unrestricted; without Focus; without Combo Rush/Spin Kick; without Cover; without healing (Cure, Potion, Revive Tonic); without items; and without all Focus/Brawler specials.
- Three existing baseline policies: Attack-only, Defend-only, greedy immediate damage.
- Deterministic JSON output suitable for storing in CI or a future encounter review dashboard.

Each search is capped independently. CLI arguments can adjust search breadth:

```powershell
# beam width 96; expansion budget 12000 per probe
node .\scripts\run-balance.mjs 96 12000
```

A larger budget may find solutions missed by a smaller search. All results state that truncation is present. **Do not interpret absence of a witness as proof that a winning strategy is impossible.** Multiple traces also do not automatically mean qualitatively different player strategies. These metrics are not player win-rate estimates.

## Default observations for Reference Encounter 001

| Search configuration | Best verified stars found | Shortest stored winning trace |
|---|---:|---:|
| Unrestricted | 3 | 17 actions |
| No Focus | 3 | 17 actions |
| No Combo Rush/Spin Kick | 3 | 21 actions |
| No Cover | 2 | 17 actions |
| No Cure/Potion/Revive Tonic | 3 | 17 actions |
| No items | 3 | 17 actions |
| No Focus or Brawler specials | 3 | 21 actions |

At 48 beam width, 5,000 expansion budget per probe, 24-action maximum, all searches were truncated. These are **observed** outcomes, not theoretical upper bounds. The no-Cover probe only found a two-star winner within those limits; it does not establish that Cover is mathematically required for three stars.

The golden witness remains a three-star no-item win at tick 65 with 19 hero actions. Its audit includes 1,400 actual damage to Blade Tyrant, three Cure spells restoring 150 HP total, and 562 incoming party damage.

A further design observation: Fire, Blizzard and Thunder have identical costs/power in this boss encounter with no elemental affinity. They are tactically equivalent here. That may make Magus's elemental choice feel cosmetic until an encounter includes disclosed weaknesses/resistances.

## Proposed review priorities — *not approved balance changes*

1. **Incentivize character identity:** Test a future, separate encounter revision where Focus's single-spell burst or Brawler's Momentum matters because of a known timing window. Avoid forcing only one valid combo.
2. **Preserve a survival puzzle:** Warden's Cover is a promising counterplay mechanic; examine other ways to survive the first telegraphed attack before concluding Cover is required.
3. **Introduce meaningful elemental tradeoffs:** Include a visible boss affinity or an elemental reaction in a *new version* of the content; don't change the approved reference fixture in place.
4. **Measure human enjoyment:** Search results prove only that code can win; usability and perceived fairness need real playtests.
5. **Future solver work:** Improve strategic diversity classification, enlarge state-space coverage, and add reduced-state exhaustive tests. Do not claim all possible winning paths have been found.

## Files in this overlay

- `src/balance.ts` — replay audit and bounded counterfactual probes.
- `scripts/run-balance.mjs` — human-readable console report plus JSON output.
- `tests/balance.test.mjs` — five new regression tests.
- `docs/BALANCE-V03.md` — this guide.
- `reports/reference-001-balance-v03.json` — generated sample report.

## Compatibility / versioning

The `EncounterDefinition` remains `reference-001`, `engineVersion: 0.1.0`, `contentVersion: 0.6-approved-tuning`. **Blade Tyrant 1,400 HP; Focus ×2; Blade Storm four-tick cast; three-star no-items objective are unchanged.** This overlay intentionally modifies no executable combat rule, so the 18-test engine golden fixture remains valid.
