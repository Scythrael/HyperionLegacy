# Credit Sinks Pass for 0.14.0: INVENTORY AND PROPOSALS

Status: DRAFT for user review (2026-10-16). Nothing here is built. No game code changes with this doc.

**Authority order:** the user's decisions, then this doc, then code.

**The user asks this serves (verbatim):**

- Telescope costs (2026-10-12, telescope design user #9): "we should ultimately revisit the credits. Unless we can
  find a proper sink for credits. Something that needs a bit of additional planning."
- Repairs (2026-10-16, gear wear W4 + W5): "Unless we can find other proper sinks for credits, then we should
  probably have an option for repairs that involve credits potentially. That or a repair station later that can
  repair up to specific tiers of gear, etc."
- Scope chosen (2026-10-16): "Short pass now (Recommended)": list every place credits come in and go out today,
  propose a few healthy sinks (repairs, telescope, upgrades) so 0.14.0's economy holds up; the user approves each.

**Standing rules every proposal must obey:** peace is the product (nothing forces paying, no punishing grind, a sink
is a convenience or an optional extra, never a gate); diminishing returns, never hard caps, on stacking bonuses
(D23); everything wired (a configured value must measurably act).

**Markers.** `(user)` = the user's decision. **[PROPOSAL]** = mine: every name, number, rule and formula so marked
is the user's to accept, change or reject. **[NEEDS NAME]** = a new game entity the user has not named; nothing so
marked exists until the user names and approves it.

## 1. Method

- Sources and sinks found by grepping `creditsPerCycle`, `credits +=`, `credits.minus`, `credits:`, `sellValue`,
  `rewardMargin`, `creditsMin`, `researchCreditCost`, then reading each hit (line numbers as of `d8252ae`).
- One tick is one second (`tickDurationSeconds: 1`, model.ts 12801), so a mission cycle in ticks is its length in
  seconds: transit out + extraction (cargo / rate) + transit back + unload.
- Measured with the WR-2 headless simulated player (`src/lib/game/sim/`), seed 0, via a scratch test that was
  deleted after the run. Results in section 3.

## 2. Inventory

### 2.1 Sources (credits in)

| Source | Where | Size |
| :- | :- | :- |
| Mission flat reward per cycle | model.ts 519, 545, 569, 587, 611, 648, 669 (`creditsPerCycle`); paid tick.ts 2391 | 10 (Local Deuterium Skim), 30 (Local Asteroid), 75 (Lunar Mine), 50 (Salvage), 60 (Forage), 100 and 120 (the two Tier II surveys) per cycle |
| Transport margin | model.ts 705 to 708 (Frontier Supply Run: 4 credits per cargo unit loaded, 25% margin), 726 to 729 (Colony Supply Lift: 6 per unit, 35%); tick.ts 2141, 2376 | net = hold x cost per unit x margin: a 90 hold nets 90 (Frontier) or 189 (Colony) per cycle; scales linearly with the hold |
| Patrol bounty | tick.ts 2714 to 2715 (Sweep 10 to 30 per won wave), 2754 to 2755 (Warband 30 to 70 per won wave); rolled combat/patrolLoot.ts 147 | about 20 to 90 (Sweep) and 60 to 210 (Warband) per won patrol |
| Expedition objective haul | gambit.ts 1647 to 1648, 1721: round((40 + 120 x hazard) x scale); risk bonus x (1 + bonus), groundTasks.ts 270; split by segment, groundOps.ts 1624 | 40 to 160 per objective before the risk bonus |
| Supply cache (scan event) | expedition.ts 268 (5% per boundary), gambit.ts 1974 (`SUPPLY_CACHE_SCALE` 0.3), 2058 to 2064 | about 12 to 48 per cache |
| Ship-event encounter haul | shipScanEvents.ts 409 | one haul per won encounter, same formula |
| Boarding loss (negative) | shipScanEvents.ts 121 (`BOARDING_CREDIT_LOSS_SHARE` 0.1), 340 | removes 10% of the credits a run has found so far (never below zero); never touches the bank |
| Hull salvage refund | salvage.ts 216 to 217 (30% to 40% band), 933 (`creditsRecovered`) | 30% to 40% of the hull's build credits (150 to 2,000), times the museum salvage yield |
| Quartermaster sell | quartermaster.ts 758 to 767; model.ts 8143 | Deuterium Ice only (deprecated stock), 40 per unit; a one-time clear-out, not a stream |
| Dev grant | App.svelte 4565 | `?dev` Debug only, not a game source |

**Income per ship per hour at base speed** (before talents, museum bonuses and faster hulls):

| Run | Cycle (s) | Credits per cycle | Per hour |
| :- | :- | :- | :- |
| Local Deuterium Skim | 98 | 10 | about 370 |
| Local Asteroid | 148 | 30 | about 730 (sim measured 720) |
| Lunar Mine Contract | 248 | 75 | about 1,090 (sim measured 1,125) |
| Salvage Skirmish Wreckage | 188 | 50 | about 960 |
| Forage Minerals and Flora | 208 | 60 | about 1,040 |
| Survey Mineral Anomaly | 298 | 100 | about 1,210 |
| Survey Stellar Phenomena | 318 | 120 | about 1,360 |
| Frontier Supply Run (90 hold) | 248 | 90 net | about 1,310 |
| Colony Supply Lift (90 hold) | 308 | 189 net | about 2,210 |

**Fleet income by stage** (estimates from the table; offline time earns at the same rate):

- **Early** (hours 0 to 3, one ship, Tier I runs): about **700 to 1,100 per hour**.
- **Mid** (3 to 4 ships, Tier I and II mix, Fleet Admiral about 5 to 11): about **4,000 to 6,000 per hour**.
- **Late** (8 to 10 ships, surveys and transports with bigger holds, Fleet Admiral 14+): about **12,000 to 20,000
  per hour**, plus patrols (tens to low hundreds each) and expeditions (a few hundred to about 1,500 per run).

### 2.2 Sinks (credits out)

| Sink | Where | Size | Kind |
| :- | :- | :- | :- |
| Research projects | model.ts 8623 (`researchCreditCost`), 8776 to 9918; deducted tick.ts 7388 | 72 projects, 500 to 6,000 each, **117,800 total** | one-time |
| Facility rungs with credits | tick.ts 6019; Research Lab 5,000 (model.ts 4840); Fabricator 5,000 + 20,000 (4907, 4948); Shipyard 2,000 / 8,000 / 20,000 / 50,000 / 125,000 (5011 to 5075); Salvage Bay 5,000 + 20,000 (5146, 5157) | **260,000 total** | one-time |
| Subspace Telescope rungs | model.ts 4659 to 4666 (`SUBSPACE_TELESCOPE_LEVELS`), same upgrade path | 4,000 / 10,000 / 25,000 / 60,000 / 150,000 / 375,000 / 900,000, **1,524,000 total**, Fleet Admiral gated 3 to 20 (PROVISIONAL, user #9) | one-time |
| Transit berths | model.ts 10722 (1,200 x rung, 8 rungs); tick.ts 6255 | **43,200 total** | one-time |
| Docks | model.ts 10738 (2,000 x rung, 8 rungs); tick.ts 6271 | **72,000 total** | one-time |
| Hull builds | model.ts 1065 to 1325 (`buildRecipe.credits`); tick.ts 7093 | 500 (Freighter) to 5,000 per hull; one of each type is 28,400 | repeatable, partly refunded by salvage |
| Talent respec | tick.ts 1627 (`RESPEC_COST_CREDITS` 50), 12113, 12173 | 50 | repeatable, trivial |
| Buy Fuel | tick.ts 7917 to 7930 (`FUEL_CREDITS_PER_UNIT` 20, model.ts 1435); UI App.svelte 8774, 12996 to 13012 | 20 per unit | **dead**: since 0.13.6 fuel no longer depletes (tick.ts 3797, 4375), so it buys nothing |
| Transport load cost | tick.ts 2376 | hold x 4 or 6 | working capital, returned on delivery: not a sink |

**Not credit sinks today** (verified): crafting (materials and time only), candidate-board hires (free), the
Quartermaster standard kit (free), talents (points), material-only facility rungs (Refinery, Fuel Storage,
Warehouses, Mission Control). **Inert field:** `ShipTypeDef.cost` (model.ts 171, values 25 to 800) is read nowhere.

**One-time sink total:** about **521,400** without the telescope, about **2,045,400** with it.

## 3. Measured (WR-2 sim, seed 0)

- `newcomer` (real fresh save, General Freighter, board hires, free kit, cheapest talents and rungs; 2 h of Local
  Asteroid, a Sweep, then expeditions): **720 credits at 1 h, 1,440 at 2 h, 1,509 at 8 h, and 0 credits spent in 8
  hours**. Every choice it makes is free or material-only, and its first expedition stalls in flight (no claim), so
  income stops after the gathering phase.
- `allAuto` (Orion, 20 min gathering): 249 at every horizon, 0 spent.
- One hour of a single gather: Local Asteroid 720, Lunar Mine 1,125; Salvage and Forage refused (captain level).
- Reading: the measurement confirms the per-cycle math above and shows the newcomer loop asks for no credits at all.
  The sim does not research, build hulls or buy rungs with credits, so it is a floor, not a typical player.

## 4. Where credits pile up (the user's worry)

1. **After the one-time ladders end.** About 521,400 of non-telescope sinks is roughly 100 hours at mid income or
   about 30 to 40 hours at late income. After that the only things left are telescope rungs and new hulls, and
   **no repeatable sink grows with income**. Late income (12,000 to 20,000 per hour) then piles up for good.
2. **During Fleet Admiral gate waits.** Telescope rungs are FA gated (level 4 at FA 8, level 8 at FA 20), and the
   Shipyard ladder is long, so a mid or late player often holds a large balance with the next purchase locked.
3. **Early, quietly.** The free-first early loop (free hires, free kit, material-only rungs) never asks for credits,
   so the balance climbs from minute one. Research (500 and up) and the Shipyard founding (2,000) are there, so this
   is not a problem in itself; it does mean the first credit purchase is a choice the player has to find.
4. **A trap, not a sink.** Buy Fuel still takes 20 credits a unit for fuel that no longer depletes: a player can
   spend credits for nothing. That works against peace and should go (H1).

## 5. Proposed sinks for 0.14.0

Shared rules for every sink below [PROPOSAL]: optional; the free path always exists and is never slowed to make the
paid one attractive; the price is shown before the click; no timers, streaks or decay push the player to pay; no
hard caps (prices rise on a curve instead).

### S1. Quick Service: paid instant gear repair [PROPOSAL, from gear wear (user "Free auto + paid rush")]

**DROPPED (user, 2026-11-09): S1 and its price call OC-C1 are not built.** The user answered Quick Service "None, always
automatic (Recommended)": no paid rush and no instant repair; gear repair stays free and automatic (gear wear design,
USER ANSWERS 2026-11-09). This pass may need a replacement sink in S1's place (the user's 2026-10-16 reason for a paid
repair was finding proper credit sinks). Overtime on gear repair (speed only, never instant) is still built.

