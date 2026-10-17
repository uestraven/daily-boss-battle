# Daily Boss Battle
## Visual Design Specification v1.1 — Revision A (Original Battle Backgrounds)

**Status:** Design specification; implementation not started.  
**Product baseline:** Existing playable React/TypeScript prototype, 12 heroes, six bosses, deterministic Tactical ATB, official daily challenge and practice mode.  
**Approved visual direction:** 16-bit-era JRPG menus: **black outer background, silver window outlines, blue gradient menus**.  
**Purpose:** Guide the replacement of prototype presentation without changing combat mathematics, daily result rules or encounter data.  
**Battle-background art direction:** Original artwork, one purpose-built arena per encounter, in the styles set out in §9. No artwork may be extracted, captured, or traced from another company's game.

---

## 1. Experience target

The experience should resemble opening a polished mid-1990s console RPG menu, not using a dashboard or generic web application. The battle itself occupies a dramatic dark stage surrounded by familiar blue/silver menu windows. All information remains readable without abandoning the classic look.

**Visual principles**
1. **Black is the canvas.** Outside menus and stage imagery, the background is near-black or black.
2. **Blue is the window.** The main interactive panels use a rich cobalt-to-navy gradient. Avoid blue accents on otherwise modern cards; the windows themselves are blue.
3. **Silver defines hierarchy.** Crisp double-line silver edges make windows identifiable. Use square corners, not rounded contemporary cards.
4. **White text carries gameplay.** Keep type compact but readable; numbers are aligned and stable.
5. **The battle is the attraction.** Menus frame the stage rather than overwhelm the boss and the party.
6. **Animation communicates, never simulates.** Rendering never advances Tactical ATB, changes targeting, or modifies damage.

**Non-goals:** parchment UI, glassmorphism, pastel surfaces, huge pill buttons, gold ornament everywhere, extensive background blur, photorealistic RPG character cards, decorative effects that obscure intent.

## 2. Palette and tokens

| Token | Hex or value | Purpose |
|---|---|---|
| `--dbb-bg` | `#000000` | Outer canvas and loading background |
| `--dbb-stage` | `#050910` | Base beneath the battle environment |
| `--dbb-window-top` | `#2950A5` | Menu gradient top |
| `--dbb-window-mid` | `#163575` | Menu gradient middle |
| `--dbb-window-bottom` | `#0A1945` | Menu gradient bottom |
| `--dbb-window-gradient` | `linear-gradient(180deg, #2950A5 0%, #163575 48%, #0A1945 100%)` | Default window fill |
| `--dbb-border-hi` | `#E6ECF5` | Outer silver highlight |
| `--dbb-border-mid` | `#9BA9BF` | Main silver edge |
| `--dbb-border-shadow` | `#53627B` | Inner bevel shadow |
| `--dbb-text` | `#F5F8FF` | Primary text |
| `--dbb-text-muted` | `#CFD8E8` | Secondary text |
| `--dbb-select-top` | `#3862B0` | Selected-menu top |
| `--dbb-select-bottom` | `#22498F` | Selected-menu bottom |
| `--dbb-hp` | `#5DD47F` | HP fill and positive health delta |
| `--dbb-mp` | `#6EC6FF` | MP fill |
| `--dbb-atb` | `#F5C65A` | ATB charge and ready highlight |
| `--dbb-danger` | `#FF8585` | Threat and lethal prediction |
| `--dbb-buff` | `#73E2CF` | Helpful effects |
| `--dbb-debuff` | `#E5A5FF` | Harmful status |
| `--dbb-focus` | `#FFFFFF` | Keyboard focus outline |

### Window geometry
- **Primary window:** 2px silver outer stroke, 1px darker inset stroke, 2px inset inner highlight. Reproduce with CSS layered border and inset box-shadow; do not rely on raster background assets.
- **Corner radius:** 2px maximum; prefer square pixel-like corners. Avoid rounded 12–20px web cards.
- **Shadow:** short, dark and hard-edged, rather than a large soft blur.
- **Spacing:** 4px base grid; typical frame padding 12–16px desktop, 8–12px mobile.
- **Dividers:** 1px muted silver/blue; never overuse separate cards inside each window.
- **Highlight:** selected rows get brighter blue fill plus a visible `▶` or triangular cursor; color alone must not indicate selection.

