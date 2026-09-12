# 0.13.5 "Presentation" : DESIGN

Companion to `2026-09-11-presentation-0.13.5-scope.md`, which holds the eighteen-item inventory, the user's decisions, and the phase order. **That document is the scope authority. This one designs the phases.**

**Branch:** `feat/presentation-0.13.5`, off `main` at `9054a32`.

---

## PHASE 1: FOUNDATIONS

The options shell, the intent-grouped tabs, the two new tabs, the global token layer, and the tick-bar fixes. Nothing here needs a mockup, and the token layer is what every later phase inherits.

---

### 1.1 The settings inventory, taken FIRST

The record's own instruction: *"At 0.13.5 design time, INVENTORY the existing settings first (they are currently scattered) and sort every one of them into an intent tab, rather than designing tabs in the abstract."* Done. Eleven persisted preferences plus two save-side gameplay settings.

**DEVICE SIDE (localStorage, via `safeStorage`):**

| Key | What it controls | Module |
|---|---|---|
| `fleet_admiral_theme` | Colour theme | `theme.ts` |
| `fleet_admiral_tick_bar_enabled` | Tick bar shown at all | `tickBarPreference.ts` |
| `fleet_admiral_show_tick_counts` | Raw ticks versus seconds in every readout | `tickReadoutPreference.ts` |
| `fleet_admiral_refine_confirm_enabled` | Confirm before a refine | `refineConfirmPreference.ts` |
| `fleet_admiral_auto_salvage_baseline_warning_enabled` | The Standard-Issue warning dialog (0.13.3.1) | `autoSalvageBaselineWarningPreference.ts` |
| `fleet_admiral_combat_log_style` | Combat log presentation | `combatLogPreference.ts` |
| `fleet_admiral_combat_damage_colors` | Damage colouring in the log | `combatLogPreference.ts` |
| `fleet_admiral_combat_log_speed` | Log playback speed | `combatLogPreference.ts` |
| `fleet_admiral_combat_auto_scroll` | Log auto-scroll | `combatLogPreference.ts` |
| `fleet_admiral_ship_favorites` | Which ships are starred | `shipFavoritesPreference.ts` |
| `fleet_admiral_salvage_confirm_qualities` | ⚠️ LEGACY, see 1.2 | `salvageConfirmPreference.ts` |

**SAVE SIDE (the simulation reads these, so they cannot be device-local):**

| Field | What it controls |
|---|---|
| `autoSalvage: AutoSalvageRules` | The auto-salvage rules, grace window, favourites-protection |
| `salvageConfirmQualities: number[]` | Which quality tiers require a confirm |

**The rule that sorts them**, already established in the record and re-stated here because it is the thing that must not be got wrong: **a setting the SIMULATION reads lives in the SAVE; a device or display preference lives in localStorage.** Anything the tick consults must be in the save or offline stops matching live, which is precisely the conflict 0.13.3 surfaced and resolved.

### 1.2 ⚠️ Three findings from the inventory

**(a) `salvageConfirmQualities` is NOT a dual home, but its module says it is.** The localStorage copy is a READ-ONCE MIGRATION SOURCE: `save.ts` imports `loadSalvageConfirmQualities` to seed the save field in the v39 to v40 step, and nothing writes the key any more. Verified: no caller of the setter or of `salvageNeedsConfirm` outside the module. **But the module header still reads "localStorage only ... (NOT on GameState)"**, which has been false since 0.13.3. Correct the comment during this phase; do NOT resurrect the localStorage path.

**(b) Ship favourites and equipment favourites are stored differently, and only one of them is right.** `fleet_admiral_ship_favorites` is device-local, while 0.13.3.1 deliberately put EQUIPMENT favourites in the SAVE, with a stated reason: *"Favorites are stored in your save rather than on the device, which is what lets them be honored while the game is closed."* Ship favourites have no simulation consumer today, so device-local is defensible, but the inconsistency will surprise a player who stars ships on their phone and sees nothing on desktop. **Flagged, not fixed here:** it is a save-shape change and belongs with a deliberate decision, not smuggled into an options reorg.

**(c) `showTickCounts` is classified as GAMEPLAY in the record and it is arguably VISUAL.** The record's B3 list puts it under Gameplay with the confirms and the auto-salvage rules. It is a pure DISPLAY preference (raw ticks versus seconds), it is device-local, and it reads nothing in the simulation. By this document's own sorting rule it belongs in **Visual**. ⚠️ **Recommendation: move it to Visual, and confirm with the user**, since the record says otherwise and the record is normally the authority. The cost of being wrong is a player looking in one tab and finding it in another.

