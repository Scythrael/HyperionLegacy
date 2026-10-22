# 0.14.0 small calls (S1 to S14 from the decision board): user answers

Board: https://claude.ai/artifact/28FApaYfSLxUHKgMgaG8k8 (S15 answered earlier: staging after the safety work).

- **S1 captain lock (2026-10-17):** "Lock it (Recommended)": no captain moves onto or off a ship that is out
  (shipCrewLocked; assignShipToCaptain tick.ts ~5629).
- **S2 ship gear lock:** "Lock it (Recommended)": no ship gear changes while the ship is out (hand installs, Armory ship
  loadout check-out / check-in, roster loadout apply all use shipCrewLocked, not only the captain-mission lock).
- **S5 difficulty pips:** "Raised, original in tooltip (Recommended)".
- **S8 battle logs:** "0.14.x (Recommended)".
- **S3:** "Unassigned (Recommended)". **S6:** "Keep for balance pass (Recommended)". **S7:** "Keep position
  (Recommended)". **S12 + S13:** "'Fund development cycle', after Salvage Bay (Recommended)": rename the telescope
  Upgrade button to "Fund development cycle"; the card stays after the Salvage Bay.
- **S9 to S11 gambit editor:** "All three as built (Recommended)". **S14 Squad Loadouts mockup:** "All as proposed
  (Recommended)": the GO-17 UI half is APPROVED (team-card shortcut, install what fits + report the rest, empty kits
  stay empty, rosters link squad loadouts one per team, the kit slot holds per-member kits once Field Kits ships).

## Carry note: S1 + S2 built (2026-10-21)

- **One lock:** every ship gear change (hand install, hand uninstall, Armory check-out and check-in, the roster apply)
  asks equipment.ts `shipGearLock`, which is the crew lock (crewLock.ts `shipCrewLocked`: a mission, a patrol, a
  short-range run, or an expedition until it is claimed). Before this only a captain run locked gear; an expedition
  locked none of it. `assignShipToCaptain` (tick.ts) refuses a captain moving off or onto a ship that is out
  (crewLock.ts `captainMoveLock`); before this an expedition never locked a captain swap.
- **Honest words:** `CrewLockReason` now names the run: "onMission" | "onPatrol" | "onShortRange" | "onExpedition"
  ("Ship is out on a patrol", "Ship is on a short-range run", ...), so every lock line in the game names the real
  reason. The install refusal carries it (`{ reason: "onMission", lock }`).
- **UI:** the Ships loadout board, the Install on picker, the Armory (Check out / Check in disabled with the reason),
  the ship page Assign Captain, the captain page Swap ship and the Assign / Swap pickers all read the same lock.
- **Merge note for E-MOD EM-5:** its `moduleLockedOut` (equipment.ts) is now redundant (every slot waits while the
  ship is out); drop it and its two call sites at merge. Its `{ ok: false, reason: "onMission" }` would also need the
  new `lock` field.
- **Goldens:** shipGearLockGoldens.test.ts; only the two expedition rows moved (allowed before, refused now).
