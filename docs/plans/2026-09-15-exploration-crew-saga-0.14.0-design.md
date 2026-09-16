# Exploration + Crew Saga — 0.14.0 and beyond (living design doc)

Status: BRAINSTORM CAPTURE (2026-09-15). Not a build plan yet. This is the consolidated home for
the Exploration and Crew vision: the live brainstorm from this session plus every exploration- and
crew-flagged item scattered through SUGGESTIONS.md, in one structured place so we design against a
document instead of a scroll-back.

Decision tags used throughout:
- **[LOCKED]** = the user stated it directly. Do not relitigate.
- **[PROPOSED]** = Claude's suggestion, awaiting the user's call.
- **[OPEN]** = a real fork that needs the user's decision before build.

Hard rules that carry into this doc like everywhere else: propose freely, decide never; US English;
no em dashes; verify against source not memory.

---

## 0. The one-paragraph vision

The jump gates are gone. Crossing real distance is slow again, and the frontier of allies and
resources keeps receding. **Exploration** is the release where you build purpose-made long-range
ships, staff them with a proper crew, and push out into that frontier. It rests on two new pillars
that reshape systems you already have: **fuel stops being a grindable resource and becomes a range
stat (reach)**, and **crew becomes a real system in two tiers (a slotted Senior Staff and a
population-scale complement)**. Exploration's combat is not ship-to-ship; it is the Trek-style
**away team**. The whole thing is a multi-release **saga**, not a single patch, and much of the crew
half improves the game you already have, so it can ship in stages.

0.14.0 = Exploration is now a **[LOCKED]** roadmap decision (user, 2026-09-15). Roadmap sequence:
0.13.5 Presentation (shipped) -> 0.13.6 Item Lifecycle (in progress) -> **0.14.0 Exploration** ->
0.15.0 Story/Tutorial/Help -> 0.15.1 Accounts + Cloud Save -> 0.16.0 Online.

---

## Part A — Fuel becomes Reach (the propulsion rework)

### A.1 The problem this kills [LOCKED]
Today fuel is a stockpile (`state.fuel: Decimal`) you top off by keeping a captain on the free
`localFuelRun` skim mission to mine Deuterium Ice, which auto-refines into fuel. Refining is already
zero-click; the pain is the **captain permanently on fuel duty** plus the softlock-shaped experience
when ice and credits both run dry. The user has said repeatedly: it does not feel good, and it is
hard to justify past realism. (Source map of the current system: this session's fuel/deuterium
survey; key files `fuel.ts`, `tick.ts` `processFuelPipelines` ~9655, `model.ts` `localFuelRun` ~409.)

### A.2 The model [LOCKED direction, details PROPOSED]
Fuel stops being an inventory you manage and becomes a **derived range stat, "reach"**:
- An engine + a fuel-capacity module give a ship a **reach** (how far it can travel on a full tank).
- Every destination/mission has a **distance** (its transit legs).
- If reach covers the trip, you can go; if not, you cannot. **You refuel for free at home.** There is
  no per-trip cost and no chore.
- The substrate already exists: `fuelCapacity` is a per-ship folded stat, `engineEfficiency` folds
  from the loadout (a heavy fitment already drags it down, floored at -0.9), and hulls carry
  `transitSpeedMult`. Today those feed a depleting tank; the rework expresses the same three levers
  as **range** instead of **inventory**.
- This is a net **deletion** of complexity: the tank, the refinery pipelines, the ice grind, credit
  auto-buy, and the shared-tank threading in `economyTick` all go away.

### A.2b Why fuel exists at all (design intent) [LOCKED, user 2026-09-16]
The user reached the same conclusion the fuel/deuterium map did (fuel-as-a-grindable-resource feels
bad), and settled the "should fuel even exist" question by REVAMPING rather than removing it: **"If
you build a system, and then find it feels so bad you have to gently bypass it to make it feel
remotely good, you have a problem with that system."** So the auto-mining idea is dropped, and fuel
survives ONLY as a stat. Its job: **make the right ships get used for the right actions early on,
then let the player choose their own path as the account matures.** Concretely, it is a soft gate on
REACH: send a combat captain on a long-distance mission and the ship makes it halfway and everyone
dies, so early on you fly explorers to explore and warships to fight; later, higher-tier hulls and
propulsion systems buy enough range to blur those lines by choice. Refuel is INSTANT and free at
home; there is no refining, no mining, no stockpile. This is a firm reversal of any "rip fuel out"
option and confirms fuel STAYS (as reach).

