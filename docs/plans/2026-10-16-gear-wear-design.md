# Gear Wear (durability) for 0.14.0: DESIGN DRAFT

Status: DRAFT for user review (2026-10-16). Nothing here is built. No game code changes with this doc. Owner slice:
WR-8 (combat descriptors) for the combat half, WR-7 (ship systems) and WR-10 (away team) for the rest, per
`2026-10-15-wiring-registry-and-audit-plan.md` (OC-D14).

**Authority order:** the user's decisions, then this design, then code.

**The user decision this serves (OC-D14, 2026-10-16, verbatim, recorded in the wiring plan USER ANSWERS):**
"Everything wears in different ways. Similar to reality. Use. Battle damage. Etc. But can easily be repaired over
time."

**Standing rules it must obey:** peace is the product (QoL first, fewer clicks, never stress, friction or punishment:
memory "Build ease-of-use, sell peace"); diminishing returns, never hard caps, on stacking bonuses (D23); every
configured value must measurably act, no placeholders (user 2026-10-15); safe first runs cannot be lost.

**Markers.** `(user)` = the user's decision. **[PROPOSAL]** = mine: every name, number, rule and formula so marked is
the user's to accept, change or reject. Nothing marked [PROPOSAL] is a game entity until the user approves it.

## 0. What exists today (verified against source, 2026-10-16)

- `EquipmentInstance` (model.ts ~1812) carries `durabilityMax` and `durability`. The comment says durability "never
  drops this patch". Every mint path sets `durability = durabilityMax` (itemgen.ts 452, 575, 691).
- `durabilityMax` = slot base x (1 + quality x `QUALITY_DURABILITY_BONUS` 0.2) (itemgen.ts 178, 433, 559, 675). The
  slot bases are `SLOT_BASE_PHYSICALS[slot].durability` (model.ts 9984: cargo 100, FTL 100, reactor 120, utility 90,
  bridge 110, quarters 110, sensor 100, shields 100, plating 160, member armor 120, member weapon 100, member tool 80,
  implant 100) and `DRONE_POD_BASE_DURABILITY` 100 for pods. The audit marks these INERT or NO-EFFECT except weapons.
- Combat wear is LIVE inside one patrol only (combat/durability.ts): a connecting hit rolls `rollDurabilityLoss` on
  the COMBAT stream for each weapon, the reactor and the FTL; the four-state condition (Nominal, Degraded at or below
  60%, Disrupted, Offline at 0) cuts weapon damage (75%), reactor power (90% / 70%) and FTL evasion and closing speed.
  The per-system pools ride `PatrolMissionState.playerSystemDurability` across the waves of one cycle and are thrown
  away when the patrol ends. A weapon opens a cycle at `piece.durability` (bridge.ts 220); the reactor and FTL are
  `freshSystem(100)` at quality 0 (bridge.ts 311 to 320, 945), never the installed piece.
- Hull damage: a defeated patrol limps home, the ship is `damaged` with `repairDamage` hull points, and
  `processShipRepairs` (tick.ts) AUTO-STARTS a `shipRepair` TimedProcess in a free Shipyard bay (zero clicks,
  soft-lock-proof bay reservation). Duration `repairTicksForDamage` (model.ts 1628) with the officer repair-speed
  divisor, the Damage Control Suite `repairSpeed` reduction (utilityGear.ts) and the Cunning free tick.
- Expedition hull wear: scan events add `hullWear` to `GroundOpsState.hullDamage`; it comes home as `repairDamage`
  unless a GO-8b field repair (`FIELD_REPAIR_*`, groundOps.ts 2174) lands the ship and fixes it on a timer.
- Forward idea (gas giant design, moved to 0.14.x): burning an Antimatter Containment Cell in an Annihilation Core
  speeds a trip and then needs "a maintenance period to ensure that the extra wear on the ship doesn't cause damage"
  (user). This design gives that idea its home; it is not built here.

## 1. The model in one paragraph

