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

## Lane 2: crew, complement, refugees

Critical:
- C1 CONFIRMED (measured), RELEASE BLOCKER: a production 0.13.x (v54) save freezes on its first 0.14.0 tick and
  floods crew. save.ts ~2326 (migration 54 sets lastTransportWindow ?? 0; nothing later updates it); crewOverlay.ts
  ~1348 crewTransportsDue; transports.ts deliverDueTransports copies the pool per window (quadratic). Prod advances
  gameTimeSeconds, so the first economyTick delivers every window since the save began: 30 days = 3.7 s and 17,250
  crew; 180 days = 64.6 s and 103,650 crew (+531 KB); 365 days = 167 s and 210,210 crew (+768 KB). Fix: on a save
  migrating from below v55 stamp lastTransportWindow = transportWindowIndex(gameTimeSeconds) (or a bounded welcome
  backlog: user's call), and make deliverDueTransports build one batch map instead of copying per window.
Important:
- I1 CONFIRMED: the Mentor / Legendary Captain lift on an Earth-born officer's Crew Effectiveness is displayed but does
  nothing (crewOverlay.ts ~512-526 officerEffectivenessRacials uses bridgeOfficerMultiplier only; the display uses
  officerOutputMultiplier incl. captainOfficerOutputMult). Fix: use officerOutputMultiplier there.
- I2 CONFIRMED by trace: a waiting echo refugee can leave on a Refugee Relocation and is gone for the save (Help says
  so; no user answer found). (User question.)
Minor:
- M1 SUSPECTED: very old saves keep thousands of reserve groups in localStorage (reserve unbounded by design).
- M2 SUSPECTED doc drift: Recruiter is a flat +1 (best captain) in code; a CP-19 plan line says D23 curve. (User q.)
Clean: crew conservation fuzz 12 seeds x 500 mixed actions (nothing lost or duplicated, caps respected, save round trip
byte-equal); lane UI text rules.
QA-list gaps: 10 lines (load a real PRODUCTION save, export size, Mentor on Earth-born, Crew Effectiveness acts, echo
on relocation, notable cap, roster apply pool then reserve, retire pinned XO, 375 reserve with 100+ groups, 4-day
offline crew math).
User questions: (1) waiting echo exempt from Refugee Relocation? (2) prod saves on first 0.14.0 load: transports from
"now", or a bounded welcome backlog? (3) Recruiter flat +1 final?

## USER ANSWERS (2026-11-13/14) on the sweep's design questions

- Prod save crew backlog (C1): "A welcome batch to fill the fleet (Recommended)": enough transports to fill every open
  berth once, then normal transports from the update on. The freeze is fixed regardless.
- Canisters (lane 1 I1): "Price near input value (Recommended)": canister sell price close to its ice value plus a
  small refining margin.
- Salvage ceiling (lane 1 I2): "Curve below 100% (Recommended)": diminishing curve approaching but never reaching 100%.
- Repeat repair pause share (lane 4 I1): "Resume when safe (Recommended)": resume as soon as the next cycle's
  projection no longer breaks gear, not at full.
- Training patrol on Repeat (lane 4 I2): "Climb every N routes (Recommended)".
- Instant recall reroll (lane 3 I3): "Recalled launch keeps the list (Recommended)". (Lane 3 I1 re-pay fixed regardless.)
- Real stars (lane 3 I2): "Same system every visit (Recommended)": bodies seeded from the star.
- Sweep vs torpedoes (lane 4 I3): "Fix the Help text (Recommended)"; tune in 0.16.0.
- Doomed Repeat cycle (lane 4 q3): "Stop and explain (Recommended)".
- Skip farming the planet roll (lane 3 q3): "Roll needs a real objective (Recommended)": skips still count for the %.
- Over cap (lane 1 q5, lane 3 q4): "Never discard (Recommended)": deliveries may sit over the cap, nothing trimmed on
  load, logs show what landed.
- Echo on relocation (lane 2 q1): "Exempt echoes (Recommended)".
- Still to ask: Aggressive vs Balanced identical on default kits; Recruiter flat +1; lane join (wire or log); Sell vs
  reservations; boarders take 10% of credits; recall keeps the training run forever.
- 2026-11-14 user report: staging "Completely unresponsive" (screenshot: Command Home on phone, Fleet Prestige 2
  achievement just shown). Prime suspect: C1.

## Automated QA run (2026-11-14): FAILs

Two automated runs over the full QA sheet (docs/qa/2026-11-14-0140-full-qa.html) on feat/crew-0.14.0 @ c2232ad5.
Part A (202 checks): 114 PASS, 4 FAIL, 62 NEEDS_HUMAN, 22 KNOWN_ISSUE (every KNOWN_ISSUE is a ledger item above with no
src fix since the ledger). Part B (92 checks): 75 PASS, 6 FAIL, 11 NEEDS_HUMAN. Every result is badged on its row in the
sheet. Row ids are section plus 1-based row number. Line numbers are approximate (taken at c2232ad5).

Part A (0.14.0 changes):

- A1-2, welcome batch fills totals but not ships. Total crew equals berths (8,340 / 8,340), yet explorers sit half
  empty (Eir 291/900, Aurora 351/750, Orion 555/750; late freighters and prospectors 20/30 and 20/50) and the Homeworld
  reserve holds about 1,316 (browser) to 1,760 (engine) crew, thousands not tens, with 0 Science. After 4 more days:
  7,494 / 8,340 seated. Repro: migrate a v54 save (365 d, 25 ships) and tick 3600 (scratch a1.qa.test.ts and
  a1b.qa.test.ts), or import it in the browser and open the Eir and Aurora Complement and the Crew Pool. Cause:
  welcomeTransportCount (src/lib/game/transports.ts ~159, used at crewOverlay.ts ~1374-1380) sizes the welcome by
  TOTAL berths, but transports roll random divisions and ranks; the per-division and per-rank caps
  (commandStructure.ts remainingCapacityForSignature) reject the mismatch and the surplus is swept to the reserve.
- A4-26, retiring a captain leaves the consumed XO pinned in a saved roster. After retireCaptain,
  seatAssignments still reads {executive: "officer-xo"} while officers is empty, also after save and reload. Repro
  (scratch gaps.qa.test.ts): assignSeat(roster, executive, XO), then retireCaptain. Cause: captainRetirement.ts consumes
  the XO via fireOfficer (seniorStaff.ts ~652), which filters state.officers only and never scrubs
  personnelRosters[].seatAssignments; the roster panel select (PersonnelRostersPanel.svelte ~470) is then bound to an
  id with no option.
- A2-7, the Personnel Rosters facility card uses an emoji glyph. The 375 layout itself holds (no sideways scroll on any
  fresh-save tab). Repro: Facilities tab, the Personnel Rosters card. Cause: src/App.svelte ~11628
  fpane("personnelRosters", emoji, ...), new in 0.14.0; needs an SVG icon in icons.ts.
- A0-1, About still reads "Version 0.13.11.3". Expected until the release wiring bumps APP_VERSION
  (src/lib/patchNotes.ts:18). Repro: System window, About, on the 0.14.0 build.

Part B (regression):

- R2-1, Home's time left for refines and crafts ignores time already spent. Repro: Refine x100 Polysilicate Wafer at
  1x; the Home row reads 33:00 for a whole 20 s item while the Refinery console reads 32:52. Cause: craftQueue.ts
  ~511-513 etaTicks = (remaining + 1) * durationTicks ignores the in-flight job's remainingTicks, so the Home ETA
  overstates and steps per item.
- R3-1, locked captain slots lack their requirements. Repro: fresh save, Crew, Captain Roster: slots 2 to 4 read only
  "Locked / Recruit via Homeworld Talents -> Fleet Logistics"; no Fleet Admiral level or talent cost shown. Code:
  App.svelte ~18030-18031.
- R5-2, no continuous refine order in the UI. Repro: Refinery, Production, configure a line: only Qty (batch) exists.
  App.svelte ~8933-8934 notes continuous is engine-supported but not surfaced. Confirm-first, live status and Cancel
  worked.
- R6-3, Ships roster sort, view and search reset on reload. Repro: sort Name and By class, reload: sort reverts to
  Attention, the filter to All, the search clears; only favorites persist. Documented as intentional (App.svelte
  ~2089-2094 marks these non-persisted), so this is a sheet versus design call.
- R8-6, While You Were Away has no auto-salvage section. The engine runs auto-salvage offline (salvage.test ~4338
  parity), but OfflineSummary (offlineSummary.ts ~92-105) carries only missions, credits, XP, materials, repairs and
  relics. Repro: Debug +1h, the recap lists nothing taken.
- R11-4, While You Were Away has no section for queued orders that started or upgrades that finished. The engine does
  both offline (craftQueue offline parity tests); the recap shows only captain XP and materials (offlineSummary.ts
  ~92-105).

Not counted as FAILs (observations from passing rows):

- Sheet lines that do not match the app: A16-1 the Wiring tab's owned sources on a fresh save are 24 (Ship 16 from
  Standard Issue plus 8 pre-granted facility rung-1 sources: Mission Control, Lab, Fabricator, Telescope, Personnel
  Rosters), while the sheet names only Standard Issue and the complement. R1-4 there is no header currency order
  control (fixed order by design, App.svelte ~2977-2991), and tapping a currency opens a description popover, not a
  numeric breakdown.
- R2-5 Statistics: "Fleet Admiral XP Awarded" equals Captain XP and excludes the Fleet Admiral XP from finite work
  (upgrades, research, crafting): tick.ts ~5637-5638 adds that process XP without a lifetimeStats fold.
