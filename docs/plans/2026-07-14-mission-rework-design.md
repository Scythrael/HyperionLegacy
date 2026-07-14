# Mission Rework + Fuel Economy — Design

**Status:** Design (brainstorm complete 2026-07-14). Next: writing-plans → subagent-driven build.
**Branch:** `feat/mission-rework` (off `main` @ 735ca36).

**Goal:** Turn the two placeholder ore runs into a real set of 4 material-sourcing missions feeding
crafting, gate their unlock behind play-completion via a new mission-control facility, and introduce a
fuel economy (buy → store → spend) that gives missions a real per-dispatch cost and range gate.

**Why now (north-star):** the roadmap's end state is *build a whole ship from scratch with a captain + a
Freighter, then swap to combat*. Crafting needs material SOURCES; today there aren't enough. This pass
adds the sources and the fuel loop that makes dispatching a real economic decision. Crafting itself
(recipes consuming these materials) stays in the later Fabricator/Research phases.

---

## Scope

**In this pass:**
1. **4 missions** (rename the 2 existing + add 2), each yielding a common/uncommon/rare material triad → 12 raw materials.
2. **Mission-control facility** (Homeworld / Facilities tab): unlocks missions 2–4 per level, gated on completion counts.
3. **Fuel economy:** ship `fuelCapacity` + `engineEfficiency` stats, a global Fuel Tank, a fuel-storage facility, buy-with-credits refill, per-dispatch consumption.
4. **Per-mission XP** (linear first-pass rates) + **exp/tick shown** on each mission.
5. **Mission requirements:** captain level / fuel capacity / cargo capacity gates on dispatch.

**Deferred (explicitly out — do NOT build):**
- Refined forms for the 12 raws + the fuel-**refine** recipe → consumed by crafting (future Fabricator).
- The fuel refill **consumable** (a craftable) → future; credits-refill ships first.
- Mission **difficulties + hazards** (pirates, ship-loss risk) → combat-adjacent, later.
- Shield/combat stats + any combat behavior → epic rule: combat *reads* stats, built later.
- Engine **upgrade modules** (the source of `engineEfficiency` bonuses) → ship-systems phase; the stat + formula exist now, hulls carry base values.

---

## 1. Missions & materials

Four missions, each a **common / uncommon / rare triad** rolled by the EXISTING rarity roll (no new roll mechanic):

| Mission (`MissionKey`) | Common | Uncommon | Rare |
|---|---|---|---|
| Local Asteroid (`shortOreRun` → rename) | Titanium Ore | Polysilicate Ore | Iridium Ore |
| Lunar Mine Contract (`longOreRun` → rename) | Ferrite | Cobalt | Osmium |
| Salvage Skirmish Wreckage (NEW) | Scrap Alloy | Salvaged Circuitry | Intact Reactor Core |
| Forage Minerals & Flora (NEW) | Fibrous Biomass | Volatile Resin | Exotic Spore Cluster |

- All 12 items ALREADY exist as scaffolded `ITEMS` placeholders (Phase 2 catalog). This pass wires missions to produce them and confirms labels/flavor.
- Base-ore names are provisional; **Iridium Ore** is not final — confirm during build.
- Reuse `MissionDef.primaryMaterial` (added Phase 2) for the auto-stop gate; each new mission needs its own primaryMaterial (the common of its triad) + loot table.
- Mission CYCLE is unchanged (ordersReceived → transit-out → extraction → transit-back → unloading). Salvage/Forage reuse the same closed-form `tickCaptainMission` — only loot tables + durations differ.

## 2. Mission-control facility (unlocks)

A new Homeworld facility in the Facilities tab, following the House UI pattern (rail + Overview/Upgrades SubTabs) and the Phase-1 facility framework (`FACILITIES` registry, timed upgrade track, `level` 0=locked).

- **Upgrade track unlocks 2–4 missions per level.** This pass (4 missions):
  - **Level 1 (facility built/start):** the 2 ore missions (Local Asteroid + Lunar Mine) are available — they exist today, so **no regression**.
  - **Level 2:** unlocks Salvage + Forage together.
  - Track **caps at Level 2** = real content, NO placeholder rungs. Future levels unlock 2–4 more missions each.
