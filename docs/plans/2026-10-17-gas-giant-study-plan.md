# Gas Giant Study (0.14.0, E-CREW Task 15b): BUILD PLAN

Status: PLAN for user review (2026-10-17). Doc only; no game code. Every name and number marked **[PROPOSAL]** is mine
and is the user's to accept, rename or reject. Sources reconciled: `2026-10-08-gas-giant-study-design.md` (sections 1,
1b, 1c), the two scratchpad mockups (`gas-giant-study-mockup.html` of 2026-10-08, `gas-giant-study-v2-mockup.html` of
2026-10-09), D22 / D23 in `2026-10-02-crew-made-real-e-crew-design.md`, E-CREW plan Task 15b and its build order,
the wiring plan (registry rules, OC-G1, OC-G2, the T3 scope move), the expedition tiers G2 plan and its answers, the
gear wear design and answers, the credit sinks pass and answers, the complement plan OC-15 (Lab tiers 3 to 7), the
relics v2 capture (2026-10-09), Material Lines draft section 3e, and the code at `34449a0`.

## 1. The user's words (verbatim; authoritative)

**D22 (2026-10-08).** "Gas Giants are a bad idea for local landing. It should only be from the ship. Probably
something like studying the gas giant, and analyzing it. Things like figuring out how close it got to becoming a star,
etc."

**Scope (2026-10-08).** "All of it in 0.14.0" (offered: foundation now and lines later; declined).

**Rewards (2026-10-08).** "the first 3 are all good ideas. Perhaps you can get one from a pool of different rewards."

**Samples (2026-10-08).** "Canisters of compressed gases. Deuterium Ice would fit this as well. Processed into a
canister-stored version. \"Gas Storage Canisters\" as the warehouse category. It's a whole new set of additional items
for crafting. Perhaps you'll be able to pull a bunch of gas, and it just happens to be a few different types of gas
that results in enough for a few different gas canisters depending on the location."

**Research data (2026-10-08).** "different types of research data that can bestow research progress. Full on specific
research data types. Plus some that can be fed into another tab within the research lab that would be used for
studying data from an ancient race that can lead to special crafting blueprints being unlocked."

**Lore home (2026-10-08).** A new **Survey Log** tab in the Archive.

**Probe (2026-10-08).** **Galileo-Class Probe**: "Because it's durable enough to go deeper into the crushing gravity
and can survive not being crushed by it. Could even involve larger and more dense gas giants, increasing that
further." Earlier: "A reinforced probe unit that can better survive the crushing gravity of a gas giant, resistant
against the intense forces and dangerously corrosive elements often found within a gas giant ... I want genuine
science behind it."

**Answers of 2026-10-09 (design 1b).**
1. Classes: "Replace that with the scientific description of what Saturn/Jupiter/Super-Jupiter classes represent, and
   add in other possible options. One being spacial phenomena like a nebula. Something real. Something you could
   gather gaseous clouds from." Ice Giant and Brown Dwarf are kept.
2. "I was thinking the research facility could do so. Where the data is collected and returned. As that data is
   collected and returned, as each one completes (kinda like a set of items that you can have your team study) you
   gain various types of things to help you. Possibly learning a new recipe for crafting (rarely), and then something
   like some of those boosts to learning different types of research. Research may be expanded as well into different
   categories and so forth. Perhaps. Might need more fleshing out, or more condensing if I'm overcomplicating it."