- **What:** on a ship's care line, "Service now" returns its installed gear to Pristine at once for credits. The
  free automatic repair over time stays the default and is untouched.
- **Why peaceful:** the user already chose "free auto + paid rush"; it saves waiting, never unlocks anything, and a
  player who never presses it loses nothing.
- **Size [PROPOSAL]:** per piece, minutes left to Pristine on the free path x 2 x the gear's tier, summed for the
  ship. A Tier I piece 30 minutes out costs 60; a Tier V piece 30 minutes out costs 300; a late fleet service is a
  few thousand. Grows with the gear players hold late, so it keeps meaning something.
- **Alternatives:** the gear wear doc's 2% of the hull's build credits x average missing condition (tiny: under 100
  on most hulls, so not a real sink); a flat fee per ship; a price scaled to the fleet's measured income.

### S2. Shipyard rush: hull repairs and hull builds [PROPOSAL]

- **What:** "Finish now" on a Shipyard bay's hull repair or hull build, for credits.
- **Why peaceful:** the auto-started repair and the build keep running for free; a rush only buys time back. It
  matches the paid gear rush so the two read as one "care" pattern (hull stays separate, user W6).
- **Size [PROPOSAL]:** a build rush costs the remaining fraction x the hull's build credits (a rush from the start
  at most doubles the price: 500 to 5,000); a repair rush costs minutes left x 20 x the hull tier.