- **Unlock gate = PLAY-COMPLETION**, not materials/tier: the Level-2 upgrade requires completing **each current mission ~50×** (tunable). Read directly from `lifetimeStats.missionsCompleted[missionKey]` (a `Record<string,Decimal>` that already exists — model.ts:716). No schema work for the counter.
- Dispatch stays in the **Operations tab** (unchanged — Anti-Regression). This facility does ONLY unlock + upgrade.
- A mission is dispatchable iff its unlock level is reached AND its requirements (§4) are met.

## 3. Fuel economy

Two non-redundant fuel concepts (confirmed reconciliation):

- **Ship `fuelCapacity`** = the RANGE gate: the max fuel a ship can carry for one round trip. A mission is reachable iff `fuelCapacity ≥ fuelNeeded(mission)`.
- **Global Fuel Tank** = the RESOURCE you spend: your total fuel stockpile, capped by the **fuel-storage facility** (a cap-upgrade facility that PARALLELS the Warehouse — reuse that cap-upgrade pattern).

**New ship stats (on `ShipTypeDef` / `ShipInstance`):**
- `fuelCapacity: number` — varies by hull (e.g. Freighter large tank, Runner smaller).
- `engineEfficiency: number` — base 0; varies by hull (e.g. Runner most efficient). Bonuses from engine modules are FUTURE; the stat + formula are real now, so different hulls already cost different fuel.

**Fuel math (first-pass, tunable):**
- `fuelNeeded(mission) = roundTripTransitTicks(mission) × FUEL_PER_TICK / (1 + engineEfficiency)`
  - `roundTripTransitTicks` = the mission's out + back transit phase ticks (reuse existing phase durations; no new "distance" field).
  - `FUEL_PER_TICK = 1` to start (1:1 efficiency).
  - `engineEfficiency` applies with **diminishing returns** — first-pass curve: the raw engine stat feeds `engineEfficiency = 1 - 1/(1 + k·rawEngine)` style taper (define the exact curve in the plan; irrelevant this pass since rawEngine bonuses are 0, but hull base values exercise it). ⚠️ **CONFIRM AT REVIEW:** the user framed capacity as "½ transit distance for the round trip" — this doc treats fuelNeeded as the full round-trip (out+back); verify that matches intent.
- **Acquire:** buy fuel at **5 credits / 1 unit** (tunable), into the tank up to its cap. UI lives with the fuel-storage facility (and optionally a quick "refuel" affordance at dispatch).
- **Consume:** on each dispatch, deduct `fuelNeeded` from the global tank. Dispatch is blocked if the tank can't cover it OR `fuelCapacity` is too small.
- **Auto-repeat:** each cycle re-dispatch draws fuel again; when the tank can't cover the next dispatch, the mission **stops and the captain idles** — identical pattern to the Warehouse auto-stop (a resource-gate pause). This keeps offline closed-form (see §6).

## 4. Mission requirements