3. "100% gas cannisters (in a range) depending on what you're trying to get. Maybe the type of gas you can grab is
   where the % of chance to get something is (similar to regular mission drops of standard/augmented/stellar
   qualities. Gases can do this too. But in addition, you have the 40% chance of research data and the 15% survey
   readout."
4. "2 standard, 2 augmented, 1 stellar and 1 radiant. Yep, the first radiant quality option. Not a gas, but it will
   require its own specialized container to be able to store ... my thought for the radiant quality item makes sense:
   ANTIMATTER. The balancing patch will add in more options, but this is the first, and I like antimatter!"
5. The six research data types work; open to more that suit prod and in-development systems.
6. "with jump gates not going to every place, a lot of planets are unexplored. So we will want to have plenty of
   different ancient races. That as we learn more and more about them, we might change the names of artifacts. So at
   first it might be \"Relic Sample A34\" or something ... But some of these relics would match the current pool. So
   one race relic type should be able to match up with another."

**Special blueprints (relics capture 2, 2026-10-09).** "Honestly, I'm not the greatest with names!" (so I propose).

**Ancient data sources (relics capture 3, 2026-10-09).** "Yep! It depends on how the whole system works. Perhaps we
could use long-distance expeditions tiers as \"unlock [insert a large location in our galaxy] and you look around for
a new planet as part of the scan and transit time."

**Answers of 2026-10-12 (design 1c).** Tiers I to VII approved, Roman numerals everywhere. Antimatter burn: "Perhaps
those can be used to speed up the trip, but this can cause the need for a maintenance period ... Making that rare would
be good too ... we'd want to ensure that it's not overused and abused".

**Scope move (wiring capture T3, 2026-10-15).** "Move all five (Recommended)": the antimatter burn is among the five
moved to 0.14.x.

**OC-G2 (2026-10-15).** "Ship-only study (Recommended)": gas giants get the ship-side study (15b) instead of ground
objectives; no landing, no field repair there.

**D23 (2026-10-08).** "Diminishing returns will 100% come into play, but without removing the entire ability to push
past a certain point."

**Gear wear (2026-10-16).** Each gear kind wears its own way: "sensors by scans, tools by fieldwork"; "Gentle
(Recommended)": use wear stops at 60%, nothing breaks or blocks a run.

**Overtime (2026-10-16 / 17).** Pay credits to speed "a given job ... by a specific percent. Not doubling or instant
completion"; covers research; "3 steps, 10/min x tier (Recommended)".

## 2. Reconciliation (each element vs notes and code)

| Element | Notes say | Code today (`34449a0`) | Plan |
|:-|:-|:-|:-|
| No ground work on gas giants | D22, OC-G2 | `gasGiant` is in 5 PoI `planetWeights` (expeditionContent.ts 108 to 142); `assignDiscoveriesAndActivities` (expedition.ts 1357) gives it PoIs; `initGroundTasks` (groundOps.ts 675) stamps them; teams land and fight (bug B21) | GG-2: an orbital-only body gets ONE ship study and no PoIs, no hostile site, no clearing objective |
| `orbitalOnly` flag | registry row `PLANET_TYPES gasGiant:orbitalOnly` is `pending` (wiring/registry.ts 2222) | read by the UI only (ExpeditionPanel.svelte 271, 572, 633: "orbital ops", " · satellite") | GG-2 flips it to `live` in the same commit (registry rule) |
| Scan encounters | design 3: chance 0, draw kept | already 0 on every Ground Ops run (scanStepRoll, expedition.ts 1545); OC-G1 deleted the legacy path | nothing to do; ship scan events (GO-8) stay: the ship is really there |
| Supply caches | design 3 [PROPOSAL] stop on gas giants | draw 2 of every boundary (expedition.ts 1564) | open call 4; the draw is always kept |
| Field repair | OC-G2 "no field repair there" | `FIELD_REPAIR_PLANET_TYPES` already omits `gasGiant` (groundOps.ts 2177; fieldRepair.test.ts 103) | GG-2 adds a test that no orbital-only type can join the list (derived guard) |
| Hostile sites / clearing on a giant | D22 | `bodyRiskGrades` (riskFactors.ts 218) can place an enemy colony (Tier III+) or a clearing objective on a gas giant | GG-2 suppresses both on orbital bodies; all seven draws still taken |
| Relic foreknowledge | design 3 | gas giant PoIs feed `relicSignature` | fixed for free by "no PoIs" |
| Giant classes | 1b.1: real science, Ice Giant + Brown Dwarf kept, plus nebulae | none | v2 mockup proposes the Sudarsky classes I to V; open call 1 |
| Nebulae | 1b.1; E-CREW build order "15b, with nebulae" | none | GG-4; representation is open call 2 |
| Reward shape | 1b.3 supersedes the 45/40/15 pool: canisters ALWAYS, plus independent 40% data, 15% readout | none | GG-3 |
| Canisters | 1b.4: 2 Standard, 2 Augmented, 1 Stellar, 1 Radiant (antimatter, its own container) | `ItemCategory` has no gas category (model.ts 7973); inventory is open-keyed with quality buckets (inventory.ts) | GG-1; the band is a property of the ITEM, not the quality bucket (see 3.4) |
| Deuterium | design 6: Deuterium Ice refines into a canister | Deuterium Ice is deprecated, no live source, sell-only (Material Lines 3e); S4-A05 "deuterium as a reach-crafting input" waits on a live source | the study IS the live deuterium source S4-A05 lacked; G2-4 drive recipes can now take Deuterium Canisters |
| Antimatter use in 0.14.0 | burn moved to 0.14.x (T3); G2-4 [PROPOSAL] Class VI and VII drives take a cell | none | "everything wired": the cell needs a 0.14.0 use; open call 7 |
| Research data | 1b.2 supersedes design 7 "Apply data on a running project": the LAB studies each item in its own lane; each study banks a typed boost, rarely a recipe | research length is decided once at start (`museumResearchDurationTicks`, tick.ts 7491); relic study has its own lane (`relicStudySlotCount`, tick.ts 7523) | GG-5 reuses both seams |
| Ancient data tab | design 7, 1b.2, 1b.6, relics capture 3; overlaps G3 Relics v2 "cultures with revealed names" | Research tabs are overview / research / relics / upgrades (App.svelte 2366) | open call 10 offers the user's "condensing" path |
| Special blueprints | user asked me to name them; v2 proposes Ramscoop Collector, Annihilation Core, Pressure-Forged Plating, Resonance Sensor Array | none | Annihilation Core is the burn's reactor, so it moves with the burn; open call 11 |
| Lab tiers | OC-15 "Add tiers 3-7 now (Recommended)" | Lab caps at level 2 (model.ts ~4818) | special blueprints sit on tiers 3 to 5 [PROPOSAL]; depends on the OC-15 rung slice |
| Probe | Galileo-Class Probe, id kept `atmoProbe` | `atmoProbe` memberTool, `planetTypes: ["gasGiant"]`, ratios fieldwork 0.6 / hazard 0.3 / relic 0.1 (model.ts 2636); blueprint `atmoProbeBp` tier 2 (model.ts 9683) | GG-1 relabels; GG-3 wires all three lines on a giant (open call 6), ratios unchanged so crafted-roll goldens hold |
| Probe and sensor wear | gear wear 3.1: sensors per body scanned (15), tools per fieldwork step (6) | wear not built yet | GG-3 exposes one "probe dive" event; the wear build consumes it (hook, registered `seam` until then) |
| Tiers | G2: gas giants exist at every tier (the planet type draw in `generateSystem`, expedition.ts 499, ignores tier); haul x1 to x3.3 by tier (G2 OC-16 answer) | G2-0 goldens only; G2-1+ not built | canister counts take the tier haul multiplier; ancient data odds rise with tier (relics capture 3) |
| Overtime | applies to research jobs | not built (credit sinks plan) | data studies are research jobs: Overtime covers them when it lands |
| Save | SAVE_VERSION 70 is the shared 0.14.0 bump, not on staging (origin/staging still reads 54) | `save.ts` 79, `MIGRATIONS[69]` | optional fields only; no migration step expected (3.6) |
| Completion % (G7) | per-system completion | not built | the study counts as its body's one objective |

**Conflicts with earlier text (for the user).**
1. Design 5's "ONE pick from a weighted pool 45 / 40 / 15" is superseded by 1b.3 (canisters always plus two
   independent rolls). This plan follows 1b.3.
2. Design 7's "Apply data cuts 10% of a running project" is superseded by 1b.2 (a lab study lane banks boosts for
   the NEXT project of the family). This plan follows 1b.2; the v1 mockup's "Apply" button is retired.
3. The design 4 class table (Saturn-class, Jupiter-class, Super-Jupiter) was rejected in 1b.1; the v2 Sudarsky
   proposal was never answered (open call 1).
4. Display collision: Sudarsky "Class I to V", drive "Class I to VII" (G2 OC-20) and region "Tier I to VII" all use
   Roman numerals. Open call 1 covers how giants read.
5. "Survey" now names three things: the Survey Log, the Survey team (two Science squads) and the survey missions.
   The user chose the Survey Log name; noted only.

## 3. Data model and save impact

### 3.1 Content (static data, no save)

- **Giant classes** `GIANT_CLASSES` **[PROPOSAL, open call 1]**: the v2 table. Sudarsky I Ammonia Clouds, II Water
  Clouds, III Cloudless, IV Alkali Metals, V Silicate Clouds (mass band 0.1 to 13 Jupiter masses each), Ice Giant
  (0.03 to 0.08), Brown Dwarf (13 to 78). Each row: class weights, mass band, inflation, band odds (Standard /
  Augmented / Stellar / Radiant, for example Class I 66/26/6/2, Brown Dwarf 55/30/12/3), within-band item weights,
  gases text, feature line, palette for the SVG art. **[PROPOSAL]** inner bodies lean hot (Classes IV and V) and outer
  bodies cold, from the body's index in the system (a real hot-Jupiter trend), never a new shared draw.
- **Derived physics** (pure, from class and mass, the v2 `planetPhys`): radius, density, cloud-top gravity, depth
  factor = gravity^0.4. Readout: share of the 13 (deuterium) and ~78 (hydrogen fusion) lines.
- **Nebula kinds** **[PROPOSAL, open call 2]**: Molecular Cloud, Emission Nebula, Planetary Nebula, Supernova Remnant,
  with band odds (Radiant 0: no magnetosphere, no antimatter) and a life-cycle stage for the Survey Log strip.
- **Canisters** (6 items, new `ItemCategory` `"gasCanister"`, a Materials section "Gas Storage Canisters", also on the
  Quartermaster Sell shelf through `sellValue` **[PROPOSAL values]**). Mapping **[PROPOSAL, open call 5]**: Standard
  Hydrogen Canister, Methane Canister; Augmented Ammonia Canister, Deuterium Canister; Stellar Helium-3 Canister;
  Radiant **Antimatter Containment Cell** (user's antimatter; item name [PROPOSAL]).
- **Band on an item:** a new optional static `ItemDef.band?: "standard" | "augmented" | "stellar" | "radiant"`
  (display color and sort), separate from the quality buckets that every deposit already rolls. Not saved.
- **Research data** (items, new `ItemCategory` `"researchData"` **[PROPOSAL]**): the user's six (Propulsion, Defense,
  Weapons, Systems, Field, Hull Design) plus **[PROPOSAL, open call 9]** Materials and Sensors. A pure
  `researchFamilyOf(blueprint)` maps all 72+ blueprints to exactly one family (test).