- **Alternatives:** repairs only; also research and facility upgrades (not recommended: it lets credits shortcut
  the pacing those ladders carry); none.

### S3. Telescope development past level 8 [PROPOSAL, NEEDS NAME]

- **What:** after the 8-rung ladder, a repeatable development cycle (credits + time, same upgrade framework) that
  adds a small, wired bonus on a D23 concave curve, for example scan speed or find chance from telescope reads.
- **Why peaceful:** pure late-game extra with no ceiling to chase and no power gap that matters; it gives late
  income a permanent, slowly rising use, which is exactly the gap in section 4.
- **Size [PROPOSAL]:** cycle n costs 250,000 x 1.5^(n - 1), 30 minutes each; each cycle's bonus is smaller than
  the last (concave), never capped. The 8 rungs keep their current values (still PROVISIONAL per user #9; the curve
  from 4,000 to 900,000 lines up with the income stages above, so no retune is proposed).
- **Alternatives:** retune the 8-rung ladder only; leave the telescope as it is and put the late sink elsewhere.

### S4. Personnel Rosters board expansion with credits [PROPOSAL, already drafted as CP-19 / OC-17]

- **What:** the candidate board expansion already proposed in the complement plan (CP-19: a Personnel Rosters
  upgrade track, credits + time, +2 board slots per rung) carries the credits.
