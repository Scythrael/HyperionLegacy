# Ship Equipment + Combat + Beyond: Epic Vocabulary Design

**Date:** 2026-07-17
**Status:** Design vocabulary (the "design the whole" artifact). Captures every decision from the
0.11.0 brainstorm so the foundation is built with the right hooks and nothing is duct-taped on later.
**Build note:** This document is the WHOLE vision. Only a small slice ships in 0.11.0 (see the
companion `2026-07-17-equipment-0.11.0-design.md`). Everything combat/crew/exploration is 0.12.0+ and
lives here as vocabulary plus in `SUGGESTIONS.md` as logged future bites.

This is "Phase 6" of the ship-production-economy epic (`2026-07-10-ship-production-economy-epic.md`),
expanded. It obeys that epic's locked principles: full stat vocabulary up front, combat behavior
deferred, closed-form mission math preserved, spatial UI mockup-gated.

---

## 0. Governing principles (locked)

1. **Design the whole, build a bite at a time.** This doc captures the entire interlocking vision
   (equipment, item-generation, combat, crew, exploration) so the data model carries the right forward
   hooks. Each shippable patch is a complete, endpoint-reaching feature, never a live stub.
2. **Release cadence:** incrementalism lives in the DEV loop (build a layer, push to staging, user
   device-tests, next layer), not in production releases. `0.11.0` (equipment) and `0.12.0` (combat)
   each ship as ONE complete patch. No `0.11.1`/`0.11.2` stub releases.
3. **Spec interdependence pillar (user, locked):** you cannot reach the apex of one spec in isolation.
   Prospector sources materials, Explorer unlocks the tech, Tactician fights. The best warship needs
   all three built and geared. High-rank prospecting needs Tactician escorts fitted with resistances
   built from Explorer-discovered tech. This is the anti-tunnel-vision backbone.
4. **Combat behavior deferred:** combat ITEMS and STATS are defined and (for non-combat) tangible now;
   damage resolution, disruptions, durability loss, and actives stay inert until 0.12.0 Battlespace.
5. **Closed-form mission math is sacred:** every stat touching mission duration/yield must preserve
   `tickCaptainMission`'s closed-form guarantee. Equipment stats fold into `shipDerivedStats` before
   `effectiveMissionDef`, stable per cycle (fitting locked mid-mission).
6. **Stat-condensing guardrail:** if stats proliferate, condense (one stat doing multiple jobs) rather
   than sprawl.
7. **No dead placeholders:** reserved systems are shown as future (like the Warehouse ? catalog), never
   craftable-but-inert content.

---

## 1. Slot model

Three slot classes, not one:

- **Singleton typed slots** (exactly one per ship, type-locked): Cargo Bay, FTL Drive, Reactor Core,
  Cockpit, Quarters, Thrusters, Sensor, Shield Emitters, Hull Plating, Propellant Tanks.
- **Weapon hardpoints** (a COUNT per hull, each generic-fill with a chosen weapon).
- **Spec Utility Slot** (exactly one, non-Freighter hulls only). A universal slot; the items in it carry
  equip REQUIREMENTS (spec, ship type, level, talent, research) that gate them to a playstyle. Example:
  a Prospecting Rig requires a prospecting captain in a Prospector hull. The Freighter has no Spec
  Utility Slot.

`moduleSlots` (ship-exclusive) is a SEPARATE later system (see Section 8).

### 1a. Per-hull loadout (all 10 hulls; weapon hardpoint counts are first-pass TUNABLE)

| Hull | Spec | Weapon hardpoints | Spec Utility Slot |
|---|---|---|---|
| Destroyer | Tactician | 5 (most, glass cannon) | yes |
| Battleship | Tactician | 4 (2nd, it tanks) | yes |
| Carrier | Tactician | 2 (fewest, offset by drones) | yes |
| Cruiser | Explorer | 3 (best-armed Explorer) | yes |
| Survey Vessel | Explorer | 2 | yes |
| Medical Transport | Explorer | 2 | yes |
| Runner | Prospector | 2 (best-armed Prospector) | yes |
| Hauler | Prospector | 1 | yes |
| Prospector (Miner) | Prospector | 1 | yes |
| Freighter | General | 1 (civilian baseline) | none |

