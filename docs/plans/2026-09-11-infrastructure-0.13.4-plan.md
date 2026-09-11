# Infrastructure (0.13.4) : Build Plan

Companion to `2026-09-11-infrastructure-0.13.4-design.md`. Branch `feat/infrastructure-0.13.4`.

> ⚠️ **READ FIRST, IN THIS ORDER: design §14 (LOCKED), then design §17 (ANSWERS).** §17 records the user's decisions on all fourteen open questions and **supersedes §13's recommendations wherever they differ**. It also carries a **correction to the design doc's own arithmetic** (§17.2). **Both override this plan's scope wherever they disagree**, including this plan's phase table. Before starting any phase, reconcile against the USER'S OWN STATED SCOPE, not only against these docs. That rule exists because 0.13.3 shipped queues on three facilities when the user had asked for all of them.

**Method:** subagent-driven-development per unit (implementer, then spec review, then code-quality review), branch-direct commits, one concern per commit. **Every unit gates green before commit:**

```
npm run check                 # 0 errors. The 2 pre-existing RadialWeb a11y warnings are expected and stay.
npx vitest run                # full suite green
npx vitest run -t "parit"     # the excluded baseline must print EXACTLY 101
```

A unit that cannot go green does not get committed. A unit that turns parity red is **reverted, not patched forward**.

**Ordering principle: engine before pixels.** Every new decision in this release is a pure function of state at a tick, so it is node-testable with no DOM. Engines land first with their parity cases, and consoles are built on an engine already proven. The parity invariant is the one thing that cannot be visually spot-checked, so it is defended by tests written before any console is opened.

**Parity is the top invariant.** Any unit touching `resolveProcesses`, `economyTick`, `promoteQueuedOrders` or the patrol path states its parity argument in its Approach and calls out the 101 in its Gate. The existing cases are never edited, never renamed, never skipped. New parity cases are additions in NEW files added to the exclusion list, which is 0.13.3's own convention and the reason the 101 stays meaningful.

**Line numbers drift.** Every anchor here is a current-tip number that moves the moment the first unit commits. **Re-locate by content** (function name, comment header, string literal), never by line number.