Every piece of gear carries a **condition** from 0 to 100% [PROPOSAL storage in per-mille]. Each gear kind loses
condition **its own way** (user): engines by distance, cargo bays by hauls, reactors and crew modules by hours
running, sensors by scans, tools by fieldwork, weapons, shields, plating, pods and armor by battle damage. Ordinary use
can only wear a piece down to **Worn** (the use floor); only battle damage takes it lower. Wear lowers the piece's
own stat lines on a **smooth concave curve** that is nearly invisible when lightly worn and never below 75% at zero
[PROPOSAL]. Wear **never breaks or destroys** an item and **never blocks a run**. Repair is **automatic and free**:
gear recovers quickly at home, faster in a Shipyard bay, and slowly underway through crew upkeep. The default case is
**zero clicks** (user: "can easily be repaired over time").

## 2. Condition: units, bands, toughness

### 2.1 Units [PROPOSAL]

- `condition` is an integer **per-mille** 0..1000 (1000 = pristine). Per-mille, not durability points, because use
  wear per event is small (a few tenths of a percent) and integer points out of 100 cannot carry it without drift.
- **Toughness** is the existing `durabilityMax`. Every wear amount is scaled by `100 / durabilityMax` (integer floor,
  at least 1 when the raw amount is at least 1). So plating (base 160) wears at 62% of the reference rate, a member
  tool (base 80) at 125%, and a quality-5 piece (x2 ceiling) at half the rate of its quality-0 twin. This is what
  makes `SLOT_BASE_PHYSICALS.durability`, `QUALITY_DURABILITY_BONUS` and `DRONE_POD_BASE_DURABILITY` act on every
  piece (today INERT), with no new constants.

### 2.2 Bands (display names) [PROPOSAL names and edges]

| band | condition | what the player reads |
|:-|:-|:-|
| Pristine | 95 to 100% | like new |
| Sound | 80 to 94% | light wear, effect under 1% |
| Worn | 60 to 79% | ordinary use bottoms out here (the use floor, 60%) |
| Battered | below 60% | battle damage only; recovers on its own |

The 60% edge deliberately equals the combat `DEGRADED_THRESHOLD_PERCENT`, so "Battered" in the gear UI and
"Degraded" in the combat view are the same idea seen from two places. The band names are calm on purpose: no
"Broken", no "Critical", no red.

## 3. Wear sources: "everything wears in different ways" (user)

All wear is plain arithmetic on outcomes the game already computes deterministically. **No new random draws on any
stream.** Wear is applied only at discrete game events (a cycle end, a wave end, a leg end, a fieldwork step, a run
claim), never at an arbitrary tick-chunk boundary (section 7).

### 3.1 Use wear (stops at the use floor, 60%)

Use wear shrinks as a piece nears the floor: `use = floor(raw x toughness x (c - 600) / 400)` for c above 600, else
0. A piece in heavy continuous use therefore settles at a steady condition where wear and upkeep balance, instead of
grinding down. [PROPOSAL every raw value; tuned by the sim harness to the targets in 3.4]

| gear kind (slot) | wears by | event | raw per-mille at full |
|:-|:-|:-|:-|
| Cargo bay (`cargoBay`) | hauls | per completed haul cycle | 12 |
| FTL drive (`ftlDrive`) | distance | per 10 ly traveled on any run (transit ticks x `LY_PER_TICK`), applied per leg | 1 |
| Reactor core (`reactorCore`) | hours running | per minute underway, applied per leg or cycle | 3 |
| Utility gear (`specUtility`: Prospecting Rig, Damage Control Suite, Pathfinder Suite) | its own job | per cycle its effect fires (a prospecting haul, a repair it shortens, a wave regen, a scanned body) | 6 |
| Sensor array (`sensor`) | scans | per body scanned on an expedition; per survey mission cycle | 15 / 6 |
| Crew modules (`bridge`, `quarters`) | time aboard, slowly | per minute underway with crew aboard | 2 |
| Member weapon (`memberWeapon`) | fights | per ground fight its wearer fights | 10 |
| Member tool (`memberTool`) | fieldwork | per fieldwork step its wearer completes | 6 |
| Implant (`implant`) | time deployed, very slowly | per minute on the ground | 1 (see OC-W10) |
| Thrusters, propellant tanks (reserved slots) | as the FTL drive | when a consumer exists | none today (no pieces exist) |