- **Why peaceful:** more choice on the board, never required; the base board stays.
- **Size [PROPOSAL]:** rung n costs 3,000 x n credits, 5 rungs (3,000 to 15,000, 45,000 total), time on the
  facility framework. A mid-game sink.
- **Alternatives:** materials + credits; credits only on the later rungs; leave CP-19 credit-free.

### S5. Quartermaster Field Kit restock for credits [PROPOSAL]

- **What:** besides the free basics and crafted stock (user, Field Kits "Free basics + your stock"), the
  Quartermaster sells extra kits for credits, plus an optional per-team toggle "Top up from the Quartermaster at
  launch" (off by default) that buys only the shortfall against the team's pack preference.
- **Why peaceful:** fewer clicks for players who would rather not craft; the free basics still cover every
  objective; a toggle the player sets once is QoL, not pressure. It is the one proposed sink that repeats every run,
  so it scales with how much a player plays.
- **Size [PROPOSAL]:** about 3x the kit's crafting material value; for example First Aid Kit 60, Combat Stim 150,
  higher-tier kits by tier. No purchase cap.
- **Alternatives:** buy basic kits only; no purchase (craft only).

### S6. Crew and officer training [PROPOSAL, NEEDS NAME, recommend defer past 0.14.0]

- **What:** pay credits + time to move a crew member or officer toward their next level.
- **Why peaceful if built:** optional; prices rise on a curve. **Risk:** it reads as pay to progress and can make
  play feel like it needs credits, so it is the least peaceful idea here. Recommend logging, not building now.
- **Size [PROPOSAL]:** a cost curve tied to the XP still needed; to be set if the user wants it.

### S7. Repair Station (future, logged) [NEEDS NAME]

- The user's own idea: a facility that repairs gear up to specific tiers. Its build and upgrade rungs are a natural
  credit ladder (rung n opens repair for the next gear tier). **Not 0.14.0**; logged here so the Quick Service
  price and this facility are planned together (for example, a Repair Station rung could lower the Quick Service
  price for the tiers it covers).

### Housekeeping (not sinks)

- **H1. Retire Buy Fuel.** It takes credits for nothing since 0.13.6 (section 4.4). Remove the +10 / +100 / Fill
  buttons and keep `buyFuel` only if a test or `?dev` needs it.
- **H2. Inert `ShipTypeDef.cost`.** model.ts 171 (25 to 800) is read nowhere; delete it ("everything wired"), or
  wire it if the user wants hulls buyable outright.
- **Considered and not recommended:** credit fees on crafting. It taxes an existing free loop, adds friction to
  every craft, and buys the player nothing.

## 6. OPEN CALLS (multiple-choice ready; recommended first)