### A.3 What makes it a system and not a level-check [PROPOSED]
Reach must trade against everything else through a shared **power grid / mass budget**. A bigger fuel
capacity or a hotter engine costs power and mass that competes with weapons, shields, cargo, and
sensors (see the archetypes in B.4, which are defined by exactly this tradeoff). The relativity lore
makes the curve: **E=mc^2 still applies, but by this era humanity has learned to LESSEN the m value**,
so reaching FTL no longer needs infinite energy. What remains is that pushing velocity up costs power
EXPONENTIALLY, so a hull tuned for distance is balancing velocity against stamina to go further than
anything else. The "approaching c costs exponentially more" curve gives conventional drives a soft
ceiling they cannot brute-force, a clean late-game / prestige hook (ties to the First Cause /
Dimensional Traversal north-star: the way past the wall is new drive tech or something beyond it).

### A.4 Deuterium's new role [PROPOSED]
Deuterium becomes the **crafting input for reach**: the fusion fuel you mine to build high-capacity
drives, efficient engines, and reactor cores (the `reactorCore` slot already exists). You mine it to
*build* range, not to *top off* a tank, so mining stays meaningful without being a chore. Retiring
deuterium entirely is the alternative; this is the version where nothing feels bolted on.

### A.5 Reconciliation with already-logged fuel items [OPEN]
Two SUGGESTIONS entries were designed around fuel-as-consumable and must be reconciled with
fuel-to-reach:
- **Multiple fuel types tied to ship ranking** (SUGGESTIONS ~64): "every ~2 rankings needs new fuel;
  top rank needs specialized fuel." Under fuel-to-reach this most naturally becomes **drive-tech
  tiers / reach classes** (a higher-rank hull needs a more advanced drive to reach farther), not
  multiple consumable stockpiles. OPEN: keep multi-fuel as consumables, or fold it into drive tiers.
- **Automated fuel gathering + auto-refinery** (SUGGESTIONS ~69, was tentatively 0.13.6): if
  fuel-to-reach wins, there is no stockpile to auto-gather, so this item is largely **subsumed**. The
  auto-mining-facility and explorer-mission-creates-a-facility angles can survive as deuterium
  *crafting-material* sourcing instead. OPEN below (A.6).

### A.6 Timing: fuel-to-reach ships in 0.13.6 [RESOLVED, user 2026-09-16]
**Pulled INTO 0.13.6** (reversing the earlier "wait for exploration"). Reason: the fuel-duty captain
is a live pain point now (colleagues who play HL: "fine at best," and "annoying that one of my
captains has to stay there and is a far lower level as a result"). So the propulsion REWORK (fuel
becomes reach, instant free refuel, no mining/refining/stockpile) lands in 0.13.6 using the EXISTING
hull stats. What STAYS in 0.14.0: the new explorer/warship HULLS and the archetype power-grid TUNING
(B.4) and the deuterium-as-reactor-crafting-input economy (A.4). So 0.13.6 = the mechanic; 0.14.0 =
the content and tuning that lean on it. See the dedicated 0.13.6 build plan (to be written once the
peripheral decisions in "0.13.6 scope decisions" below are set).

### A.7 Open knobs [OPEN]
- **Round-trip vs stranding:** can a ship reach a place it cannot return from (one-way / colony
  mechanic), or is round-trip reach always required?
- **Refuel timing:** is "refuel at home" instant, or a short turnaround?
- **Maneuverability:** does it become a real combat axis (evasion / hit chance) or stay flavor?

---

## Part B — The Explorer archetype and the roster axis

