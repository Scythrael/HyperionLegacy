# 0.13.5 PHASE 1 "Foundations" : QA Sheet

**Build:** `feat/presentation-0.13.5` at `02bfc84`, deployed to **staging** (devpreview).
**Prod is unchanged** at `9054a32` (0.13.4).

⚠️ **NO SAVE_VERSION BUMP.** Phase 1 is localStorage and presentation only, so your save is untouched and you can move between this build and prod freely.

⚠️ **THIS IS PHASE 1 OF 6.** The platform split, the icon sweep, the tooltip system, the per-screen tidy and F5 are all later phases. If something looks unconverted, it probably is.

---

## A. The regression pass (do this first)

The token layer touches every screen's *potential* styling, so the first question is whether anything moved that should not have.

| # | Step | Expected |
|---|---|---|
| A1 | Load your existing save. | Loads clean, no banner, everything as you left it. |
| A2 | Look at any screen you know well (Home, Ships, a facility). | ⚠️ **Should look essentially IDENTICAL to 0.13.4.** The type scale was introduced NEUTRAL (every step matches a size already in use) so phase 1 changes nothing on screen except the items below. If a screen's text size visibly moved, that is a bug. |
| A3 | Check text that was previously dim (secondary readouts, captions). | Very slightly lighter than before. This is the only intentional colour change: every theme's dim text was below WCAG AA and was lifted by the minimum needed. |
| A4 | Switch through all six themes. | Each still reads as itself. The lift moved lightness only, not hue. |

## B. The tick bar (two live prod bugs)

| # | Step | Expected |
|---|---|---|
| B1 | Watch the tick bar in the header for several ticks. | ⚠️ **It now reaches 100%** before resetting. Previously it stopped around 80% and never visually completed. |
| B2 | Watch it for a while. | It should read as calmer: a continuous sweep rather than a 10fps step, and dimmer than before. It should NOT pull your eye. |
| B3 | Change the game speed (debug panel). | The sweep duration follows the new tick length. |
| B4 | Turn the tick bar off and on (Options, Visual). | Disappears and returns cleanly. |

## C. Options, reorganised

| # | Step | Expected |
|---|---|---|
| C1 | Open System, Options. | Three tabs: **Visual**, **Gameplay**, **Accessibility**, on the same rail every other console uses. |
| C2 | Visual tab. | Tick bar, tick counts, the four combat-log settings, and **Theme as a named dropdown** with a colour swatch beside it. |
| C3 | Change the theme from the dropdown. | Applies immediately; the swatch updates. |
| C4 | Gameplay tab. | Confirmation level presets, confirm-before-refining, the Standard-Issue warning toggle, and a note pointing at the Salvage Bay for the rules. |
| C5 | Press each confirmation preset, then check the toggles below. | ⚠️ "Ask me everything" turns both ON. "Standard" turns refine OFF but keeps the Standard-Issue warning ON. "Stop asking" turns both OFF. |
| C6 | Press a preset, then change ONE toggle by hand, then leave the tab and come back. | ⚠️ **Your hand change must stick.** A preset is a one-time write, not a mode, so nothing should override you afterwards. |

## D. Accessibility (all new)

| # | Step | Expected |
|---|---|---|
| D1 | Accessibility tab. | Five settings, plus a note that they are stored on this device rather than in the save. |
| D2 | Change **Text and interface size** to 125%. | ⚠️ **The WHOLE interface scales together**, not just one screen. Walk a few tabs and check nothing is left behind at the old size. |
| D3 | Set it to 150%, then walk the densest screens (a queue panel, the Ships loadout board). | Honest question rather than pass/fail: **does anything break or overlap?** 1.5 is the intended ceiling and I would like your read on whether it is too high. |
| D4 | Set it back to 100%, then reload the page. | ⚠️ **The setting must still be applied after reload.** This is the half that is easy to get wrong. Try it at 125% too. |
| D5 | Toggle **Reduce motion**. | The tick bar stops sweeping and steps instead. Other animation calms. |
| D6 | Toggle **High contrast**. | Dim and secondary text become near-white; borders strengthen. The accent colour deliberately does NOT wash out. |
| D7 | Toggle **Dyslexia-friendly text**. | Body text changes typeface IF you have OpenDyslexic or Comic Sans installed; headings keep the game font. ⚠️ On a device with neither installed, nothing visibly changes. That is expected, not a bug: no font file is downloaded. |
| D8 | Look at **Always use the mobile layout**. | Present but DISABLED, with text saying it is not available yet. |
| D9 | Reload with high contrast and a scale set. | Both still applied. |

## E. Your judgement, not pass/fail

| # | Question |
|---|---|
| E1 | Do the three tab names make it obvious where to look for a setting? That was the whole requirement. |
| E2 | Is the tick bar now too subtle, or right? It was called "panic"-inducing before; I may have overcorrected. |
| E3 | Is 150% a sensible ceiling for the size control, or should it go higher/lower? |
| E4 | Does the theme dropdown lose anything you valued about the colour blots? |

---

## What I could NOT test

- **Anything visual.** Every item above was verified by compile, test suite and reasoning, not by looking at a screen. The four gates (check, suite, parity, build) all pass, but they cannot see a layout.
- **Real devices.** Mobile versus desktop rendering, and the touch behaviour of the new `<select>` controls.
- **Installed fonts** (D7), which depend on your machine.

## Known, deliberate, not bugs

- **Most screens are unconverted.** Phase 1 delivers the token layer and converts only the options screens. Everything else still uses hardcoded sizes until phase 5.
- **The Gameplay tab does not contain the auto-salvage rules or per-quality salvage confirms.** Both are save-side panels that already live in the Salvage Bay, and duplicating them would create two UIs writing one setting. Relocating them properly is its own unit.
- **Force-mobile does nothing**, because the mobile and desktop view layers do not exist until phase 4.