- **Ancient data** **[PROPOSAL name "Ancient Data Fragment", open call 10]**: one item; no culture name in 0.14.0
  text until the user or G3 names cultures.
- **Refinery recipe [PROPOSAL]:** Deuterium Ice x10 -> Deuterium Canister x1.
- **Galileo-Class Probe:** `atmoProbe` and `atmoProbeBp` keep their ids and ratios; label, blueprint label, flavor
  (design 5 [PROPOSAL]) and Help change. Ids never change (saves and goldens hold).
- **Glyphs:** SVG canister, cell, data and probe glyphs in `icons.ts` with `ICON_SEMANTICS`, reviewed at 16, 28 and
  56 px. No emoji.

### 3.2 Expedition record (all optional; absent = today's behavior)

- `Expedition.study?: 1`, frozen at dispatch (D24). Present = orbital bodies get the study; absent = a run dispatched
  before GG-2 resolves exactly as stored (only dev saves can hold one; v70 is not on staging).
- `ExpeditionBody.giant?: { classId: GiantClassId; massMilliJ: number }`, written at dispatch for orbital bodies of a
  `study` run (also derivable purely from seed and body index; stored so the readout never recomputes from content
  that a balance pass may retune).
- `Expedition.nebula?: { kindId: NebulaKindId }` (if open call 2 picks the system-feature option).
- `GroundOpsState.studyLegs?: GroundStudyLeg[]`, modeled on `GroundRepairLeg` (model.ts 7310): `{ kind: "study",
  bodyIndex | "nebula", startsAt, endsAt, done? }`. The ship holds orbit; the scan clock pauses exactly as for a repair
  leg (`scanClockToTime` already walks ship legs), teams keep working other bodies, and pickups wait for `shipFreeAt`.
- Findings: canisters, data and fragments ride `ExpeditionFinding.materials` (deposited by the existing
  `depositExpeditionFindings`); `ExpeditionFinding.source` gains `"study"`; a new optional
  `ExpeditionFinding.survey?: SurveyLogEntry` carries a readout.

### 3.3 GameState (all optional; absent = empty)

- `surveyLog?: SurveyLogEntry[]`: `{ id, at, systemName, bodyName, kind: "giant" | "nebula", classId | kindId,
  massMilliJ?, tier }`. Every displayed number is derived from these stored fields.
- `researchBoosts?: Partial<Record<ResearchFamily, number>>`: banked boost counts, consumed by the next
  `startResearch` of that family.
- `dataStudyIndex?: number`: monotonic, stamped on each study at start (the relic-study precedent), keys its rolls.
- `ancientDecoded?: number`: entries decoded so far (if open call 10 keeps a sequence).
- `TimedProcessKind` gains `"dataStudy"` (carries `itemId`, `index`). Blueprints gain optional static
  `requiresDecode?: number` (mirrors `requiresRelicDiscovery`).

### 3.4 Determinism

- New odd, distinct, exported salts registered in `salts.test.ts` MODULES **[PROPOSAL names]**: `GIANT_PROFILE_SALT`
  (class, then mass: integer log-uniform in milli-Jupiter), `GAS_STUDY_SALT` (keyed by body index, nebula = 99),
  `NEBULA_SALT` (the system nebula roll), `DATA_STUDY_SALT` (keyed by `dataStudyIndex`).
- Fixed draw order per study, so a count change never shifts the bonus rolls: (1) research data permille 400,
  (2) data type, (3) survey permille 150, (4) ancient fragment permille, (5) canister count, then per canister (6) band
  by the class odds and (7) item within band. Integer draws only.
- `generateSystem` draws are untouched: the planet type pick stays `nextInt(PLANET_TYPES.length)` with 8 types, so a
  nebula never becomes a ninth drawn type. `bodyRiskGrades` keeps all seven draws; on an orbital body the site and
  clearing results are dropped ("draw kept, value unused", the `scanStepRoll` precedent).
- Offline == live: one call == 997 s chunks == 1 s chunks, on runs with a giant, a nebula, a field repair and a
  pickup that waits on a study leg.

### 3.5 Wiring registry

Same-commit entries for every new effect source: `orbitalOnly` flips to live (GG-2); class depth factor, probe depth,
probe fieldwork speed, probe relic line as ancient odds, tier haul multiplier on canisters, each data boost per
family, the recipe chance, each canister's recipe use, nebula odds (GG-3 to GG-7). The probe wear event is a `seam`
until the wear build consumes it. Display-only rule (OC-K3): every number with % or + in the study, lab and log text
is a tested effect.

### 3.6 Save

SAVE_VERSION stays **70**. Every field above is optional and absent on every existing save; inventory is open-keyed,
so new items need no step. No migration is expected; if a build finds one (for example a dev save with an in-flight
run whose gas giant PoIs should be dropped), it APPENDS to `MIGRATIONS[69]` and adds a line to the v70 header list in
`save.ts`, frozen and idempotent, never v71.

## 4. Slices

Every slice: one implementer, spec review, then quality review (burst mode until 2026-10-22: deeper separate reviews),
re-review after fixes. Gate: `npm run check` (0 errors; the 2 known RadialWeb warnings are fine) and `npx vitest run`
(all green). One commit per slice, staged by explicit path, ending with the Co-Authored-By line. Text rules: no em
dashes and no double hyphens; US English; "install", never fit; "objective", never "task", in player text; Roman
numerals for tiers; SVG glyphs only.

**Ordering.** GG-0, GG-1 and GG-5 do not touch the expedition engine and can run beside G2. GG-2 to GG-4 touch
`generateSystem`, the previews and the Ground Ops window, so they start after G2-2 and G2-3 merge (build order:
G2 then 15b). GG-6 waits for the mockup sign-off.

### GG-0: Goldens first (tests only)

Capture hashes before any engine change: a Ground Ops run on a seed with a gas giant (system task preview, launch
forecast, scan events, full run to claim, deposits); the same seed's `bodyRiskGrades` per body; a run with no gas
giant (must stay byte-identical through every slice); `startResearch` durations for 5 blueprints with and without the
museum; the item census counts. Commit `test(0.14.0): pre-gas-giant-study golden hashes (GG-0)`.

### GG-1: Content and items (data only)

Giant classes, nebula kinds, 6 canisters, research data items, the fragment, `ItemDef.band`, the two categories and
the Materials section, the Refinery recipe, sell values, Galileo relabel, glyphs. Tests: census (model.test.ts),
unique ids, every item has `unlockHint` and flavor, every class and kind has odds summing to 100, physics table
spot-checks (Jupiter mass 1 gives density ~1.33), the recipe. Goldens: only the census moves (explained).

