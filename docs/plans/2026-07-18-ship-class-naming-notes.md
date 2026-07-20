# Ship Class Naming + Theming (future) notes

**Status:** NOTES, not scheduled. Captured 2026-07-18 from a user "for later" brainstorm. A future cosmetic/identity pass on the ship roster; not tied to 0.11.0 completion or the current roadmap slots yet.

## Vision

- Every ship TYPE gets its own graphic, class name, and naming THEME. The eventual roster is ~**9 ship types** (today only a few exist: generalFreighter, prospectorRunner, prospectorHauler; the roster grows).
- Each vessel type's class names follow a themed set (so a player reads the class name and knows the type/lineage).

## Locked class-name themes (2026-07-18 brainstorm)

Each ship TYPE gets a naming THEME; the apex is the starting top-tier class of that line. A lower-to-higher tier ladder climbs to the apex.

| Type | Theme | Apex class | Example lower-tier ladder |
|---|---|---|---|
| Destroyer | Legendary swords | **Excalibur** | Durendal, Kusanagi, Tizona |
| Battleship | Legendary shields | **Aegis** | Ancile, Svalinn, Pavise |
| Cruiser (long-range explorer) | Constellations | **Andromeda** | Lyra, Cygnus, Orion |
| Carrier | Mythic broods (mother of the swarm) | **Tiamat** | Echidna, Chimera, Hydra, Roc |
| Medical | Healing gods | **Asclepius** | Eir, Hygieia, Panacea, Chiron |
| Survey | Stellar phenomena | **Quasar** | Aurora, Corona, Magnetar, Pulsar (Nova dropped: too Star-Trek) |

- **Dreadnought = the Fleet Admiral's ship** (the sole FA hull, OR the combat capital of a 3-ship FA set). Its own class-name theme is TBD. Ties to the "FA Flagship 2.0" idea in SUGGESTIONS.
- **Small / utility hull TYPE names are IN FLUX (2026-07-18).** The user REJECTED "Corvette" and "Frigate" (too bland). Current leanings, PENDING final user picks:
  - **Starter craft:** keep **Freighter** (a freighter is a real humble first ship, not a shuttle, and keeping Hauler below avoids any name clash) OR, if the big-cargo hull takes the "Freighter" name instead, the starter becomes a **Clipper** / **Caravel**.
  - **Big cargo hull:** keep **Hauler** (user likes it) with the titans / beasts-of-burden theme (Ox -> Goliath -> Atlas). Keeping "Hauler" is the tidy path (no starter-name conflict).
  - **Fast / light hull** (ex-runner, NOT Corvette): leaning **Cutter** (alts: Scout, Courier, Interceptor). The insects / darts theme (Wasp -> Hornet -> Dart) attaches to whichever wins.
  - **Miner hull** (ex-prospector, NOT Frigate): keep **Prospector** or go **Harvester** / **Excavator** / **Dredger** (lean into the mining identity, not a naval word). Theme: gemstones or famous prospectors.

## Signature weapon per combat hull (0.12.0 combat idea)

Each combat hull gets a signature weapon (identity + a natural rock-paper-scissors layer). User-seeded + controller-extended: Destroyer = particle lance, Battleship = torpedoes, Carrier = drones, Cruiser = missile salvos, Frigate = autocannons / point-defense, Corvette = light rapid guns, Dreadnought = a spinal superweapon. Utility hulls (Freighter, any Tanker) stay lightly / defensively armed, no signature weapon.

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
