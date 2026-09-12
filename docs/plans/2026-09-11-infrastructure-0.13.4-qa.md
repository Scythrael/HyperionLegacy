# 0.13.4 "Infrastructure" : Delta QA Sheet

**Run on desktop AND mobile.** Delta QA, not full: this is incremental work on affected systems, so the sheet covers what changed plus the regressions those changes could plausibly cause.

**Build:** branch `feat/infrastructure-0.13.4`. APP_VERSION **0.13.4**, SAVE_VERSION **46**.

**⚠️ Load an EXISTING save first, before a new game.** Three of the four features are additive to live state, and the most valuable single check in this sheet is that an existing fleet notices nothing it should not.

**⚠️ NOT IN THIS RELEASE:** Standard-Issue filling every hardpoint (F5) was peeled at build time. See design section 16.7. If you find yourself looking for it, that is why.

---

## A. The regression pass (do this first)

| # | Step | Expected |
|---|---|---|
| A1 | Load your existing save. | Loads clean. No warning banner, no reset, credits/materials/ships as you left them. |
| A2 | Check a captain already on an extraction run. | Reads exactly as it did before: a normal phase name, no berth language. |
| A3 | Check a craft line already mid-batch. | Still counting down its own batch. No "bays working this order together" line on it. |
| A4 | Open Homeworld Talents, Fleet Logistics. | If you owned the Standing Orders chain, it STILL adds queue depth at every facility. Nothing you bought was re-scoped or refunded. |
| A5 | Let a mission complete end to end. | Completes and delivers cargo normally. |
| A6 | Save, reload. | Everything above still true. |

## B. Docking bays

| # | Step | Expected |
|---|---|---|
| B1 | Facilities, Docks. | TWO capacity lines now: the existing drydock "Berths: N / M" and a new "Docking bays: X / 2 in use", each with its own button. They should read as clearly separate things. |
| B2 | With 1 or 2 captains, run missions normally. | ⚠️ **Nothing changes.** No waiting, no new status. This is the case most players are in. |
| B3 | Get THREE ships returning at once (dispatch three short runs together). | Two dock and unload; the third reads "Waiting for a docking bay (1st in line)" with an estimate and a free/total count beside it. |
| B4 | Watch the held ship. | It docks as soon as a berth frees, then unloads and completes normally. Nothing is lost and nobody gets stuck. |
| B5 | Home board, In Progress, while a ship is held. | The row says the same thing as the captain card. Same wording, not two versions of it. |
| B6 | Click "Add Docking Bay". | Starts a timed expansion. Recently completed logs it as "Expanded, Docking Bays" reporting a BERTH COUNT (3), not a level. |
| B7 | After it completes, repeat B3. | Three ships now dock at once. |
| B8 | Press "Add Docking Bay" with no materials. | Button disabled, with a persistent reason underneath (not a hover tooltip). |
| B9 | Send a PATROL out and back. | It never mentions berths and never waits for one. Patrols have no cargo to unload. |

## C. Patrol end reasons

| # | Step | Expected |
|---|---|---|
| C1 | Dispatch Once a patrol, let it finish. | Home, Recently completed: one line, "Patrolled, <patrol name>", detail "1 route, orders complete". |
| C2 | Dispatch Repeatedly, let it fly several routes, then press Recall. | ONE line when it lands, detail says "recalled", and the route count is the number it actually flew (not 1). |
| C3 | ⚠️ Compare C1 and C2 wording. | They must differ. "Recalled" must never read as "orders complete". |
| C4 | Let a patrol be defeated. | Detail says "defeated, limped home". Ship flagged damaged, repair behaves as before. |
| C5 | Run a repeat patrol a long while (or offline) then land it. | Still exactly ONE line, not one per route. The log should not have pushed everything else out. |
| C6 | Click the patrol line. | Jumps to Battlespace. |

## D. Batches across bays

| # | Step | Expected |
|---|---|---|
| D1 | At a facility with 2+ bays, queue ONE large order and nothing else. | It starts. As a second bay frees, it joins the SAME order and the line says "2 bays working this order together". |
| D2 | Watch the countdown as the second bay joins. | It drops sharply, AND the bays line is visible to explain why. The drop alone must not be unexplained. |
| D3 | ⚠️ Before and after the join, check your material total. | The RESERVED / free amount must NOT change when a second bay joins. Two bays on one order reserve what one did. |
| D4 | Queue three orders at a 2-bay facility. | First two start, third waits. As the first two drain, bays pick up the third. |
| D5 | Start a CONTINUOUS order, then free a bay. | The continuous order does NOT take the second bay. It stays on one. |
| D6 | Cancel a bay that is sharing an order. | Cancels cleanly. The other bay keeps working. No material vanishes and none is duplicated. |
| D7 | Save and reload mid-shared-order. | Both bays still on it, same remaining count. |

## E. Per-facility queue depth

| # | Step | Expected |
|---|---|---|
| E1 | Homeworld Talents, Fleet Logistics. | Five new nodes past the Standing Orders chain: Refinery, Fabricator, Salvage Bay, Research Lab, Shipyard. Same cost and same Fleet Admiral requirement as each other. |
| E2 | Are they crowded or overlapping on the web? | ⚠️ **Judgement call, and I want your read.** Their positions are a first pass and are trivial to move. |
| E3 | Buy the Refinery node. | Refinery queue depth goes up by one. Every OTHER facility is unchanged. |
| E4 | Respec. | The depth drops back immediately, same tick. |
| E5 | Look for a Fuel Depot node. | There isn't one, and that is correct: the Fuel Depot has no queue. |

## F. Offline

| # | Step | Expected |
|---|---|---|
| F1 | Queue work, leave a patrol repeating and a ship returning, close for 10+ minutes. | On return: the same outcomes you would have got watching it. Patrol line logged with a reason and a route count; held ships resolved; shared orders advanced. |
| F2 | Compare the offline recap to what the board says. | Consistent. A recalled or completed patrol raises no "stopped early" warning; only a genuine fuel-out or defeat does. |

---

## What I could not test for you

- **Anything needing a large fleet.** Berth contention needs three ships home at once, so B3/B7 depend on your captain count.
- **Real offline spans.** F1/F2 are wall-clock.
- **Whether the talent node placement looks right** (E2). That is the one item I would specifically like your eye on.