### Blue-gradient policy
The gradient belongs to the actual 16-bit-style window surface, including commands, statuses, previews and results. Outside the windows, leave the stage black/dark. Do **not** invert this into a predominantly blue application canvas with black modern-style cards.

## 3. Typography

Use a consistently retro-feeling but legible two-tier system. License and self-host any chosen webfonts appropriately; do not bundle assets taken from another game.

| Tier | Suggested face | Size desktop | Size mobile | Use |
|---|---|---:|---:|---|
| Logo / rare scene heading | Custom logotype or licensed pixel display face | 26–38px | 22–28px | Main title, Victory/Defeat |
| Window heading | Silkscreen or equivalent readable pixel face | 16–18px | 15–16px | Boss name, menu headings |
| Commands / status | Pixelify Sans, or readable pixel-inspired sans fallback | 17–19px | 16–18px | Attack, Cure, HP/MP, menu entries |
| Secondary labels | Same body family | 13–15px | 13–14px | Counters, targeting explanation |
| Numeric columns | Tabular-numeral family or font feature | 15–18px | 14–17px | HP, MP, ATB, tick, damage |

- Maintain **at least 16px for essential actionable text** on phones whenever layout permits.
- Use strong, consistent line-height (about 1.3–1.5) rather than compressed bitmap-font text.
- Avoid animations that change numeral width. Make digits tabular and align values to the right.
- Test text contrast against the lightest portion of the gradient, especially selected rows (WCAG AA normal-text target ≥4.5:1).

## 4. Layout architecture

### Desktop and wide landscape (reference design canvas 1280×720)

```text
┌──────────────────────────── TOP STRIP / MODE · UTC DAY ──────────────────────────┐
│  DAILY BOSS BATTLE                              Daily / Practice · Settings  │
├────────────────────────────────── STAGE ─────────────────────────────────────────┤
│ ┌ BOSS WINDOW ──────────────┐   ┌ NEXT ACTION / TARGET / COUNTDOWN ───────────┐│
│ │ Blade Tyrant   HP ▰▰▰▰▱     │   │ Heavy Slash · Brawler · due in 4 ticks        ││
│ └───────────────────────────┘   └──────────────────────────────────────────────┘│
│                                                                                │
│     [BOSS SPRITE / EFFECTS]                             [HERO 1]              │
│                                                         [HERO 2]              │
│                                                         [HERO 3]              │
├────────────────────────────────┬───────────────────────────────────────────────┤
│ PARTY STATUS                   │ COMMAND WINDOW / SUBMENU                      │
│ Warden  HP 247 MP 8  ATB        │ ▶ Attack     Special                           │
│ Brawler   HP 160 MP 0  ATB        │   Magic      Item                              │
│ Magus   HP 116 MP 26 ATB        │   Defend     Back                              │
│                                │ Forecast: 105 ice damage · 7 MP · now          │
└────────────────────────────────┴───────────────────────────────────────────────┘
Battle log: collapsed window, expandable without hiding the active command.
```

**Proportions (design targets, not hardcoded pixels):** top strip 6–8%; stage 48–55%; lower UI 36–42%. Stage battle sprites should be visually larger than menu ornament. Place enemy left/center and heroes on the right in an intentional side-view composition. Do not paint character portraits everywhere.

### Tablet / compact landscape (roughly 768–1199 CSS px)
Reduce stage height modestly, maintain two-column lower area, shorten nonessential labels, and convert battle log to an overlay or drawer. The telegraph stays visible throughout command selection.

### Phone portrait (320–767 CSS px)
- Use a vertically stacked composition: compact title/mode bar → boss HP + telegraph → shorter battle stage → party status (three compact rows) → **bottom-anchored command window**.
- Preserve a single prominent command window; switching to a skill list or target list replaces its content rather than adding more simultaneous panels.
- Keep the selected hero and forecast visible within the command area; detailed calculations can expand in an optional inspection view.
- Minimum interactive touch targets **44×44 CSS px**; support system safe-area insets; avoid horizontal scrolling.
- Landscape may offer a richer battle layout, but portrait must remain fully playable on Android without forcing rotation.
- On small screens, the battle log is a collapsible drawer. Decorative stage height yields before HP/status visibility does.

## 5. Screen specifications

### 5.1 Title / Home

