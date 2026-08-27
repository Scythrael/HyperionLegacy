# Combat-defense model rework (BUG-U6) — design

**Status:** design, awaiting sign-off. **Blocker for the 0.13.0 combat debut.**
**Supersedes:** the interim `CRAFTED_DEFENSE_IMPLICIT_MULT = 10` stopgap (deleted by this work) and the piecemeal per-lever framing in SUGGESTIONS.

## 1. Problem (why this exists)

Unit 1.4 made the Standard-Issue combat baseline carry the hull's ENTIRE authored defense (SI plating hullStrength = hullIntegrity − frameHp; SI emitter = the hull's full shieldCapacity), per-hull and large (carrier: 880 plating / 500 shield). That single decision is the root of three problems (bug log BUG-U6, symptoms U3 + U5):

1. **Crafting feels useless** — the SI floor is enormous, so crafted gear starts far below "free."
2. **Crafted defense is unreachable** — the crossover sits above the tier-2 iLevel-40 cap, so crafted plating never beats SI on big hulls.
3. **Cross-hull transfer exploit** — a carrier's 880 plating uninstalls and re-installs on a freighter for 980 effective hull.

No multiplier tune fixes all three; the floor's magnitude, its per-hull baking, and its transferability are the problem.

## 2. Design principles (user, 2026-08-27)

- **Gear stats are 100% item-based** — derived from crafting level, talents, rolls: the PLAYER's effort. Never from the host hull, for any slot.
- **Ships have innate stats of their own.** The hull is half the equation: its layout, power grid, and frame determine how well it fields systems. This is the warship-vs-other balance lever and the ship's role identity.
- **First crafted tier of every item is always a few points above Standard-Issue.** There is never a case where a crafted item isn't worth making. (Corollary: if a crafted item has no use, cut it.)
- **Inform, don't forbid** (sell-peace value). Hard-block only what is physically impossible; everything else is player choice with an advisory where the risk is real.
- **Lore justifies mechanics.** Combat vessels are wired for shield loads; a bare hull still has armor; no reactor means no power.

## 3. The model

### 3a. Innate ship stats (per-hull, always present)
- **`innateHullArmor`** — a flat hull-HP pool, ADDITIVE and standalone. Present even with no plating installed (a bare hull is armored, not an exposed frame).
- **`innateShieldCapMult` / `innateShieldRechargeMult`** — MULTIPLIERS on an installed emitter's cap / recharge. Combat vessels are wired for shield power, so they amplify emitters more; economy hulls amplify little. ⚠️ These multiply the emitter — with NO emitter there is nothing to amplify, so shield = 0.
- Per-hull role identity lives here: a destroyer runs heavy innate armor + a light shield mult (power freed for weapons); a battleship runs heavy armor + a strong shield mult.

### 3b. Gear stats (item-based, hull-independent)
- **Hull plating** → `+hullStrength`, ADDED to `innateHullArmor`. Optional.
- **Shield emitter** → `shieldCapacity` / `shieldRecharge`, the shield SOURCE; the hull's innate mult scales it. Required for ANY shield.
- **Weapons** → unchanged (already item-based; per-weapon-type defs, not per-hull). No innate weapon damage.
- **SI gear** = a modest FIXED floor (same on every hull). **First crafted tier a few points above it.**

### 3c. Composition (what shipToCombatant folds)
```
hull   = innateHullArmor + platingPiece.hullStrength            (plating optional)
shield = emitterPiece ? emitter.shieldCapacity  * (1 + innateShieldCapMult)      : 0
rech   = emitterPiece ? emitter.shieldRecharge   * (1 + innateShieldRechargeMult) : 0
weapons = installed weapon pieces (unchanged)
```

## 4. Calibration (parity-safe; the de-risking insight)

Set innate + fixed-SI-gear so a Standard-Issue ship's TOTALS equal today's authored SHIP_TYPES values. Then the combatant's numbers come out identical → **combat is byte-identical for SI ships, parity holds, enemies need no retune, fixtures barely move.** Only crafted ships gain.

Choose fixed SI-gear constants (tunable dials): `SI_PLATING_HP`, `SI_EMITTER_CAP`, `SI_EMITTER_RECHARGE`. Then per hull:
```
innateHullArmor         = hullIntegrity            − SI_PLATING_HP
innateShieldCapMult     = (shieldCapacity / SI_EMITTER_CAP) − 1
innateShieldRechargeMult= (shieldRecharge / SI_EMITTER_RECHARGE) − 1
```

**Worked table** with example dials `SI_PLATING_HP=100`, `SI_EMITTER_CAP=100`, `SI_EMITTER_RECHARGE=3` (from current SHIP_TYPES, model.ts:767-879):

| Hull | cur hull / shield / rech | innateHullArmor | shieldCapMult | rechMult |
|---|---|---|---|---|
| generalFreighter | 500 / 200 / 5 | 400 | 1.00 | 0.67 |
| (700-hull econ) | 700 / 250 / 4 | 600 | 1.50 | 0.33 |
| (300-hull small) | 300 / 150 / 8 | 200 | 0.50 | 1.67 |
| (450-hull small) | 450 / 180 / 6 | 350 | 0.80 | 1.00 |
| destroyer | 600 / 300 / 10 | 500 | 2.00 | 2.33 |
| battleship | 1400 / 600 / 6 | 1300 | 5.00 | 1.00 |
| carrier | 1100 / 500 / 7 | 1000 | 4.00 | 1.33 |