### 3.2 Battle wear (can go below the floor, down to 0; never destroys)

| gear kind | wears by | how (per wave or fight) [PROPOSAL multipliers] |
|:-|:-|:-|
| Weapons (`weapon`) | hits taken | the EXISTING combat-stream durability loss. Persistent wear = the cycle's pool loss converted: `(startPool - endPool) x 1000 / poolMax`. No new draw. |
| Reactor and FTL drive (in battle) | hits taken | the same existing pools, now opened from the installed piece (section 5.2) and converted the same way |
| Shield emitters (`shieldEmitters`) | damage absorbed | `floor(150 x shieldDamageAbsorbed / shieldMax)` |
| Hull plating (`hullPlating`) | hull lost | `floor(250 x hullLost / hullMax)`; expedition scan-event `hullWear` counts the same way |
| Drone pods (`droneBay`) | drones lost | `floor(300 x dronesLost / squadronSize)` |
| Member armor (`memberArmor`) | hits on the wearer | `floor(250 x hpLost / hpMax)` per ground fight |

All battle amounts are then scaled by toughness (2.1). The inputs (hull lost, shield absorbed, drones lost, hp lost)
are end-state reads of a battle that is already seeded and replayed; where a result does not yet expose one, the
build adds it as a pure read of that result.

### 3.3 Never

- Wear never reduces a piece below 0 and **never deletes, salvages or uninstalls** anything.
- Safe first runs and practice tutorials apply **no wear** [PROPOSAL, OC-W9]: they cannot be lost and should not leave
  a mark.
- Salvage yield, Archive score and the Armory ignore condition (the Archive already excludes durability, user).
- A freshly inspected piece is Pristine.

### 3.4 Targets the constants are tuned to [PROPOSAL]

The table values are first-pass; these targets are the contract the sim harness (`src/lib/game/sim/`) measures:
- A ship on Repeat on a starter mission settles near **90%** (Sound) on use alone.
- A hard patrol leaves its worst system near **50 to 70%**; it is back to full within **about 20 minutes at home**.
- A long expedition comes home with its gear mostly **80% or better**.
- Use alone costs at most **4%** of any stat (section 4); a heavily battered piece at most 25%.

## 4. What wear does

### 4.1 The efficiency curve [PROPOSAL shape and depth]

`efficiency(c) = 1 - 0.25 x (1 - c / 1000)^2`

| condition | 100% | 90% | 80% | 60% (use floor) | 40% | 20% | 0% |
|:-|:-|:-|:-|:-|:-|:-|:-|
| efficiency | 100% | 99.75% | 99% | 96% | 91% | 84% | 75% |

Concave in wear: a lightly worn piece is effectively full, the effect grows only as damage deepens, and there is no
cliff at any band edge (smooth, so no "it just broke" moment). The 75% bound is a penalty depth, not a bonus cap, so
D23 does not apply to it.

### 4.2 Where it applies

The multiplier scales the piece's OWN stat lines (implicit and rolled) before the existing fold and curves, so every
downstream curve still sees one input:
- Cargo bay: cargo capacity. FTL drive: transit speed and engine efficiency. Reactor: power output where something
  consumes it. Utility gear: its lines (prospecting yields, `repairSpeed`, `waveHullRegen`, scan speed, hazard
  resist). Sensors: scan rate, coverage, foreknowledge. Crew modules: `crewEfficiency`. Shields: capacity and
  recharge. Plating: hull points. Drone pods: drone hp and yield. Member armor, weapon, tool, implant: their ground
  and fieldwork lines.

### 4.3 What wear never touches (the peace rule: never blocks a run)

No gate reads a worn value. Reach (the dispatch gate), the power-budget install gate (OC-D1), crew station COUNTS
(`crewStations`; no crew is ever displaced), hangar bay counts and every equip requirement read the PRISTINE value.
Wear can make a run a little slower or a haul a little smaller; it can never make a run impossible, uninstall gear or
evict crew.

### 4.4 How it combines with combat's degraded thresholds

- In battle, **combat's own four-state model stays the authority** for weapons, reactor and FTL (no double penalty:
  the efficiency curve is NOT also applied to those three in combat).
