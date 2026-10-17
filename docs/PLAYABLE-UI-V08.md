# Playable Battle Interface v0.8 (developer playtest)

## What you get

A responsive React + TypeScript + Vite interface connected to the **actual** deterministic v0.1 combat engine. It does **not** duplicate combat formulas or use mock damage values. It allows manual play of two distinct encounters:

- **v0.6 original reference:** 1400 HP Blade Tyrant, original defensive values, original spell affinities.
- **v0.7 candidate:** same 1400 HP, higher defenses, Fire resistance / Ice weakness, 35 Magus MP, earlier Protect.

The approved roster and engine rules are unchanged. The candidate is clearly a *playtest variant*, not published daily content.

Features: hero readiness selection; actions grouped into Attack, Special, Magic, Item, Defend; target selection; precise immediate action preview; channel-time notes; party HP/MP/ATB/status tracking; boss phase, target and countdown telegraphs; combat chronicle; local automatic save and reload per variant; restart; load a verified victory; no official daily attempt tracking.

**Note on forecasts:** `previewAction` is authoritative for immediate actions. Delayed effects show an estimate from the currently known state and explicitly identify it as conditional; intervening states can change it. Enemy targeting is locked according to the engine.

## Windows 11 installation — additive overlay

Prerequisites: existing Engine v0.1 + Solver v0.2 + Balance v0.3 + Encounter v0.7 project, **Node.js 22.12+** and npm.

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\Projects\daily-boss-battle"
Expand-Archive -Path "$env:USERPROFILE\Downloads\daily-boss-battle-playable-v0.8.zip" -DestinationPath . -Force
npm install
npm test
npm run web:build
npm run web:dev
```

Open the local URL printed by Vite (usually `http://127.0.0.1:5173`). `npm run web:dev` builds the headless engine, then runs the Vite dev server. No backend needed.

To build distributable static files:

```powershell
npm run web:build
npm run web:preview
```

The static output goes to `web-dist/` (not `dist/`, which is owned by the headless engine). Use a static HTTP server to host the output instead of opening its `index.html` via `file://`.

## Checks and scope

- `npm test`: existing 36 engine/solver/balance/variant checks + 6 pure UI-integration tests.
- `npm run golden`: original gold replay still intact, tick 65.
- `node scripts/run-variant.mjs`: original v0.7 candidate replay comparisons.
- `npm run web:build`: TypeScript headless engine build, Vite web bundle, and strict web app TypeScript checks.

The UI currently uses localStorage for **developer playtest continuity only**. It intentionally does not implement the immutable official daily result workflow, secure score submission, accounts, or anti-cheat. It also does not include third-party sprites, copyrighted music, or proprietary third-party assets. The boss graphic is a custom inline vector silhouette.

## Architecture

```
src/engine.ts          Existing pure reducer (unchanged)
src/reference.ts       Existing reference encounter (unchanged)
src/variant.ts         Existing v0.7 variant (unchanged)
src/play-ui.ts         NEW pure targeting, action availability & preview presentation
web/src/App.tsx        NEW interactive React battle UI
web/src/style.css      NEW responsive dark 16-bit-inspired presentation
web/vite.config.ts     NEW Vite dev/build configuration
web/tsconfig.json      NEW frontend typing
web-dist/              Generated web bundle (not committed)
tests/play-ui.test.mjs NEW pure UI integration tests
```

**Dependency note:** This package contains source and config, not vendored React/Vite dependencies. `npm install` fetches them on the developer's Windows machine. Source-packaging and the pure engine tests can be verified offline; the browser/Vite build requires dependencies available.