- **OC-C1, Quick Service price.** DROPPED 2026-11-09 with S1 (user: "None, always automatic"). (a) Minutes left x 2 x gear tier, per piece (Recommended). (b) 2% of hull build
  credits x missing condition (the gear wear doc's figure). (c) Flat fee per ship. (d) Scaled to measured fleet income.
- **OC-C2, Shipyard rush scope.** (a) Hull repairs and hull builds (Recommended). (b) Hull repairs only. (c) Also
  research and facility upgrades. (d) No Shipyard rush.
- **OC-C3, telescope.** (a) Keep the 8 rungs; add repeatable development past level 8 on a concave curve
  (Recommended; needs a name). (b) Retune the 8 rungs only. (c) Leave as is.
- **OC-C4, Personnel Rosters (CP-19) cost.** (a) Credits + time, 3,000 x rung (Recommended). (b) Materials +
  credits. (c) No credits.
- **OC-C5, Field Kit restock.** (a) Quartermaster sells kits plus an off-by-default top-up toggle (Recommended).
  (b) Sells kits, no toggle. (c) Basic kits only. (d) No purchase.
- **OC-C6, training.** (a) Log for after 0.14.0 (Recommended). (b) Build a small version now. (c) Drop it.
- **OC-C7, Repair Station.** (a) Log for after 0.14.0, priced with Quick Service in mind (Recommended). (b) Build
  in 0.14.0. (c) Drop it.
- **OC-C8, Buy Fuel.** (a) Retire the buttons (Recommended). (b) Keep behind `?dev` only. (c) Repurpose fuel.
- **OC-C9, inert ship price.** (a) Delete `ShipTypeDef.cost` (Recommended). (b) Wire it as a buy price.
- **OC-C10, crafting fees.** (a) No (Recommended). (b) A small fee per craft.

## USER ANSWERS

(none yet)

## USER ANSWERS (2026-10-16, verbatim where quoted)

- **Paid shortcuts:** "Quick gear repair (Recommended)" PLUS: "Perhaps we can have an "overtime" system that we can pay
  credits to increase the speed of a given job for each of the above by a specific percent. Not doubling or instant
  completion, but perhaps that could be a useful sink for credits." So: OVERTIME (user-named): pay credits to speed a
  running job by a set percent (never doubling, never instant), available for gear repair, Shipyard repairs and builds,
  research and facility upgrades. Quick gear repair stays. (Shipyard instant rush is replaced by Overtime.)
- **Telescope:** "Endless cycles and potentially could improve spotting rarer aspects about a planet that could change
  what the scan results in (potentially, these aspects of a planet could affect the scan phase and seed the objectives
  on a planet accordingly)." So: endless development cycles past level 8 (diminishing, no cap; name pending) that also
  improve spotting RARER PLANET ASPECTS which change the scan and seed that planet's objectives (new mechanic; scope
  asked 2026-10-16).
- **Field Kits purchase:** "Quartermaster sells + top-up (Recommended)".
- **Overtime shape:** "+25% steps, rising cost (Recommended)": each purchase +25% of the normal rate, a few steps max,
  each step costlier (diminishing; never doubling, never instant), priced by job size and tier. Shares ONE speed seam
  with the tutorial time-skip hook.
- **Rare planet aspects:** "Hook now, content later (Recommended)": 0.14.0 builds a planet-aspect slot a scan can reveal
  and that can seed objectives (shared with the objective affix system); telescope cycles raise the spot chance; the
  aspects themselves are designed with the user later.
- **Cleanups (all):** retire Buy Fuel; delete the unused ShipTypeDef.cost; no crafting fees; log the Repair Station and
  crew training as future ideas.