Only 4 hulls exist in code today (Freighter + the 3 Prospectors). The 6 combat/Explorer hulls arrive
with 0.12.0. Future ship tiers/rarities may add hardpoints (fleshed out at higher ship tiers).

### 1b. Standard-Issue baseline + the "3 varieties" rule

- Every ship's equipment slots ship **filled with Standard-Issue gear** (the neutral, craftable default).
  A ship is **not dispatchable unless every equipment slot is filled** (Standard minimum). Modules and
  weapons are EXEMPT (optional). Ship-building folds the default-equipment component cost in at a small
  discount, with a "build without default equipment" option that warns the player.
- **Every non-weapon, non-module slot offers 3 item varieties** that do largely the same job but with
  quirks favoring different specs (the playstyle wiggle-room). Weapons and modules are singular per type.
- Achievement seed: **"Pacifist"** (complete 10 Rank X prospecting runs solo, unarmed).

---

## 2. Stat vocabulary

**Flat vs percent split:** capacity stats are FLAT additive (counts); efficiency/multiplier stats are
PERCENT via the diminishing curve (Section 2a). Tune later; handle specific stats manually if needed.

| Group | Stats | Flat/% | Maps to (existing field or new) |
|---|---|---|---|
| Logistics | Cargo Capacity | flat | `cargoCapacity` (live) |
| | Colonist Capacity, Drone Capacity | flat | new (reserved) |
| Propulsion | FTL Speed | % | `transitSpeedMult` (live) |
| | Fuel Efficiency | % | `engineEfficiency` (live) |
| | Fuel Capacity | flat | `fuelCapacity` (live) |
| | Movement Speed, Maneuverability | % | new (combat, reserved) |
| Extraction | Extractor Efficiency | % | `extractionYieldMult` (live) |
| Crew | Crew Stations | flat | new (reserved) |
| | Crew Efficiency | % | new (reserved) |
| Sensors | Short-Range Sensors, Long-Range Sensors | flat/% | new (reserved). Short = local event/encounter detection; Long = survey/exploration reach. Also: high Sensors shave extraction TIME (find faster). |
| | Sensor Efficiency | % | new (reserved) |
| Power | Power Output (Reactor implicit) | flat | new. |
| | Power Draw (per item attribute) | flat | new. Sum of draws must fit reactor Output. |
| Offense | see Section 6 (combat) | | |
| Defense | see Section 6 (combat) | | |

**Two ship-level budgets (both intrinsic per-item attributes, not rolled affixes):**
- **Mass:** heavier gear drags the speed group (Movement, Maneuverability, Fuel Efficiency, FTL Speed).
  Fought by propulsion. A "lightweight materials" affix that reduces mass is a desirable roll.
