# 0.13.5 "Presentation" : FULL QA SHEET

**Build:** `feat/presentation-0.13.5`, deployed to **staging** (devpreview). **APP_VERSION 0.13.5.**
**Prod is unchanged** at `9054a32` (0.13.4).

⚠️ **SAVE_VERSION 46 to 48. Your save WILL migrate, and you cannot move back to prod afterwards.**
Two steps run: auto-salvage rules change shape (47), and every ship gets its missing Standard-Issue
weapons (48). **Export a save before you start** (Settings > Save Data), so you have a way back.

⚠️ **This sheet replaces the phase-1 one.** You asked to QA the release in one pass rather than in
slices, so everything below is finished work and there are no 🚧 provisional rows this time. If a
screen looks unfinished, that is a bug, not a phase boundary.

**Marks:** ✅ = a machine already verified the actual claim, skip it. Everything unmarked needs your
eyes, because it is a look or a feel that no gate can see.

---

## A. Before you touch anything

| # | Step | Expected |
|---|---|---|
| A1 | **Export your save** from Settings > Save Data. | A file downloads. This is your way back to prod. |
| A2 | Load the game. | Loads clean, no error banner. Your fleet, credits, ships and captains are exactly as you left them. |
| A3 | Open a facility, the Ships tab, and Home. | Nothing is visibly broken or overlapping. |

## B. Text, contrast and scale

| # | Step | Expected |
|---|---|---|
| B1 | Settings > UI > Accessibility. Set **Text and interface size** to 125%. | ⚠️ **The WHOLE interface scales**, immediately, with no reload. Walk several tabs and check nothing is left behind at the old size. |
| B2 | Set it to 150% and walk the densest screens (a queue panel, the Ships loadout board, a facility console). | Honest question, not pass/fail: **does anything break or overlap?** Is 150% a sensible ceiling? |
| B3 | Set it back to 100% and reload. | The setting survives the reload. |
| ✅ B4 | Look at dim and disabled text. | Brighter than 0.13.4. Dim text was below WCAG AA on all six themes and was lifted; disabled text was lifted twice (the first fix was verified against one theme and still failed on three). |
| B5 | Switch through all six themes, and look at a **disabled** control on the **RED** theme in particular. | Each theme still reads as itself. Red was the worst case for disabled text, so it is the one worth a real look. |

## C. Motion and progress bars

| # | Step | Expected |
|---|---|---|
| C1 | Watch the tick bar for several ticks. | It reaches **100%** and sits there a beat before restarting. It should read as calm, not urgent. |
| C2 | Watch a **craft or refine queue bar**, a **mission bar** on Home, and the **FA XP bar**. | All fill **continuously**, not in once-a-tick jumps. |
| C3 | Watch a **combat replay's** hull and shield bars. | They drain smoothly across each round. Try both **Log speed** settings: the smoothing follows the log, not the economy tick. |
| C4 | Turn on **Reduce motion** (Settings > UI > Accessibility) and repeat C1-C3. | Every bar **steps** instead of gliding, including the tick bar, which still visibly reaches 100%. |
| C5 | With Reduce motion ON, pause the game (debug speed 0) and resume. | The tick bar is not stuck at 100%. |
| C6 | Watch a combat replay and look at a **destroyed** enemy's hull readout. | ⚠️ It reads **zero or below**, never a positive number. This was a real bug: a burn's end-of-round line carried a hull value from earlier in the round, so a dead ship could show 7 hull. |
| C7 | Level up (or watch an XP bar reset). | Honest question: does the bar **draining backwards** look wrong? If so I will make the smoothing forward-only. |

## D. Settings

| # | Step | Expected |
|---|---|---|
| D1 | Tap the **gear button** in the header. | Opens the System window **on the Settings tab**. ⚠️ The gear is its own square button beside your portrait now, not a badge on it. |
| D2 | Tap your **portrait**. | Opens the same window on its default tab. Two doors, each landing where its icon promises. |
| D3 | Look at the Settings subtabs. | **UI / Gameplay / Confirmations / Save Data.** Accessibility is now the FIRST SECTION inside UI, not its own tab. |
| D4 | Scroll the UI subtab. | Sections are separate panels with a gap between them: Accessibility, UI Theme, Tick Bar, Readouts, Combat Log. Each keeps its uppercase title and its divider. |
| D5 | Is the **6px gap** right? | Judgement call. It was matched to the Recently Completed row rhythm. |
| D6 | Tap a **?** next to any setting. | The explanation appears in a floating bubble. Tapping elsewhere dismisses it. On desktop, hovering opens it too. |
| ✅ D7 | Open a **?** on the LAST setting at the bottom of a long section. | ⚠️ The bubble flips **above** the row rather than running off the bottom of the screen. |
| D8 | Flip some toggles (tick bar, damage colours, auto-scroll). | Square switches that slide and glow in your theme colour. Off is grey and clearly still clickable. |
| D9 | **Keyboard only:** Tab to a toggle, press Space, then Enter. | Both activate it, and you can SEE which control has focus. |
| D10 | Log style and Log speed. | Both are **dropdowns** now, not button pairs. |

## E. Confirmation levels

| # | Step | Expected |
|---|---|---|
| ✅ E1 | Settings > Confirmations. Open the dropdown. | Six levels: Ask me everything, Tutorial, Beginner, Intermediate, Advanced, Stop asking. |
| E2 | Pick **Beginner**, then **Advanced**. | Both apply immediately, **no dialog** either time: you were on a clean level, so nothing of yours was at risk. |
| E3 | Untick one checkbox by hand. | The level flips to **Custom** on its own. |
| ✅ E4 | Now pick any level from the dropdown. | ⚠️ **A dialog appears**, naming the level and what it does, with Cancel and Apply. |
| E5 | Press **Cancel**. | Nothing changes and the dropdown goes back to reading Custom. |
| E6 | Repeat and press **Apply**. | Your checkboxes are overwritten and the dropdown reads that level. |
| E7 | Try to select **Custom** directly. | You cannot: it is greyed out. Custom is somewhere you arrive by editing, never by choosing. |

