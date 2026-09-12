# 0.13.5 "Presentation" : SCOPE RECONCILIATION

*Written before any design work, because the 0.13.5 commitments accumulated across roughly a dozen SUGGESTIONS entries over several weeks and have never been read side by side. The 0.13.3 queue-coverage round trip happened for exactly this reason: the design doc was thinner than the record and the build shipped less than was asked for. This document exists so that cannot happen again.*

**Branch:** `feat/presentation-0.13.5`, off `main` at `9054a32` (0.13.4, promoted 2026-09-11).

---

## 1. What the record actually commits 0.13.5 to

Every item below is a real logged commitment, not an inference. Sixteen of them.

| # | Item | Source |
|---|---|---|
| 1 | **Options / System reorg**: proper subtabs, dropdowns replacing the theme colour-blots, general cleanup | 2026-09-01 |
| 2 | **Dev panel organised + prepped to spin out** into its own system in 0.14.0 | 2026-09-01 |
| 3 | **Options tabs grouped by INTENT**: Visual / Gameplay / Accessibility, plus candidates (Online, Notifications, Audio, Dev) | 2026-09-01 |
| 4 | **Readability pass, applied GLOBALLY via tokens**: type scale, visual hierarchy, WebAIM-AA contrast, max reading width | UX review pts 4-7 |
| 5 | **Desktop as a first-class target**: real breakpoints, desktop type scale, constrained width, desktop density | 2026-09-01 |
| 6 | **Separate presentation, share logic**: mobile and desktop become SEPARATE view components | 2026-09-01 |
| 7 | **Force-mobile option** on desktop | 2026-09-01 |
| 8 | **Accessibility tab**: UI/text scale, reduced motion, high contrast, colourblind palettes, dyslexia font | 2026-09-01 |
| 9 | **Gameplay options tab**: salvage confirm, auto-salvage rules, refine confirm, showTickCounts, force-mobile | 2026-09-01 / 09-10 |
| 10 | **The tooltip system epic**: the standardised 6-template set | resolved 2026-09-11 |
| 11 | **Emoji to SVG across the entire app**, as an ICON REGISTRY with PACK-READINESS | 2026-09-04 |
| 12 | **Tick-bar 80% bug + de-emphasis + disabled-control contrast** | UX review pts 1-3 |
| 13 | **Ops / Logistics presentation tidy** (deferred out of 0.13.4) | 2026-09-01 |
| 14 | **Contextual help `?` buttons** deep-linking into helpTopics, plus accessible labels on icon-only tiles | 2026-09-10 |
| 15 | **Colon house style** for progress rows, swept board-wide | 2026-09-11 |
| 16 | **Tick-bar travelling pulse** (cosmetic, explicitly low value) | 2026-09-11 |

Plus two maybes: **F5** ("0.13.5 or 0.13.6", user 2026-09-11) and **action-modal standardisation** (blocked on a user validation test that has not happened).

---

## 2. ⚠️ This is not one release, and the record already says so

The 0.13.5 roadmap entry closes with its own warning: *"Watch scope: the a11y pass makes 0.13.5 meatier than a pure menu reorg, split if it balloons."* It has ballooned. Item 6 alone (separate view layers for mobile and desktop) is an architectural re-platforming of every screen in the game.

**The user has also already agreed to the principle**, twice: "push back on scope, clean foundation now, log the rest, flag ballooning releases unprompted", and, on this specific release, "0.13.5 is a big one indeed" while accepting it should be built in gated phases that can peel.

So the question is not *whether* to split. It is *where the seams are*, and that is a technical question with a real answer.

---

## 3. ⚠️ THE DEPENDENCY ORDER, which is the actual finding

Several of these items are not merely large, they are **prerequisites for each other**. Doing them in the wrong order means doing the expensive ones twice.