- Each patrol cycle opens a system's pool at `max(condition, 70%)` of its max [PROPOSAL, OC-W3, the **start floor**].
  70% sits above the 60% Degraded threshold, so wear carried between patrols never starts a fight Degraded or Offline;
  wear taken inside a patrol works exactly as today.
- The write-back is delta-based: `newCondition = preCondition - poolLossConverted`, so the start floor never "heals"
  a piece.
- Shields, plating and pods have no in-battle pool; their efficiency (4.1) is applied when the cycle's player
  combatant is built.

## 5. Repair: "can easily be repaired over time" (user)

### 5.1 Rates [PROPOSAL], all automatic, all free

| where the piece is | rate (per-mille per minute) | 0 to full | Worn 70% to full |
|:-|:-|:-|:-|
| **Home**: its ship is docked and on no run; any spare in storage; any Armory loadout piece not checked out | 40 | 25 min | 7.5 min |
| **Shipyard bay**: its ship is in a Shipyard repair bay (hull repair) | 80 | 12.5 min | 3.75 min |
| **Field repair**: its ship is set down on a GO-8b repair leg | 40 | 25 min | 7.5 min |
| **Underway**: any run (crew upkeep) | 2 | slow; balances use wear (3.4) | |

Member gear follows its member's ship (a member in the med bay on a run is underway).

**Bonuses that act on every rate** (no new sources; reuses what already shortens a hull repair, so those values gain
a second real effect): `rate x (1 + officerRepairSpeedBonus) / (1 - damageControlRepairReduction)`, the same algebra
`shipRepairDurationTicks` uses. The Damage Control Suite's existing curve stays as it is (its hard cap is already a
balance-pass review item in the audit, not changed here).

### 5.2 The zero-click default

Nothing to press. A ship comes home, its gear recovers while it sits; a damaged hull that auto-claims a Shipyard bay
repairs its gear at the bay rate in the same visit. There is no repair queue, no bay, no TimedProcess and no cost for
gear: condition is a derived value, so it cannot soft-lock and never competes with builds for bays. The tutorial
"time skip on every timed process" hook does not need a gear entry: skipping time advances the clock and condition
follows.

### 5.3 Optional instant repair (OC-W5)

Recommended: **none in 0.14.0**. The automatic path already covers every case, and a paid shortcut invites the "should
I be paying to fix this" worry the peace rule rules out. Alternatives: a "Quick Service" for a small credit cost
(proposal: 2% of the hull's build credits x the ship's average missing condition), or a free one-click rush that
doubles the home rate for one visit.

### 5.4 Hull damage: keep separate (OC-W6)

Recommended: **keep hull damage as it is** and show both side by side. Hull damage is the defeat state with its own
dispatch gate, bays and soft-lock invariant; folding it into gear condition would move every defeat path and its
goldens for no player gain. Gear wear is the soft layer on top: the care summary shows "hull in repair, about 6 min"
next to gear condition, and the bay visit doubles the gear repair rate (5.1), so the two read as one recovery to the
player.

## 6. Save shape (SAVE_VERSION 69 now; v70 is planned by G2)

### 6.1 Fields [PROPOSAL, OC-W1]

- `EquipmentInstance.condition?: number` (per-mille; ABSENT = 1000, pristine). `EquipmentInstance.conditionAt?:
  number` (gameTimeSeconds of the last settle; absent = never worn). Both absent on every pristine piece, so a fresh or
  migrated save serializes byte-identically until wear first happens.
- `EquipmentInstance.durability` is **retired**: it never dropped persistently (always equals `durabilityMax`), and
  keeping a second stored number beside `condition` is a drift bug waiting to happen. Readers (bridge.ts 220) switch
  to a pure `pieceStartDurability(piece)`. `durabilityMax` stays (toughness, and the weapon pool size).
- `PatrolMissionState.cycleStartCondition?: Record<pieceId, number>`: the conditions frozen at cycle start, so the
  display replay (`patrolReplay.ts`) opens the same pools and the same shield / plating / pod efficiency as the live
  loop. Absent = all pristine. `playerSystemDurability` stays the in-cycle carry, now seeded from these.
