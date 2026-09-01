# Redesign Preservation Inventory (0.13.x tab-by-tab sweep)

- **Date:** 2026-09-01
- **Purpose:** the "do not forget" checklist. The 0.13.x series redesigns one console tab per release. This inventories the affordances the NOT-YET-REDESIGNED tabs currently provide, so each tab's patch can carry them FORWARD instead of quietly losing them.
- **Rule (user, 2026-09-01):** consistency flows OLD to NEW. Bring good old things forward into the new design; NEVER regress finished new work (Home 0.13.1, Ships 0.13.2) to match an old tab. When an old tab has a theme the new ones lack, raise it and consider integrating it forward.
- **How to use:** when a tab's patch is designed, walk its section here and mark each item Carried / Deliberately dropped (with reason) / Deferred. Nothing here is a requirement to keep verbatim; it is a requirement to DECIDE consciously.
- Source: read-only audit of `src/App.svelte` on `feat/crafting-0.13.3`. Line anchors are approximate and will drift; re-locate by content.

---

## 0. CROSS-CUTTING (applies to every tab; easiest things to lose)

1. **`showTickCounts` preference.** Every duration/ETA readout (`remainingReadout`, `durationReadout`, `lineRemainingReadout`) renders through this persisted toggle (raw tick counts vs human time). Hardcoding "time remaining" silently removes the tick view.
2. **`state.tickDurationSeconds`** is threaded into readouts. Never hardcode seconds-per-tick.
3. **Reservation-aware stock display.** Material rows show FREE stock (`freeItemForState`) with a "(N reserved)" annotation, NOT raw totals. This deliberately fixes the old "shows 1.52M but says not enough" confusion. Appears in Warehouse upgrades, Shipyard build + upgrades, Refinery/Fabricator configurators, Mission Control upgrades.
4. **Disabled-reason discipline.** Controls are never bare-`disabled`: each carries a specific reason, surfaced either as a hover `title`, an inline note under the button, or the button's own label. Two deliberate variants exist (persistent note vs `title`) because persistent notes fixed a tooltip-flicker bug. Do not collapse these to a plain disabled state.
5. **In-flight progress bars** (bar + remaining readout) appear on every timed action: facility upgrades, ship builds, founding, research projects, refine/fabricate jobs, fuel batches.
6. **Locked / "Coming Soon" placeholders** are a deliberate roadmap signal and appear in many places (see each section). They tell players what is planned.
7. **Confirmation modals** back destructive/expensive actions (salvage per-quality, respec x2, rename, delete save), all focus-trapped with Escape + backdrop close.
8. **Empty states are state-dependent**, not generic: e.g. "not built yet (see Upgrades)" vs "idle" vs "nothing researched, go research" vs "tank full" vs "no ice, mine via Operations". Each carries a cross-link to the fix.
9. **Cross-facility signposts**: consoles point at each other ("craftable once the Fabricator is online", "research blueprints at the Research Lab", "hull management lives in Ships"). These orient new players.

---

## 1. FACILITIES + its consoles (owner: 0.13.3)

### 1a. Facilities dashboard (cards)
- Live computed status string PER card, three-state where applicable: Refinery/Fabricator/Research "Not built" / "Idle, N slots free" / "N / M running"; Fuel Depot "Topping up" / "Tank full" / "Idle" PLUS a second line "Fuel: N%" (only two-line card); Warehouse "N items at cap"; Salvage Bay "N spare systems to salvage"; Shipyard "Not founded" / "Building a hull" / "Idle"; Docks "N / M berths used".
- NOT every facility is leveled: Salvage Bay ("Recycling bay"), Warehouse (uses warehouseT1Level), and Docks ("Ship storage") show a subtitle instead of "Level N".
- 8 facilities live here, including Shipyard + Docks folded in from the retired Drydock tab.
- Card taps set `activeFoundryFacility` + `facilitiesView`; consoles have a "back to Facilities" row.

