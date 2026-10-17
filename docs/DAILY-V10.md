# Daily Boss Battle — Daily Challenge v1.0

This is a **local playable prototype**, not a server-verified contest.

## What is implemented

- Global UTC calendar date: a new challenge is keyed by `YYYY-MM-DD`, never the user's local midnight.
- Deterministic six-day encounter rotation. Each block of six UTC dates features each of the six bosses once in an independently seeded shuffle, reproducible on every device running the same catalog version.
- Exactly **one local official record** per date. A completed victory or defeat cannot be overwritten by the UI. Abandoning the page before completing the battle does not consume an attempt.
- Resume using JSON state already supported by the pure engine: ATB gauges, boss AI, queued attacks, statuses, items, and target locks are retained.
- Practice Lab offers every existing encounter without changing the daily record. Following a completed official result, **Practice this challenge** starts a separate unranked replay.
- Progress summary includes wins, losses, stars, current participation and victory streaks, and prior incomplete battles.
- Daily witnesses (`fixtures/daily-witnesses-v10.json`) are independently replayed in automated tests for all six pool members. A daily wrapper only changes the encounter ID and catalog version; it does not change its seed, team, boss script, stats, or damage behavior.

## Intentional scope limits

The six daily encounters use the **previously tested three-hero party for each boss**. They are **not arbitrary random three-hero compositions** yet. Mixing freely among all 12 heroes would create many unvalidated matchups; we should add those only after a prepublication validation process can certify each one. A six-day cycle repeats encounter content, though the presentation order varies by cycle. We should grow this vetted catalog as we author more challenges.

The starting pool includes baseline practice encounters. Wins were found by bounded solvers and verified by full deterministic replays, but this is not proof of fairness, optimal difficulty, or multiple viable approaches. Some bosses may still need human playtesting. This is a playtest build, not a claim that all six are production-ready.

Streaks and official results are **only locally enforced** with browser localStorage. Clearing site data, opening a different browser, editing local storage, or using another device can bypass the one-result constraint. A public competitive daily game needs server-issued challenges, result verification, and account/device synchronization. These have *not* been built.

No push notifications, Android packaging, social sharing, accounts, leaderboards, or live challenge publishing are included yet. The frontend still uses original placeholder visuals and no third-party art/audio.

## Files

- `src/daily.ts`: UTC date selection, curated catalog, local daily ledger model, score statistics; pure TypeScript and browser-independent.
- `web/src/App.tsx`: daily/practice switch, official locked result, daily resume, local stats and recent results.
- `fixtures/daily-witnesses-v10.json`: six complete, version-matched winning action fixtures.
- `tests/daily-v10.test.mjs`: deterministic schedule, fixture replays, interrupted games, completed result locking, and stats.
- `scripts/run-daily.mjs`: verified daily result from a specified UTC date.

## Commands — Windows 11 / PowerShell

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
npm install
npm test
npm run golden
npm run daily:check
npm run web:build
npm run web:dev
```

To inspect a different UTC date:

```powershell
node .\scripts\run-daily.mjs 2026-10-16
```

The browser runs the local web server address printed by Vite, typically `http://127.0.0.1:5173`.

**Note:** A production Vite browser build was not executable in the preparation environment because the React/Vite npm packages were unavailable. The engine compiled and the frontend TypeScript source passed a check with temporary type stubs. Run `npm install` then `npm run web:build` on your Windows machine for the definitive frontend build.

## Future development

1. Short hands-on playtest of all six bosses; fix gameplay bugs, not minor numerical imperfections.
2. Curated encounter pool that includes **new role-balanced hero trios**, each validated and stored with a winning witness.
3. Server-authoritative daily issuance and score verification; privacy and account strategy.
4. Daily result share card, calendar/history and notification preference.
5. Android packaging and scheduled local reminders; iOS-compatible architecture thereafter.
