# Ship Class Naming + Theming (future) notes

**Status:** NOTES, not scheduled. Captured 2026-07-18 from a user "for later" brainstorm. A future cosmetic/identity pass on the ship roster; not tied to 0.11.0 completion or the current roadmap slots yet.

## Vision

- Every ship TYPE gets its own graphic, class name, and naming THEME. The eventual roster is ~**9 ship types** (today only a few exist: generalFreighter, prospectorRunner, prospectorHauler; the roster grows).
- Each vessel type's class names follow a themed set (so a player reads the class name and knows the type/lineage).

## Decided themes (2 of 9 the user is confident on)

- **Destroyer types: SWORDS.** The starting top-tier destroyer = **"Excalibur-class"**.
- **Battleship types: SHIELDS.** The starting top-tier battleship = **"Aegis-class"**.

## Ship-type RENAMES the user is leaning toward

The current internal type names may be renamed to fit real naval-class vocabulary:
- `prospectorRunner` (runner) -> **corvette**
- `prospector` -> **frigate**
- **carrier** and **cruiser** are good as-is.
- More renames possible (the other types TBD).
- NOTE for whoever builds this: renaming a ship TYPE touches `SHIP_TYPES` keys + everything that references them (missions' `requiresCargoCapacity`, the specUtility slot's `prospectorOnly` / `hullSpec: "prospector"` gate, save data / migrations, UI). It is a real rename with save implications, not just a label swap. Plan it as its own task with a migration.

## Multiplayer / cosmetic dimension (confirmed future direction)

- The user intends to PLAY the game legitimately alongside other players (an online / multiplayer future).
- The user's own captain ships will be **cosmetic** (special appearance, no gameplay advantage, since they play fairly with everyone).
- Implication: the ship-identity system should eventually support cosmetic-only skins/variants distinct from stat-bearing hull types. Keep cosmetics and stats separable when this lands.

## Ties to other work

- The eventual ship roster + combat (0.12.0) will define what Destroyer / Battleship / Carrier / Cruiser types actually DO. This naming pass is the cosmetic/identity layer over that.
- If the `prospector` -> `frigate` rename happens, reconcile the equipment specUtility slot's `hullSpec: "prospector"` gate + `captainBranchToShipSpec` at the same time.