### 1b. Refinery console
- Sub-tabs Overview / Production / Upgrades + a deliberate LOCKED "Coming Soon!" tab slot.
- Production = per-slot PRODUCTION LINES: active line cards ("LINE N, REFINING", recipe formula inputs to output, progress, "Queued, starts next tick"); per-line **Cancel** shown only while `remaining > 0`, replaced by "finishing current run" at 0; batch-N vs continuous mode display.
- Idle-slot **configurator** (only one open at a time): tier dropdown, item dropdown, qty input bounded 1..maxAffordable with a "(max N)" readout, and a **REQUIRES (x qty) preview** showing per-input per/ea to total plus **Free / Allocated / Total** (green Free). This what-if allocation preview is high-value and easy to lose.
- Start button disabled with `startLineBlockText(reason)` as its title.
- Upgrades: maxed empty-state, next-rung grant (+slots or xspeed), duration, reservation-aware material readiness, FA-level prereq, Homeworld-talent prereq rows, Build via the shared `facilityUpgradeButton` (disabled-reason popover incl. "upgrade already in progress"), in-flight bar.

### 1c. Fabricator console
- Mirrors Refinery, plus: Overview shows "Blueprints fabricable: N / M researched"; job-name logic across 3 output kinds; forward signpost about the Shipyard.
- Craft tab: distinct empty-state when slots are idle but NOTHING is researched ("Research blueprints at the Research Lab" cross-link) instead of showing a configurator.
- Tier dropdown lists only researched + tier-available tiers; changing tier RESETS the item.
- Upgrades: grant line combines "+N craft slot, unlocks Tier N blueprints"; cost is CREDITS (not materials) with a "have X" readiness row.

### 1d. Research console
- Overview: "Blueprints researched: N / M"; in-flight project cards naming the blueprint; forward signpost re: Fabricator.
- Research list **grouped by Tier with Tier headers** (ascending).
- Per-card: unlock-only blueprints read "Unlocks: <hull> (build at the Shipyard)" vs a crafts-recipe line; cost + duration; THREE states (Researched checkmark with different text for unlock-only vs craftable; in-flight = inline progress bar REPLACING the button; researchable = enabled button showing credit cost); blocked = disabled button whose **visible label AND title are the block reason** ("Requires Research Lab level N").
- Upgrades: same idiom, credits-cost readiness.

### 1e. Fuel Depot console
- Overview is THREE stacked panels: fuel gauge (current/cap + %), REFINING, MANUAL TOP-UP.
- REFINING panel (dense, high-loss-risk): pipeline count; **Production (max) +X fuel/min** (green); **Ice cost X ice/min**; **Missions (N): -X fuel/min** (red, with active mission count); **Net fuel/min** color-coded with a ROOT-REASON phrase (tank full / out of ice / fuel-positive / draining and auto-buying); **fuel runway countdown** with four states (measuring / infinite self-sustaining / finite "X left" with warning-vs-danger at a 60s threshold / guarded "--"); live per-batch progress; idle empty-state distinguishing "tank full" vs "no Deuterium Ice (mine more via Operations)".
- MANUAL TOP-UP is deliberately DEMOTED and labeled "(optional)" with a note that missions auto-buy shortfalls: price/credits readout, tank-full warning with cross-link, and **+10 / +100 / Fill** buttons sharing one gate, disabled-title distinguishing "Tank full" vs "Not enough credits"; Fill is clamped to tank room so it never overspends.
- Upgrades is a **MIXED track**, the most fragile: the next rung is one of FOUR effect types (Expand Tank / Add Pipeline / Boost Yield / Efficient Intake), each with its own label and a current-to-next readout, and **the Build button label itself changes per type**. A generic "next upgrade" list would erase what the player is buying (this labeling explicitly fixed an earlier mislabel bug).

### 1f. Warehouse console
- Two views (Overview / Upgrade) via SubTabs.
- Overview: storage level + per-item cap; **"Items at cap" counter** with danger color + warning glyph; discovered/total catalog progress; and a conditional **ATTENTION card listing EACH full material** with "producers auto-stopped" (explains why production idled).
- Upgrade: one Panel per tier; **Unlock-vs-Expand** distinction flips the title and shows an honest "future content wall" note; current cap and next cap ("doubles"); duration; reservation-aware readiness with "(N reserved)"; shared Build button; in-flight bar.

