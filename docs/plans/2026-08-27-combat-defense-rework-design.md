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

## 11. Decisions — LOCKED (user sign-off 2026-08-27)
- ✅ **SI-gear dials = `SI_PLATING_HP=100`, `SI_EMITTER_CAP=100`, `SI_EMITTER_RECHARGE=3`** (the worked table's starting values). First-pass; the 0.16.0 balance pass may re-dial.
- ✅ **Weapon advisory = a PERSISTENT note on the dispatch card** (not a one-time confirm dialog).
- ✅ **Stat display = the four groups (Innate / Offensive / Defensive / Support / Exploration-Prospecting), and it is MOCKUP-GATED** — build a mockup + get confirmation before the Unit 6 UI build.

Design is SIGNED OFF. Build proceeds subagent-driven, phased, gate-green per unit; Unit 6 (stat display) waits on its mockup.

## 12. ADDENDUM (2026-08-27): the HYBRID model (SUPERSEDES sections 3, 4 shield composition + section 11 shield dials)

The interim composition above (a standalone additive `innateHullArmor` for hull, plus a LARGE `1 + mult` shield multiplier that reached x5 on a battleship) shipped a real problem on the SHIELD side: the large shield multiplier amplified the INSTALLED emitter AND its rolled affixes, so a modest crafted emitter compounded into runaway shields (an iL8 crafted emitter tripled a freighter's regen). This addendum replaces the SHIELD lever with an intuitive, tame effectiveness ratio, while HULL STAYS ADDITIVE (a user-locked decision: a ship without hull plating must still have a nonzero bare frame, it is armored, not an exposed space frame). The dispatch blockers (section 5), the advisory wording, and the three-group stat display (section 6) are UNCHANGED in intent.

A brief history note: a first pass of this addendum made ALL THREE stats multiplicative (hull included, with a `REF_HULL_INTEGRITY = 600` and `SI_PLATING_HP = 600`). That was reverted for hull on 2026-08-27 because a plating-uninstalled ship then folded to 0 hull, violating the bare-frame decision. Hull returned to additive; the shield work was kept exactly. The model below is the shipped result.

### 12a. The HYBRID model
- HULL is ADDITIVE. `hull = innateHullArmor + installed plating.hullStrength`, where the hull's bare frame `innateHullArmor = authoredHullIntegrity - SI_PLATING_HP`. With NO plating the hull is still the nonzero `innateHullArmor` (never 0). `SI_PLATING_HP = 100`, a small FIXED additive floor, the same on every hull.
- SHIELD CAPACITY + RECHARGE are MULTIPLICATIVE via an EFFECTIVENESS ratio. For each shield stat S, a fixed `REF_S` is the authored value of the representative MID combat hull, and `effectiveness_S(hull) = authoredValue_S / REF_S` (freely below or above 100%). SI gear provides EXACTLY `REF_S`, and the fold is `finalStat_S = installedEmitter_S * effectiveness_S(hull)`. With NO emitter the shield is 0 (an emitter is the shield SOURCE).
```
hull   = innateHullArmor + installed plating.hullStrength              (bare frame alone, still nonzero, with no plating)
shield = installed emitter.shieldCapacity  * shieldCapEffectiveness    (0 with no emitter; emitter is the shield source)
rech   = installed emitter.shieldRecharge  * shieldRechargeEffectiveness (0 with no emitter)
```
The enemy / no-gear path is UNCHANGED (enemies use authored stats directly, they install no gear).

### 12b. The shield reference choice
`REF_SHIELD_CAPACITY = 300`, `REF_SHIELD_RECHARGE = 6`. Hull has NO reference (it is additive; its identity is the bare frame).

The reference is the DESTROYER (the mid combat hull, tier 2, roster median) for shield capacity, so it reads exactly 100%. For shield RECHARGE the destroyer is the deliberate fast-regen outlier (its "quick shields" identity, authored at 10, the roster max), so the reference is the roster MEDIAN recharge (6, shared by the miner and battleship). Resulting per-hull composition across the current 7-hull roster (bare frame = authored hull - 100):

| Hull | authored hull / cap / rech | bare frame | cap eff | rech eff |
|---|---|---|---|---|
| generalFreighter | 500 / 200 / 5 | 400 | 67% | 83% |
| prospectorHauler | 700 / 250 / 4 | 600 | 83% | 67% |
| prospectorRunner | 300 / 150 / 8 | 200 | 50% | 133% |
| prospectorMiner | 450 / 180 / 6 | 350 | 60% | 100% |
| destroyer (shield REF) | 600 / 300 / 10 | 500 | 100% | 167% |
| battleship | 1400 / 600 / 6 | 1300 | 200% | 100% |
| carrier | 1100 / 500 / 7 | 1000 | 167% | 117% |

The mid combat hull anchors 100% on shield cap. Recharge lands cleanly inside the nominal 67% to 200% band. Shield cap dips to 50% (runner) at the low tail because the authored shield span is wider than 3x; the destroyer anchor at 100% is the principled centre. Every bare frame is nonzero.

### 12c. Byte-identity (why parity + balance fixtures do not move)
For HULL: an SI ship's plating hullStrength equals `SI_PLATING_HP`, so `hull = (authored - SI_PLATING_HP) + SI_PLATING_HP = authored` EXACTLY (additive, integer-exact). For SHIELDS: an SI ship's emitter raw stat equals `REF_S`, so `shield = REF_S * (authored / REF_S) = authored` EXACTLY (the `REF * (authored / REF)` round-trip is exact for every current roster value; verified in bridge.test.ts, so NO rounding is applied to the fold). An SI ship therefore recomposes to today's authored numbers, combat is byte-identical for SI sets, the `parit` invariant stays at 101, and only CRAFTED gear gains.

### 12d. Crafted-defense curves (itemgen.ts)
The plating and shield-cap floors DIVERGE (plating floor 100 additive, shield-cap floor 300), so the two large defensive implicits ride SEPARATE floored curves; recharge keeps its own tiny curve (floor 6). First crafted tier (the lowest craftable roll: iLevel 1, quality 0, standard rarity) lands a few points above each floor: plating 109 (floor 100), shield cap 311 (floor 300), recharge 7 (floor 6). Every first crafted tier still clears Standard-Issue, so a crafted defensive item is always worth making.

### 12e. The v39 save migration
`SAVE_VERSION` bumped 38 to 39. `MIGRATIONS[38]` re-stats every genuine Standard-Issue SHIELD baseline (gated by the strict `isStandardIssueBaseline` predicate, blueprintKey null AND rarity "standard", so a dev-minted radiant item is never caught) UP to the references: emitter shieldCapacity to `SI_EMITTER_CAP` (300) and shieldRecharge to `SI_EMITTER_RECHARGE` (6). It does NOT touch hullPlating.hullStrength (hull is additive; `SI_PLATING_HP` stays 100, set by the prior v38 step). Weapon, drone, crafted, and economy pieces are untouched. Idempotent. The existing `MIGRATIONS[37]` (v38 step) is left unedited (it may already have run on a device); v39 overwrites a device's interim shield baselines to the references.

### 12f. Stat display language (combatFit.ts + ShipSystemsPanel.svelte)
The Innate section shows the hull's bare frame ("Hull frame", a nonzero number) plus the two shield ratios as an EFFECTIVENESS percentage (Shield Effectiveness, Recharge Effectiveness). The Defensive section shows the hull total as the ADDITIVE composition "Hull integrity: 509 = 400 frame + 109 plating" (a plating-uninstalled ship shows just the frame, still nonzero), and each shield total as "installed x effectiveness", for example "Shield capacity: 285 = 300 installed x 95%". Effectiveness may read below or above 100%. The old "x N.N amplification" innate rows are gone. The section structure (Innate / Systems Offensive-Defensive-Support / Exploration-Prospecting) and the click-to-edit ship-name header are unchanged; EquipmentTooltip.svelte is untouched.

### 12g. Anti-cheat seam (comment only, not built)
For the MULTIPLICATIVE stats (shield cap + recharge), the roster's maximum effectiveness together with the crafted-defense curve caps defines the maximum legitimate folded value. A future item-legitimacy pass can flag any shield item or folded shield stat exceeding it. Hull is additive (no effectiveness ceiling there). Documented near the reference constants in model.ts; no validation runs today.