Gates checked at dispatch (fail → can't dispatch, with a clear reason):
- **Captain level** (exists) — first-pass: ore missions low/none, Salvage/Forage modest.
- **Ship `fuelCapacity`** (new) — must cover the round trip (§3).
- **Ship cargo capacity** (exists) — first-pass thresholds per mission.
- (Future: ship-equip level for patrols — not this pass.)

## 5. XP

- Per-mission rate via the EXISTING `BASE_XP_PER_TICK: Record<MissionKey, number>` (model.ts:215) — first-pass `1 / 1.1 / 1.2 / 1.25` for Local Asteroid / Lunar Mine / Salvage / Forage.
- **⚠️ FRACTIONAL-RATE PARITY (build requirement):** tick.ts:304 warns that non-integer XP rates can drift between offline-catchup and live unless the accrual is purely per-step. The Phase-2 per-tick stepping fix already made both loops step `economyTick(·,1)`, so the divergence source is gone — but the build MUST (a) confirm the accrual is per-step and (b) add a closed-form parity test AT a fractional rate (e.g. 1.1) to replace the rate-1 test's blind spot.
- **exp/tick shown per mission** in the Operations mission UI — `xpPerTick(missionKey, captain)` already returns it; a readout add.

## 6. Data model + save migration

**New/changed:**
- `MissionDef`: 2 new missions; each existing one renamed (label only — keep `MissionKey`s `shortOreRun`/`longOreRun` internally to avoid a mission-key migration, OR rename keys with a migration — decide in plan; label-only is lower-risk).
- New loot tables + `primaryMaterial` for Salvage/Forage.
- `BASE_XP_PER_TICK`: 2 new entries + retuned values.
- `FACILITIES`: `missionControl` + `fuelStorage` facility defs (upgrade tracks).
- `ShipTypeDef`/`ShipInstance`: `fuelCapacity`, `engineEfficiency`.
- `GameState`: global fuel — `fuel: Decimal` (current) + the cap derived from the fuel-storage facility level (like Warehouse `tierCap`). Mission unlock state derives from the mission-control facility level (no separate flag).
- Fuel constants: `FUEL_PER_TICK`, `FUEL_CREDITS_PER_UNIT` (5), fuel-storage base cap + doubling, mission-control unlock thresholds (~50×).

**Save migration v20→v21:** seed `fuel: 0`, seed the two new facilities at level 0 (fuel-storage) / level 1 (mission-control, so ore missions stay available), grandfather `fuelCapacity`/`engineEfficiency` onto existing `ShipInstance`s from their hull defs. Follows the Phase-1/2 migration pattern; `:any` migration signature.

## 7. Offline / closed-form

- Fuel deducts at **dispatch** (round-trip cost known up front) → no mid-mission fuel state, stays closed-form.
- Auto-repeat stopping on empty tank = the same resource-gate pause as Warehouse auto-stop, already proven closed-form-safe in Phase 2 (stepped `economyTick`). The offline catch-up loop must re-check the fuel gate each cycle boundary (it already re-checks caps).
- Credits spent on fuel: if fuel is auto-bought, that couples to the credit balance mid-span — **decide in plan**: simplest is fuel is NOT auto-bought (player tops the tank manually/explicitly), so offline only spends existing tank fuel and idles when empty. Recommended to keep offline simple.

## 8. UI surfaces

- **Operations tab (dispatch):** add per-mission requirement display + exp/tick + fuel cost; block dispatch with reasons. Unchanged structurally.
- **Facilities tab:** mission-control facility (Overview: unlocked missions + completion progress toward next unlock; Upgrades: the unlock track). Fuel-storage facility (Overview: current fuel / cap + buy-fuel control; Upgrades: cap track). Both reuse the rail + SubTabs House pattern.
- Warehouse: the 6 new raw materials already have ❓ tiles — they light up on first discovery automatically.

## 9. Testing

- Loot-table catalog test (each mission's triad exists + rarity-tagged).
- Fuel: `fuelNeeded` math; dispatch blocked when tank/capacity insufficient; deduct-at-dispatch; auto-repeat stop-on-empty; offline==live parity for a fuel-gated run.
- Unlock gate: completing a mission increments `missionsCompleted[key]`; the mission-control upgrade unlocks at the threshold; ore missions available at level 1.
- XP: **fractional-rate closed-form parity test** (the required one) + per-mission rate.
- Migration v20→v21 round-trip.

## 10. Suggested build decomposition (for the plan)

1. Materials/missions: rename + 2 new missions + loot tables + `primaryMaterial` + catalog test.
2. XP: retune `BASE_XP_PER_TICK` + fractional-rate parity test + exp/tick readout.
3. Fuel data model: ship stats, `GameState.fuel`, constants, `fuelNeeded`.
4. Fuel-storage facility (cap-upgrade, Warehouse-pattern) + buy-fuel + tank cap.
5. Fuel consumption at dispatch + auto-repeat stop-on-empty + offline parity.
6. Mission-control facility + completion-gated unlock track.
7. Mission requirements (captain level / fuel cap / cargo) + dispatch gating + reasons.
8. Operations UI (requirements, exp/tick, fuel cost) + Facilities UIs.
9. Migration v20→v21.
10. Version bump + patch notes (fold in the tile fix) + KNOWN_ISSUES + SESSION_LOG.

## 11. Open questions (resolve at plan/review)

- Confirm the "½ transit distance" phrasing vs. this doc's full-round-trip `fuelNeeded`.
- Rename `MissionKey`s or label-only? (label-only avoids a key migration.)
- First-pass numbers: the ~50× unlock threshold, per-mission captain-level/cargo/fuel requirements, fuel-storage base cap + costs, mission-control upgrade cost, `FUEL_PER_TICK`, hull `fuelCapacity`/`engineEfficiency` values.
- Is fuel auto-bought offline, or only spent from the existing tank? (recommend the latter for offline simplicity.)
- The exact `engineEfficiency` diminishing-returns curve (only matters once engine modules exist; hull base values exercise the formula).
