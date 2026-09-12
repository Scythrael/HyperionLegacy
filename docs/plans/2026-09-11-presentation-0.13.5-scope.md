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

## 4. ✅ DECIDED (user, 2026-09-11): ONE RELEASE, ALL EIGHTEEN ITEMS

**All 16 items ship as 0.13.5, and BOTH maybes are rolled in**, making it eighteen.

**The user's reasoning, which is the deciding one:** *"It's a large patch, but it's all UX/UI work, so it all goes together quite well. Not enough to be a full major patch though."*

That is a coherent argument and it answers the objection in section 2 rather than ignoring it. The concern there was scope; the reply is cohesion. Eighteen items that all touch the same layer, shipped together, give the player ONE coherent "the game looks and reads better now" moment instead of three partial ones, and none of them individually justifies a major version bump. A split would have produced three releases that each felt like a fragment.

The recommendation for a split is therefore WITHDRAWN, and this section replaces it.

### 4.1 ⚠️ BUT THE DEPENDENCY ORDER SURVIVES THE DECISION

Not splitting removes the release boundaries. It does NOT remove the prerequisites in section 3, which are technical facts about doing work twice rather than arguments about release size.

**So section 3's ordering becomes the PHASE ORDER INSIDE 0.13.5.** The phases are internal and gated rather than separately shipped, which is exactly how 0.13.3 and 0.13.4 were built:

| Phase | Contents | Why here |
|---|---|---|
| **1. Foundations** | Options shell + intent tabs (1, 2, 3), the Gameplay and Accessibility tabs (8, 9), global type/contrast/width tokens (4), tick-bar + disabled-contrast fixes (12) | Nothing needs a mockup; the token layer is what every later phase inherits |
| **2. Icon architecture** | The named registry, runtime-swappable set, defined fallback, meaning-preservation rule (11a) | ⚠️ Must precede the sweep, or the sweep blocks paid packs |
| **3. Mockups** | Mobile review pass, then a desktop mockup, both signed off before code | The user's standing rule, and their own planned nitpick round |
| **4. Two faces** | Separate view components (6), desktop treatment (5), force-mobile (7) | Must precede every per-screen pass, or each is redone in the second view layer |
| **5. Sweeps** | Icon sweep (11b), tooltip system (10), Ops/Logistics tidy (13), contextual help + accessible labels (14), colon house style (15), action-modal standardisation | Each visits every screen; doing them together means one visit per screen, not six |
| **6. Extras** | F5 (Standard-Issue fills every slot), tick-bar travelling pulse (16) | Independent of the presentation work; F5 needs its route decision first |

**Peelability is retained even though the release is not split.** If 0.13.5 grows past what the user wants to ship at once, the natural peel point is after phase 4: phases 1 to 4 are a complete, coherent release (a reorganised options system, a global readability lift, and two real platform treatments), and phase 5 onward can become 0.13.6. That is a fallback, not the plan.

---

## 5. Answers (user, 2026-09-11)

1. **Split?** No. All eighteen as 0.13.5. See section 4.
2. **F5?** In 0.13.5. ⚠️ **Still needs its ROUTE decision** (design section 16.7, routes A/B/C) before it can be built, because the agreed "same power spread thinner" is not mechanically available.
3. **Action-modal standardisation?** In 0.13.5. ⚠️ Still gated on the user's own validation test: is a bottom-sheet-on-mobile better received than a centred one?
4. **Colon scope?** Deferred to the user's UI review pass: *"I can let you know where it should change in each spot as I go through the entire UI later on in the patch."* So the colon sweep is driven by their per-screen notes rather than decided up front. Build it in phase 5 alongside the other per-screen work, with their notes as the input.
5. **Anything stale?** No. The inventory is accurate as recorded.