### 1g. Salvage Bay console
- Explainer including the "permanently destroys the item" warning.
- **Per-quality confirm preference (localStorage `salvageConfirmQualities`)**: a checkbox per quality tier Q0..Q5; checked = confirm first, unchecked = salvage instantly. Hull teardown ALWAYS confirms regardless.
- **Last Salvage readout** (separate from the event log): header tag varies by kind (recycled / discarded / loot roll); three body branches (baseline carries nothing, "Recovered: N [Item], ...", or "No materials recovered (rounded to zero)"); plus a rolled-tier line showing which loot tier hit.
- Ship Systems section: spare tiles grouped by slot with counts, rarity-colored borders, iLevel corner, per-tile title ("Standard-Issue baseline" or "{rarity} Q{n}"), empty-state with guidance.
- Selected system action: label flips **Salvage (crafted) vs Destroy (baseline, yields nothing)**, the always-available escape valve so no spare is un-removable.
- Salvaged Materials section: all tiers, NO tier filter (deliberate); held counts; per-tile rarity + title; selected-material panel with "Held: N", a note that reachable loot tiers rise with FA level + the salvage talent, and a disabled-reason when none held. Panel auto-closes after the last unit is salvaged.

### 1h. Shipyard console
- Founded-vs-unfounded split. Unfounded: founding credits cost with "(have ...)", FA-level wall with current level, founding time, Found button, in-flight founding bar.
- Founded: in-flight ship BUILD card with progress, **explicitly NO cancel** (BOM + credits are committed at start). Preserve those semantics.
- Per-hull cards: stat line, a REQUIRES box listing each BOM component as "{need}x [Item] - free {N}" (red when short), credits cost, **build-speed-adjusted** effective time, Build button gated by `canBuildShip` with the block reason shown BOTH as title and inline under the button.
- Upgrades: grant line branches founding vs "{mult}x build speed"; credits readiness; FA-level prereq; label flips at level 0.

### 1i. Docks console
- Single panel, no sub-tabs (a degenerate single-tab rail was deliberately dropped).
- "Berths: N / M" readout; **Expand Docks is the ONLY UI that raises `shipStorageCapacity`** and must stay reachable.
- Disabled-reason rendered as a PERSISTENT note (deliberate flicker fix), not a hover title.
- Cross-link caption pointing at Ships for hull management / captain assignment / installs / salvage.

---

## 2. OPERATIONS (owner: 0.13.4)

### 2a. Gathering (extraction dispatch)
- Tier SubTabs I-V with II-V visibly LOCKED (progression ladder).
- IN PROGRESS per-captain cards: phase label, progress bar, "remaining in phase"; **cargo-so-far** (ore/uncommon/rare banked this run); **Recall** button with a second state ("Recall ordered, returning once unloading completes").
- Mission cards: XP/tick header; compact two-column Requirements (level, cargo capacity, round-trip fuel) vs Rewards (rarity-colored drop icons); **per-drop tooltips** (name/held/cap/drop chance/flavor).
- **"View Info" toggle = in-place rich detail swap** (one card at a time), showing the full Drop Table (per-tick % per tier), Requirements, and Rewards (credits/cycle, captain XP/tick, FA XP/tick). Not a modal.
- LOCKED mission cards: dimmed with unlock hint + a requirements PREVIEW (forward planning).
- Dispatch popup: idle-captain picker with empty-state; then a live preview with captain-EFFECTIVE drop rates, an optional Bonus Roll / "Lucky Strike" line, a TIMING breakdown (transit out / extracting / transit back / unloading / total in ticks and seconds), and a FUEL section (round-trip cost + "In tank X / cap"); disabled Dispatch with a specific block reason.

### 2b. Combat (patrol dispatch)
- IN PROGRESS: "{captain}, {ship} vs {faction}"; phase line that turns danger + appends "(defeated, returning to repair)"; **Waves resolved/total with W/L tallies**; **Hull + Shield carry-state bars** with numeric current/max (hull persists across waves, shield regenerates); repeat-vs-single indicator; **"View Combat Log"** opening the display-only focus-trapped CombatView; Recall with its two states.
- Patrol cards: waves band, hostiles list, TRUE route length (transitOut + rollWindow + transitBack); faction flavor; captain selector modal (records, does not dispatch) with empty-state; read-only assigned-ship block using the FOLDED installed-gear defense (not raw hull stats) + a dispatchable/unknown/no-ship status line.
- **Forecast readout**: Battle Rating scalar + a named, colored **Threat Assessment** chip with a fuzzy-range tooltip and an explicit "Advisory only. You can dispatch regardless." (never a raw win %).
- **Stance selector** (Aggressive / Balanced / Standoff, default Balanced) and **dispatch-mode selector** (Once vs Repeatedly).
- Fuel per run + in tank; specific block reason; and a **non-blocking no-weapon ADVISORY** ("inform, don't forbid") that leaves dispatch enabled.
- Battlespace PvE/PvP = reserved locked tabs.