- **Power:** each item draws power; total draw must fit the Reactor's Output. In 0.11.0 gear is low-draw
  so the budget rarely binds; it becomes a hard constraint in 0.12.0 when high-draw weapons land ("no
  reactor headroom, can't fire everything").

### 2a. Plus-to-percent curve (for percent stats)

> **boost% = B x (1 - r^plus) / (1 - r)**, with per-stat tunables B (per-point base) and r (decay).

Example B = 1%, r = 0.98: +1 -> 1.00%, +2 -> 1.98%, +3 -> 2.94%, asymptote B/(1-r) = 50%. Reproduces
the "+1 gives 1%, +2 gives 1.98%" intent. Per-stat B/r let each system have its own ceiling and
steepness. Flat stats add directly, no curve.

---

## 3. Rarity model

**RARITY** (Junk-to-Celestial ladder) and **QUALITY** (0-5 purity axis, Section 4) are TWO separate
axes. Every item has both.

**Base rarities (linear):**

| # | Rarity | Color | Craftable in 0.11.0? |
|---|---|---|---|
| 1 | Derelict | gray | no (drop-only, no drop source yet) |
| 2 | Standard | white | yes (craft floor) |
| 3 | Augmented | green | yes |
| 4 | Stellar | blue | yes |
| 5 | Radiant | purple | yes (craft ceiling) |

**Legendary-class rarities** (parallel flavors at the SAME power tier; proc up from Radiant via
crafting talents; held for 0.11.0):

| Rarity | Color | Identity |
|---|---|---|
| Luminous | gold | a UNIQUE legendary affix (build-defining; specs build around it) |
| Constellar | red | set bonuses (2/3/5-piece; ~18 sets across 9 hulls + generics, a living content pipeline) |

**Ascension states** (apply ONLY to Luminous/Constellar; each has its own text effect; held):
- **Nova** (supernova text effect): CRAFTED via talent proc + higher-quality materials. Higher roll
  range + 2 Luminous-effect stats guaranteed. Forms: Nova Luminous, Nova Constellar.
- **Celestial** (its own celestial text effect): DROP-ONLY, above Nova, cannot be crafted/sold. Highest
  rolls + all Luminous-effect stats guaranteed; Celestial Constellar carries the set-warping ultimate
  (reduce set piece requirement by 1 while keeping all bonuses). Forms: Celestial Luminous, Celestial
  Constellar.

Data model: base-rarity enum + an ascension field (none/Nova/Celestial), ascension only ever non-none on
Luminous/Constellar. Per-rarity fancy tooltip designs (fancier as rarity climbs) are a tabled future UI
pass; colors are locked now.

**Affix richness by rarity** (numbers TUNABLE):
- Standard(Common): 1 implicit + 2 affixes.
- Augmented(Uncommon): 2 affixes + ~25% chance of a 3rd.
- Stellar(Rare): 3 affixes + 10% chance of 1 secondary bonus.
- Radiant(Exceptional): 3 affixes + 1 guaranteed secondary + 25% chance of a 2nd.
- Luminous: 3 affixes + 2 secondaries + a unique legendary affix + 25% chance of the Artisan effect
  (+50% min roll, +25% max roll on one random affix).
- Constellar: as Luminous but the 2nd secondary is replaced by set bonuses.
Implicit count varies per slot (e.g. Hull = Hull Strength + Ablative Integrity + optional auto-repair;
Shield = Capacity + Recharge Rate).

---

## 4. Quality axis (0-5)

Separate from rarity. Displayed as **0-5 icons** (universal, no per-category names; backend handles the
effects). Every item (raw, refined, component, gear, ship) has a quality.

- **Quality rolls compound and are rare.** You always start at quality 0 (baseline). Each step up is a
  rare compounding roll (placeholder ~1/1000/tier, compounding, up to 5). Rate is TUNABLE against gather
  volume; "higher quality = higher purity = needs less material" is the natural balancing lever.
- **Material quality/rarity gate the craft:** material rarity caps the craftable gear rarity (a Radiant
  item needs Radiant-grade materials, which only better/later missions provide); material quality feeds
  the crafted quality and the rarity-upgrade odds.
- **Prospector build influences drops:** Sensors/discovery -> rarity chance AND faster find (less
  extraction time); Extractor Efficiency -> quality; a separate roll -> quantity. So a better prospector
  ship finds better materials (the prospector-to-warship long loop).
- **Quality's mechanical effects:** (a) compounds the item stat budget (Section 5); (b) durability
  (higher quality = ~+100% durability and -10%/rank chance to lose a durability point on a damage event,
  -50% at Q5); (c) feeds the rarity-upgrade roll.

---

## 5. Item-generation pipeline

Item level (iLevel) drives a stat budget; quality and rarity multiply it; a per-item ratio distributes
it across stat lines that roll from weighted affix pools. **All numbers TUNABLE and balanced together in
the balancing phase via the play-simulator (compounding math cannot be balanced by eye).**

**iLevel (additive, modest, capped by item tier):**
> `iLevel = min( craftingLevel + Sum(+5 per achievement) + optionalFAtalentBonus , itemTierCap )`
- A single unified **Crafting Level** (refining + fabrication + ship-building + all equipment) earns XP
  per completed production job scaled to the item's tier/cost (so leveling comes from meaningful builds,
  not cheap-craft spam). This is the fast, player-controlled lever.