- Expeditions need no new run field: the run's snapshot is frozen at dispatch (as every run input already is), and
  wear taken during the run is written to the pieces at each event.

### 6.2 Migration

One step, riding G2's v69 to v70 bump if both land in the same release; otherwise its own v70 to v71 step. It deletes
`durability` from every `EquipmentInstance` (always equal to its max, so no information is lost) and writes nothing
else (absent `condition` already means pristine). Any in-flight patrol gets no `cycleStartCondition` (absent =
pristine, which is what it was dispatched with). Old saves load pristine.

## 7. Determinism and offline == live

- **No new draws.** Use wear and battle wear for shields, plating, pods and armor are arithmetic on seeded outcomes.
  Weapon, reactor and FTL battle wear reuse the existing combat-stream rolls; only the conversion to persistent
  condition is new, and it is arithmetic.
- **Repair is closed-form from an anchor**: `condition(now) = min(1000, condition + floor(rate x (now - conditionAt)
  / 60))`, with `rate` constant between anchors. A piece is **settled** (repair folded in, anchor moved) only at game
  events: its ship's context change (dispatch, arrival home, entering or leaving a Shipyard bay or a field repair
  leg), an install or uninstall, and a wear event. Never at a tick-chunk boundary, so one big offline chunk and many
  live ticks produce identical pieces. Reads (the UI) compute condition without writing.
- **Order within one instant:** settle, then wear; ships in array order, then slot order, then piece id.
- **Freeze points:** runs read condition at dispatch (the logistics4 precedent), patrols at each cycle start
  (`cycleStartCondition`), matching OC-D8's freeze rule.
- Parity tests: one-chunk vs per-tick catch-up over a mixed fleet (mission Repeat, patrol Repeat, expedition with a
  field repair, a damaged hull in a bay, spares in storage); the replay opens the same pools as the live loop.

## 8. UI [PROPOSAL; see the mockup]

Mockup: `gear-wear-mockup.html` (scratchpad, published by the user).

- **Gear card / tooltip:** a thin condition bar with its band name and percent, plus one effect line drawn from the
  same constants the sim reads (the `systemConditionEffect` pattern), e.g. "Worn 78%. Cargo capacity at 99% of new.
  Back to full in about 6 min at home." A Battered weapon adds "Opens each fight at 70%."
- **Ship systems panel:** each slot row gets a small condition meter and percent at the right edge; the ship header
  gets one summary chip ("Gear 91%"). No color below the band color; no warnings.
- **The care explanation:** a one-time-readable "How gear wear works" block in Help and in the gear tooltip footer:
  wears by use and battle, recovers on its own, never breaks, never blocks a run.
- **Fleet care summary:** one quiet line on the Home dashboard Shipyard card [OC-W8]: "Fleet gear 94%. 2 ships
  recovering, all full in about 12 min. Nothing needs you." No badges, no notification, no toast, no pulsing; it only
  ever reports and estimates. Hidden entirely when everything is Pristine.
- **Combat view:** pips unchanged; the cycle start line notes a raised start ("Railgun opened at 70%, carried wear").
- **Dev panel (`?dev`):** "Wear all gear to N%" and "Restore all gear" for QA.

## 9. Wiring registry

Wear is a new effect system, so it enters the registry the WR-1 way (same commit as the code):
- A new `WiringSystem` value `"wear"` [PROPOSAL] and three catalogs: `WEAR_SOURCES` (3.1, 3.2), `REPAIR_RATES` (5.1)
  and `WEAR_EFFICIENCY` (4.1).
- **One entry per wear source** (kind x source): base = a pristine fixture; on = the event once; off = no event;
  probe = the piece's condition; direction down; magnitude from the catalog (`raw x 100 / durabilityMax`, the
  headroom factor at full is 1).
- **One entry per repair context** (home, bay, field, underway) and one per repair bonus: on = N minutes in that
  context from a known worn condition; direction up; magnitude `rate x N`.
- **One entry per efficiency consumer** (each line in 4.2): on = the piece at a fixed condition; probe = the
  consumer's folded value through the real reader; direction down; magnitude `efficiency(c)`.