- Black backdrop, small original fantasy emblem or subtle stylized motif, centered product logotype.
- A **single silver-bordered blue-gradient menu** with: `▶ Daily Challenge`, `Practice`, `Records`, `Settings`.
- Below or beside the menu, a compact framed status window: current UTC day, daily completion state, participation streak.
- Avoid an analytics dashboard, marketing hero cards or modern application navigation bar.

### 5.2 Daily Challenge preview

- A prominent blue window titled `TODAY'S CHALLENGE` showing boss, game of origin, three assigned heroes, mastery objective and UTC date.
- `Start Battle` / `Resume Battle` is the primary selected command. If completed, show immutable result and `Practice Replay` instead.
- Preview heroes with consistent sprite slots, names, roles and loadout summaries; avoid unnecessarily revealing future boss attack scripts.
- If an official attempt is in progress, indicate `IN PROGRESS — SAVED` and preserve the exact engine state.

### 5.3 Battle

- **Stage:** dark environment, boss at left/center, three standing heroes at right. Sprite art and effect visuals are independent of combat logic.
- **Boss window:** name, HP / percent, status indicators, phase where appropriate.
- **Intent window:** next action name, target or target rule, damage/status category, due tick / time remaining, clear *lethal* warning when applicable. Announcement changes are visibly logged.
- **Party window:** Warden/Brawler/Magus or other party; names, current/max HP, current/max MP, ATB gauge, positive/negative statuses, character-specific resource (e.g., Momentum) when present.
- **Commands:** classic vertical or compact two-column menu with visible selector and labeled options. Allow `Attack`, `Special`, `Magic` where available, `Item`, `Defend`.
- **Forecast:** exact immediate damage/healing, resource cost, target, resolution timing. Mark conditional or delayed outcomes as such; never present uncertain predictions as guaranteed.
- **Event log:** topmost recent entry first or clearly indicated ordering, collapsible without losing actionable information; support screen readers.
- **Official/practice identity:** persistent subtle mode indicator to avoid confusing practice wins with daily results.

### 5.4 Result

- A dedicated blue silver-frame screen with large `VICTORY` or `DEFEAT` headline.
- Three-star result prominently displayed; show standing heroes, hero actions, items used, mastery requirement status and saved official result.
- `Continue`, `Practice Replay` and `Records` appear as RPG menu commands. Never suggest the player can overwrite a finalized official score.
- Preserve one-star/two-star/three-star rules already approved; this design changes presentation only.

### 5.5 Practice / Records / Settings

- **Practice:** menu list of six bosses/approved variants with fixed party previews; experimental encounter builds visibly marked `PLAYTEST`.
- **Records:** participation and victory streaks, daily history and star records arranged in a classic scrollable window. Tabs may use 16-bit-style label strips but no modern dashboard cards.
- **Settings:** Sound / Animation / Reduced Motion / Text Size / Controls; date reset explained as UTC. Show clearly when progress is stored only on the device.

## 6. Reusable UI component catalog

| Component | Behavior / appearance |
|---|---|
| `FFWindow` | Gradient panel, silver double-edge, 2px square corners, padding variants |
| `FFMenu` | Ordered commands, triangle selection marker, focused/disabled styles |
| `FFStatusRow` | Name, numeric HP/MP, labeled ATB and status strip |
| `FFGauge` | Precise fill with readable numeric label and status at 0 / 100% |
| `FFBossIntent` | Boss action, target, tick countdown, attack type, warning hierarchy |
| `FFForecast` | Valid action cost and exact effect, or clearly qualified delayed estimate |
| `FFSpriteStage` | Sprite placeholders / finished sprites with nearest-neighbor scaling |
| `FFBattleLog` | Expand/collapse, accessible chronological output, no loss of saved events |
| `FFResultWindow` | Victory/defeat, three stars, official/practice distinction |
| `FFModeTag` | Daily vs Practice vs Playtest text+icon indicator |

These components should be used consistently across home, battle and results. Do not duplicate menu styling by screen.

## 7. Interaction contract

**Keyboard:** Arrow keys move the visual cursor, Enter/Space confirms, Escape/Backspace returns one menu level, Tab moves accessible focus. Clear focus outline. Do not steal text-navigation keys when the user is in an editable field.

**Mouse:** Hover highlights; click selects. No gameplay relies on hovering.

**Touch:** Tap rows to select or confirm with appropriately sized targets. Menus remain functional without gestures; no hover-dependent descriptions. Tap an intent to inspect details; close via explicit Back.

