# 0.13.5 QA Sheet (running)

> ⚠️ **READ THIS FIRST. A THIRD MARK EXISTS NOW, AND IT IS THE IMPORTANT ONE.**
>
> - ✅ **CLEARED.** A machine verified the actual claim. Skip it.
> - ◐ **MECHANISM VERIFIED, RESULT NOT.** The code that produces the effect was confirmed (the rule
>   exists, the value is bound, the function is called). Whether the SCREEN changed was not. Worth
>   your eye, but quickly.
> - 🚧 **PROVISIONAL. DO NOT EVALUATE THE LOOK.** This screen works but is scheduled to be rebuilt
>   once the mockups land. Check it still FUNCTIONS; ignore how it looks and where things sit.
>
> ⚠️ **The 🚧 mark was added 2026-09-12 because the sheet was wasting your time.** In your words:
> *"a lot of the things I see as being regression tested or checked in QA is generating red flags
> because it's checking on things that are going to change once mockups are approved... I'm testing
> bits and pieces that never changed visually and thinking 'why am I testing this when it's supposed
> to be different?'"* That is a fair hit on the sheet, not on you. An unmarked item reads as "this is
> finished, tell me if it is wrong", so anything not yet finished has to say so.
>
> ⚠️ **The coverage here is LOWER than the 0.13.4 sheet**, and that is honest rather than lazy:
> 0.13.4 was engine work a harness can drive, while this is PRESENTATION. A machine can check a
> token is defined, a contrast ratio clears AA and a preset writes the right values. It cannot check
> whether a screen LOOKS right, and most of what is left is exactly that.

**Build:** `feat/presentation-0.13.5`, deployed to **staging** (devpreview).
**Prod is unchanged** at `9054a32` (0.13.4).

⚠️ **NO SAVE_VERSION BUMP.** Everything so far is localStorage and presentation, so your save is
untouched and you can move between this build and prod freely.

### What is FINISHED vs PROVISIONAL right now

| Finished, evaluate freely | 🚧 Provisional, rebuilt after mockups |
|---|---|
| Contrast and disabled text (A3, A3b) | The Settings tab LAYOUT and where each setting sits |
| Text and interface size (D2, D3, D4) | The System window's tab names and order |
| Reduced motion, all bars (B5-B12) | Every emoji still on screen (the icon sweep is phase 5) |
| Progress-bar smoothing (B7-B12) | The Salvage Bay rules still living in the facility |
| Confirmation levels behaviour (H) | Where Save Data lives |
| Idle-captain prompts and routing (I) | The header, and the Recently Completed rows |

## A. The regression pass (do this first)

The token layer touches every screen's *potential* styling, so the first question is whether anything moved that should not have.

| # | Step | Expected |
|---|---|---|
| A1 | Load your existing save. | Loads clean, no banner, everything as you left it. |
| 🚧 A2 | Look at any screen you know well (Home, Ships, a facility). | ⚠️ **Should look essentially IDENTICAL to 0.13.4.** The type scale was introduced NEUTRAL (every step matches a size already in use) so phase 1 changes nothing on screen except the items below. If a screen's text size visibly moved, that is a bug. |
| ✅ A3 | Check text that was previously dim (secondary readouts, captions). | Very slightly lighter than before. This is the only intentional colour change: every theme's dim text was below WCAG AA and was lifted by the minimum needed. |
| ✅ A3b | **DISABLED** control text (a greyed-out button or label). | ⚠️ **Brightened again at your report, and you found a real defect.** The first pass set disabled text to accent-at-0.6 having measured only the CYAN accent (5.23, a pass). One alpha covers all six accents, and cyan is nearly the brightest: on **red it measured 2.94, blue 3.12, gray 3.53**, so half the themes were still failing AA while a green test said otherwise. Now 0.85, which clears AA on all six (red 4.84 worst). Still visibly dimmer than an enabled control, so disabled still reads as disabled. **Worth a look on the RED theme specifically**, which was the worst case. |
| ✅ A4 | Switch through all six themes. | Each still reads as itself. The lift moved lightness only, not hue. |

## B. The tick bar (two live prod bugs)

| # | Step | Expected |
|---|---|---|
| ◐ B1 | Watch the tick bar in the header for several ticks. | ⚠️ **It now reaches 100%** before resetting. Previously it stopped around 80% and never visually completed. |
| B2 | Watch it for a while. | It should read as calmer: a continuous sweep rather than a 10fps step, and dimmer than before. It should NOT pull your eye. |
| ◐ B3 | Change the game speed (debug panel). | The sweep duration follows the new tick length. |
| B4 | Turn the tick bar off and on (Options, Visual). | Disappears and returns cleanly. |