**Terminology.** INSTALL / INSTALLATION for gear in all new copy. Never fit, fitting or fitment. Player-facing names are **Transit Berth** (the new capacity) and **Drydock Berths** (today's `shipStorageCapacity`), per §17.1.

**No em dashes** in code, comments, docs or player-facing copy. Colons, periods, parentheses.

---

## Corrections this plan carries forward

Three facts drifted between the design doc being written and this plan. Each is corrected here; the design doc is annotated but its body still contains the stale numbers in places, so **this table wins on these three points.**

| Drift | Design doc says | Truth at this tip | Consequence |
|---|---|---|---|
| **SAVE_VERSION base** | §10 and §12 plan bumps 42 -> 43 -> 44. | **`SAVE_VERSION` is 44**, shipped by 0.13.3.1 after the design was written. | Every bump in this release shifts by two. This plan uses **45, 46, 47**. Do not copy §12's numbers. |
| **Captain ceiling** | §5.3 and §13 Q2: `MAX_UNLOCKABLE_CAPTAINS` is 5 (1 plus 4 nodes). | **It is 4.** Three `unlockCaptainSlot` nodes exist (`model.ts` ~:7577, :7589, :7600). | Berth worst case is `ceil(4 / 2) x 8 = 16 ticks`, **not the 24 in §5.3**. Re-derive the parity fixture boundary from 4. The base-2 decision is unaffected and slightly strengthened. |
| **Berth track ceiling** | §13 Q2 recommends base 2 with 4 rungs to 6. | **User chose base 2 to 10** (§17.1). | **8 rungs of +1**, matching the `docksExpansion` precedent (+1 per level, 8 to 16). Not 4 rungs of +2: a second step size for capacity tracks is a needless pattern. |

⚠️ **And one constraint that is not a drift but must not be lost** (§17.2): the berth track is sized to 10 against a fleet that today tops out at 4 captains, so **the rungs past roughly 5 buy nothing a player can currently use.** That is deliberate forward investment toward the 10-captain endstate the roster already advertises. **The talent copy must not imply an immediate throughput gain**, or it becomes a rung that lies.

---

## Phase peel points

Ordered so the branch is a coherent, shippable release at every peel point, and so **the phases most likely to peel are last.**

| Phase | If we ship here | If we stop here, this defers | Peel verdict |
|---|---|---|---|
| **0. Save shape** | Nothing player-visible. `SAVE_VERSION` 44 -> 45, two dormant fields. | Everything. | **Do not peel.** Foundation only. |
| **1. Per-facility queue depth** | Five new talent nodes (8 points, FA 12) giving per-facility queue depth on top of the existing global chain. Small, real, independent. | Everything else. | Shippable as a talent patch, but thin for a release. |
| **2. Patrol end reasons** | Adds "why did this patrol stop" to the completion log. | Berths, lanes, F5. | Clean stop. Two small features is a modest but honest release. |
| **3. Transit berths, engine** | Nothing player-visible on its own. | Surfaces. | ⚠️ **NOT A SAFE STOP. Shipping 3 without 4 is a peace violation:** a silent wait is precisely the failure mode the user named as a requirement. 3 and 4 ship together or neither ships. |
| **4. Transit berths, surfaces** | **The headline release.** Berths with full status, position and ETA, plus patrol reasons and the talent nodes. | Lane model, F5. | ✅ **RECOMMENDED FALLBACK PEEL.** Complete and coherent on its own. |
| **5. Lane allocation model** | Batches spread across free lanes. `SAVE_VERSION` 45 -> 46. | Readouts, F5. | ⚠️ **Marginal stop.** Sharing would work but the ETA would halve with nothing explaining why, the exact "looks broken" outcome §7.6 exists to prevent. Prefer peeling 5 and 6 together. |
| **6. Lane-model readouts** | `lanesAttached` and `etaTicks` on the running row. | F5. | Clean stop. |
| **7. Standard-Issue fills every slot (F5)** | Every hardpoint and bay ships filled, magnitudes re-tuned. `SAVE_VERSION` 46 -> 47 plus a migration. | Nothing. | ✅ **FIRST TO PEEL** (§2). Deliberately last: it is the one non-infrastructure item, and it touches no tick code, so building it last carries zero interaction risk with phases 0 to 6. |
| **8. Release close** | QA sheet, APP_VERSION, patch note, Discord cut, promotion. | n/a | Always runs, whatever the last content phase was. |

**Why three SAVE_VERSION bumps rather than one.** Phases 5 and 7 are independently peelable and each needs its own field. Bundling their save shape into Phase 0 would mean shipping a version whose fields nothing reads if either peels, which is exactly the dormant-field confusion that makes a migration hard to reason about later. Each peelable phase owns its own bump.

**How to peel:** stop after the last COMMITTED unit of the chosen phase, jump to Phase 8, and re-scope the QA sheet and patch note to what actually shipped. Never leave a half-built unit on the branch. Move deferred phases into a `2026-09-XX-<name>-0.13.5-plan.md` stub before closing.

---

## Phase 0: Save shape

### Unit 0.1: `SAVE_VERSION` 44 -> 45, two dormant fields

**Approach.** Add `transitBerthCapacity` (number, the stored rung LEVEL, not the derived count) and `routesCompletedThisRun` (number, per-patrol-run counter) to `GameState`, defaulted in the migration and in `newGame`. **Nothing reads either field in this unit.** Follow the v34 -> v35 drone-pod migration as the shape precedent: append, default, never renumber.

⚠️ **Store the LEVEL, derive the COUNT.** The design's berth-safety guarantee (§3 Locked #3) is that occupancy is derived-never-stored with a floor that cannot be reduced. Storing a derived capacity would let a save carry a number the code can no longer justify, which is the class of bug the equipment cap avoids by computing on read.

**Gate.** check 0, suite green, parity exactly 101, plus save round-trip tests for both fields and a v44 -> v45 migration test asserting defaults on a save that predates them.

---

## Phase 1: Per-facility queue depth

### Unit 1.1: `queueDepth(state, facility)` and the five branch nodes

**Approach.** Keep the existing global chain as the shared trunk with **no re-scoping** (§17.3 Q11): re-scoping nodes 2 and 3 would remove depth at five facilities from every player who already bought them, which is the silent loss the user forbade in the same breath as suggesting it. Add five new `unlockQueueDepth`-style nodes, one per queued facility, at **8 adminPoints and `requiresFleetAdminLevel: 12`** (§17.1 Q12), identical across all five so no facility is implicitly favoured.

Type the node table as `Record<Exclude<QueuedFacility, "fuelDepot">, ...>` so the Fuel Depot's permanent exclusion (user decision 2026-09-06, recorded in `tick.ts`) is a **compile error** to violate rather than a comment to remember.

Accepted consequence, stated in §17.3: a fully invested player reaches depth 5 at one facility.

**Gate.** check 0, suite green, parity exactly 101. New: per-facility depth resolution tests, a respec-drain test per facility, and an exhaustiveness test proving a new `QueuedFacility` member fails to compile without a node row.

**No migration.** The trunk is unchanged, so no save shape moves.

---

## Phase 2: Patrol end reasons

### Unit 2.1: `PatrolEndReason` and the per-run route counter

**Approach.** An exhaustive union over every way a patrol ends, recorded **once per RUN** (not per route, not per call), with `ordersComplete` and `recalled` split apart and `missionKeyRetired` included. Thread the injected clock rather than reading an ambient one: `state.gameTimeSeconds`, never `Date.now()`, because this record is written inside the tick and must be identical offline and live.

`CaptainStopReason` is **derived** from `PatrolEndReason` through an exhaustive `Record` (§17.3 Q13), so there is one vocabulary and `"cargo"` stays extraction-only.

**Gate.** check 0, suite green, parity exactly 101, plus a new parity file (added to the exclusion list) proving the reason and route count are identical between `tick(span)` and a stepped `economyTick(_, 1)` loop.

### Unit 2.2: Surface the reason in the existing completion log

**Approach.** **Share `completionLog`** rather than adding a parallel array (§17.3 Q14). Widen only `CompletionLogEntry.kind` and `COMPLETION_KIND_VIEW`, because that is the VIEW table and must cover every renderable entry. `PROCESS_XP_AWARDS` and `PROCESS_COMPLETION_LOG` are about PROCESSES and stay keyed by `TimedProcessKind`. This is deliberate and is not a contradiction: one table is about rendering, the others are about processes.

⚠️ **Zero-result guard.** Every completion-log writer added here states what happened even when the count is zero. This release has already had the "silent zero" bug three times (Last Salvage panel, Home completion log, Salvage Bay `pushLog`). Do not make it four.

**Gate.** check 0, suite green, parity 101, plus render tests for every new `kind` proving no entry falls through the view table.

---

## Phase 3: Transit berths, engine

### Unit 3.1: `berths.ts` and the derived helpers

**Approach.** New leaf module. Capacity is **derived from the stored level**: `TRANSIT_BERTH_BASE = 2` plus `+1` per reached rung, **8 rungs to a ceiling of 10** (§17.1 Q2, `docksExpansion` step-size precedent). Occupancy is derived from the fleet's own mission state, never stored.

**Gate.** check 0, suite green, parity 101, plus pure-function tests over the full 2-to-10 range.

### Unit 3.2: The hold at the phase boundary, and the escape-valve proofs

**Approach.** A returning extraction ship claims a berth to unload; with none free it holds at the existing phase boundary in a deterministic wait queue. **No new `docking` MissionPhase** (§17.3 Q5): it would lengthen every mission cycle for every save and would silently move the LOCKED fuel-runway projection.

⚠️ **THIS IS THE SOFTLOCK-SHAPED UNIT AND THE ESCAPE VALVE IS BUILT HERE, NOT IN QA.** "You cannot unload without a free berth" is structurally the 0.11.1 docks bug that bricked saves. The guarantee is **structural, not procedural**: occupancy is time-bounded, derived rather than stored, and the berth count has a floor that cannot be reduced. Delay, never stranding, with a computable ceiling. Copy `shipBuildSlotCount`'s `bays - 1` reservation as the in-repo precedent for this class rather than inventing one.

**The ceiling to assert: 16 ticks** at base 2 with today's 4 reachable captains, up to 2 ships queued. ⚠️ **Not the 24 in §5.3**, which was computed from the wrong captain count. Write the test against a derived expression of the captain ceiling, not a hardcoded 16, so it tracks when unlock nodes are added.

**No bypass** (§17.1 Q3). It was declined on the "do not manufacture friction and then sell relief from it" ground, not on balance, so do not add one later without re-opening that decision.

Transit berths do **not** gate patrol returns (§17.3 Q4): patrols award loot per won wave and have no unloading phase, so there is no cargo for a berth to gate.

**Gate.** check 0, suite green, parity exactly 101, plus a new parity file, plus H1 to H3: **H1** no ship is ever stranded at any berth count; **H2** the wait is bounded by the derived ceiling at every fleet size; **H3** the floor cannot be reduced below base by any reachable state.

### Unit 3.3: The rung track and the new process kind

**Approach.** The upgrade track plus its three `Record` rows (the exhaustive-Record pattern, so a new process kind is a compile error). Talent and upgrade copy must **not imply an immediate throughput gain** for rungs past roughly 5, per the constraint above.

**Gate.** check 0, suite green, parity 101, plus rung-cost and effect tests across the full track.

---

## Phase 4: Transit berths, surfaces

### Unit 4.1: Status, position and ETA everywhere a mission phase renders

**Approach.** Thread the held state into **every** site that renders a mission phase, not the first one found. ⚠️ **Sweep the class, do not fix the instance.** This release has twice shipped a fix at one site while the same bug survived at seven others (the trimmed-space bug, the zero-manifest guard). Enumerate every mission-phase render site first, list them in the commit, then fix all of them.

⚠️ **Svelte `{@const}` dependency collection is STATIC.** Expressions run inside `$.untrack()`, so a read inside a called function registers no dependency. That is the confirmed root cause of the stale-readout class found in 0.13.3.1. Any new readout derived through a helper must be verified reactive, not assumed.

**Gate.** check 0, suite green, parity 101, plus a render test per site asserting a held ship shows status, queue position and ETA.

### Unit 4.2: The Docks console's second capacity line and upgrade block

**Approach.** Drydock Berths and Transit Berths as two clearly separate capacities. They **never add, never multiply, never share a pool** (§3 Locked #2). The console must make that legible: two numbers that look related but are not is worse than two that obviously are not.

**Gate.** check 0, suite green, parity 101, plus console render tests at several rung levels.

---

## Phase 5: The lane allocation model

### Unit 5.1: `CraftOrder` owns `remaining`; lanes become interchangeable capacity

**Approach.** `SAVE_VERSION` 45 -> 46. Today a craft line IS a lane with `remaining` living on it, which is exactly why a batch cannot spread. Separate the WORK from the LANE. Move the reservation with it, and rekey `OpenJobBatch`.

⚠️ **THE HEAVIEST UNIT IN THE RELEASE AND THE ONE THAT CHANGES WHAT RUNS ON WHICH TICK.** Offline-equals-live must be **re-proven from scratch**, never assumed to carry. `promoteQueuedOrders` keeps **exactly one call site** inside `economyTick`. Completion order AND rng draw order must match between `tick(span)` and a stepped loop.

⚠️ **Reservations stay DERIVED, never deducted.** `clampInventoryToCaps` trims over-cap stacks and discards overflow on every load, so a deposit-on-cancel path would silently destroy items. That is the user's hard line: the game never silently deletes a player's items.

**Gate.** check 0, suite green, parity exactly 101, plus a full new parity family **including single-lane byte-identity**: a single-lane facility must behave **byte-identically to today** (§3 Locked #6). That byte-identity is what keeps the 101 meaningful.

### Unit 5.2: The join pass

**Approach.** A free lane takes an **unstarted queued order first**, and otherwise joins a running order, **oldest first tie-broken by declared index** (§17.3 Q6). Precedence is already delivered by `economyTick`'s existing tail-pass order, so this adds no new seam.

**No explicit per-order lane cap** (§17.3 Q7): the precedence rule IS the cap, with the one-unit-duration worst case as the safety number. A cap would break the user's own worked example.

**Continuous orders take one lane and are never joined** (§17.3 Q9): no finite pool means no end condition for joining, permanent monopolisation, and an under-counted reservation.

The Salvage Bay's **one-unit-per-tick bound stays** this release (§17.3 Q10): keeping it costs a `lanes`-tick ramp-up on a 60-tick base duration with identical steady-state throughput, while lifting it would open a new parity family in the exact code path of 0.13.3's worst bug.

**Gate.** check 0, suite green, parity 101, plus join-order tests and a monopolisation test for continuous orders.

---

## Phase 6: Lane-model readouts

### Unit 6.1: `lanesAttached` and `etaTicks` on the running row

**Approach.** ETA shows **current allocation with the lane count beside it** (§17.3 Q8), so a halving reads as a cause rather than a glitch and the derivation stays pure. Same `{@const}` reactivity caution as Unit 4.1.

**Gate.** check 0, suite green, parity 101, plus a test asserting the ETA and lane count move together when allocation changes mid-order.

---

## Phase 7: Standard-Issue fills every slot (F5)

> Full treatment in design §16. This is the one non-infrastructure item and the **first to peel.**

### Unit 7.1: Fill the loadout table and re-tune magnitudes

**Approach.** Grow `COMBAT_DEFAULT_LOADOUT` weapon arrays to each hull's `weaponHardpoints` and `droneRoles` to its `droneBays`. Five of seven hulls change; Runner and Miner are already full at 1 of 1.

Cut per-hull Standard-Issue magnitudes so **total offense per hull lands where the sim sits today**: a full loadout is the same power spread thinner, not more power. **Per-hull scaling by `newSlotCount / oldSlotCount`**, not a global cut, so Runner and Miner come out byte-identical at a ratio of 1 (§16.3).

⚠️ The lever is the generated magnitude in `generateCombatStandardIssue`, **not** the choice of `WeaponId`: those choices carry each hull's family identity (the battleship's railgun plus torpedo plus voltaic is its character, not a number).

⚠️ **The in-code comment currently says the guns are "deliberately fewer than the hull's weaponHardpoints."** That is being overridden on purpose with the user's authority. **Leave the comment truthful afterwards.** A comment describing the old intent is how the next reader gets it wrong.

**Gate.** check 0, suite green, parity 101, and **`patrol-balance.test.ts` is the acceptance test, not advisory**: every economy hull's win rate must still land below the destroyer's on **both** the Sweep and the Warband. It will not pass by construction. Re-tune until it does.

### Unit 7.2: The migration

**Approach.** `SAVE_VERSION` 46 -> 47. Mint the missing pieces onto **every existing ship**, installed, in the same deterministic order `seedCombatStandardIssueForShip` uses, **appending ids, never renumbering** (v34 -> v35 is the precedent).

⚠️ **OPEN, AND MUST BE ANSWERED BEFORE THIS UNIT STARTS** (§16.5): does the migration also re-tune magnitudes on **already minted** pieces? If not, an old ship keeps full-strength originals plus new weaker ones and ends up stronger than a freshly built identical hull, a permanent power difference by build date that no player can see or fix. **Recommendation: yes, rewrite them**, since Standard-Issue is explicitly the auto-managed floor rather than player property (it recovers nothing when broken down and the Quartermaster replaces it free). Record the answer in §16.5 before writing code.

⚠️ **Re-check the never-empty invariant against the wider loadout**: the four uninstall routes in `equipment.ts` and the Quartermaster's per-slot-type bound. That bound is per slot TYPE, not per slot, so a 6-hardpoint battleship missing three guns requisitions one at a time. Probably still correct (installing re-opens the row) but it is now a longer recovery and must be confirmed against the peace value rather than assumed.

**Gate.** check 0, suite green, parity 101, plus a migration test on a real pre-v47 save proving every ship comes out with every slot filled and no id renumbered.

---

## Phase 8: Release close

1. **Delta QA sheet** (desktop + mobile), scoped to what actually shipped. Delta, not full: this is incremental work on affected systems.
2. **APP_VERSION** bump to 0.13.4.
3. **Patch note** in `patchNotes.ts`. ⚠️ Write it against what SHIPPED, not what was planned. This release corrected its own notes three times for exactly that failure, twice for omitting a shipped feature entirely.
4. **Discord cut** at `docs/patch-notes/discord-0.13.4.md`, target ~1,800 characters against the 2,000 ceiling. The convention started with 0.13.3.1.
5. **Promotion**, only on the user's explicit green light. Pre-flight first: `git log HEAD..origin/main` must be 0 **and** `git merge-base --is-ancestor origin/main HEAD` must pass. Issue the push as a single unchained command.

---

## Definition of done

- Every unit gated green and committed, one concern per commit.
- `npm run check` 0 errors, 2 expected RadialWeb warnings.
- Full suite green; the excluded parity run printing **exactly 101**.
- Every new parity case in a NEW file added to the exclusion list.
- No em dashes anywhere. INSTALL terminology throughout.
- The QA sheet run by the user, not by me, before any promotion.