**Future gamepad:** D-pad and face-button semantics parallel keyboard. Reserve architecture support, but shipping gamepad support is not required for the first visual pass.

**Actions and time:** Selecting commands must not advance wall-clock-based battle time. Each committed action follows existing Tactical ATB rules. No visual transition may silently execute an action or alter preview values.

## 8. Motion and feedback

| Event | Design treatment | Duration target |
|---|---|---|
| Menu cursor move | Immediate highlight change and discreet menu tick sound if enabled | 0–100ms |
| Window open | Short snap/pop or discrete pixel reveal, no bounce | 100–160ms |
| ATB update | Interpolate displayed fill **only between authoritative engine states** | 100–200ms |
| Physical hit | Brief sprite flash and upward damage number | 280–500ms |
| Healing | Green-number rise and brief highlight | 280–500ms |
| Boss intent change | Emphasized border pulse, label and target updated together | 150–250ms |
| Important special | Small effect burst; very restrained stage shake | 250–550ms |
| Victory | Result-window reveal plus optional short flourish | 400–700ms |

Disable camera shake, flashes and nonessential motion with `prefers-reduced-motion` or user settings. Respect pause-on-selection and avoid time-consuming animations after every trivial event.

## 9. Official battle-background art direction and legal boundary

### 9.1. Required visual intent

Battle backgrounds are **original artwork produced for this game**, one arena per encounter.
The arena should make a particular boss encounter instantly identifiable. No artwork is
extracted, captured, traced, or reinterpreted from another company's game, and generated
scenery is not shipped as final art.

| Boss | Arena | Style |
|---|---|---|
| Tide Maw | Sunken Waterway — flooded cavern and lake | 16-bit pixel art |
| Blade Tyrant | Broken Span — ruined bridge over a chasm | 16-bit pixel art |
| Ink Lurker | Drowned Theatre — abandoned stage | 16-bit pixel art |
| Crush Wall | Sealed Corridor — collapsing passage | 16-bit pixel art |
| Storm Keeper | Stormworks — lightning-struck pipe gallery | Painted backdrop |
| Spell Weaver | Gate Platform — rail platform at night | Painted backdrop |

Composition notes per arena live in `web/src/background-catalog.ts`.

The four pixel-art arenas share one palette depth and one horizon height. The two painted
backdrops keep that camera height but render without pixel-scale filtering; do not pixelate
painted assets. The **UI window system** provides continuity across both styles.

The **black canvas** remains behind and around the play stage, and arena art fills the
stage. Fit without distortion; crop only as needed for device aspect ratios. UI visibility
comes from window positioning, text contrast, and distinct foreground effects.

### 9.2. Asset manifest

Each background is tracked in an asset manifest with fields such as:

- `assetId`, `bossId`, `arena`, `style`, `revision`;
- `artist`, `commissionReference`, `deliveryDate`, `sha256`;
- `licenceBasis` (work for hire, commissioned with assignment, or in-house), `exclusive`;
- `allowedTargets` (local prototype, public website, Android package, iOS package);
- `status` (`wip`, `local_testing`, `cleared_for_distribution`, or `blocked`).

A file enters a build only once `licenceBasis` and `allowedTargets` cover that target. Keep
the signed commission or assignment on record for every shipped asset, including fonts,
sound, and UI textures.

### 9.3. Practical development workflow

1. Write the arena brief from the boss's mechanics: what the player must read at a glance.
2. Commission or produce the art to that brief, with assignment of rights in writing.
3. Review on a 5-inch phone screen at full and at 50% brightness before accepting.
4. Until final art lands, keep the slots filled with clearly labelled in-house placeholders,
   never shipped as final.
5. Record each asset in the manifest at delivery, not at release.

### 9.4. Sprites, effects, and other art

- Make battle background, sprite and effect *slots* part of the layout, not part of battle
  simulation state.
- Hero and boss sprites follow the same original-art rule as backgrounds. Use
  `image-rendering: pixelated` only for genuinely pixel-based assets, preserving
  integer/nearest-neighbour scaling.
- Silver-bordered blue menus are an original CSS implementation of a 16-bit menu style; do
  not bundle UI textures, sounds, sprite sheets, music or fonts taken from another game.
- Clear the title, logo and hero names for trademark conflicts before a public release.

## 10. Accessibility and localization constraints