- Item tier is the CEILING (a T1 frame cannot exceed T1's iLevel cap; higher-tier recipes raise it).
- Achievements add flat +5 iLevel. FA level is an OPTIONAL talent bonus, never a multiplicative base
  (slow input as a multiplier drags the whole thing). Rule: no slow input as a multiplier.
- Kept additive on purpose: iLevel already feeds a heavily multiplicative budget pipeline; stacking more
  multipliers into iLevel itself double-compounds and is unbalanceable. Big satisfying numbers come from
  the budget conversion, not from iLevel.

**Budget stage (multipliers COMPOUND; example numbers, all placeholder):**
1. Base budget = iLevel x perLevelBudget (example ilvl 10000 x 2 = 20,000).
2. Budget-upgrade talents applied first.
3. Quality x1.1 per rank (0-5), compounding.
4. Rarity x1.15 per base tier (Derelict 0 ... Radiant 4; craft caps at Radiant).
5. Legendary-class/ascension (only if it procs): +20% Constellar/Luminous, +25% Nova. Celestial its own,
   drop-only.

**Statting stage:**
6. Each stat line = final budget x its per-item ratio (ratios sum to 1.0; differ per item type AND per
   rarity, since rarity sets the line count).
7. Each line rolls its affix from the item's WEIGHTED pool (common affixes weighted up, strong ones down
   so they cannot stack into something busted).
8. Damage + implicits are hard-set per item, scaled by rarity/quality as SUMMED multipliers (not
   compounded); DPS derives from damage x fire rate x projectiles x accuracy.
9. Durability set per item (see Section 4). Repair costs a % of the craft materials; full repair needs a
   Shipyard; combat drives durability loss (so 0.11.0 stores durability but it never drops until 0.12.0).

**Balance intent:** the Standard-vs-top-rarity budget gap should end up wherever FEELS right (not an
accidental 4x); iLevel and budget multipliers are tuned in tandem. Juicy big numbers can also come from
outside item stats (lifetime totals, score, credits) that do not destabilize combat balance.

---

## 6. Combat (0.12.0)

### 6a. Weapon families and the triangle

Three families, each a distinct combat PHILOSOPHY. Triangle multipliers +10% / 0% / -10% (great /
neutral / weak), kept modest so weapon-type is a lever, not a hard-counter tax.

| Family | vs Shields | vs Armor (Hull) | vs Drones | Identity |
|---|---|---|---|---|
| Particle | +10% | -10% | 0% | energy damage |
| Kinetic | 0% | +10% | -10% | mass damage |
| Electronic Warfare (EW) | -10% | 0% | +10% | disruption + DoT-favoring; the anti-drone leg |

(Old "Flak" was kinetic tech, so it is not its own family; the anti-drone role is EW's. Flak Cannon and
Point-Defense live in EW. TODO: give Flak Cannon a real EW aspect so it is more than a space shotgun.)

### 6b. Weapon stats

Yield (damage per projectile, min-max range), Attack Rate (attacks per tick), Accuracy (targeting),
Projectile Count. Effective DPS emerges from these. Family + type + 2 effect slots complete a weapon.

### 6c. Weapon roster

**0.11.0 defines the STATS for these 9 (3 per family) so the foundation buffs each logically; weapons
are built in 0.12.0. The rest are tabled to SUGGESTIONS as future bites.**

