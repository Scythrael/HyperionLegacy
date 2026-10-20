# G2 Expedition Tiers (0.14.0): RECONCILED PLAN

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One fresh implementer per slice, then
> the two-stage review (spec, then quality), re-review after fixes. Never push the branch; dev deploys are the
> controller's call (`git push origin feat/crew-0.14.0:staging`).

Status: PLAN, reconciled 2026-10-14 against the notes, the approved mockup and the code on `feat/crew-0.14.0` @
`d6f9fe6`. Every name or number marked **[PROPOSAL]** is mine and is the user's to accept, rename or reject. Nothing
here is built. Section 4 lists the calls the user must make; slices that depend on an open call say which.

**Goal:** make the seven expedition tiers real. Each run goes to a real Milky Way region measured from the player's
own homeworld, takes a transit that grows with the tier, needs a ship whose propulsion can get there, and can be
recalled home at a 1:1 cost. Today every system is Tier I (riskFactors.ts `expeditionRegion`, line ~80), every
transit is a fixed 6 hours (expedition.ts `TRANSIT_SECONDS` 21600), there is no reach gate on expeditions and no
recall, and Help already describes Tier I to VII content (GO-19 item 4).

## 1. Source decisions (verbatim, cited)

**Scope.** E-CREW plan, 0.14.0 SCOPE ADDITIONS (user ruling 2026-10-09): "If something I've said here is not part of
the scope (within reason), make it part of the scope of 0.14.0." G2 = "galaxy-region unlocks (proposed real regions,
Local Bubble to Galactic Core), distance and difficulty, the reach gate, recall (A4 had no task)." The exploration plan
(2026-09-24, line ~396) lists "reach into expeditions + recall (A4)" as locked 0.14.0 scope.

**The original idea** (relics-v2 capture section 3): "unlock [insert a large location in our galaxy] and you look
around for a new planet as part of the scan and transit time. That way it could keep it fresh. Plus, it gives options
for people to choose if they main-line expeditions that require a bit more micromanagement, or if they just set
everyone on the lower survey missions, and call it good."

**Mockup answers (user 2026-10-12, transcript line 72995; capture section 3b).** Mockup:
https://claude.ai/artifact/MYMAwEVVpnnH62Mscmju1A (local copy `scratchpad/expedition-tiers-mockup.html`).
1. Ladder: "The ladder looks great to me! Yes."
2. Unlocking: "T1 open from the start, absolutely. But other tiers will indeed require additional upgrades to
   propulsion technology. So higher tiers will require ships capable of traveling faster and further than each before
   it. Much like Star Trek, the FTL scale will be exponential, so each decimal place of something like Warp 9.995 is
   unbelievably fast."
3. Distances: "there will be a location for your system on the map in comparison to the different locations, and the
   lightyear distance makes sense. The combination of better ships and further distances could turn the hardest
   content into a week long wait to get there."
4. Transit: "Let's start T1 at a start time of 2 hours and go up from there. These are meant to be long missions, and
   once you start, you don't want to stop them and come back to the homeworld until it's done. It's meant to be a
   painful choice if you start it at the wrong point. Of course, make sure you can cancel mid-transit too. Or you can
   indeed bring your ship back home mid-mission and you retain your progress, but you'd really have to feel
   hard-pressed to return home mid-mission."
5. Looking around: "Looking around could find the nearest options within that region of the galaxy, within a band of
   distances between the homeworld and your stop."
6. Names and homeworld: "Yes indeed. Complete with famous options that exist in reality too. I 100% want Wolf-359 to
   be one of them. With a nice easter egg. But we need to figure out precisely where our homeworld is. But just in
   case, every homeworld system should be different for each player, just in case that gets to be an online option
   between players, and you can travel around. Not 100% about it yet, but it makes sense for each system to exist in a
   different place."
