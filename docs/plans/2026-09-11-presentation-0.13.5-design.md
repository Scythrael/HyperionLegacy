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

> ⚠️ **THIS SECTION WAS WRONG AND IT SHIPPED THE WRONG FEATURE. Corrected 2026-09-12, see 1.4a.**

Raised during 0.13.3.1 and owed a home: one control that sets every confirmation toggle at once, with named levels (**All Enabled, Tutorial, Beginner, Intermediate, Advanced, All Off**).

⚠️ **A preset must SET the individual toggles, never replace them.** A player picking "Intermediate" and then turning one confirm back on must not have the preset silently override them again. So the preset is a WRITE ACTION, not a stored mode: selecting one writes the toggles and then forgets it was selected. That also means no migration and no new save field.

### 1.4a ⚠️ CORRECTION: the interaction model was already specified, and this doc dropped it

*User, 2026-09-12: "The confirmation level settings implementation doesn't match what we had discussed at all. No checkboxes, no dropdown, no 'custom' mode that prompts you to confirm if you have edited your settings manually, all on its own tab for things like this." Verified against the record: they are right on every count.*

**SUGGESTIONS.md already carried the refined model**, marked ✅ and attributed to the user on 2026-09-11:

> individual checkboxes AND a preset dropdown, side by side. Editing any checkbox flips the dropdown to **Custom**. Changing the dropdown raises a confirmation asking whether to overwrite the current settings with that preset; **Apply** overwrites, **Cancel** reverts the dropdown to what it was.

plus three more requirements in the same entry: confirm **only** when the current state is Custom (switching between clean presets destroys nothing, so a dialog there is the nagging the feature exists to remove); the preset confirm is **not itself a managed dialog** (otherwise "All Off" disables the protection on the control that sets "All Off"); and a **help box beside the selector**, explicitly not in the manual.

⚠️ **1.4 compressed all of that into one sentence about write actions, and the build followed 1.4.** Three buttons shipped: no checkboxes, no dropdown, no Custom, no help box, and only two of the three managed settings governed. **The detail was never missing. A thin design doc is what lost it**, which is the identical failure mode recorded for 0.11.2 and the reason "verify notes before build" is a standing rule. The lesson that generalises: when a design section is SHORTER than the record it summarises, that is a signal to re-read the record, not evidence the item is simple.

**WHAT WAS BUILT INSTEAD (`src/lib/confirmationPresets.ts` plus a Confirmations tab):**

1. **Its own tab.** The cluster is a dropdown plus a help box plus every checkbox, which would dominate a tab it was a guest in. Gameplay keeps what the game DOES on its own (the auto-salvage rules); Confirmations holds what it ASKS.
2. **Checkboxes and the dropdown together.** Only the dropdown makes the preset a cage; only the checkboxes makes a multi-dialog game a multi-step chore.
3. ⚠️ **The selected level is DERIVED, never stored**, which is a deliberate improvement on the record's "one more stored value". A stored id is a second source of truth that can disagree with the checkboxes, i.e. exactly the stale-label bug the record warns about two bullets earlier. Deriving makes it **unrepresentable** rather than merely tested for, and needs no key and no migration. The price is that the rungs must be pairwise DISTINCT, which is asserted.
4. ⚠️ **Six honest rungs needed a graduated setting.** Two booleans give four states, so a six-rung ladder on booleans alone would ship duplicate rungs, and a duplicate rung makes the derived label ambiguous. The **per-quality salvage confirm** supplies the middle steps: each rung stops asking about one more band of cheap gear before the booleans switch off. The ladder is asserted **MONOTONE** (each rung strictly fewer confirmations than the one above), so the names cannot come to mislead.
5. **The overwrite confirm**, gated on Custom only, excluded from the managed set.
6. **Per-quality confirms are GOVERNED here but EDITED in the bay.** A preset writes them (they are what makes six levels mean six things), but the six-tier grid already exists beside the gear, so this tab reports the count and links. One editor per field.

⚠️ **Two named settings in the record do NOT exist as toggles** (verified: no preference module, no gate): the **batch confirm** and the **no-grace warning**. They are not managed. The unconditional destructive confirms (Delete Save, respec, captain-aboard salvage) are also excluded: they have no toggle at all, so putting them under "All Off" would mean BUILDING a way to skip them. Both groups are logged rather than smuggled in.

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

## ✅ MOCKUPS APPROVED (user, 2026-09-12). THE BUILD SPEC IS `2026-09-12-presentation-0.13.5-approved-mockup.html`.