- **Particle (build in 0.12.0):** Plasma, Graviton, Voltaic. *(Tabled: Ion, Laser, Neutron, Hyperon.)*
- **Kinetic:** Railgun, Autocannon, Concussion Torpedo. *(Tabled: Mass Driver + variants, Breaching
  Lance, Seeker Torpedo.)*
- **Electronic Warfare:** Point-Defense Array, EMP Cannon, Tachyon Burst Emitter. *(Tabled: Flak Cannon,
  Microwave Emitter, Signal Jammer, Proximity Cluster Mines, Viral Lance.)*

Locked weapon identities (for the tabled ones, so the vocabulary survives):
- **Plasma:** strong Plasma Fire DoT (breadth traded for one heavy burn).
- **Neutron** (endgame, discovery-gated): light irradiation DoT + a disruption; at Rank X, on proc,
  50% "caught in bombardment" then 75% death on a random senior crew member (radiation ignores hull,
  kills crew). The feared anti-crew weapon.
- **Ion:** weapon disruptions (ionization fouls firing systems).
- **Graviton:** engine disruptions (gravity drags the drives).
- **Voltaic:** anti-shield specialist: bonus shield damage, shield disruptions (Emitter Overload /
  Capacitor Failure), chains across targets (anti-swarm), NO bleedthrough (weak vs hull once shields
  drop).
- **Laser:** reliable, high accuracy, no DoT.
- **Hyperon** (endgame, discovery-gated, Radiant rarity floor, expensive craft): strange-matter beam.
  Increased shield damage (hard to deflect) AND far better hull damage than a normal particle weapon
  (destabilizes matter), at the cost of a sharp accuracy debuff vs drones. High yield, slow, NO
  disruptions, heavy Mass + high Power Draw. The team-synergy glass cannon that leans on allied
  disruptions. Lore: strange quarks unmake matter; hyperons decay inside the target dumping energy
  beneath the armor; exotic matter is hard to shield.
- **EMP Cannon:** drone damage + stuns the drone + power/system disruptions.
- **Tachyon Burst Emitter** (EW, moved out of Particle): great vs drones AND buffed vs shields (a
  deliberate exception to EW's shield-weakness), sensor disruptions.
- **Autocannon:** low yield, high rate, sustained hull DPS, no disruptions.
- **Railgun:** high yield, mid rate, high accuracy, armor penetration + Targeting Drift.
- **Concussion Torpedo:** heavy volatile warhead; high yield, low rate, low-mid accuracy, + Coolant Leak.
- **Seeker Torpedo:** guided, low yield, high accuracy, tracks evasive targets.
- **Mass Driver** (tabled, endgame-ish): dense hypervelocity slug; MEDIUM yield (not explosive), very
  high accuracy, Long range, no splash, useless vs drones. Hollow-point variant: fractures/carves the
  hull, medium yield but +hull damage, range drops to Med-Long.
- **Breaching Lance** (tabled, Mass Driver breaching penetrator): lodges in the hull, cracks its four
  front panels, vomits cluster charges that detonate inside, initial kinetic + explosive AoE + Plasma
  Fire DoT. (Trojan-horse flavor in the flavor text.)
- **Flak Cannon** (EW, tabled): anti-drone bursts + Scattering Field. Needs an EW aspect (TODO).
- **Point-Defense Array** (EW): mid damage, high rate, high accuracy, Medium range; lethal to drones and
  small fast threats but does NOT hard-destroy torpedoes (that would over-centralize and kill torpedoes
  as a category).
- **Proximity Cluster Mines** (EW, research-gated): deployable smart minefield that hunts/collides with
  drones (seek-and-destroy with mobility).
- **Viral Lance** (EW, gated): cyber DoT.

### 6d. System Disruptions (one shared pool)

Each weapon has 2 effect slots (disruptions or DoTs, with intensity tradeoffs). Modules/gear can add or
change which disruptions a weapon inflicts. Builds split into generalist (spread, small chance at
everything) vs specialist (stack one, land it reliably, capitalize with the rest of the build).
Each disruption/buff carries name + flavor text + a mechanical effect line + a color.

**Ranks:** every weapon applies rank 1 on hit; subsequent hits can escalate to rank 2/3/... (cap TBD);
the escalation chance scales with the weapon's quality + rarity. Higher rank = higher proc chance AND
bigger effect. Rank 1 example magnitude ~20%.

| System | Effect | Name |
|---|---|---|
| Sensors | -accuracy | Scattering Field |
| Sensors | -range | Sensor Power Drain |
| Engines | -maneuver | Manifold Overheat |
| Engines | -speed | Coolant Leak |
| Shields | +damage taken | Emitter Overload |
| Shields | +bleedthrough | Harmonic Gap |
| Shields | -recharge | Capacitor Failure |
| Weapons | -damage | (name pending; grounded in defocus/aperture; "Power Sag"/"Emitter Fatigue"/"Coil Dampening" on the table) |
| Weapons | offline chance | Weapon Jam |
| Weapons | -accuracy | Targeting Drift |
| Drones | -attack rate | Inhibit |
| (DoT) | burning over time | Plasma Fire (+ future hazards: irradiation, etc.) |

Category name: **System Disruptions**.

### 6e. Elements/families are damage-type + resist

Defense resistances are DUAL-purpose: a resistance cuts both incoming DAMAGE of its type AND the chance
+ rank of that type's disruptions landing. Counter-building is real (no neutron resist into a neutron
crew = death). Defense gear rolls two knobs per type: damage resist and disruption resist. Shield lines:
capacity, recharge, bleedthrough %, bleedthrough resist, per-type shield resist. Hull lines: strength,
ablative armor (flat energy reduction), kinetic dampening (flat general kinetic reduction), per-type
hull resist.