- Essential text and buttons meet target WCAG AA color contrast against the lightest blue window/selection gradient; do not rely on color alone for statuses or threats.
- Touch targets at least 44×44 CSS px. Pixel art is not an excuse for unreadable type.
- Expose buttons, selected items, gauges and live result announcements with semantic accessible labels and appropriate keyboard order.
- Announce new boss intent in an accessible, non-spammy way; leave the detailed combat log navigable.
- Make low HP obvious through HP value, bar and `LOW HP`/`LETHAL` language, not red alone.
- Design panels for text expansion, including longer spell names and potential localization.

## 11. Implementation sequencing (not yet authorized by this document)

1. **Foundation:** CSS tokens, reusable `FFWindow`, typography, selection cursor, button/navigation and responsive layout shell.
2. **Battle first:** migrate the existing engine-driven battle screen to the visual system without altering battle logic; verify forecast and boss intent remain accurate.
3. **Home and preview:** title menu, daily challenge briefing, practice selector, persisted battle resume.
4. **Result and records:** retro victory/defeat windows, stars, streak/history screens.
5. **Polish and QA:** sprites/effects, settings, reduced motion, touch testing, responsive layout and accessibility review.

Keep official daily logic, battle reducer, seeded AI and fixture data unchanged during the visual redesign. All 78+ existing engine tests should remain valid; add UI interaction and screenshot tests.

## 12. Visual acceptance criteria

A proposed v1.1 implementation is ready for acceptance only when:

- [ ] The first impression is unmistakably **black canvas + silver-bordered, blue-gradient RPG menu windows**.
- [ ] Menus use squared, console-like framing instead of modern rounded cards.
- [ ] A player can identify current hero, boss, targets, HP/MP, ATB and the next boss action without opening a debug panel.
- [ ] All core actions are usable by keyboard, mouse and touch.
- [ ] Desktop 1280×720, tablet landscape, and portrait phone 360×800 layouts work without clipped essential UI.
- [ ] At least 320px-wide portrait devices retain usable essential commands and numerical status information.
- [ ] The game remains playable with reduced motion and without sound.
- [ ] A completed official daily result cannot visually be confused with an unranked practice replay.
- [ ] Golden combat replays and all existing engine tests still pass unchanged.
- [ ] Each boss has its own arena, matching the brief in §9.1 and readable at a glance.
- [ ] Every bundled art asset is recorded in the manifest with artist, licence basis, and allowed distribution targets.
- [ ] No art, music, fonts or interface resources taken from another game enter the distributable app.

## Appendix A — Starter CSS tokens (reference only)

```css
:root {
  --dbb-bg: #000000;
  --dbb-stage: #050910;
  --dbb-window-top: #2950a5;
  --dbb-window-mid: #163575;
  --dbb-window-bottom: #0a1945;
  --dbb-window-gradient: linear-gradient(
    180deg,
    var(--dbb-window-top) 0%,
    var(--dbb-window-mid) 48%,
    var(--dbb-window-bottom) 100%
  );
  --dbb-border-hi: #e6ecf5;
  --dbb-border-mid: #9ba9bf;
  --dbb-border-shadow: #53627b;
  --dbb-text: #f5f8ff;
  --dbb-text-muted: #cfd8e8;
  --dbb-select: linear-gradient(180deg, #3862b0, #22498f);
  --dbb-hp: #5dd47f;
  --dbb-mp: #6ec6ff;
  --dbb-atb: #f5c65a;
  --dbb-danger: #ff8585;
  --dbb-buff: #73e2cf;
  --dbb-debuff: #e5a5ff;
  --dbb-spacing: 4px;
}

.rpg-window {
  color: var(--dbb-text);
  background: var(--dbb-window-gradient);
  border: 2px solid var(--dbb-border-hi);
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--dbb-border-shadow),
              inset 0 0 0 3px rgba(230,236,245,.25),
              3px 3px 0 rgba(0,0,0,.85);
  padding: 12px;
}

.rpg-menu-item[aria-selected="true"] {
  background: var(--dbb-select);
  outline: 1px solid rgba(255,255,255,.7);
}
.rpg-menu-item:focus-visible { outline: 2px solid white; outline-offset: 2px; }
```

**Version boundary:** Visual Specification v1.1 is a design target. It does not supersede the established combat-engine specifications, change the Daily Challenge schedule, or authorize new gameplay balancing changes.