### 2c. Mission Control
- Overview mission log: per-mission **lifetime completion counts**; locked-mission list (empty today but auto-lights-up); status note.
- Upgrades: maxed state; next-rung header + unlock + duration; reservation-aware material readiness; **completion-count prereq rows** ("{mission} completions: have / need") - a gate type unique to this facility; shared Build button; in-flight bar.

---

## 3. LOGISTICS (owner: 0.13.4, possibly with Ops)

### 3a. Ship Equipment bay
- Capacity header "N / M spare" (the ONLY place spare-systems capacity is surfaced).
- **Upgrade Bay** button with its disabled reason as a persistent inline note.
- Empty-state cross-linking BOTH ways to fill the bay (fabricate, or uninstall).
- Inventory grouped by slot with per-group counts; per-tile rarity border, baseline-vs-crafted styling, iLevel readout, and a title showing "Standard-Issue baseline" or "{rarity} Q{quality}".
- Select-to-inspect renders the full EquipmentTooltip INLINE (scroll-safe). **Deliberately BROWSE-ONLY**: no salvage here, that lives in the Salvage Bay.
- **Reserved product-family chips** (Weapons / Modules / Consumables) as locked "coming soon" markers.

### 3b. Materials
- Tier selector button group (a locked tier is still selectable and shows dimmed).
- Cap readout, or "This tier's storage is locked" + an actionable unlock note naming the first unlock material, cross-linked to the Warehouse.
- Empty-state suppressed for LOCKED tiers (avoids misleading guidance).
- Themed sections (four raw sub-categories, Refined, Components, Salvaged Materials); empty sections hidden; per-section counts.
- Per-item fill tiles: discovered vs **masked undiscovered**, rarity color with a rare-ring, a fill bar with %, danger-colored at-cap state, category glyph, formatted count.
- Per-item tooltip reachable by hover, focus, AND click (keyboard + touch paths).

---

## 4. PERSONNEL (owner: TBD in the series)

- **Admiral overview**: FA level, XP bar + readout, **Admiralty Points**, credits.
- **Prestige/talents modal**: focus-trapped; Administration panel repeating points/credits; **Reset/respec** (danger, disabled when credits < cost, routed through a confirmation modal); category picker (`TreeSelector`) with a "back to Categories" control; the **RadialWeb** talent web gated on adminPoints + FA level; 5 fixed branches render even when empty.
- **Roster grid**: captain cards (name, level, assigned ship with renamed-ship handling, status Idle / on mission / on patrol); **Locked vs Coming-Soon empty slots** (locked = recruitable via Homeworld Talents with a cross-link; coming-soon = past the ceiling), and the split shifts automatically with the talent ceiling.
- **Captain console**: back control that also closes a stale-open modal; level/XP bar/XP readout/**Stat Points**/current activity; **Ship Systems shortcut** into the Ships loadout board, disabled with "This captain has no assigned ship"; Actions = Assign Ship (opens the parked-hull picker, disabled on mission with "recall first"), Talents, Rename, and a locked "Equip (coming soon)".
- **Captain talents modal**: spec readout; **first spec pick is free** via a TreeSelector; Reset/respec (credit-gated, confirmation modal) shown only after a spec exists; per-captain RadialWeb over stat points.
- **Rename modal**: focus-trapped, autofocused, length-capped, Enter submits, validation error surfaced inline with the modal staying open on failure.

---

## 5. NOTED ABSENCES (not present today; flagged so they are not "restored" by mistake)
- Operations has **no fuel-runway / "N runs remaining" projection** (only per-run cost + tank level). The runway readout exists in the Fuel Depot console and the top bar. If Ops wants one in 0.13.4, that is NEW work, not preservation.