- **Never-touches proofs** (4.3): flat checks that reach, the power gate, station counts and equip requirements do
  not move at any condition.
- Status flips in the same commits: `SLOT_BASE_PHYSICALS durability`, `QUALITY_DURABILITY_BONUS`,
  `DRONE_POD_BASE_DURABILITY`, member slot physicals durability (INERT) and `qualityDurabilityMax` for reactor and FTL
  (NO-EFFECT; the combat reactor and FTL pools now take the installed piece's quality) all become LIVE.

## 10. Goldens (captured FIRST, the WR-8 rule)

Capture before any code: every patrol golden (every hull x both routes x Dispatch Once and Repeat, the forecast
band, the GO ship battles), the `patrolReplay` parity proof, the mission Repeat goldens, `firstRunsGoldens`,
`expeditionTiersGoldens`, `fieldKitsGoldens`, `complementGoldens` and the ship sheet goldens.

Expected to stay byte-identical: every pristine first cycle (efficiency 1, start pool = full, repair a no-op), every
safe first run (no wear, OC-W9), and the Standard-Issue reactor and FTL in combat (quality 0 pools are 100, as today).

Expected to move, each moved hash explained in its commit:
- Patrol Repeat from cycle 2 (weapons open at carried condition, plating and shields at their efficiency).
- Mission Repeat from cycle 2 (cargo and FTL efficiency, at most the use-only 4%).
- Any golden that serializes an `EquipmentInstance` (the retired `durability` field; `condition` appears once a piece
  wears).
- Crafted quality-above-0 reactors and FTL drives in combat (bigger pool, lower loss chance through quality).

## 11. Build order [PROPOSAL]

1. Goldens captured; catalogs and the pure helpers (`efficiency`, `useWear`, `settle`, toughness) with unit tests.
2. Save field swap and migration; `pieceStartDurability`; registry catalogs (entries `pending`).
3. Use wear sources wired per kind; repair contexts and settling at events; parity tests.
4. Combat: start floor, delta write-back, reactor and FTL from the installed piece, shield / plating / pod / armor
   battle wear, `cycleStartCondition` in the replay. Re-capture and explain moved goldens.
5. UI (card bar, panel meters, care line, Help block, dev tools); registry entries flipped live; QA sheet.
6. Forward hook only (not built): the Annihilation Core's antimatter burn becomes one large FTL + reactor wear event,
   and its "maintenance period" (user) is simply the home repair. Stays 0.14.x.

## 12. OPEN CALLS (multiple-choice ready; recommended first)

- **OC-W1, condition storage.** (a) Per-mille `condition` plus an anchor; retire `durability` (Recommended). (b)
  Keep integer `durability` points and accept coarser use wear. (c) Per-mille plus keep `durability` as a written
  mirror.
- **OC-W2, the use floor.** (a) Use alone stops at 60%, battle goes lower (Recommended). (b) Use stops at 75%. (c) No
  floor: use can reach 0 slowly.
- **OC-W3, carried wear in combat.** (a) Systems open a fight at no less than 70% (Recommended). (b) Open at true
  condition. (c) Carried wear never enters combat pools (efficiency only).
- **OC-W4, repair while away.** (a) Slow crew upkeep underway plus fast at home (Recommended). (b) Repair only at
  home. (c) Full rate everywhere.
- **OC-W5, instant repair.** (a) None, always automatic (Recommended). (b) Quick Service for a small credit cost. (c)
  A free one-click rush.
- **OC-W6, hull damage.** (a) Keep separate, show together, bay doubles gear repair (Recommended). (b) Unify hull
  damage into one condition model.
- **OC-W7, effect shape and depth.** (a) Smooth curve, 75% at zero (Recommended). (b) Smooth curve, 85% at zero. (c)
  Stepped per band.
- **OC-W8, care summary placement.** (a) One quiet line on the Home Shipyard card, hidden when all Pristine
  (Recommended). (b) Shipyard console only. (c) Ship list chips only.
- **OC-W9, safe first runs and tutorials.** (a) No wear (Recommended). (b) Wear normally.
- **OC-W10, implants.** (a) Wear very slowly by time on the ground (Recommended). (b) Never wear.
