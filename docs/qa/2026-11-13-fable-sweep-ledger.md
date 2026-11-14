# Fable QA sweep ledger (0.14.0 on staging c8a29e66, 2026-11-13)

Four Fable lanes, read-only (user: "Full sweep, 4 lanes"). Each lane's findings are recorded as reported; CONFIRMED means
proved by a scratch test or precise trace. Fixes follow the normal flow; design questions go to the user.

## Lane 3: expeditions, ground ops, relics, completion

Critical: none.
Important:
- I1 CONFIRMED: Recall/Resume re-pays scan event rewards (expedition.ts ~2947 heldBodies resets an unfinished body's
  scan; ~2977 openResumedWindow; ~2225 rollStepBoundary). Seed 0x1001: a won ship battle's salvage paid on three runs.
  Unbounded loop. Fix: keep the cut-short body's rolled boundaries or paid event ids on HeldSystem; skip them on resume.
- I2 CONFIRMED: a system's identity is not stable (expedition.ts ~728 tierCandidateSystems, ~610 generateBodies seeded
  by slot; completion.ts ~205/~219 key on systemId + body index). A real star's bodies differ per visit, so "Visited
  N%" can be false and a new planet at 100% pays 0 rolls. 104 of 1,197 Tier I slots were real stars. Fix: seed a real
  star's bodies from its id, or key records by system + seed. (User question 1.)
- I3 CONFIRMED: instant recall rerolls the candidate list for free (expedition.ts ~1614, ~3066); contradicts Help. (User
  question 2.)
Minor:
- M1 CONFIRMED: anomaly haul repeats on a held candidate (expedition.ts ~2433; HeldSystem candidate lacks the flag).
- M2 CONFIRMED: claim log overstates deposits at a full warehouse (expedition.ts ~2641 vs App.svelte ~6626).
- M3 SUSPECTED: unbounded growth (systemRecords, culture planets lists; systemRows recomputed every state change).
QA-list gaps: 14 lines (in the lane report: recall/resume reward checks, real-star revisit, instant recall, two
explorers on one held system, abandon while flying home, short-reach resume, skip-all body bonus, warehouse cap log,
medical bay at claim, Lab III lanes, short-range relic, migrated in-flight save, offline across recall).
User questions: (1) real stars the same system every visit? (2) recall-to-reroll acceptable? (3) planet bonus for
planets finished by skips alone or with no objectives (Tier VII scan-and-skip farms 3 to 5 Augmented+ blanks)?
(4) expedition hauls over the warehouse cap discarded while Field Kits come home over cap: same rule? (5) recalling
every run keeps the training run forever: acceptable? (6) boarders take 10% of found credits: still wanted?

## Lane 1: economy and crafting

Critical: none (Overtime determinism and mid-Overtime save round trips held).
Important:
- I1 CONFIRMED: ice to canister to Sell pays about 60x the planned early income (model.ts ~10641 ice 4 cr, ~10655
  Deuterium Canister 450 cr, ~10493 10 ice -> 1 canister in 20 ticks, ~540 Cometary Ice Harvest at level 1). One
  freighter cycle -> 6 canisters -> 2,700 cr; ~55,000 to 60,000 cr per ship-hour vs 700 to 1,100 planned. The credit
  measurement did not model this source. (User question 1.)
- I2 CONFIRMED: salvage refund has no ceiling; late Museum bonuses push the fraction to 0.93 to 1.16, so build then
  salvage is profitable (salvage.ts ~835-838, ~446-452, ~208). Fix: a bounded curve like effectiveHazardResist.
  (User question 2.)
- I3 CONFIRMED: a free lane never joins a running order; no production code creates a CraftOrder
  (tick.ts ~10138 joinFreeLanesToRunningOrders, ~10466 startLine). Present since 0.13.4. (User question 3.)
Minor:
- M1 CONFIRMED: Overtime sells a step that saves no whole tick (processSpeed.ts ~160; jobOvertimeDisplay.ts ~129).
- M2 CONFIRMED: Warehouse rungs 5 to 7 (and T2 rung 5) cost 12000000.000000002, unbuyable with exactly the listed ore.
- M3 CONFIRMED: Refining Help "each upgrade unlocks another line" is false (lines 1, 2, 3, 3; level 4 is speed).
- M4 SUSPECTED: lifetime refined stat ignores the Refiner's extra batch (tick.ts ~12944 vs ~12961).
- M5 SUSPECTED: secondary loot discarded silently at cap (addToInventory clamps; Storage Help says producers pause).
- M6 SUSPECTED: over-cap deposits (salvage refunds, returned kits) trimmed on next load (clampInventoryToCaps).
- M7 SUSPECTED: Sell can sell stock a queued order reserved (quartermaster.ts ~793 canSell checks total, not Free).
QA-list gaps: 12 lines (canister sell math, ice economy, two-line refine order, Overtime last seconds, Overtime then
close, salvage refund ceiling, Warehouse exact ore, storage at cap, research queue, Fuel Depot range, telescope card,
Purchase refusals).
User questions: (1) canister prices vs 4 cr ice: retune now, stop selling craftable canisters, or 0.16.0? (2) salvage
recovery ceiling below 100%? (3) lane join: wire for 0.14.0 or log as known? (4) Sell respects reservations? (5)
over-cap deposits: keep (never trim) or refuse/hold at the source?