### B.1 The class fantasy [LOCKED]
A fusion of the Enterprise-D and USS Voyager: the size and survey capability of the Enterprise with
the frailty of Voyager. A **marathon runner, not a sprinter** — fast in a straight line at a cruise
equilibrium, but sprinting hits the exponential cost wall, and it maneuvers "like a sloth stuck in
cement." Massive power generation, almost none of it spent on offense. Weapons are **utility/science**
(the phaser-as-drill relieving tectonic stress), fine against underpowered/disorganized foes and
overmatched by anything organized. Huge shields and sensors; a frail hull that is "a pre-beaten
piñata" the instant the shields drop. Chock full of supplies for long trips and long tasks.

### B.2 Mapping to actual stats [PROPOSED, grounded]
The combat model already keeps hull and shield as **separate pools** with a shield-recharge stat
(`combat/bridge.ts` ~626: `hull/hullMax`, `shield/shieldMax`, `shieldRecharge`; plus `ablativeArmor`
and `kineticDampening` affixes). So the glass-tank explorer is expressible today:
- **Reach:** high `fuelCapacity` + tuned `engineEfficiency`, expressed as range.
- **Speed:** high `transitSpeedMult` (straight-line), poor maneuverability (see A.7).
- **Defense:** huge `shieldCapacity` + recharge, minimal `hullIntegrity`.
- **Offense:** low kinetic output; weapons carry utility/survey uses instead.
- **Sensors:** a **new stat** (survey yield / detection / event quality) — exploration's "damage."
- **Hold:** big `cargoCapacity` for long-haul supplies and evacuations.
- **Reactor:** large power generation, allocated to shields/sensors/drive.

### B.3 Power allocation (the identity mechanic) [OPEN, PROPOSED lean]
The reactor's output is huge; the interesting part is where it goes. Two shapes:
- **Active reroute** ("all power to shields") — evocative but real-time micromanagement, which is
  friction the game keeps steering away from.
- **Build-time / per-mission preset** — you trim a hull for shields-and-endurance vs sensors-and-speed
  when you outfit it or assign the survey, then it runs itself.
PROPOSED lean: the preset version, to protect the peace pillar. User's call.

### B.4 The roster axis: a shared POWER GRID [LOCKED archetypes, user 2026-09-16]
Every hull is defined by how it divides ONE power grid across weapons / shields / drive-and-range /
cargo. That single tradeoff is what makes fuel-as-reach a real choice and gives each class its feel.
The archetypes the user locked (lore-justified; specifics of the lore withheld but the mechanics are
firm):
- **Destroyer** — the anti-capital striker. Diverts so much of the grid to WEAPONS that little is
  left for anything else, so it takes a cut to SHIELD capacity + recharge relative to a battleship.
  A well-equipped destroyer is what you bring to take a battleship down.
- **Battleship** — a tanky behemoth: heavy shields/hull, decent (not spike) firepower. Takes a
  powerful, well-equipped force to bring down. The tank pole.
- **Explorer** — power-RICH by design (the survey/long-range hull). Because unexplored worlds sit so
  far out that an ordinary ship runs out of energy before arriving, an explorer spends huge power to
  balance velocity against stamina, giving it (1) by far the longest RANGE and (2) the strongest
  SHIELDS in the fleet when that reserve is redirected to them. Also better-than-normal CARGO (long
  trips need supplies). Weapons are terrible; it can take a serious beating, but once the shields
  fall the hull is papier-mache. See B.1/B.2 (this is the glass-tank fantasy, now grid-justified).

The explorer's tradeoffs only READ as choices because the destroyer/battleship poles exist to
contrast it. Broader roster buckets still to place (SUGGESTIONS ~664): Carrier; Explorer sub-types
(Cruiser / Survey / Medical transport, the crew-landing hull); with Explorer/science hulls carrying
MORE module slots as identity. OPEN: the full roster list + exact stat numbers (a tuning pass).

---

## Part C — Crew (three interlocking layers)

Grounding: `bridge` and `quarters` are already **reserved** `EquipmentSlotType` members with no
definition yet (`model.ts` ~1361), and a captain system with a talent tree already exists
(`CaptainState`, `CaptainTalentDef`). Senior Staff generalizes the captain concept onto `bridge`; the
complement is what `quarters` was reserved for.

