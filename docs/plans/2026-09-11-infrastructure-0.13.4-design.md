# Infrastructure (0.13.4) : Design

- **Date:** 2026-09-11
- **Branch:** `feat/infrastructure-0.13.4` (grounded in a read of tip `3ed5c10`, branched off prod)
- **Status:** design draft for user review. Every code claim below was read out of the branch tip, not recalled.
- **Owns:** four infrastructure systems. **No UI presentation work.** The Ops / Logistics readability tidy went to 0.13.5 by explicit user decision.
- **Save impact:** **SAVE_VERSION 42 -> 43** (phases 0 to 4), and **43 -> 44** only if the lane-allocation phase ships in this release rather than peeling. Both additive. See section 10.
- **Parity:** the pre-existing baseline must stay **EXACTLY 101** at every unit, and the lane-allocation model must be **byte-identical on a single-lane facility** so that baseline keeps its meaning. See section 9.
- **Size:** smaller than 0.13.3 in surface area, larger than it looks in risk. Built in **seven gated phases** (section 12) so phases 5 and 6 (the lane model) can peel.

> ⚠️ **READ SECTION 1 FIRST. It is the SCOPE RECONCILIATION.** It quotes the user's own words for every feature and states, item by item, what this design does about each. Anything not traceable to a user statement is marked as **CLAUDE INFERENCE** and listed again in section 13 for their review.
>
> ⚠️ **SECTION 14 IS LOCKED.** It overrides any narrower or contradictory reading elsewhere in this document. Section 15 is the self-consistency pass.

---

## 1. SCOPE RECONCILIATION (the process fix this document exists to embody)

**Why this section is first.** 0.13.3 cost a significant round trip because its design doc encoded a NARROWER scope than the user had actually stated, and the build then followed the doc faithfully for dozens of commits. The same doc contradicted itself in two places and the wrong half was implemented. Its own section 15e records the rule that came out of it:

> Reconcile a plan against the USER'S OWN STATED SCOPE, not merely against the design doc, before building.

So: the user's words first, the design's answer second, and a visible flag on everything that is mine rather than theirs.

Sources quoted below are the verbatim entries in `SUGGESTIONS.md`: **0.13.4 SCOPE LOCKED**, **TWO KINDS OF DOCKING SLOT**, **THE LANE ALLOCATION MODEL**, **PER-FACILITY QUEUE-DEPTH TALENTS**, **QA DECISIONS RULED** (item D6), **THE STARBASE**, and **SHIPYARD BERTHS**.

### 1.0 The release scope itself

| The user said | What this design does |
|---|---|
| "all four parked items ship together: the transit-berth / turnaround docking slots, patrol termination reasons (QA item D6), the lane-allocation model (free lanes join a running order once nothing new is waiting), and per-facility queue-depth talents (shared trunk, then branches)." | All four are designed here, each with its own section: F1 section 5, F2 section 6, F3 section 7, F4 section 8. **Nothing is deferred out of the four.** |
| "0.13.4 should still be its own beast. A smaller patch, but still its own. Infrastructure under the hood and so forth." | Infrastructure only. No presentation pass. |
| "I haven't been emphasizing a ton of UI changes (only the glaringly obvious things like spacing and such), and left anything else to this patch", where "this patch" is the UI release. | The Ops / Logistics presentation tidy is OUT (section 2). ⚠️ But the docking feature's **visible status, queue position, ETA and upgrade control are IN**, because the same user made them hard requirements on that feature (quoted in 1.1). A status readout is the feature; a type-scale re-tune is 0.13.5. Section 2 states that boundary explicitly so it cannot be read as scope creep. |
| "Build it as its own gated phase so it can peel if it grows, the way 0.13.3's phases were structured." (of the lane model) | Phases 5 and 6 are the lane model and they are the declared peel point (section 12). |
| "Design the escape valve FIRST, not in QA." (of docking) | Section 5.5 is the escape valve, designed here, with the proof and the bound written out. |

### 1.1 F1, transit berths / turnaround docking slots