Combat hulls carry the higher shield mults (battleship 5.0, carrier 4.0, destroyer 2.0) vs economy hulls — exactly the "wired for shields" identity. The exact SI-gear dials + per-hull values are first-pass; the 0.16.0 balance pass refines role feel, this doc only fixes the STRUCTURE and preserves current totals.

### Crafted scaling under the new model
- **Plating** stays additive: crafted `+hullStrength` adds to `innateHullArmor`. First crafted tier just above `SI_PLATING_HP`, scaling up with crafting level. `CRAFTED_DEFENSE_IMPLICIT_MULT` is DELETED (the floor is now ~100, trivially reachable).
- **Emitter** is amplified: crafted raw cap is re-tuned into the `~SI_EMITTER_CAP..3x` range (e.g. 110 first tier → 300 high tier), then multiplied by the hull mult. First tier a few points over SI on any hull; high tier a real upgrade, and combat hulls (higher mult) get more absolute shield from the same crafted emitter — thematically correct. Emitter itemgen magnitudes are re-tuned as part of this work.

## 5. Blockers (by realism)

| Slot | Rule | Why |
|---|---|---|
| **Reactor** | HARD BLOCK at dispatch (empty reactor slot → cannot dispatch) | No power = can't set a course or engage. Physically impossible, not a tradeoff. ⚠️ Reactor is an economy slot and I recently made economy slots strippable-to-empty, so a stripped reactor is now reachable — this guard is NEW and folded in here (user call). |
| **Weapon** | No block; **advisory** at dispatch: "No weapon installed — you won't be able to return fire. Dispatch anyway?" | Flying a battering ram is a valid (bad) choice. Inform, don't forbid. |
| **Hull plating** | No block | Bare hull still has `innateHullArmor` between you and the enemy. |
| **Shield emitter** | No block (but shield = 0 with none installed) | You can fly shieldless; you just have no shields, because emitters ARE the shield source. |

## 6. Ship stat display (restructure, user spec)

Ship view shows, in order:
1. **Innate** — the hull's own stats (innate hull armor, innate shield/recharge mults, hardpoints, drone bays, and forward: innate special rolls).
2. **Systems** — from installed gear, grouped: **Offensive** (weapons: damage, accuracy, disruptions), **Defensive** (plating hullStrength/armor/dampening, emitter cap/recharge as amplified), **Support** (drones, utility).
3. **Exploration / Prospecting** — extraction yield, cargo, FTL, sensors, etc.

This makes the innate-vs-gear split legible (you can SEE what the hull gives you vs what you installed).

## 7. Save migration

Existing saves carry per-hull SI baselines with the OLD large magnitudes + ships without innate stats. Migration (SAVE_VERSION bump):
- Add `innateHullArmor` / `innateShieldCapMult` / `innateShieldRechargeMult` to every ship (derived from its hull type, per the calibration table).
- Re-mint or re-stat every SI combat baseline to the new fixed SI-gear magnitudes.
- Because SI ships' TOTALS are unchanged, no in-flight patrol carry-state is invalidated (verify the durability/hull/shield carry still clamps sanely).

## 8. Parity + re-baseline plan
- SI ships fold byte-identical → the `-t "parit"` 101 invariant holds untouched.
- Balance/outcome fixtures with SI gear are unchanged; any with CRAFTED defensive gear re-baseline (they gain). Enemies untouched.
- Delete `CRAFTED_DEFENSE_IMPLICIT_MULT` + its tests; re-tune emitter itemgen magnitudes.

## 9. Deferred seams (left open in the data shape, NOT built)
- **Random per-ship innate rolls** — a ship rolling its own bonus stats (a "legendary" carrier). The innate-stat fields are shaped to accept a rolled delta later.
- **Special innates** e.g. weapon-disruption hardiness (a ship-innate that reduces the chance its own weapons are disrupted). Deferred; hooks noted, not wired.

## 10. Build plan (subagent-driven-development, phased, gate green each unit)
1. **Model + calibration** — add innate ship-stat fields + SI-gear fixed constants + the per-hull calibration; SI ships fold byte-identical (deep-equal test).
2. **Bridge fold** — `shipToCombatant` composes hull = innate+plating, shield = emitter×(1+mult); prove SI byte-identity + parity.
3. **Blockers** — reactor hard-block (canDispatchPatrol), weapon advisory, relax plating/shield.
4. **Crafted re-tune** — delete `CRAFTED_DEFENSE_IMPLICIT_MULT`, re-tune emitter itemgen magnitudes; validate first-crafted > SI on every hull.
5. **Migration** — SAVE_VERSION bump, innate backfill + SI re-stat; migration probe test.
6. **Stat display** — the Innate / Offensive-Defensive-Support / Exploration restructure (⚠️ mockup-gate the UI per repo rule).
7. **Holistic review** + QA sheet, then it clears the 0.13.0 debut blocker.

## 11. Open decisions to lock at sign-off
- The three fixed SI-gear dials (`SI_PLATING_HP`, `SI_EMITTER_CAP`, `SI_EMITTER_RECHARGE`) — the table uses 100/100/3 as a starting point.
- Whether the advisory is a one-time confirm or a persistent dispatch-card note.
- Stat-display: confirm the four groups + that it needs a mockup before UI build.
