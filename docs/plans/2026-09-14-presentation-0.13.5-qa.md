# 0.13.5 "Presentation" — FULL QA SHEET (current)

**Build:** `feat/presentation-0.13.5` → **staging** (devpreview). **APP_VERSION 0.13.5.** Prod unchanged at `9054a32` (0.13.4).

⚠️ **SAVE MIGRATES (46→48) and you cannot return to prod afterward.** Auto-salvage rules change shape (47) and every ship gets its missing Standard-Issue weapons (48). **Export a save first** (Settings › Save Data).

⚠️ **This sheet SUPERSEDES `2026-09-13-...-qa.md`.** That one predates this session's nitpick redesigns, so its Header (G) and Auto-salvage (F) rows are stale — use the sections here instead.

**Marks:** ✅ = machine-verified (gates/logic/code), skip it. Unmarked = needs your eyes (a look or a feel no gate can see). 📱 = check on phone AND desktop.

**Gates (all green, this build):** `npm run check` 0 errors (2 expected RadialWeb a11y warnings) · `npx vitest run` 2746 pass · parity 101 · `npm run build` clean.

---

## A. Before you touch anything
| # | Step | Expected |
|---|---|---|
| A1 | Export your save (Settings › Save Data). | A file downloads — your way back to prod. |
| A2 | Load the game. | Clean load, no error banner; fleet/credits/ships/captains as you left them. |
| A3 | Walk every top tab (Home, Crew, Ships, Facilities, Logistics, Ops, System). | Nothing overlaps, clips, or renders blank. |

## B. Squared UI + scale/contrast
| # | Step | Expected |
|---|---|---|
| ✅ B1 | (radii) | Every rectangular corner uses one `--corner` token (2px). True circles (portrait dots, threat dots) stay round. |
| B2 📱 | Scan buttons, tabs, dropdowns, panels, progress bars, tiles/panes across the app. | All squared, consistent. Nothing still fully-rounded that shouldn't be. |
| B3 | Settings › UI › Accessibility → **Text and interface size** 125%, then 150%. Walk dense screens (a queue panel, Ships loadout, a facility console, a captain console). | Whole interface scales immediately, no reload; nothing breaks/overlaps. Is 150% a sane ceiling? |
| B4 | Back to 100%, reload. | Setting survives. |
| ✅ B5 | Dim + disabled text. | Above WCAG AA on all six themes (lifted in 0.13.4/0.13.5). |
| B6 | Switch all six themes; look at a **disabled** control on the **RED** theme. | Each theme reads as itself; red disabled text legible. |

## C. Motion + progress bars
| # | Step | Expected |
|---|---|---|
| C1 | Watch the tick bar several ticks. | Reaches 100%, sits a beat, restarts. Calm, not urgent. |
| C2 | Craft/refine queue bar, a Home mission bar, the FA/Craft header bars. | Fill continuously, not once-a-tick jumps. |
| C3 | A combat replay's hull/shield bars, at both Log speeds. | Drain smoothly; smoothing follows the log, not the economy tick. |
| C4 | Turn on **Reduce motion**, repeat C1–C3. | Every bar steps instead of gliding; tick bar still visibly hits 100%. |
| C5 | Reduce motion ON: pause (debug speed 0), resume. | Tick bar not stuck at 100%. |