| B5 | ⚠️ **NEW, re-test.** With **Reduce motion ON**, watch the bar complete several ticks. | It should be SEEN reaching 100% before restarting, rather than stepping 90% to 0%. The 90-to-0 jump was a sampling artefact: the poll that crossed the boundary was also the poll that reset the cycle, so the last tenth existed for zero renders. ⚠️ **This adds no motion.** It adds one more discrete value to a sequence that already steps. |
| B6 | With Reduce motion ON, **pause the game** (debug speed 0) mid-tick, then resume. | The bar must not be stuck at 100%. The completed frame is cleared at the top of every poll before any early return, specifically so a pause cannot strand it. |

| B7 | ⚠️ **NEW.** With reduce motion OFF, watch a **craft/refine queue bar**, a **mission bar** on Home, and the **FA XP bar** in the header. | All of them should now fill CONTINUOUSLY rather than jumping once a tick and sitting still. Previously the shared fill glided for 0.2s and then froze for the rest of the tick, which is why only the tick bar looked alive. |
| B8 | Same bars with **reduce motion ON**. | All of them STEP, exactly like the tick bar does. No special case was needed: the blanket reduced-motion rule collapses the transition. |
| B9 | ⚠️ **Watch what a bar does when its job FINISHES or an XP bar levels up** (the value drops to near zero). | Honest question rather than pass/fail: does the bar **drain backwards** noticeably? A transition smooths in both directions, and most finished rows vanish so you should rarely see it. If a backwards drain looks wrong on the XP bar, say so and I will make the smoothing forward-only. |
| B10 | Change the game **speed** (debug), then watch any bar. | The smoothing follows the new tick length, because it is driven by the same value the tick bar's duration is. |

| B11 | ⚠️ **NEW.** Watch a combat replay's hull/shield bars. | They now drain SMOOTHLY across each revealed round instead of teleporting when the round flips. ⚠️ The duration follows **Options > Log speed** (Fast 1s / Slow 5s), not the economy tick: these bars advance when the log reveals a round, which is a different clock and one you control. Try both speeds. |
| B12 | A combat replay with **reduce motion ON**. | The gauges step, like every other bar under that setting. |

## C. Options, reorganised

| # | Step | Expected |
|---|---|---|
| 🚧 C1 | Open System, Options. | Three tabs: **Visual**, **Gameplay**, **Accessibility**, on the same rail every other console uses. |
| 🚧 C2 | Visual tab. | Tick bar, tick counts, the four combat-log settings, and **Theme as a named dropdown** with a colour swatch beside it. |
| C3 | Change the theme from the dropdown. | Applies immediately; the swatch updates. |
| 🚧 C4 | Gameplay tab. | ⚠️ **Now holds only the auto-salvage rules link.** The confirmation settings moved to their own tab (section H) at your report. |

## D. Accessibility (all new)

| # | Step | Expected |
|---|---|---|
| ✅ D1 | Accessibility tab. | Five settings, plus a note that they are stored on this device rather than in the save. |
| D2 | Change **Text and interface size** to 125%. | ⚠️ **FIXED 2026-09-12, re-test needed.** It should now scale immediately with no refresh. Previously only a handful of places moved: the token existed and the control wrote it, but **253 of 258 font sizes in the app were hardcoded px that could not see it**. All 258 now scale. |
| D3 | Set it to 150%, then walk the densest screens (a queue panel, the Ships loadout board). | Honest question rather than pass/fail: **does anything break or overlap?** 1.5 is the intended ceiling and I would like your read on whether it is too high. ⚠️ This is the first pass where the question is actually answerable, since before the fix most screens were not scaling at all. |
| D4 | Set it back to 100%, then reload the page. | ⚠️ **The setting must still be applied after reload.** This is the half that is easy to get wrong. Try it at 125% too. |
| D5 | Toggle **Reduce motion**. | ⚠️ **FIXED 2026-09-12, re-test needed.** The tick bar should now STEP (jumping forward about every tenth of a second) rather than sweeping. Previously it jumped straight to full and sat there: reduced motion has two entry points (your OS setting and this toggle) and only the OS one carried the exception that progress bars need. The in-game toggle hit a blanket rule that collapses every animation to nothing, and the bar's animation is declared to hold at its end state, so it pinned at 100%. |
| ◐ D6 | Toggle **High contrast**. | Dim and secondary text become near-white; borders strengthen. The accent colour deliberately does NOT wash out. |
| ◐ D7 | Toggle **Dyslexia-friendly text**. | Body text changes typeface IF you have OpenDyslexic or Comic Sans installed; headings keep the game font. ⚠️ On a device with neither installed, nothing visibly changes. That is expected, not a bug: no font file is downloaded. |
| 🚧 D8 | Look at **Always use the mobile layout**. | Present but DISABLED, with text saying it is not available yet. |
| ✅ D9 | Reload with high contrast and a scale set. | Both still applied. |