**GG-1 carry note (built 2026-10-20, on feat adb41c6).** Built: `gasGiantContent.ts` (GIANT_CLASSES, NEBULA_KINDS,
physics, item ids, GAS_STUDY_USES with GG owners, GAS_STUDY_SOURCE_PENDING); 15 ITEMS rows (categories `gasCanister`,
`researchData`; `ItemDef.band`); the Materials section "Gas Storage Canisters" with SVG `gasCanister` / `antimatterCell`
glyphs (gasStudyIcons.ts); `refineDeuteriumCanister` (Deuterium Ice x10, 20 ticks, offered: its output sells);
canister sell values (GAS_CANISTER_SELL_VALUE); the Galileo-Class Probe relabel (id, ratios kept). Wiring: canisters are
sellable (live); the nine data items carry `reserved` (GG-5); the fourteen sourceless items stay off the warehouse
shelves and out of its catalog count until GG-3 / GG-4 empty GAS_STUDY_SOURCE_PENDING; every class and kind field and
every study use is a pending registry entry owned by GG-2 to GG-7. Left for later slices: `researchFamilyOf` (GG-5),
the timings constants (GG-3 to GG-5), the data and probe glyphs (GG-6, with their screens), Help (GG-8).
[PROPOSAL] picks for the user: the band odds and item weights (v2 mockup), the 10:1 Deuterium recipe, rarities by
band (common, uncommon, rare, epic), all items at warehouse tier 1, item flavor texts, the probe flavor. Approved
2026-10-21 (tags dropped): the four nebula kinds, the sell values (200 / 200 / 450 / 450 / 1,000 / 2,500), the class
roll weights, one shared glyph for the five gases. The Deuterium Canister recipe stays visible; its Reactor Core use
is its own slice.
For GG-2: the plan's "inner bodies lean hot" class bias (Sudarsky IV and V on inner bodies, cold classes outer, read
off the body's index, never a new shared draw) is NOT in GG-1's data; GG-2's class roll owns it.
For GG-6: research data has no warehouse shelf section yet (and no glyph); the items are hidden until GG-3 gives them a
source, so GG-6 adds their section (or the lab tab list) with its glyphs.
Goldens: GG-0's run, risk and lab pins hold through the pre-G2 helpers; the census holds GG-1's additions apart and
pins them; the registry pins (G1-0 golden 5, EM-0) hold GG-1's added entries apart (gasStudyGoldens.fixture.ts) and
the EM-0 snapshot re-pins 60d00075 -> c86ecfb4 for those additions only.

### GG-2: Orbital bodies lose ground objectives (engine)

Behind `exp.study`: `assignDiscoveriesAndActivities` returns no PoIs for an orbital body and adds one study entry;
`gasGiant` leaves every `planetWeights` (the non-empty pool assert skips orbital types); `MATERIAL_BY_PLANET_TYPE
.gasGiant` (gambit.ts 1644) retires; site and clearing dropped on orbital bodies with draws kept; `body.giant` written
at dispatch; previews (`systemTaskPreview`, `launchForecast`, foreknowledge, telescope recommendation) show "1 ship
study" and no squad needs for it. Registry `orbitalOnly` to live. Tests: no PoI, site, clearing or squad need on any
orbital body over 64 seeds and Tiers I to VII; non-orbital bodies byte-identical to GG-0; preview == run; field repair
never targets an orbital body; run with `study` deleted == GG-0 golden.

**GG-2 carry note (built 2026-10-21, on feat f85ef73).** New engine module `gasGiantStudy.ts`. `Expedition.study: 1` is
stamped ONLY on a system holding an orbital-only body (studyStampFor), so every other dispatch record is byte-identical;
each orbital body freezes `ExpeditionBody.giant` (rollGiantProfile on GIANT_PROFILE_SALT: draw 1 class, draw 2 mass,
log-uniform over GIANT_MASS_STEPS integer steps). On a stamped run `assignDiscoveriesAndActivities` gives an orbital body
nothing (no PoI, site, clearing or sensor ghost find); `scanStepRoll` drops its supply cache (draw 2 kept; draw 1, the
ship event, unchanged). `bodyRiskGrades` never places a hostile site or clearing objective on an orbital body (all seven
draws kept; previews and new dispatches only, a run in flight keeps its stored grades). Previews: `SystemTaskPreview.
studies`, `TaskDemand.shipStudies` (text "1 ship study, no squad needed"), `LaunchForecast.studies`, each written only
when present. Registry: PLANET_TYPES gasGiant:orbitalOnly, GAS_STUDY_USES classRoll and the classes' weight / mass band
fields live with probes. Kept, not retired (deviation, for in-flight identity): gasGiant stays in the PoI planetWeights
and `MATERIAL_BY_PLANET_TYPE.gasGiant` stays, read only by a run dispatched before GG-2. [PROVISIONAL] GIANT_ZONE_LEAN
(inner x3 hot / x2 warm, outer x2 cold; middle = the approved weights). Goldens: the pre-GG-2/GG-3 sweep (42 systems,
Tiers I to VII) holds; strip helpers gained withoutStudy (asPreFieldKitsDispatch composes it, so every pre-GG-2 run
golden holds); the gas giant candidate's previews moved on purpose (G2-0 display:candidates / display:launch, G2-1
candidates, SF-0 first:launch, GG-0 golden 1's first three, WR-5c surveySensors4 / 5 cands), each named at its pin.
For GG-6: `scanTrackDisplay.ts` still lists a gas giant's possible ground finds from poisForPlanetType (display).

### GG-3: The study leg and its reward (engine)

The study leg starts when its body's scan completes (the ship holds orbit), lasts `STUDY_BASE_SECONDS` **[PROPOSAL
1800]** / the deployed Science fieldwork speed on `gasGiant` (`fieldworkSpeedMult`, already D23 and pace-curved),
floor 60 s. Reward: canisters 4 to 8 **[PROPOSAL]** x (1 + `diminishing(0.5 x depthFactor x probeRating, 2)`) x the G2
tier haul multiplier, rounded by `chanceRound` on the study stream; band and item rolls per 3.4; data 40% and survey
15% (user); ancient fragment permille from the probe's relic line and the tier (open call 10). Probe: the best
Galileo among deployed Science members, frozen at dispatch (one probe per dive) **[PROPOSAL]**. Run end waits for open
study legs (`checkRunEnd`). Exposes `studyDiveEvents(exp)` for the wear build. Tests: reward determinism, odds within
tolerance over 2,000 studies per class, probe on the D23 curve (never capped, monotone), no probe still pays, safe
first runs still cannot be lost, pickups wait for the leg, parity (one call == 997 s == 1 s).