### 6f. Range bands + encounter flow

Three bands (Long/Medium/Short). Encounter sequence:
1. "Entered sensor range of enemy vessel" (Sensor Range sets detection distance).
2. "Course set to intercept" (engine/speed sets closing rate).
3. "Powering and preparing weapons" (readying phase, so a weapon fires the instant its band opens).
4. Opens at very long distance; distance closes per tick.
5. Each weapon comes online as closing distance enters its band; the longest-range weapon in range fires
   the opening salvo instantly (only that one); shorter guns join as you close.
6. Being out-ranged is punishing (enemy fires during your approach while you cannot answer). A
   short-range brawler must survive the walk-in.

Combat is **fleet-scale, multi-ship** (1 to several ships per side). The display is **phase-driven**
(narrates detection -> intercept -> weapons-ready -> firing), shows **weapon-range indicators for both
sides** during intercept, and shows **enemy composition**. All mockup-gated spatial UI.

**Combat appears in ALL mission types** (patrols, escorted prospecting), which is why sensors matter
fleet-wide and weapons are universal slots.

### 6g. Two-tier combat

- **Tier 1, Battle Power auto-resolve:** combat in the mission flow resolves as a % chance from combined
  Battle Power vs the requirement (idle-friendly, escort-able, escape-not-death at low tiers).
- **Tier 2, Battlespace:** the full interactive range-band tactical model (Skirmishes/Wargames,
  Campaign, Fleet Exercises, Invasion). The 4 modes move INTO the Operations tab as a second section,
  freeing the leftmost tab for a Dashboard/Welcome screen.

**Battle Power = two numbers** (resolving the "25000 loses to 3000" matchup problem):
- **Battle Rating** (stable scalar): weighted composite of your combat stats. Opponent-agnostic, your
  "how geared am I" number you can hold in your head.
- **Engagement Forecast (%)**: shown at mission-select vs a SPECIFIC enemy; runs your build vs theirs
  through the real matchup (elements, resists, disruptions, range) to predict success honestly.

**Dispatch Once / Dispatch Repeatedly:** a send-off toggle slotted into ALL mission types (today
everything repeats-until-recall; a run-once option is critical for Rank X missions you dare not leave
unattended).

### 6h. Missions require captain counts + Battle Power