7. Recall: "Yes indeed. That is exactly right. BAsed on distance traveled 1:1." (The mockup's call 7 it answers:
   "mid-transit recall turns around (home in the time flown so far); after arrival it is the full trip home; ground
   teams come up at once and heal on the way? Can you ever return to a partly finished system, or is it logged at its
   % and gone?")
8. Set and forget: "the higher level content will have new issues thrown into the mix, that will make you want to
   hand-hold the system otherwise, you might automatically deploy to something where you stand absolutely no chance in
   completing it. This will likely need some additional figuring out though. Which is fine."
9. Relic odds (G3 owns): "somewhere in the realm between \"don't give away the house\" and \"don't make this system
   feel like a chore, and reward the player enough to keep them coming back for more\"."
10. and 11. answered into Squads (built) and G7 (completion %), not G2.

**Tiers, numerals, antimatter (user 2026-10-12, transcript line 72325; gas giant design 1c).** "I like T7. 7 is my
favorite number ... The best part is that the distance requires that you can travel further than ever before. Still
not worthwhile to do T1 content in a T7 (or whatever the max is going to be) ship, but you can do it if you want. But
if you have 10 captains on long range assignments, imagine the goodies you could get." "for tier numbers and so forth,
let's make sure the game displays roman numerals." "7 is interesting to me. Annihilation Core. So with fuel being
something more like a stat, what would the antimatter containment cells do if burnt? Perhaps those can be used to
speed up the trip, but this can cause the need for a maintenance period to ensure that the extra wear on the ship
doesn't cause damage, etc. Making that rare would be good too. Though, we'd want to consider the ramifications of
something like this. We'd hav eto balance it, because we'd want to ensure that it's not overused and abused."
- Provenance note: "Annihilation Core" is MY proposed special blueprint name (gas giant v2 mockup, open call 7: "the
  four special blueprints (Ramscoop Collector, Annihilation Core, Pressure-Forged Plating, Resonance Sensor Array)").
  The user called it "interesting" and described what burning cells should do; the name is not formally approved.
  The Antimatter Containment Cell (the first radiant canister) is the user's: "my thought for the radiant quality item
  makes sense: ANTIMATTER" (gas giant 1b item 4).

**Older locked decisions G2 must honor.**
- Fuel is a stat that gates content (memory, user 2026-09-16): "Fuel = a stat (fuel capacity), INSTANT free refuel";
  purpose: gate the right ships to the right actions ("a combat captain sent long-distance dies halfway").
- Lore (transcript line 43141, 2026-09-16): "the loss of jump gates make exploring new areas to find allies and
  resources gradually grows further and further apart, with conventional FTL speeds making journeys take decades,
  unless your ships are designed for all-out speed and distance running."
- Saga design (2026-09-17): "Recall RE-RUNS that same transit home (the trip back is just as long), so recalling an
  exploration captain is a massive commitment you almost never want." July 2026 (SUGGESTIONS ~1180): "Travel is
  symmetric + real-time" (recall means flying back the same way).
- Frontier gating, I.6 LOCKED 2026-09-23 (complement plan line 86): "frontier gating (a sensor threshold to attempt
  deeper regions)". Complement plan OC-18 moved it into G2: "[PROPOSAL] move it into the G2 Expedition Tiers plan,
  which owns region unlocks and the reach gate, with a sensor threshold per region tier."
- Squads 3c: "Always require one of each type minimum." Telescope (3c): range = which systems it can pre-survey, out
  of range launches "blind"; SQ-5 calls: FULLY BLIND beyond range; a blind launch warns ("Are you sure you wish to go").
- Squads design 6.2 (built in SQ-5): "every player's Level 3 reaches the same region"; the light-years shown are that
  region's far edge measured on that player's map.
- Objective affixes 7 (user 2026-10-14): affix weights must vary "for different difficulties, planet types, tiers".
- Naming (user 2026-10-14): "objective" in all player-facing text, never "task".

## 2. Reconciliation: each G2 element vs what exists now

| G2 element | What exists (file, line) | Gap |
|:-|:-|:-|
| Seven regions, Roman numerals | `telescope.ts REGION_TIER_NAMES`, `regionTierNumeral`; `RegionTier` 1..7 (model.ts ~6692); Help prints "Tier I" via `regionTierNumeral` | Nothing assigns a region: `expeditionRegion(_seed)` returns Tier I, no enemy territory (riskFactors.ts ~80) |
| Per-tier content already keyed | `RISK_TIER_ODDS` I..VII, `tierNeeds` / `SAFE_NEEDS_MAX_TIER` 2, `HOSTILE_SITE_RULES` (colony III+, fortification VI+), `SCIENCE_HEAVY_MIN_TIER` 2, affixes `AFFIX_ROLL_TIER_MULT` / `AFFIX_RANK_WEIGHTS_BY_TIER`, `systemTaskPreview(..., region)` and `launchForecast(..., region)` take a region | All dormant above Tier I; tests force tiers by parameter only |
| Distance from the homeworld | `systemDistanceLy(seed, tier, homeworld)` on `SYSTEM_DISTANCE_SALT` 0x4b1d8e33, display only; `PROVISIONAL_HOMEWORLD` (near Sol, 26,500 ly from the core, bands I 4-150, II 150-3,000, III and IV 3,000-7,600, V -13,000, VI -25,000, VII -26,500) | One shared homeworld; distance feeds no run |
| Per-player homeworld | Every reader takes `homeworld` as a parameter (`rangeLyForReach`, `telescopeReadingAtLevel`, `telescopeCardView`, `telescopeMapView`) | No stored placement. ALL per-save seeds are fixed constants (`EXPEDITION_DEFAULT_SEED` 0x2545f491 and siblings), so every save sees the same systems today: per-player placement needs NEW per-save entropy |
| Telescope map badges | `telescopeCardDisplay.ts BADGE_POSITIONS` hand-placed for the provisional homeworld; `FIT_RADIUS` scaling; overlap and bounds tests | Must become band-relative per homeworld (SQ-7.4 carry note) |
| System names | `BANKED_SYSTEMS`, 18 hand names, picked by the FIRST draw on `SYSTEM_SALT` in `generateSystem` | No catalog names, no real stars, no Wolf 359 |
| Candidates ("looking around") | 3 candidates, `makeExpeditionSeed(expeditionSeed, i)`, ids `cand-<i>`, ship-independent; `candidateSeed` | No region choice, no distance band, no "nearest" ordering |
| Transit time | `TRANSIT_SECONDS` 21600 (6 h), `SHAKEDOWN_TRANSIT_SECONDS` 1800; return = base transit / (1 + Flight Deck ramp) (`returnDurationSeconds`); anomaly roll at 50% of base transit, +3,600 s | Not tier or distance dependent; ignores the ship's drive (`transitSpeedMult`) |
| Propulsion | FTL Drive slot `ftlDrive` (model.ts ~2148): stats `transitSpeedMult`, `engineEfficiency`, `fuelCapacity`; 3 tier-1 blueprints (Sprint / Economy / Balanced, ~8895); hull `fuelCapacity` / `engineEfficiency` | No drive class, no "faster and further" ladder; Research Lab tops out at tier 2 (complement plan OC-15) |
| Reach gate | `fuel.ts canReach` (0.13.6 parity: algebraically the old fuel check), `tick.ts shipReachesRoundTrip` + `tripReachRamp` (Engineering Constitution, Task 21), `shipTripRangeLightYears`; `LY_PER_TICK` 0.5 is display only (cancels out of the gate) | Missions and patrols only; expeditions have NO reach gate. Ship ranges read ~50 to 230 "LY", the map reads thousands of ly |
| Frontier gating (sensors) | Sensor foreknowledge thresholds 8 / 20 / 40 / 65 (expedition.ts ~298), telescope ship lift at 40 | No sensor gate on deeper regions (I.6 locked, OC-18 moved here) |
| Enemy territory | `ExpeditionRegion.enemyTerritory`, +1 combat (`ENEMY_TERRITORY_COMBAT_STEP`); the Graded reading shows it | Always false |
| Recall | None. Ground Ops has the pieces: the window end (`groundOps.ts checkRunEnd` sets `endedAt`), in-system legs (`IN_SYSTEM_LEG_SECONDS` 300), the shared pickup, the medical bay on the return trip, a team `recalled` flag for live edits (GO-7d) | No player recall of the SHIP; no cancel mid-transit |
| Annihilation Core burn | Antimatter Containment Cell is designed (gas giant 15b), not built; no maintenance process (`TimedProcessKind` has `shipRepair`, model.ts ~3990) | Everything; depends on 15b's canister items |
| Help | `helpTopics.ts` `subspaceTelescope` ("REGIONS AND RANGE ... from Tier I ... out to Tier VII"), `riskFactors`, `objectiveDifficulty` | Lines describe content that cannot occur (GO-19 item 4: land G2 or trim) |
| Body hazard vs tier | Hazard comes from planet type only (`planetTypeHazard`) | Ground Ops BALANCE FINDING (2026-10-14): Tier I runs can roll unwinnable vault sites; options pending the user (G2 is the natural place to tie hazard to tier, see open call 18) |

## 3. Slices

Every slice: one implementer, then spec review, then quality review, re-review after fixes. Gate after every slice:
`npm run check` (0 errors, the 2 known RadialWeb warnings are fine) and `npx vitest run` (all green). One commit per
slice, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, staged by explicit path.

**Determinism rules for all slices.** Randomness only via `makeRng` keyed `seed ^ SALT ^ index`, each new salt odd,
distinct and registered in `salts.test.ts`. Integer draws (`nextInt`, permille / per-mille chances), never float
thresholds. Never add a draw to an existing stream: a value no longer used keeps its draw ("draw kept, value unused",
the gas giant `scanStepRoll` precedent). No `Math.random` / `Date.now()` in engine code; the ONE new entropy source
(the homeworld seed, G2-1) enters at the UI boundary and is stored. Offline == live: one call == 997 s chunks == 1 s
chunks on every new path.

**Feature flags (in-flight runs stay byte-identical).**
- `Expedition.voyage?: ExpeditionVoyage` = `{ version: 1, tier, distanceLy, driveClass, outboundSeconds, enemyTerritory }`
  **[PROPOSAL shape]**. Present = the tier-aware transit, return and recall math. Absent (every run dispatched before
  G2) = today's `TRANSIT_SECONDS` / `SHAKEDOWN_TRANSIT_SECONDS` path, untouched.
- `Expedition.recall?: { atSeconds, phaseAtRecall, returnSeconds }` written only by the recall action; absent = no
  change anywhere. Allowed on legacy runs too (a new player action cannot alter a run nobody recalled).
- `Expedition.burn?` (G2-8) written only by a burn.
- The neutrality proof each engine slice repeats: a dispatched Tier I run with `voyage` deleted (and the pre-G2 name
  fields restored) resolves byte-identically to the G2-0 golden.

**Save.** SAVE_VERSION is 69. G2 needs ONE bump (v70) for the stored homeworld (G2-1). Run fields stay optional (the
established pattern: `voyage`, `recall`, `burn` ride the spread, no bump). The maintenance period (G2-8) reuses
`activeProcesses` with a new `TimedProcessKind` **[PROPOSAL]**; if the save validator enumerates kinds, G2-8 extends it
and folds the change into the then-current version (no second bump if v70 has not shipped to staging; otherwise v71).
Check `git log` for another slice's bump (CP plan) before taking v70.

### G2-0: Goldens first (tests only)

Capture BEFORE any engine change, in a new `expeditionTiersGoldens.test.ts`:
1. Legacy in-flight runs: a pre-G2 flagged run (Ground Ops + risk + affixes) restored from a stored record, hashed at
   five checkpoints (transit midpoint, arrival, mid-scan, window end, claim), plus a pre-Ground-Ops legacy run.
2. Fresh dispatch: `freshState` with a slotted crew, dispatch `cand-0`, `cand-1`, `cand-2`, full timelines hashed
   (phase anchors, findings, objectives, fights, claim).
3. Display: the three candidates (`expeditionCandidates`: seeds, names, foreknowledge, telescope readings) at
   telescope Levels 0, 1, 5, 8; `telescopeCardView` and `telescopeMapView` at Levels 1 and 8.
4. Reach: `shipReachesRoundTrip` and `shipRangeLightYears` for every hull x every mission and patrol (extends the
   0.13.6 `fuel-to-reach.test.ts` equivalence).
Commit `test(0.14.0): pre-expedition-tiers golden hashes (G2-0)`.

**G2-0 carry note (built 2026-10-14, on top of 3ce5404).** `src/lib/game/expeditionTiersGoldens.test.ts` (19 tests)
plus `expeditionTiersGoldens.fixture.ts` (the two STORED pre-G2 records, never regenerate them). For later slices:
- Golden 1 restores each stored record through a save stamped v69 and `migrate`. The saved state goes through
  `withoutG2State` first (drops `homeworld`, no-op today), so from G2-1 on the save truly has the v69 shape and the
  v69 -> v70 migration really seeds the homeworld. G2-1 adds an injected entropy argument to `migrate`: the
  `restored` helper's call must then pass a fixed value. The claim is hashed through `withoutG2State` and every run
  through `withoutG2Run` (drops `voyage` / `recall` / `burn`, no-op today). Golden 1 must stay unchanged in EVERY
  slice.
- Golden 2 hashes the dispatch record whole, so G2-2 (names) and G2-3 (`voyage`) compare it after restoring the
  pre-G2 names and passing the run through `withoutG2Run`; a re-pin names the field that moved.
- Golden 3's candidate and telescope hashes include every distance; G2-1 re-pins them field by field (distances only).
- Golden 4 hashes `shipRangeLightYears` and `shipTripRangeLightYears` in today's LY units: under open call 4 A the LY
  numbers move by the `LY_PER_TICK` rescale while every `shipReachesRoundTrip` and dispatch gate stays identical; split
  the gates from the readouts when re-pinning. `reach:expedition` hashes the whole Tier I `startExpedition` result
  (record and state through the strippers) from every hull, stock and boosted: all 20 launch today, and G2-4's new
  gates (drive class, reach, frontier sensors) must keep every one of them launching (`voyage` is stripped; G2-2's names re-pin it like golden 2).
- The crew is two Ground teams of rank 10 members: at rank 6 two of the three freshState candidates (at rank 3 all
  three) are still in activities at 2,000,000 s, which fits the Ground Ops balance finding (open call 18), so a
  lower-rank crew cannot reach claim.
- Parity per run: one call == 997 s chunks == 1 s steps over the 600 s around arrival == the event-boundary chain
  (t - 1, t, t + 1 at every phase anchor, step record, log line, ship leg and field repair).

### G2-1: Galaxy, homeworld placement, SAVE v70 (engine, display only)

- New pure module `galaxy.ts` **[PROPOSAL name]**: the region ladder (moved from telescope.ts, re-exported so callers
  do not change), a stylized galaxy (Sol at a fixed galactic position ~26,500 ly from the core, the region geometry
  the mockup draws), `homeworldPlacement(homeworldSeed)` (a point per open call 1) and `regionBandsFrom(placement)`
  (each region's near / far distance measured from that point; the Local Bubble band starts at the nearest-star
  distance; Perseus and Sagittarius keep sharing a band if the geometry says so).
- `GameState.homeworld: { version: 1, seed: number }` (placement DERIVED from the seed, never stored twice).
  `freshState` takes the seed as a parameter with a fixed default for tests; the UI's new-game path supplies it from
  `crypto.getRandomValues` (the only entropy; implementer finds the seam in App.svelte / save.ts load-or-create).
  `MIGRATIONS[69]` (v69 -> v70) seeds existing saves per open call 2 through an injected entropy argument (tests pass
  a fixed value); idempotent; frozen helper, hardened like v67 / v68.
- Swap `PROVISIONAL_HOMEWORLD` for `stateHomeworld(state)` in every reader (telescope reading, card view, map view,
  candidate distances). Keep `PROVISIONAL_HOMEWORLD` exported as the test fixture.
- Tests: placement determinism and bounds; bands ordered and non-overlapping where the geometry says; "distance <=
  range equals region tier <= reach tier" holds for 1,000 placements at every level; v69 -> v70 migration
  (byte-identical except `homeworld`; an in-flight run unchanged through claim); G2-0 golden 1 unchanged; golden 3
  changes ONLY in distances and ly numbers (asserted field by field).
- UI: none beyond numbers. No mockup needed.

**G2-1 carry note (built 2026-10-17, on top of 7590156).** New pure `src/lib/game/galaxy.ts` (the ladder moved there,
re-exported by telescope.ts); `src/lib/homeworldEntropy.ts` (the one entropy source, Web Crypto). For later slices:
- Data model: `GameState.homeworld?: { version: 1, seed }` (model.ts `HomeworldState`). `homeworldPlacement(seed)`
  derives `{ id, galactic, distanceFromSolLy, distanceFromCoreLy, regionBandsLy, enemySectors }`: a whole light-year
  lattice point 10 to 120 ly from Sol (rejection draw on `HOMEWORLD_PLACEMENT_SALT`, no trigonometry). Bands come from
  `regionBandsFrom(point)`: each region's far edge is `|point - anchor| + depth` (from Sol exactly the old provisional
  bands, pinned); rungs `[1] [2] [3, 4] [5] [6] [7]`, Perseus and Sagittarius share one band (its far edge the farther
  arm's), each near edge the rung below's far edge, Tier I from `NEAREST_STAR_LY` 4. Sol and everything within 150 ly
  of it (Wolf 359) is Tier I from every homeworld.
- `stateHomeworld(state)`: the stored seed's placement, or `PROVISIONAL_HOMEWORLD` (Sol, no sectors) when absent or
  malformed. Review follow-up: `migrate` also runs the idempotent `withHomeworldV70` after the loop on EVERY load, so a
  save already at v70 from a build before G2-1 gets its own homeworld too (never the shared spot). **Deviation from "a fixed default for tests"**: `freshState(seed?)` stores a homeworld ONLY when given a
  seed (App.svelte's three new-game paths always pass `drawHomeworldSeed()`); with none (tests, the sim, the wiring
  fixtures) the state has no `homeworld` and reads the provisional spot, so every golden captured on freshState stays
  byte-identical without a re-pin.
- SAVE: v70 step 3 of `MIGRATIONS[69]`, `withHomeworldV70` (frozen, idempotent: a well-formed value is the same
  reference; hardened). `migrate(save, homeworldEntropy?)` passes a `MigrationContext` to every step;
  `loadFromLocalStorage` passes a Web Crypto draw; absent, the entropy is an FNV mix of `save.created_at` (tests and
  tools stay reproducible). Three "no step" save tests (save.test.ts x2, salvageCrew.test.ts) are handed the step's
  homeworld, the SF-1 precedent.
- Readers: `telescopeReading(state)` defaults to `stateHomeworld(state)`; `expeditionCandidates` and the blind count in
  `startExpedition` pass it to `readSystem`; `telescopeCardView` defaults to it; App.svelte passes it to
  `telescopeMapView` (derived only when the seed changes). The map centers on `homeworld.galactic`; badges are
  BAND-RELATIVE (each badge's reference distance remapped into that homeworld's band; the provisional fixture gets the
  pre-G2 spots exactly); the bounds, ring-fit, overlap, in-band and badge I tests run over 200 placements.
- ENEMY TERRITORY (user G8) **[PROPOSAL layout]**: `homeworld.enemySectors`, one fixed sector per tier II to VII,
  drawn from the same seed on `ENEMY_SECTOR_SALT` (Tier I's draw kept, value unused): the tier's band across bearings
  `[startBearing, startBearing + width)` in tenths of a degree (`bearingDirection`: 0 toward the core, 900 a quarter
  turn on), width = the tier's share of a full turn `ENEMY_SECTOR_WIDTH_PERMILLE` I 0, II 50, III 150, IV 250, V 350,
  VI 450, VII 500 (open call 8's per-tier rates, so a uniform bearing lands in enemy territory at that rate). G2-2 HOOK:
  give each candidate a bearing (a NEW salt) and set `enemyTerritory = inEnemySector(home, tier, bearing)`. G2-7: shade
  the sectors on the telescope map (not drawn yet; nothing reads the sectors at G2-1).
- Goldens: G2-0 goldens 1 to 4 unchanged. Golden 1's `restored` passes a fixed entropy (`G2_1_ENTROPY`) and asserts the
  migration seeded the homeworld from it. New "G2-1 golden 3 with the homeworld" (seed `0x6a09e667`): candidates differ
  from golden 3 ONLY in `telescope.distanceLy` / `telescope.rangeLy`, the launch views not at all, the card only in its
  `rangeText` / `rangeLy` fields (asserted path by path), and pinned. Every other golden unchanged.

### G2-2: Regions for candidates; names, real stars, enemy territory (engine, display + new runs)

- The console offers candidates PER TIER (user #5: "the nearest options within that region of the galaxy, within a
  band of distances"): seeds `makeExpeditionSeed(expeditionSeed, (tier - 1) * CANDIDATE_STRIDE + i)`, with Tier I at
  `i` exactly (today's three seeds, so Tier I bodies, risk and objectives are byte-identical). Ids `cand-<tier>-<i>`;
  legacy `cand-<i>` maps to Tier I. Sorted nearest first by `systemDistanceLy` in the region's band.
  **[PROPOSAL]** `CANDIDATE_STRIDE` 16, 3 candidates per tier.
- `expeditionRegion(seed)` is replaced by the candidate's region `{ tier, enemyTerritory }`, threaded through
  `expeditionRiskPreview`, `previewRun`, `systemTaskPreview`, `launchForecast`, `expeditionLaunchView` and
  `startExpedition` (all already take or default a region). Enemy territory (user G8, 2026-10-16: "Fixed sectors on
  the map", NOT a per-system draw): G2-2 OWNS flagging candidates. Each candidate gets a bearing from the homeworld
  (integer tenths of a degree, galaxy.ts `bearingDirection`, on a NEW salt), and its `enemyTerritory` is
  `inEnemySector(stateHomeworld(state), tier, bearing)` against the fixed sectors G2-1 placed from the homeworld seed
  (`homeworld.enemySectors`, one per tier II to VII). Tier I has no sector, so Tier I stays identical. The bearing is
  frozen on the dispatch record with the region so a run never re-reads the homeworld. G2-7 OWNS shading the sectors
  on the telescope map.
- Names (user #6 "Yes indeed" to catalog codes): `regionCode-NNNN` (LB, OR, PE, SA, SC, GB, GC, the mockup's codes)
  and bodies lettered b, c, d. The FIRST `SYSTEM_SALT` draw (today's banked-name pick) is KEPT and its value unused,
  so body count, sizes and planet types draw exactly as today. A name stream on a new `SYSTEM_NAME_SALT`.
- Real stars (user #6): a small `FAMOUS_SYSTEMS` catalog **[PROPOSAL list, astronomy verified at build]**: Tier I
  Alpha Centauri, Barnard's Star, **Wolf 359**, Sirius, Epsilon Eridani, Tau Ceti, Altair, Vega, Fomalhaut,
  TRAPPIST-1, 51 Pegasi; Tier II Polaris, Betelgeuse, Antares, Rigel, Deneb, the Orion Nebula region; Tier III the
  Double Cluster; Tier IV the Lagoon and Eagle Nebula regions, Eta Carinae; Tier V Westerlund 1; Tier VI Terzan 5;
  Tier VII Sagittarius A*. Each with a Sol-relative position; its distance is measured from the player's homeworld
  and its tier is the region it lies in from there. A candidate slot becomes a famous system on a permille draw
  (new `FAMOUS_SYSTEM_SALT`) **[PROPOSAL 1 in 12]**; Wolf 359 per open call 10.
- Bodies per tier **[PROPOSAL, open call 17]**: Tier I keeps 1 to 3 (byte identity); higher tiers draw an EXTRA body
  count on a new salt (mockup ranges II 1-3, III 2-3, IV and V 2-4, VI and VII 3-5).
- Tests: per-tier candidates (count, band, nearest-first order, stable across ticks, advance only on dispatch);
  preview == run at every tier I..VII (risk, objectives, needs, hostile sites) on 16 seeds each; Tier I dispatch with
  names restored == G2-0 golden 2; a candidate is enemy territory exactly when its bearing lies in its tier's sector
  (the frequency per tier within tolerance of the sector widths); famous systems land in the right tier for 1,000
  homeworld placements; salts registered.
- UI: the console still shows Tier I only (G2-6 adds the picker); a hidden region is reachable by tests only.

**G2-2 carry note (built 2026-10-19, on top of a678241).** New pure `src/lib/game/starCatalog.ts` (region codes,
body letters, `FAMOUS_SYSTEMS` with real galactic coordinates, measured from the homeworld). For later slices:
- Candidates: `expedition.ts tierCandidateSystems(state, tier)` (identity: seed, name, famous id, bearing, distance,
  region) and `candidateSystemById` (`cand-<tier>-<slot>`, legacy `cand-<slot>` = Tier I; leading zeros refused);
  `expeditionCandidates(state, shipId, tier = 1)` adds `region` to each candidate. **Deviation:** the ENGINE keeps
  slot order; the console sorts nearest first (`expeditionDispatchDisplay.ts nearestFirst`), so no list index moved
  under a test, the sim or a probe. G2-6's picker passes the tier and keeps `nearestFirst`.
- Names: `LB-0472` style on `SYSTEM_NAME_SALT`; famous slot 1 in 12 on `FAMOUS_SYSTEM_SALT` (never twice in one list);
  Wolf 359 on Tier I slot 0 when exactly `WOLF_359_LIST_AFTER_DISPATCHES` (1) expeditions were dispatched.
  **Review ruling (user 2026-10-19, "Next list for veterans"):** a veteran save (`runCounts.expedition.veteran`) that
  never met it gets it on slot 0 of its NEXT freshly generated Tier I list, once: its first dispatch under 0.14.0
  writes `GameState.wolf359List` (`expedition.ts wolf359ListAfterDispatch`: the list it dispatched from when that list
  already held Wolf 359, else the next count). The list on screen is never rerolled; a save that is not a veteran never
  carries the key. Golden moved: only `firstRunsGoldens.test.ts old:v69` (the veteran's claimed state carries the
  stamp; the test proves the state without it hashes as before). Its nod is still the user's (G2-7).
  Eta Carinae sits at 7,470 ly (inside the 2.3 kpc estimate) so it stays inside the shared Tier III/IV band from
  every homeworld; a famous Tier I star nearer than the band's 4 ly edge is clamped into the band.
- Bodies: `generateBodies(seed, tier)`; the system stream's first draw (the banked pick) and its 1 to 3 count draw are
  kept on every tier; deeper tiers draw the count on `BODY_COUNT_SALT` (`TIER_BODY_COUNT`, user G17).
- Run: `Expedition.region = { version: 1, tier, enemyTerritory, bearing, distanceLy }` (model.ts
  `ExpeditionRegionStamp`), written only by startExpedition. G2-3's `voyage` can read `distanceLy` from it. Its
  presence letters bodies b, c, d (`groundTaskQueueDisplay.ts bodyDesignation`) and the in-flight header names the
  region (`runRegionText`). The tier haul (`riskFactors.ts TIER_HAUL_MULT`, user G16) multiplies `taskFullHaul` by
  the STAMP's tier, so a forced-tier fixture without a stamp and every pre-G2-2 run roll as before.
- `expeditionRegion(seed)` is gone: previews default to `TIER_I_REGION`; `readSystem` takes the candidate's distance.
- Goldens: no hash re-pinned. Pre-G2 goldens compare through `awayTeamTestFixtures.ts asPreG2NamesDispatch` (banked
  name back, stamp dropped) and `asPreG2Candidate` (old id and name, no `region`, a famous system's drawn distance);
  golden 3 asserts nothing else moved. Tests forcing Tier IV now dispatch `cand-4-0` (bodies grow with the tier).
- Registry: the telescope reach rows, `tierDormant` (now listing the tier haul, the tier body counts and the deeper
  famous systems), `blindLaunch` and `oddsRiskyBelow` re-owned from G2-2 to G2-6 (the engine reaches every tier and
  `expeditionTierCandidates.test.ts` proves it; no player does until the picker). G2-6 flips them live.
- G2-6 note (review 2026-10-19): `TIER_HAUL_MULT` and `TIER_BODY_COUNT` need their OWN registry entries, each with a
  probe, when G2-6 flips the tier rows (today they ride the `away:audit:tierDormant` row's claim only).

### G2-3: The voyage engine (transit by tier, distance and drive)

- `startExpedition` writes `voyage` (tier, distance, the ship's drive class at dispatch, `outboundSeconds`).
  `baseTransitSeconds(exp)` reads `voyage.outboundSeconds` when present; the anomaly roll stays at 50% of it;
  `returnDurationSeconds` mirrors it (still divided by the Flight Deck ramp); Ground Ops and the scan driver read
  phase anchors only, so they follow.
- `outboundSeconds` per open call 5 **[PROPOSAL]**: nominal one-way hours at the tier's minimum drive class, I 2,
  II 4, III 8, IV 12, V 24, VI 72, VII 168 (a week, user #3); scaled 0.75 to 1.25 by where the system sits in its
  band (nearest options are shorter, user #5); divided by 2 for each drive class above the tier's minimum (the
  exponential scale, user #2); divided by the ship's folded `transitSpeedMult` (what the drive item's quality already
  means for patrols); floored at 30 minutes; whole seconds. Why not plain distance / speed: real bands run 150 to
  26,500 ly (x177) while the wanted times run 2 h to a week (x84), so a speed that grows exponentially per class would
  make Tier IV (nearer than Tier III) and Tier VII (6% farther than VI) collapse to minutes. The light-years drive the
  reach gate (G2-4) and the within-band scale; the tier drives the hours.
- Shakedown (open call 6): the inaugural run keeps `SHAKEDOWN_TRANSIT_SECONDS` **[PROPOSAL]**.
- Anomaly detour: `ANOMALY_EXTRA_SECONDS` scales with the outbound time **[PROPOSAL 25% of outbound, 1 h max at Tier
  I parity]**, frozen on the voyage. Open call 5 covers it.
- Tests: transit table per tier and class; band scaling; floor; legacy path untouched (golden 1); a Tier I dispatch
  with `voyage` deleted == golden 2; parity (one call == 997 s == 1 s) on Tier I, IV and VII runs with Ground Ops,
  the anomaly, a field repair and the Flight Deck ramp.

**G2-3 carry note (built 2026-10-19, on top of 1c512fc).** New pure `src/lib/game/voyage.ts` (the ladder, the band
scale, the class halving, `planVoyage`, `voyageOf`). For later slices:
- Run: `Expedition.voyage = { version: 1, tier, distanceLy, driveClass, outboundSpeed, returnSpeed, outboundSeconds,
  returnSeconds, anomalySeconds }` (model.ts `ExpeditionVoyage`), written only by startExpedition (beside the G2-2
  region stamp; the forecast's throwaway run carries none, it never flies a leg). **Shape deviation:** no
  `enemyTerritory` (the region stamp holds it); per-leg speeds and seconds instead of one `outboundSeconds` (CP-2
  OC-E5: Fast Departure lifts the outbound leg, Fast Return the return leg, the Pilot's officer.transitTimeCut both).
  `expedition.ts candidateVoyage(state, ship, cand, training)` is the console's transit row for G2-6.
- One leg = round(TIER_TRANSIT_HOURS x 3,600 x band scale / 2^(class - tier) / leg speed), floored at 30 minutes (user
  G5). `tierMinimumDriveClass(tier) = tier` and `STANDARD_DRIVE_CLASS` 1: G2-4 replaces the latter with the ship's real
  class and adds the gate (a class below the tier is refused there; the engine never halves below 0 steps).
- `baseTransitSeconds` / `baseReturnSeconds` / `anomalyDetourSeconds` read the voyage; without one (every run in flight
  at the update) the fixed pre-G2-3 legs: `TRANSIT_SECONDS` 6 h, the shakedown's 30 minutes, the flat anomaly hour. A
  training run dispatched before G2-3 keeps 6 h (the tutorial constant equaled it then).
- Training run: `TUTORIAL_TRANSIT_SECONDS` moved to voyage.ts (re-exported), now the Tier I nominal (7,200 s): the
  training run flies exactly the voyage an ordinary run of the same ship to the same system flies.
- Shakedown (open call 6): moot, SF-2 retired it before G2-3.
- [PROVISIONAL] `VOYAGE_BAND_SCALE_PERMILLE` (x0.75 near edge to x1.25 far edge) and `VOYAGE_ANOMALY_DETOUR_PERMILLE` 250
  (25% of the outbound leg, no cap): the plan's open call 5 recommendation; the recorded G5 answer names only the
  ladder, the halving and the floor. Note for the user: at x0.75 to x1.25 a far Tier III system (up to 10 h) can
  outlast a near Tier IV one (from 9 h); at x0.8 to x1.2 the two only meet (9.6 h). At the same band position every
  tier is longer than the one below.
- G2-5 (recall): "distance flown" is `voyage.outboundSeconds` elapsed (never the detour, user G14); the return of a
  recalled run reads its own leg speed (`returnSpeed`).
- Speed seam: the time skip finishes a voyage run at its natural end (tested at Tiers I, IV, VII). Overtime stays off
  expeditions (credit sinks USER ANSWERS).
- Wiring: the ship speed sources are live at `expedition:groundOps` (the gear line, the ten hulls, the museum, the
  Pilot, Fast Departure, Fast Return), probed by the voyage's frozen leg speeds (probes.ts `sheetTransit` /
  `sheetOutLeg` / `sheetBackLeg`); each stays pending for the patrol (OC-D8). New audit rows
  `expedition:audit:voyageDeepTiers` (owner G2-6) and `expedition:audit:voyageDriveClass` (owner G2-4).
- Goldens: `voyageGoldens.test.ts` (two stored pre-voyage records: a training run, a veteran's Tier IV run) captured
  first and unchanged. Pre-G2-3 goldens compare through `awayTeamTestFixtures.ts withoutVoyage`, now folded into
  `withoutG2Names` and `withoutSafeFirstRuns` (a run from before either had no voyage); no hash re-pinned except
  `shortRangeGoldens` `registry` (the two added audit rows only, proven by a hash without them). Behavior tests updated
  on purpose: the sim's allAuto seed 0 now claims and relaunches inside its horizon; launchPreview scans a deeper
  run from its own arrival; safeFirstExpedition asserts the voyage.

### G2-4: Propulsion, the reach gate, frontier sensors (engine)

- Drive class (open call 3, open call 20) **[PROPOSAL]**: a `driveClass` 1..7 on FTL drive blueprints; every existing
  drive and Standard-Issue piece is Class I (derived, no save change); six new blueprint rows (Class II..VII, one
  per class at first, Balanced ratios) in data. Recipes **[PROPOSAL]**: Class III+ take Deuterium (the G8 "deuterium as
  a reach-crafting input", S4-A05, lands here); Class VI and VII take an Antimatter Containment Cell (15b) or wait
  for it. Research: Class II at Lab tier 2; III..VII need Lab tiers the Lab does not have yet (complement OC-15).
- Tier gate: the installed drive's class >= the region tier ("ships capable of traveling faster", user #2).
- Reach gate ("and further") per open call 4 **[PROPOSAL A]**: deep-space reach = the ship's gear-inclusive range
  (`shipRangeLightYears`) x `DRIVE_CLASS_REACH_MULT[class]` (exponential, about x2.4 per class) x (1 + the Engineering
  long-haul ramp on the voyage's own round-trip hours, `tripReachRamp`), against the round trip (2 x distance).
  `LY_PER_TICK` is rescaled so ranges read in the map's light-years (display only: it cancels out of every mission
  and patrol gate, so 0.13.6 eligibility stays byte-identical; G2-0 golden 4 proves it). A combat hull with a small
  tank still cannot go deep (the locked fuel purpose).
- Frontier gating (I.6 locked; OC-18) per open call 7 **[PROPOSAL]**: sensors needed to attempt a tier, I 0, II 10,
  III 20, IV 30, V 40, VI 55, VII 65 (crew-inclusive, the dispatch snapshot's `sensorPower`).
- New dispatch block reasons with text (exhaustive switch): `driveClassTooLow` ("Needs a Class III drive to reach the
  Perseus Arm"), `outOfReach` ("Beyond this ship's reach: 12,400 ly round trip, the ship reaches 9,800 ly"),
  `frontierSensors` ("Needs sensors 30 to chart the Sagittarius Arm"). A blind launch stays allowed (telescope).
- Tests: every gate both sides; the ramp extends reach exactly as `shipTripRangeLightYears`; mission and patrol
  eligibility unchanged for every hull x mission (golden 4); the drive class reader on legacy pieces; blueprints mint.

### G2-5: Recall (engine)

- `canRecallExpedition` / `recallExpedition(state, expeditionId)` (pure; same-reference refusal). Allowed in transit,
  scanning and activities; refused in return and complete. Writes `recall` and moves the run to `return`.
- Return time "based on distance traveled 1:1" (user #7) **[PROPOSAL details, open calls 12 to 14]**: in outbound
  transit, the outbound time flown so far toward the system (anomaly detour time not counted); after arrival, the
  full outbound time. The Flight Deck ramp applies as on a normal return. Never longer than a normal return.
- After arrival: the Ground Ops window closes at the recall instant (a `closeGroundOps(exp, t)` beside
  `checkRunEnd`); objectives in progress stop with progress kept (the GO persistent-progress rule; haul from finished
  segments, relic rolls only at 100%, the mockup's user-badged line); teams on a surface come up on the shared
  in-system pickup (`IN_SYSTEM_LEG_SECONDS`) before the return leg starts; the medical bay works on the way home.
- "You retain your progress" (user #4) per open call 12 **[PROPOSAL]**: the findings so far come home and claim
  normally; the system is logged at its completion % (G7); it is not resumable in 0.14.0.
- Tests: recall at every phase and at phase boundaries; 1:1 times; the pickup; kept findings; claim of a recalled run
  frees the captain and ship; parity (one call == chunked) with recall mid-transit, mid-scan, mid-fight and during a
  field repair; a never-recalled run byte-identical (goldens 1 and 2).

### G2-6: Dispatch console and recall UI (needs a mockup sign-off)

- ExpeditionPanel: a region picker (seven tabs I..VII, Roman numerals, each with its state: Ready, or the first unmet
  gate in plain words), the three nearest candidates of the picked region, and on each candidate card new rows for
  distance from your homeworld, one-way transit at this ship's drive, the reach check (a bar like the mockup's
  section 4), drive class and frontier sensors (met / unmet). The blind confirm (SQ-7) is unchanged.
- In-flight view: a Recall button with a confirm that names the return time and what stops ("Recall Aurora? It flies
  home in 3 h 10 m, the distance it has covered. Objectives in progress stop; finished work comes home.")
  **[PROPOSAL text]**, then a "Recalled" state on the phase stepper and the claim card.
- Mockup coverage: the approved tiers mockup covers the ladder and map look, the reach bar and the recall-slider
  concept. It does NOT cover the in-game region picker, the gate rows on the candidate card, or the recall confirm and
  state. **Mockup sign-off required** before G2-6 builds.
- 375 px, no sideways scroll; SVG glyphs only (lock, drive, reach, recall glyphs in `icons.ts` + `ICON_SEMANTICS`,
  reviewed at 16 / 28 / 56 px); keyboard reachable tabs; text rules below.

### G2-7: Telescope map per homeworld, Wolf 359, Help (UI + content)

- `telescopeMapView`: badge spots band-relative per homeworld (inside each region's band as measured from it), the
  bounds and overlap tests run over 200 placements (SQ-7.4 carry note); the homeworld dot at its own position.
  No new mockup: the SQ-7.4 card is approved; this keeps it correct per player.
- Wolf 359 easter egg per open call 10 (content only, no franchise reference).
- Help (GO-19 item 4): `subspaceTelescope` (where to upgrade: Facilities; the per-player homeworld), `riskFactors`
  and `objectiveDifficulty` lines become true; a new "Expedition Tiers" topic (regions, drive class, reach, frontier
  sensors, transit, recall); the `fuel` topic gains deep-space reach. Numbers read from engine constants; the
  helpTopics text-rules test covers the new topic.

### G2-8: Antimatter burn and maintenance (after 15b; needs a mockup sign-off)

- Depends on 15b's Antimatter Containment Cell item and its special-blueprint lane. Per open call 15
  **[PROPOSAL]**: a ship with the Annihilation Core installed may burn cells AT DISPATCH (a stored choice, so the run
  stays a pure function of its record): each burn halves the outbound transit, at most one burn per leg, cells per burn
  by tier; on arrival home the ship enters a MAINTENANCE period (a timed homeworld process gating the next launch,
  like a Shipyard repair) of 50% of the time saved, which Engineering crew and officers shorten. Never damage, never a
  failure roll (peace rule).
- Tests: burn math, cell spend, refusal without cells or the Core, maintenance gate and countdown, parity.
- Mockup sign-off required (the burn choice on the dispatch card and the maintenance state).

### G2-9: Close-out

Holistic review (bug-check subagent, then a full-ledger fix pass), carry notes into this doc and the E-CREW plan,
Help re-check against GO-19 item 4, the QA sheet (section 5) to the user. Deploy only after the user confirms.

**Text rules (every slice).** No em dashes and no double hyphens anywhere (text, code, comments, docs); US English; "install",
never fit / fitting / fitment; "objective", never "task", in player-facing text (code names stay); every tier number
shown in game in Roman numerals; graphics are SVG glyphs in `icons.ts` with `ICON_SEMANTICS`, no emoji; no franchise
names in game text (the Wolf 359 nod stays original).

## 4. OPEN CALLS for the user

1. **Where homeworlds sit.** [PROPOSAL] a random point inside the Local Bubble, 10 to 120 ly from Sol, so Tier I stays
   "local", Wolf 359 stays a Tier I system, crew transports from Earth stay plausible, and players differ by tens of
   ly. Alt: anywhere in the Orion Arm (the Local Bubble may become Tier II for some). Alt: anywhere in the galaxy (the
   named ladder no longer means the same thing to every player).
2. **Existing saves.** [PROPOSAL] each gets its own random placement at the v70 migration (candidate distances change,
   display only). Alt: existing saves keep the near-Sol provisional spot, only new games are random.
3. **Where propulsion comes from.** [PROPOSAL] Class II to VII FTL drive blueprints from the Research Lab (needs Lab
   tiers 3 to 7). Alt: an account-wide propulsion research track that raises every drive's class. Alt: class from the
   drive's rarity band (no new items).
4. **The reach scale.** [PROPOSAL A] one reach stat in real light-years: today's range x an exponential drive class
   multiplier x the Engineering ramp, with `LY_PER_TICK` rescaled (every mission and patrol LY readout grows; gates do
   not change). Alt B: the drive class alone gates tiers (fuel and range gear do nothing on expeditions). Alt C: the
   mockup's per-region ratings in today's LY units (T1 60 to T7 420).
5. **Transit times.** [PROPOSAL] one-way at the minimum class: I 2 h, II 4 h, III 8 h, IV 12 h, V 24 h, VI 72 h,
   VII 168 h; 0.75 to 1.25 by band position; halved per class above the minimum; 30 minute floor; anomaly detour 25% of
   outbound. Alt: pure distance over speed (section G2-3 shows why the ladder collapses). Alt: flat per tier.
6. **The shakedown.** [PROPOSAL] keep the 30 minute inaugural run (the saga's "dip your toes" onboarding). Alt: the
   first run is a normal 2 hour Tier I.
7. **Frontier sensors (locked I.6).** [PROPOSAL] sensors I 0, II 10, III 20, IV 30, V 40, VI 55, VII 65 to attempt a
   tier. Alt: sensors shape only what a scan reveals (fewer gates, but it reopens a locked decision).
8. **Enemy territory.** [PROPOSAL] a per-system chance by tier, I 0, II 5, III 15, IV 25, V 35, VI 45, VII 50 percent.
   Alt: fixed sectors on each player's map, shaded on the telescope map. (No enemy faction is named; it stays
   "enemy territory".)
9. **The 18 banked names.** [PROPOSAL] retire them from new candidates (in-flight runs keep theirs). Alt: keep them as
   rare hand-named finds beside the real stars.
10. **Wolf 359 and its easter egg.** [PROPOSAL] Wolf 359 is guaranteed in the first Tier I list after the shakedown;
    its nod is yours to name (an original idea, for example a field of very old derelict hulls with a one-time
    Survey Log entry). Alt: a rare find like the other real stars.
11. **Looking around.** [PROPOSAL] pick a region, see its three nearest candidates, pick one (today's console per
    tier). Alt: the mockup's on-arrival sweep with a "Search for" preference.
12. **"You retain your progress."** [PROPOSAL] a recalled run brings its findings home and the system is logged at its
    completion %; no return to it in 0.14.0. Alt: the system stays resumable for that ship (bigger: stored bodies and
    objectives, a skip-the-scan relaunch).
13. **Recall friction.** [PROPOSAL] one confirm naming the return time. Alt: no confirm (inform only).
14. **Recall mid-detour.** [PROPOSAL] anomaly detour time does not count as distance flown. Alt: it counts.
15. **The antimatter burn.** [PROPOSAL] name Annihilation Core (yours to confirm); burn at dispatch only; halves a leg;
    one burn per leg; maintenance at home of 50% of the time saved; built after 15b. Alt: burn any time mid-transit.
    Which slot holds the Core (an FTL drive variety, or an E-MOD module) is open.
16. **Tier reward.** [PROPOSAL] G2 adds the mockup's per-tier haul multiplier (I 1, II 1.25, III 1.5, IV 1.8, V 2.2,
    VI 2.7, VII 3.3); relic odds stay G3. Alt: leave all reward to G3 and the balance pass (higher tiers would pay the
    same haul for a week's trip).
17. **Bodies per tier.** [PROPOSAL] Tier I keeps 1 to 3; deeper tiers grow to the mockup's ranges (up to 3 to 5).
    Alt: 1 to 3 everywhere.
18. **Hazard by tier (Ground Ops balance finding).** [PROPOSAL] G2 caps Tier I and II body hazard so the unwinnable
    vault rolls cannot occur in the practice tiers. Alt: leave hazard to planet type and solve it in the ground fight.
19. **Set and forget.** [PROPOSAL] no "Repeat in this region" in 0.14.0 (your #8: "needs additional figuring out").
    Alt: Repeat for Tiers I and II only.
20. **Drive class wording.** [PROPOSAL] "Class IV drive", Roman numerals, no franchise "warp" term. Alt: a decimal
    speed rating shown on a compressive scale (your Warp 9.995 example, in our own words).
21. **Tier III vs IV distance.** [PROPOSAL] keep the approved ladder; a Tier IV trip is longer than Tier III though
    Sagittarius is nearer (tiers are difficulty, distance shifts time only inside a tier). Alt: Tier IV trips run
    shorter.

## 5. QA list (desktop 1280 px and mobile 375 px)

1. Fresh save: the console shows seven region tabs; Tier I ready; II to VII say the first unmet gate in plain words.
2. Tier I candidate: region, distance from your homeworld, about 2 h one-way (by its band position), reach bar met.
3. Two fresh saves show different homeworld positions and different distances; the telescope map badges sit in their
   bands with nothing overlapping, at Levels 1 and 8, at 375 px.
4. An existing save loads (v69 -> v70); an expedition already in flight finishes exactly as before.
5. Install a Class II drive: Tier II opens if reach and sensors allow; transit reads about 4 h; a Class III drive
   halves it.
6. A small-tank combat hull with a Class II drive: "Beyond this ship's reach" with both numbers.
7. Seat an Engineering officer with Constitution: the reach bar grows on long voyages only.
8. Frontier sensors: a ship below the tier's threshold is refused with the number; above it, allowed.
9. Blind launch to a tier beyond the telescope: the existing warning appears; the launch proceeds.
10. Recall mid-transit at 40%: return time equals the time flown; the ship arrives home; claim frees the captain.
11. Recall during ground work: teams come up, the return starts after the pickup, finished work is in the claim,
    an objective at 60% shows its progress logged.
12. Recall refused while already returning.
13. Wolf 359 appears in the first Tier I list after the shakedown; its nod triggers once.
14. Mission and patrol eligibility unchanged for every ship (LY numbers may read larger if call 4 A is chosen).
15. Help: the Expedition Tiers topic, the telescope topic (says where to upgrade), the fuel topic; no em dash, no
    "task", no "fit", Roman numerals everywhere a tier shows.
16. After G2-8: burn cells at dispatch, outbound halves, maintenance blocks the next launch with a countdown.
17. Regression: Ground Ops runs, affixes, field repair, telescope card, recommendation and forecast at Tier I.

## 6. Scope and size (honest)

- Size: 10 slices (G2-0 to G2-9), comparable to Squads + Subspace Telescope (SQ-1 to SQ-7 plus follow-ups). The heavy
  ones are G2-3 (every phase duration and the Ground Ops anchors), G2-5 (closing a live Ground Ops window, pickups,
  parity) and G2-2 (candidate plumbing through six preview functions). Rough estimate: 2,500 to 4,000 lines of code
  and tests, about two to three working days of slices plus review passes, more if the review loops are long.
- Hard dependencies: per-save entropy (G2-1) is the only new kind of input; drive classes V to VII need Research Lab
  tiers that do not exist (complement OC-15); the burn needs 15b, which the build order puts AFTER G2.
- Could move to 0.14.x without leaving a dead stat or a false Help line:
  - G2-8 (antimatter burn): nothing shows it until 15b ships cells anyway. Strongest cut.
  - Famous stars beyond Wolf 359, and open call 12's resumable systems.
  - Drive Classes V to VII blueprints, IF Help and the console say plainly that those tiers need drives not yet
    available (the tabs stay visible and honest); otherwise Help must trim the Tier V to VII lines (GO-19 item 4).
  - Frontier sensor gating, only if the user reopens the I.6 lock (call 7 Alt).
- Do not cut: G2-1 to G2-5 and G2-7. Help already promises tiers, regions and recall; shipping without them leaves the
  telescope's upper rungs, hostile sites, two-squad objectives and the forecast unreachable.

## 7. Conflicts with earlier decisions (for the user)

1. Transit: the saga design (2026-09-17) and the code (`TRANSIT_SECONDS`) set the first real long-haul at 6 hours;
   your 2026-10-12 answer starts Tier I at 2 hours. This plan follows the newer answer.
2. Unlocking: the mockup proposed account-wide charting points (300 per region); your answer makes propulsion the
   gate. This plan drops charting points.
3. Reach units: the mockup kept today's LY units; your answer wants the map's light-years. Call 4 picks a unit; A
   changes every displayed LY number (not any gate).
4. Frontier gating: the locked I.6 sensor gate sits beside your propulsion gate, giving up to three gates per tier
   (drive, reach, sensors) plus the telescope reading. Call 7 keeps the lock; flagged as friction under "sell peace".
5. Per-player homeworlds vs the named ladder and Earth transports: a homeworld far from Sol breaks "Local Bubble" as
   Tier I and the crew transports from Earth; call 1 proposes staying inside the Local Bubble.
6. "Annihilation Core" is my proposed name, not yet approved; its cells come from 15b, which builds after G2.
7. Recall: the saga's "the trip back is just as long" matches after arrival; mid-transit, your 1:1 answer makes it
   shorter. No conflict, a refinement.

## USER ANSWERS (2026-10-16)

- **G5 / OC-5 transit times:** "2h to 168h ladder (Recommended)": one way at the minimum class I 2 h, II 4 h, III 8 h,
  IV 12 h, V 24 h, VI 72 h, VII 168 h; halved per drive class above the minimum; 30 minute floor.
- **G3 / OC-3 propulsion source:** "A combination of higher tier ships and better drive blueprints/stats/etc." Reading
  [PROPOSAL detail]: a ship's drive class comes from BOTH its hull tier (higher tier hulls carry a better base class)
  and its installed FTL drive (better drive blueprints and their rolled stats raise it); neither alone is the gate.
- **G7 / OC-7 frontier sensors:** "Sensor gate per tier (Recommended)": I 0, II 10, III 20, IV 30, V 40, VI 55, VII 65.
- **G2 / OC-2 existing saves:** "Random for everyone (Recommended)": each existing save gets its own random homeworld
  at the v70 migration (display distances only).
- **G8 / OC-8 enemy territory (2026-10-16):** "Fixed sectors on the map" (NOT the per-system chance). Enemy territory
  is fixed regions on each player's galaxy map, shaded on the telescope map; candidates inside a sector are enemy
  territory. Sector layout per homeworld is [PROPOSAL] for the G2 build.
- **G16 / OC-16 tier rewards:** "Haul x1 to x3.3 now (Recommended)": I 1, II 1.25, III 1.5, IV 1.8, V 2.2, VI 2.7,
  VII 3.3; relic odds stay with Relics v2.
- **G10 / OC-10 Wolf 359:** "Guaranteed early (Recommended)": guaranteed in the first Tier I list after the first run;
  its nod is the user's to name later (OPEN).
- **G9 / OC-9 banked names:** "Retire them (Recommended)": new candidates use real star names; in-flight runs keep theirs.
- **Non-explorer hulls (2026-10-16, user):** no current non-explorer hull can reach ANY expedition system ("their
  ships/cores don't have enough capacity and/or speed to get them there"). G2-4's reach / drive gate must refuse every
  non-explorer hull, Tier I included, with the reason shown. (Today any hull can launch: fix in G2-4.)
- **G1 / OC-1 homeworlds:** "Local Bubble, 10-120 ly (Recommended)".
- **G4 / OC-4 reach:** "One reach stat (Recommended)": real light-years = today's range x drive class multiplier x
  Engineering; mission / patrol LY displays grow, their gates do not change.
- **G11 / OC-11 picking:** "Region, then 3 nearest (Recommended)".
- **G12 / OC-12 recall:** "Resumable" (NOT the recommendation): a recalled system stays open for that ship to return
  and finish (stored bodies and objectives, a skip-the-scan relaunch). Bigger build: G2-5 grows; details asked.
- **Resumable recall details (2026-10-16):** "Any explorer (Recommended)" can resume; it stays open "Until finished
  (Recommended)" in a Resume list until finished or abandoned; on resume "Pick up where you left off (Recommended)":
  finished scans stay done (skip to the next body), objectives keep progress, travel is paid again.
- **G13 / OC-13 recall confirm:** "One confirm (Recommended)": shows the return time and that the system can be resumed.
- **G17 bodies:** "Grows with tier (Recommended)": Tier I 1 to 3, deeper tiers up to 3 to 5.
- **G19 Repeat:** "Not in 0.14.0 (Recommended)".
- **G20 wording:** ""Class IV drive" (Recommended)": roman numerals, no "warp".
- **G21 + G14 time:** "Tiers set the time (Recommended)": tiers are difficulty; distance shifts time only within a
  tier; detour time is not distance flown on recall.
