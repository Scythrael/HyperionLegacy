# 0.12.0 "Console" Navigation Redesign, design

**Status:** VALIDATED design direction, brainstormed with the user across several rounds on 2026-07-21; the category lines were drawn deliberately to be firm ("in Neutronium, not sand"). Next steps: mockups of the console pattern for sign-off, then a plan doc, then an incremental build. This SUPERSEDES the 0.11.2 tab-shuffle nav (bottom tabs to left rail to top subtabs), which was the stepping stone that surfaced what the navigation actually needs to be. The non-nav 0.11.2 work CARRIES FORWARD (see section 7).

---

## 1. Why (the problem)

The 0.11.2 nav is three levels deep (bottom tab to left rail to top subtabs) and feels clunky to navigate on mobile, and its category boundaries are fuzzy ("some things don't match up"). Root cause diagnosis (agreed with the user): the murkiness was never the tab SHAPES, it was undefined category BOUNDARIES. This redesign fixes both at once: hard perspective-based categories PLUS a shallower console-style presentation.

## 2. The governing model: five PERSPECTIVES

The five bottom categories are not arbitrary buckets. Each is a PERSPECTIVE the player looks through, and everything in the game is sorted by which perspective it belongs to. This is the rule-set that keeps the lines firm as the game grows:

- **Home** , the whole game. Dashboard/info encompassing the game overall: Overview, the Help manual, Statistics, and reserved meta (Achievements / Completion / Leaderboards).
- **Personnel** , through a PERSON. All manpower: the Fleet Admiral and Captains (later crew members + recruiting). Their upgrades (the captain talent trees AND the FA prestige tree), equipping people, naming, assignments, boarding parties. If you are looking at what someone IS or DOES, you are in Personnel.
- **Facilities** , through a BUILDING. Every building the player controls: Refinery, Fabricator, Research Lab, Fuel Depot, Shipyard (later: repair, etc.). If it is a building you manage to create/process things, it lives here.
- **Logistics** , through an ITEM. Anything at the item scope: Ships, Ship Equipment (weapons / systems / modules), Crew Equipment, Materials (raw / refined / components). Viewing, moving, installing/uninstalling items.
- **Operations** , through a MISSION. Anything you send manpower out to complete: Gathering / Combat / Exploration missions, and (reserved for the combat era) Battlespace (PvE) and Battlespace (PvP).

**Sorting rule for anything new:** is this about the whole game / a person / a building / an item / a mission? One question, one deterministic answer. That is the wall that keeps it from turning back to sand.

## 3. Buckets are for FINDING; actions bridge across perspectives

A perspective-bucket defines where a noun LIVES (where you go to find it), NOT a monopoly on acting upon it. The game deliberately offers MULTIPLE entry points to the same underlying action, from whichever perspective is convenient:

- **Assign a captain/crew:** from the person (Personnel: select the captain, pick a ship / station) OR from the ship (Logistics ship view: pick a station, pick a person).
- **Install a system:** from the item (Logistics: pull up a reactor core, uninstall it, install it into an eligible ship) OR from the ship (Logistics ship view: pick a slot, a "Ship Installs" button opens the equip interface).

The underlying action is ONE system; only the entry point differs. This is a feature (easy management), not duplication to be avoided.

**Guardrails still apply:** cross-perspective actions honor existing locks (e.g. a ship that is on a mission or in the drydock cannot be reassigned/outfitted, the current on-mission lock).

## 4. The console UI pattern (replaces rail + subtabs)

Presentation shifts from nested navigation to a console the player drives with buttons:

- **No left rail, anywhere.** The left rail is removed.
- **Each bottom tab lands on an OVERVIEW** (a console screen), not a rail of items. The overview shows the key readouts plus a curated set of buttons/clickables.
- **Buttons summon panels IN PLACE.** Tapping a button swaps the overview content for the requested panel; a Close button returns to the overview. (Functionally similar to tabs under the hood; presented as buttons on one page, so it reads as a console, not a hierarchy.)
- **A slim TOP rail** may carry a few high-level splits within a category (e.g. Personnel: Admiral | Captain Roster; Logistics: Ships | Ship Equipment | Crew Equipment | Materials; Operations: mission-type tabs). Top rail only; never top rail AND left rail together.
- **System stays the portrait menu** (the gear-badged portrait modal shipped in 0.11.2).