| The user said (verbatim) | What this design does |
|---|---|
| "Two distinct slot types on the Starbase, mirroring how the Shipyard already splits build capacity from repair capacity: 1. **Drydock berths** for ships that simply PARK there (today's docks capacity). 2. **Turnaround slots** for ships 'just passing through': a ship returning from a mission needs one FREE to dock and unload its cargo." | Adopted exactly. `state.shipStorageCapacity` keeps its job unchanged and becomes the **Drydock Berths** the player reads about; a NEW, independent capacity is added for the turnaround type. Two numbers, two tracks, no interaction (section 5.3). |
| "Name not settled; the user dislikes their own placeholder ('visitation ports'). Candidates that fit by definition: **Transit Berth**, Turnaround Bay, Cargo Gantry, Unloading Gantry." | **Recommends Transit Berth**, because the user's own scope-lock entry then wrote the feature's name as "transit-berth / turnaround docking slots", which is the closest thing to a decision in the record. Open question 1: naming is theirs to confirm. |
| "10 turnaround slots and 10 ships means nobody ever waits. 4 slots and 10 ships means ships queue to dock and unload on a schedule, adding transit, docking and unloading phases with a visible 'waiting to unload' status." | The queue, the schedule and the named status are all built (5.1, 5.6). ⚠️ **ONE DIVERGENCE, flagged:** this design does **NOT add a new `docking` MissionPhase**. The existing `unloading` phase already IS "docked and unloading" (`unloadTicks: 8` on every mission, `model.ts:414` onward), and adding a phase to `MISSION_PHASE_ORDER` would lengthen every mission cycle, move `requiredTicksForPhase`, and silently change the fuel-runway projection that reads `FUEL_CYCLE_PHASES` (`tick.ts:8632`), which is LOCKED as measured-EMA plus a pure two-phase projection. The player still reads two distinct named statuses across that boundary ("Waiting for a transit berth, 3rd in line" then "Docked, unloading"), so the user's described experience is delivered without the phase. Reasoning in 5.2. Open question 5. |
| "it extends the time taken for your missions, but that is just logistics." | Accepted as the intent. The design also bounds it: section 5.5 computes the worst-case extension (24 ticks at the recommended base with today's full 5-captain fleet) so "just logistics" is a measured claim rather than a hope. ⚠️ Note that the user's "4 slots and 10 ships" example assumes a bigger fleet than the game currently allows: `MAX_UNLOCKABLE_CAPTAINS` is 5 today. Section 5.3 explains why that changes the recommended base. |
| "Another upgrade track, more to do." | A new rung track, `TRANSIT_BERTH_RUNGS`, modelled on the existing bespoke `SHIP_DOCKS_RUNGS` (`model.ts:6265`) rather than on `FACILITIES`, because Docks has no `FacilityDef` at all (verified: `FACILITIES` holds exactly refinery, warehouseT1, warehouseT2, fuelStorage, missionControl, research, fabricator, shipyard, salvageBay). Section 5.3. |
| Friction requirements, stated as "Requirements, not suggestions": "the wait must be a NAMED, VISIBLE status ('Waiting to unload, 3rd in line') carrying queue position and ETA, the cause must be legible at a glance, and the fix must be reachable and affordable." | Section 5.6 answers all four, and they are treated as acceptance criteria, not polish. This is why a readout is in scope in a no-UI release. |
| Softlock: "Design the escape valve BEFORE building: what happens when every slot is occupied by something that cannot clear? ... Candidates: a slot a player action can always free, an overflow path that unloads slowly rather than not at all, or a guaranteed-free slot exactly as `shipBuildSlotCount` reserves the last bay for repair. The Shipyard already solves this class of problem in-repo and is the precedent to copy." | Section 5.5 evaluates the `shipBuildSlotCount` pattern honestly and **does not adopt its mechanism**, because that mechanism caps a competing consumer and there is only one consumer here. It adopts the pattern's **principle** (a structural proof, not a runtime hope) and supplies a different structural guarantee that fits the shape: berth occupancy is **time-bounded and derived**, never resource-bounded and never stored. Full argument, plus the three hazards it closes, in 5.5. |
| "ON ICE, explicitly: tying turnaround slots specifically to PROSPECTING missions. The user likes it but is not certain, so do not assume it." | Not built, not assumed, not referenced anywhere in the engine design. The berth gate is mission-agnostic. |
| From **THE STARBASE**: "Docks as a facility GO AWAY. The Starbase replaces them ... 'Docks' becomes 'Docking Bay'." | ⚠️ **OUT OF SCOPE and deliberately so.** The Starbase is a separate logged decision and it is NOT one of the four items the user locked for 0.13.4. Its own entry says "MIGRATION IS THE REAL WORK", naming the `FACILITIES` table, saved facility levels, `state.shipStorageCapacity`, the `docksExpansion` TimedProcessKind, the nav and the dashboard card, plus the in-flight-`docksExpansion` hazard. Folding that into 0.13.4 would put a facility retirement inside an infrastructure release the user asked to keep small. **Consequence stated plainly:** transit berths land on the Docks console as it exists today, and the Starbase work will later re-home BOTH berth types together. Section 5.8 lists what that costs. This is a **named deferral with a reason**, per the 15e rule, not an omission. |

### 1.2 F2, patrol termination reasons (QA item D6)

| The user said (verbatim) | What this design does |
|---|---|
| "The user wants a patrol to report **why it came home**, in the shape: *'Completed X combat patrol missions before returning to the homeworld. Reason for returning: X'*, where the reason is something like **ran out of fuel** or **was defeated in combat**." | Built as a real record, in that shape. "X combat patrol missions" comes from a per-run route counter (6.3); the reason comes from a new exhaustive `PatrolEndReason` union (6.2). |
| "This is a FEATURE, not a copy fix: nothing currently tracks a patrol's termination REASON, so the sim has to record why a run ended and carry it through to the completion record." | Confirmed against the code, and the finding is slightly better than the note: `CaptainStopReason = "fuel" \| "cargo" \| "defeat"` (`model.ts:2043`) DOES exist and IS stamped by the patrol arm, but it is documented in-code as a "TRANSIENT display hint" for the offline recap, it is deliberately unset on a clean completion or a recall, and it never reaches the log. So the reason is partially tracked and wholly unreported. Section 6.1 records exactly what exists. |
| "Doing it properly also means enumerating every way a patrol can end, **exhaustively**, so a new ending is a compile error rather than a blank reason." | Section 6.2 enumerates all five endings by reading `tickCaptainPatrol` and `economyTick`'s captain map, names the one path that looks like an ending and is not, and specifies the compile-error mechanism (an exhaustive `Record` over the union for the wording, plus a stated result-shape invariant that a test enforces because a type cannot express "iff"). |
| "That is combat and operations work, which makes it 0.13.4 territory alongside the missions patch." | Here. |
| From D5, the sibling ruling: "What was salvaged. What was gained. ... reusing the Salvage Bay panel's existing shaping rather than writing a second formatter, so the two surfaces cannot drift." | Applied to this feature as a principle: the patrol record goes into the **existing** `completionLog` ring buffer rather than a second array with its own eviction rule, so Home's "Recently completed" list has one source. Section 6.4, open question 12. |

### 1.3 F3, the lane allocation model

| The user said (verbatim) | What this design does |
|---|---|
| "**THE RULE, in one sentence:** a free lane takes the next **unstarted** queued order first; if no unstarted order is waiting, it **joins an order already running** and pulls one unit at a time from its remaining pool." | Adopted verbatim as the spec. Section 7.2 shows that `economyTick`'s existing tail-pass ORDER already encodes the two-level precedence for free (`promoteQueuedOrders` at `tick.ts:3551` runs before `processRefineLines` at `:3567`), so the rule is implemented by putting the join in the line engine and NOT in the promotion pass. |
| "queue 1000 of item A, 1000 of item B and 1000 of item C at a two-lane facility. A and B start on the two lanes; C waits. A finishes first (it is faster), so that lane starts chewing C one unit at a time. Later B finishes, and that lane starts chewing C as well. Both lanes now work C concurrently." | This worked example is treated as the acceptance test, literally: section 7.7 requires it as a named test case with both lanes provably on C. It is also the reason section 7.5 recommends NO per-order lane cap, since a cap could make the example end with one lane on C. |
| "**THE REAL ARCHITECTURAL CHANGE: orders stop owning lanes.** Today a craft line IS a lane, with `line.remaining` living on the lane itself, which is exactly why a batch cannot spread. This model separates THE WORK from THE MACHINE ... lanes are interchangeable capacity, not homes." | Adopted exactly. `remaining` moves off `CraftLine` onto a new `CraftOrder`; a `CraftLine` becomes the lane and gains `orderId`; several lanes may carry the same `orderId`. Section 7.3. The knock-on that matters most: the material reservation in `allocation.ts` must move from lines to orders or it double-counts, section 7.3.2. |
| "⚠️ **PARITY IS THE GATE, and it is a harder gate than usual.** This changes WHAT RUNS ON WHICH TICK, so offline-equals-live must be re-proven from scratch rather than assumed to carry ... The 0.13.3 multi-lane salvage parity cases are the shape to extend, not to trust as-is." | Section 7.7 re-proves it from scratch and does not inherit a single case. It adds the byte-identity gate for a single-lane facility (7.7 item 1) which is what keeps the pre-existing 101 meaningful, and it names the draw-order hazard that becomes common rather than rare. |
| "**THREE THINGS TO DECIDE BEFORE BUILDING**" (which order a freed lane joins; per-order lane cap; the ETA readout under a changing rate) | Sections 7.4, 7.5 and 7.6. Each presents the options and makes a recommendation. **None is silently picked**, and all three are repeated in section 13 as open questions. |
| "Applies to **all** queueing facilities: Refinery, Fabricator, Research Lab, Salvage Bay, Shipyard. Not the Fuel Depot, whose pipelines stay automatic ... Note the Shipyard interaction: `BUILD_CONCURRENCY_CAP` is 1 today, so until that is revisited the Shipyard has one build lane regardless and this model changes nothing there." | Section 7.8 walks all six facilities and states the per-facility answer, including that the Shipyard is a no-op today and the Fuel Depot is permanently excluded. Both claims verified in code (`shipBuildSlotCount` at `tick.ts:5470` is `min(BUILD_CONCURRENCY_CAP, bays - 1)` with the cap held at 1; the `fuelDepot` row in `QUEUE_ADAPTERS` at `tick.ts:7607` is a double-braked stub with the user's 2026-09-06 NO QUEUE decision recorded in it). |
| From the salvage-lanes entry: "More lanes means more salvages completing on the SAME tick, and completion order plus rng draw order must stay identical offline and live. ... lanes make it the common case rather than the edge one." | Carried into 7.7 as a required test family, and it is the reason 7.8 recommends KEEPING the Salvage Bay's existing one-unit-per-tick promotion bound rather than lifting it in this release. That recommendation is a deliberate, named, reasoned deferral (open question 9), with the cost quantified. |

### 1.4 F4, per-facility queue-depth talents

| The user said (verbatim) | What this design does |
|---|---|
| "The user wants depth bought **per facility**, so points spent on the Refinery's queue do not deepen the Fabricator's." | Built. `queueDepth(state)` becomes `queueDepth(state, facility)`. Section 8.2. |
| "The signature change is small and the compiler will find the callers: `queueDepth(state)` becomes `queueDepth(state, facility)`. The talent effect payload gains a facility key, or the union gains one member per facility." | Adopted, choosing the FIRST of the user's two offered shapes (a facility key on the existing payload) over the second (one union member per facility), with the reasoning in 8.2. |
| ✅ "**THE SHAPE IS DECIDED (user, 2026-09-10): ONE SHARED TRUNK, THEN PER-FACILITY BRANCHES.** A single global first point takes the default queue from 1 slot to 2 **at every facility** ('double the efficiency of the default queuing system'), and per-facility slots branch off from there." | Built, and it lands with **zero migration**, because the existing `fleetLogisticsQueue1` node ALREADY grants +1 at every facility and therefore already IS the shared trunk. It keeps its key, its cost, its position and its grant; only its payload gains an explicit `facility: "all"`. Section 8.3. |
| ⚠️ "**KEEP THE EFFECT ADDITIVE EVEN THOUGH THE FLAVOUR SAYS 'DOUBLE'.** ... If the effect were literally a MULTIPLIER, ordering would start to matter the moment per-facility points exist: double-then-add yields 3 while add-then-double yields 4 ... Additive effect plus doubling language gets the intended feel with none of the ambiguity." | Honoured. `queueDepth` stays a `reduce` that SUMS `depth` payloads onto `QUEUE_DEPTH_BASE` (`tick.ts:592`), and no multiplier is introduced anywhere. The trunk's player-facing copy keeps saying "second queued slot", which at base 1 is literally a doubling. |
| ⚠️ "**THE COST TO WATCH IS TALENT-WEB LEGIBILITY.** Three nodes become roughly five facilities times however many rungs, so a 3-node chain could become 15. ... Consider one node per facility with repeatable ranks, or a single node whose rank is allocated per facility, rather than a flat 15 nodes. **Decide the SHAPE before the numbers.**" | Shape decided before numbers: **five new nodes, one per queue-capable facility, fanned off the end of the existing chain. Not fifteen.** Repeatable ranks are rejected for this release because the talent store is a flat `HomeworldTalentKey[]` with no rank concept, so ranks are engine work in a release that is supposed to be small. Later per-facility rungs need ZERO engine change because `queueDepth` sums. Section 8.4. |
| "Consequence for the existing chain: `fleetLogisticsQueue1` becomes (or is replaced by) the shared trunk, and `fleetLogisticsQueue2/3` are the natural candidates to become per-facility branches. **That still has to honour points a player has ALREADY spent on 2 and 3 without silently losing them.**" | ⚠️ **This design DECLINES the "2 and 3 become per-facility branches" option, and the reason is exactly the constraint the user attached to it.** Nodes 2 and 3 currently grant +1 at EVERY facility. Re-scoping either one to a single facility TAKES DEPTH AWAY from every player who bought it, at four other facilities, which is the silent loss the user forbade in the same sentence. The design keeps all three existing nodes globally scoped and adds the per-facility branches as NEW nodes beyond them. Nothing a player has bought changes meaning, nothing is refunded, and there is no talent migration at all. Full argument and the rejected alternative in 8.3. Open question 10. |
| "Respec already handles the downgrade path safely ... dropping depth below the number of queued entries lets the over-cap entries DRAIN rather than truncating them. **Verify that still holds per facility.**" | Verified in the code (`CraftQueueView.overDepth` at `craftQueue.ts:190` and the enqueue header's drain rule) and required as a per-facility test in 8.5. The drain logic already counts `queuedForFacility`, so it is per facility already; the test proves it rather than assuming it. |
| "**This REFINES the LOCKED section 15 pattern rather than contradicting it.** ... Lanes and depth stay independent axes, and the no-depth-per-lane rule is untouched." | Section 14 restates the LOCKED 0.13.3 section 15a rules verbatim in force, and 8.6 confirms this feature touches neither: depth is still never per lane, never multiplied by the lane count, and still bought with talents while lanes are bought with facility upgrades. |

### 1.5 Everything in this document that is MINE, not theirs

Each of these is a **CLAUDE INFERENCE**. They are repeated in section 13 so the user can accept or overrule each one without reading the whole document.

| # | The inference | Where |
|---|---|---|
| I1 | No new `docking` MissionPhase; the wait is a hold at the existing `transitBack` / `unloading` boundary. This is the one place the design does not follow the user's literal wording. | 5.2 |
| I2 | `TRANSIT_BERTH_BASE = 2`, with a 4-rung track to 6. Every number is mine, and it deliberately DIFFERS from the base 4 in the user's own example because the real fleet cap is 5, not 10. | 5.3 |
| I3 | Transit berths gate EXTRACTION returns only, not patrol returns. | 5.4 |
| I4 | No paid "unload by shuttle" bypass. The bounded wait is the valve; the reachable fix is the upgrade track. | 5.5 |
| I5 | A continuous craft order takes exactly one lane and is never joined by a second. | 7.3.3 |
| I6 | The Salvage Bay keeps its existing one-unit-per-tick promotion bound this release. | 7.8 |
| I7 | The patrol record shares `completionLog` rather than getting its own array, and `CaptainStopReason` is derived from `PatrolEndReason` rather than widened. | 6.4, 6.5 |
| I8 | Five per-facility talent nodes fanned off `fleetLogisticsQueue3`, with `fuelDepot` excluded in the TYPE. | 8.4 |
| I9 | Two migrations (42 -> 43 and 43 -> 44) rather than one, so the lane phase can peel without shipping a dead field. | 10 |

---

## 2. Scope

**In:**

1. **Transit berths**: a second, independent docking capacity that a returning extraction ship must claim to unload, with a deterministic wait queue, a bounded wait, a new rung track, and the visible status / position / ETA the user made a requirement.
2. **Patrol termination reasons**: an exhaustive `PatrolEndReason` union, recorded per run with the routes completed on that run, surfaced in the existing completion log.
3. **The lane allocation model**: `remaining` moves from the lane to a new order record; a free lane takes an unstarted queued order first and otherwise joins a running order.
4. **Per-facility queue depth**: `queueDepth(state, facility)`, the existing chain kept as the shared trunk, five new per-facility branch nodes.

**Out (explicit non-goals, each with a reason and a target):**

- **The Ops / Logistics presentation tidy.** Moved to 0.13.5 by the user's own decision ("left anything else to this patch", meaning the UI release). Not deferred by this design; already decided.
- **The Starbase** (retiring Docks as a facility, the "Docking Bay" rename, folding capacity into a Starbase track). Not one of the four locked items. Target: its own release, which will re-home both berth types at once. See 1.1 and 5.8.
- **Prospecting-specific turnaround slots.** ON ICE by the user's explicit instruction.
- **A new `docking` MissionPhase.** See I1 / 5.2.
- **Lifting the Salvage Bay's one-unit-per-tick promotion bound.** See I6 / 7.8. Quantified cost, named target.
- **Repeatable talent ranks** (a rank system on `unlockedHomeworldTalents`). See I8 / 8.4. Not needed for the decided shape; later per-facility rungs need no engine change.
- **The construction-berth / repair-berth split and raising `BUILD_CONCURRENCY_CAP`.** Separate logged work (SHIPYARD BERTHS, item 3, "STILL OPEN"). It is what makes the lane model matter at the Shipyard; today it does not. See 7.8.
- **A fuel queue.** Permanently excluded, user decision 2026-09-06, recorded in the code.
- **Any crafting balance change.** The 0.13.3 XP weights and curve are untouched.

**Why the visibility surfaces are IN despite "no UI work":** the user attached them to the docking feature as "Requirements, not suggestions". A feature whose only player-facing signal is "my missions got slower" is the failure mode they named. The boundary this design holds: **new readouts that explain new behaviour are in; re-tuning existing screens is out.** No type scale, no icon work, no layout change, no tooltip work.

## 3. Locked decisions

| # | Area | Decision |
|---|---|---|
| 1 | Scope | All FOUR items, no presentation pass. Lane model is a peelable phase. |
| 2 | Berths | Two independent capacities. `shipStorageCapacity` (Drydock) is untouched; transit berths are a NEW number on a NEW rung track. They never add, never multiply, never share a pool. |
| 3 | Berth safety | The softlock guarantee is **structural**: occupancy is time-bounded and derived-never-stored, and the berth count has a floor that cannot be reduced. Delay, never stranding, with a computable ceiling. |
| 4 | Patrol reasons | An exhaustive union over every ending, one record per RUN (not per route, not per call), surfaced in the existing completion log. |
| 5 | Lane model | Orders own `remaining`; lanes are interchangeable capacity. Unstarted orders have precedence over joining, which `economyTick`'s existing tail-pass order already delivers. |
| 6 | Lane model gate | A single-lane facility must be **byte-identical** to today. That is what keeps the 101 baseline meaningful. |
| 7 | Queue depth | Per facility, additive, never multiplicative, never per lane. The existing chain is the shared trunk with no re-scoping and therefore no migration. |
| 8 | Tick discipline | Every new decision is a pure function of state at that tick; every new pass lives at an existing `economyTick` seam with exactly one call site; no ambient clock, no new rng in the tick. |

## 4. Code grounding (what exists, verified on this branch tip)

Line numbers drift. Re-locate by content before editing.

**The tick seam, and why it is already the right shape for all four features.** `economyTick` (`tick.ts:3011`) runs, in order: the captain map (missions and patrols), then `resolveProcesses` (`:3531`), then at its tail and exactly once per call `promoteQueuedOrders` (`:3551`), `processRefineLines` (`:3567`), `processFabricateLines` (`:3577`), `processFuelPipelines` (`:3590`), `processShipRepairs` (`:3602`). `tick()` steps an offline span as `economyTick(next, 1, rng, stepEndsAtMs)` per whole tick (`:3731` to `:3737`) plus one trailing fractional call (`:3767`). **Offline and live both step one whole tick at a time through the same function**, which is the entire offline-equals-live argument and is why every new pass must live here and nowhere else.

**`promoteQueuedOrders` (`tick.ts:8180`)** has exactly ONE call site, inside `economyTick`'s tail, and its header states four properties as load-bearing: offline equals live by construction (one call site, one cadence); **promotion draws no RNG**; iteration order is declared via the `QUEUE_FACILITY_ORDER` literal tuple (`:7628`), never `Object.keys`; and skip-on-block with the array never reordered. It walks facilities, checks `adapter.hasFreeSlot`, snapshots that facility's waiting entries, re-checks free slots per promotion, releases the order's own reservation via `withQueuedOrderReleased` (`:7968`), gates through `adapter.canStart`, and starts from the same state it gated.

**The craft line engine.** `CraftLine` (`allocation.ts:110`) is `{ id, kind, recipeKey, remaining, mode }`, and `remaining` is documented as "iterations NOT YET STARTED (inputs still reserved)" and as "the ONLY field allocation math reads besides the recipe". `stepCraftLine` (`tick.ts:6574`) enforces one in-flight job per line by matching `p.lineId === line.id`, removes a batch line at `remaining <= 0`, stalls on a material cap (equipment exempt), otherwise calls `startProcess` and decrements `remaining` and `mode.remaining` in ONE construction. `runCraftLines` (`:6647`) walks the array in order threading state, so an earlier lane's deduct is visible to a later lane's gate. `processRefineLines` / `processFabricateLines` (`:6663`, `:6676`) are same-reference no-ops when their array is empty.

**Allocation.** `allocatedItem(lines, queued, itemId)` (`allocation.ts:258`) sums `line.remaining x inputsPerIteration(line)` over running lines PLUS `queuedOrderInputs(order)` over queued orders. `freeItemForState` (`:336`) is the single seam every material spender in the engine gates on. `queuedOrderInputs` (`:205`) is written as an **exhaustive switch** over `QueuedOrder`'s four arms specifically so a new arm carrying materials is a compile error rather than a silent under-reservation. `queued` is a REQUIRED parameter, deliberately, so an unconverted call site is a compile error.

**Queue state.** `QueueFacilityKey` (`model.ts:3267`) is six members: refinery, fabricator, salvageBay, researchLab, shipyard, fuelDepot. `QueuedOrder` (`:3347`) is four arms: craftLine, salvage (with a batch-only `mode`), research, shipBuild. `QueuedJob` (`:3363`) is `{ id, facility, order }` and carries **no Decimal**, deliberately, so it rides `hydrateDecimals`'s spread untouched. `QUEUE_ADAPTERS` (`tick.ts:7532`) is an exhaustive `Record<QueueFacilityKey, QueueAdapter>` where every member is a one-line delegation and zero gate logic lives in the table.

**Depth.** `QUEUE_DEPTH_BASE = 1` (`tick.ts:563`). `queueDepth(state)` (`:592`) reduces `{ type: "queueDepth"; depth }` payloads over learned talents onto that base, and its header states the two rules it encodes: depth is PER FACILITY (the number applies to each key independently) and the ACTIVE job does not consume a queue slot. `HOMEWORLD_TALENTS` holds `fleetLogisticsQueue1/2/3` (`model.ts:7291`, `:7304`, `:7316`), costs 3 / 5 / 8 adminPoints, FA walls none / 5 / 25, each granting `{ type: "queueDepth", depth: QUEUE_DEPTH_PER_NODE }`. Talents are stored BY KEY (`unlockedHomeworldTalents: HomeworldTalentKey[]`), which is why the `recipeBonusOutput` retirement and the `industryBonusOutput` re-wire both needed no migration.

**Lane counts.** `refineSlotCount` (`tick.ts:5239`) and `fabricateSlotCount` (`:5372`) sum from zero over reached rungs; `researchSlotCount` (`:5350`) likewise; `shipyardBayCount` (`:5429`) and `salvageSlotCount` (base `SALVAGE_BAY_BASE_SLOTS = 1`, `:5506`) and `fuelPipelineCount` are **floor plus rungs**. `shipBuildSlotCount` (`:5470`) is `min(BUILD_CONCURRENCY_CAP, bays - 1)` with `BUILD_CONCURRENCY_CAP` held at 1 by owner directive, so it is 1 today and the `- 1` is the repair reservation.

**`processShipRepairs` (`tick.ts:5823`)** is the in-repo precedent for a shared, contended, time-bounded resource: bays are one shared pool, repairs claim any free bay, excess damaged hulls wait in `state.ships` array order (monotonic id insertion order) which is "a deterministic implicit repair queue, and that determinism is what keeps offline == live". Its header spells out the soft-lock invariant as (a) a base floor of at least 2 bays, (b) builds capped at `bays - 1`, (c) repairs claiming any free bay. Note its `break` versus `continue` comment at `:5878`: the queue-jump policy is deliberately left undecided until repairs gain a cost, and this design does not touch it.

**`processFuelPipelines` (`tick.ts:8548`)** is always-on and fully automatic: every tick it fills every free pipeline from the one fuel recipe while the tank has room and ice exists. There is no order object and no player configuration, which is why the `fuelDepot` queue adapter is a stub and why it stays one even under multi-type fuel.

**Missions.** `MissionPhase` (`model.ts:218`) is five members; `MISSION_PHASE_ORDER` (`tick.ts:323`) mirrors it and carries a warning that a phase added without a matching `requiredTicksForPhase` entry would silently break. `requiredTicksForPhase("unloading", def)` returns `def.unloadTicks` (`model.ts:1727`), which is 8 on every current mission. The phase advance is at `tick.ts:1887`: when `phaseProgressTicks >= requiredTicks`, take the next phase, and at the end of `unloading` deposit cargo and complete the cycle. `FUEL_CYCLE_PHASES` (`tick.ts:8632`) sums the same per-phase lengths for the fuel-runway projection.

**Budget threading, the precedent F1 copies exactly.** `economyTick`'s captain map (`tick.ts:3100` onward) threads `fuelBudgetRemaining` and `creditsBudgetRemaining` as locals drawn down sequentially, with the comment "map callbacks run sequentially, so the decrement is visible to the next captain", so two captains cannot double-spend one tank. Captain iteration is `state.captains.map`, i.e. array order.

**Patrols.** `tickCaptainPatrol` (`tick.ts:2330`) returns a `PatrolTickResult` (`:2278`) in which `mission` is null when the patrol ENDED this call. It sets `stopReason` at exactly two places: `"defeat"` when the limp-home countdown reaches 0 (`:2477` region) and `"fuel"` when a repeat-dispatch relaunch is unaffordable (`:2683` region). `routesCompleted` (`:2441`) counts full routes WON this call and feeds `lifetimeStats.missionsCompleted[patrolKey]`. A Dispatch-Once completion and a recalled-patrol completion both exit through ONE `else` at `:2693` with no reason at all.

**The completion log.** `CompletionLogEntry` (`model.ts:3500`) is keyed `kind: TimedProcessKind` and its header states the LOCKED rule "**PER ORDER, NOT PER ITERATION**" (user 2026-09-02). `OpenJobBatch` (`:3545`) is the cross-tick accumulator that makes that rule work, and it is keyed by **`lineId`**. `COMPLETION_LOG_CAP = 50` with oldest-first eviction. `atMs` is documented as an INJECTED wall clock, never read inside the tick, precisely so offline stamps match live. Three exhaustive `Record<TimedProcessKind, ...>` tables exist: `PROCESS_XP_AWARDS` (`tick.ts:905`), `PROCESS_COMPLETION_LOG` (`:992`), and `COMPLETION_KIND_VIEW` (`homeDashboard.ts:916`). `buildRecentlyCompleted` (`homeDashboard.ts:1067`) renders ONLY `state.completionLog`, so **a patrol return is genuinely absent from Home's "Recently completed"**, which is exactly what D6 reports.

**Docks.** There is no `FACILITIES.docks`. Docks capacity is a bespoke track: `SHIP_DOCKS_BASE = 8` (`model.ts:6248`), `SHIP_DOCKS_RUNGS` (`:6265`, 8 generated rungs to a cap of 16), `canUpgradeDocks` (`tick.ts:5134`), `startDocksExpansion` (`:5191`) pushing a `docksExpansion` TimedProcess whose `docksCapacityUp` effect bumps `shipStorageCapacity` by 1 (`:9460`). The rung INDEX is derived from the field itself (`shipStorageCapacity - SHIP_DOCKS_BASE`) so no second level field can drift.

## 5. F1: Transit berths

### 5.1 Player-facing behaviour

A returning extraction ship needs a **free transit berth** to dock and unload. The Docks console gains a second capacity line beside the existing berth count, and a second upgrade track that buys more of them.

In practice:

- Fewer ships returning at once than there are transit berths: **nothing changes at all**. This is the normal case for a small fleet and it is why the base value matters (5.3).
- More ships arriving than there are free berths: the extras hold at the end of their return leg with the named status **"Waiting for a transit berth (3rd in line)"**, carrying a position and an ETA. They claim a berth the instant one frees, in a deterministic order.
- A ship that has a berth reads **"Docked, unloading"** for the existing `unloadTicks`, then completes its cycle exactly as today and releases the berth.

The queue order is `state.captains` array order, which is monotonic captain id insertion order. That is the same determinism `processShipRepairs` uses for damaged hulls, and it is what keeps offline equal to live.

### 5.2 CLAUDE INFERENCE I1: no new MissionPhase

The user described the feature as "adding transit, docking and unloading phases". This design does not add a phase, and here is the full reasoning so the user can overrule it on a complete picture:

1. **The phase they describe already exists.** `unloading` is a real `MissionPhase` with `unloadTicks: 8` on every mission. "Docked and unloading" is what it already means. A new `docking` phase would be a second name for the first two ticks of it.
2. **Adding a phase changes every mission's length.** `MISSION_PHASE_ORDER` and `requiredTicksForPhase` drive cycle timing, so a new phase lengthens every cycle for every existing save, whether or not a berth is ever contended. That is a balance change smuggled in as a structural one.
3. **It would silently move a LOCKED projection.** `FUEL_CYCLE_PHASES` sums the same per-phase lengths to derive a mission's fuel cost per cycle for the fuel-runway readout, which is LOCKED as measured EMA plus a pure two-phase projection. A new phase must be added there in the same edit or the runway starts lying. That is a real trap, not a theoretical one.
4. **The wait is not a phase anyway.** A phase has a duration. Waiting for a berth has an unknown duration that depends on other captains. Modelling it as a phase would mean a phase whose `requiredTicksForPhase` cannot be answered, which is the one thing that function must always be able to answer.
5. **The player experience survives intact.** Two distinct named statuses ("Waiting for a transit berth, 3rd in line" then "Docked, unloading") are rendered across one phase boundary. The user asked for a visible status, a position and an ETA; all three are delivered.

**The mechanism instead: a HOLD at the boundary.** The advance from `transitBack` to `unloading` (`tick.ts:1887`) becomes conditional on a free berth. When it is refused, `phaseProgressTicks` banks at exactly `requiredTicks`, the phase stays `transitBack`, and the `while` loop **breaks** so no budget is burned spinning. Next call retries. This is `stepCraftLine`'s proven posture verbatim: "a blocked line simply survives unchanged and retries next tick."

**Waiting is therefore fully DERIVED, with no new state field:** a captain is waiting for a berth exactly when `mission.kind === "extraction" && mission.phase === "transitBack" && mission.phaseProgressTicks >= requiredTicksForPhase("transitBack", effectiveDef)`. Nothing is stored, so nothing can go stale, and there is no migration for this half.

The `break` is also why the hold is parity-safe inside a single call: a berth can only free through ANOTHER captain's progress, which a single `tickCaptainMission` call cannot observe, so no amount of remaining budget in this call could change the answer. One big call and many small calls therefore agree. This must be a test, not just a paragraph (9.1).

### 5.3 Data model

**One new saved number, one new derived helper, one new rung track, one new process kind.** The shape deliberately mirrors the existing Docks track, which is the closest thing in the repo and which the Starbase work will later re-home alongside it.

```ts
// model.ts
export const TRANSIT_BERTH_BASE = 2;              // CLAUDE INFERENCE I2, see below for why 2 and not 4
export interface TransitBerthRung {               // shape mirrors ShipDocksRung exactly
  credits: Decimal;
  materials: Record<string, Decimal>;
  durationTicks: number;
}
export const TRANSIT_BERTH_RUNGS: TransitBerthRung[] = buildTransitBerthRungs(); // 4 rungs, base 2 -> 6; see 5.3 for why 2, not 4

// GameState gains exactly ONE field:
//   transitBerthCapacity: number;   // total transit berths; rung index = value - TRANSIT_BERTH_BASE

// TimedProcessKind gains "transitBerthExpansion"
// ProcessEffect gains { type: "transitBerthCapacityUp" }
```

Adding `"transitBerthExpansion"` to `TimedProcessKind` (`model.ts:2139`) is a **compile error in three exhaustive `Record`s** until each is given a row, which is the point: `PROCESS_XP_AWARDS`, `PROCESS_COMPLETION_LOG`, and `COMPLETION_KIND_VIEW`. Recommended rows, copied from `docksExpansion` because it is the same kind of purchase:

| Table | Row |
|---|---|
| `PROCESS_XP_AWARDS` | `transitBerthExpansion: { fleetAdmin: true, crafting: false }` |
| `PROCESS_COMPLETION_LOG` | `transitBerthExpansion: { logged: true, batched: false, reward: "level" }` |
| `COMPLETION_KIND_VIEW` | a verb, an icon, and a jump target pointing at the Docks console |

`transitBerthCapacity` is a plain number, so `hydrateDecimals` needs no branch. The rung's `credits` and `materials` live in the STATIC table as Decimals exactly as `SHIP_DOCKS_RUNGS` does, never in the save.

**New pure leaf `src/lib/game/berths.ts`**, importing only `model.ts` (the same posture and direction as `reservation.ts`), so `tick.ts` and the UI read one source and cannot disagree:

```ts
export function transitBerthCount(state: GameState): number;          // floor plus reached rungs
export function transitBerthsOccupied(state: GameState): number;      // captains in the unloading phase
export function transitBerthsFree(state: GameState): number;          // max(0, count - occupied)
export function captainsAwaitingBerth(state: GameState): number[];    // captain ids, in state.captains order
export function berthQueuePosition(state: GameState, captainId: number): number | null;  // 1-based
export function berthEtaTicks(state: GameState, captainId: number): number | null;       // DISPLAY ONLY
```

`transitBerthCount` is **floor plus rungs, never sum from zero**, for exactly the reason `SALVAGE_BAY_BASE_SLOTS`' comment gives: a sum from zero gives every existing save zero, and every existing save is at the base. A defensive read of a missing field falls through to `TRANSIT_BERTH_BASE`, never to 0. See 5.5 hazard H1.

`transitBerthsOccupied` is **derived from `phase === "unloading"` and never stored**. There is deliberately no `berthId` field on a mission and no occupancy array in the save. See 5.5 hazard H3: this is the property that makes the softlock structurally impossible rather than merely unlikely.

**Engine wiring.** `economyTick` computes `let transitBerthsRemaining = transitBerthsFree(state)` before the captain map and threads it through exactly as `fuelBudgetRemaining` is threaded (`tick.ts:3078`): `tickCaptainMission` takes it as a parameter, reports `berthsClaimed` on its result, and the map draws it down so a later captain sees the reduced value. **`tickCaptainMission` must not read GameState for this.** It is pure over its inputs today and must stay so; the berth count is a budget, not a lookup.

**CLAUDE INFERENCE I2, the numbers. ⚠️ READ THE FLEET-CAP FINDING FIRST, because it changes the obvious answer.**

The user's worked example is "4 slots and 10 ships". **The real fleet cap today is 5, not 10.** `MAX_UNLOCKABLE_CAPTAINS` (`model.ts:7442`) is `1 + the count of unlockCaptainSlot talent nodes`, and there are exactly **4** such nodes, so the cap is **5 captains**. That was verified by counting the nodes, not recalled.

**Consequence, and it is the whole balance decision:** at a base of 4 with a cap of 5, **at most ONE ship can ever wait, for at most 8 ticks.** The feature would be very nearly inert on ship day, which is not what "another upgrade track, more to do" asks for. The user's 10 is a forward-looking hypothetical, and sizing the base against it would ship a dead constraint.

**Recommendation: `TRANSIT_BERTH_BASE = 2`, with a 4-rung track reaching 6.** Rung costs mirror `SHIP_DOCKS_RUNGS`' generated-formula style (linear credits escalation, a structural component cost, escalating duration) so there are no hand-tuned magic numbers to drift. Reasoning:

- **It bites, measurably.** With a full 5-captain fleet all returning at once, up to 3 ships queue and the worst case wait is `ceil(5 / 2) x 8 = 24 ticks`. That is a real, visible, explicable logistics constraint rather than a rounding error.
- **It does not touch the early game.** A fleet of 1 or 2 captains never waits, so a new player meets the system only after they have grown into it.
- **It is fully buyable away.** The ceiling of 6 exceeds the cap of 5, which is the "reachable fix" the user required.
- **It tightens on its own as the fleet cap grows.** `MAX_UNLOCKABLE_CAPTAINS` is derived by COUNTING nodes, so adding a captain-slot node later raises the cap and the constraint gets more interesting with no retune here. If the cap ever reaches the user's hypothetical 10, the base-2 worst case becomes `ceil(10 / 2) x 8 = 40 ticks` and the track should grow with it.
- ⚠️ **The base is also a PARITY constraint, not only a balance one.** `TRANSIT_BERTH_BASE` must be greater than or equal to the largest number of simultaneously returning extraction ships in any existing parity fixture, or those fixtures change behaviour and the 101 baseline moves. **Verified: the mission fixtures in `tick.test.ts` use at most two mission captains at once (`captains[0]` and `captains[1]`), so a base of 2 sits exactly on the boundary and no fixture holds.** That is safe but TIGHT: if any fixture anywhere runs three concurrent returns, it will move. So Phase 3's very first gate run is the check, and a moved fixture is a signal to inspect it, never a reason to re-baseline. If one is found, raise the base to 3 rather than editing the fixture. See 9.1.

### 5.4 CLAUDE INFERENCE I3: extraction only, not patrols

Transit berths gate the `transitBack` to `unloading` advance, which exists **only on the extraction arm**. A patrol's route is `transitOutTicks + rollWindowTicks + transitBackTicks` with no unloading phase at all, and its rewards are applied per won wave inside `tickCaptainPatrol` rather than delivered as cargo on arrival. There is nothing to unload, so there is nothing for a berth to gate.

The user's wording was "a ship returning from a mission", and a patrol is a mission. So this is an inference. Gating patrols would mean inventing an unload step for a mission type that has no cargo, purely to apply a constraint, which is friction with no logistics behind it. Open question 4.

### 5.5 THE ESCAPE VALVE (designed here, not at build time)

The user named the precedent: "0.11.1 shipped as an EMERGENCY fix because docks filled up with no in-game way to remove a ship, so acquiring one more bricked the save. 'You cannot unload without a free turnaround slot' has exactly that shape."

**First, the honest evaluation of the `shipBuildSlotCount` pattern the user pointed at.** That pattern works by capping a COMPETING consumer: builds may take at most `bays - 1`, so a repair can never find every bay taken by a build. It has two consumers with different priorities. **Transit berths have exactly one consumer** (returning ships), so there is no competitor to cap and the mechanism does not transfer. Adopting it literally would mean reserving a berth from returning ships for the benefit of returning ships, which is a no-op.

**What transfers is the pattern's principle, and it is the more important half:** the guarantee must be **structural**, provable from the shape of the state, and written down in the code as an invariant with a test behind it. Not a runtime rescue, not a periodic sweep, not a hope. `shipyardBayCount`'s header does exactly this with its "(a)+(b)+(c) proof". This design supplies the equivalent proof for a single-consumer resource.

**The structural guarantee, stated as the proof.**

> **(a) Berth count has a floor that nothing can lower.** `transitBerthCount` is `TRANSIT_BERTH_BASE` plus reached rungs, and every rung term only ever ADDS. A missing or malformed field reads as the base. So the count is always at least `TRANSIT_BERTH_BASE`, at every level, including a hand-edited or half-migrated save.
>
> **(b) Occupancy is TIME-bounded, never resource-bounded.** A berth is occupied exactly while a captain is in the `unloading` phase. `requiredTicksForPhase("unloading", def)` returns `def.unloadTicks`, and the `unloading` phase advance is gated on **nothing at all**: no material, no credit, no cap, no slot. Verified by reading the advance at `tick.ts:1887` and the cycle completion at the end of it: the cargo is accumulated into `homePlanetDelta` and the cycle completes unconditionally, with the cap clamp applied later when `economyTick` folds that delta into inventory (the clamp discards overflow, it never stalls the phase). So **every occupant provably clears within `unloadTicks` ticks**, unconditionally.
>
> **(c) Occupancy is DERIVED, never stored.** There is no berth-assignment field anywhere. Occupancy is recomputed from `phase === "unloading"` on every read. So there is no bookkeeping value that can leak, no orphaned reservation, and no state a crash or a migration can leave behind. This is the same derive-never-store argument `allocatedItem` and `reservation.ts` rest on.
>
> **Therefore:** the worst case is not a lock, it is a delay, and the delay has a computable ceiling of `ceil(concurrentReturns / berths) x unloadTicks`. Both terms are bounded: returns are bounded by `MAX_UNLOCKABLE_CAPTAINS` (**5 today**, derived by counting the 4 `unlockCaptainSlot` nodes) and berths by (a). At the recommended base of 2 with a full 5-captain fleet all returning on the same tick, that ceiling is `ceil(5 / 2) x 8 = 24 ticks`, i.e. **24 seconds on a mission cycle hundreds of ticks long**, and it shrinks to zero as the player buys the track out.

**This is what makes the shape DIFFERENT from 0.11.1 despite looking identical.** In 0.11.1, docks occupancy was by a PARKED ship, which had no clearing mechanism in the game at all: the resource was consumed indefinitely with no exit. Here occupancy is a phase that always ends. The superficial similarity is real and is why the analysis was demanded; the structural difference is what resolves it. Both halves must be written into the code comment, because a comment that only asserts safety gets deleted by the next person who breaks it.

**The three hazards that proof depends on, and how each is closed.**

| # | Hazard | Closure | Test |
|---|---|---|---|
| H1 | The berth count reaches 0 (a sum-from-zero derivation, a missing facility key, a retuned rung) and every returning ship waits forever. | Floor plus rungs, additive-only terms, defensive fall-through to the base. | A never-fewer-berths proof asserting `transitBerthCount(state) >= TRANSIT_BERTH_BASE` at every reachable capacity value, mirroring `ship-repair.test.ts`'s never-fewer-bays proof. |
| H2 | An occupant cannot clear because unloading stalls (a full warehouse, a missing item key). | Verified NOT possible: the `unloading` advance is ungated and the cargo deposit clamps and discards rather than stalling. The at-cap mechanism is a separate RECALL (`lastStopReason: "cargo"`, `tick.ts:3253`) that happens mid-cycle and flies the ship home, and a recalled ship still unloads and still releases its berth. | A test that fills every relevant cap and asserts the unloading captain still completes and still releases. |
| H3 | Stored occupancy leaks: a captain's berth claim survives the captain becoming idle, and the berth is gone forever. | Impossible by construction: nothing is stored. A stored `berthId` is explicitly refused, and the refusal is written into `berths.ts`'s header so a future "optimisation" cannot quietly add one. | A test that asserts a captain ending mid-unload (recall, idle, key retirement) leaves `transitBerthsOccupied` reduced. |

**CLAUDE INFERENCE I4: no paid bypass.** The user offered "a slot a player action can always free" and "an overflow path that unloads slowly rather than not at all" as candidates. This design ships neither, and the reasoning is the standing peace value rather than effort:

- The bound in (b) plus (c) means there is no lock to escape from. An escape valve for a 24-second delay is relief from a problem the game manufactured, and **selling relief from manufactured friction is the exact anti-pattern "never build in stress, friction or punishment" forbids.** Pricing it in credits makes it worse, not better. Pricing it in forfeited cargo is a punishment outright.
- A free bypass would make the constraint cosmetic, which removes the feature.
- An "unload slowly" overflow path needs a hold-duration counter, which needs a stored field, which reintroduces exactly the stored-state leak H3 exists to prevent.
- The user's own final clause in that requirement is "the fix must be reachable and affordable", and **the fix is the upgrade track**: a visible rung, an affordable cost, a permanent removal of the constraint. That is the agency they asked for.

Open question 3. If the user wants a bypass, the cheapest safe version is a free, always-available "unload by tender" action available only while held, which caps the wait at the player's patience rather than at the arithmetic. It should be their call, not mine.

### 5.6 Visibility and agency (the four requirements, answered)

| Requirement (user's words) | How it is met |
|---|---|
| "a NAMED, VISIBLE status" | `"Waiting for a transit berth"`, as a distinct status from `"Docked, unloading"`. Derived in `berths.ts`, rendered wherever a captain's mission phase is already rendered (the Ops captain cards and Home's IN PROGRESS rows, both of which already read `MISSION_PHASE_LABEL` from `model.ts`). No new screen. |
| "carrying queue position and ETA" | `berthQueuePosition` gives the 1-based position within `captainsAwaitingBerth`, which IS the engine's own order, so the number cannot lie. `berthEtaTicks` walks the occupied berths' remaining unload countdowns ascending and adds a full `unloadTicks` per extra round beyond the berth count. **DISPLAY ONLY, never read by the tick**, and rendered through the existing `remainingReadout` helpers with `showTickCounts` and `state.tickDurationSeconds` so this release does not mint a second time format (preservation inventory items 0.1 and 0.2). |
| "the cause must be legible at a glance" | The status names the resource, and the Docks console shows `Transit berths: N in use / M` beside the existing drydock line, so "why is my ship waiting" and "what do I buy" are the same glance. The Home IN PROGRESS row carries the position. |
| "the fix must be reachable and affordable" | The `TRANSIT_BERTH_RUNGS` track, on the console that already owns the docking capability, using the existing shared `facilityUpgradeButton` disabled-reason machinery. First rung priced in the same ballpark as the first docks rung. |

### 5.7 Migration

`transitBerthCapacity: TRANSIT_BERTH_BASE` seeded additively. **SAVE_VERSION 42 -> 43.** Nothing else. Because waiting is derived and occupancy is derived, a save that is mid-cycle with several ships in `unloading` loads into a consistent state automatically: they are the occupants, and if there are more of them than the base allows (not reachable in normal play, but possible in principle on a hand-edited save), `transitBerthsFree` clamps at 0 and the excess simply finish their unload before anyone else docks. **Nothing is stranded and nothing is truncated**, which is the same over-cap DRAIN posture the queue already uses for a respec.

### 5.8 Failure modes, named up front

1. **The live-save slowdown.** If `TRANSIT_BERTH_BASE` is set too low, every existing player's missions get slower on update day with no explanation. Mitigation: the base recommended in 5.3 plus its parity-fixture constraint, plus patch-note copy that names the new system rather than letting it be discovered as lag.
2. **The invisible wait.** If the status is not threaded into every surface that renders a mission phase, a ship sits in `transitBack` looking normal but never advancing, which reads as a bug. Mitigation: enumerate the phase-rendering sites (Home `ActivityRow`, the Ops captain cards) and treat "all of them, or none" as a definition of done. This is the "sweep for the shape" lesson 0.13.3 paid for twice.
3. **The Starbase re-home.** Building on Docks means the Starbase work later moves two capacities, two rung tracks and two TimedProcessKinds instead of one, including an in-flight `transitBerthExpansion` hazard alongside the already-flagged in-flight `docksExpansion` hazard. Accepted; the cost is a second instance of a migration already designed for. Stated here so it is not a surprise to whoever builds the Starbase.
4. **Contention with the at-cap recall.** A recalled-for-cargo ship and a normally-returning ship compete for the same berths. Verified harmless (both unload and both release), but it must be a test rather than an assumption, because `lastStopReason: "cargo"` flags a recall mid-cycle and the interaction is not obvious.
5. **The trailing fractional call.** `tick()`'s sub-tick trailing `economyTick` fires the tail passes one extra time. The berth check sits in the captain map, not the tail, and fires only at a whole-phase boundary reached through the existing epsilon snap, so it inherits no new artifact. Must be asserted, not assumed.

## 6. F2: Patrol termination reasons

### 6.1 What exists (verified, and it is not nothing)

- `CaptainStopReason = "fuel" | "cargo" | "defeat"` (`model.ts:2043`), documented in-code as "a TRANSIENT display hint ... read by the offline summary + recap modal. It is NOT set on a clean completion or a user recall."
- `tickCaptainPatrol` stamps it at two places only: `"defeat"` at the limp-home completion, `"fuel"` at the truly-broke relaunch refusal.
- `offlineSummary.ts:75` carries it onto `OfflineCaptainProgress.stopReason`; `App.svelte:1684`'s `offlineStopReasonNote` turns it into a sentence. **That is the only surface it reaches, and only during an offline recap.**
- `routesCompleted` (`tick.ts:2441`) already counts the routes won THIS CALL and folds into `lifetimeStats.missionsCompleted[patrolKey]`. The count the user wants already exists; it is just per call and aggregate-only.
- `completionLog` is written only by `resolveProcesses` for `TimedProcessKind` values. Missions are not TimedProcesses. **So a patrol return is genuinely absent from Home's "Recently completed", exactly as D6 reports.**

So the work is: complete the enumeration, accumulate the count per RUN, and put the record where the player looks.

### 6.2 `PatrolEndReason`, enumerated exhaustively

Read out of `tickCaptainPatrol` and `economyTick`'s captain map. Every path that can set `mission = null` for a patrol:

```ts
// model.ts
export type PatrolEndReason =
  | "defeat"            // the limp-home countdown reached 0; the hull arrives damaged
  | "outOfFuel"         // a repeat-dispatch relaunch was unaffordable even after the credits auto-buy
  | "ordersComplete"    // Dispatch Once finished its route
  | "recalled"          // the player recalled it, and it finished the route it was on
  | "missionKeyRetired";// the unknown-key inert guard dropped the captain to idle
```

Five members, and two notes that matter:

- **`ordersComplete` and `recalled` are indistinguishable in the code today.** Both exit through the single `else` at `tick.ts:2693` ("Dispatch Once, OR a recalled patrol that finished its route"). Splitting them is a one-line read of `mission.recalled` at that branch. The user's example reason list needs the distinction, and conflating them would print "reason for returning: orders complete" to a player who pressed Recall.
- **`missionKeyRetired` is a real ending with no reason at all today.** The unknown-key inert guard at `tick.ts:3113` drops the captain to idle when a mission or patrol key no longer exists in the registry. It is rare and self-healing, but it IS an ending, and leaving it out is precisely the blank reason the user asked to make impossible.

**One path that LOOKS like an ending and is not, named so nobody adds it:** the defensive no-op at `tick.ts:2374` when the assigned ship or its `combatHullTypeOf` is absent returns `noOp` with the captain and its mission UNCHANGED. The patrol does not end, it simply fails to advance. It must not get a reason, and `berths.ts`-style header prose should say so.

**The compile-error mechanism.** A TypeScript type cannot express "this field is non-null exactly when the mission ended", so the guarantee is assembled from three parts:

1. `PatrolTickResult` gains `endReason: PatrolEndReason | null`, with the invariant written on the field: non-null if and only if this call set `mission` to null.
2. **Every player-facing wording goes through one exhaustive `Record<PatrolEndReason, PatrolEndReasonView>`** in a pure module. Adding a union member without a row fails `npm run check`. This is the `PROCESS_XP_AWARDS` trick and it is the half that actually holds.
3. A test asserts the invariant in both directions across every reachable ending: a call that ends a patrol reports a reason, and a call that does not end one reports null.

### 6.3 The per-RUN route count (and the eviction hazard it closes)

The user's sentence is "Completed **X** combat patrol missions before returning". `routesCompleted` is per CALL, and a repeat-dispatch patrol relaunches without ending, so the count must accumulate across calls and across saves.

`PatrolMissionState` gains `routesCompletedThisRun: number`, incremented at each route completion and read out at the ending. Additive, plain number, `?? 0` tolerant of an in-flight pre-0.13.4 mission, so it rides the release's own 42 -> 43 bump with no separate work.

⚠️ **This is also the fix for a ring-buffer hazard that is easy to miss.** `COMPLETION_LOG_CAP` is 50 with oldest-first eviction, and `CompletionLogEntry`'s header states the LOCKED rule "PER ORDER, NOT PER ITERATION" precisely because "logging per iteration would let a single big batch evict every other entry and blow the 50-cap instantly, which would make the log actively worse than no log". A repeat-dispatch patrol completing dozens of routes across an offline span would do exactly that if each route wrote an entry. **One entry per patrol ENDING, carrying `iterations = routesCompletedThisRun`.** This is `OpenJobBatch`'s accumulator pattern applied to patrols, and it is the reason the field exists rather than a convenience.

`iterations` is reused deliberately: its documented meaning is "how many job iterations folded into this entry", and routes-in-a-run is the same fact. No new field.

### 6.4 CLAUDE INFERENCE I7a: the record shares `completionLog`

Two options were weighed.

- **(a) Widen `CompletionLogEntry.kind`** from `TimedProcessKind` to `CompletionLogKind = TimedProcessKind | "patrolRun"`, add optional `patrolEndReason?: PatrolEndReason`, and widen `COMPLETION_KIND_VIEW` to `Record<CompletionLogKind, ...>`.
- **(b) A parallel `missionLog: MissionLogEntry[]`** with its own cap, merged into one list by the view model.

**Recommend (a).** The user's complaint is that patrol returns are invisible **in the log**, meaning in that list. Two arrays rendered as one list is two eviction policies, two sort keys and two chances to drift, which is exactly the drift D5's ruling already told us to avoid by reusing the existing shaping rather than writing a second formatter.

**Important boundary so (a) does not spread.** `PROCESS_XP_AWARDS` and `PROCESS_COMPLETION_LOG` stay keyed by `TimedProcessKind`. They are about PROCESSES, they are consulted per process inside `resolveProcesses`, and widening them would add rows nothing reads. Only `COMPLETION_KIND_VIEW` widens, because it is the VIEW table and by definition must cover every renderable entry kind. That split is honest and it keeps the blast radius to one table.

The patrol entry's fields: `kind: "patrolRun"`, `subjectKey: patrolKey`, `iterations: routesCompletedThisRun`, `patrolEndReason`, `atMs` / `startedAtMs` from the injected clock, `items` / `pieces` / `creditsAmount` left as they already are for a non-material reward (patrol loot is folded per wave into inventory as it lands, and re-listing it here would double-report it).

### 6.5 CLAUDE INFERENCE I7b: `CaptainStopReason` is derived, not widened

`CaptainStopReason` stays exactly as it is: a three-member transient hint for the offline recap, with `"cargo"` remaining extraction-only. The offline recap's patrol note is then derived from `PatrolEndReason` through an exhaustive `Record<PatrolEndReason, CaptainStopReason | null>`, so there is ONE vocabulary for why a patrol ended and two surfaces reading it.

Widening `CaptainStopReason` instead would give the game two overlapping unions for the same fact, and the recap's existing wording would have to grow members it does not need (`"ordersComplete"` is not a wall-stop and must not raise a recap note). Open question 11.

### 6.6 Parity analysis for F2

**Does it touch the tick? YES.** Three things must be proven.

1. **The reason is set at the same deterministic branch on both paths.** This is the existing `stopReason` argument, which its own comment already makes: "Set at the SAME deterministic branch live and offline, and it touches no RNG draw / outcome / ordering." The new members join it under the same discipline. No draw, no ordering effect.
2. ⚠️ **`atMs` must come from the INJECTED clock, never `Date.now()`.** `economyTick` receives `nowMs` (`tick.ts:3020`) and currently passes it **only** to `resolveProcesses` (`:3531`). The patrol arm must be handed the same value, and `tick()`'s offline loop already computes a per-step `stepEndsAtMs` schedule (`:3737`), so offline stamps match live by construction. **A single `Date.now()` in the patrol arm makes `completionLog` differ offline versus live and breaks a deep-equal parity test.** This is the sharpest hazard in F2 and it is one line to get wrong.
3. **One entry per run, not per route.** Proven by 6.3 plus a test that advances a repeat-dispatch patrol across many routes offline and asserts exactly one entry with the correct `iterations`.

**Required new parity cases:** identical seeded states, one stepped N times and one advanced by `tick(N)`, with (i) a patrol defeated mid span, (ii) a patrol running out of relaunch fuel mid span, (iii) a repeat-dispatch patrol completing several routes then being recalled. All three must produce deep-equal `completionLog` arrays including `atMs`.

## 7. F3: The lane allocation model

### 7.1 The rule, restated as the spec

> A free lane takes the next **unstarted** queued order first. If no unstarted order is waiting, it **joins an order already running** and pulls one unit at a time from that order's remaining pool.

And the user's worked example, which is the acceptance test: three 1000-unit orders A, B, C at a two-lane facility; A and B start, C waits; A finishes, that lane starts C; B finishes, that lane starts C too; both lanes end up on C.

### 7.2 Where the two levels live, and why the precedence is already free

The two-level precedence maps onto `economyTick`'s existing tail order with no new ordering decision at all:

```
resolveProcesses          (:3531)  completions free up lanes
promoteQueuedOrders       (:3551)  LEVEL 1: an unstarted queued order takes a free lane
processRefineLines        (:3567)  LEVEL 2: a still-free lane JOINS a running order
processFabricateLines     (:3577)  same, for the Fabricator
```

**`promoteQueuedOrders` keeps exactly ONE call site and keeps its four stated properties.** The join is NOT added to it. Reasons:

- Promotion is about `processQueue`, i.e. orders that have not started. Joining is about assigning an idle lane to an order that has. Folding them would give one function two subjects and would break its documented early return on an empty queue, which is the same-reference no-op that keeps a queueless save untouched.
- The precedence the user wants is exactly "promotion first", and promotion already runs first. Putting the join in the line engine gets the rule for free rather than encoding it twice.

⚠️ **One sharp detail in `promoteQueuedOrders` that must be re-read, not assumed.** Its free-slot test is `adapter.hasFreeSlot(working)`, re-checked per promotion so a facility with N free lanes promotes at most N. Under lane-sharing, "free lane" must mean **a lane with no attached order**, and `hasFreeSlot` must be the single function that answers it for both levels. If the promotion pass and the line engine ever compute free-lane-ness differently, they will disagree about capacity on the same tick, which is the worst class of bug this engine can have. One function, delegated to from both, zero re-derivation, exactly the posture `QUEUE_ADAPTERS` already enforces.

### 7.3 The data model change

#### 7.3.1 Orders own `remaining`; lanes are capacity

```ts
// allocation.ts (the leaf that already owns CraftLine)
export interface CraftOrder {
  id: string;            // "ord-N", minted from state.nextCraftOrderId
  facility: QueueFacilityKey;
  kind: CraftLineKind;
  recipeKey: string;
  remaining: number;     // units NOT YET STARTED. THE allocation basis. Moved off CraftLine.
  mode: CraftLineMode;   // batch (fixed N) or continuous
}

export interface CraftLine {   // now purely THE LANE
  id: string;                  // "craft-N", unchanged; still the lineId startProcess stamps
  orderId: string;             // which order this lane is currently pulling from
}
```

`CraftLine` keeps its id and its identity on purpose. That id is stamped onto every in-flight job (`startProcess(..., line.id)`) and matched by `stepCraftLine`'s one-job-per-lane invariant, it is the Cancel target, and it is the key every console row and every existing fixture uses. Moving `remaining` off it is the whole change; renaming or deleting it would be a second, unnecessary one (Omega 15a: do not rewrite working code beyond the one concern).

`kind` / `recipeKey` / `mode` move to the order because they describe the WORK, and a lane that can be reassigned must not carry them. `CraftLineMode`'s existing `mode.remaining` mirror of `remaining` moves with it, still written in one construction so the two cannot drift, exactly as today.

#### 7.3.2 The consequence that matters most: reservations move to orders

`allocatedItem` (`allocation.ts:258`) today sums `line.remaining x inputsPerIteration(line)` over lines plus `queuedOrderInputs` over queued entries. **If several lanes shared one order and the sum stayed per LANE, the reservation would multiply by the lane count** and `free` would collapse for materials nobody is spending.

So the sum becomes: over `state.craftOrders` (running orders) plus `state.processQueue` (waiting orders). That is a **simplification, not a complication**: a running order and a waiting order become the SAME reservation arm with the same formula, where today they are two arms with two shapes. `queuedOrderIterations` and `queuedOrderInputs` already compute exactly the right number for a waiting order and can serve both.

Every material spender in the engine gates on `freeItemForState`, which is a thin wrapper over `freeItem`, so this one edit protects facility upgrades, docks and berth expansions, ship builds and new lines with **no change at their call sites** (the same property the 0.13.3 follow-up bought). `freeItem`'s `queued` parameter is REQUIRED rather than defaulted, deliberately, so converting it to take orders makes every unconverted call site a compile error.

#### 7.3.3 CLAUDE INFERENCE I5: a continuous order takes ONE lane and is never joined

A continuous order's `remaining` is held at 1 forever and never decremented (`allocation.ts:96`), so it has no finite pool to spread and no end condition for a join. Two things follow if it were joinable:

- **It would permanently eat the facility.** Every lane that ever frees would attach to it and never leave, which is precisely Model B's monopolisation failure that the user rejected, made permanent instead of merely long.
- **Its reservation would under-count.** `remaining: 1` reserves one iteration; N attached lanes each start an iteration per tick, so N-1 iterations would be unreserved and `free >= 0` would stop being guaranteed by construction. Fixing that means making a continuous order's reservation equal its attached lane count, which is a second correctness rule to maintain for no gameplay gain.

**Recommendation: a continuous order is allocated exactly one lane, and a free lane never joins one.** A player who wants continuous production on three lanes configures three continuous orders, which is Model A's payoff and is still fully available. The existing documented trap stays true and stays labelled: "a continuous line never releases its slot, so anything queued behind it on that facility waits for a DIFFERENT slot".

This is an inference. The user's rule says "joins an order already running", without excluding continuous. Open question 8.

### 7.4 OPEN QUESTION 1: which running order does a freed lane join?

| Option | What it does | For | Against |
|---|---|---|---|
| **(a) Oldest first** | The running order with the lowest order index / id. | Same FIFO rule `processQueue`'s array index already encodes and the player has already learned. Deterministic for free. Honest: "your first order finishes first". One sentence to explain. | A big oldest order soaks every freed lane, which is Q2's subject. |
| (b) Soonest to finish | The order with the fewest units left. | Minimises work in progress; orders retire faster. | A scheduler heuristic the player cannot predict, and the ranking reshuffles as durations change, so the same two orders behave differently on different ticks. |
| (c) Spread evenly | The order with the fewest attached lanes. | Feels fair; every order keeps progressing. | Maximises work in progress: with three orders and three freed lanes nothing finishes noticeably sooner and every ETA moves at once, which is the "looks broken" outcome Q3 exists to avoid. |

**RECOMMENDATION: (a) oldest first**, tie-broken by array index. It reuses a rule already in the game rather than adding a second scheduling vocabulary, it is the only option whose behaviour a player can predict without reading a manual, and its determinism is structural rather than argued. The tie-break must be a **declared** index order, never `Object.keys` or a `Map` iteration, for the same reason `QUEUE_FACILITY_ORDER` is a literal tuple.

### 7.5 OPEN QUESTION 2: is there a per-order lane cap?

| Option | What it does | For | Against |
|---|---|---|---|
| (a) No cap, unconditional | One order may hold every lane. | Maximum payoff for a lane purchase. | Combined with an aggressive join rule this is how one order eats a facility. |
| (b) Hard cap, e.g. `ceil(lanes / 2)` | An order may hold at most half the lanes. | Guarantees another order can always start immediately. | Weakens the lane purchase exactly when the player has ONE order, which is early game, which is when the purchase most needs to feel worth it. And it **breaks the user's own worked example**, which ends with BOTH lanes on C. |
| **(c) No explicit cap; the RULE is the cap** | An order may hold every lane, but only while nothing unstarted is waiting. | The user's stated rule already bounds monopolisation: the moment a second order is queued, the next free lane goes to the NEW order, because promotion runs before joining. Preserves the worked example exactly. No new concept. | A lane already attached to a big order does not abandon it mid-unit. |

**RECOMMENDATION: (c).** The precedence in 7.2 IS the cap, and it is the user's own rule rather than an addition to it.

**The number that makes (c) safe, and it must be stated and tested:** when a player queues a new order at a facility whose lanes are all soaked by one big order, the newly queued order waits **at most ONE unit duration**, not the rest of the batch. Because a lane releases after each unit, and `promoteQueuedOrders` runs before the join pass, the very next lane to release goes to the new order. So the worst case is one refine of 12 ticks or one tier-2 craft of 300 ticks, not 1000 of them. That converts "one order eats the facility for an hour" from a property into a bounded, measurable latency, and it is exactly the kind of claim that must have a test rather than a paragraph.

### 7.6 OPEN QUESTION 3: the ETA readout under a rate that changes mid-flight

The user's framing: an order reading "1000 left, about 16 hours" will suddenly halve when it picks up a second lane. "That is a GOOD moment, the payoff for buying a bay made visible, but only if the number updates cleanly instead of looking broken."

| Option | What it shows | For | Against |
|---|---|---|---|
| (a) Instantaneous rate only | "1000 left, ~16h" | Simplest. Honest right now. | The halving is a bare unexplained jump, which is the failure mode named. |
| (b) A range | "1000 left, 8h to 16h" | Honest about uncertainty. | Both bounds move too, so it jumps AND is harder to read. Implies a prediction the engine is not making. |
| **(c) Current allocation, with the divisor shown** | "1000 left \| **2 lanes** \| ~8h at this rate" | The lane count is the cause, displayed in the same row as the effect, so a halving reads as "it picked up a lane" rather than as a glitch. Stays a **pure function of current state**: no stored forecast, nothing that can go stale. | One more number on the row. |

**RECOMMENDATION: (c).** The lane count is the whole explanation, and showing it costs one field. Implementation: `CraftQueueRunningRow` gains `lanesAttached: number` and `etaTicks: number | null`, both derived in `craftQueue.ts`. **Ticks stay RAW**, never formatted in the module, exactly as that interface's existing header requires, so the console renders through the same `remainingReadout` path with `showTickCounts` and `state.tickDurationSeconds`. Optionally a transient "picked up a 2nd lane" note on the row; nice, not required, and it must not become a stored field.

### 7.7 PARITY ANALYSIS for F3 (the release's hardest gate)

**Does it touch the tick? YES, and it changes WHAT RUNS ON WHICH TICK, so nothing carries from 0.13.3.** Each hazard below needs a named proof, not an argument by analogy.

1. ⚠️ **BYTE-IDENTITY ON A SINGLE-LANE FACILITY IS THE GATE FOR THE WHOLE PHASE.** With one lane and one order, the new model must produce a byte-identical state trajectory to today. That is what keeps the pre-existing 101 parity cases meaningful rather than re-baselined, and it is the same discipline Combat 1.0 used with its Standard-Issue byte-identity guard. If this test cannot be made to pass, the phase peels; it does not get a new baseline.
2. **Lane walk order is DECLARED.** `runCraftLines` walks the lane array in index order threading state, so an earlier lane's deduct is visible to a later lane's gate. That stays exactly as it is. Separately, the join rule (7.4) decides which order a free lane takes. **Two different orderings, both declared, neither discovered.** A test must pin each independently, because a bug that swaps them would still look "deterministic".
3. **Promotion still draws no RNG.** `canStartLine` and `startLine` are pure predicates and a pure append. The join pass must likewise draw nothing. Its own header must repeat property 2 of `promoteQueuedOrders`, because the moment a lane assignment needs a draw, the pass has to take the threaded rng and every draw has to be ordered by its iteration, which is a parity-breaking change to be designed rather than slipped in.
4. ⚠️ **THE DRAW-ORDER HAZARD BECOMES THE COMMON CASE, NOT THE EDGE CASE.** Every rng draw happens at COMPLETION inside `resolveProcesses`, in `activeProcesses` array order. With N lanes on ONE order, N completions of the SAME recipe land on the same tick routinely, where today that requires N separately configured orders. This is precisely the warning `SUGGESTIONS.md` records for salvage lanes, and the 0.13.3 bug where two salvages in one tick discarded each other's results is the evidence that this class is real and reachable. **Required cases:** three lanes of one refine order completing on the same tick; three lanes of one EQUIPMENT fabricate order minting three instances with three quality rolls on the same tick; three lanes drawing from one material stack that can only fund two.
5. **Completion-log folding must rekey.** `OpenJobBatch` is keyed by **`lineId`** (`model.ts:3546`). With several lanes on one order, one order's completions would land in several accumulators and produce several log entries, which **violates the LOCKED "PER ORDER, NOT PER ITERATION" rule** and reintroduces the 50-cap eviction blowout that rule exists to prevent. **`OpenJobBatch` must key on `orderId`.** This is a small edit that is very easy to miss and it is a correctness requirement, not a tidy.
6. **The trailing fractional call.** The join pass inherits the documented bounded artifact identically to the four existing tail passes: at most one extra assignment per offline catch-up, self-correcting next whole tick. No new class of divergence, and the existing one is not made worse. Assert it.
7. **Migration must be behaviour-neutral on load.** See 10: each existing `CraftLine` becomes exactly ONE order with ONE lane, so a loaded save is in precisely the state it was in and lane sharing begins only at the next allocation decision. That is a testable property and it is the safest possible migration shape.
8. **Baseline discipline.** `npx vitest run -t "parit"` with the release's exclusion list must print **EXACTLY 101**. New parity cases go in NEW files added to the exclusion list, following 0.13.3's convention (its new cases lived in `craftQueue.test.ts` and `salvage.test.ts`, which were excluded). See 9.3 for the exact command.

### 7.8 Per-facility answers (all six, stated so none is guessed)

| Facility | Lanes today | What the lane model does here |
|---|---|---|
| **Refinery** | `refineSlotCount`, sums `addRefineSlots` | **Full model.** This is where it lands first and where the worked example is tested. |
| **Fabricator** | `fabricateSlotCount`, sums `addFabricateSlots` | **Full model.** Also the highest-value case, since a tier-2 equipment order is 300 ticks a unit. |
| **Research Lab** | `researchSlotCount`, sums `addResearchSlots` | **No join path, and this must be explicit.** A research order is ONE project (`{ type: "research"; blueprintKey }`, no `mode`, and `canEnqueueOrder` refuses a duplicate), so its remaining is always 1 and there is nothing for a second lane to pull. Extra lanes still run DIFFERENT projects concurrently, which is Model A's payoff and is unchanged. Do not build a research join. |
| **Salvage Bay** | `salvageSlotCount`, base 1 plus `addSalvageSlots`, up to 3 | Already a POOL. `withQueuedOrderReleased` (`tick.ts:7968`) leaves a residual entry one unit lighter, so a batch already spreads across lanes over successive ticks. **CLAUDE INFERENCE I6: keep the existing one-unit-per-tick bound this release.** See below. |
| **Shipyard** | `shipyardBayCount`, but **`shipBuildSlotCount` is `min(BUILD_CONCURRENCY_CAP, bays - 1)` and the cap is held at 1** | **The model changes NOTHING here today.** One build lane means there is never a second lane to join with. The `- 1` remains the repair reservation. The **construction-berth / repair-berth split is the future work that raises the cap**, and whoever raises it inherits this model plus the rung-copy correction the in-code comment at `tick.ts:5463` already names by constant. Out of scope here. |
| **Fuel Depot** | `fuelPipelineCount` | **Permanently excluded.** `processFuelPipelines` is always-on and automatic with no order object and no player intent; the `QUEUE_ADAPTERS` row is a triple-braked stub carrying the user's 2026-09-06 NO QUEUE decision. The lane model has nothing to allocate. Not deferred: excluded. |

**CLAUDE INFERENCE I6, stated with its cost, because it is a deliberate narrowing.** `promoteQueuedOrders` currently bounds a salvage batch to ONE unit started per tick, and the in-code comment says why: "one unit per job duration is what keeps the per-unit rng draw pattern identical to the single-unit path, which is the whole parity argument." Lifting it so a 3-unit batch fills all three lanes on one tick means re-proving the exact draw pattern in which the 0.13.3 two-salvages-in-one-tick bug was found.

**The cost of KEEPING it is small and computable:** a batch reaches full lane occupancy after `lanes` ticks instead of after 1, so a 3-lane bay ramps up over 3 ticks on a base salvage duration of 60 ticks. Steady-state throughput is **identical**. The observable difference is under 5% on the first job of a batch and zero thereafter.

**The cost of LIFTING it is a new parity family in the code path with the release's worst prior bug.** Recommendation: keep the bound, name the deferral, and revisit it if and when salvage lanes feel slow in play. Open question 9, so the user can overrule with the numbers in front of them. This is a named deferral with a reason, not an omission.

### 7.9 Failure modes for F3

1. **Reservation double-count.** If any reader keeps summing per lane after `remaining` moves, `free` collapses and every spender in the game reports a false shortage. Closed by making `freeItem`'s parameter change a compile error at every call site.
2. **Two answers to "is a lane free".** If the promotion pass and the join pass compute it differently, capacity is over-subscribed on a single tick. Closed by one delegated function (7.2).
3. **Log fragmentation.** `OpenJobBatch` left keyed by `lineId` silently breaks a LOCKED rule and blows the 50-entry cap. Closed by the rekey (7.7 item 5).
4. **Continuous monopolisation.** Closed by I5, if the user accepts it. If they overrule it, the reservation rule in 7.3.3 becomes mandatory and must ship in the same commit.
5. **Scope creep into a full `CraftLine` deletion.** A tempting third architecture derives lanes entirely from in-flight processes and deletes `CraftLine`. It is cleaner and it is NOT this release: it rewrites `stepCraftLine`, both line engines, `allocation.ts`, `craftQueue.ts` and two consoles, in a release the user asked to keep small. Logged here so it is a decision rather than a drift.

## 8. F4: Per-facility queue depth

### 8.1 Behaviour

Queue depth is bought per facility. The first purchase is still one global node that takes every facility from 1 waiting slot to 2, which is the shared trunk the user decided on. Beyond that, a player picks which facility to deepen, and points spent on the Refinery do not deepen the Fabricator.

### 8.2 The signature and the payload

```ts
// tick.ts
export function queueDepth(state: GameState, facility: QueueFacilityKey): number;

// model.ts, HomeworldTalentEffect: the EXISTING member gains a scope
| { type: "queueDepth"; depth: number; facility: QueueFacilityKey | "all" }
```

The user offered two shapes: "the talent effect payload gains a facility key, or the union gains one member per facility." **Take the first.** One payload vocabulary, one summing loop, and the trunk is expressed as `facility: "all"`, which is literally what it means. A second union member would mean two loops that have to agree about the same question, and the additive rule would then live in two places.

`queueDepth` stays a `reduce` over learned talents onto `QUEUE_DEPTH_BASE`, adding a payload when `effect.facility === "all" || effect.facility === facility`. **Additive, never multiplicative**, honouring the user's explicit warning: at base 1 a `+1` IS a doubling, so the flavour text stays true with none of the ordering ambiguity a real multiplier would introduce.

The compiler finds the callers. Known ones to convert: `craftQueue.ts`'s `depthTotal` (`:183`), the enqueue gate's depth comparison (`tick.ts` around `:7413`'s `queuedForFacility` count), and `autoSalvageOrders`' per-tick bound. See 8.6: that last one is the parity-relevant caller.

### 8.3 CLAUDE INFERENCE: no re-scoping, therefore no migration

**The existing chain stays exactly as it is.** `fleetLogisticsQueue1`, `2` and `3` keep their keys, costs (3 / 5 / 8 adminPoints), FA walls (none / 5 / 25), web positions, adjacency and grants. All three get `facility: "all"`.

`fleetLogisticsQueue1` **already is** the shared trunk the user described: one global point, base 1 to 2, at every facility. Its player-facing label is already "Standing Orders (2nd queued slot)". Nothing about it changes except an explicit scope on a payload.

**And therefore there is NO MIGRATION.** Talents are stored by KEY in `unlockedHomeworldTalents`, so changing an effect payload touches no save. This is the same reason the `recipeBonusOutput` retirement and the `industryBonusOutput` re-wire both needed none. That is the cleanest possible answer to the open question the user left ("how a player's already-spent points are honoured, which must not silently lose them"): **they are honoured because nothing they bought changes.**

**The rejected alternative, and why.** The user's note offered that "`fleetLogisticsQueue2/3` are the natural candidates to become per-facility branches", with the immediate constraint "that still has to honour points a player has ALREADY spent on 2 and 3 without silently losing them". Those two cannot both hold. Node 2 currently grants +1 at ALL SIX keys; re-scoping it to one facility **removes depth at five of them** from every player who bought it. The options for softening that are all worse: a refund is a silent unlearn of a node the player chose; a grandfather clause means the same key means two different things depending on when it was bought, which is a permanent maintenance tax and unfixable in the UI. Keeping the chain global and adding beyond it costs nothing and loses nothing. Open question 10.

**The accepted consequence, stated plainly:** a player with all three existing nodes has a global depth of 4 everywhere, and the per-facility branches push one facility to 5. That is generous. It is also consistent with the user's own reasoning that "generosity here is the point of the feature", and with the fact that a queued order is not free (it reserves its materials from the moment it is queued, and it occupies visible console space). If it proves too generous, the lever is the branch costs, which is a numbers edit.

### 8.4 CLAUDE INFERENCE I8: five nodes, not fifteen

The user's legibility warning is the constraint: "Three nodes become roughly five facilities times however many rungs, so a 3-node chain could become 15. ... Consider one node per facility with repeatable ranks, or a single node whose rank is allocated per facility, rather than a flat 15 nodes. Decide the SHAPE before the numbers."

**Shape: five new nodes, one per queue-capable facility, fanned off `fleetLogisticsQueue3`.** One node each for refinery, fabricator, salvageBay, researchLab, shipyard. One visual fan at the end of an existing ladder, not a wall.

**Repeatable ranks are rejected for this release.** `unlockedHomeworldTalents` is a flat `HomeworldTalentKey[]` with no rank concept anywhere, so ranks are engine work (a store shape change, a migration, a web-UI change to render and buy a rank) in a release the user asked to keep small. And they are not needed: because `queueDepth` **sums** payloads, a second rung per facility later is a data-only edit with **zero engine change**, the same forward property the design comment on `fleetLogisticsQueue1` already claims for a fourth global rung.

**`fuelDepot` is excluded IN THE TYPE, not by convention.** It is in `QueueFacilityKey` but it is permanently excluded from queueing (LOCKED section 15c), so a `Record<QueueFacilityKey, HomeworldTalentKey>` over the branch nodes would FORCE a node for a facility that can never hold an order. The node table is therefore:

```ts
const QUEUE_DEPTH_BRANCH_NODES: Record<Exclude<QueueFacilityKey, "fuelDepot">, HomeworldTalentKey> = { ... };
```

So adding a real queue-capable facility is still a compile error, while the one permanent exclusion is expressed in the type and needs no comment to be remembered. This is the 15c "permanent, not pending" pattern applied to a type.

`queueDepth(state, "fuelDepot")` still returns a number, harmlessly, because nothing can be enqueued there anyway. Do not special-case it in the helper; special-casing a facility inside `queueDepth` is what 15d step 6 forbids.

Costs and FA walls: mine to propose, the user's to set. Suggested starting point, all five identical so no facility is implicitly favoured: cost 6 adminPoints, `requiresFleetAdminLevel: 10`, adjacency off `fleetLogisticsQueue3`. Sitting between node 2's cost of 5 and node 3's of 8 puts a first specialisation within reach of a player who has taken the trunk, which is the early-game choice the user wants the feature to create.

### 8.5 Respec and the drain path

`respecHomeworldTalents` (`tick.ts:9894`) refunds every learned node whose effect is not `unlockCaptainSlot`, so it refunds the new branches too, and depth drops the same tick the points come back (depth is derived on read, never stored).

Dropping depth below a facility's queued count must let the over-cap entries **DRAIN** rather than truncating them. That behaviour already exists and is already per facility, because `CraftQueueView.overDepth` (`craftQueue.ts:190`) and the enqueue gate both count `queuedForFacility` rather than the array length. So the work is to **prove it per facility, not to build it**: a test that fills the Refinery queue to depth 3, respecs to depth 1, and asserts the Refinery drains from 3 without losing an entry while the Fabricator is untouched. The user asked for exactly this verification.

### 8.6 Parity analysis for F4

**Does it touch the tick? YES, and it is not obvious.** `queueDepth` looks like a UI and enqueue-gate concern, but `autoSalvageOrders` runs inside `promoteQueuedOrders` and is documented as **bounded per tick**: "it may add at most `depth - queued` orders per facility per tick, so it can never flood the queue or the loop".

So `queueDepth` is read INSIDE the tick, and it decides how many auto-salvage orders are created on a given tick, which decides what promotes, which decides what completes and therefore what draws. **A single caller left on a global value silently changes what runs on which tick.** Concretely: the auto-salvage bound must read `queueDepth(state, "salvageBay")` specifically, never a global number and never another facility's.

What must be proven:
- `queueDepth(state, facility)` is a pure function of state (talents plus base), with no ordering dependence. It is, and it stays a `reduce`.
- Every caller is converted. The signature change makes this a compile error, which is the mechanism, but the auto-salvage caller is the one to check by eye because it is the only one in the tick path.
- **Required parity case:** a save with auto-salvage enabled and per-facility depth nodes learned, stepped N times versus advanced by `tick(N)`, deep-equal including the queue contents and the resulting inventory buckets.

No RNG is added and no ordering changes, so beyond that caller this feature is parity-inert.

## 9. Parity analysis, consolidated (the release gate)

### 9.1 Per feature: does it touch the tick, and what must be proven

| Feature | Touches the tick? | What must be proven |
|---|---|---|
| **F1 transit berths** | **Yes.** The captain map's phase advance, plus a new threaded budget. | (i) The hold decision is a pure function of state at that tick with no rng; (ii) the berth budget is threaded sequentially through `state.captains.map` exactly as `fuelBudgetRemaining` is, so no order-dependence creeps in from a mid-loop state read; (iii) one big `tickCaptainMission` call equals many small ones, because a `break` at a refused boundary discards budget that could not have changed the answer; (iv) the wait queue order equals `state.captains` array order on both paths; (v) `berthEtaTicks` and `berthQueuePosition` are never read by the tick; (vi) **existing mission parity fixtures must not move**, which holds only if `TRANSIT_BERTH_BASE` is at least the largest concurrent-return count in any fixture. If one moves, inspect it; do not re-baseline. |
| **F2 patrol reasons** | **Yes.** The patrol arm now writes a log entry. | (i) The reason is set at the same deterministic branch on both paths, the existing `stopReason` discipline; (ii) ⚠️ `atMs` comes from the INJECTED `nowMs`, never `Date.now()`; `economyTick` currently threads `nowMs` only to `resolveProcesses`, so the patrol arm must be handed the same argument, and `tick()` already supplies a per-step schedule; (iii) exactly ONE entry per patrol RUN, with `iterations = routesCompletedThisRun`, so a long offline span cannot evict the 50-entry ring; (iv) deep-equal `completionLog` across defeat, out-of-fuel and multi-route-then-recalled spans. |
| **F3 lane model** | **Yes, and it changes WHAT RUNS ON WHICH TICK. Nothing carries from 0.13.3.** | (i) **Byte-identity on a single-lane facility**, the gate for the whole phase and what keeps the 101 meaningful; (ii) lane walk order and join rule both declared and independently pinned; (iii) the join pass draws no rng; (iv) N lanes on one order completing on the SAME tick, for a material order, an equipment order with quality rolls, and a contested stack; (v) `OpenJobBatch` rekeyed to `orderId` so one order yields one log entry; (vi) one delegated answer to "is a lane free", shared by promotion and joining; (vii) the migration is behaviour-neutral on load (one order, one lane, per existing line); (viii) the trailing fractional artifact is unchanged in kind. |
| **F4 per-facility depth** | **Yes, via `autoSalvageOrders`' per-tick bound inside `promoteQueuedOrders`.** | (i) The auto-salvage bound reads the Salvage Bay's OWN depth; (ii) `queueDepth(state, facility)` stays pure and additive; (iii) a parity case with auto-salvage on and branch nodes learned. |

### 9.2 The hazards that span features

1. **`promoteQueuedOrders` must keep exactly ONE call site.** Three of the four features are adjacent to it (the join pass sits after it, auto-salvage sits inside it, the berth budget sits before it in the same function). The temptation to "just call it once more for responsiveness" is the single fastest way to break the release, and its header already says so.
2. **No new rng in the tick, and no reordering of existing draws.** F1 and F2 add no draws. F3 does not add draws but makes the EXISTING draw order load-bearing in the common case. F4 adds none.
3. **No ambient clock.** Only F2 touches a clock, and only through the injected `nowMs`.
4. **No stored derivations.** Berth occupancy, waiting status, queue position, ETA, lane attachment counts and per-facility depth are all derived on read. Every one of them would be a stale-field bug if stored, and 5.5's H3 is the reason it matters beyond tidiness.
5. **Two save bumps, so a peel is clean.** See 10.

### 9.3 The gate commands

```
npm run check                                    # 0 errors (2 pre-existing RadialWeb a11y warnings are expected)
npx vitest run                                   # full suite, grows only by additions
npx vitest run -t "parit"                        # total, grows by the new cases
npx vitest run -t "parit" \
  --exclude "**/craftQueue.test.ts" \
  --exclude "**/salvage.test.ts" \
  --exclude "**/berths.test.ts" \
  --exclude "**/laneAllocation.test.ts" \
  --exclude "**/patrolEnd.test.ts"               # MUST print EXACTLY 101, at every unit
```

The last command is the invariant. New parity cases live in NEW files that are added to the exclusion list, following 0.13.3's convention exactly (its new cases lived in `craftQueue.test.ts` and `salvage.test.ts`, both excluded, so the untouched baseline kept printing 101). **If the excluded run ever prints anything but 101, a parity-critical invariant broke and the correct response is to find it, not to update the number.**

## 10. Save and migration

**CLAUDE INFERENCE I9: two bumps, not one**, so the lane phase can peel without shipping a dead field.

**SAVE_VERSION 42 -> 43** (phases 0 to 4, ships whatever else happens):

- `transitBerthCapacity: TRANSIT_BERTH_BASE` (plain number, no `hydrateDecimals` branch)
- `routesCompletedThisRun: 0` defaulted on any in-flight `PatrolMissionState` (read `?? 0`, so strictly speaking optional, but seeded for cleanliness)
- Nothing else. Purely additive. No field is removed, no value is recomputed.

**SAVE_VERSION 43 -> 44** (phase 5 only; if the lane phase peels, the release ships at 43):

- `craftOrders: CraftOrder[]` and `nextCraftOrderId: number`, built by converting each existing `refineLines` / `fabricateLines` entry into **exactly one order with exactly one lane**, preserving its id, kind, recipeKey, remaining and mode.
- `refineLines` / `fabricateLines` entries rewritten to `{ id, orderId }`, keeping the original `id` so every in-flight job's `lineId` still matches its lane.
- `OpenJobBatch` entries rekeyed from `lineId` to the `orderId` minted from that line.

**Why one-order-per-line is the right migration and not a shortcut:** it is the only shape under which a loaded save is in *precisely* the state it was in before the update. Lane sharing begins at the next allocation decision, not retroactively, so there is no way for the migration itself to change what a player's facility is doing. That is also a directly testable property: load, tick zero times, and assert the state is equivalent to the pre-migration state under the new shape.

**No migration at all for F4.** Talents are stored by key; changing an effect payload touches no save (8.3).

**Verify at build time, because it is the difference between a one-line migration and a serialization bug:** no new field carries a `Decimal`. `transitBerthCapacity` is a number, `CraftOrder`'s fields are strings and numbers, `PatrolEndReason` is a string literal, `routesCompletedThisRun` is a number. All ride `hydrateDecimals`'s spread untouched, exactly as `QueuedJob` does and for the same stated reason.

## 11. Risks and watch items

1. **Parity is the top risk, and F3 is the top of that.** The single-lane byte-identity gate is what makes the rest of the release's parity claims checkable. If it will not pass, peel the phase.
2. **The docking softlock class has precedent and deserves paranoia even with a proof.** The proof in 5.5 is only as good as its three hazards being closed, and H1 (a floor that cannot be lowered) is the one a future rung retune could quietly break. The never-fewer-berths test is what defends it, and it must be written as a property over every reachable capacity, not as three examples.
3. **The friction tension is a design risk, not a technical one.** If the base is too low or the status is missing from any surface that renders a mission phase, the feature reads as the game getting slower. Both mitigations are in 5.3 and 5.8 item 2, and both are cheap. The expensive version of this mistake is discovering it in QA.
4. **`OpenJobBatch`'s rekey is the easiest thing in this document to forget** and it silently breaks a LOCKED rule about the log. It belongs in the same commit as the lane-sharing change, never after it.
5. **The auto-salvage depth caller is the easiest parity break in this document.** One `queueDepth(state)` left unconverted inside the tick changes how many orders are created per tick. The signature change makes it a compile error, which is why the signature change must happen before any caller is touched, never as a final tidy.
6. **Scope creep has three named attractors here:** deleting `CraftLine` entirely (7.9 item 5), folding in the Starbase (1.1, 5.8 item 3), and raising `BUILD_CONCURRENCY_CAP` while in the Shipyard's code (7.8). All three are logged, all three are out, and all three would be defensible in a different release.
7. **Balance numbers are all first pass.** `TRANSIT_BERTH_BASE`, the rung table, and the five branch-node costs are mine and are the user's to set. None of them is load-bearing for correctness except the base's parity constraint in 5.3.
8. **Terminology.** INSTALL / INSTALLATION for gear, never fit / fitment, in all new copy. No em dashes and no `--` in prose, code or docs. Both are project-wide and both apply to every new comment and string in this release.

## 12. Build phases (gated, peelable)

| Phase | Content | Peelable |
|---|---|---|
| 0 | **Save shape.** SAVE_VERSION 42 -> 43: `transitBerthCapacity`, `routesCompletedThisRun`. Save tests. Nothing reads either field yet. | no (foundation) |
| 1 | **Per-facility queue depth.** `queueDepth(state, facility)`, the payload scope, the five branch nodes, the `Exclude<..., "fuelDepot">` node table, the auto-salvage caller, the per-facility respec drain test. No migration. | no (small, independent, high value) |
| 2 | **Patrol end reasons.** `PatrolEndReason`, the `ordersComplete` / `recalled` split, `missionKeyRetired`, the per-run route counter, the widened `CompletionLogKind` and `COMPLETION_KIND_VIEW`, the injected-clock threading, parity cases. Engine plus the log record. | no (self-contained) |
| 3 | **Transit berths, engine.** `berths.ts`, the derived helpers, the hold at the phase boundary, the threaded budget, the new process kind and its three `Record` rows, the rung track, the escape-valve proofs and tests (H1 to H3). | no (the feature's core) |
| 4 | **Transit berths, surfaces.** The status, position and ETA threaded into every site that renders a mission phase; the Docks console's second capacity line and second upgrade block. | yes (but shipping 3 without 4 is a **peace violation**: a silent wait is exactly the failure mode the user named. 3 and 4 ship together or neither does.) |
| 5 | **The lane allocation model.** SAVE_VERSION 43 -> 44, `CraftOrder`, lanes as capacity, the reservation move, the join pass, the `OpenJobBatch` rekey, the full parity family including single-lane byte-identity. | **yes (the declared peel point)** |
| 6 | **Lane-model readouts.** `lanesAttached` and `etaTicks` on the running row. | **yes (peels with 5)** |

**Definition of done per phase:** `npm run check` 0 errors, the full suite green, the excluded parity run printing **exactly 101**, plus that phase's own new cases.

**Peel points.** Phases 0 to 4 are a complete, coherent release: two features shipped whole (berths, patrol reasons) plus the talent change. Phase 5 is the heavy one and the user explicitly asked for it to be built so it can peel. **Phase 3 without Phase 4 is NOT a safe stop**, for the reason in the table. **Phase 5 without Phase 6 is a marginal stop:** lane sharing would work but the ETA would halve with nothing on screen explaining why, which is the exact "looks broken" outcome 7.6 exists to prevent. Prefer peeling both.

## 13. Open questions for the user

Each has a recommendation. None is silently decided.

1. **Turnaround-slot NAME.** Recommend **Transit Berth**, because the scope-lock entry itself wrote the feature as "transit-berth / turnaround docking slots". Alternatives the user listed: Turnaround Bay, Cargo Gantry, Unloading Gantry. Also confirms **Drydock Berths** as the player-facing name for today's `shipStorageCapacity`.
2. **`TRANSIT_BERTH_BASE` and the track.** Recommend **base 2, 4 rungs to 6**, NOT the base 4 from the user's example. ⚠️ The reason is a verified finding they may not have in mind: `MAX_UNLOCKABLE_CAPTAINS` is **5** today (1 plus 4 `unlockCaptainSlot` nodes), not the 10 in their example, so a base of 4 would mean at most ONE ship ever waits for at most 8 ticks and the feature would ship nearly inert. Base 2 gives a worst case of `ceil(5 / 2) x 8 = 24 ticks` with up to 3 ships queued, leaves a 1-to-2-captain fleet untouched, is fully buyable away at 6, and sits exactly on the parity-fixture boundary (5.3). Full reasoning in 5.3.
3. **A bypass for the wait?** Recommend **no** (I4). The wait is provably bounded at 24 ticks worst case and the reachable fix is the upgrade track, so a bypass would be selling relief from manufactured friction. If the user wants one, recommend a FREE "unload by tender" action available only while held, never a paid one and never a cargo forfeit.
4. **Do transit berths gate PATROL returns?** Recommend **no** (I3). Patrols award loot per won wave and have no unloading phase, so there is no cargo for a berth to gate.
5. **Confirm no new `docking` MissionPhase** (I1). Recommend confirming. It would lengthen every mission cycle for every save and would silently move the LOCKED fuel-runway projection, and the player-facing experience is delivered without it.
6. **Lane join rule** (the user's own question 1). Recommend **oldest first**, tie-broken by declared index. Alternatives: soonest-to-finish, spread-evenly. Section 7.4.
7. **Per-order lane cap** (their question 2). Recommend **no explicit cap: the precedence rule IS the cap**, with the one-unit-duration worst case as the safety number. A cap would break their own worked example. Section 7.5.
8. **ETA readout under a changing rate** (their question 3). Recommend **current allocation with the lane count shown beside it**, so a halving reads as a cause rather than a glitch, and the derivation stays pure. Section 7.6.
9. **Continuous orders: one lane, never joined?** (I5) Recommend **yes**. A continuous order has no finite pool, so joining has no end condition, it would permanently monopolise the facility, and its reservation would under-count. If overruled, the per-attached-lane reservation rule in 7.3.3 becomes mandatory.
10. **The Salvage Bay's one-unit-per-tick bound** (I6). Recommend **keeping it this release**. Cost of keeping: a `lanes`-tick ramp-up on a 60-tick base duration, identical steady-state throughput. Cost of lifting: a new parity family in the exact code path of 0.13.3's worst bug.
11. **The talent chain: keep global and add, or re-scope 2 and 3?** (8.3) Recommend **keep all three global and add five new per-facility nodes**. Re-scoping 2 or 3 removes depth at five facilities from every player who bought them, which is the silent loss the user forbade in the same breath as suggesting it. Accepted consequence: a fully invested player reaches depth 5 at one facility.
12. **Branch node costs and FA walls.** Recommend 6 adminPoints and `requiresFleetAdminLevel: 10`, identical across all five so no facility is implicitly favoured. Purely a balance call.
13. **`CaptainStopReason`: derive or widen?** (I7b) Recommend **derive** from `PatrolEndReason` through an exhaustive Record, so there is one vocabulary and `"cargo"` stays extraction-only.
14. **The patrol record: share `completionLog` or a parallel array?** (I7a) Recommend **share**, widening only `CompletionLogEntry.kind` and `COMPLETION_KIND_VIEW` while the two process-keyed Records stay keyed by `TimedProcessKind`.

## 14. LOCKED

**This section is authoritative. If any other section of this document, or any downstream plan, task list, commit message or code comment disagrees with it, THIS SECTION WINS and the other artifact is what needs fixing.**

### 14a. Carried forward unchanged from 0.13.3 section 15a

These four rules are LOCKED by the user's 2026-09-04 sign-off and nothing in 0.13.4 touches them. Restated in full because F3 and F4 both operate next to them.

1. **QUEUE DEPTH IS PER FACILITY. IT IS NEVER PER LANE.** One number applies independently to each queue-capable facility. F4 makes the NUMBER per facility as well; it does not make it per lane.
2. **NO UPGRADE MAY EVER GRANT QUEUE DEPTH PER LANE.** The user's verbatim framing: "There are no upgrades that give +1 queue slot X lane." Forbidden, not deferred. The lane model does not change this: a lane is capacity, depth is planning horizon, and joining a running order consumes neither a queue slot nor grants one.
3. **THE ACTIVE JOB DOES NOT CONSUME A QUEUE SLOT.** Under the lane model, an order that is RUNNING (however many lanes it holds) consumes no depth. Depth counts unstarted `processQueue` entries only.
4. **LANES ARE BOUGHT WITH FACILITY UPGRADES, DEPTH IS BOUGHT WITH TALENTS.** Transit berths are a THIRD thing and join neither pool: they are bought with a credits-plus-materials rung track and they gate ship returns, not jobs.

### 14b. New for 0.13.4

5. **Transit berths and drydock berths are two independent capacities.** Never summed, never multiplied, never a shared pool. `shipStorageCapacity` keeps its exact current job.
6. **The transit-berth softlock guarantee is STRUCTURAL and rests on three properties that must all stay true:** (a) the count is floor-plus-additive-rungs and can never fall below `TRANSIT_BERTH_BASE`; (b) occupancy is TIME-bounded, because the `unloading` phase advance is gated on nothing; (c) occupancy is DERIVED from `phase === "unloading"` and is NEVER STORED. **No berth-assignment field may be added to the save.** Weakening any of the three re-opens the 0.11.1 class of bug.
7. **A patrol ending without a reason is a defect.** Every path that sets a patrol's `mission` to null reports a `PatrolEndReason`, and every reason's wording is resolved through an exhaustive `Record` so a new ending is a compile error.
8. **One completion-log entry per patrol RUN, never per route.** This is the existing LOCKED "PER ORDER, NOT PER ITERATION" rule applied to patrols, and it is what protects the 50-entry ring from an offline repeat-dispatch span.
9. **Under the lane model, ORDERS own `remaining` and LANES are interchangeable capacity.** The material reservation is derived from orders, never from lanes, or it multiplies by the lane count. `OpenJobBatch` keys on `orderId`, never `lineId`.
10. **Unstarted orders always have precedence over joining**, and that precedence is delivered by `economyTick`'s existing tail order (`promoteQueuedOrders` before the line engines). `promoteQueuedOrders` keeps exactly ONE call site and does NOT take on lane joining.
11. **A single-lane facility must be byte-identical to pre-0.13.4 behaviour.** This is the gate for the lane phase. If it cannot be met, the phase peels rather than being re-baselined.
12. **Every new derivation is derived on read.** Waiting status, queue position, ETA, berth occupancy, lanes attached, and per-facility depth. None of them may become a stored field.

## 15. Self-consistency pass

This document was re-read end to end against itself, because 0.13.3's doc contradicted itself in two places and the wrong half was built. The places where two sections COULD have disagreed, and the single answer in each:

| Potential conflict | The single answer |
|---|---|
| §1.1 quotes the user saying the feature adds "transit, docking and unloading phases"; §5.2 adds no phase. | **§5.2 is the design.** The divergence is flagged as I1 in §1.1 itself, in §1.5, and as open question 5. It is visible in three places rather than resolved silently in one. |
| §2 says "no UI work"; §5.6 specifies status, position, ETA and a console block. | **§2's own closing paragraph draws the line:** new readouts that explain new behaviour are in, re-tuning existing screens is out. §1.0 states the same boundary. There is no third reading. |
| §5.5 says to adopt the `shipBuildSlotCount` precedent; it then does not use its mechanism. | **§5.5 says explicitly which half is adopted:** the principle (a structural proof written into the code) yes, the mechanism (capping a competing consumer) no, because there is only one consumer. Both sentences are in the same paragraph, deliberately. |
| §7.5 recommends no per-order lane cap; §7.9 lists "continuous monopolisation" as a failure mode. | Not a conflict. **No cap on FINITE orders** (bounded by the precedence rule plus the one-unit-duration latency) and **continuous orders take one lane** (§7.3.3 / I5) are two different rules about two different order shapes. Both are in §14b item 10's orbit and neither contradicts the other. |
| §7.8 says the Shipyard is unaffected; §12 has no Shipyard work; §2 lists the berth split as out. | Consistent in all three, and §7.8 names the constant (`BUILD_CONCURRENCY_CAP`) and the in-code comment that must be corrected by whoever later raises it. |
| §8.3 says "no migration"; §10 lists two SAVE_VERSION bumps. | Consistent: the bumps are for F1, F2 and F3. **F4 needs no migration**, which §10 states in its own line so the two cannot be read as disagreeing. |
| §6.4 widens `CompletionLogEntry.kind`; §6.4 also says the process-keyed Records stay keyed by `TimedProcessKind`. | Deliberate and stated: only `COMPLETION_KIND_VIEW` widens, because it is the VIEW table and must cover every renderable entry; `PROCESS_XP_AWARDS` and `PROCESS_COMPLETION_LOG` are about processes and stay as they are. |
| §1.1 quotes the user's "4 slots and 10 ships"; §5.3 recommends a base of **2**. | **§5.3 is the design, and the divergence is deliberate and evidenced:** `MAX_UNLOCKABLE_CAPTAINS` is 5 today (1 plus 4 `unlockCaptainSlot` nodes), not the 10 in the example, so a base of 4 would mean at most one ship ever waits and the feature would ship nearly inert. Flagged in §1.1's own row, in §1.5 as I2, and as open question 2. Three visible flags, no silent narrowing. |
| §9.3 requires exactly 101; new parity cases are required throughout. | Consistent: new cases live in NEW files that are added to the exclusion list, which is 0.13.3's own convention. The 101 is the count of the UNTOUCHED baseline, not of all parity cases. |

**No unresolved contradiction was found.** Anything that looked like one is either flagged as an inference in §1.5 or answered in the table above. If a future reader finds a real one, §14 wins and the other section is the thing to fix.