Three revisions, sixteen questions, all settled. **The interactive mockup in this folder is the
reference the build follows**; the briefs below explain WHY each thing is the way it is, but where
the two ever differ, the mockup wins. Artifact copy: https://claude.ai/code/artifact/ac3f2583-fcbd-4229-b696-0eb9ef816a70

### The settled decisions, in one place

**HEADER (briefs 1 + 3)**
- Compact is the default and **keeps the EXP bar** (a short bar plus the number, not numbers alone).
- Expanding **PUSHES**, taking vertical space from the main pane while open. Not an overlay.
- A **chevron** expands it, not tap-anywhere: the bar holds the portrait and the gear, and
  tap-anywhere would swallow both.
- **Desktop defaults to expanded** with the rows two-up. Same component, different default.
- The state is **remembered per device** (localStorage, per the release's storage rule).
- ⭐ **The credits and fuel chips become a CURRENCY BUTTON and a FUEL BUTTON**, each with its own
  popup (user, revision 2). ⚠️ Two buttons rather than one merged list, because **fuel is not a
  currency** and there will be several of each; one list would file two kinds of thing under one
  wrong label. Each button's face shows the favourited total; ★ in the popup marks what appears on
  the face, which is the hook the favourite-a-currency idea plugs into with no extra structure.
- The **gear** is a square peer control beside the portrait, same size, opening System on Settings.
- **Crafting level** is amber, so it reads as a sibling of FA level rather than a duplicate.

**SETTINGS (brief 2)**
- Section layout: caps title, **the divider stays**, bold labels, **6px gaps** between sections
  (matching the Recently Completed rhythm).
- Every description moves into a **`?` floating tooltip**: hover on a pointer, **tap on touch**,
  dismissed by moving off or tapping away. ⚠️ It opens **below-left, anchored to the row**, so it
  never covers the control it describes, and it **FLIPS ABOVE** when it would otherwise fall below
  the fold (user: "as long as the tooltip doesn't appear below the visible screen"). A help bubble
  you have to scroll to find is worse than none, because you do not know it is there.
- Control vocabulary: **toggle for a feature that can be OFF, dropdown for a value picked from a
  list** (even a two-item list), checkboxes for a set.
- The **square toggle**: 44x22, squared corners, knob glowing in the accent token. ⚠️ A real
  `role="switch"` with `aria-checked`, keyboard activation and a focus ring. ⚠️ Its OFF state uses
  the **dim** text token, never `--color-text-disabled`: an off toggle is fully interactive, and
  that token means "you cannot use this".
- **Auto-salvage quality stays a THRESHOLD dropdown** for 0.13.5 (user), pending their rework of how
  quality is expressed. No save migration this release. Its `?` carries both the "off is not the
  same as Q0 and below" explanation and the "your values are kept when a rule is switched off" note.
- Progressive disclosure **must not reset hidden values**.

**RECENTLY COMPLETED (brief 4)**
- Compact one-liner: `time · Verb: Item × N`. **Clock time in the player's own timezone**, in a
  **fixed-width 68px column** so the dot and summary start at the same x on every row.
- **Duration moves to the expanded view.** Dropping "over mm:ss" is what buys the alignment.
- ⚠️ **Age survives in the expanded "When" line** ("20h ago (11:09 PM)"), so the "what did I miss
  while away" answer is demoted rather than lost.
- Expanded view is a labelled list: Entry source / Action / Time elapsed / When, plus a labelled
  jump button. ⚠️ **Entry source is the ONE new field**; everything else is an existing
  `CompletionRow` property.
- **A chevron expands and the row KEEPS its jump.** Losing the one-tap jump would remove a feature
  that exists to save taps.
- Rows expand **independently**, not as an accordion.
- **A "show more history" toggle**, off by default, keeping the current limit until switched on,
  with **symmetric divider and spacing above AND below it** once expanded.

---

## PHASE 3 BRIEF: THE HEADER REDESIGN (added 2026-09-12, user)

Phase 3 is the mockup phase, and this is its first concrete subject. Recorded now, while the
reasoning is fresh, so the mockup starts from an inventory rather than from memory.

### What the header carries today

```
.top-bar
  .top-bar-header
    .top-bar-portrait          <- the ONLY route into Options
      .portrait-gear-badge     <- a small gear, rendered ON the portrait
    .top-bar-info
      "Fleet Admiral - Level N"
      Exp: [====------] 4.86M/50.7M [9.6%]
  .top-bar-currencies          <- credits, fuel
  .top-bar-tick-row            <- TICK: [====------] 0.4s   (optional)
```

### The three asks

**1. A SQUARE GEAR BUTTON for Options.** The user: *"a great deal more obvious than 'tap your
portrait'."*

⚠️ **THE GEAR ALREADY EXISTS, WHICH SHARPENS THE PROBLEM RATHER THAN DISSOLVING IT.**
`.portrait-gear-badge` renders a gear on the portrait today. So the issue is not a missing
affordance, it is a SUBORDINATE one: a badge sitting on an avatar reads as decoration, and the
avatar reads as "your profile", not "settings". Making it a PEER control (its own square button,
its own hit target, beside the portrait rather than on it) is the change. Same family as the
contextual-help `?` button already logged: **a visible affordance beats an invisible one**, and a
badge on another control is closer to invisible than it looks.

**2. CRAFTING LEVEL IN THE HEADER.** It is a GLOBAL progression stat, not a facility's property:
`refineJob`, `fabricateJob` and `shipBuild` all award crafting XP, yet the Fabricator shows a full
panel, the Refinery a one-line mention, and **the Shipyard nothing at all despite awarding it**.
Three facilities feeding one number, presented three ways.

The strongest argument for the header is that **crafting level is the same KIND of thing as Fleet
Admiral level**, and FA level already lives there for exactly that reason. It should read as a
sibling, not an invention.

⚠️ Counterweight to design against: the header is prime real estate on a phone and already carries
three rows. A fourth costs vertical space on EVERY screen forever, to show a number that matters
mainly while crafting. The compact-pill option exists precisely to avoid that.

**3. THE TWO PLATFORMS DIVERGE HERE, and this is the clearest example of why phase 4 exists.**
- **MOBILE: preserve the current look.** User: *"pretty much mirror the exact look it currently
  has. That one isn't going away."* Mobile is a constraint satisfaction problem: fit crafting level
  in without growing the header.
- **DESKTOP: use the space.** User: *"the desktop version doesn't make good use of the space it
  has, leading to the whole option for desktop evolving in a different direction."* Desktop has
  horizontal room the mobile layout simply ignores. A header that is cramped on a phone and
  half-empty on a monitor is the single most visible instance of the mobile-stretched-to-desktop
  problem the platform split exists to fix.

### What the mockup must answer

1. Where the gear button sits, at a real touch target size, without crowding the portrait.
2. Whether crafting level is its own row, a pill on the FA row, or something else entirely.
3. What desktop does with its horizontal space that mobile cannot (side-by-side rows? the
   currencies and both progression bars on one line?).
4. Whether the tick bar's row survives the reshuffle or folds in.

⚠️ **DO NOT BUILD THIS BEFORE THE MOCKUP.** It is a spatial layout, which is precisely the category
the user's standing rule covers, and the last time a layout was built from a text description it
missed the intent.

---

## PHASE 3 BRIEF 2: THE OPTIONS INFORMATION ARCHITECTURE (added 2026-09-12, user)

The header redesign brief above is the first mockup subject; this is the second, and the two are
connected (ask 1 of the header brief IS the gear button this brief depends on). Recorded now while
the reasoning is fresh. ⚠️ **Nothing here is built yet, at the user's own instruction ("should
ultimately be flagged for implementation, likely in a later phase still").**

### What the user asked for

1. **The Salvage Bay RULES move into Options > Gameplay** and become the real editor there, not a
   link. The Gameplay section becomes "the new and improved version of the rules section".
2. **Auto-Salvage gets a TOGGLE**, specifically a square-cornered slider rather than the usual pill:
   off is left and greyed a little, on is right and brighter with the knob glowing in the current
   theme. ⚠️ **When it is ON, the quality and rarity checkboxes appear**, plus a **"Duplicates Only"**
   checkbox. (iPhone-settings shape, squared off.)
3. **SAVE DATA moves to a new tab named SYSTEM**, placed last, after Accessibility. It becomes the
   home for 0.14.0 save handling (delete, maybe cloud, maybe a force-save).
4. **A "UI THEME" section** for background visualisation, skin, colour theme and so on.
5. **Options leaves the portrait modal and gets its own header button.** Profile stays in the portrait
   modal, which may become account-wide detail.
6. Open, and asked of me directly: does Save Data deserve its own tab or should it be folded in? Does
   everything except Profile move to System? **"It is hard to tell if I am trying to organise things
   too heavily."**

### ⚠️ FOUR FINDINGS BEFORE ANY OF IT IS DESIGNED

**(a) "Duplicates Only" ALREADY EXISTS, so item 2 is smaller than it looks.** `AutoSalvageRules`
carries `duplicates: boolean` ("auto-queue duplicates beyond keepPerVariety") alongside
`keepPerVariety`, which is fixed at 1 this release. So the ask is a presentation change, not engine
work: the rule is live and already honoured offline. Same for the master switch, which is
`enabled: boolean` today, rendered as a plain checkbox. **The toggle is a reskin of an existing
control, not a new capability.**

**(b) ⚠️ "CHECKBOXES FOR QUALITY" COLLIDES WITH A DELIBERATE DECISION, and the reason is written into
the code.** Auto-salvage quality is `maxQuality: number | null`, rendered as a SELECT on purpose:

> A SELECT, NOT A CHECKBOX, and deliberately. maxQuality has THREE kinds of value, not two: null
> means the rule is off, and 0 is a real and useful setting ("Q0 and below"). A truthy control would
> collapse those two into one and quietly turn the most common setting into no rule at all.

It is likely the user is picturing the **per-quality salvage CONFIRM** checkboxes (Q0 to Q5, which
genuinely are checkboxes and sit in the same console), and reasonably expects the two quality
controls to look alike. Two routes, and the second is a save change:

| Route | What it is | Cost |
|---|---|---|
| **Keep the threshold** | Quality stays a select ("Q3 and below"), rarities stay checkboxes. | Free. But two quality controls in one facility look different, which is what prompted the ask. |
| **Make quality a SELECTION** (worth considering) | `maxQuality` becomes a per-tier record like `rarities`, so every quality control in the game is a checkbox row. No tier checked means the rule is off, which dissolves the three-state problem rather than working around it. | A save-shape change plus a migration (threshold N becomes tiers 0..N checked). Strictly more expressive: a player could auto-salvage Q0 and Q4 while keeping Q1 to Q3, which a threshold cannot say. |

**(c) THE SQUARE TOGGLE IS A NEW CONTROL PRIMITIVE AND SHOULD BE BUILT AS ONE.** It will not stay in
one place: the moment it exists, every boolean in the options screens will want it. So it is a
component (`Toggle.svelte`), the way `SettingRow` was, rather than markup pasted into the Salvage Bay.
Three constraints the mockup must respect:

- ⚠️ **Accessibility.** A styled `<div>` is not a checkbox. It needs `role="switch"`, `aria-checked`,
  keyboard activation (Space and Enter) and a visible focus ring, or it is a control a keyboard or
  screen-reader user cannot operate at all. Same class of problem the colour-blot theme picker had.
- ⚠️ **"Greyed out a bit" must NOT reuse the DISABLED token.** An OFF toggle is not a disabled
  control: it is fully interactive and its label must stay readable. `--color-text-disabled` exists
  for controls you cannot use, and a fresh contrast hole is exactly what 0.13.5 just closed twice.
- **The glow is theme-linked** (`--color-accent`), never a literal, so it recolours with the theme
  and with a future skin or icon pack.

**(d) PROGRESSIVE DISCLOSURE MUST NOT RESET ANYTHING.** Hiding the quality and rarity rows when the
toggle is off is good (an off rule's detail is noise), but the values must survive being hidden and
re-shown. A player who switches auto-salvage off for an evening and back on must find their rules
exactly as they left them. Hiding is a VIEW change; clearing would be a data change, and this project
does not silently discard a player's settings.

### MY ANSWERS TO THE OPEN QUESTIONS

**Options in its own header button: yes, and it is ALREADY LOGGED.** Ask 1 of the header brief above
is a square gear button as a peer control, for the reason given there: a badge on the portrait reads
as decoration. So item 5 is not new scope, it is confirmation of a direction already recorded. It
also dissolves the "two instances of System" worry: once Options leaves the portrait, the portrait
modal is identity and reading material, and System is a tab INSIDE Options. They never appear side
by side.

**Save Data in its own System tab: yes.** That is why it was pulled out of Visual in the first place:
it is not a setting, so no intent tab was an honest home and it currently floats below the tab strip.
A System tab gives it a real one, and 0.14.0's cloud handling needs one anyway. Do NOT fold it into
another tab; folding is how it ended up under the theme picker.

**"Does everything except Profile move to System?" No, and there is a cleaner cut: SPLIT BY VERB.**
The portrait modal currently holds Profile, Options, Log, About, Patch Notes, Community and Debug.
Those are two different kinds of thing:

| Where | What | Why |
|---|---|---|
| **Portrait modal** = things you LOOK AT | Profile, Log, About, Patch Notes, Community | None of them changes anything. They are identity and reading material, and a player opening them is browsing, not configuring. Burying Patch Notes inside a System tab of an Options menu would make them harder to find than they are today. |
| **Gear button** = things you CHANGE | UI Theme, Gameplay, Confirmations, Accessibility, System | Every one of them writes a setting. |
| **Debug** | into Options > System, still DEV-only | It is a settings-shaped tool, not reading material. |

That split is predictable without learning a taxonomy, which is the real test of whether an
information architecture works.

**"Am I organising too heavily?" One specific place, yes: item 4 collides with a tab that exists.**
"UI Theme" holding background visualisation, skin and colour theme describes what the **Visual** tab
already holds (theme dropdown, tick bar, tick-bar style). Adding UI Theme beside Visual would give
the player two tabs that both plausibly own "where is the theme?", which is the exact failure the
intent tabs were created to fix. **Recommendation: RENAME Visual to UI Theme (or Appearance) and let
it absorb skins and backgrounds.** Five tabs, not six:

```
UI Theme  |  Gameplay  |  Confirmations  |  Accessibility  |  System
```

Everything else in the ask adds a tab holding something genuinely distinct, so the count is earned
rather than administrative. ⚠️ **The honest ceiling is around five or six**: past that a player hunts
instead of predicting, and the requirement was "easy to sus out based on the tab selection".

### What the mockup must answer

1. The square toggle at a real touch-target size, in all three states (off, on, focused).
2. Whether the migrated rules panel keeps its current density inside an Options tab, which is
   narrower than the facility console it lives in today.
3. Whether quality becomes a checkbox row (finding b) BEFORE the panel is drawn, since it changes the
   panel's shape.
4. Where the gear button sits, which the header brief above already has to answer.

---

### ⚠️ REVISION 2 (user, 2026-09-12, after seeing the built Visual tab). SUPERSEDES the naming and tab list above.

The user reviewed the recommendation above and changed one thing, then settled several of the open
questions with their own answers. **This subsection is the current decision record; where it differs
from anything earlier in this brief, this wins.**

#### The tab name, and Accessibility

> "UI Theme as a replacement for visual doesn't fit. Visual doesn't either. How about **UI Settings**.
> Also. Perhaps if it's UI Settings, **accessibility can be folded into that with its own category**."

Adopted. "UI Theme" was my suggestion and it was too narrow: the tab holds tick-bar behaviour, readout
format and combat-log presentation, none of which is a theme. "UI Settings" covers all of it and makes
the fold legal, because an accessibility control IS a UI setting. **UI Theme survives as a SECTION
name inside it**, which is where it was always accurate.

⚠️ **THE ONE COST, and it is worth stating before it is built: folding Accessibility into another tab
makes it harder to find for the people who need it most.** A player who needs a bigger text size is
the least able to hunt through a settings screen for it. The mitigation is that it keeps a visible
uppercase section header in the scroll (not a collapsed group), and it should be the FIRST section in
the tab rather than the last. If that still feels buried when it is on screen, promoting it back to a
top-level tab costs nothing later.

**THE RESULTING STRUCTURE:**

```
GEAR BUTTON (header)              PORTRAIT (identity + reading)
  UI Settings                       Log        <- plus error capture, see below
    - Accessibility (first)         Patch Notes
    - UI Theme                      Community
    - Tick bar                      About      <- LAST
    - Readouts                      Debug      <- home undecided
    - Combat Log
  Gameplay
  Confirmations
  System  -> Save Data only, for now
```

#### The questions the user answered themselves

**"Should Profile live on Crew > Admiral instead?" Yes, and it solves the question it was asked about.**
Their reasoning is sound on both ends: the Admiral screen "feels pretty empty" and Profile is identity
data that belongs beside the Admiral it describes. It also dissolves the "is splitting System into two
pieces viable" worry entirely, because once Profile leaves there is no split to make: the gear button
holds settings, the portrait holds reading material, and neither contains a stray copy of the other.
⚠️ **Verify the Admiral screen's actual layout room before building**, rather than assuming empty.

**"Is a System tab holding only Save Data too thin?" No, and the evidence is already in this release.**
Save Data spent 0.13.5's first pass folded into the Visual tab purely because that tab existed around
it, and the result was that Export lived under the theme picker where nobody would look. A thin tab
that is obviously correct beats a fat tab that hides something. It also fills on its own schedule:
0.14.0 brings cloud save handling, which needs exactly this home.

#### Section layout: the spec, taken from the Combat Log screenshot

The user pointed at the built Combat Log section as the model and asked for it everywhere. Pinned so
the mockup starts from a spec rather than a screenshot:

| Element | Decision |
|---|---|
| Section name | Uppercase, letter-spaced, accent-bright, slightly larger. **Keep as is.** |
| Divider under it | **Keep.** User: "the divider is niiiice. That must stay. Helps emphasize a section." |
| Gaps | ⚠️ **A few pixels of real space between sections**, so each reads as its own pane rather than as one continuous panel cut by rules. This is the change: today the divider is doing a job that white space should be doing with it. |
| Option label | **Bold**, the way "Theme" already renders. |
| Description text | ⚠️ **MOVES OUT of the row and into a `?` help affordance beside the label.** |
| Shape | `Theme Selector [ ? ] :  [    Red    ]` |

⚠️ **THE `?` MUST BE CLICK/TAP ACTIVATED, NOT HOVER-ONLY.** The user wrote "hover over/click on", and
the click half is the load-bearing one: hover does not exist on a phone, and this game is played on
one. A hover-only help affordance would hide every explanation in the settings screen from the primary
platform. It also needs keyboard focus and dismissal, and it is DISPLAY-ONLY (the project's standing
tooltip rule: tooltips never carry actions).

⚠️ **NO INFORMATION IS LOST IN THE MOVE.** The tooltip text is today's description verbatim, not a
shortened version. The point is to unclutter the row, not to explain less. Worth a check during the
mockup: a settings screen where every explanation costs a click is cleaner to look at and slower to
learn from. My read is that it is the right trade here **because the labels are good**, and a vague
label plus a hidden explanation would not be.

#### Control vocabulary: dropdowns and toggles, nothing else

> "Anything that has an On or Off button should get the toggle primitive. Log Style should have a
> dropdown like theme. Log speed should have the same treatment too. Basically, dropdown boxes or
> toggles feel like the cleanest ways to present options."

Adopted as a RULE rather than a list of three edits, because a rule is what stops the next setting
inventing a fourth control:

| The setting is | The control is |
|---|---|
| Two states (on/off) | The square toggle primitive |
| Three or more named choices | A dropdown |
| A set (several independent flags) | Checkboxes |

That covers every option in the game today. ⚠️ It also RETIRES the segmented `.dev-btn` pairs
(Log style, Damage colors, Log speed, Auto-scroll), which is a real simplification: those are four
different-looking controls doing two jobs. The conversion is mechanical once `Toggle.svelte` exists,
and it is the reason the toggle should be built first.

⚠️ **The three-state trap from finding (b) applies to the dropdowns too.** Log speed is Fast/Slow
today, which is two states, so it would be a toggle by the rule above. But the user asked for a
dropdown, and they are right for a reason the rule misses: Fast/Slow are NAMED VALUES, not on and off.
A toggle implies "this feature, enabled or not", and "log speed, disabled" means nothing. **Refined
rule: a toggle is for a feature that can be OFF; a dropdown is for a value chosen from a list, even
when the list has two entries.**

---

### ⚠️ REVISION 3 (user, 2026-09-12). THE NAMING CONVENTION. Supersedes revision 2's tab list.

**The user established a four-level vocabulary, and it should be used in every doc and commit from
here on, because most of the confusion in revisions 1 and 2 was two people using "tab" for three
different things:**

| Level | Meaning | Example |
|---|---|---|
| **WINDOW** | The modal the portrait opens | **System** |
| **TAB** | A top-level destination inside a window | Patch Notes, Community, Bug Report, **Settings**, About |
| **SUBTAB** | A grouping inside a tab | **UI**, Gameplay, Confirmations |
| **SECTION** | A labelled block inside a subtab | **Salvage Bay**, UI Theme, Accessibility, Combat Log |

**WHAT THIS CHANGES FROM REVISION 2, and why my "COMMS" suggestion was wrong.** I proposed renaming
the window because I had assumed Settings would leave it for a gear button. The user corrected the
premise: **Settings STAYS in the System window, as a TAB.** So the window still holds settings plus
reading material, which makes any communication-flavoured name a lie. The window keeps the name
**System**, and the disambiguation happens one level down instead.

**THE RESOLVED STRUCTURE:**

```
WINDOW   System
  TAB      Patch Notes
  TAB      Community
  TAB      Bug Report        <- was "Log"; error log + compose-and-post-to-Discord
  TAB      Settings          <- was "Options"
    SUBTAB   UI              <- Visual and Accessibility MERGED
      SECTION  UI Theme
      SECTION  Accessibility
      SECTION  Tick bar
      SECTION  Readouts
      SECTION  Combat Log
    SUBTAB   Gameplay
      SECTION  Salvage Bay   <- the rules panel MOVES here from the facility
    SUBTAB   Confirmations
    SUBTAB   ???             <- see the open question below
  TAB      About             <- last
```

⚠️ **"UI" ABSORBS ACCESSIBILITY AS A SECTION** (user), which also retires the "UI Settings" name from
revision 2. Shorter is better here: the tab is already called Settings, so "UI Settings" would have
repeated the word. The accessibility-discoverability caution from revision 2 still stands: keep the
ACCESSIBILITY section header visible in the scroll, and put it FIRST within the UI subtab.

#### ⚠️ ONE OPEN QUESTION: the Save Data subtab still collides

Revision 2 put Save Data in a subtab named **System**. Under the settled vocabulary that reads
`System > Settings > System`, which is the same duplication the user set out to remove, just pushed
down a level.

**RECOMMENDATION: name the subtab for what it holds, not for its category: "Save Data".** It contains
exactly one thing, so the category name buys nothing and costs a collision. When 0.14.0 adds cloud
handling and account controls it can widen to "Save & Account", which is still concrete and still
does not repeat the window's name. ⚠️ A one-item subtab is fine here for the reason already
established: Save Data spent this release's first pass folded into the Visual tab purely because that
tab existed around it, and the result was Export living under the theme picker. A thin, correctly
named home beats a fat, wrong one.

#### The gear button, reconciled rather than dropped

Brief 1's ask 1 (a square gear button as a peer control, instead of a badge on the portrait) still
holds and does not conflict with Settings living in the System window. **The gear simply opens the
System window ON the Settings tab**, while the portrait opens it on its default tab. One window, two
doors, each landing where its icon promises. That keeps the visible affordance the brief argued for
without splitting settings across two places.

---

## PHASE 3 BRIEF 3: THE COLLAPSIBLE HEADER (user idea, 2026-09-12)

Raised as "an idea we can noodle about", and it lands on the same mockup as brief 1, so it is recorded
beside it rather than separately.

**The idea:** the header has two states. **Compact is the default** and looks close to today's, with
the bars truncated to sit cleanly on one line. **Tapping it expands** to a detailed view. Compact might
keep the EXP bar, but smaller.

**⚠️ WHY THIS IS A STRONGER IDEA THAN IT FIRST LOOKS, and it resolves a conflict already logged.**
Brief 1 records a genuine tension: crafting level belongs in the header because it is the same KIND of
thing as Fleet Admiral level, but the header already carries three rows and a fourth costs vertical
space on EVERY screen forever, to show a number that mostly matters while crafting. The collapsible
header dissolves that: **the expanded state is where a fourth, fifth or sixth readout costs nothing**,
because the player opened it on purpose and closes it again. Compact keeps the phone's screen for the
game.

It also gives the two-platform split (brief 1, ask 3) a cleaner answer than "desktop gets a different
header": desktop can simply DEFAULT to expanded, because it has the room, while mobile defaults to
compact. Same component, same information, one different default. That is sharing the logic and
splitting the presentation, which is the standing rule for this release.

**What the mockup must answer:**

1. What compact actually shows. "Bars truncated to fit in one place cleanly" is the whole design
   problem: a progress bar that is too short stops communicating progress and becomes decoration.
   Numbers-only ("4.86M / 50.7M") may read better small than a 40px bar does.
2. What expanded adds that compact cannot: crafting level, FA level detail, fuel runway, ship counts.
3. ⚠️ **Whether the state persists, and where.** It is a per-device view preference, so localStorage by
   the release's own storage rule. But a header that reopens collapsed every session will annoy a
   desktop player, and one that stays expanded on a phone eats the screen it was meant to save.
   Per-platform default plus a remembered override is likely right.
4. ⚠️ **What the tap target is, and what it is NOT.** The header holds the portrait (Profile) and will
   hold the gear (Options). If the whole bar expands on tap, those two controls must not be swallowed
   by it. A dedicated chevron is the safe answer; "tap anywhere on the header" is the one that
   produces mis-taps.
5. Whether expanding pushes the page down or overlays it. Pushing reflows every screen underneath;
   overlaying does not, and is more forgiving of a long expanded state.

---

## PHASE 3 BRIEF 4: COLLAPSIBLE RECENTLY-COMPLETED ROWS (user idea, 2026-09-12)

⚠️ **THE HOME DASHBOARD'S RECENTLY COMPLETED SECTION, not System > Log.** The user clarified this
explicitly, and the distinction decides everything below: the System log is a list of plain strings
with no structure to expand into, while these rows are already structured records. Same words, two
completely different amounts of work.

**The idea:** a compact ONE-LINE default that expands on tap.

```
COMPACT     10:09 PM: 100 fuel refined over 00:10

EXPANDED    Entry Source:  Fuel Depot
            Action:        100 fuel refined
            Time Elapsed:  00:10
            When:          20h ago (11:09 PM)
```

The user's stated reason: *"it would cut the amount of space the log takes up by a lot, but allows
the user to tap/click and read into it more if needed."*

### ⚠️ FINDING: THE DATA IS ALREADY THERE. THIS IS PRESENTATION ONLY.

`CompletionRow` (homeDashboard.ts) already carries every field the expanded view asks for, as
structured data rather than a formatted string:

| Expanded label | Existing field |
|---|---|
| Action | `primaryLabel` ("Refined, Titanium Ingot") plus `secondaryLabel` ("40 runs", "Level 3") |
| Time Elapsed | `elapsedMs`, rendered through the shared `durationReadout` so it already honours the tick-count preference |
| When | `atMs`, rendered by `completionAtText` against the live clock, so the age keeps counting up rather than freezing at first paint |
| (the manifest) | `rewards`, `creditsAmount`, `fuelAmount`, each already rarity-coloured |
| **Entry Source** | ⚠️ **THE ONE GAP.** There is no source field. `icon` implies it and `primaryLabel` often contains it, but "Fuel Depot" as a NAMED value does not exist yet. |

So the build is a row component plus one new resolver field, not a data-model change. **Entry Source
is worth adding on its own merits** regardless of this brief: the board currently makes the player
infer which facility did something from a glyph.

### ⚠️ THE REAL DESIGN PROBLEM: TAP ALREADY MEANS SOMETHING

`CompletionRow.jumpTarget` exists, and a row with one renders as a `<button>` that NAVIGATES to the
facility. A row without one renders as a plain `<div>`. So "tap to expand" collides with a gesture
that is already assigned, on exactly the rows a player is most likely to tap.

Three ways out, to be settled at the mockup rather than in code:

| Option | How it reads |
|---|---|
| **A chevron expands, the row still navigates** (recommended) | Matches brief 3's answer to the same question about the header, and keeps the existing behaviour intact. The affordance is visible, which is the standing preference. |
| **Tap expands, a button inside the expanded view navigates** | The expanded view has room for a real labelled "Open Fuel Depot" control, which is clearer than an invisible whole-row target. But it costs an extra tap to reach a facility, and that jump exists to SAVE taps. |
| **Tap expands, drop the jump** | Simplest, and loses a feature that was deliberately added. Not recommended. |

⚠️ Whichever wins, **the plain-record rows (`jumpTarget: null`) and the navigable ones must expand
the same way.** They share `doneRowBody` today precisely so the two variants cannot drift, and that
property is worth keeping.

### THE PATTERN IS NOW REPEATING, WHICH IS AN ARGUMENT FOR BUILDING IT ONCE

This is the SECOND compact-by-default, expand-for-detail request in a day (brief 3, the collapsible
header), and the Ships roster already does something adjacent. That is a sign it should be one
interaction the player learns once, not three similar ones:

- the same chevron affordance and placement,
- the same animation (and the same reduced-motion behaviour: after the D5 bug, any new expand must
  be checked against BOTH reduced-motion entry points, not just the OS one),
- the same persistence answer (per-device, localStorage, per the release's storage rule),
- ⚠️ and the same decision about whether expanding pushes content down or overlays it. On a scrolling
  list of rows, pushing is the honest behaviour; an overlay would cover the neighbouring rows the
  player is scanning.

### What the mockup must answer

1. The compact line's exact content. The user's example leads with a clock time ("10:09 PM: 100 fuel
   refined over 00:10"), while the current row leads with AGE ("7h ago") because a QA finding
   established that this section's job is answering "what did I miss while I was away". ⚠️ **Those two
   orderings serve different questions and the compact line only has room for one.** Worth deciding
   deliberately rather than inheriting either.
2. Whether the reward manifest survives into the compact line, or is expansion-only. It is the most
   space-hungry part and also the part players most want at a glance.
3. How many rows the section shows once they are one line each. Compacting buys room for MORE
   history, which may be the larger win: the current limit was chosen against tall rows.
4. Whether expanding one row collapses the others (accordion) or they stack independently.

---

## PHASES 2 TO 6

Designed after phase 1 lands, so the mockups (phase 3) can react to what the token layer actually looks like on screen rather than to a description of it. The scope document holds their contents and ordering.