**GG-3 carry note (built 2026-10-21, on GG-2).** `GroundOpsState.studyLegs` (GroundStudyLeg): groundOpsBodyScanned
schedules one per orbital body of a study run at its scan completion (or when the ship is free); it joins
shipLegsInOrder, so the scan clock pauses for it (scanBodyIndex = the next body, null after the last), a recovery or
repair leg queues behind it, and checkRunEnd waits for it. Its end is a window event (after a repair's, before a scan
event or a team step at the same instant): `rollStudyReward` pushes one `"study"` finding. An ordinary return that
would dock inside a study stored when it began docks at the study's end (studyPickupAt); a return begun before the
study was stored docks on time (deviation from the v3 timeline sample, where the Strike team also waits through the
next giant's SCAN: only a study holds the ship). Length `studySeconds` = 1800 / fieldworkSpeedMult on the body, floor 60.
Reward draw order on GAS_STUDY_SALT: data 400, family (uniform over 8), readout 150, fragment, base 4..8, per-mille
chance rounding of base x (1 + dive) x tierHaulMult, then band and gas per canister. Probe: `studyProbe` = the best
`atmoProbe` on the frozen Science roster (hazard line, then relic line); ratings against GALILEO_REFERENCE_LINES.
Claim: `survey` readouts append to `GameState.surveyLog`. GAS_STUDY_SOURCE_PENDING is now empty (every study item has a
source). groundOpsProgress counts each study at weight 1. Readers for GG-6: `groundShipPosition` kind "study",
`studyCanisterRange` (the "8 to 17 canisters" line), `studySeconds`, `studyProbe`, `giantDepthFactor`,
`ancientFragmentPermille`; shipNowText got a minimal "Holding orbit: studying ..." line (the study lane is GG-6).
Seam: `studyDiveEvents` (registry `away:GAS_STUDY_SEAM:probeDiveWear`, owner gear wear step 3). Registry live:
GAS_STUDY_USES studyReward / probeDive and the classes' radiusModel / inflation / bandOdds / itemWeights (probes in
wiring/probes.ts). [PROVISIONAL]: GALILEO_REFERENCE_LINES (iLevel 10 Standard q0: hazard 0.06, relic 0.02),
ANCIENT_FRAGMENT_BASE_PERMILLE 12 / ANCIENT_PROBE_LIFT 2.5 / ANCIENT_PROBE_KNEE 2 (about 1.5% from orbit at Tier II, 4%
with the reference probe; the tier lift reuses TIER_HAUL_MULT). [PROPOSAL] from the plan, kept: STUDY_MIN_SECONDS 60,
canisters 4 to 8, dive 0.5 x depth x rating at knee 2, one probe per dive, a uniform data family.

**GG-2 / GG-3 merge note (2026-10-21, onto feat with G2-4 / G2-5, R2-2, R2-3, SF-4).** Review fix: a recall
(G2-5) during a study left the giant unstudied for good on the resumed trip, and a giant studied on the first trip
read 0 in the resumed run's progress. Now a held body carries `studied` (resume record only, expedition.ts
heldBodies) when its study finished; `openResumedGroundOps` studies every charted giant without it from the window's
opening; `groundOpsProgress` counts a `studied` giant whole; and a system whose only unfinished work is a study stays
resumable (systemUnfinished). Tests: gasGiantStudyResume.test.ts (parity included). Goldens: every GG pin reproduces
(the captures go through dispatchPastPropulsion and asPreRelicBlanksDispatch); moved at the merge, named at their pins:
propulsionRecallGoldens Tier VI dispatch and relicsV2BlanksGoldens Tier VII seed 11 (a gas giant whose risk grades held
a hostile site or a clearing objective, which GG-2 drops and no strip can rebuild). Kept as built (for the user): a
pickup waits only while the ship is on a study; the v3 mockup also showed the Strike team waiting through the next
giant's scan, and a return that began before a study was stored docks on time.

### GG-4: Nebulae (engine)

Per open call 2. Recommended shape: a system-level nebula on `NEBULA_SALT` at a permille by tier **[PROPOSAL I 8%, up
to VII 20%; G2's nebula-region famous systems always]**, swept by one study leg after the last body
(**[PROPOSAL]** 7200 s, 24 to 48 canisters), Radiant 0. Tests as GG-3, plus: no nebula on a seed whose draw misses;
G2 candidate identity outside the new draw.

**GG-4 carry note (built 2026-10-21, on feat bc25a23).** `Expedition.nebula?: { kindId, swept? }` is stamped at
dispatch (buildExpedition, and the preview run) only when the system's own draw finds one (gasGiantStudy.ts
rollSystemNebula on NEBULA_SALT: draw 1 the hit at NEBULA_PERMILLE_BY_TIER, draw 2 the kind, uniform over the four; both
always taken; the Orion, Lagoon and Eagle Nebulae always hold an emission nebula, FAMOUS_NEBULA_KIND), so every other
dispatch record is byte-identical and a run in flight never sweeps. The SWEEP is a study leg (`GroundStudyLeg.nebula:
1`, bodyIndex NEBULA_SWEEP_BODY_INDEX -1), scheduled when the last body is scanned (after any study under way) or when
a resumed window opens on a fully charted system: 7200 s (call 12), no probe (no dive event), pickups wait for it, the
window closes after it. Reward (rollNebulaReward, NEBULA_SWEEP_SALT, fixed order): data 400, family, readout 150, base
24..48, chance rounding x the tier haul, then band and gas per canister by the kind's odds and weights (Radiant 0). No
Ancient Data Fragment from a sweep. Survey Log: `SurveyLogEntry` is now `SurveyGiantEntry | SurveyNebulaEntry`
(`kind: "nebula"`, `kindId`). Recall (G2-5): HeldSystem.nebulaSwept when the sweep finished; an unswept nebula keeps a
system resumable; a resumed run marks `nebula.swept` and never sweeps twice; progress counts the sweep at weight 1.
Previews: SystemTaskPreview.nebula, TaskDemand.nebulaSweep ("2 ship studies and 1 nebula sweep, no squad needed"),
LaunchForecast.nebula; the candidate's identity is outside the draw (only its telescope demand gains `nebulaSweep`).
Display: shipNowText "Sweeping the emission nebula · ..." (minimal; GG-6 owns the lane). Readers for GG-6:
`nebulaCanisterRange`, `NEBULA_SWEEP_SECONDS`, `sweepsNebula`. Registry live with probes: GAS_STUDY_USES nebulaSweep
and every NEBULA_KINDS bandOdds / itemWeights. [PROPOSAL] for the user: NEBULA_PERMILLE_BY_TIER (I 8% rising 2% a tier
to VII 20%), the uniform kind draw, 24 to 48 canisters. Goldens: the GG-4 capture (42 systems, the stamp off) holds;
the strip helper `withoutStudy` now also takes the nebula off (asPreNebulaDispatch for GG-3's own runs); moved on purpose,
named at each pin: the fresh save's cand-1-2 (it holds a nebula) candidate / task preview / launch view (GG-0 golden 1,
G2-0 display:candidates and display:launch, G2-1 candidates, SF-0 first:launch).

### GG-5: Research Lab study lane (engine)

`"dataStudy"` process on its own lane (Lab 1 has 1 slot **[PROPOSAL]**), `DATA_STUDY_SECONDS` **[PROPOSAL 1200]**;
completion banks one boost for the item's family and rolls the recipe chance on `DATA_STUDY_SALT`; `startResearch`
consumes every banked boost of the project's family: duration = museum duration / (1 + 0.12 x
`diminishing(n, 4)` / `diminishing(1, 4)`) **[PROPOSAL, v2 numbers]**. "Learn a recipe" **[PROPOSAL]** = one
not-yet-researched blueprint of that family at or below the Lab's tier is granted as researched (no invented
blueprints); none left = nothing. Ancient entries per open call 10; `requiresDecode` gates. Overtime covers the lane
when the speed seam lands. Tests: family map covers every blueprint once, boost math and consumption, recipe roll
determinism, lane independence from research and relic study, offline parity.