### 1.3 The tab structure

Grouped by INTENT, per the record: *"options should be easy to sus out based on the tab selection and what you want to do."* The player finds a setting by asking what they are trying to change.

| Tab | Contents | Storage |
|---|---|---|
| **VISUAL** | Theme (as a real dropdown, replacing the colour blots), tick bar on/off, tick-bar STYLE (bar / numeric / pulse, see phase 6), `showTickCounts` (pending 1.2c), the four combat-log presentation settings | localStorage |
| **GAMEPLAY** | Refine confirm, salvage confirm by quality, the auto-salvage rules, the Standard-Issue baseline warning, confirmation PRESETS (see 1.4) | ⚠️ save-side where the sim reads it |
| **ACCESSIBILITY** | UI / text scale, reduced motion, high contrast, colourblind palette, dyslexia-friendly font, force-mobile perspective | localStorage |

**Tabs NOT created now, and why:** Online / Account (0.14.0 has no settings yet), Notifications (nothing to notify), Audio (no sound exists), Exploration (0.15.0). Creating an empty tab for a feature that does not exist is chrome that switches to nowhere, which is the same rule that dropped the single-tab Docks rail.

**The existing System sub-tabs are NOT options and stay where they are:** profile, log, debug, about, patchNotes, community. `options` becomes the parent of the three intent tabs above rather than a flat list.

**The DEV panel** is organised within `debug` and prepared to spin out in 0.14.0 (record item 2). Preparation means: give it a stable seam (its own component and its own state), not that it moves now.

### 1.4 Confirmation presets

Raised during 0.13.3.1 and owed a home: one control that sets every confirmation toggle at once, with named levels (**All Enabled, Tutorial, Beginner, Intermediate, Advanced, All Off**).

⚠️ **A preset must SET the individual toggles, never replace them.** A player picking "Intermediate" and then turning one confirm back on must not have the preset silently override them again. So the preset is a WRITE ACTION, not a stored mode: selecting one writes the toggles and then forgets it was selected. That also means no migration and no new save field.

### 1.5 The token layer

The global readability pass (record item 4, UX review points 4 to 7): type scale, visual hierarchy, WebAIM-AA contrast, max reading width, applied through theme and type TOKENS so one change sweeps every screen.

⚠️ **THIS IS THE PHASE'S RISKIEST ITEM AND IT IS NOT RISKY FOR THE OBVIOUS REASON.** The danger is not that the tokens are wrong; it is that the app currently uses **hardcoded px sizes everywhere**, so a token layer that nothing consumes changes nothing, and a token layer that everything consumes changes every screen at once. The record already flags this for 0.13.2's ships UI.

**Approach:** introduce the tokens and convert screens to them as an explicit, reviewable list rather than a find-and-replace. The conversion is what phase 5's per-screen sweep is for; phase 1 delivers the tokens plus the conversion of the shell and the options screens themselves, so the new options UI is the first consumer and proves the scale.

### 1.6 Tick-bar fixes

Three small live items (UX review points 1 to 3), deliberately grouped because they are one coherent visual update: the tick-bar **80% bug** (live on prod since before 0.13.2 and knowingly deferred to this release), tick-bar **de-emphasis**, and **disabled-control contrast**.

### 1.7 Definition of done for phase 1

```
npm run check                 # 0 errors, 2 expected RadialWeb a11y warnings
npx vitest run                # full suite green
npx vitest run -t "parit"     # excluded baseline EXACTLY 101
npm run build                 # the production bundle compiles
```

⚠️ **`npm run build` is in this list because 0.13.4 shipped six phases without it** and only ran it at release close. check and vitest never bundle, so a build-only failure passes every other gate and surfaces as a failed deploy.

**Expected: NO SAVE_VERSION bump in phase 1.** Everything here is either localStorage or a re-presentation of save fields that already exist. If a bump becomes necessary, that is a signal to re-read 1.1's sorting rule rather than to bump.

---

## PHASES 2 TO 6

Designed after phase 1 lands, so the mockups (phase 3) can react to what the token layer actually looks like on screen rather than to a description of it. The scope document holds their contents and ordering.
