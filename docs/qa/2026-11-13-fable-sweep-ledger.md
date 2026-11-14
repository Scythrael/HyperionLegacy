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

## Lane 4: combat, patrols, gear wear, Overtime

Critical: none (save/reload mid-run, replay == live over 101 cycles, Overtime in pauses all clean).
Important:
- I1 CONFIRMED (measured): veteran Repeat patrols spend most time paused to repair (tick.ts ~4285-4291 waits for every
  combat piece to reach full; gearWear.ts ~127-132 battle rows [PROVISIONAL], ~148 home rate 40). 30,000 s Repeat
  Sweep, Balanced, torpedoes on: destroyer 91% paused, carrier 92%, battleship 73%. Design consequence. (User q1.)
- I2 CONFIRMED: a first patrol left on Repeat farms floor-strength enemies forever (tick.ts ~3950; runDifficulty.ts
  nextPatrolCycleDifficulty). Fresh save, 20,000 s: 595 routes, 30,439 cr, captain level 14, ramp still 0. (User q2.)
- I3 CONFIRMED: enemy torpedoes make the "any warship can win" Sweep losable (helpTopics.ts ~1181; combatRules.ts ~114):
  veteran destroyer lost 3 of 4 seeds, carrier 1 of 4; 0 of 16 with torpedoes off. (User q4.)
Minor:
- M4 CONFIRMED (not player-visible): chunked calls break byte parity when a patrol ends in defeat mid-call
  (gearWearEngine.ts ~1025-1075 trackGearRepairJobs; hull repair auto-start known-legacy tick.ts ~5902-5918).
  Production steps 1 s, so real offline equals live. Add a parity test for a mid-call defeat.
- M5 CONFIRMED outcomes: Aggressive and Balanced fight identically on Standard-Issue warships (resolveBattle.ts ~545-559
  stanceHoldDistance; cause suspected: kits' firepower at short reach). The release QA line about stance logs will fail
  for that pair. (User q5.)
- M6 CONFIRMED: a paused-patrol Overtime step costs 1 cr more than docked (491 vs 490; processSpeed.ts ~251 prices the
  pause incl. the one-tick margin from tick.ts ~4290); the patrol idles one tick after gear is full.
- M7 CONFIRMED: Combat Patrols Help never mentions the Repeat repair pause.
- M8 CONFIRMED diff, cause unknown (crew lane): a carrier's complement buckets differ by chunking during Repeat (from
  5,000 s); destroyer and battleship clean.
QA-list gaps: 9 lines (paused share on Repeat, training patrol on Repeat, Repeat until defeat, Overtime then Repeat
pause length, pause vs docked price, Aggressive vs Balanced logs, close after defeat, carrier buckets offline, Help).
User questions: (1) 73 to 92% paused share intended? (resume when the projection no longer breaks, retune wear rows,
or 0.16.0) (2) should a Repeat run that began as training, or at any ramp step, ever climb or scale loot? (3) should
Repeat fly a cycle whose pristine projection is a defeat? (4) fix the "any warship can win" text now or tune the
chance? (5) should Aggressive and Balanced be guaranteed to differ on default kits?
