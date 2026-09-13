# SESSION HANDOFF, updated 2026-09-13

## Where things stand

| | ref | what |
|---|---|---|
| **PROD** `main` | `9054a32` | 0.13.4 "Infrastructure", LIVE |
| **PREVIEW** `staging` | head of the branch | **0.13.5 "Presentation", FEATURE-COMPLETE, awaiting QA** |
| **BRANCH** | `feat/presentation-0.13.5` | same as staging |

⚠️ **APP_VERSION 0.13.5. SAVE_VERSION 46 -> 48** (auto-salvage rule shape at 47, F5 slot fill at 48).
A migrated save cannot go back to prod, which is why the QA sheet opens by telling the user to export.

**Next action, in this order:**
1. The user reads `docs/plans/2026-09-13-icon-gap-list.md` and approves (or skips) five icons.
2. The user runs `docs/plans/2026-09-13-presentation-0.13.5-qa.md`.

### What shipped in 0.13.5

Token layer + type scale + WCAG AA contrast on all six themes; the text-size control reaching all
258 font sizes; tick-bar 100% fix; smooth fill on EVERY progress bar (economy on the tick cadence,
combat on the log cadence) with reduced motion stepping all of them; options reorganised into UI /
Gameplay / Confirmations / Save Data with Accessibility folded in first; sections as spaced panels;
descriptions moved behind `?` tooltips; `Toggle.svelte` and `HelpTip.svelte` primitives; confirmation
LEVELS with a derived Custom state; auto-salvage rules MOVED into Settings and reshaped from a union
into a filter chain; collapsible header with a real gear button and crafting level; Recently
Completed as expandable one-liners; per-captain idle prompts routed by hull; F5 (every hardpoint
armed) with the patrol retune; a combat-log fix; eight glyphs swept onto the icon registry.

### ⚠️ Deliberately NOT in this release

- **The platform split.** The approved mockup covers the HEADER's desktop treatment, not the whole
  app's, and building the rest without a mockup is what the standing rule forbids. The header's
  compact-on-phone / expanded-on-desktop default is the first real instance of the pattern.
- **Five icons** (facility, repair, extraction, patrol, dispatch) await approval; drawing them
  unasked would be inventing content.
- **Captain portraits**, deliberately kept out of the icon work: a portrait is an IDENTITY that
  varies per captain and later per race, not a shared glyph, so it wants a slot on the captain model
  rather than a name in the icon registry.

### ⚠️ The rule that was added this session, and why