## F. Icon packs (Phase 2) ✅ fully cleared by the machine run

Phase 2 is architecture with no player-facing surface yet, so there is nothing for you to click.
Verified: a pack overriding 1 of 23 glyphs still renders the other 22 (per-icon fallback); an empty
override falls back rather than drawing nothing; all 23 icons carry a semantic class with `warning`
and `check` both classified `alert`; an unknown pack id degrades to the base set; exactly one pack
ships today, which is a content decision rather than missing work.

⚠️ **No emoji was swept.** That is phase 5. If the interface still shows OS emoji, that is expected.

## G. The Phase 1 remainder (added 2026-09-12, build `037e736`)

| # | Step | Expected |
|---|---|---|
| G1 | Open System. The tab is now called **Settings**, not Options. | ⚠️ Renamed at your report: the window is System, so System > Options > System repeated a word across levels. |
| G1b | Settings > **Save Data** subtab (last in the strip). | Export / Import / Delete live there. It no longer floats below the tab strip, so it has an address you can be sent to. ⚠️ Named for what it holds rather than "System", which would have pushed the same duplication down a level. |
| G2 | Export a save from it. | Downloads as before (the controls moved, nothing about them changed). |
| ◐ G3 | Gameplay tab, press **Open Salvage Bay rules**. | ⚠️ The System modal CLOSES and you land on the Salvage Bay's **Rules** tab. If you land behind a still-open overlay, that is the bug this step exists to catch. |
| G4 | From there, press back / navigate away and re-open Options. | Nothing is stuck; Options re-opens normally. |

## H. Confirmations, REBUILT (added 2026-09-12)

⚠️ **The first version of this was the wrong feature and you caught it.** The refined interaction
model was already in SUGGESTIONS.md; the design doc compressed it away and the build followed the
design doc. Three buttons shipped instead of the dropdown-plus-checkboxes model. Rebuilt to the
record: design doc §1.4a has the full account.

| # | Step | Expected |
|---|---|---|
| 🚧 H1 | Options. | ⚠️ **FOUR tabs now: Visual, Gameplay, Confirmations, Accessibility.** |
| 🚧 H2 | Confirmations tab. | A **Confirmation level** dropdown, a help box under it describing the level currently shown, then the individual checkboxes. |
| ✅ H3 | Open the dropdown. | Six levels in order: Ask me everything, Tutorial, Beginner, Intermediate, Advanced, Stop asking. |
| H4 | Pick **Beginner**. | Applies immediately, **no dialog**. The help box changes to Beginner's text. |
| ✅ H5 | Now pick **Advanced**. | ⚠️ Still **no dialog**: you were on a clean level, so nothing of yours is being lost. Confirming here would be pure friction. |
| H6 | Untick **Confirm before refining** by hand. | ⚠️ The dropdown flips to **Custom** on its own, and the help box says it is your own mix. |
| ✅ H7 | With the level reading Custom, pick any level from the dropdown. | ⚠️ **NOW a dialog appears**, naming the level and what it does, with **Cancel** and **Apply**. |
| H8 | Press **Cancel**. | Nothing changes. The dropdown goes back to reading **Custom** and your checkboxes are untouched. |
| H9 | Repeat H7 and press **Apply**. | The checkboxes are overwritten to that level and the dropdown reads it. |
| H10 | Try to select **Custom** from the dropdown directly. | You cannot: it is shown greyed out. Custom is something you reach by editing, never by choosing. |
| ◐ H11 | Look at the **Confirm before salvaging** row. | Reports a count ("All tiers", "3 of 6 tiers", "No tiers") plus a **Change** button that takes you to the Salvage Bay rules. ⚠️ It is edited there and **governed here**: a level sets it, but only one screen has the tier-by-tier grid. |
| H12 | Set a level, then check the Salvage Bay's tier checkboxes. | They match what the level implied. Then tick one there by hand and return to Options: the level should now read **Custom**. |
| ✅ H13 | The level ladder. | Each rung asks for strictly fewer confirmations than the one above it (asserted in tests), so the names cannot come to mislead. |