Missions specify captains needed (1 to 10); combined Battle Power sets the odds. Patrol = 1 captain,
faces 1-2 foes. Escort convoy = 3 captains. High-rank prospecting lets you send combat ESCORTS to
protect the prospector.

### 6i. Difficulty tiers (Rank I-X)

Escalating reward multipliers (XP, credits, drop rates, unique combat commendations) AND enemy quality,
formations, and AI (Rank I dumb, hits your tank first; Rank X focus-fires support, targets weak links,
runs anti-you builds).

**Destruction and death table (TUNABLE):**

| Tier | Ship destroyed at 0 hull | Crew death each (if destroyed) | Captain |
|---|---|---|---|
| I-III | 0% (disabled only) | none | escapes |
| IV/V/VI | 50% | 10% / 20% / 30% | escapes |
| VII | 100% | 40% | escapes |
| VIII | 100% | 50% | 10% death |
| IX | 100% | 60% | 25% death |
| X | 100% | 75% | 50% death |

- Disabled = fine (crew repairs and limps home, or a distress call brings aid). This is the "escape pod"
  design realized.
- Mid-battle hazards (e.g. a Neutron hit to an unshielded section) roll crew incapacitation at half the
  destruction death-rate (50% caught, then a death roll; eventually crew-stat-based).
- **Captain death (Tier VIII-X only) = the slot is cleared, recruit a fresh captain.** This is a
  CONSCIOUS reversal of the earlier "no captain death" note (logged when the user asked to weigh it at
  combat-design time; that time is now). Requires a loud opt-in confirmation (UX requirement).
  - HARD PREREQUISITE (minefield): captain removal breaks the length-derived captain-id scheme
    (`nextId = captains.length + 1`, safe only while append-only). Migrate captains to a monotonic id
    counter (like `nextShipId`) BEFORE captain death ships, or saves corrupt.

---

## 7. Crew & Command (deferred epic; vocabulary only)

Depends on the crew system + combat existing. Logged whole so it is not relitigated.

- **Crew stats (easter egg, Star Trek CCG 1E):** Strength, Integrity, Cunning + Constitution (the 4th, a
  Constitution-class nod). Static low numbers (1-9), leveling grants points.
- **Crew rarity:** the gear ladder (maybe capped below Celestial; pivotal-moment/milestone upgrades a
  possible unlock).
- **Ship stations:** First Officer, Tactical, Helm, Operations, Medical, Engineering, Security + custom
  per hull. Each officer has a required posting.
- **Recruiter's Office (facility):** hands you fresh CADETS who level WITH you (no recruiting high-level
  crew early). A later Fleet Admiral talent unlocks TRANSFER-REQUEST commissioned officers with
  pre-rolled rank/rarity. Also recruits REPLACEMENT captains after death.
- **Traits:** help with anything in the game; exclusive bonuses are what make crew invaluable (e.g.
  "Hardy: +10% damage to boarding parties"). Sprinkle general ones, but include rare/exclusive.
- **Senior Staff:** a bound "equip", follow a captain across ship transfers, assigned to stations for
  their bonuses, CANNOT go on ground assaults. Send them on training exercises for XP + random
  role-relevant personal milestones (e.g. medical healing 1,000,000 teammate damage).
- **Promotion ranks** (colored to the rarity ladder, earned via milestones): Cadet (gray), Ensign
  (white), Lieutenant Junior Grade (green), Lieutenant (blue), Lieutenant Commander (purple), Commander
  (orange), then Captain (special quality graphic; each rarity color gets its own escalating effect).