### C.1 Senior Staff — deterministic, few, high-impact [LOCKED]
A secondary equip layer of "chief officer" slots (Trek bridge-officer analogue), universal on every
hull because even a destroyer needs a Science officer (cloak detection) and even an explorer needs a
Weapons officer. Each officer carries real stats that modify ship operations. The **bridge module**
becomes a stat-bearing piece that scales officer effectiveness, finally giving that reserved slot a
job. Behaves like the Armory: a handful of slotted, hand-curated, named entities.
- **Role roster [LOCKED names so far, PROPOSED palette for the rest]:** Pilot/Helm, Science (sensors),
  Weapons/Tactical, Medical, Engineering, Executive Officer, and an Operations (logistics/cargo) seat
  the user floated as "Ops, but maybe a better name." "perhaps additional" left open.
- **[OPEN]** final roster and whether **caps differ by hull** (a warship carries more Security; an
  explorer more Science/Engineering).
- Ties in the **Crew & Command** vocabulary already logged (SUGGESTIONS ~106): officer stats
  (Strength/Integrity/Cunning/Constitution), stations, a Recruiter's Office, traits, promotion ranks,
  and a prestige/retire loop. Also the older Crew-system note (SUGGESTIONS ~290): role/seat buffs a
  specific ship system (a Weapons Officer specializing in a weapon type), with some roles useful
  pre-combat (Engineering buffing the drive or crafting) and some pure combat stubs until Battlespace.

### C.2 Crew Complement — stochastic, hundreds, tiny stacking bonuses [LOCKED]
The rank-and-file, the opposite kind of system from Senior Staff, and that difference is the design.
- Randomly generated: **name, race, gender (all kinds), rarity, racial bonus, random profession,
  random bonus.** Junior officers and crewmen. Tiny bonuses like "+0.20% cargo unloading during
  prospecting missions."
- **Managed as an aggregate, not individually.** You cannot hand-place 1,017 people, so bonuses roll
  up into ship-level modifiers and you manage by policy (auto-assign, sort, mass-action), plucking out
  standouts. **[LOCKED]** the player can randomize + auto-manage, or curate carefully; auto is the
  default and the peace-preserving path.
- **Transports of new crew** arrive periodically, entirely random (a gentle gacha influx feeding the
  pool).
- **Per-ship complement size + per-type caps.** Different ships carry different complements and
  different caps by type: a combat ship has room for **Security** (boarding parties, protecting
  sensitive systems); an explorer carries more **Science / Engineering** (keep the ship in tip-top
  shape so it does not run out of energy en route). Not a dozen — **hundreds**. One large long-range
  explorer is to be hardcoded to a complement of **1,017** plus a full crew capacity, so big explorers
  can also run lightning-fast short-range missions with enormous evacuation space (see C.3).
- Absorbs already-logged crew depth (SUGGESTIONS ~618): **leveling + rank-up** (roughly 1-10, buff
  improves with rank), **augmentation / cybernetics** (a crafted item class, per-crew equip slots, a
  third bonus layer on top of captain talents + ship equipment), and **crewCapacity / maxCapacity**
  ship stats that FUTURE evacuation/transport/colony missions gate on.
- Absorbs the **unload-time-scales-with-cargo + crew** balance item (SUGGESTIONS ~78): the basic fix
  scales `unloadTicks` by `cargoCapacity / base` inside `effectiveMissionDef`; the bigger system is
  crew-on-a-task speeding that task (crew allocation locks when a mission starts). Bundle the
  unload-scaling WITH crew complement so they tune together.

### C.3 Refugees -> facility crews [LOCKED]
Evacuation missions (a peacetime job for big explorers) award **refugees**, who get **posted at
facilities** and act like mini-Senior-Staff, buffing that facility. This closes a loop: exploration
produces people, people improve the homeworld, and it gives large-hold hulls a reason to exist beyond
the frontier.

### C.4 Security / counter-infiltration [LOCKED deferred hook]
Security complement scales for two reasons: outward (boarding parties) and inward (finding
infiltrators/saboteurs, protecting sensitive systems on top-tier combat hulls). A later
**espionage/infiltrator content layer** is what creates demand for the larger security caps, probably
with a Science/sensors + Security interplay (sensors flag the anomaly, Security runs it down). Filed
as a future hook, not a now-build; it is the reason the caps earn their space.