**GG-5 carry note (built 2026-10-21, on GG-4).** New engine module `dataStudy.ts`; the lane pump and completion live in
tick.ts. TimedProcessKind `"dataStudy"` with effect `studyData { itemId, studyIndex, cultureId? }` (consume at start).
Lane: DATA_STUDY_LANES 1 from Lab Level I (labTier; as drawn), DATA_STUDY_TICKS 1200 (call 12). `processDataStudyLane`
runs once per whole tick in economyTick after the repair pass (offline == live; draws nothing): when idle and not paused
it starts the OLDEST held item (`heldDataQueue`: units held with no arrival entry first, item order; then
GameState.dataStudyHeld in arrival order, the claim appending one entry per unit via `depositExpeditionFindings(state,
findings, exp)` / `dataArrivals`; entries the inventory no longer covers are pruned). Pause (`setDataStudyPaused`,
GameState.dataStudyPaused): nothing starts and the running study's countdown holds (resolveProcesses skips it), as
drawn. Completion: a research data item banks one boost (GameState.researchBoosts) and rolls the recipe chance
(DATA_STUDY_SALT keyed by the save's relic seed and the study index; draw 1 the 5% chance, draw 2 the pick, both always
taken) over `dataStudyRecipeCandidates` (the item's family, tier <= the Lab's, not researched, not in research, not
relic or decode locked), granted straight into researchedBlueprints; none left = nothing. `startResearch` spends every
banked boost of the project's family (`researchFamilyOf`): duration = museum duration / (1 + researchBoostSpeed(n)),
researchBoostSpeed(n) = 0.12 x diminishing(n, 4) / diminishing(1, 4). An Ancient Data Fragment decodes the next entry of
its OWN culture (GameState.ancientDecoded[cultureId]; the culture is the Relics v2 body culture, cultureForBody, read
off the study finding's body at the claim; a fragment held from before GG-5 reads a pure legacy hash) and gives that
culture one study point (`feedCultureData` on the Museum v2 culture record: the OC-9 seam R2-6 builds naming on).
`BlueprintDef.requiresDecode` + `blueprintDecodeLocked` (the most entries any one culture decoded) + canResearch
`undecoded`: no blueprint carries it yet (GG-7's special blueprints will). Overtime covers `dataStudy` (tier 1). Research
data items lost their `reserved` markers; their registry rows flip live in place (DATA_STUDY consume:<item>, probe: the
lane studies the unit). Registry live with probes: GAS_STUDY_USES labLane, DATA_STUDY boost:<family> x8, recipeChance; seams
ancientDecode (review follow-up below) and DATA_STUDY_SEAM decodeGate (owner GG-7). Completion log: a study that learned a recipe records a
"blueprint", any other the item studied ("nothing"; GG-6's tab shows the boost or the entry); FA XP like a relic study.
[PROVISIONAL]: RESEARCH_BOOST_KNEE 4. [PROPOSAL]: the family map (RESEARCH_FAMILY_BY_SLOT plus the Survey Rig and the
Pathfinder Suite as Sensors; field kits as Field; hull unlocks and holds as Hull Design), the decode gate reading the
most entries of any one culture, a data study earning FA XP. Readers for GG-6: `heldDataQueue`, `dataStudiesInFlight`,
`dataStudyPaused`, `researchBoostsBanked`, `researchBoostSpeed`, `ancientEntriesDecoded`. For GG-6: research data is
still on the warehouse shelves through the GG-3 source flip (GAS_STUDY_SOURCE_PENDING empty); the signed-off "no
research-data warehouse shelf" is GG-6's to apply. Goldens: the GG-5 capture (a save holding data, an hour) holds with
the lane paused; the lane-on hour is pinned (GG-5 golden).

**GG-4 / GG-5 review follow-up (2026-10-22, integration).** `facility:DATA_STUDY:ancientDecode` is a SEAM (owner GG-7 and
R2-6), not live: the study raises `ancientDecoded` (its probe still measures that), but no blueprint carries
`requiresDecode` yet and nothing reads the culture study point, so a fragment study changes nothing a player sees until
GG-7 (GG-7 adds a test that at least one blueprint needs a decode). Overtime is refused on a paused data study
(`canBuyOvertime` reason `paused`). Tags added, for the user: [PROPOSAL] the sweep's extras (research data 40%, Survey
Log readout 15%, never an Ancient Data Fragment), [PROPOSAL] the Orion, Lagoon and Eagle Nebulae always holding an
emission nebula, [PROVISIONAL] one data lane at every Lab level. For GG-6: the forecast prints `nebulaCanisterRange`
(30 to 60 at Tier II), not the mockup's example "31 to 62"; the demand line reads "2 ship studies and 1 nebula
sweep, no squad needed" where the mockup drew "2 ship studies · 1 nebula sweep · Studies need no squad" (reconcile
there); a paused lane needs its paused state on the Home row (its countdown holds).

### GG-6: UI (needs a v3 mockup sign-off first)

Mockup coverage. Covered by v2 (needs the user's sign-off; never given): class art and readout, dive panel, reward
roll, canister shelf with item detail, lab boost table, Survey Log entry with the "how close to a star" bar.
Covered by v1 only (superseded layout): the body card with "orbital ops" and the study ETA. **NOT covered, needs a
v3 mockup:** the study on the Ground Ops timeline (ship holding orbit, ETA, probe chip, pickups waiting), the launch
preview / telescope card line, the nebula on the system card, the claim result lines, the lab lane queue controls
(open call 8), ancient entries, special blueprint cards, every layout at 375 px. Builds the Survey Log Archive tab
(`ArchiveSubTab` gains `"surveyLog"`, `MuseumPanel.svelte` pattern; grouped by class with counts), the study card,
the warehouse section, the lab tab. QA at 1280 px and 375 px, light and dark.

**GG-6 carry note (built 2026-10-23, on feat 8870cdd).** UI only; no engine rule, save field or golden moved. Display
decisions in `gasGiantStudyDisplay.ts` and `dataStudyDisplay.ts` (both tested); components `StudyRunPanel`,
`GasGiantCard`, `GiantArt`, `StarBar`, `StudyChips`, `DataStudyPanel`, `SurveyLogPanel`, `GasCanisterShelf`. Built as
drawn: section 1 (each orbital body's study row with its class, mass, "Orbital: no ground objectives", ship study time,
Galileo dive and state; the dashed nebula row; the summary chips; the ship holding orbit card with the probe, the
fieldwork pace and the waiting pickups; the ship legs card and the return forecast; the timeline's study and sweep on
the ship lane and the hatched "pickup waits" on a team lane), section 2 (the body card per orbital body, a real
tablist), section 3 (the Research Lab's own "Data study" tab with the auto-study switch, `doSetDataStudyPaused`),
section 5 (the Gas Storage Canisters shelf and detail card). Also: the Archive's Survey Log tab (not drawn in v3; the v2
layout with the v3 star bar), the study results card and the claim log line, the launch preview's study chips (the demand
line leaves the studies to the chips), the Home row's paused line and the new `dataStudy` jump target, research data off
the warehouse catalog counts (`onWarehouseShelf`), the six glyphs (researchData, ancientFragment, galileoProbe, giant,
nebula, pause; verbatim from the mockup). The forecast prints the engine's ranges (30 to 60 from a Tier II sweep, not
the mockup's sample 31 to 62). Left for its owners: the Cultures tab (section 4: R2-7 lists cultures, R2-8 the detail and
names, GG-7 the special blueprint cards); the data tab shows the decoded count until then. [PROPOSAL] display-only:
GALILEO_CRUSH_BAR_PER_RATING 90 (the mockup's arithmetic), the cloud decks and palettes of Sudarsky II to V and the four
nebula kinds. Open for the user: the 2 h sweep holds every pickup (sell peace), see the report.

**GG-6 review round (2026-10-23).** UI fixes: the canister shelf carries the warehouse fill and red full state ("Full
(cap N)"; `stockFillDisplay.ts`), the dive depth prints the real number (only the drawn line stops at 1,000 bar), the
summary chips count only what a resumed run still studies and add "N ground objectives" once every body is scanned,
resumed clock times add `scanClockSkip`, the claim line no longer repeats the haul, research data leaves the warehouse
at-cap list and the Data study tab shows "Held data N / cap of each type" with a full warning. User calls: the "Entries
decoded so far" line is hidden until GG-7 (`ANCIENT_DECODE_TEXT_LIVE` false); the Survey Log tab stays built but HIDDEN
until its own mockup sign-off (`SURVEY_LOG_LIVE` false, `archiveSubTabs`, tested). ENGINE (the user's answer above,
"stop mid-scan and pick back up where it left off"): `Expedition.pickupPause: 1` is stamped on new study runs (right
after `study` / `nebula`). On such a run a team ready for pickup while the ship holds a study or the sweep is collected
by a pickup leg (`GroundShipLeg.studyPause`, `pickup` when not wiped; one shared leg per body while it is still on its
way) that pauses the study at the first moment the ship is free (`pickupPauseSlot`); the study grows by the leg's length
with the span in `GroundStudyLeg.pauses`, every later stored leg (a queued sweep, recovery or repair) and the shuttles
tied to them shift with it, and the study's progress excludes the pauses (`studyLegShare`). A wiped team's recovery leg
pauses the study the same way. Rewards are unchanged (the study rolls read no time). A run without the stamp resolves
exactly as stored (gasGiantPickupPause.test.ts golden 124dbee8, pinned before the change; the stamped run pins affce7e6,
600 s == 997 s == one call). Display: "Study paused: flying to pick up ...", the "Study paused for a pickup" card with
the time left on resume, "Paused for a pickup" and "Resumed after a pickup, progress kept" chips, the pauses in the legs
card, the study drawn around its pauses on the ship lane, the team lane's "pickup" (never a wipe); old runs keep the
hatched "pickup waits". Registry: `expedition:GAS_STUDY_USES:pickupPause` live (probe `content:gasStudy:pickupPause`:
the seconds shuttles wait behind a study over a whole nebula run, OFF the stamp removed), held apart from GG-1's rows
in the pins (gasStudyGoldens.fixture.ts). GG-4's own tests and golden now strip the stamp (`withoutNebula` and
`withoutStudy` drop it too: every pre-GG-4 capture keeps its waiting shuttles).

### GG-7: Crafting uses and special blueprints (data + engine)

Canister recipe uses per open call 7 (new higher-tier blueprints from G2-4 and OC-15, so no existing recipe or
crafted golden moves); the special blueprints per open call 11 with their stats on existing slots; Ramscoop Collector
boosts the nebula sweep (never a gate). Tests: every canister has a consumer (dead-stock test), each special
blueprint's effect in the registry.

**Note for GG-7 from the reactor fuel ladder slice (2026-10-21).** Recipe realism audit Group A call 3 (user):
Helium-3 goes in NO Reactor Core in 0.14.0 ("reactors take it in the balancing patch"); its 0.14.0 consumer is the
**Resonance Sensor Array: 1 Helium-3 Canister** (audit section 9: Photonic Gel 2 + Wafer 2 + Coupling 1 + Helium-3
Canister 1 [PROPOSAL]). That blueprint does not exist yet, so GG-7 builds it with the Helium-3 input. The reactor ladder
(reactorTech.ts) already carries the Deuterium-Helium-3 fusion, antimatter-catalyzed fusion and antimatter tiers as
balancing patch seams; GG-7 adds no reactor. The Deuterium Canister's reactor use is live (every Reactor Core recipe).

### GG-8: Help, registry close-out, QA sheet

Help topics: gas giants and nebulae, the Galileo-Class Probe, Gas Storage Canisters, research data and the lab lane,
ancient data, the Survey Log (numbers read from constants; the helpTopics text-rules test). Holistic review, carry
notes into this doc and the E-CREW plan, curated QA sheet. Deploy only after the user confirms.

## 5. OPEN CALLS (multiple-choice ready; recommended first; most important first)

1. **Giant classes.** (a) Sudarsky I to V plus Ice Giant and Brown Dwarf, mass as its own number, shown by name
   ("Ammonia-cloud giant, Sudarsky I") so "Class" numerals do not collide with drive classes (Recommended).
   (b) The same, shown as "Class I" to "Class V". (c) Names only, no Sudarsky numbering.
2. **Nebulae.** (a) A system-level nebula on its own draw, swept by the ship after the bodies; the four kinds
   [PROPOSAL] (Recommended). (b) A nebula as an extra body in the body list. (c) Nebulae only in G2's famous
   nebula regions.
3. **Who studies.** (a) The ship, always, no squad needed; Science crew and a Galileo speed and enrich it
   (Recommended). (b) Needs at least one Science squad aboard.
4. **Supply caches on gas giants.** (a) Stop (draw kept) (Recommended). (b) Keep (drifting cargo found from orbit).
5. **Canister mapping.** (a) Standard Hydrogen, Methane; Augmented Ammonia, Deuterium; Stellar Helium-3; Radiant
   Antimatter Containment Cell (Recommended). (b) Same, cell renamed by you. (c) Swap Deuterium to Stellar, Helium-3
   to Augmented.
6. **Galileo lines on a giant.** (a) Fieldwork = study speed, hazard resist = crush rating (dive depth), relic find =
   ancient data odds; ratios unchanged (Recommended). (b) New ratios built for depth (moves crafted goldens).
7. **Canister uses in 0.14.0.** (a) Inputs to the new G2 drive classes and Lab tier 3 to 7 blueprints (Deuterium
   Class III+, the cell Class VI and VII, Helium-3 reactors, Hydrogen, Methane, Ammonia in sensor and quarters
   modules), also sellable (Recommended). (b) Sellable now, recipes in the balancing patch (OC-J3 style). (c) Place
   them in Material Lines.
8. **Lab lane.** (a) Auto-studies held data when idle, with a pause toggle (zero-click) (Recommended). (b) Manual
   start per item, like Relic Study.
9. **Data types and boost.** (a) Your six plus Materials and Sensors; +12% per boost on the next project of the
   family, D23 stacking; 5% recipe chance (Recommended). (b) Your six only, same numbers. (c) Different numbers.
10. **Ancient data (your "condensing" option).** (a) One lane: Ancient Data Fragment is a data type whose study
    decodes the next entry, some entries unlock special blueprints; culture names come with G3 Relics v2
    (Recommended). (b) A separate Decryption tab and lane. (c) Move ancient data to G3 entirely.
11. **Special blueprints.** (a) Ramscoop Collector, Pressure-Forged Plating, Resonance Sensor Array in 0.14.0;
    Annihilation Core moves to 0.14.x with the burn (Recommended). (b) Also ship Annihilation Core as a plain
    reactor now. (c) You name them.
12. **Timings.** (a) Giant study 30 min (probe faster), nebula sweep 2 h, data study 20 min (Recommended).
    (b) Halve them. (c) Double them.
13. **Scope check (push-back rule).** (a) Keep all of it in 0.14.0 except the burn, per your ruling (Recommended).
    (b) Move nebulae (GG-4) to 0.14.x. (c) Move ancient data and special blueprints to 0.14.x.

Already moved to 0.14.x (no call): the antimatter burn and its maintenance period (T3), so G2-8 waits.

## 6. Size (honest)

Nine slices (GG-0 to GG-8), close to G2 in size: about 2,500 to 3,500 lines of code and tests. Heaviest: GG-3 (a new
ship leg in the Ground Ops window, parity) and GG-5 (a new lane plus the research seam), then GG-6 (four surfaces at
two widths). Hard dependencies: G2-2 and G2-3 for the engine slices, the OC-15 Lab rungs for special blueprints, the
wear build for the probe wear event, the speed seam for Overtime. Biggest cuts if needed: GG-4 (nebulae) and the
ancient entries (open call 13); nothing else can move without leaving a false Help line or a dead item.

## USER ANSWERS (2026-10-17)

- **Call 1 giant classes:** "By name + Sudarsky (Recommended)". **Call 2 nebulae:** "System-level sweep (Recommended)".
  **Call 3 who studies:** "The ship, always (Recommended)". **Call 13 scope:** "Keep all in 0.14.0 (Recommended)".

## USER ANSWERS (2026-10-19)

- **Call 4 supply caches:** "Stop on gas giants (Recommended)": no caches on gas giants; the draw is kept.
- **Call 5 canister mapping:** "Proposed mapping (Recommended)": Standard Hydrogen, Methane; Augmented Ammonia,
  Deuterium; Stellar Helium-3; Radiant Antimatter Containment Cell.
- **Call 6 Galileo lines:** "Reuse lines (Recommended)": fieldwork = study speed, hazard resist = crush rating, relic
  find = ancient data odds; ratios unchanged.
- **Call 7 canister uses:** "Drives + Lab blueprints (Recommended)": inputs to the G2 drive classes and Lab tier 3 to 7
  blueprints (Deuterium Class III+, the cell Class VI and VII, Helium-3 reactors, Hydrogen, Methane, Ammonia in sensor
  and quarters modules), also sellable. This is also Material Lines call L9's shared answer.
- **Call 8 Lab lane:** "Auto when idle (Recommended)", with a pause toggle.
- **Call 9 data types:** "Your six + 2, +12% (Recommended)": the six plus Materials and Sensors; +12% per boost on
  the next project of the family, D23 stacking; 5% recipe chance.
- **Call 10 ancient data:** "One lane (Recommended)": Ancient Data Fragment is a data type whose study decodes the
  next entry; some entries unlock special blueprints; culture names come with G3 Relics v2.
- **Call 11 special blueprints:** "Three now (Recommended)": Ramscoop Collector, Pressure-Forged Plating, Resonance
  Sensor Array in 0.14.0; Annihilation Core moves to 0.14.x with the burn.
- **Call 12 timings:** "Proposed (Recommended)": giant study 30 min (probe faster), nebula sweep 2 h, data study 20 min.
- ALL gas giant calls answered.

## USER ANSWERS (2026-10-21): GG-1 [PROPOSAL] picks

- **Nebula kinds:** "Approve (Recommended)": Molecular cloud, Emission nebula, Planetary nebula, Supernova remnant.
- **Canister sell values:** "Approve (Recommended)": Hydrogen 200, Methane 200, Ammonia 450, Deuterium 450, Helium-3
  1,000, Antimatter Containment Cell 2,500.
- **Deuterium Canister recipe (verbatim):** "Give it a use. Make it craftable into Deuterium Cannisters and give it a use.
  Perhaps as part of a reactor blueprint." (Supersedes the multiple-choice pick "Hide until it has a use".) The 10 Ice
  to 1 Canister recipe stays visible and the canister gets a reactor-blueprint use now; which blueprint is asked next.
- **Class weights + shared glyph (verbatim):** "Yes. One shared glyph for the 5 cannisters. Eventually we can tweak the
  graphics to make each a little different overall." Class roll weights I 4, II 2, III 2, IV 1, V 1, Ice 3, Brown dwarf 1
  approved; one shared canister glyph now; FUTURE: distinct canister graphics (logged in SUGGESTIONS.md).

## USER DATADUMP (2026-10-21, verbatim): reactor fuel in every core recipe

"There should be some sort of material like deuterium in all cores. After all, the tech before antimatter reactors (which
would likely be a high-tier tech later on, which is honestly where antimatter canisters could ultimately be used over a
burn option. But the burn option might be useful as well. We'll see on that one. Might be a tech only available with
antimatter reactors that can have an overburn option in exchange for extra canisters or something. But I digress. All
reactor core crafting recipes should ultimately require something like this since that makes sense."

Reading (to confirm by multiple choice): every Reactor Core crafting recipe takes a fuel canister input (a ladder by
tier); Antimatter Containment Cells are the fuel of a future high-tier ANTIMATTER REACTOR tech; an "overburn" option
(extra canisters for a boost) may be a feature of antimatter reactors, alongside or instead of the T3 burn (0.14.x;
undecided, "We'll see on that one"). Existing crafted reactors are untouched (recipes only). Because Deuterium Ice has
no source today, the Deuterium Skim run (Material Lines L8 / ML-6) must land with this so no core recipe is blocked.

Also 2026-10-21: SF-3 ramp: "Fade Weak + build SI gear (Recommended)" and "Smooth the last steps (Recommended)"
(recorded in the safe-first-runs plan).

## USER ANSWERS (2026-10-21): GG-2 / GG-3 picks

- "Approve all (Recommended)": GIANT_ZONE_LEAN (inner hot x3 / warm x2, outer cold x2); 60 s study floor; 4 to 8
  canisters per study before the dive bonus and tier multiplier; dive bonus 0.5 x depth x probe rating (knee 2); one
  probe per study; research data family uniform over 8; GALILEO_REFERENCE_LINES (iLevel 10 rates 1); Ancient Data
  Fragment base 12 per mille, lift 2.5, knee 2, tier lift reuses the tier haul multiplier (about 1.5% / 4% at Tier II).
  Drop these [PROVISIONAL] / [PROPOSAL] tags in GG-4/GG-5.

## GG-6 built (branch gg-6, 65dad02, 2026-10-23): open call for the user

Sell-peace sweep timing (both teams' last pickups waited behind the study and then the 2-hour sweep): (a) [builder recommends] shuttles dock normally during the sweep, the sweep still keeps the window open, stamped on new runs only; (b) start the sweep only once every team is aboard and idle; (c) run the sweep during the return trip. 13 mockup deviations listed in the GG-6 carry note, under review.
USER ANSWER (2026-10-23, verbatim): "I think the ship should be able to stop mid-scan and pick back up where it left off, so going to get the team from where they are is fine. Then go back and continue scanning." Reading: a fourth option. When a team is ready for pickup during a gas giant study or the cloud sweep, the ship pauses the study/sweep, goes and picks the team up, then returns and resumes exactly where it left off (progress kept, nothing lost). Engine change, stamped on new runs only so in-flight runs stay byte-identical; the UI shows the pause and resume.
USER ANSWERS (2026-10-23, GG-6 review calls): Survey Log: "Mockup first (Recommended)" (mock it up for sign-off before it ships); decoded count: "Hide until GG-7 (Recommended)"; research data cap: "Show cap in Lab tab (Recommended)" (Data study tab shows Held data N / cap with a full warning).