- **Prestige/retire loop:** a Captain-rank Senior Staff member can retire your current Captain and become
  the new Captain at level 1 with a **+5% compounding EXP multiplier**, inheriting the retiree's
  abilities (your starting captain's skillset is replaced by theirs). Skill-STACKING is the ONLY way
  bonuses stack on a ship (two captains' worth of a skill pushes it from rank VII to XIV). The Fleet
  Admiral gains +2.5% additive EXP per prestige. Doubles as a catch-up mechanic for high-difficulty
  crew/captain loss.

---

## 8. Modules (deferred; vocabulary only)

Ship-EXCLUSIVE slots (the existing `moduleSlots`), distinct from equipment. **Modules = a combination of
stat-stick + ACTIVE ABILITY.** A playstyle module rolls one of its associated stats (on the rarity +
quality scale) AND grants an activated skill. Seed examples from the combat pass: Interdiction Field
(with Snare folded in), Control Subverter (hijacks enemy drones). Active abilities change up playstyles.

---

## 9. Exploration + Discovery-gated Research (deferred; vocabulary only)

- **Explorer = long-duration discovery missions.** Prospector/Tactician runs take minutes to ~an hour;
  Explorer long-range missions take DAYS, with guaranteed rewards + discoveries.
- **Discovery -> Study -> Research -> Craft chain:** a purpose-built Explorer cruiser (speed, fuel
  efficiency, discovery chance, range) reaches a site and discovers an artifact (e.g. an ancient library
  text) -> a homeworld **study/translation facility** interprets it over time (reuse the timed-process
  engine) -> interpreted knowledge unlocks concepts -> which enable new refinements, fabrications, and
  eventually craftables (Hyperon weaponry is the canonical example). Research gains a DISCOVERY
  PREREQUISITE: you cannot research what you have not found.
- Studied artifacts grant **multi-tier permanent set bonuses** across systems.
- **Ship-capability gating:** Explorer mission CHAINS gate on the ship being built to reach and survive
  them, so you can SEE a mission but have no ship able to make it (drives building the specialized
  cruiser).

---

## 10. Locked prerequisites and minefields

- **Captain-id monotonic migration** BEFORE captain death (Section 6i). Hard prerequisite.
- **Two mission-tick code paths:** equipment stats must route through both `tick()` and the live
  `App.svelte` loop (or a shared helper), with an offline-parity test. Ship stats already fell through
  this crack once (fixed in `9fc67a6`); equipment is the next at-risk category.
- **Affix-roll offline parity:** the craft-time random affix roll must draw from the deterministic/seeded
  offline stream (same discipline as the resourcefulness bonus-roll + Completions free-output seam).
- **Cargo-as-true-cap must stay closed-form:** decouple guaranteed haul from cap, clamp returns at cap
  with headroom, never a stop-when-full RNG timer.
- **Allocation `free` model:** equipment crafting is a new material consumer; route through the
  reserve-aware spend the Fabricator uses.
- **Server-authoritative anti-tamper** (multiplayer era): equipment carries a unique id NOW + a reserved
  `integrity` field; the server mints/validates later (client-side is forgeable).
- **Balancing tool:** the play-simulator (logged in SUGGESTIONS) is how the compounding item-gen /
  quality / rarity math gets calibrated; do not tune by eye.

---

## 11. Naming registry (locked)

Rarities: Derelict, Standard, Augmented, Stellar, Radiant, Luminous (gold), Constellar (red), + Nova /
Celestial ascensions. Quality: 0-5 icons. Slots: Cargo Bay, FTL Drive, Reactor Core, Cockpit, Quarters,
Thrusters, Sensor, Shield Emitters, Hull Plating, **Propellant Tanks** (fuel; multi-fuel future), Spec
Utility Slot. Weapon families: Particle, Kinetic, Electronic Warfare. Weapon of note: Breaching Lance,
Hyperon, Neutron, Voltaic, Tachyon Burst Emitter, Concussion Torpedo, Proximity Cluster Mines. Crew
stats: Strength, Integrity, Cunning, Constitution. Facilities added: Recruiter's Office, study/
translation facility. Difficulty: Rank I-X (themed set on the table: Routine/Skirmish/Contested/Volatile/
Hostile/Perilous/Dire/Grave/Cataclysm/Apocalypse). System names available in SUGGESTIONS.