## F. Auto-salvage, moved and reshaped

⚠️ **This one changes what the automation destroys. Read the expectations before clicking.**

| # | Step | Expected |
|---|---|---|
| F1 | Open the **Salvage Bay**. | It has **two** subtabs now: Salvage and Upgrades. The Rules tab is gone. |
| F2 | Settings > **Gameplay**. | The full auto-salvage rules panel lives here now. ⚠️ **Moved, not copied:** there is exactly one place to edit them. |
| F3 | Look at the **Quality** control. | Six checkboxes (Q0-Q5), not a threshold dropdown, plus a **Clear** button. |
| ✅ F4 | Tick some quality tiers and NO rarities. | Every spare at those tiers is eligible, whatever its rarity. |
| ✅ F5 | Tick some rarities and NO quality tiers. | Every spare in those bands is eligible, whatever its quality. |
| ✅ F6 | Tick both. | ⚠️ **Only gear matching BOTH.** The axes narrow each other now; they used to add up. |
| ✅ F7 | Untick everything on every axis with auto-salvage still ON. | ⚠️ **NOTHING is ever taken.** This is the most important guarantee in the release. |
| F8 | Press **Clear** on quality while rarities are still ticked. | Quality stops narrowing; the rarity rule keeps working on its own. |
| ✅ F9 | Check your rules survived the migration. | If you had a quality threshold, it became those tiers ticked and ALL rarities ticked, so the effective rule is unchanged. If you had no rule at all, nothing is ticked. |

## G. The header

| # | Step | Expected |
|---|---|---|
| G1 | Look at the header on a **phone**. | Compact: portrait, name, a short EXP bar with a percentage, your resources, and a **More** chevron. |
| G2 | Tap **More**. | It expands to show the full EXP readout, your **crafting level** (amber), and the tick bar. |
| G3 | Reload. | It remembers whether you left it open or closed. |
| ✅ G4 | Open on a **desktop** browser for the first time. | Starts **expanded**, because a wide screen has the room. A phone starts compact. |
| G5 | Look at the crafting level bar. | Amber, so it reads as a sibling of the FA bar rather than a second copy of it. Does that land? |
| G6 | Tap your currency and fuel readouts. | Each opens its own detail popup. Admin Points is listed alongside credits now. |

## H. Home board

| # | Step | Expected |
|---|---|---|
| H1 | Look at **Recently Completed**. | One line per entry: a clock time in **your** timezone, then what finished. Times line up in a column. |
| H2 | Tap a row's **chevron**. | It expands to show Entry source, Action, Time elapsed, When, and what it paid out. |
| H3 | Tap the row itself (not the chevron). | It still **navigates** to the relevant screen, as before. |
| H4 | Expand several rows. | They stay open independently. |
| H5 | With more than five completed entries, look for **Show more history**. | Off by default. Opening it reveals the rest with matched spacing above and below. |
| ✅ H6 | Leave two captains idle flying DIFFERENT hull types. | Each gets their **own** prompt, named after the captain, with their ship underneath. |
| ✅ H7 | Tap the prompt for a captain flying a **combat** hull. | Lands on Operations > Combat. A prospector or freighter lands on Gathering. |
| H8 | With several prompts, leave the board collapsed and tap the **rotating ticker**. | It is a tap target now, and goes to the same place the expanded row would. |

## I. Ships launch armed (F5)

| # | Step | Expected |
|---|---|---|
| ✅ I1 | Build a **new** destroyer or battleship. | Every weapon hardpoint is filled with a Standard-Issue weapon. No empty slots. |
| I2 | Look at an **existing** ship from before this patch. | Its slots are as you left them. Nothing was auto-filled or auto-removed. |
| I3 | Visit the **Quartermaster** and requisition a Standard-Issue weapon for an empty slot. | Free, and installs normally. This is the intended path for older ships. |
| ✅ I4 | Run a **Crimson-Reaver Sweep** and a **Warband** with a combat hull. | Difficulty should feel close to before the patch. The patrols were retuned to compensate for the extra guns. |
| I5 | Honest question: does the Warband still feel like a real fight? | Measured: destroyer ~14%, battleship ~78%, carrier ~61%. Those are inside their intended bands but the battleship is higher and the carrier lower than pre-patch. |

## J. Icons

| # | Step | Expected |
|---|---|---|
| J1 | Look at the Home board's glyphs. | Eight are now real line-drawn icons (refinery, fabricator, research, shipyard, fuel, warehouse, docks, salvage). |
| J2 | Look at the rest. | ⚠️ Facility, repair, extraction, patrol and dispatch are **still emoji**, deliberately. See the icon gap list for what each needs; you approve them and we add them before this ships. |

---

## What I could not test

- **Anything visual.** Every unmarked row above is the honest boundary.
- **Real devices.** Mobile vs desktop rendering, and touch behaviour on the new switches and popups.
- **Your save specifically.** The migration is tested against constructed saves, not yours, which is
  why A1 says export first.

## Known and deliberate

- **The platform split (separate mobile and desktop view layers) is NOT in this release.** The
  approved mockup covers the header's desktop treatment, not the whole app's, and building the rest
  without a mockup would be exactly the thing the standing rule forbids. The header's
  compact-on-phone / expanded-on-desktop default is the first real instance of it.
- **Five glyphs are still emoji**, pending your approval of the drawings.
- **The System window's tabs keep their current names.** "Log" stays "Log" until the Bug Report
  feature actually exists, per your call.