### 4a. Concrete gestures (from the brainstorm)

- **Personnel to Captain:** select a captain; ONE page to assign their ship, set their name, spend talent points (the radial tree renders here), equip them. Everything about that captain on a single page.
- **Logistics to Ship view:** pull up a ship; SEE its captain, who is at each station, installed systems, and the full stat breakdown. Outfit it in place: a slot, then "Ship Installs", then the equip interface. (The ship view composes reads from Personnel + Logistics, but is itself the ITEM perspective.)
- **Operations to Mission:** tap a mission; the card shows the graphic + general info (level req, time per loop, drop icons, flavor text). "View Mission Info" swaps that region for richer, pleasingly-laid-out detail. "Assign Mission" opens the send-a-captain interface. Same engine, better layout.

## 5. Bottom nav (5 tabs)

`Home` , `Personnel` , `Facilities` , `Logistics` , `Operations` (plus System via the portrait). Operations carries 5 top tabs: Gathering / Combat / Exploration missions, plus Battlespace (PvE) and Battlespace (PvP) as locked "coming soon" tabs for the combat era.

## 6. Naming and preserved UI

- **Crew becomes Personnel** (Crew / Command read too restrictive; Personnel future-proofs crew members, recruiting, boarding parties, assignments).
- **Logistics** is the working name for the item perspective (rename if a better fit emerges).
- **Facilities** kept.
- The **radial skill tree** (RadialWeb, glowing links) is PRESERVED for both captain talents and the FA prestige tree, rendered inside the person's page/panel. This is a hard constraint (user love).

## 7. What carries forward from 0.11.2 (nothing is thrown away)

- **Statistics panel** , re-homes under Home.
- **Help manual** , under Home.
- **Salvage declutter** (spare Standard-Issue) and the salvage functions , the salvage surface re-homes (item salvage under Logistics; the Salvage Bay's "do" action fits the Facilities/Logistics split during planning).
- **Community/Discord + the portrait System modal** , unchanged.
- **Warehouse Materials + themed sub-categories + Salvage Bay** , fold into Logistics (materials) and the salvage surface.
- **fitment to "install ship systems" wording** , kept.

## 8. Versioning

This is **0.12.0 "Console"**. It is FOUNDATIONAL: combat, crew, and boarding parties all plug INTO these perspectives, so the nav ships FIRST and **combat moves to 0.13.0**. It is not a 1.0 (that is the finished campaign). The done 0.11.2 work (shell + salvage, currently on staging) either ships to prod as an incremental step first OR folds into 0.12.0, user's call; prod stays at 0.11.1 (babed10) until decided.

## 9. Scope, risk, process

- Large, foundational redesign touching every category's internal structure. Built INCREMENTALLY, one perspective/category at a time, each gated green (npm run check + npm test), content moving with behavior parity where it already exists.
- **Mockup-gated:** the console pattern (overview + summoned panels) is mocked and user-approved before build, and each category's overview is mocked. The overview design is the make-or-break, curate readouts + a small clear button set, do NOT overload an overview into a new kind of clutter.
- offline==live parity and the save format are not the TARGET of this work (it is presentation + IA); any state touched follows the frozen-migration discipline.
- Expected SAVE_VERSION impact: none from the nav itself; confirm per category during planning.
- No em dashes / no "--" as punctuation anywhere (existing standing rule).

## 10. Open items for planning / later brainstorm

- Per-category overview designs (which readouts + which buttons on each of the five).
- The Operations mission-info panel layout (the "View Mission Info" swap).
- Where ship storage capacity (old Docks) surfaces under Logistics(Ships), and how the Personnel assignment action reaches a hull.
- Battlespace PvP/PvE internal structure: DEFERRED to combat (0.13.0); reserve the locked tabs only now.
- Crew members, recruiting, boarding parties: reserved Personnel scope; design when the crew system is scoped.
- Final names: Logistics, and the Materials umbrella label covering raw/refined/components.