## D. Header (rebuilt + unified this release)
| # | Step | Expected |
|---|---|---|
| D1 📱 | Look at the header on phone and desktop. | ONE layout, differing only by arrangement: portrait + gear bookend the **FA EXP / CRAFT / (TICK)** rows; currency + fuel to the right (desktop) / their own row (mobile). **No More/Less collapse control** (removed). |
| D2 | The EXP row label. | Reads **FA EXP** (fleet-admiral), with `Lv N`. Distinct from CRAFT. |
| D3 | Settings › UI › Readouts → **Show experience values** ON. | EXP/CRAFT rows show current/total + a decimal %, condensed for big magnitudes (m/B/T). |
| D4 | With Show-values ON, compare the three stat **bars**. | All equal width (shared grid); a wide value doesn't make bars uneven. |
| D5 | Tap the **currency** readout. | Popup lists every currency (Credits, Admin Points, …). On mobile it stays on-screen (doesn't run off the edge). |
| D6 | Tap the **fuel** readout. | Jumps to the Fuel Depot (its Overview carries the runway/economy breakdown) — it's a link now, not a popup. |
| D7 | Tap the **portrait** / the **gear**. | Portrait → System (default tab); gear → System on Settings. Two doors. |

## E. Settings shell + accessibility
| # | Step | Expected |
|---|---|---|
| ✅ E1 | Subtabs. | **UI / Gameplay / Confirmations / Save Data.** Accessibility is the FIRST section inside UI. |
| E2 | Scroll UI. | Separate panels with a 6px gap: Accessibility, UI Theme, Tick Bar, Readouts, Combat Log. |
| E3 | Accessibility controls. | Text/interface size (dropdown), Reduce motion, High contrast, Dyslexia-friendly font, Force mobile layout — each persists + applies immediately. |
| E4 | Tap a **?** on any setting. | Floating bubble; tap-away dismisses; desktop hover opens it. **First tap works** (no double-tap). |
| ✅ E5 | **?** on the LAST setting in a long section. | Bubble flips ABOVE the row, never off-screen. |
| E6 | Flip toggles (tick bar, damage colours, auto-scroll). | Squared switches, slide + glow in theme accent; off is dim-grey but clearly interactive. |
| E7 | Keyboard: Tab to a toggle, Space, Enter. | Both activate; focus ring visible. |
| E8 | Log style / Log speed. | Dropdowns, not button pairs. |
| E9 | Force-mobile ON on desktop. | Desktop renders the mobile layout. |
| E10 | Toggle **Colour-blind palette** on. | It's a toggle (one row: label + ? + switch, no wrap), matching the High-contrast/Dyslexia rows. On: status colours (success/warning/danger) + the rarity ladder shift to the Okabe-Ito safe set immediately, no reload; your **theme accent is unchanged**. Check a fuel-OK/short row, a threat chip, and a rarity chip row read distinctly. Setting persists across reload. |
| ✅ E11 | (palette plumbing) | One writer stamps `data-palette`; "off" stamps `off` (no override); rarity/semantics are token-driven so the palette remaps them from one place. |

## F. Confirmation levels + Confirm-by-quality (moved here)
| # | Step | Expected |
|---|---|---|
| ✅ F1 | Confirmations dropdown. | Six levels: Ask everything → Stop asking. |
| F2 | Pick Beginner, then Advanced. | Apply immediately, no dialog (you were on a clean level). |
| F3 | Untick one confirm by hand. | Level flips to **Custom**. |
| ✅ F4 | Now pick a level from the dropdown. | A dialog appears (naming the level) with Cancel/Apply. |
| F5 | **Confirm before salvaging** row (now on this tab). | A **multi-select** (Q0–Q5), matching the auto-salvage controls — NOT the old checkbox grid, and no "Change" jump. Editing it flips the level to Custom. |
| F6 | Set some tiers here, then hand-salvage an item of a ticked tier. | It asks first; an unticked tier queues straight away. |

## G. Tooltip standardization
| # | Step | Expected |
|---|---|---|
| ✅ G1 | (INFO surfaces) | Currency popup, warehouse reason, threat, facility ⓘ all share one `.info-pop` surface. |
| G2 | Hover/tap a **finished ship system** (Ship Systems / Warehouse / Salvage Bay / Combat). | The item card: name + `Rarity · Q` chip, a stat block, **then flavor last under a divider** (flavor moved to the bottom this release). |
| G3 | A **weapon** (e.g. autocannon) card. | Shows a **Combat** block: Damage range, Projectiles (if >1), Accuracy, Fire rate, Range, Family — the real folded numbers. |
| G4 | A **material** card (e.g. via warehouse). | Category chip + subcategory + how-to-get + flavor. |
| ✅ G5 | (radiant) | Radiant rarity reads a deep purple (`#a020f0`) everywhere it appears. |

## H. Facilities dashboard
| # | Step | Expected |
|---|---|---|
| H1 📱 | The dashboard. | Facilities are **full-width panes** (not tiles): icon + name + level, aligned progress rows, a Manage affordance; the whole pane opens the console. |
| H2 | A facility with a **running job + an in-flight upgrade**. | Two aligned rows (action + upgrade); bars line up across panes. Idle facility shows a single status line. |
| H3 | Open a console; look at the **header**. | One row: **← back arrow · facility name · sub-tabs**. Desktop pushes tabs right; mobile scrolls them with ‹ › carets when they overflow. |
| H4 | On a **running** action/upgrade row, tap the **ⓘ**. | A small INFO tooltip about the subject (item/blueprint/ship/upgrade) pops at the icon, below or flipped above; tap-away/Esc closes; it does NOT open the console. |
| H5 | Header → pane gap. | Same 8px rhythm as the tab → content gap. |

## I. Captains
| # | Step | Expected |
|---|---|---|
| I1 📱 | Personnel › Captain Roster. | **Full-width captain panes** (not a card grid): 🎖️ + name + `Level N · Spec`, a Ship row, an XP bar, and a status row. A captain with **unspent stat points or no spec** shows an amber edge + dot. |
| I2 | Tap a captain. | Console with a one-row header: **← · name · Overview / Talents / Ship / 🔒 Equipment**. |
| I3 | Overview → **✏ Rename**. | Edits **in-frame** (text field + Save/Cancel, Enter/Esc), NOT a popup. Advancement (level, XP bar, stat points + "spend in Talents"); read-only Status (assignment + ship). |
| I4 | Talents tab. | The skill web (or spec picker if no spec) + **Reset** (Reset still opens the credit-confirm modal). |
| I5 | Ship tab. | Assigned ship + **Swap ship** (opens picker; blocked while on a mission) + **Ship Systems ↗** (jumps to loadout; Back returns here). |
| I6 | Equipment tab. | Locked placeholder. |

## J. Auto-salvage (reskinned + relocated)
| # | Step | Expected |
|---|---|---|
| J1 | Salvage Bay. | Rules subtab is **gone**; the config lives in Settings › Gameplay. |
| J2 | Settings › Gameplay › **Salvage Bay**. | A master **Auto-salvage toggle**; its rules **pop in** only when ON (and keep their values when off). |
| J3 | **Quality tiers** and **Rarity bands**. | Each is a **multi-select** (tap a trigger → checklist → Clear; "Any …" when empty); rarity rows colour-coded. |
| J4 | **Duplicates only** + **Grace period**. | Duplicates a toggle; grace a dropdown. |
| ✅ J5 | Tick both Quality and Rarity. | Only gear matching **both** is taken (intersection). |
| ✅ J6 | Untick everything, auto-salvage ON. | **Nothing is ever taken** (the load-bearing guarantee). |
| J7 | The live readout when a confirmed tier blocks everything. | Explains it and points to **Confirm before salvaging on the Confirmations tab**. |

## K. Operations missions
| # | Step | Expected |
|---|---|---|
| K1 | Ops tabs. | Overview · Gathering · Combat Patrols · (Exploration 🔒) · Mission Control · (Battlespace 🔒). Overview lists every in-progress mission by type. |
| K2 📱 | Gathering available missions. | **Full-width rows**: name + Tier/XP, a glance line (Needs/Cargo/Fuel + reward icons + credits/cyc), **More info** + **Assign**. |
| K3 | Gathering **More info** → tap a Drop Table **item name**. | Pops the item tooltip (name/rarity/flavor/held-cap/drop %) — the same one the compact icon shows. Dotted underline marks names tappable. |
| K4 | **Assign** popup, with a captain selected. | TIMING reads the **ship-effective** time (a big radiant/Q5 hold shows the real ~28-min extraction, not a flat baseline), formatted human-readably (`~28m`, `~1h 5m`), matching the in-progress card. |
| K5 📱 | Combat patrol rows. | Condensed: glance **Waves · Route · Fuel/tank** (fuel red when short), the tappable **threat chip** once a captain's picked (else "pick a captain to assess"), on-row block/no-weapon warnings; **More info** + **Dispatch**. A long threat label ("Guaranteed Victory") ellipsizes, doesn't grow the row. |
| K6 | Combat **Dispatch** popup. | Captain picker, Battle Rating + Threat, **Stance**, dispatch mode, fuel, Dispatch — with **?** explainers on Threat (fuzzy advisory) and Stance. |

## L. Home board
| # | Step | Expected |
|---|---|---|
| L1 | Recently Completed. | Compact one-liners (clock time in your tz + what finished); tap the chevron to expand details; tapping the row navigates; rows expand independently; "Show more history" past 5. |
| ✅ L2 | A **refine/fabricate** in-progress row with a big queued batch. | ETA shows the **whole order's** remaining time (not one item) + a "N to refine/fabricate" count. Progress bar still ticks per item. |
| ✅ L3 | Two idle captains on different hull types. | Each gets its own prompt; a combat hull routes to Ops › Combat, a prospector to Gathering. |

## M. Ships launch armed (F5)
| # | Step | Expected |
|---|---|---|
| ✅ M1 | Build a new destroyer/battleship. | Every hardpoint filled with a Standard-Issue weapon; no empty slots. |
| M2 | An existing pre-patch ship. | Slots as you left them; nothing auto-filled/removed. |
| ✅ M3 | Specialty equip (Prospecting Rig) on a **prospector-class hull** with a **non-prospector captain**. | It **installs** — captain-spec gate dropped; only the hull class gates it. |

## N. Icons (partial by design)
| # | Step | Expected |
|---|---|---|
| N1 | Home board glyphs. | Eight are real line icons; facility/repair/extraction/patrol/dispatch are still emoji (pending your art approval). |

---

## Scope status — what's IN 0.13.5 vs peeled

**Built + shippable (this sheet):** the options reorg + shell, global scale/contrast/width tokens, accessibility settings, the confirmation-level ladder, the squared-UI pass, the header rebuild, the tooltip-standardization set + generalized item tooltip, the facilities/captains/ops pane+console redesigns, the auto-salvage reskin + relocation, F5, and the icon *registry*.

⚠️ **Deferred — candidates for the 0.13.6 peel (the scope doc's own peel point, after phase 4):**
- **#6 Separate mobile/desktop VIEW LAYERS** — NOT built. The app is responsive (one component set + breakpoints + Force-mobile), not two view layers. The header's compact/expanded default was the first instance; the full split was always the big architectural item, deferred.
- **#11b Full emoji→SVG icon SWEEP** — PARTIAL. Registry done + Home glyphs swept; ~5 glyphs await your art approval.

✅ **Resolved (user decisions, 2026-09-14):**
- **#8 Colour-blind palettes** — **BUILT this session** (row E10). Okabe-Ito safe palette, semantic + rarity tokens made palette-driven — also the seed for the future skin/Pride-palette system.
- **Action-modal standardisation** — **peeled to 0.13.6**; when done it must be mocked + approved per modal population (not a blind sweep).
- **Contextual-help deep-linking** — **deferred to 0.15.0** (the help-center rework owns it); build help into new systems as they ship. Accessible-labels sweep → 0.13.6.

## What I can't test
- **Anything visual**, real **devices** (touch on the new switches/popups/panes), and **your specific save's** migration (why A1 says export first).