`feedback_decisions_are_the_users`: **propose freely, decide never.** I invented a "filler mount"
weapon as my preferred route for F5, treated the user's answer to a GOAL question as approval of my
ROUTE, and built a game entity they had never agreed to. Their caveat ("rebalance missions
appropriately") was in the same message and my route was designed to avoid it. **The diagnostic: if
my plan removes the need for something the user asked for, I changed the goal rather than solved
it.** Their own objection was sharper than mine: a dummy weapon is a bandaid that makes the step up
to a real gun enormous, so it would have reintroduced the same runaway-power problem later.

---

## Shipped to prod today

**0.13.4 "Infrastructure"** (promoted with the user's explicit green light): docking bays (engine plus surfaces), patrol end reasons, batches spreading across bays, lane readouts, five per-facility queue-depth talents. Parity baseline held at exactly 101 through all six phases.

**Three prod bug fixes**, all found by the user while QA-ing 0.13.4 against the wrong build:
1. Recently-completed rows pushed their timestamp off a phone screen (`.home-l2` had no `flex-wrap`, and all three children were `nowrap`).
2. Missions appeared **stuck at 00:00 while extracting**. Nothing was stuck: the readout used the RAW mission def while the engine uses `effectiveMissionDef`, which swaps in the SHIP's `cargoCapacity`. Lunar Mine baseline is 90; a Prospector Hauler carries 180+. The countdown finished at the halfway mark and pinned.
3. Navigation inherited the previous view's scroll offset. ⚠️ **My first fix was inert** (it called `window.scrollTo`, but the shell is `overflow:hidden` and `.tab-scroll-area` is the real scroller). The working version only exists in 0.13.5, so **prod still has the inert one**. Harmless, but the real fix ships with this release.

---

## 0.13.5 "Presentation": eighteen items, ONE release

User decision: no split. *"It's all UX/UI work, so it all goes together quite well. Not enough to be a full major patch though."*

⚠️ **The dependency order survives that decision** and became the internal phase order. Scope and reasoning: `docs/plans/2026-09-11-presentation-0.13.5-scope.md`. Phase design: `...-0.13.5-design.md`.

| Phase | Status |
|---|---|
| **1. Foundations** | ✅ **BUILT + mid-QA**, including the remainder (Save Data out of Visual, the Salvage Bay deep link) |
| **2. Icon registry + pack seam** | ✅ **BUILT** |
| 3. Mockups (mobile review, then desktop) | ⚠️ **FOUR BRIEFS WRITTEN, all blocked on mockups.** See the design doc: 1 header redesign, 2 options information architecture (+ revision 2), 3 collapsible header, 4 collapsible Recently Completed rows. |
| 4. Two faces (separate view layers, desktop treatment, force-mobile) | not started |
| 5. Sweeps (icons, tooltips, Ops tidy, help buttons, colon style) | not started |
| 6. Extras | ⚠️ **F5 ENGINE DONE, PARKED on `feat/f5-standard-issue-slots`.** Tick-bar pulse not started. |

### What Phase 1 delivered

- **Token layer**: 9-step type scale, spacing scale, `--max-reading-width`, and `--ui-scale`. ⚠️ Introduced **NEUTRAL**: every step matches a size already in use, so nothing moved on screen. Phase 5 re-tunes the values once.
- **Contrast**: `--color-text-dim` failed WCAG AA on **all six themes** (blue worst at 3.39). Each lifted by the minimum, lightness only. Disabled labels were 3.01, now a token at 5.23. Guarded by `contrast.test.ts`, which parses `app.css` so a seventh theme cannot skip the check.
- **Tick bar**: reaches 100% now (it was a *sampling* artefact, not bad maths: the poll that crossed the boundary also reset it, so the last tenth was unobservable). De-emphasised and switched to a CSS sweep, which also fixed the "reads as panic" complaint.
- **Options reorg**: three intent tabs (Visual / Gameplay / Accessibility) on the shared `SubTabs` rail. New `SettingRow` component replaces markup that was hand-copied per setting.
- **Accessibility tab**: UI scale, reduced motion (defaults to the OS setting), high contrast, dyslexia font, force-mobile (disabled, honest about why).
- **Confirmation presets**: a WRITE ACTION, not a stored mode, so a hand adjustment afterwards is never overridden.
- **Theme dropdown** replacing unlabelled colour blots, swatch kept beside it.

### Phase 2 (icon pack seam) delivered

The registry already existed (icons.ts, 0.13.3) and gives requirement 1. This unit added the
other three: a **runtime-swappable** active set via a store (a module variable would only take
effect on reload), a **per-icon fallback** so a pack overriding twelve glyphs still renders the
other fifty (a per-pack completeness gate would force an author to draw everything before shipping
anything), and **meaning preservation** enforced two ways: a pack can only override names that
already exist, and every name carries a semantic class in an exhaustive Record. **Nothing was
swept**; that is phase 5.

### ⚠️ F5 is PARKED on a DESIGN DECISION, not on remaining work: `feat/f5-standard-issue-slots` at `9c25aa3`

**The engine is done. The test conversion is done. The acceptance gate FAILS, and my earlier
"passes with no re-tune" was wrong.** Full write-up: design doc §16.8. The short version:

Three test files carry a local `combatSpecFor(hull)` whose comment claims it replicates the tick.ts
caller. It did not: it still built the SIGNATURE weapon list while the real caller now passes
`defaultWeaponsForHull` (every hardpoint). Every balance number I reported was therefore the PRE-F5
loadout measured against post-F5 code. Made faithful in `9c25aa3`, and the real reading is:

| | pre-F5 | Route A |
|---|---|---|
| SI carrier, Warband | 1.6% | **100.0%** |
| SI battleship, Warband | 15.6% | **100.0%** |
| SI prospectorHauler, Sweep | 76.6% | **100.0%** |
| SI destroyer, Sweep | 98.4% | **100.0%** |

⚠️ **The load-bearing failure is the last row.** Free gear saturating at 100% leaves crafted gear no
headroom, so `craftedGearPayoff.test.ts`'s "crafted wins more often than Standard-Issue" fails at
100 vs 100. That test is the proof of the craft-to-fight loop, on the release before the crafting
overhaul.

**Cause:** the signature loadouts fill roughly HALF each hull's authored hardpoints, so Route A
doubles weapon count (destroyer 2 to 4, battleship 3 to 6, carrier 1 to 2 plus a second drone pod).
§16.7 called that "a small power increase". It is not small.

**Also corrected:** §16.7 ruled out "same power spread thinner" as mechanically unavailable. That
was wrong. It does not need new item mechanics, it needs **one new weak `WEAPON_DEFS` entry** used
only as the free filler mount: a data addition that touches no existing weapon and no crafted stat
model. That is the new **Route D**, and it is the recommendation.

**Nothing is blocked on me.** The branch is deliberately RED (the failing gate IS the finding) and
the release branch is untouched and green.

---

## ⚠️ Open decisions (waiting on the user, nothing blocked)

1. **`showTickCounts` placement.** The record files it under Gameplay; by this release's own storage rule it is a display preference and belongs in **Visual**, where I left it. Flagged in the design doc for the user to overrule.
2. ⚠️ **F5's route, now a REAL decision rather than a detail.** Route A is built, measured, and fails
   the balance gate (see above and design doc §16.8). The recommendation is **Route D: one new weak
   filler mount in `WEAPON_DEFS`**, which delivers both halves of the middle path the user actually
   chose. Route A can only ship by re-tuning the whole patrol ladder upward on a live game.

## Remaining Phase 1 work (small)

- **Relocate the auto-salvage rules and per-quality salvage confirms** into the Gameplay tab properly. Deliberately NOT mirrored (two UIs writing one save-side setting is how a setting disagrees with itself); this needs a real move, not a copy.
- **Save management** (Export / Import / Delete) currently sits inside the Visual tab. It is not a setting and belongs outside the intent tabs.
- One CSS comment elsewhere still cites `.theme-swatch.active` as a precedent; that selector no longer exists.

---

## Things that bit me today, worth not repeating

- **Working directory.** The session was rooted in `RPG-Idle-Game`, so bare `git` commands, markdown file links and `SendUserFile` relative paths all silently targeted the wrong repo. The user fixed it by changing the directory. If it recurs: `git remote get-url origin` must print `HyperionLegacy.git`.
- **`npm run build` was missing from the gate for all of 0.13.4.** `check` and vitest never bundle. It is in the definition of done now.
- **Three "tests that looked like coverage but constrained nothing":** a `default:` clause that swallowed a new process kind, a module test for an update detector I wrongly declared unwired, and a `?raw` import that made a contrast test read an empty string and pass vacuously. Every one passed while the thing it named was broken.