- **Speed seam calls (2026-10-17):** OC-S1 + OC-S2 + OC-S3 "3 steps, 10/min x tier (Recommended)" (max 3 steps,
  1.75x; step k costs ceil(10 x job minutes x tier x k); not offered on a job's final tick); OC-S4 + OC-S5
  "Uninspected gear, not 'earned' (Recommended)"; OC-S6 "Up to 30 days (Recommended)".

## SPEED SEAM DESIGN (2026-10-17, built: `src/lib/game/processSpeed.ts`)

Serves the USER ANSWERS above (Overtime: "+25% steps, rising cost", one seam with the tutorial time skip) and the
safe first runs plan's USER ANSWERS group 2 (a time skip on every timed process, "Hook only"; a grant hook) and
group 3 (a TUTORIAL duration constant for the first explorer expedition, SF-2's job). No UI in this slice: an
Overtime button needs a sketch first.

**The data shape.** One optional record, `speed?: ProcessSpeed = { overtimeSteps?: number; instantComplete?: true;
clockOffsetSeconds?: number }`,
on `TimedProcess`, `CaptainMissionState`, `PatrolMissionState` and `Expedition` (model.ts). Absent on everything
nothing sped up, so a save without a purchase is byte-identical (every existing golden is unchanged). Plain numbers
and a flag: no migration, SAVE_VERSION stays 70.

**How each process reads it.**

| Process | Where its timing lives | Overtime | Time skip |
| :- | :- | :- | :- |
| Refining, crafting, research, relic study, facility upgrades (incl. the Docks, berths and storage tracks), ship builds, ship repairs, salvage | `TimedProcess.remainingTicks`, a countdown resolveProcesses subtracts | buyOvertime rescales `remainingTicks` (work left = remainingTicks x rate; new time = that / new rate) and records the step; resolveProcesses is untouched | `remainingTicks` = 0: the job completes on the next tick through its normal completion branch (same effect, XP lump, log entry) |
| Captain missions (extraction cycles) | `phase` + `phaseProgressTicks` | not offered | tickCaptainMission runs the CURRENT cycle through to its delivery inside the next tick without spending that tick's time (same rolls, cargo, XP, berth claim); the next cycle is built without the flag |
| Patrols | `progressTicks` along the route | not offered | tickCaptainPatrol flies the CURRENT route (and a limp home) to its end inside the next tick; a relaunched route is built without the flag |
| Expeditions | `phaseAnchorSeconds` against the game clock | not offered | advanced to its own completion at once (pure in elapsed time and the run's seed, so the findings are the ones the run would produce) and stamped; a run that cannot finish on its own within 30 days of its clock (a team that keeps failing) is refused **[PROPOSAL]** |

**A skipped expedition's claim.** The skip runs the run's own clock to its natural end E while the game clock stays at
now, so the run's stored times (its medical bay ends) sit on its clock. The stamp records `clockOffsetSeconds` = E -
now, and the Ground Ops claim (injuries.ts applyGroundOpsInjuries) reads them shifted back by it: a member comes home
injured only if still in the bay at E, with exactly the time left at E. Tests: findings AND claim parity with the run
claimed at its natural end, on finishing Ground Ops runs (review follow-up, 2026-10-17). `canApplyTimeSkip` on an
expedition runs the whole run ahead (up to 30 days of its clock), so call it on a player action, never per render.

Offline == live: Overtime changes only the stored countdown, so one catch-up call and many one-tick steps subtract
the same ticks and complete on the same tick (tests per Overtime kind; a mid-job two-step case). The skip on a
mission or patrol is closed-form for the same reason the loops already are. Nothing in the seam draws.

**The tutorial duration (group 3).** The first explorer expedition's TUTORIAL duration constant (set equal to the
normal Tier I length) is chosen at dispatch by SF-2; nothing in this seam interferes with it, and the instant
variant is `applyTimeSkip` on that expedition.

**Overtime [PROPOSAL] numbers.**
- Rate after k steps: 1 + 0.25 x k (user). **Max 3 steps** [PROPOSAL]: at most 1.75x, never double, never instant;
  the time left goes to 80%, 67%, then 57% of the normal-rate time, so each step saves less than the last.
- **Price of step k:** ceil(10 credits x the job's minutes x its tier x k) [PROPOSAL]. Job minutes = its own full
  length (durationTicks, which already carries facility speed bonuses), so the price does not depend on when it is
  bought. Tier = the hull being built or repaired, the blueprint being researched, or the rung being built (never
  below 1). Examples: a 5-minute Tier I hull build costs 50 / 100 / 150; a 20-minute build 200 / 400 / 600; the
  45-minute telescope level 8 rung (tier 8) 3,600 / 7,200 / 10,800.
- Offered on Shipyard builds and repairs, research and facility upgrades (incl. the Docks, berths and equipment
  storage tracks) (user list); not on refining, crafting, salvage, relic study, missions, patrols or expeditions.
- Refused when the job is maxed, time-skipped, on its last tick [PROPOSAL], or the balance is short. The job's size
  (and its lump Fleet Admiral XP) is unchanged; only the time left changes. `processWorkFraction` is the honest
  progress bar under Overtime (the existing bars jump forward at a purchase, the time-left readouts stay right).
- Known display item for the UI slice: the completion log back-dates a job's start by its full length, so a sped-up
  job reads as started earlier than it was.

**The grant hook.** `grant(state, { credits?, items?, gear?, hullType? }, reason)` returns the state and a System Log
line ("<reason>. Received 500 credits, 4 Frame Segments, 1 uninspected Plasma Cannon and a General Freighter.").
All or nothing; positive whole amounts only. Items fill up to their storage cap (the line names what arrived; a
bundle of items that are all at their cap is refused as `storageFull`). Gear
arrives as uninspected pieces of a gear blueprint (the same blank a Fabricator craft deposits) **[PROPOSAL]**, so a
grant makes no draws; a pre-rolled piece would need a seeded roll. The hull is minted exactly as a Shipyard build
mints one (`mintBuiltShip`, Standard Issue installed) and is refused when the Docks are full. A grant is not income:
lifetime credits earned are unchanged **[PROPOSAL]**.

**Wiring registry.** Overtime is LIVE (`facility:SPEED_SEAM:overtime`, a divisor on a running job's time left at the
shipyard, research and facility contexts). The time skip and the grant are the new `seam` status, owned by the
tutorial patch and the tutorial / quests patch (tested in processSpeed.test.ts; not release blockers).

**Open calls, ANSWERED (user, 2026-10-17):** OC-S1 to OC-S3 "3 steps, 10/min x tier" as built (3 steps; 10 per job
minute x tier x step; refused on a job's last tick); OC-S4 and OC-S5 "uninspected gear, not counted as earned" as
built; OC-S6 "up to 30 days" as built.

## USER ANSWERS (2026-11-02)

- OC-C4 (candidate board expansion cost): answered with CP-19, "Personnel Rosters track (Recommended)", credits + time,
  3,000 x rung (see the complement plan's 2026-11-02 answers).
- Endless telescope cycles past level 8: named "Deep Field Refinement" (levels shown as "Refinement N").

## OT-UI builder note (2026-11-09): nothing built, open calls for the user

The OT-UI slice (Overtime UI and Deep Field Refinement) stopped before code: every remaining piece needs a user call
or a mockup sign-off.

- **Overtime buttons (Shipyard builds and repairs, research incl. data studies, facility upgrades incl. the Docks,
  berths, storage tracks and telescope rungs):** need a mockup. The speed seam design says "an Overtime button needs a
  sketch first", and the 2026-11-09 approval in the gear wear design covers "Gear card only". The engine is ready
  (`canBuyOvertime` / `buyOvertime`, registry row `facility:SPEED_SEAM:overtime`). The mockup should also settle: one
  tap or a confirm (answered for gear repair only), the progress bar under Overtime (`processWorkFraction`), and the
  completion log that back-dates a sped-up job's start (Known display item above).
- **Deep Field Refinement, its lever:** the user's words (2026-10-16) are that the cycles raise the chance to spot
  rare planet aspects. No aspect slot and no aspects exist yet (E5 plan, 2026-11-03), and the aspects "are designed
  with the user later". A cycle bonus built now would act on nothing (inert). Choices for the user: design the aspect
  hook and its first aspects first, then build the cycles; or give the cycles a lever that acts today and move it to
  aspects later (which lever is the user's call).
- **Deep Field Refinement, its numbers:** S3's cost (250,000 x 1.5^(n - 1) credits, 30 minutes a cycle) and its bonus
  curve are still [PROPOSAL]; no user answer. For reference, the proposed costs: Refinement 1 = 250,000, 2 = 375,000,
  5 = 1,265,625, 10 = about 9,610,840.
- **Deep Field Refinement, the card:** past level 8 the telescope card reads "Fully upgraded" today; showing
  "Refinement N" and the next cycle there is a card change to sketch for sign-off.

## USER ANSWERS (2026-11-10): OT-UI

- Overtime UI: "Yes, mock it up (Recommended)". Mockup docs/mockups/2026-11-10-overtime-buttons-mockup.html "Approve
  (Recommended)" with: "One tap, always visible (Recommended)"; "Chip + no jump (Recommended)" (a 1.25x style rate chip
  on the time line; bars measure work done so a purchase never makes the bar jump); "Show both times (Recommended)"
  (completion log "took 8:20 with Overtime (10:00 at the normal rate)", needs a small engine field); "Yes, add bar +
  Overtime (Recommended)" (docks expansion, transit berths, equipment storage get a bar, time and the strip); "Rate chip
  only (Recommended)" on Command Home (no buy button there); "Match each row (Recommended)" (time format);
  "Replace them now (Recommended)" (emoji on the rows this build touches become SVG glyphs).
- Deep Field Refinement: "Wait for aspects (Recommended)". Rare planet aspects are designed with the user first; Deep
  Field Refinement ships together with them (possibly after 0.14.0). Nothing inert ships now.

## USER ANSWER (2026-11-13): replacement for Quick Service

"Measure first (Recommended)": re-run the economy sim with Overtime and endless telescope cycles in place, show the user
the late-game balance curve, then decide whether a new sink is needed (candidates on the table: crew training S6,
endowments to the Museum, Archive or Research Lab, homeworld investment). Keeps 0.14.0 from growing. QUEUED.