**A. The view-layer split (6) must precede every per-screen pass.**
Items 10 (tooltips), 11 (icons), 13 (Ops/Logistics tidy), 14 (help buttons) and 15 (colon sweep) all visit **every screen**. If the mobile/desktop split happens afterwards, every one of those visits is redone in the second view layer. If it happens first, each pass is done once per platform deliberately, which is the cost the split was accepted for.

**B. The type-scale tokens (4) must precede per-screen tidying (13).**
The record already states this for 0.13.2: *"the ships UI uses hardcoded px sizes matching the CURRENT app scale, so it will need re-visiting when the global type scale changes."* Tidying Ops/Logistics at the old scale and then re-tuning the scale means tidying it twice.

**C. The icon REGISTRY design (11) must precede the icon SWEEP (11).**
The record is explicit and the reasoning is commercial, not aesthetic: icons are a **product surface** for paid cosmetic packs, so the pack seam (named registry, runtime-swappable set, defined fallback, no meaning-changing glyphs) has to exist before 1,000 glyphs are converted. *"Do the registry and pack-readiness design BEFORE the sweep, or the sweep becomes the thing that blocks packs."*

**D. Contextual help (14) must follow the panel tidy, not substitute for it.**
Recorded in its own entry: *"A `?` button explains a messy panel, it does not fix one."* Tidy first, then explain.

**E. The options shell (1, 3) must precede the tabs that live in it (8, 9).**
Self-evident, and cheap, which is why it is a good first item.

---

## 4. Recommended split

Three releases, cut along the dependency seams above rather than by size.

### 0.13.5 "Foundations" — the things everything else needs
- **Options shell**: the reorg, intent-grouped subtabs, dropdowns, dev-panel organisation (1, 2, 3)
- **The Gameplay and Accessibility tabs** themselves (8, 9), since the shell is right there
- **The global token layer**: type scale, hierarchy, contrast, max reading width (4)
- **The icon registry and pack seam**, DESIGNED AND BUILT, but NOT the sweep (11a)
- **Tick-bar fixes** (12), which are small, live, and already overdue
- ⚠️ **Deliberately excludes the view-layer split**, because that decision deserves mockups first.

**Why this is a coherent release on its own:** the player gets a legible, reorganised options system and a global readability improvement across every screen at once. Nothing here needs a mockup, and the token layer is what every later pass inherits.

### 0.13.6 "Two Faces" — the platform split
- **Mockups first, per platform** (the user's standing rule, and their own nitpick plan)
- **Separate view components** for mobile and desktop (6), **force-mobile option** (7), **desktop treatment** (5)
- Mobile preserved exactly; desktop designed rather than stretched

**Why it is its own release:** it is a re-platforming, it is mockup-gated, and it is the thing every later per-screen pass depends on.

### 0.13.7 "Sweeps" — the per-screen passes, done once per platform
- **Icon sweep** onto the registry from 0.13.5 (11b)
- **Tooltip system** (10)
- **Ops / Logistics tidy** (13)
- **Contextual help buttons + accessible labels** (14)
- **Colon house style** (15)
- **Tick-bar pulse** (16), if wanted

**Why last:** every item here visits every screen, so they should visit once, after the platform split, in one pass per screen rather than five.

---

## 5. Open questions for the user

1. **Does the three-way split land, or do you want a different cut?** The seams above are technical, but the sizing is a judgement call.
2. **F5**: 0.13.5, 0.13.6, or 0.13.7? It is unrelated to presentation and could ride any of them, but it still needs the route decision from design §16.7 first.
3. **The action-modal standardisation** is blocked on a validation test only you can run: is the bottom-sheet-on-mobile pattern better received than a centred one? Worth doing during 0.13.5 so it can land in the sweeps release.
4. **Does the colon apply to EVERY row, or only facility/system rows?** Captain and mission rows read as "who, what" rather than "system: action".
5. **Is anything in section 1 wrong or stale?** These commitments span weeks. This is the check that the 0.13.3 round trip existed to make routine.