### C.5 The data-scale constraint (solve FIRST) [PROPOSED, important]
1,017 crew per ship, times many ships, times full objects (name/race/gender/rarity/bonus-list) is a
real save-size and tick-cost problem for an idle game, and mobile save persistence has already been a
pain point (Combat 1.0's `SavePersistWarning` stopgap). Do **not** persist a thousand full objects per
hull. PROPOSED shape: store the complement as **aggregate stat rollups + a small roster of notable
named individuals**, and generate the anonymous rank-and-file **lazily from a seed + a count** (so
"1,017 crew" is a seed and a number until the manifest is opened). This preserves the fantasy at a
fraction of the weight and must be decided before the data model is drawn.

### C.6 Captain identity [LOCKED to 0.14.0, user 2026-09-16] (detail in SUGGESTIONS "CAPTAIN IDENTITY")
A cohesive captain-identity set rides with the Crew work in 0.14.0, detailed in the SUGGESTIONS
"CAPTAIN IDENTITY" + "ACHIEVEMENTS: THREE TIERS" entries. In brief: structured names (first /
callsign / last + an earned RANK prefix, e.g. `Captain Chad "What BodyCAM" Thundercock`); per-captain
color-coding as a PORTRAIT BORDER (color now, pattern + special effects as later achievement-unlock
cosmetics; the full-UI tint was rejected); and EARNED, captain-BOUND medals/ranks/surname unlocks
driven by the new PERSONNEL achievement tier (medals: SVG ribbon/bar, display decoupled from an
equippable bonus, hover shows name + flavor). All non-transferable between captains.

---

## Part D — Away-Team combat (exploration's combat model)

Exploration's combat is **not** ship-to-ship. It is the Trek-style **away team** — part of why crew is
going in. Consolidates the logged **Away Missions** entry (SUGGESTIONS ~941) and its family:
- You send crew on an away mission gated by **away-mission slots** filled from the crew aboard; it
  drops into a randomly generated encounter/dungeon navigated room-to-room, resolved by a **turn-based
  RPG battle system** (user: turn-based, "the only good one"), yielding strong item rewards.
- **[ARCHITECTURAL FLAG, LOCKED as a concern]:** unlike everything built so far, this is active,
  session-based, interactive play that does NOT fit the closed-form / offline-tickable model. Decide
  early how an in-progress away mission interacts with offline (freeze/resume? abandon? soft time
  limit?). This is its own paradigm bolted onto the idle loop.
- **Shared family:** design the turn-based engine + team-loadout slots ONCE and reuse across Away
  Missions, the logged **Landing Party missions** (SUGGESTIONS ~457: item slots for a planet-side
  team), and Battlespace **Invasion** ground troops. Build it once, not three times.
- The away team is a **party selector separate from ship-crew stations** (no impact on ship ops), per
  the Flagship Science-mode description (SUGGESTIONS ~119).

---

## Part E — Exploration content, discovery-gated Research, facilities

- **Long-range Explorer missions** (day-long) into the receding frontier; the "conventional FTL takes
  decades unless purpose-built" lore made mechanical via reach (Part A) — distance is the gate, the
  explorer hull is the answer.
- **Discovery-gated Research** (SUGGESTIONS ~108): a study/translation facility, discovery-prerequisite
  research, artifact set bonuses. Exploration feeds Research; some resource sourcing (deuterium, rare
  materials) can be an exploration reward, which is the surviving piece of the old auto-mining idea.
- **Sensors** (Part B.2) drive survey yield and what you find.
- **Sci-fi system names** already banked (SUGGESTIONS ~111): Kepler's Reach, Tycho Verge, Cygnus Gate,
  Erebus Deep, Halcyon Drift, Meridian Cradle, Vesper Hollow, Oberon Span, Calliope Reach, Nyx
  Threshold, Sable Expanse, Requiem Belt, Auric Shoals, Thessaly Run, Lyra's Wake, Cinder Marches,
  Ossuary Field, Dhole's Crossing.

---

## Part F — Relationship to the 2.0 Flagship north-star

The **Active Play / Fleet Admiral Flagship** expansion (SUGGESTIONS ~115) is the far-future 2.0 that
turns the admiral into the player's avatar aboard a personal flagship, with three active modes
(Science = the exploration minigame, Tactical = Engagements, Prospecting). Exploration 0.14.0 builds
the **vocabulary** that 2.0's Science mode plays actively: reach, the explorer hull, crew, away teams,
sensors, survey maps. 0.14.0 is the idle expression; 2.0 is the active expression of the same nouns.
Design 0.14.0 so those nouns are reusable; do not build 2.0 now.

---

## Part G — Proposed phased build order (the saga's seams) [PROPOSED]

Exploration as described is a **saga of several major releases**, not one patch. Natural seams, and
one strategically valuable insight:

**Senior Staff and the crew complement are ship-wide systems, not exploration-exclusive.** Every hull
wants a Science officer; every ship has crew. So crew can ship **before or alongside** Exploration as
an upgrade to the missions and patrols that exist today, delivering value immediately, while
away-team combat and the receding frontier come later.

A candidate ordering (all [OPEN] for the user to shape):
1. **Fuel-to-Reach + the explorer hull + roster axis** — the propulsion rework and at least one
   explorer hull and its contrast pole. This alone is a meaty release and unblocks long-range content.
2. **Crew, tier 1 (Senior Staff)** — the bridge-slot officer layer + bridge module stats. Improves the
   current game (missions/patrols), independent of exploration content.
3. **Crew, tier 2 (Complement)** — the population system + aggregate management + transports +
   the unload-scaling balance pass + crew capacity stats. Also improves the current game.
4. **Exploration content + discovery-gated Research** — long-range missions, sensors, the frontier,
   artifacts, evacuation -> refugees -> facility crews.
5. **Away-team combat** — the turn-based engine + team loadouts (shared with Landing Party / Invasion),
   with the offline-model paradigm question answered up front.
Later / 2.0: the Flagship active modes; the espionage/infiltrator layer (Part C.4).

**[OPEN, highest-leverage scope call]:** does crew (steps 2-3) ship as its own release **ahead of**
Exploration, given it improves the current game too?

---

## Open decisions to resolve before build (index)

- A.5 Reconcile multi-fuel-types with fuel-to-reach (consumables vs drive tiers).
- A.6 RESOLVED (user, 2026-09-16 + earlier): fuel-to-reach ships WITH 0.14.0 Exploration, not a 0.13.6 stopgap; the 0.13.6 deuterium-mining item is dropped (fuel is no longer mined). [Confirm if "included here after all" ever means pull it into 0.13.6; default is 0.14.0.]
- A.7 Round-trip vs stranding; refuel instant vs turnaround (INSTANT confirmed by user 2026-09-16); maneuverability real axis vs flavor.
- B.3 Power allocation: active reroute vs build-time/per-mission preset (PROPOSED: preset).
- B.4 Archetype poles LOCKED (destroyer/battleship/explorer power-grid tradeoffs, user 2026-09-16); OPEN only: the full roster list + exact stat tuning.
- C.1 Final Senior Staff roster + whether caps differ by hull.
- C.5 The crew persistence shape (PROPOSED: aggregate rollups + notable roster + lazy seed generation).
- D Offline interaction model for active away missions.
- G Does crew ship ahead of Exploration as its own release?

---

## Sources

- This session's live brainstorm (2026-09-15): fuel-to-reach, the explorer archetype, three crew
  layers, away-team combat, the refugee loop, the data-scale constraint, the security/infiltrator hook.
- This session's read-only fuel/deuterium system map (grounding in `fuel.ts`, `tick.ts`, `model.ts`,
  `combat/bridge.ts`).
- SUGGESTIONS.md exploration/crew entries: multiple fuel types (~64), automated fuel gathering (~69),
  unload-scaling + crew complement (~78), the Crew & Command / Exploration+Research epic vocabulary
  (~106-108), the Flagship 2.0 north-star (~115), the Crew system (~290), crew leveling/augmentation/
  capacity (~618), Landing Party missions (~457), Away Missions (~941), the 6 deferred hull buckets
  (~664), sci-fi system names (~111).
- Prior epic docs referenced by SUGGESTIONS: `docs/plans/2026-07-17-ship-equipment-combat-epic-design.md`,
  `docs/plans/2026-07-09-ships-stats-foundation-design.md`.