⚠️ **Two things named in the original record are NOT here, on purpose:** the **batch confirm** and the
**no-grace warning** do not exist as toggles anywhere in the game (verified: no preference module, no
gate), so there was nothing to manage. And the unconditional destructive confirms (Delete Save,
respec, captain-aboard salvage) are excluded because they have no toggle at all: putting them under
"Stop asking" would mean BUILDING a way to skip them, which is new behaviour rather than a reorg.
**Tell me if you want either group built out** and they are a data addition plus a gate each.

## I. Home board: idle captains and the ticker (added 2026-09-12)

| # | Step | Expected |
|---|---|---|
| ✅ I1 | Leave two or more captains idle, flying DIFFERENT hull types (at least one combat hull). | **NEEDS YOUR ORDERS shows one prompt per captain**, named after them, with their ship on the detail line. Previously it was a single "3 captains are awaiting orders" line. |
| ✅ I2 | Tap the prompt for a captain flying a **combat hull**. | Lands on **Operations > Combat**. ⚠️ Previously an idle Destroyer was sent to the gathering board whenever any *other* idle captain could gather, which is a screen it cannot be dispatched from. |
| ✅ I3 | Tap the prompt for a captain flying a **prospector or freighter hull**. | Lands on **Operations > Gathering**. |
| I4 | With several prompts, leave the board COLLAPSED and **tap the rotating ticker item**. | ⚠️ **It is a tap target now.** It goes to the same place the expanded row would, because it renders the same button. Previously the ticker was display-only and you had to expand first. |
| I5 | Work the loop: tap the ticker, give that captain orders, come back. | The prompt is gone and the counter has dropped by one. Tap, set, tap, set, all green. |
| I6 | Expand the list with several idle captains. | Each captain is their own row; no aggregate line remains. |

⚠️ **An explorer hull routes to Gathering today.** Exploration missions do not exist until 0.15.0, so
there is no exploration destination to point at. The arm EXISTS in the mapping (adding the real
target is one line), which is the placeholder bucket you asked for.

## E. Your judgement, not pass/fail

| # | Question |
|---|---|
| E1 | Do the three tab names make it obvious where to look for a setting? That was the whole requirement. |
| E2 | Is the tick bar now too subtle, or right? It was called "panic"-inducing before; I may have overcorrected. |
| E3 | Is 150% a sensible ceiling for the size control, or should it go higher/lower? |
| E4 | Does the theme dropdown lose anything you valued about the colour blots? |
| E5 | Are the six confirmation levels the right SIX? The middle four are graduated mostly by which salvage quality tiers still ask, because that is the only setting fine-grained enough to give six honest steps. If that reads as arbitrary, fewer and clearer rungs is a better product. |

---

## What I could NOT test

- **Anything visual.** Every ◐ above is the honest boundary: the machine confirmed the code that
  produces an effect, never the effect. The four gates (check, suite, parity, build) all pass, and
  none of them can see a layout.
- ⚠️ **A2 in particular is only half-cleared.** What was verified is the PRECONDITION: every type
  step matches a size the app already used (9/10/11/12/13/15/18/22/28, none off-scale), so the
  scale genuinely is neutral. Whether any screen actually moved still needs your eyes.
- **Real devices.** Mobile versus desktop rendering, and the touch behaviour of the new `<select>` controls.
- **Installed fonts** (D7), which depend on your machine.

## Known, deliberate, not bugs

- **Most screens are unconverted.** Phase 1 delivers the token layer and converts only the options screens. Everything else still uses hardcoded sizes until phase 5.
- **The Gameplay tab does not contain the auto-salvage rules or per-quality salvage confirms.** Both are save-side panels that already live in the Salvage Bay, and duplicating them would create two UIs writing one setting. As of `037e736` the tab LINKS to them (G3) instead of only naming them. A physical relocation is a spatial change and waits for your UI walkthrough.
- **Force-mobile does nothing**, because the mobile and desktop view layers do not exist until phase 4.
