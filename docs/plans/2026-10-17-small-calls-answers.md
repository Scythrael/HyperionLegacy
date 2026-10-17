# 0.14.0 small calls (S1 to S14 from the decision board): user answers

Board: https://claude.ai/artifact/28FApaYfSLxUHKgMgaG8k8 (S15 answered earlier: staging after the safety work).

- **S1 captain lock (2026-10-17):** "Lock it (Recommended)": no captain moves onto or off a ship that is out
  (shipCrewLocked; assignShipToCaptain tick.ts ~5629).
- **S2 ship gear lock:** "Lock it (Recommended)": no ship gear changes while the ship is out (hand installs, Armory ship
  loadout check-out / check-in, roster loadout apply all use shipCrewLocked, not only the captain-mission lock).
- **S5 difficulty pips:** "Raised, original in tooltip (Recommended)".
- **S8 battle logs:** "0.14.x (Recommended)".
