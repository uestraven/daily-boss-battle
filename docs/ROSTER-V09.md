# Daily Boss Battle — Content Baseline v0.9

## Status
**Local playable practice content, not published daily challenges.** The accepted v0.8 Blade Tyrant AI encounter and all previous witnesses remain available and unmodified. The nine added heroes and five bosses use provisional, normalized numbers and need subjective playtesting before daily publication.

### Full approved twelve-hero roster

| Hero | Primary role | Special techniques | Curated magic |
|---|---|---|---|
| The Warden | Guardian | Cover | Cure, Protect |
| **The Lancer** | Striker | Jump (8-tick airborne physical hit) | — |
| **The Oracle** | Healer | Pray (group heal, 3 charges), Aim (pierce) | Cure, Protect, Haste |
| **The Blademage** | Striker | Elemental Edge (ice enchant), Volley (four pierce hits) | — |
| **The Channeler** | Caster | Surge (boost offensive magic while active) | Fire, Fire II, Cure |
| **The Nullifier** | Controller | Nullify (intercept a boss spell; recover up to 8 MP) | Blizzard, Cure, Shell |
| **The Monk** | Striker | Flurry Fist (pierce), Force Cannon (holy magic) | — |
| **The Machinist** | Striker | Rapid Crossbow (group physical), Drill (armor pierce) | — |
| **The Vanguard** | Striker | Rising Cut (3 uses), Cross Cut (2 uses; interrupt a committed cast) | — |
| The Brawler | Striker | Combo Rush, Spin Kick | — |
| The Magus | Caster | Focus | Fire, Blizzard, Thunder |
| **The Thief** | Controller | Steal (once; grants Potion), Plunder (scales with steals) | — |

Bold names are newly implemented in v0.9. The earlier hero profiles were not changed. All hero names, abilities and numbers are **original to Daily Boss Battle**.

### Newly playable boss encounters

| Boss | Fixed demonstration party | Tactical feature |
|---|---|---|
| **Tide Maw** | Lancer · Oracle · Blademage | Weakened tentacles in phase two; AoE Water Spout |
| **Ink Lurker** | Channeler · Monk · Machinist | Slow-inducing Ink and phase-two last-attacker counter |
| **Crush Wall** | Vanguard · Thief · Nullifier | Slow-burn physical crush cast, slot cycle, conditional Protect removal |
| **Storm Keeper** | Lancer · Oracle · Channeler | Tri-Bolt lightning AoE; self-Cure; fire immunity |
| **Spell Weaver** | Nullifier · Blademage · Thief | Elemental attack magic; high-Magic Silence target; late Haste |

Blade Tyrant v0.6, v0.7 and accepted v0.8 remain available from the same encounter dropdown. Every boss action uses the existing seeded, intent-revealed, one-gauge ATB engine.

### Implementation details

- `src/roster.ts`: hero stats, class labels and signature techniques. 
- `src/encounters.ts`: five seeded `EncounterDefinition` objects and their boss AI scripts.
- `src/engine.ts` / `src/types.ts`: small reusable effect extensions (airborne Jump, Nullify absorption, group healing, pierce, multi-hit, personal limited-use abilities, Steal and cast interruption). Existing Blade Tyrant events and golden replays stay unchanged.
- `src/solver.ts`: new resource counters included in search deduplication, to avoid conflating distinct Steal/charge histories.
- `web/src/App.tsx`: new boss options, encounter-specific names and fixed parties, and separate local saves.
- `tests/content-v09.test.mjs`: added roster, script, determinism and command regression tests.
- `scripts/run-roster.mjs`: bounded solver report for all five new bosses; `reports/roster-v09-smoke.json` includes results.

### Preliminary smoke check — NOT an exhaustive fairness guarantee

The initial bounded solver run found a victory for every new encounter. Four have three-star traces. The strongest discovered Storm Keeper trace was two-star; no three-star win was established under this search budget. The early encounters may be easier than Blade Tyrant; that's fine for content prototyping, not yet an approved difficulty curve. Solvability in a bounded search does not certify fun, balance, uniqueness, or suitability for a daily release.

### Known scope limits

1. Boss artwork is a temporary **original placeholder silhouette**, shared between opponents; no third-party sprites or music are distributed.
2. The demo sets a fixed three-hero party per boss, as our official daily system will do. Party switching/custom rosters and archived daily challenges are future features.
3. No universal Reflect, instant-death, row positioning, or equipment progression was added; they remain outside the locked initial rules.
4. Each new encounter currently uses the game's default **no-items** practice mastery condition, pending individual encounter-specific mastery objectives.
5. A prebuilt Vite production site could not be validated in this environment because the npm registry was unavailable. The TypeScript battle engine and test suite were verified here. UI TypeScript was syntax/type checked with temporary minimal React declarations; run `npm install` and `npm run web:build` on Windows to verify against real React/Vite types.

### Windows 11 commands

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
# Extract the v0.9 Update ZIP into this existing folder first.
npm install
npm test
npm run roster:check
npm run golden
npm run web:build
npm run web:dev
```

To start with the full ZIP instead, extract its `daily-boss-battle` folder directly under your `Projects` directory. Choose a boss from the browser's **BATTLE VERSION** dropdown to play its preset party.
