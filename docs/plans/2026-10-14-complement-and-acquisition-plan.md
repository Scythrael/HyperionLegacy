# Complement and Acquisition (E-CREW Tasks 23 to 33, G5, G6, 0.14.0) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan slice by slice
> (the user's standing workflow: one fresh implementer per slice, two-stage review per slice, holistic review at the
> end, QA sheet to the user, deploy only on the user's word).

**Goal:** Finish the crew layer the player can see. Every complement buff does something; the complement can be
moved, curated, graduated and read as a manifest; caps are per hull; crew changes lock while a ship is out and a
scrapped hull never strands anyone; the Bridge, Crew Quarters and early Sensor Array can finally be researched,
crafted and installed, with hull-type bonuses (G5) and the sensor roles (G6); and the small locked crew features
(final-retirement warning, Hall of Command, roster dropdown, soft level cap, bigger boards, graph colors) land.

**Architecture:** Additive and flag-neutral, the Ground Operations way. Complement consumers that act on a run are
FROZEN at dispatch onto new optional fields of the Ground Ops record (absent = today's number), so every run
dispatched before a slice resolves byte-identically. Ship-sheet consumers ride the existing crew map
(`crewOverlay.ts applyCrewOverlay`) or the existing direct-read seams (repair divisor, mission output), each a no-op
at zero. Golden hashes are captured BEFORE the first engine edit (CP-0).

**Tech stack:** Svelte 5 (legacy mode) + TypeScript, Vitest. Engine in `src/lib/game/*.ts` (pure), UI in
`src/lib/*.svelte` + `src/App.svelte` handlers.

**Sources (authority order: user decisions > design > code):**
- `docs/plans/2026-10-02-crew-made-real-e-crew-plan.md`: scope ruling (22), G5 / G6 (36 to 39), build order (46 to
  54), Tasks 23 to 33 (866 to 945), Task 21 carry (727 to 729), Task 22 carry (818 to 854), Task 16 carry (539 to 546).
- `docs/plans/2026-10-02-crew-made-real-e-crew-design.md`: D12 (31), D14 (33), D23 (143 to 155), D26 (244 to 259),
  5.6 (359 to 361), 6.2 (378 to 382), 6.3 (384 to 389), 8 (424 to 427), 9 (429 to 432).
- `docs/plans/2026-09-22-crew-0.14.0-plan.md` (the locked crew spec): 99 to 107, 109 to 115, 136 to 139, 147 to 161,
  172 to 189, 251 to 258, 425 to 427, 438 to 489.
- `docs/plans/2026-09-15-exploration-crew-saga-0.14.0-design.md`: C.2 (248 to 255, 296 to 307, 334 to 339), I.6
  sensors (571 to 579).
- `docs/plans/2026-10-09-relics-v2-and-expedition-tiers-capture.md` section 4 (151 to 157, the user's re-statement).
- `docs/plans/2026-10-09-ground-operations-plan.md` (GO-2 crew sync 326 to 331, GO-8b field repair 2018 to 2027,
  GO-9 1270 to 1280) and `docs/plans/2026-10-12-squads-and-subspace-telescope-design.md` (reserve 632 to 640, 679 to
  681, 760 to 763).
- `docs/plans/2026-10-14-field-kits-plan.md` (in flight; shares `groundFight.ts` / `medicalBay.ts`).
- `SUGGESTIONS.md` 151 (crew lock), 1955 to 1959 (hull tiers are class generations), 1962 to 1967 (craft duplicate).
- Inventory `docs/inventory/2026-09-30/slice-4-active-0140-master.md` rows S4-C18 / C19 / C24 / C25 / C26 / CP04 /
  CP05 / CP08 / CP16 / CP17 / CP19 / CP20 / CP21 / CP23 / CP24 / CP26 / CP36 / CP38 / CP39 / B04 / I12 / I29 / I30 / I31, S1-62.
- Mockups: Crew Made Real (approved whole-build 2026-10-02, design line 3; scratch `crew-made-real-mockup.html`,
  artifact UYTkL2q9PyDHKGbeERcvuj) sections 8, 9, 10 (CMR-8, CMR-9, CMR-10); Ship Modules and Sensors (scratch
  `ship-modules-sensors-mockup.html`, artifact GoYVwi6k13P6KvxRrzRicN, G5 / G6 / Task 28) sections 1 to 5 (SMS-1..5).
  **SMS has NO recorded answers**: a grep of docs, SUGGESTIONS and the session's user messages finds none, so every
  SMS number below is still [PROPOSAL].
- Session transcript `98207591-ca65-4871-8a5d-83c699d63043.jsonl` lines 43176, 55892, 58169, 58290.

## 0. Standing rules (inherited; apply to every slice)

- **Gate** after every slice: `npm run check` (0 ERRORS; the 2 known RadialWeb warnings are fine) and `npx vitest run`
  (all files pass). A slice is not done until both are green.
- **Flag-neutral:** a save with no complement buff of a slice's key, no new module and no new action taken is
  byte-identical in every reader the CP-0 goldens pin. A run dispatched before a slice never gains its new frozen
  field. Every engine slice keeps the goldens green in the same commit.
- **Determinism:** `makeRng((seed ^ SALT ^ key) >>> 0)` only; integer draws; never `Math.random` or `Date.now()` in
  engine code; never a new draw on a shared stream (economy, transport, battle). New salts are odd, distinct,
  exported, and their module joins `salts.test.ts` MODULES. A removed catalog entry may change WHICH item one
  existing draw picks, never the draw count.
- **Mutation pattern:** UI handler `do*` in `src/App.svelte` calls a pure engine fn, then `state = next`, `pushLog`,
  `doSave`, with a same-ref guard. Every refusal is a typed reason with an exhaustive text switch (no default).
- **Text rules:** US English; no em dashes and no double hyphen anywhere (text, comments, code: write `i -= 1`);
  "install" is the only verb for putting gear on; player-facing text says "objective", never "task"; graphics are SVG
  glyphs in `src/lib/ui/icons.ts` classified in `src/lib/ui/iconPacks.ts` `ICON_SEMANTICS`, reviewed at 16 / 28 / 56
  px, no emoji (the new Bridge / Quarters tiles must not reuse the emoji `tileIcon` / `EQUIPMENT_VARIETY_ICON` path).
- **Responsive:** one DOM, container queries; 375 px with no horizontal page scroll. A `<select>` never acts on change.
- **[PROVISIONAL]** marks a first-pass value picked so the build stays green while an open call (section 4) waits;
  each lives in ONE named constant. **[PROPOSAL]** marks anything the user has not named or decided.
- **No dead stats:** the slice that makes a `no-dead-stats.test.ts` entry live removes it in the same commit.
- **Diminishing returns (D23):** any new stacking share passes the shared `diminishing()` curve, never a hard cap.
- **Shared tree:** other agents work in the same checkout. Stage only your own files by explicit path; never
  `git add -A`. Never push; staging is the controller's call.
- **Commits:** one per slice (goldens first, alone), ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 1. Source decisions (verbatim where the user's words exist)

1. **Scope ruling** (E-CREW plan 22): "If something I've said here is not part of the scope (within reason), make it
   part of the scope of 0.14.0." G5 and G6 (plan 36 to 39) are 0.14.0 scope on that ruling.
2. **Bridge and Crew Quarters by ship type** (relics-v2 capture 151 to 155, user re-statement 2026-10-09): "Bridge:
   That's where your senior staff live. Provides bonuses based on the ship type you're flying, and then provides
   bonuses to your senior staff and their buffs to crew compliment." "Crew Quarters Module: Similar as the above. This
   focuses on buffs for the playstyle/ship type you're flying as well. More focused toward the specific crew
   compliment. Some might increase crew compliment, and others might impact the crew in other ways!"
3. **Officer and module synergy with the hull** (transcript 58169, item 5): "officer effectiveness can be based
   entirely off of the stats that accentuate the specific type of ship you're flying ... This would apply to the crew
   compliment 'crew quarters' module as well." Quarters "could provide additional slots for crew compliment, as well
   as other related options there. That shouldn't be cut." (transcript 55892).
4. **Sensor Suite** (capture 156 to 157): "This is used throughout all exploration content." I.6 (saga 571 to 579,
   LOCKED 2026-09-23): all roles core, including "frontier gating (a sensor threshold to attempt deeper regions), + a
   day-one cloak/threat-detection hook in combat patrols (Science-officer synergy)"; "Explorer hulls carry high base
   sensors; Science officers + the Science crew division amplify sensors." The user (transcript 43176): "Even a
   destroyer needs a science officer. Detecting cloaked vessels is tricky work."
5. **Division pools** (design 6.2, approved 2026-10-02): "Security: away-team protection (squad HP),
   counter-infiltration (resists enemy Debuff). Science: survey aptitude (scan speed), rare find (relic and rare-drop
   odds). Medical: squad healing + injury length. Flight Deck: carrier drone handling. Engineering: Shipyard repair
   rate (power efficiency with the power budget). Exclusive pool: output mult, turnaround cut, prevent crew loss
   (shorter injuries); craft duplicate stops rolling (D14)."
6. **D26 owners** (design 250 to 253, user 2026-10-09): Crew Effectiveness and the Earth-born racial = "a small boost
   to ALL complement buffs ('healthy crew work better')"; the Spacer racial `crew.endurance` = "a complement long-haul
   build-up like Constitution (D23 curve)".
7. **D12** (design 31): officers are exempt from the "crew never double-dips weapons/shields" rule, which "stays
   Complement-only". Task 21 carry (plan 728 to 729): "the Complement never feeds battle (D12)".
8. **Craft duplicate** (SUGGESTIONS 1962 to 1967, user 2026-10-02): "hold off on this for now. Might be best put onto
   an FA talent, or potentially HOMEWORLD STAFFING that could come later on." It "should not roll on ship crew (no
   dead rolls)".
9. **Per-hull complement** (crew spec 99 and 182, LOCKED): "Command structure is a PER-HULL-TYPE template (role
   dictates the mix: a destroyer weights Security/Engineering/Flight, a medical/support hull weights Medical/Science
   ...)"; "base crew capacity is a LOCKED per-HULL value (bigger on newer/better ships)". Bands (saga 251 to 253):
   "prospectors ~50-200, combat ~50-500, explorers well over a few THOUSAND". Hull tiers (SUGGESTIONS 1956 to 1959):
   the 1,017 flagship "could be the 3rd or 4th tier of ship", so today's tier-2 explorers are an early generation.
10. **Management by policy** (saga 296 to 299, LOCKED): "you manage by policy (auto-assign, sort, mass-action),
    plucking out standouts ... auto is the default and the peace-preserving path." Active mode (saga 248): "You
    assign crew to the CAPTAIN and they auto-fill the ship's slots up to the ship's caps." Graduation and manifest
    (crew spec 255 to 258): names "generated lazily and deterministically (seed = bucket signature + index) only when
    a manifest view is opened. Never persisted." "Standouts graduate into notableCrew (bounded list) with a persisted
    name; their bucket count drops by one."
11. **The lock** (SUGGESTIONS 151): "Crew-allocation settings LOCK when a mission starts (can't change mid-mission)."
    Design 5.6: "A ship on any mission locks officer, complement and away-team changes (S1-62); the UI shows the lock
    and why."
12. **The reserve** (squads design 760 to 763, user 2026-10-13): "You have reserve squad members that don't belong to
    a given squad, so it shouldn't really matter too much." The RESERVE is now the word for members aboard but
    unslotted (GO-2, SQ-2). GO-2 (GO plan 329 to 331) recorded that "the Task 27 Reserve list is the BENCHED members
    (assignedShipId === null)".
13. **Candidate boards** (transcript 58169, item 1): "Make it 10 to start and make it an expandable upgrade because
    you can imagine trying to cycle through for the exact combination of crew members, rarity, and bonuses that you
    want to turn into future captains after all."
14. **Retirement** (crew spec 147 to 161): "the retiring captain departs (Hall of Command honor, ties C.6)"; "after
    the 5th the captain LOCKS IN ... and the player is ADVISED before that final retirement"; "Captain LEVEL cap =
    SOFT (locked): levels keep coming with diminishing returns past a threshold". User (transcript 58290): "Yeah, I
    like the approach as a soft cap for sure. Let's lock that in."
15. **Rosters and graphs** (crew spec 440 to 441): a roster loads via "a DROPDOWN ... from the ship's personnel
    screen"; (425 to 427) "GRAPH THEMING IS SEPARATE FROM THE APP THEME ... ALL graphs in the game should be separately
    colorable from the theme."
16. **D23** (design 145 to 148): "Diminishing returns will 100% come into play, but without removing the entire ability
    to push past a certain point."

## 2. Reconciliation: Tasks 23 to 33, G5, G6 against today's code

Written 2026-10-02 / 2026-10-09; since then Ground Operations (GO-0..GO-18), Squads (SQ-1..SQ-7), affixes (AF-1,
AF-2), the GO-16 gambit editor, GO-17 loadouts and the Subspace Telescope landed. SAVE_VERSION is 68.

| Item | Status | Evidence | What remains |
|:-|:-|:-|:-|
| **23** Division pools + exclusive pool | **Partly** | Live since: Keen Analysis rare find (Tasks 15/20, `expedition.ts` 1120, `tick.ts` 4147), Reduced Crew Losses injury care (Task 16, `injuries.ts` 64, frozen at GO dispatch `groundOps.ts` 203), Boarding Defense + Ossir + Tactical Strength (GO-9, `shipScanEvents.ts` 173; GO plan 1278), Rapid Loadout (GO, `groundOps.ts` 176). Still dead (`no-dead-stats.test.ts` 165 to 184): Deck Handling, Damage Control, Counter-Infiltration, Away-Team Protection, Survey Aptitude, Triage, Crew Output Multiplier, Mission Turnaround, Prevent a Crew Loss, Crew Effectiveness, and the Belter / Outer-Colony / Vael / Stheni / Earth-born / Spacer racials. Craft duplicate still rolls (`crewGeneration.ts` 100, 110 draw from the 4-entry `crewBuffs.ts` 105). | CP-1 to CP-4. Medical "injury length" is already live (no new read). Every run consumer must freeze at Ground Ops dispatch (D24, GO precedent), not read at claim. |
| **24** Per-hull caps | **Not built** | `commandStructure.ts` 54 / 70 / 143: per-SPEC totals and weights x tier. Freighter 30, prospectors 50, destroyer 120, battleship / carrier 160, Orion = Aurora = Eir 750. **Plan premise wrong:** "clamp through the existing load-time clamp path" (plan 878): no such path exists (`save.ts` only seeds empty complements, 2202 to 2216); uninstalling a quarters module already leaves a complement over cap silently. | CP-5 with an explicit over-cap policy (OC-6). |
| **25** Transfer + sort / filter / multi-select | **Not built** | `moveBetweenBucketLists` (`crew.ts`) is only called by `autoCrew.ts`; Active mode only skips auto-fill (`crewOverlay.ts` 660). No `.svelte` file reads `state.crewPool`: the pool is invisible. | CP-7 (engine), CP-10 (UI, needs sketch for the pool and transfer picker). |
| **26** Graduate + manifest | **Not built** | Nothing creates a `NotableCrewMember`; `ComplementPanel.svelte` 339 already tells players to "graduate" standouts. `generateCrewIdentity` exists (`crew.ts` 205). **No notable cap exists** (the CMR-8 line "Notables are capped (the existing bounded roster)" is false). `resolveCrew` auto-fill ignores assigned notables (`crewOverlay.ts` 640 to 681 passes only `ship.complement`), so a graduated notable plus passive refill would exceed caps; `applyRoster` already counts them (`personnelRosters.ts` 311 to 357). | CP-8 (engine incl. the auto-fill occupancy fix), CP-9 (UI, mocked in CMR-8). |
| **27** Mission lock + salvage benching + reserve list | **Partly** | `shipCrewLocked` exists (`awayTeam.ts` 317: captain mission or any expedition until claimed) and gates hire / fire / reassign, ground slots (`groundTeams.ts` 389), member gear (`memberEquipment.ts` 255) and the Armory (`armory.ts` 463, 699). NOT gated: officer hire-to-seat / assign / unassign / fire (`seniorStaff.ts` 526 to 586; App 5144 to 5191), complement mode toggle (App 5506), `applyRoster` people (only its loadout check-out refuses), captain retirement (`captainRetirement.ts` 60 checks only `captain.mission`, so a captain can retire mid-expedition and consume an XO who is out on the run). **Salvage:** `salvageShip` and `salvageTargetBlock` use `onMissionLock` only (`salvage.ts` 678, `tick.ts` 8989), which does not see expeditions, so a hull on an expedition appears salvageable (verify with a test first). Salvage does not bench away members (TODO `salvage.ts` 796), leaves officers and notables pointing at the removed hull (invisible), and the hull's complement buckets vanish with it. Injury bar: **done** (`injuries.ts` 154 to 162 uses `injuredAtSeconds`). "Reserve" list: **superseded name** (rule 12); the benched list itself is not built, and no UI path benches anyone today (`AwayTeamPanel.svelte` 1002 to 1023 offers ships only). | CP-6 (engine + v69 orphan repair), CP-10 (lock badges + the benched list UI, OC-12). |
| **28** Crew module + early sensor blueprints + tiles | **Partly** | Done: Sensor Array tile (E4d `43d822b`, `ShipSystemsPanel.svelte` 171 to 176), sensor bay group (App 5818 to 5823), `moduleVariant` stamping for bridge / quarters / sensor (`itemgen.ts` 472 to 479), module effects live (`crewOverlay.ts` 261 to 330, `crewModules.ts`). Missing: any blueprint for the 3 bridge, 9 quarters and Wide-Beam / Focused-Beam / Balanced arrays (only `bioResonanceArrayBp`, `model.ts` 9482, relic-gated); Bridge and Crew Quarters tiles; their bay groups. The Research Lab caps at level 2 (`model.ts` 4818 to 4846), so SMS-2's "Lab tier 3" rows need a new Lab rung (OC-15). | CP-11 (engine), CP-12 (UI, mocked in CMR-9 + SMS-1). |
| **29** Final-retirement warning + Hall of Command | **Not built** | `MAX_CAPTAIN_RETIREMENTS` 5 (`captainRetirement.ts` 39); the retire modal (App 20176 to 20191) has no final warning; no `hallOfCommand` symbol; captains carry no missions-flown counter (`CaptainState`, `model.ts` 3855 to 3910). | CP-16. |
| **30** Roster dropdown on the ship screen | **Partly** | The linked loadout now travels with the roster (GO-17 `4ba3d06`, `personnelRosters.ts` 268 to 273, `withLinkedLoadout`); this was Task 18's carry, now done. Apply exists only inside the Personnel Rosters facility (`PersonnelRostersPanel.svelte` 538). | CP-17 (dropdown + the locked "unsaved roster" warning, crew spec 443 to 445). |
| **31** Soft captain level cap | **Not built** | `xpForNextLevel = 300 * level` (`model.ts` 10948); retirement gate is level 25 (`captainRetirement.ts` 34). | CP-18. |
| **32** Candidate board expansion | **Built by CP-19 (2026-11-09); was: Not built** | `SENIOR_STAFF_ROSTER_BASE` 10 (`model.ts` 6485); both boards read `seniorStaffRosterSize` (`seniorStaff.ts` 509, `awayTeam.ts` 285). **Overlap found:** the captain secondary talent Recruiter already promises "+candidate roster size" (`model.ts` 12089, `candidateRosterSize` 0.08) and nothing reads it. Personnel Rosters is a service facility with no levels (App 10294 to 10300). | CP-19 (home is OC-17). |
| **33** Graph color option | **Not built** | `ComplementPanel.svelte` 149 to 153 hard-codes its hsl ramp; the colorblind palette (`accessibilityPreference.ts`) is a separate axis; preference modules like `tickBarPreference.ts` are the pattern. | CP-20. |
| **G5** Bridge / Quarters ship-type bonuses | **Not built** | Only Focused Command keys off the hull (`crewModules.ts` `HULL_ROLE_SEATS`). SMS-1 proposes one bonus line per hull family for each slot (unanswered). | CP-13 (after OC-13). |
| **G6** Sensor roles | **Partly** | Built: sensors fold (E1a), foreknowledge thresholds (`expedition.ts` 298 to 301), scan speed by sensors (`SCAN_SENSOR_COEFF`, 206), the sensor ghost and the **cloaked vessel** ship event (GO-8, `shipScanEvents.ts`; so SMS open call 7 is already settled in code), the telescope ship lift at sensors 40 (SQ-5). Missing: hull base sensors (S4-B04, no field on `ShipTypeDef`), Science crew / officer amplification (S4-I31), patrol cloak / threat detection (S4-I30: the combat engine's Particle-Trace Detector draw exists, `resolveBattle.ts` 1369 to 1375, nothing feeds it and no patrol opens cloaked), frontier gating (S4-I29: no region unlock exists; G2 owns region unlocks and the reach gate). | CP-14 (base sensors + amplification), CP-15 (combat detection, after OC-19); frontier gating moves to the G2 plan [PROPOSAL, OC-18]. |

## 3. Slices

Each slice: one implementer, then the two-stage review. **Order and parallelism:** CP-0 first. CP-1, CP-2, CP-5,
CP-6, CP-11, CP-16, CP-18, CP-20 touch disjoint files and may run in parallel pairs. CP-3 shares `groundFight.ts`,
`medicalBay.ts` and `groundOps.ts` with the in-flight Field Kits engine slices (FK-4 to FK-7): run it AFTER those land,
never concurrently. CP-7 and CP-8 need CP-6's lock helper. UI slices follow their engine slice. Do not deploy to
staging between CP-6 and CP-10 if the benched list has no UI yet (a salvage would bench members nobody can see).

### CP-0: Pre-complement golden hashes (test only)

**Files:** new `src/lib/game/complementGoldens.test.ts`.
**Behavior:** none. Pin, before any engine edit: the ship sheet (`effectiveShipStats`) for one ship of every hull with
a full complement holding EVERY buff key and every race (incl. craft duplicate), and with none; three captain
missions through `economyTick` (incl. a passive ship receiving a transport), a Repeat patrol with relaunch + replay,
a Shipyard repair, two legacy expeditions and two Ground Ops runs (incl. a field repair and a med bay stay) through
claim; the transport generator's next 20 deliveries for a fixed seed; `commandStructureForHull` for every hull.
**Tests:** the hashes themselves, plus a self-check that each fixture actually holds the keys it claims.
Commit alone: `test(0.14.0): pre-complement golden hashes (CP-0)`.

**Carry note (2026-10-14, CP-0 landed, captured on top of e304b94):** `complementGoldens.test.ts` pins, whole
serialized: `effectiveShipStats` + `shipCrewContribution` for all 10 hulls with no complement and with a full one
(every division to its cap, trimmed to the hull total; all 22 buff ids incl. `excl.craftDuplicate`, all races;
self-checked); `shortOreRun` / `surveyMineralAnomaly` / `frontierSupplyRun` dispatched for real 200 s before transport
window 1 and run 700 economyTick s (the passive mission ship is crewed mid-run); a Repeat carrier patrol (dispatch,
8 replays, end state; it equals officerBonuses "patrol:carrier"); a destroyer Shipyard repair (duration 239, process,
completed state); legacy expeditions at seeds 0x2468ace and +7919; Ground Ops seed 0x1244 pre-damaged (one field repair
leg + bay stays) and 0x1234 (bay stays, hull damage home), each dispatch / 2,000,000 s / claim; `transportBatch(0x7ea5e,
1..20)`; `commandStructureForHull` per hull. Every fixture except the full sheet is KEYLESS at dispatch (the mission
ships gain random transport crew). Added `crewGenerationDraws.test.ts` (a passthrough counting `makeRng` mock in its
own file): per-crewmember draw counts, signatures with the exclusive buff2 masked, and full signatures over 10,000
crew; CP-1 may move only "signatures".

### CP-1: Craft duplicate stops rolling (Task 23, D14)

**Files:** `crewBuffs.ts` (split `SECOND_LEVEL_EXCLUSIVE` into a rollable list without `excl.craftDuplicate` and a
`HELD_CREW_BUFF_IDS` set, comment pointing at SUGGESTIONS "CRAFT-DUPLICATE CREW BUFF"), `crewGeneration.ts` (100,
110 pick from the rollable list), `ComplementPanel.svelte` / buff label helper (a held buff reads "Held for homeworld
staffing").
**Behavior:** new crew never roll craft duplicate; existing buckets keep the id (save untouched) and still contribute
nothing (its key already maps to nothing).
**Determinism:** still ONE `nextInt` per exclusive pick, so the transport stream's draw count is unchanged; only which
exclusive buff a future pick names changes. The CP-0 transport golden is re-pinned in this commit WITH a test that
asserts the draw count per crewmember is unchanged (a counting rng wrapper).
**Save:** none. **Tests:** no generated crew in 10,000 holds craft duplicate; a held bucket survives save round trip;
label text. **UI:** label only, no mockup needed (CMR-8 already says "Craft duplicate is on hold").

**Carry note (2026-10-14, CP-1 landed):** `crewBuffs.ts`: `SECOND_LEVEL_EXCLUSIVE` stays the full catalog (lookup,
rollup, an old bucket's id); new `HELD_CREW_BUFF_IDS` (`excl.craftDuplicate`), `ROLLABLE_SECOND_LEVEL_EXCLUSIVE`
(the other three, catalog order), `isHeldCrewBuff`, `crewBuffLabel` (a held buff reads "Craft Duplicate Chance (Held
for homeworld staffing)"). `crewGeneration.ts` both exclusive picks read the rollable list (one `nextInt` each, as
before). `no-dead-stats.test.ts` reads the new export. Goldens: `crewGenerationDraws.test.ts` "draws" and "masked" are
the CP-0 capture, "signatures" re-pinned. The CP-0 transport golden did NOT move (its 240 crew hold no exclusive pick;
the test now asserts that). The three mission goldens moved by exactly one crewmember (transport window 1, crew 9: its
one exclusive draw named Mission Turnaround, now Prevent a Crew Loss; both still have no consumer); the test names that
buff back and reproduces the CP-0 hashes. Every other CP-0 golden is unchanged. The held label shows today only through
`ComplementPanel` `buffLabel`, which renders a notable's buff1 (never an exclusive), so no screen shows it until the
CP-9 bucket table, which must use `crewBuffLabel` for both buffs (QA item 1 waits for CP-9).

### CP-2: Ship-side complement consumers (Task 23: Engineering, exclusive pool, Crew Effectiveness)

**Files:** `crewOverlay.ts` (crew map + `officerRepairSpeedBonus` sibling), `tick.ts` (repair divisor at
`shipRepairDurationTicks` 7157, mission output at 2150 / 4156), `groundOps.ts` (field repair speed, frozen at dispatch
in `ShipEventBattle.repairSpeed`), `no-dead-stats.test.ts`.
**Behavior [PROPOSAL consumers, design 6.2 and D26]:**
- Damage Control `crew.hullRepairRate` (+ Stheni racial): joins the Shipyard repair divisor (D23 divisor, like Rapid
  Recovery) and the GO-8b field repair speed-up at dispatch.
- Mission Turnaround `crew.missionTurnaround`: `unloadSpeedMult x (1 + t)` through `applyCrewOverlay` plus the repair
  divisor, mirroring Veteran Instincts but on its OWN key (never `OFFICER_TURNAROUND_KEY`, plan 653 to 655).
- Crew Output Multiplier `crew.crewOutputMult`: adds to the same `missionOutputMult` share Command Presence feeds
  (extraction / survey / transport deliveries + patrol wave loot), reusing the Task 20 whole-unit `chanceRound`
  private streams (no new stream). Loot is not battle power, so D12 holds.
- Crew Effectiveness `crew.crewEffectiveness` (+ Earth-born racial): multiplies every OTHER complement bucket key by
  `1 + diminishing(e, CREW_EFFECTIVENESS_KNEE)` inside `rawShipCrewContribution`, composed with the quarters module
  and the Strength facet; officers' own bonuses are not scaled; it never scales itself [PROVISIONAL knee, OC-3].
**Determinism:** every read is zero-guarded so a ship without the key is the same object; field repair reads only the
value frozen at dispatch. **Save:** none. **Tests:** each key moves its consumer and only it; CP-0 goldens unchanged
for keyless fixtures; big == small parity for a mission and a Repeat patrol with the output key live; field repair
of a pre-slice run unchanged. Remove the 6 entries (hullRepairRate, missionTurnaround, crewOutputMult,
crewEffectiveness, stheni, earthBorn). **UI:** ShipSystemsPanel source split already shows crew-map keys; the repair
and output lines need one label each in the stat breakdown (text only).

**Carry note (2026-10-17, CP-2 landed, with the wiring plan's ship-side crew answers OC-E3, OC-E5, OC-E8, OC-E13):**
`crewOverlay.ts`: Damage Control (+ Stheni) and Mission Turnaround's repair half feed `crewRepairSpeedBonus`;
`shipRepairSpeedBonus` (officers + complement) is what the Shipyard divisor (`tick.ts` processShipRepairs, D23
divisor) and the GO-8b field repair (`shipScanEvents.ts`, frozen at dispatch; an older run keeps its value) read.
Mission Turnaround's unload half is `applyCrewOverlay` unloadSpeedMult x (1 + t), its own key. Crew Output
Multiplier feeds `crewMissionOutputBonus`; `shipMissionOutputBonus` (Command Presence + it) is the share economyTick
applies to mission deliveries and patrol wave loot (the existing chanceRound streams, no new stream). Crew
Effectiveness (+ Earth-born, crew per head and officers at the officer magnitude) multiplies every OTHER complement
key by `crewEffectivenessMultiplier` = 1 + diminishing(e, `CREW_EFFECTIVENESS_KNEE` 0.2 [PROVISIONAL]) inside
`rawShipCrewContribution`; never itself, never the officers' bonuses. OC-E5: Fast Departure / Fast Return lift
`ShipDerivedStats.transitOutLegMult` / `transitBackLegMult` (model.ts `outboundLegSpeed` / `returnLegSpeed`, read by
`effectiveMissionDef`); the Pilot's sweeping transit cut moved to its own key `OFFICER_TRANSIT_KEY`. OC-E8: the
Museum's crewBonuses also multiplies `officerBonusTotal` and the officer combat profile. OC-E13: a patrol's first
cycle folds the Constitution ramp at `patrolCycleOneRampHours` (half its route). Fast guards (`carriesCrewKey`) keep
the per-tick output read as cheap as before. UI: ShipSystemsPanel shows Departure / Return Speed rows when a leg
differs, and Repair Speed / Mission Output lines with the complement's part. Registry: crew hullRepairRate,
missionTurnaround, crewOutputMult, crewEffectiveness, racials stheni and earthBorn, Museum crewBonuses (sheet +
ground), audit transitSplit and constitutionCycle1, and the Engineering wing flipped to live. Probe fixtures now
default to a Spacer crew and officer (`FIXTURE_RACE`: no 0.14.0 consumer). Goldens: every moved hash carries a CP-2
key (Earth-born transport crew, full complements, the Earth-born facet bridge); `complementCp2Switch.fixture.ts`
`withCp2Off` zeroes exactly the switched magnitudes and each moved golden reproduces its pre-CP-2 capture with it
(captured on the pre-CP-2 code). CP-3 and CP-4 not touched (Survey Aptitude, Triage, Counter-Infiltration,
Away-Team Protection, Prevent a Crew Loss, Deck Handling and the Spacer ramp stay pending).

### CP-3: Ground Ops complement consumers (Task 23: Security, Science, Medical, exclusive) [after Field Kits engine]

**Files:** `groundOps.ts` (dispatch snapshot, `snapshotGroundOps`), `groundFight.ts` (`buildRosterCombatants` care /
HP / resist inputs), `medicalBay.ts` (`bayCareFrom`), `expedition.ts` (`scanSpeedBonus` at 1174), `model.ts`
(optional record fields), `no-dead-stats.test.ts`.
**Behavior [PROPOSAL consumers]:** frozen on the Ground Ops record at dispatch, each written only when non-zero:
- Away-Team Protection `crew.awayTeamProtection`: Security members' `hpMax x (1 + p)`, integer-rounded post-draw.
- Counter-Infiltration `crew.counterInfiltration`: the squad's resist to enemy-inflicted statuses, combined
  `1 - (1 - own)(1 - c)` like Morale Anchor; never reaches 1 (D23 hazard-style ceiling stays the existing cap).
- Triage `crew.triage`: adds to the run's `squadTriage` (Fleet Triage's field), so medic heals and first aid scale.
- Prevent a Crew Loss `crew.preventCrewLoss`: a new `preventLossShare` term in the bay care divisor (design 6.2
  "shorter injuries"), injuries only.
- Survey Aptitude `crew.surveyAptitude` (+ Vael, Outer-Colony racials): adds to `scanSpeedBonus` (design 6.2 "scan
  speed") [OC-4 asks whether it should instead or also lift sensors].
Legacy (pre-GO) runs: untouched (they read nothing new).
**Determinism:** no new draws; the fight stream is unchanged when every new field is absent (goldens). Status resist
is applied where the existing resist is read (no extra roll). **Save:** none (optional fields). **Tests:** each field
changes its reader; a run dispatched without them is byte-identical (CP-0 + FK goldens); one call == 997 s == 1 s
parity with all five live; threat indicator memo key widened if `GroundFightTeam` gains a field (groundThreat.ts
`satisfies` key). Remove 8 entries (awayTeamProtection, counterInfiltration, triage, preventCrewLoss, surveyAptitude,
vael, outerColony + any facet entry the test reports newly live). **UI:** none beyond Help lines (Task 34).

**Carry note (2026-10-30, CP-3 landed on top of b95a878, with the wiring plan's OC-E1 "Resist enemy debuffs" and
OC-E2 "Shorter bay time"; Survey Aptitude, Vael and Outer-Colony were already live from the inert-racials slice, and
Crew Output Multiplier from CP-2):** `crewOverlay.ts` `shipAwayTeamProtection` / `shipCounterInfiltration` /
`shipCrewTriage` / `shipPreventCrewLoss` (0 without the key, `carriesCrewKey` guard). Frozen at dispatch, each only
when non-zero: `Expedition.squadHpBonus` (every Security member's max HP x (1 + p), rounded, at least 1, in
`buildRosterCombatants`: objective fights and scan encounters), `Expedition.squadDebuffResist` (every DEBUFF id's
resist = 1 - (1 - own)(1 - share), folded after Morale Anchor on Fear; buffs never; the existing single resist roll),
`squadTriage` = Fleet Triage + the crew's Triage, `GroundOpsFactors.preventLossShare` (injury-class bay care only,
`BayCare.preventLossShare` through `groundOpsBayCare`, so the bay cards read it too). Legacy claim recovery
(`injuryRecoverySeconds`) is untouched. Counter-Infiltration's ceiling: `gambit.ts squadDebuffResistShare` = 0.9 x
tanh(raw / 0.9) (`SQUAD_DEBUFF_RESIST_CEILING` = `STATUS_RESIST_CAP`, the plan's "D23 hazard-style ceiling stays the
existing cap"; about the raw value while small) [interpretation, flagged for the user]. The threat memo key appends
a tagged `crewGuard` entry only when either Security field is present. No save change, no new draw. Registry: the four
crew entries live with probes on the dispatched run (`runTaskSecHp`, `runTaskSecDebuffResist`, `runTaskSecHeal`,
`runBayFractureSeconds`), plus `crew:audit:preventCrewLossInjuriesOnly` (a Health cure does not move); the Security and
Medical quarters wings live (every division wing is). Goldens: `complementCp3Goldens.test.ts` (captured first) moves
only its keyed fixtures, each reproduced with `complementCp3Switch.fixture.ts withCp3Off`; `officerStatFacets.test.ts`
re-pins only its eight expeditions (its complement's Security bucket carries Away-Team Protection), reproduced with the
switch; the registry pins (`shortRangeGoldens`, `emodGoldens`) read CP-3 back (`cp3Registry.fixture.ts`). The
sensitivity vacuity guard's inert-source count is now pinned at 0. Help: Team Types and Squads
"SHIP CREW SUPPORT", Return Trip's medical bay line.

### CP-4: Deck Handling and the Spacer ramp (Task 23 remainder) [blocked on OC-1, OC-2]

**Files:** `combat/droneDefense.ts` + `combat/bridge.ts` (if OC-1 picks replenish), `officerStats.ts` /
`constitutionRamp.ts` (if OC-2 reuses the ramp), `no-dead-stats.test.ts`.
**Behavior [PROPOSAL]:** Deck Handling (+ Belter) speeds drone REPLENISHMENT between waves (`replenishDrones`
rateUnits), never drone damage, so D12's "never feeds weapons or shields" holds; frozen per patrol cycle on
`PatrolMissionState` beside `officerCombat`, and it takes the Flight Deck Integrity facet when below half hull (plan
728). Spacer `crew.endurance`: the complement's share of the run-frozen crew values ramps by
`endurance x diminishing(hours, CONSTITUTION_RAMP_KNEE_HOURS)` at the SAME sample points the Constitution ramp already
uses (expedition `rampScience` / `rampReturn`, patrol relaunch), never a new sample point.
**Determinism:** replenish is integer progress units (post-draw); frozen per cycle so live == replay. **Save:** none.
**Tests:** a carrier with the key replenishes faster, a non-carrier is unchanged; replay parity; ramp at 0 hours is
exactly zero. Remove droneHandling, belter, spacer.

**Carry note (2026-10-20, the four inert racials wired: CP-4's replenish consumer + CP-3's Survey Aptitude piece; user
"everything wired", merge-batch answers "Relics v2 constants and Spacer" and "Spacer bonus"):** the racials share
their division's pool key, so each consumer lights the buff and the racial together. Deck Handling + Belter
(`crew.droneHandling`, OC-1): `crewOverlay.ts shipDeckHandling` is frozen per patrol cycle on
`PatrolMissionState.deckHandling` (dispatch and each relaunch, beside `captainCombat`; written only when > 0 and the
cycle fields a drone screen) and `combat/bridge.ts applyDeckHandling` seeds every squadron with it in parts per
million (`deckHandlingPpm`). The rate is not rounded: `droneDefense.ts replenishUnits` banks the extra progress in
integer ppm (`replenishCarryPpm`) and pays whole units, only on ticks a drone is recovering, and a relaunch carries
the bank into the next cycle (`PatrolMissionState.replenishCarryStart`, which the replay seeds too), so one Belter
crewman acts over a long Repeat patrol (review, 2026-10-20). **For the user:** CP-4 says "between waves"; the
in-combat replenish module banks Deck Handling the same way (`resolveBattle`), so it acts there too (no content sets
that module yet). Survey
Aptitude + Vael / Outer-Colony (`crew.surveyAptitude`, OC-4): `shipSurveyAptitude` joins the expedition's
`scanSpeedBonus` at dispatch. Spacer ("+Transit speed"): its racial moved off the sourceless `crew.endurance` onto
`crewBuffs.ts TRANSIT_SPEED_KEY` (the Pilot's sweeping key, `transitSpeedMult`: both mission legs and the G2-3
voyage), same 0.05 / 0.0005 magnitudes; Senior Staff shows it as "Transit Speed". Fix in passing: `carriesCrewKey`
now sees the commanding captain's race (WR-6 OC-A43), so a Stheni / Belter / Vael captain alone passes the guard.
Registry: crew droneHandling + surveyAptitude, racials belter / outerColony / vael / spacer and the Science and
Flight Deck quarters wings are live; the four Ground Ops keys and the Security / Medical wings now name CP-3 (not
"E-CREW Task 23"). `FIXTURE_RACE` is the Belter (only a carrier's drone screen reads it); the no-dead-stats battery
gained a carrier patrol dispatch probe; `simPlayer.test.ts` proves dead-choice detection on a synthetic cosmetic
choice. Goldens: `racialsGoldens.test.ts` (captured first) plus the moved complement / facet / registry pins, each
reproduced with `racialsSwitch.fixture.ts withRacialsOff`. NOT built (still CP-4 / CP-3): the Flight Deck Integrity
facet on replenish below half hull, the Spacer long-haul ramp (0.14.x, T3; kept visible as the deferred registry row
`crew:audit:spacerLongHaulRamp`), and CP-3's four Ground Ops consumers.

**Carry note (2026-11-10, CP-4's rest: the Flight Deck Integrity facet on replenish; user "Build it", the audit
leftovers in the wiring plan):** built as the plan proposed ("it takes the Flight Deck Integrity facet when below half
hull", the E-CREW plan's Integrity rule "the department's buffs gain the Integrity facet" and its Task 21 carry "give it
the Flight Deck's Integrity the same way"): while the ship is below half hull (hull x 2 < its folded hull max, the
trigger `resolveBattle` already uses), Deck Handling is x (1 + the Flight Deck's Integrity facet), so the drones rebuild
at droneReplenishRate x (1 + Deck Handling x (1 + facet)). The facet is `departmentFacet(flightDeck, integrity)`: the
Pilot's 1% per point above 10 plus 40% of the XO's [PROVISIONAL: the facet's first-pass numbers, no new constant]. It
only lifts a Deck Handling aboard (none, nothing to lift), and below half hull never pays less than above (peace).
FROZEN per patrol cycle beside `deckHandling` (`PatrolMissionState.deckHandlingSteady`, dispatch and each relaunch,
written only when > 0 and the Deck Handling is stored) and seeded onto the squadrons as
`DroneSquadron.deckHandlingSteadyPpm` (`combat/bridge.ts applyDeckHandling`), banked in the same
`replenishCarryPpm`. Readers: the between-wave replenish (`tick.ts`, `patrolReplay.ts`, `droneDefense.ts
replenishUnits(squadron, belowHalfHull)`) and the in-combat replenish module (`resolveBattle`, `deckHandlingPpmNow`). A
patrol in flight from before has no stamp and flies and replays exactly as before. No SAVE_VERSION bump. Registry: the
live row `crew:audit:flightDeckIntegrityReplenish`, probe `patrolReplenishSteadyLift` (the Deck Handling extra below
half hull over the extra above it: 1 + facet). Goldens: `cp4FlightDeckGoldens.test.ts` (captured first; only the
steady fixture moves, each control is unchanged), reproduced with `cp4FlightDeckSwitch.fixture.ts withCp4FlightDeckOff`;
the earlier registry pins read the row back (`cp4FlightDeckRegistry.fixture.ts`). Text: the Pilot's Integrity tooltip
(`INTEGRITY_DETAIL_BY_DEPARTMENT.flightDeck`) and the Combat Patrols Help topic. QA:
`docs/qa/2026-11-10-cp4-flight-deck-qa.html`.

### CP-5: Per-hull complement caps and division mixes (Task 24)

**Files:** `model.ts` (`ShipTypeDef.complementCap?`, `complementDivisionWeights?`), `commandStructure.ts` (read the
override, else the spec formula), `ComplementPanel.svelte` (an "over cap" state on a column), tests.
**Behavior:** a hull without an override keeps today's template exactly. First-pass overrides [PROPOSAL, OC-5]: Eir
900 with a Medical / Science lean; Aurora keeps 750 with a Science lean; Orion 750 unchanged; Carrier leans Flight
Deck; Battleship leans Security / Engineering; no hull's TOTAL shrinks. Over-cap policy [PROPOSAL, OC-6]: never evict;
a division or total over its cap simply takes no more crew (auto-fill and transfer), and the graph marks the column
"over cap". This also covers the existing quarters-uninstall case.
**Determinism:** static data; `STRUCTURE_CACHE` stays valid. A passive Eir will absorb more pool crew on its next tick
(intended, named in patch notes). **Save:** none. **Tests:** Eir > Orion; every hull without an override is
byte-identical (CP-0 `commandStructureForHull` golden for those hulls); an over-cap complement is never reduced by any
tick; rank caps still cascade. **UI:** over-cap column styling only; CMR-10 says "Per-hull crew sizes ... the Eir
(largest crew) finally out-crews the Orion" (covered).

**Carry note (2026-11-02, CP-5 landed on 673cba2; two commits: goldens, then the caps; no SAVE bump):** `ShipTypeDef`
gained `complementCap?` / `complementDivisionWeights?`; `commandStructure.ts` `buildStructure` reads them (else the spec
template), cached per (hull, `HULL_CREW_CAPS_SWITCH`), the switch a test seam (`hullCrewCapsSwitch.fixture.ts`). Data:
Eir 900 (Security 77, Engineering 189, Science 279, Medical 234, Operations 81, Flight Deck 40; every division at or
above the explorer template's), Aurora 750 Science lean (60 / 173 / 270 / 135 / 75 / 38), Carrier 160 Flight Deck lean
(32 / 32 / 8 / 16 / 16 / 56), Battleship 160 Security / Engineering lean (56 / 48 / 8 / 16 / 16 / 16); every weight
[PROVISIONAL], the totals the user's. Enforced where crew is added, through the one gate
`remainingCapacityForSignature`: auto-crew (`resolveCrew` / `autoCrewShip`), transfer (`crewTransfer.ts`) and roster
apply (`personnelRosters.ts`). The WR-7 rule holds on the new templates (`atLeastInclusive` against the hull's own
template; swept bonus 1 to 200). OC-6: nothing ever removes crew for being over; `complementOverCap` (total, division
and inclusive rank excess, on the bulk plus assigned notables) drives the Complement panel's "Over capacity" note and
the per-division "Over cap" tag and line; the header states the hull's berths as a physical limit. The Shipyard build
card shows "N crew berths". Eir description gains "with the largest explorer crew" (OC-5 answer; the SF-6 hold and away
teams clause kept). Registry: `crew:audit:commandCaps` LIVE, probe `autoCrewHeadcount` (an Eir seats 150 more than an
Orion), read back by `cp5Registry.fixture.ts`. Goldens: `cp5Goldens.test.ts` (structure / fill / transfer of the four
overridden hulls moved, each returning with the switch off; the over-cap runs unchanged); earlier golden files that
fill to the caps run with the switch off. QA: docs/qa/2026-11-02-cp5-crew-caps-qa.html.

### CP-6: One crew lock + salvage benching + orphan repair (Task 27 engine)

**Files:** `awayTeam.ts` (`shipCrewLocked` stays the one predicate; add `crewLockReason(state, shipId)` returning
`"onMission" | "onExpedition"` for text), `seniorStaff.ts` (gated `canAssignOfficer` / `canUnassignOfficer` /
`canFireOfficer`, hire-to-seat), `personnelRosters.ts` (`applyRoster` refuses on a locked target or when a pinned
officer / notable sits on a locked ship), `captainRetirement.ts` (refuse while the captain's ship is crew-locked),
`salvage.ts` + `tick.ts` `salvageTargetBlock` (refuse while `shipCrewLocked`, new reason `shipOnExpedition`),
`salvage.ts` (bench on salvage), `crewOverlay.ts` (`resolveCrew` skips locked passive ships only if OC-11 says so),
`save.ts` (v69), tests.
**Behavior:**
- Every crew-changing action refuses with a typed reason while the ship involved is locked. Promotion, renaming and
  favoriting stay allowed (they change no allocation).
- Salvage benches ATOMICALLY: away members `assignedShipId = null` (gear stays on them, ground slots already leave
  with the hull, GO-2 sync helper `shipsWithMemberUnslotted`), officers unassigned, notables unassigned, a ground team
  loadout checked out to the hull checked back in, and the hull's complement buckets returned to `crewPool`
  [PROPOSAL, OC-12; today they are destroyed].
- First verify the expedition-salvage gap with a failing test; if a hull on an expedition really can be salvaged,
  this slice closes it (and the retire-mid-expedition case).
**Determinism:** no draws; salvage's documented one shared draw is unchanged. **Save:** SAVE_VERSION 68 -> 69,
`MIGRATIONS[68]`: bench every member, unassign every officer / notable, and check in every ground team loadout whose
ship id is not in `state.ships` (staging saves salvaged hulls before this fix); identity for a clean save except the
version; idempotent; hardened against malformed arrays like v67 -> v68. **Tests:** each action refuses while out and
works after return / claim; salvage leaves no record pointing at a removed ship; migration repairs a fixture and is a
no-op twice. **UI:** none here (CP-10).

**Carry note (2026-10-14, CP-6 core landed, commit "fix(0.14.0): salvage never strands crew or an expedition"):**
DONE: the expedition-salvage gap was real (a failing test reproduced it) and is closed. `salvage.ts`
`salvageShipLockReason` (onMissionLock first, then `shipCrewLocked`) refuses with the new reason `shipOnExpedition`
in `salvageShip`, in `tick.ts` `salvageTargetBlock` (manual and auto lanes: a queued teardown WAITS with the reason)
and on the ship page's Salvage button ("This ship is on an expedition: claim it first"). `salvageShip` is the only
path that removes a ship (no sell / scrap / retire-hull path exists; captain retirement removes no ship). Salvage
releases everyone atomically (`releaseShipPeople`): away members unassigned and unslotted (own gear stays on them),
a ground team loadout worn on the hull checked in (its committed pieces back to the Armory, still committed),
officers and notables unassigned, the complement merged into `crewPool` (no pool cap exists, nobody dropped). The
confirm dialog and the log line say who goes back (`salvageShipPeople` + `salvageShipPeopleText`). SAVE_VERSION 68
-> 69: `MIGRATIONS[68]` = `save.ts` `repairOrphanedShipRefsV69` (members, officers, notables and ground loadouts
naming a missing hull; identity for a clean save; idempotent; hardened). OC-12's "Unassigned" list is built minimally
on the Away Team tab (`awayTeamDisplay.ts` `unassignedMembersView`, Move aboard + Fire), [PROPOSAL] name pending.
NOT done (still CP-6 / CP-10): `crewLockReason` (the shared "Ship is out on a mission" text also shows for an
expedition), the officer / roster / complement-mode / retirement locks, OC-11 auto-crew pause, lock badges.

**Carry note 2 (2026-10-14, CP-6 lock landed, commit "feat(0.14.0): one crew lock for every crew change while a
ship is out (CP-6)"):** DONE: the one predicate moved to the leaf module `crewLock.ts` (`shipCrewLocked`, re-exported
from `awayTeam.ts`; a leaf because `awayTeam.ts` imports `seniorStaff.ts`), with `crewLockReason` ("onMission" wins,
else "onExpedition", null exactly when unlocked), `crewLockReasonText`, `crewLockUntilText` ("until it returns" /
"until its expedition is claimed"), `crewLockText`, `crewLockTextAmong`. Locked with typed same-ref refusals:
officer hire-to-seat (new atomic `hireOfficerToSeat`; App no longer hires then fails to seat), assign (origin and
target ship), unassign, fire (`seniorStaff.ts` `can*` + `officerBlockText`; an unknown id is now a same-ref
`noOfficer`); `applyRoster` whole (`canApplyRoster`: target locked, incl. a gear-only roster, or a pinned officer /
notable aboard another locked ship; `rosterApplyGateText`); captain retirement (`retireBlockReason` /
`retireBlockText`, new `shipOnExpedition` after `notIdle`; App's Prestige reason now reads the engine); the
complement mode toggle (new engine fn `crewLock.ts` `setComplementMode`, `unchanged` stays a silent no-op). Away
member hire / fire / reassign, ground slots, member gear and the Armory were already locked (verified). Notable
assign / unassign and manual complement edits have NO action outside `applyRoster` today (CP-7 transfer and CP-8
graduate must call the lock). Scattered texts now read the real cause: ground teams line, Away Team move / fire /
Unassigned reasons, the recruit board, member gear refusals, App refusal logs. UI: lock line with the `lock` glyph on
Senior Staff and Complement, disabled controls with visible reasons, Apply disabled with the reason and locked ships
marked "(crew locked)" in its picker, a "Crew locked" badge on Ships roster rows. Left unlocked: captain hull
reassignment (`tick.ts` `assignShipToCaptain`) checks only `captain.mission`, so a captain can swap hulls while
their ship is on an expedition (decision for the user; CLOSED 2026-10-17 by S1 "Lock it", 0a077ca5, crewLock.ts captainMoveLock). OC-11 (auto-crew pause) not built, still open.

### CP-7: Transfer (Task 25 engine)

**Files:** `crew.ts` (`canTransferCrew` + `transferCrew(state, from: shipId | "pool", to: shipId | "pool",
picks: { signatureKey, count }[])`), tests.
**Behavior:** moves up to each requested count, cap-aware per pick through `remainingCapacityForSignature` with the
target's quarters bonus AND its assigned notables counted (the `applyRoster` occupancy rule); partial when the target
fills, reported per pick; refuses on a locked ship (CP-6) and [PROPOSAL, OC-7] when a ship involved is in auto-crew
mode (the UI offers to switch it to manual first). No crew created or destroyed.
**Determinism:** RNG-free; picks applied in the given order. **Save:** none. **Tests:** division and inclusive rank caps
hold; partial fill; pool round trip; locked and auto refusals are same-ref.

**Carry note (2026-10-19, CP-7 landed, commit "feat(0.14.0): crew transfer engine (CP-7)"):** built in a NEW module
`crewTransfer.ts`, not `crew.ts`: the quarters bonus lives in `crewModules.ts`, which imports `seniorStaff.ts`, which
imports `crew.ts`, so `crew.ts` asking it would close an import cycle. API: `CREW_POOL` ("pool"),
`canTransferCrew(state, from, to, picks)` (order: `noPicks` for an empty list or a count that is not a whole number
of at least 1, `sameEndpoint`, then source before target `noShip`, `onMission` = `shipCrewLocked`, `autoCrew` = OC-7
"Manual ships only", a fresh ship with no complement reads as auto), `transferCrew` returning `{ next, gate, results,
moved }` (one result row per pick: requested, moved, `limitedBy` "targetFull" | "sourceShort" | null; `next` is the
SAME ref on a refusal or when nothing moved), `crewTransferBlockText` / `crewTransferGateText` (the lock names the
mission or expedition) / `crewTransferShortfallText`, and `crewTransferRoom` (the picker's "up to N" per row). The
target's occupancy = its bulk plus every notable assigned to it, its quarters bonus via `quartersCapacityBonus`; the
pool has no cap. Over cap (OC-6) the target takes nothing and the source can still give. Only bulk moves; notables
never move here (CP-8). No App handler (the plan names none; CP-10 adds `doTransferCrew`). No goldens moved (a new
action nothing calls yet). Not this slice: OC-11 "Pause while out" (auto-fill on a locked passive ship) is still
unbuilt in `resolveCrew`; CP-5 per-hull caps are not built yet, transfer reads whatever `commandStructureForHull`
returns, so it picks them up unchanged.

### CP-8: Graduate, notable cap, manifest generator, auto-fill counts notables (Task 26 engine)

**Files:** `crew.ts` (`canGraduate` / `graduateStandout(state, shipId, signatureKey)`, `manifestRows(state, shipId,
offset, limit)`), `model.ts` (`NOTABLE_CREW_CAP` [PROVISIONAL, OC-8]), `crewOverlay.ts` `resolveCrew` (seed notable
occupancy exactly like `applyRoster` step c), `personnelRosters.ts` (fix the stale "DORMANT overlay" comment at 275 to
277: GL-1 folds notables), tests.
**Behavior:** graduation decrements the ship's bucket by one and appends a notable ASSIGNED to the same ship (so the
ship's caps and stats are unchanged by the move), id `notable-${nextNotableId}`, name and gender from
`generateCrewIdentity(race, graduateSeed(signatureKey), nextNotableId)` [PROPOSAL rule, OC-9]; refuses at the cap, on
a locked ship, or with no such bucket. "Send back" = unassign the notable (it stays a named record in the pool of
notables) [PROPOSAL, OC-9]. The manifest is a pure paged generator: row i of a bucket = `generateCrewIdentity(race,
hash(shipId, signatureKey), i)`, never stored.
**Determinism:** graduation and manifest use no rng stream at all (pure hash seeds). The auto-fill fix changes nothing
for a save with no assigned notables (none can exist before this slice; CP-0 golden). **Save:** none (notables and
`nextNotableId` already persist). **Tests:** count drops by one and the notable appears with the same buffs; cap
refusal; manifest is pure and stable across calls; a passive ship with an assigned notable never exceeds its caps.

**Carry note (2026-10-19, CP-8 + OC-11 landed, commits "test(0.14.0): OC-11 goldens for passive ships that are out
(CP-8)" then "feat(0.14.0): graduate, notable cap, manifest, auto-crew counts notables and pauses while out (CP-8)"):**
built in a NEW module `crewGraduation.ts`, not `crew.ts` (the lock lives in `crewLock.ts`, which imports
`equipment.ts`; `crew.ts` stays the dependency-free primitives). API: `canGraduate` / `graduateStandout(state, shipId,
signatureKey)` returning `{ next, gate, notable }` (order `noShip`, `onMission` = `shipCrewLocked`, `noBucket`,
`notableCap`; either complement mode; same ref on a refusal), `graduateBlockText` / `graduateGateText` (names the
mission or expedition), `nextGraduateIdentity` (the name the confirm shows before committing), `canSendBackNotable` /
`sendBackNotable` (OC-9: unassign, the record keeps its name; `noNotable`, `notAboard`, `onMission`) with texts, and
`manifestRows(state, shipId, offset, limit)` returning `{ rows, total }` (bulk only, bucket order, row i of a bucket
= `generateCrewIdentity(race, manifestSeed(shipId, key), i)`; notables are not rows, they carry their own names).
Names seed from FNV-1a of the signature key with two new odd salts, `NOTABLE_NAME_SALT` and `MANIFEST_NAME_SALT`,
registered in `salts.test.ts`; no shared stream. `model.ts NOTABLE_CREW_CAP` = 50 fleet-wide (OC-8 answered, not
provisional), assigned or not. Identity only (user 2026-10-16): the notable keeps its bucket's signature, so the crew
map is unchanged by a graduation. `crew.ts notableSignature` is the shared helper. `resolveCrew`: (B23) every notable
assigned to a passive ship is seeded into the auto-crew occupancy and stripped back out (the applyRoster step (c)
rule; no notable aboard = the old fill); (OC-11, "Pause while out") `if (mode !== "passive" || shipCrewLocked(state,
ship.id)) return ship;`, so a ship out on a mission, patrol or unclaimed expedition fills on the first tick after it
is free. Wiring: `crew:audit:notables` is live (sheetUnload: the notable carries one crewmember's share, 20 / 19 of
the 19 left) plus `crew:audit:notableIdentityOnly` (a move of 0 against the ship before graduating). Goldens moved
ONLY by OC-11, each reproduced with the pause switched off (`complementOc11Switch.fixture.ts withOc11Off`, a test
mock of `shipCrewLocked`): the three CP-0 mission runs (the mission ship no longer boards window 1's crew mid-run;
the CP-1 and CP-2 proofs run unchanged inside the switch), `wiringGoldens` lunarMine, and the new OC-11 expedition and
patrol pins; the OC-11 home control and every other golden did not move. Stale "DORMANT" notable comments fixed in
`model.ts` and `personnelRosters.ts`. No App handler (CP-9 adds `doGraduate`); the notable marquee is CP-9 UI; the
Academy promotion is SUGGESTIONS only. Not built: a way to assign an unassigned notable outside `applyRoster`.

### CP-9: Complement table, graduate modal, manifest (Tasks 25 / 26 UI part 1)

**Files:** `ComplementPanel.svelte` (bucket table under the graphs: Group, Division, Rank, Rarity, Buffs, Count, sort
by rank / rarity / division, division filter, row checkboxes), new `ManifestModal.svelte`, App handlers
`doGraduate`, glyphs `graduate`, `manifest` (icons.ts + ICON_SEMANTICS).
**UI:** mocked in CMR-8 (table, sort chips, filter chips, "Graduate one", the graduate confirm with the generated name,
the Manifest button). The manifest LIST layout and paging for 750 rows are not mocked: **sketch sign-off needed** for
the manifest view only. Verify in preview (`?dev`): graduate from a full ship, see the notable strip update; open the
manifest; 375 px no horizontal scroll.

**Carry note (2026-11-02, CP-9 built to the signed mockup and the user's eight A picks; no SAVE bump, no golden
moved):** the display logic lives in a new tested `src/lib/complementTableDisplay.ts` (group rows, every buff as a chip
with profession / exclusive / held kinds, sorts, division filter and counts, the selection summary, the manifest page
with group headers and notables first, the pager); `ComplementPanel.svelte` draws it in one DOM (a table on a wide
panel, cards plus two sideways chip rows plus a sticky bottom selection bar under 700 px of container width). The
Graduate confirm and the read-only Manifest are `ActionModal`s (a bottom sheet on a phone). Send back sits on each
notable card. App handlers `doGraduate` (returns the new notable id for the "just graduated" card) and
`doSendBackNotable`. Engine: `manifestRows` gained an optional `profession` filter (names unchanged by it; the CP-8
call shape is untouched). Glyphs `graduate`, `manifest`, `transfer`, `sort`, `diamond`, `chevronLeft` (icons.ts +
ICON_SEMANTICS); the notable star is now the SVG star. Deviations: the mockup's cap message "Send one back ... to make
room" was untrue (OC-8: the 50 counts every notable, assigned or not), so it reads "The fleet already has 50 notable
crew" and the confirm says every notable counts; the "Lt. Cmdr." name prefix is not built (no short rank titles
exist); Transfer shows greyed ("Crew transfer is not built yet") until CP-10 wires it. OPEN (user's call): at 50
notables nothing can make room (no dismiss / retire action). QA: docs/qa/2026-11-02-cp9-complement-manifest-qa.html.

### CP-10: Transfer, the crew pool, lock badges, the benched list (Tasks 25 / 27 UI part 2) [needs a sketch]

**Files:** `ComplementPanel.svelte` (Transfer N selected... opens a target picker: another ship or the pool, per-row
counts, the per-pick partial result), a crew pool view [PROPOSAL home: a "Crew pool" section on the Personnel
Rosters facility, OC-10], lock badges on Senior Staff, Complement and Away Team ("Aurora is on an expedition: crew
locked", CMR-8), and the benched members list [PROPOSAL name "Unassigned", on the recruitment board, with Move to
ship and Fire, OC-12], App handlers.
**UI: needs user mockup sign-off** for the pool view, the transfer picker and the benched list (CMR-8 shows only the
"Transfer 12 selected..." button and the lock line). Verify in preview: transfer 12 from pool to a manual ship; a
locked ship disables every crew control with the reason; salvage a hull with members and find them in the list.

**Carry note (2026-11-02, CP-10 built to the signed mockup and the user's ten A picks; no SAVE bump, no golden
moved, no engine rule changed):** the picker's numbers live in a new tested `src/lib/crewTransferDisplay.ts`
(destination cards, the source block, each row's willMove / warning / "up to", the summary and button, the result,
the log line, "Transfer more", the pool's division stats), every count from ONE `transferCrew` preview on the live
state, so the picker cannot promise what the engine would not do. New components: `CrewTransferModal.svelte` (desktop
two columns; phone two steps in one DOM via the ActionModal container), `CrewPoolPanel.svelte` (the Personnel Rosters
"Crew Pool" tab: headcount, six division tiles, the table, Manifest, "Send N to a ship..."), and the CP-9 table and
manifest extracted to `CrewGroupsTable.svelte` / `CrewManifestModal.svelte` (their CSS to the global `crewGroups.css`,
cg- prefixed) so the ship and the pool share them. `manifestRows` / `manifestView` read the pool for the id "pool"
(`MANIFEST_POOL_ID` = `CREW_POOL`; display only, names seeded the same way). App: `doTransferCrew` (log line, save;
a refusal is logged with the gate text), the facility sub-tab `activePersonnelRostersSubTab`, the ship sub-tabs'
`crewLock` mark (SubTabs gained an optional `crewLock` field: an SVG lock and the words as a title; the tab stays
live). Lock lines: Away Team gained one panel line (it replaced the ground teams' own lock line, which the controls now point at); Complement's reads "crew changes are locked ... Favorites and the
Manifest still work" and its toggle "(paused while out)". Unassigned shows the member's worn gear
(`awayTeamDisplay.ts unassignedGearText`). Glyphs `crewPool`, `minus`, `plus`. Deviations: ALL also shows on the
phone rows (pick 3 names it; the phone frame omitted it); the hull badge hides when it equals the ship's name; twin
groups (same name, rank, rarity) name their buffs; the row warning names the exact cap that bound (berths, division,
or rank and above) instead of "nearly full". QA: docs/qa/2026-11-02-cp10-transfer-pool-qa.html.
Fix round (review minors): a short row's reason reads the state when that row was applied (the rows above it and
itself), not after later rows; the pool note names the specialty-division-first pass; a division change from any
source resets "Show more". **Known minor follow-ups (logged, not built):** (a) the preview sums moved crew by
signature, so a legacy save holding two buckets with the same signature at the source can show a row's willMove
that differs from the engine's per-bucket result; (b) the live preview runs one `transferCrew` per tick plus one probe
per row (and one per short row), which could cost noticeable time with hundreds of picked rows.

### CP-11: Crew module and early sensor blueprints (Task 28 engine)

**Files:** `model.ts` `BLUEPRINTS` (15 new `equipmentOutput` blueprints: 3 bridge, 9 quarters, Wide-Beam /
Focused-Beam / Balanced arrays; names "<variant> Blueprint" like the Bio-Resonance one), research / Fabricator tests,
Archive count test.
**Behavior [PROPOSAL tiers and recipes, OC-15]:** SMS-2's table: tier 1 day one (Balanced Command, Utilitarian
Quarters, Wide-Beam and Balanced Arrays), tier 2 (Focused Command, the six division quarters, Efficient Quarters,
Focused-Beam Array), and Flag Command + Elite Quarters at tier 2 [PROVISIONAL] until OC-15 decides on a Lab tier 3
rung; inputs are existing components only. No Material Lines dependency.
**Determinism:** the mint rides the existing generation path (stamping already done). **Save:** none. **Tests:** each
blueprint mints its variant; a fresh save can research and craft a Wide-Beam Array with no relic; the archive gains
15 rows (patch notes must say completion % drops, the Task 10 precedent).
CP-11 also owns a Guest Wing blueprint (G1-1 added the variety, `quartersGuestWing`; review 2026-10-19).

**Carry note (2026-11-03, CP-11 landed in d0eea0d plus the user-calls fix round; no SAVE bump):** fifteen ordinary
`equipmentOutput` blueprints in `model.ts` `CREW_MODULE_BLUEPRINTS` (tier 1 Balanced Command, Utilitarian Quarters,
Guest Wing, Wide-Beam and Balanced Arrays; tier 2 Focused Command, the six division quarters, Efficient Quarters,
Focused-Beam Array; tier 3 Flag Command), no relic or decode gate; goldens in `cp11Goldens.test.ts` traced through
`cp11BlueprintsSwitch.fixture.ts`. Recipes: audit section 5 (call 13; Medical Quarters takes 1 Purified Biomass)
and section 4.8 for the arrays, approved 2026-11-03 ("Approve as proposed"); components only, no Iridium Catalyst
(M7), no canister (Flag Command kept as built). The Guest Wing's tier 1 is the user's call (2026-11-03); the research
and craft costs (`CREW_MODULE_BLUEPRINT_COSTS`) stay [PROVISIONAL]. **Distinct recipes [PROPOSAL, for the user's
sign-off]** (user 2026-11-03, "Tell them apart"): one blueprint of each shared section 5 pair swaps one input for a
like-cost tier 1 component (a Frame Segment and a Power Coupling are 4 refined units each, an Ingot and a Wafer 1 each):
- Engineering Quarters (pair with Efficient): Frame 2 + Coupling 2 + Ti Ingot 1 -> Frame 2 + Coupling 2 + Wafer 1
  (the workshop's diagnostic consoles).
- Science Quarters (pair with Operations): Frame 2 + Wafer 2 + Coupling 1 -> Frame 2 + Wafer 1 + Ti Ingot 1 +
  Coupling 1 (a titanium lab bench).
- Guest Wing (pair with Utilitarian): Frame 2 + Ti Ingot 2 + Coupling 1 -> Frame 1 + Ti Ingot 2 + Coupling 2 (fewer
  crew bunks to frame; the cabins run their own climate loop).

`materialLinesMl2.test.ts` again enforces "no two varieties of one slot share an input map" with no named exceptions
(implants aside, as before). CP-12 must flip the bridge+quarters:obtainable row. QA:
docs/qa/2026-11-03-cp11-crew-modules-qa.html.

### CP-12: Bridge and Crew Quarters tiles (Task 28 UI)

**Files:** `ShipSystemsPanel.svelte` `SYSTEM_SLOTS` (+ Bridge Module, Crew Quarters, SVG glyphs `bridge`,
`quarters`), App `BAY_SLOT_ORDER` (+ bridge, quarters), the Fabricator group for crew modules, icons.ts +
ICON_SEMANTICS.
**UI:** mocked in CMR-9 and SMS-1 (tiles with the variant line and Swap / Install). Verify in preview: install a
Balanced Command on the Aurora and see the officer lift in the stat breakdown; 375 px.

**Carry note (2026-11-03, CP-12 landed; two commits: goldens, then the tiles; no SAVE bump, no rule change):** the
Systems tiles are one list, `game/shipSystemTiles.ts SHIP_SYSTEM_TILES` (Cargo Bay, FTL Drive, Reactor Core, Spec
Utility, Sensor Suite, Bridge Module, Crew Quarters), which `ShipSystemsPanel.svelte` draws and the registry measures
(`installFromShipSystemTile`: the tile's own fitEquipment). Install / uninstall is the existing engine (allow-empty, the
gear lock, the stamp rules); nothing evicts (CP-5), Elite Quarters 0 berths (WR-7), both pinned in `cp12Goldens`.
Tile variant line (`src/lib/crewModuleTileDisplay.ts shipSystemTileLine`, every number from the engine readers): the
array's name, or "<module> · <what it does on this hull>". The crew module compare reads the crew-inclusive sheet
after the real fitEquipment (officer lift per stat, Crew Berths for quarters); the source popover splits a "Bridge
Module" bucket off Senior Staff. OC-25: `EQUIPMENT_SLOTS.sensor.label` and the sensor blueprints' install hints read
"Sensor Suite" (display only). Fabricator: a "Crew Modules" group after Modules (`awayGearDisplay.ts`, test seam
`CREW_MODULE_SHELF_SWITCH`); Logistics `BAY_SLOT_ORDER` gained bridge and quarters. SVG: empty-tile plus; Bio-Resonance
Array draws `relicLeviathanScale`, the Resonance Sensor Array `sensorArray`. Registry: `bridge+quarters:obtainable`
LIVE (probe fillableBerths through the tile list); release gate pending 37 -> 36. Goldens: `cp12Goldens.test.ts`
(captured first) moved only text, shelf and the registry row, each reproduced by `cp12Switch.fixture.ts withoutCp12` /
`cp12Registry.fixture.ts cp12ReadBack`; cp11Goldens, emodGoldens and refugeeGoldens read CP-12 back (no hash re-pinned).
QA: docs/qa/2026-11-03-cp12-bridge-quarters-qa.html.

### CP-13: Hull-type module bonuses (G5) [blocked on OC-13]

**Files:** `crewModules.ts` (`HULL_FAMILY_MODULE_BONUS: Record<ShipSpec, { bridge, quarters }>`, scaled by the
module's `moduleEffectScale`), `crewOverlay.ts` (ship-stat lines through the crew map; division lifts inside the
quarters multiplier), `model.ts` `OfficerCombatMods` / `combat/bridge.ts` (the tactician bridge's weapon line, frozen
per patrol cycle like `officerCombat`), `ShipSystemsPanel.svelte` (the hull bonus line on the tile).
**Behavior [PROPOSAL lines, SMS-1]:** Bridge: General +6% FTL and unload; Prospector +6% extraction; Tactician +5%
weapon damage; Explorer +10% sensors. Quarters: the family's two signature divisions +8% plus one perk (General guest
quarters [dead until G1, OC-13], Prospector +3% rare find on hauls, Tactician injured crew recover 15% faster,
Explorer med bay time 10% shorter). One catalog: a module gives the bonus of the hull it is installed on. Quarters
bonuses never add capacity (capacity principle, crew spec 182). The tactician weapon line comes from installed gear,
not crew, so D12 is not crossed; say so in the comment.
**Determinism:** a ship with no module is the same object; combat lines frozen per cycle (replay parity). **Save:**
none. **Tests:** each family line on its hull only; moving a module changes its bonus; patrol replay parity with the
weapon line; neutrality with no module. **UI:** the tile line is mocked (SMS-1).

**Carry note (2026-11-03, CP-13 built; two commits: goldens, then the bonuses; no SAVE bump):** one catalog,
`crewModules.ts HULL_FAMILY_MODULE_BONUS` (the SMS-1 lines as approved with OC-13), each line x the module's
`crewModuleEffectScale` (rarity, quality, ascension, wear, its Crew Stations / Crew Efficiency lines: the mockup's "the
hull bonus scales the same way"); the General guest perk is G1-1's `GENERAL_QUARTERS_GUEST_PERK`, named by the
catalog (built flat; the fix round scales it like the rest, see the fix-round note below). Readers: the bridge sheet lines in `crewOverlay.ts applyHullFamilyLines` (after the museum);
the division lifts inside `quartersProfessionMultiplier(mod, profession, hullSpec)`; the Tactician weapon line frozen per
patrol cycle (`PatrolMissionState.hullWeapon`) and per expedition ship battle (`ShipEventBattle.hullWeapon`), applied by
`combat/bridge.ts applyHullWeaponLine` (gear, so D12 holds; the forecast and Battle Rating fight it too); rare finds added
to the run's rare chance multiplier (`tick.ts surveyRareFindFor`, every mission but a transport); the bay perks frozen
at Ground Ops dispatch (`GroundOpsFactors.hullInjuryShare` injuries only, `hullBayShare` every condition, cut c as the
care share c / (1 - c)). Determinism: a captain mission, short-range run and patrol carry `hullBonus: 1` from dispatch
(`hullFamilyStamp`, carried every cycle) and read the bonus only with it, including the output share, Deck Handling,
combat speed and the gear repair rates (`RepairContextIndex.hullBonusRun`); expeditions freeze at dispatch. UI: the tile's
"Hull bonus on <family>: ..." line and the install compare (`crewModuleTileDisplay.ts hullFamilyBonusLine`), a "Hull
bonus" bucket in the source popover, Help topic "Hull bonuses". Registry: `hullFamilyEntries` enumerates every catalog
line LIVE (pending 36 -> 36). Goldens: `cp13Goldens.test.ts` (captured first) through `cp13Switch.fixture.ts withoutCp13`.
QA: docs/qa/2026-11-03-cp13-hull-family-qa.html.

**Fix round (2026-11-04, the user's CP-13 calls plus the review's truthfulness fixes; no SAVE bump):** the General
guest perk scales with the module (`model.ts foldGuestQuarters` reads `crewModuleEffectScale`, which moved to model.ts
with `CREW_MODULE_LINE_KNEE`, `crewModuleLineScale` and `HULL_FAMILY_SWITCH`, all re-exported by crewModules.ts; read
only at the short-range dispatch gate, so no run in flight moves; switch off = the flat +10%). The ship readout gains
Unload Speed and Sensors rows with every source bucket. The Tactician injury perk also acts on the legacy
(non-Ground-Ops) claim: frozen at every expedition dispatch (`Expedition.hullInjuryShare`, written only when non-zero),
read by `injuries.ts applyExpeditionInjuries`; a run without it recovers as before. Help now says wear lowers a hull
bonus only where it lowers the module's own effect (the run sheets of missions, short-range runs and expeditions); on
patrols, the rare-find roll, mission output and the bay both read the module at full condition. The bay perks are
worded as care shares, and the quarters tile shows each one's effect on that ship (`groundOps.ts shipBayCareNow`,
`medicalBay.ts careShareSpeedUp / careShareTimeCut`). The weapon line lifts every damaging weapon's band top at least
one point (`combat/bridge.ts applyHullWeaponLine`), so +5% never rounds away on a small weapon. The Ships tab, roster and
swap-picker Battle Ratings fight with the weapon line, as the patrol forecast does.

### CP-14: Base hull sensors and Science amplification (G6 part 1) [blocked on OC-16, OC-20]

**Files:** `model.ts` (`ShipTypeDef.baseSensors?`, folded flat into `shipDerivedStats.sensors` before lifts),
`crewOverlay.ts` (Science amplification lift), `seniorStaff*` (a Science seat sensor lift [PROPOSAL]), tests.
**Behavior [PROPOSAL, SMS-3]:** base sensors Aurora 35, Orion 25, Eir 15, warships 10, freighter and prospectors 0.
Science crew lift `8% x ln(1 + scienceHeads / 25)` (unbounded, concave: D23); Science officer seat +12% growing with
rank, amplified by Focused Command on explorer and prospector hulls (built). Lifts multiply after flat sources
(today's pattern) unless OC-21 says add.
**Determinism:** survey missions read sensors live per cycle, so an in-flight survey on an explorer yields more from
the next cycle (intended, patch notes); expeditions read the dispatch snapshot (old runs unchanged); the telescope
lift at 40 may now trigger on explorers (intended). **Save:** none. **Tests:** base sensors on each hull; a hull
without the field unchanged; amplification zero with no Science crew; CP-0 goldens for non-explorer fixtures.

**Carry note (2026-11-04, CP-14 built; two commits: goldens, then the slice; no SAVE bump):** base sensors live in one
table, `model.ts HULL_BASE_SENSORS` (OC-16: Aurora 35, Orion 25, Eir 15, Destroyer, Battleship and Carrier 10; the
freighter and prospectors omit `ShipTypeDef.baseSensors`), folded flat with the Sensor Suite's points in
`hullDerivedStats`. The Science lift (OC-20 numbers, OC-21 multiply) is `crewOverlay.ts applyScienceSensorLift`, after
the crew overlay and before the museum: crew `0.08 x ln(1 + heads / 25)` (Science complement plus assigned Science
notables; unbounded, concave, D23) and the Science seat `0.12 x officerRankMagnitudeFactor(rank)` x the officer's output
multiplier (the bridge module, so Focused Command on explorer and prospector hulls, and the captain's Mentor / Legendary
Captain); then the museum, Inspiring Leader, the CP-13 Explorer bridge line and Keen Sensors multiply as before.
**Determinism (deviation from the line above, the hub's brief "runs in flight byte-identical"):** a survey mission or
short-range run carries `hullSensors: 1` from dispatch (`hullSensorsStamp`, written only when CP-14 moves that ship's
sensors; carried every cycle) and only a stamped run reads the base and the lift, so an in-flight survey does NOT pick
them up next cycle; expeditions freeze at dispatch; patrols read no sensors. UI: Ship Systems Sensors popover gains
Science crew and Science officer buckets (the officer's bridge share joins Bridge Module), Base / hull shows the hull's
own; the Sensors (i) text, the console's sensor gate line and a new Help topic "Sensors" (numbers from the engine).
Registry: per-hull `ship:SHIP_TYPES:<hull>:baseSensors`, `ship:SHIP_SEAMS:scienceCrewSensors` / `scienceSeatSensors`,
`ship:audit:scienceSeatFocusedCommand` (all LIVE); `ship:SHIP_TYPES:sensors` flipped LIVE (pending 36 -> 35);
`expedition:audit:frontierSensors` now reads Tier III's gate (every explorer clears Tier II's 10 on its own).
`cp14Registry.fixture.ts cp14ReadBack` holds all of it apart in the registry pins. Goldens: `cp14Goldens.test.ts`
(captured first) through `cp14Switch.fixture.ts withoutCp14`; 30 older golden files run with `cp14OffForThisFile()`.
QA: docs/qa/2026-11-04-cp14-hull-sensors-qa.html.

**Fix round (2026-11-04, the user's CP-14 calls plus the review's fixes; no SAVE bump; answers recorded verbatim under
USER ANSWERS (2026-11-04): CP-14 calls):** the Science crew and Science officer lifts stay separate from every other
crew boost (no code change; Help says so). The dead frontier gate is retired: `propulsion.ts FRONTIER_SENSORS` Tier II
10 -> 0 ("no gate", as Tier I), because only an explorer can attempt a tier and the least explorer's own base sensors
(Eir 15) clear it; Tiers III to VII (20, 30, 40, 55, 65) each still refuse a bare Eir and stay. `frontierSensorsNeeded`
reads the old table only with the CP-14 test switch off, so `withoutCp14` stays the pre-CP-14 game. A tier with no gate
shows no sensor row on the console's locked panel or candidate card (Tier I's "No sensor minimum" line went with it).
The short-range sheet's sensors (Tier I 10, Tier II 20) stay: any hull can fly a short-range job, and the freighter and
the prospectors carry no base sensors, so both still bind. Gates are read at dispatch and in previews only, so a run in
flight is unaffected. The registry's frontier row lists the live gates (cp14ReadBack restores its old claim), and the
warship `baseSensors` rows measure the sheet and the short-range run only (a warship can fly neither a survey nor an
expedition: both now out of scope). Help: the Sensors topic says only some hulls carry sensors, that the Science lifts
stand alone, and that an expedition freezes its sensors while a survey or short-range run keeps reading them as it flies
(the Hull bonuses topic says the same of its bonuses). Smaller: a pure no-sensors shortcut before the Science lifts are
read, one `officerOutputMultiplier` helper for the four officer loops, and a one call / 997 s chunks / 1 s steps parity
case. **Patch notes (truthfulness):** a survey or short-range run already out when CP-14 lands does NOT pick up the hull's
base sensors or the Science lifts at its next cycle; it carries no hullSensors stamp and flies as dispatched. Only runs
dispatched after the update read them (the Determinism line above, "yields more from the next cycle", is superseded).

### CP-15: Patrol cloak and threat detection (G6 part 2) [blocked on OC-19] **DEFERRED to 0.14.x (T3)**

**Status (2026-11-11, CP-21 close-out):** not built in 0.14.0. Moved to 0.14.x with OC-19 (session resume notes
2026-10-26, "Moved to 0.14.x: EM-9, G2-8, CP-15, the Spacer ramp"; the wiring registry keeps `particleTraceDetector`
and sensors at patrol as deferred rows owned by CP-15). The plan below stands for that release.

**Files:** `combat/bridge.ts` (the player combatant's `particleTraceDetector` from sensors, `rating / (rating + K)`
[PROPOSAL K 60]), `combat/patrolWave.ts` / `enemyWave.ts` (a rare cloaked-raider opener), `model.ts`
`PatrolMissionState` (a per-cycle flag field so a cycle dispatched before the slice keeps its exact waves), tests.
**Determinism:** the detector draw already exists and fires only when an ambush is set; the opener is decided on a
NEW keyed salt from the wave seed, only on flagged cycles. **Save:** none (optional flag). **Tests:** an unflagged cycle
replays byte-identically (CP-0 patrol golden); flagged replay == live; detection chance rises without reaching 1.

### CP-16: Final-retirement warning and Hall of Command (Task 29)

**Files:** `captainRetirement.ts` (append `{ captainName, levelReached, retirementNumber, missionsFlown,
retiredAtGameSeconds }` to optional `GameState.hallOfCommand?`), `model.ts` (optional `CaptainState.missionsFlown?`,
incremented per delivered captain-mission cycle and per completed patrol cycle from this slice on), App retire modal
(a warning callout when `retirements === MAX_CAPTAIN_RETIREMENTS - 1`), Archive "Hall of Command" subsection.
**Behavior:** one entry per retirement, appended exactly once; earlier retirements have no entry (nothing to rebuild
from) [PROPOSAL, OC-22]. **Determinism:** game time only. **Save:** none (absent-safe optional fields, the Task 12 to 21
precedent; note in save.ts under v69). **Tests:** entry appended once; counter increments per cycle; big == small
mission parity with the counter. **UI:** CMR-10 one-liner only: the Archive subsection layout is small, **quick sketch
in the slice report** (not a blocking mockup).

**Carry note (2026-11-06, CP-16 built; two commits: goldens, then the slice; no SAVE bump, still v71):** one leaf module,
`captainNotables.ts`, owns the record. `CaptainState.missionsFlown?` (+1 per delivered mission cycle, completed patrol
route and delivered short-range cycle: the same per-call counts the officers' missionsCompleted reads, so a pure additive
count, chunk-independent) and `CaptainState.commandNotables?` (`{ kind, label, atGameSeconds }`, in time order) sit LAST
on the captain in that order (`withCommandKeysLast`, so a whole-state hash reads the same bytes however a span is cut).
`GameState.hallOfCommand?` gets exactly one `HallOfCommandEntry` per retirement (`retireCaptain`); the successor is a new
identity and carries neither field. Notables (user 2026-11-06): level milestones every `LEVEL_MILESTONE_EVERY` (10)
levels, stamped at the game second the crossing XP was credited (each XP source records `XpSpan`s, the extraction and
short-range whole ticks and the patrol's won waves, and `levelMilestoneTicks` searches them with the arm's own XP product,
only when the fold passed a milestone); firsts: `firstExpedition` and `firstTierTwoRun` at the dispatch (expedition:
`Expedition.captainId`; short-range: the Tier II slot's dispatched captain), `firstRelic` at an expedition's claim (a
relic reached the vault) or a short-range delivery's whole tick, `firstRefugeeRescued` at an Evacuation arrival's whole
tick (credited by the board slot's captain). Stamp rule: the refugee / relic find convention, call start + max(1,
ceil(offset)) x tickDurationSeconds; one call == 997 s chunks == 1 s steps whenever the XP arithmetic is exact (integer
XP, the existing captain XP parity condition). "Promotions and titles": none exist for captains in code, so none recorded.
UI: the retire confirm's final-retirement callout (`isFinalRetirement`, `finalRetirementWarningText`); the Archive tab's
HALL OF COMMAND panel above the item record (`HallOfCommandPanel.svelte`, `hallOfCommandDisplay.ts`), hidden until the
first entry; Help topic `hallOfCommand`. Registry: `captain:progression:missionsFlown`, `:commandNotables`,
`:hallOfCommand` and `captain:audit:commandFirsts`, all live (pending unchanged at 35). Older goldens run with
`cp16OffForThisFile` and `cp16ReadBack`. Later: the planned notable-event ledger can feed `withCallNotables` /
`recordCommandFirst` directly.

**Fix round (2026-11-06, the user's CP-16 calls plus the review's fixes; no SAVE bump, still v71; answers recorded
verbatim under USER ANSWERS (2026-11-06): CP-16 calls):** placement, short-range counting, dispatch dating and the fresh
successor stand as built. Lost patrol routes now count: `missionsFlown` adds every patrol route that ends, won or lost
(a won route is the `routes` the officers' missionsCompleted reads, a lost one is counted on the call its wreck limps
home, `endReason` "defeat", so one call == 997 s chunks == 1 s steps); a recall adds no count of its own (a recalled
route that flies home is booked as completed by the engine, as before, and counts once). Golden `patrol:lost` added
(pre pin captured with the slice switched off; the moved pin is the route counted and its won first wave's level 10).
The final-retirement warning and the Help topic now also say the slot's share of the fleet-wide captain XP bonus stops
growing (`retirementExpMultiplier` sums each captain's retirements, so a locked-in slot keeps its +25% and only other
slots raise it; `lockedInRetirementXpPercent`). Registry: the `captain:audit:commandFirsts` claim is narrowed to the
dispatch it probes, and three live audit rows measure the other paths (`:commandFirstRelicClaim` through
`claimExpedition`, `:commandFirstRelicShortRange` through a delivered short-range cycle's find, `:commandFirstRefugee`
through an Evacuation's arrival); `captain:progression:commandNotables` now measures a level milestone and a first
(pending unchanged at 35). The Help em dash guard (`helpTopics.test.ts`) is restored to the real U+2014 character.
Hall panel: a hidden comma before the "final" chip, and each card's name is a styled span (the Archive has no heading
levels). Tests: the short-range first relic, a Tier II short-range dispatch, two captains with a slot swap between
calls, a time skip and fractional progress, a real second claim, and whole-state chunk parity (two older orderings,
`discovered` and the lifetime tally maps' key order, read as sets: they predate CP-16). Captain titles: logged in
SUGGESTIONS.md (CAPTAIN IDENTITY, earned captain titles); nothing is recorded today.

### CP-17: Roster dropdown on the ship personnel screen (Task 30)

**Files:** `SeniorStaffPanel.svelte` (or the ship detail header shared by Senior Staff and Complement), App handler
reuses `doApplyRoster`.
**Behavior:** a select of saved rosters plus an Apply button (never acts on change); if the ship's current people
differ from every saved roster, Apply first shows the locked "unsaved configuration will be lost" warning (crew spec
450 to 452); disabled with the reason while the ship is locked (CP-6). **Tests:** display helper picks and the warning
condition. **UI:** CMR-10 one-liner; follows the existing select + button pattern, no mockup needed.

**Carry note (2026-11-06, CP-17 built; UI only, no engine or save change, still v71; no registry row, a picker carries
no stat; pending unchanged at 35):** `ShipRosterBar.svelte` sits above the Senior Staff and Complement panes of the ship
page (App renders it in both branches) and calls App's `doApplyRoster`, the facility's handler, so the linked loadout,
the EM-2 power log and the CP-6 refusal log are shared. Decisions live in `shipRosterDisplay.ts` (tested):
`shipRosterOptions` lists the rosters with `includePeople` (the facility disables Apply for the rest; it enforces no hull
filter, so neither does this); "saved" (`shipMatchesRoster`) = every seat holds the roster's officer (empty matches
unpinned) and the notables aboard are exactly its pins, as a set, with a pin the engine would skip read as no pin; the
bulk complement is not compared. `shipSetupUnsaved` = the ship has people and matches no roster; Apply warns
(`shipRosterApplyWarns`) only when it is unsaved AND the engine's `applyRoster` would change this ship's officers or
notables, so the words stay true. `shipRosterApplyBlock`: the ship's own crew lock first (`crewLockReasonText` +
`crewLockUntilText`, the facility's line), then `canApplyRoster`'s gate words. No rosters: a truthful empty line (the
facility's empty-hint pattern), not a hidden bar. The crew spec (crew-0.14.0-plan 443 to 445) fixes the meaning, not the
words, so the modal follows the facility's Unsaved Name pattern (title "Unsaved Configuration", Cancel / Apply anyway).
Help: rosters had no topic; new `personnelRosters` topic. QA: `docs/qa/2026-11-06-cp17-roster-dropdown-qa.html`.

**Fix round (2026-11-09, the user's CP-17 calls plus the review's fixes; display and log only, no engine or save change,
still v71, pending still 35; answers recorded verbatim under USER ANSWERS (2026-11-09): CP-17 calls):** supersedes the
carry note's warning rule. `shipRosterApplyWarns` now needs a real loss: a seat on the target ship goes from officer X to
someone else. Confirmed in `applyRosterSteps`: step (a) is the only removal of a person from the target ship, step (b) and
step (c) only add. Gear is the other thing that can leave: a linked loadout that lands checks in the ship's current
loadout or returns its manual gear to the spare pool. Nothing is destroyed and gear is not part of a roster's people, so
it does not warn (as before). New `rosterApplyPulls` reads the engine's own `applyRoster` back to list who leaves another
ship (officers, then notable crew; a notable the caps keep out is not listed). `shipRosterApplyConfirm` is the picker's
ONE confirm step, combining the unsaved warning and the pull list; the facility has a pull-only confirm (it never had the
unsaved warning, and the answers did not add it). App's `doApplyRoster` adds a second log line, `Roster "X" pulled A from
Ship, B from Ship.`, read before the apply; "Applied roster" is unchanged and no golden or test reads either line, since
`doApplyRoster` is App-only. `shipRosterGearLine` is the hull line for both surfaces, worded from `checkOutTransition`
("type must match the pin"): a free loadout pinned to another hull. A loadout another ship wears never reaches that rule
and stays on that ship, so it gets no line, and the Help text now says so rather than saying it stays in the Armory. The
status line's cap case is fixed: `rosterMatch` reads a ship as "capped" when its seats match, its notables are all pins,
and re-applying (read back from the engine) would change no one, so a clean apply that skipped a pin says "match X, as far
as this ship's caps allow", and the unsaved warning agrees with it. The bar states a pinned person's lock but not the
ship's own: both panes under it already carry that line, and Apply keeps the reason as its title. The facility shares the
gate-to-text mapping through `rosterApplyRefusal` rather than `shipRosterApplyBlock` itself, because that one's gear-only
branch would add a line the facility never showed; its output is unchanged.

### CP-18: Soft captain level cap (Task 31)

**Files:** `model.ts` `xpForNextLevel` (+ `CAPTAIN_SOFT_CAP_LEVEL` 30, `CAPTAIN_SOFT_CAP_GROWTH` 1.08
[PROVISIONAL, OC-23]), `offlineSummary.ts` (already shares the curve).
**Behavior:** identical below the threshold; past it, `300 * level * growth^(level - threshold)`, so levels never stop.
A captain already past 30 keeps every level and simply needs more XP for the next. **Tests:** both sides; offline
summary uses the same curve; integer-safe for level 200.

**Built (2026-11-09):** `xpForNextLevel` is byte-identical through level 30 (level 30's own cost stays 9,000; level 31 is
the first that costs more, 10,044). The factor is built by repeated multiplication and the cost rounded once with
`Math.round`, memoized by level; `Math.pow` is implementation-approximated, so it is never used. Every cost matches the
exact rational through level 266 (a BigInt test), is a safe integer through level 356, and saturates at `Number.MAX_VALUE`
from level 9,061 so the level still comes. Stored `xp` is left alone: no migration, no SAVE_VERSION bump (the new price is
never below the old, so nothing can level up from the change, and a surplus only the fold's carry could leave spends at
the new price on the next award). Every consumer already read the one function (tick's three folds, the CP-16 milestone
search, `offlineSummary.ts`, both App bars); there was no other copy and no cached table. Goldens: `cp18Goldens.*`,
switch `cp18Switch.fixture.ts` (`wr9Goldens` and `shortRangeRelicsGoldens` run with it off: their long flights carry a
captain past level 31), read-back `cp18Registry.fixture.ts`. Registry:
`captain:progression:softLevelCap`, probe `captainLevelPrice`. Also noted: one `economyTick` call spends one berth budget
(at most 10 with every rung, the EM-4 precedent), so a "one call" parity row must stay within 10 cycles; the big-award
row uses a raised XP rate for 1500 s instead of a long run. QA: `docs/qa/2026-11-09-cp18-soft-level-cap-qa.html`.

**User answer (2026-11-09):** "Keep x1.08 for now (Recommended)". Ship it as built; `CAPTAIN_SOFT_CAP_GROWTH` 1.08 stays
[PROVISIONAL] for the 0.16.0 balance pass.

**Threshold reading:** the level 30 to 31 step is level 30's own cost and still costs 9,000; the first dearer step is 31 to
32 (10,044, was 9,300), per the formula above (`growth^(level - threshold)` is 1 at level 30).

**Patch-notes carry (0.14.0):** veterans past level 30 will see their XP bar drop, because the same stored XP is now a
smaller share of a larger price. Example: a level 60 captain's next level goes from 18,000 to about 181,000 XP. No levels
are lost, and no XP is taken away.

**Fix round (2026-11-09):** a past-cap parity golden at a real, non-dyadic multiplier, `mission:realRate` (one
retirement, x1.05; level 39 holding 22338 XP; the 1050 XP of a 1000 s run lands exactly on the 23388 price), agrees in
1 s steps, 997 s chunks and one call, with the switch both off and on. Precision limits, now pinned by tests: at x1.05
the stored XP of 1 s steps and one call first differs at level 272 and the level first splits at level 301 (they agree
to the byte through 271); with whole XP an exact landing holds through 329; the last safe-integer cost is level 356 and
the first `Number.MAX_VALUE` cost is level 9,061. Perf: the perf suite is unchanged by this slice (no new perf figure is
claimed for it).

### CP-19: Candidate board expansion (Task 32) [home blocked on OC-17]

**Files:** depends on OC-17; default proposal: give Personnel Rosters an upgrade track on the facility framework
(`FACILITIES.personnelRosters`, pre-granted level 1, each rung +2 board slots up to 20, credits + time), seeded in
`MIGRATIONS[68]` if v69 has not reached staging, else a v70 step (the telescope precedent, `save.ts` 2526 to 2529).
Reads stay `seniorStaffRosterSize` (both boards). Decide in the same call whether the Recruiter secondary talent
(`model.ts` 12089) adds board slots for that captain's ship or is retargeted.
**Determinism:** a larger board appends slots; existing slots' candidates are unchanged (slot-keyed seeds). **Tests:**
board grows by 2 per level; slot 0..9 candidates identical before and after. **UI:** a facility card like the
telescope (SQ-7.4 pattern); no new mockup if it reuses that card.

**Built (2026-11-09, per USER ANSWERS 2026-11-02 CP-19 / OC-17 + OC-C4):** `model.ts PERSONNEL_ROSTERS_LEVELS` drives
`FACILITIES.personnelRosters` (new effect member `{ addCandidateSlots }`): Level 1 pre-granted (0 slots on top of the
stored base 10), then Levels 2 to 6 at 3,000 / 6,000 / 9,000 / 12,000 / 15,000 credits, +2 slots each (20 at Level 6,
the track's top rung like every facility track). Durations 120 / 240 / 420 / 720 / 1,200 ticks are the telescope's
first five cycles, [PROVISIONAL] (the answer says "time" with no number). Credits + time only, no FA gate. Reads:
`candidateBoardSize` (captainExplorerEffects.ts, the one reader both boards use) = (stored `seniorStaffRosterSize` +
`personnelRostersBoardSlots` + the best Recruiter's flat +1 (fix round, USER ANSWERS 2026-11-09 below; was x the best
Recruiter, rounded up); derived on read, so nothing is mirrored into the stored field. Save: no bump (still v71). `save.ts withPersonnelRostersTrackV71` (idempotent `?? { level: 1 }`) rides
`MIGRATIONS[70]` because v71 has not reached staging, and `migrate` also runs it on every load (the withHomeworldV70
posture) for dev saves already at v71. UI: Personnel Rosters gains an Upgrades tab with the telescope card (board now
and next, cost, time, ladder; the Recruiter's share named). Help: the Personnel Rosters topic's CANDIDATE BOARDS
paragraph. Goldens: `cp19Goldens.*`, switch `cp19Switch.fixture.ts`, read-back `cp19Registry.fixture.ts`. The
`board:level6` and `upgrade:*` golden rows were ADDED AFTER the capture on feat 3a7c544; their pre-slice pins were
taken through the switch (`withoutCp19`, which reproduces every captured row), the cp18 `mission:realRate` precedent.
Registry: 12 live rows `facility:FACILITIES:personnelRosters:<0..5>` (officerBoard) and `...:<i>:recruits`
(recruitBoard): 10 EFFECT rows (Levels 2 to 6, +2 slots each, linearAbsolute) and 2 BASE-VALUE PINS (Level 1 equals
the stored base of 10; the Debug panel leaves the pins unmeasured, since a Recruiter's +1 sits on top on a real save).
QA: `docs/qa/2026-11-09-cp19-rosters-track-qa.html`.
**Recruiter finding:** the answer called the talent "currently dead", but WR-5c (2026-10-17, "Best one counts"
2026-10-19) had already wired it: x1.08 on the whole board, rounded up. With the track that was +1 at Levels 1 and 2
(11, 13) and +2 from Level 3 (16, 18, 20, 22), where the answer says "+1 slot". Settled by the user below.

**USER ANSWERS (2026-11-09): CP-19 calls**
- Recruiter: "Flat +1 always (Recommended)". The Recruiter always adds exactly one candidate slot to each board,
  matching the 2026-11-02 answer.
- Times: "Use those times (Recommended)". 120/240/420/720/1200 s, still [PROVISIONAL] for the 0.16.0 balance pass.

**Fix round (2026-11-09, per the answers above):** the Recruiter (commandCrew4) is now catalog
`{ type: "flatAdd", stat: "candidateBoardSlots", amount: 1 }` (new effect member), and `candidateBoardSize` = stored
size + track slots + the best Recruiter's amount (best one counts, fleet-wide, as WR-5c wired it). The talent has no
ranks (owned or not, cost 1), so "+1 slot on the D23 curve" reduces to the flat +1; no curve was invented. Boards with
a Recruiter: 11, 13, 15, 17, 19, 21 at Levels 1 to 6. Talent text, Help line, card ("Includes +1"), registry rows
(linearAbsolute, exact, no tolerance) updated. Golden move: `board:level6`'s Recruiter half 22 to 21 (traced by the
read-back test in `cp19Goldens.test.ts`: the old pins are a 22-slot board, the new pins its first 21 slots). WR-5c's
`commandCrew4: { boards: "11/11" }` held (10 + 1 = 10 x 1.08 rounded up). Also: the card's gain line names the
rung's own +2; Help says existing candidates keep their places; `withPersonnelRostersTrackV71` reseeds Level 1 over
a malformed entry (not an object, null, or a level below 1).

### CP-20: Graph color option (Task 33)

**Files:** new `src/lib/graphPalettePreference.ts` (localStorage via `safeStorage`, one key per graph, starting with
the complement graph), Settings row, `ComplementPanel.svelte` reads it.
**Behavior [PROPOSAL, OC-24]:** presets: Default (gray cap, red / yellow / green), Colorblind-safe (Okabe-Ito ramp),
Monochrome. Per-viewer convenience only, never in the save. **Tests:** preference round trip and fallback when storage
throws. **UI:** a Settings select; no mockup needed.

**CARRY NOTE (CP-20 built 2026-11-09, user pick OC-24 "Default, Colorblind, Mono"):** `src/lib/graphPalettePreference.ts`
holds the presets, one localStorage key per graph (`fleet_admiral_graph_palette_complement`), a store so an open
Complement tab repaints live, and `setGraphPalette` for Settings (Settings, UI, Accessibility, "Complement graph
colors", under Color-blind palette). Default is the pre-CP-20 strings byte for byte (test-pinned). Color-blind safe:
Okabe-Ito #d55e00 / #e69f00 / #009e73 at 0 / 50 / 100%, RGB-blended between, on the Default gray cap. Monochrome: fill
#8c9198 to #f2f4f7 by fill, cap hatched #5a5f66 / #24272c. The game has only dark surfaces; every Color-blind safe and
Monochrome fill clears 3:1 on them (test-pinned). The emptiest fill sits near 2:1 against the cap behind it in all three
presets (as Default does today); bar height and the tooltip carry it. Help: no Complement topic exists yet, so the
graph key ends with "Graph colors: Settings, UI, Accessibility"; Task 34's Complement topic should say the same. QA:
`docs/qa/2026-11-09-cp20-graph-colors-qa.html`. No engine, save or wiring change.

**Fix round (2026-11-09, the user's CP-20 calls plus the review's fixes; display only, no engine, save or wiring
change; answers recorded verbatim under USER ANSWERS (2026-11-09): CP-20 calls):** supersedes the carry note's label,
blend and toggle independence. The Settings row is now **"Graph colors"** (the select's `aria-label` stays "Complement
graph colors"). Color-blind safe is FIXED STEPS, never a blend: `colorblindStep` puts a fill (current / cap, clamped to
[0, 1]) below 1/3 on #d55e00 (orange), from 1/3 up to and including 2/3 on #e69f00 (amber), and above 2/3 on #009e73
(bluish green); exactly 1/3 and exactly 2/3 are amber (integer ratios such as 2 of 6 and 4 of 6 compare equal to the
boundaries, test-pinned). The key swatch shows the same three hard bands. Default follows the global "Color-blind
palette" toggle: `accessibilityPreference.ts` now publishes the applied palette as `colorBlindPaletteStore`, set by
`applyAccessibility` (the one writer, on load and on every toggle); the pure `resolveGraphPalette(chosen, colorBlind)`
gives Monochrome if chosen, else Color-blind safe if chosen or the toggle is on, else Default; and
`effectiveGraphPaletteStore` derives it from both stores, so an open Complement tab repaints when either changes.
`ComplementPanel.svelte` reads the resolved store (source-scan test). The Settings select still shows the CHOSEN preset.
Both Settings descriptions now say the toggle switches the graph's Default; the graph row says "gray shades" for the
continuous Monochrome ramp. Default with the toggle off is still the pre-CP-20 strings byte for byte (test-pinned).

### CP-21: Close-out

Help lines for every new player-facing rule (Task 34 owns the topics), carry notes in the E-CREW plan for every slice,
the RELEASE_GATE run of `no-dead-stats.test.ts`, the curated desktop + mobile QA sheet from section 6, holistic review.

## 4. OPEN CALLS for the user

1. **Deck Handling's consumer.** Design 6.2 says "carrier drone handling"; D12 says the Complement never feeds
   weapons or shields. [PROPOSAL] faster drone replenishment between waves (no damage). Alt: drone HP; or treat drones
   as outside D12 and lift drone damage.
2. **Spacer long-haul ramp scope.** [PROPOSAL] ramp the complement's share of run-frozen crew values at the existing
   Constitution sample points. Alt: expeditions only; or a flat endurance bonus with no ramp.
3. **Crew Effectiveness size.** [PROPOSAL] multiply every other complement buff by 1 + diminishing(e, knee 0.2).
   Alt: a flat +e; or include officers.
4. **Survey Aptitude.** [PROPOSAL] scan speed (design 6.2). Alt: a sensors lift (G6 "Science crew amplify sensors",
   which also speeds scans through sensors); or both at half weight.
5. **Per-hull caps.** [PROPOSAL] Eir 900 (Medical / Science lean), Aurora 750 (Science lean), Orion 750, Carrier
   Flight Deck lean, Battleship Security / Engineering lean, nothing shrinks. Alt: lower Aurora to 600 for a clearer
   spread (needs OC-6 over-cap handling); or raise explorers toward the "thousands" band now.
6. **Over-cap complements** (caps change, a quarters module comes off). [PROPOSAL] never evict, just stop filling.
   Alt: return the excess to the pool, lowest rank first.
7. **Transfer and auto-crew.** [PROPOSAL] transfer needs both ships in manual mode, and the picker offers the switch.
   Alt: allow it anywhere (an auto ship refills from the pool on the next tick).
8. **Notable cap.** No cap exists today. [PROPOSAL] 50 notables fleet-wide. Alt: a per-ship cap; or no cap.
9. **Graduation details.** [PROPOSAL] the name is seeded from the bucket and the notable id, and "send back to the pool"
   means unassign (still a named notable). Alt: send back dissolves the notable into its bucket.
10. **Where the crew pool lives.** The pool is invisible today. [PROPOSAL] a Crew pool section in the Personnel Rosters
    facility. Alt: a tab in the ship's Complement view.
11. **Auto-crew while a ship is out.** [PROPOSAL] pause auto-fill on a locked ship ("LOCK when a mission starts"). Alt:
    keep filling (today's behavior; the lock covers only player actions).
12. **Scrapping a crewed hull.** [PROPOSAL] members go to a benched list named "Unassigned" (on the recruitment board),
    officers and notables unassigned, the complement returns to the pool. ("Reserve" now means aboard but unslotted.)
    Alt: refuse to scrap a hull until its people are moved.
13. **G5 hull bonuses** (SMS open calls 1 and 2). [PROPOSAL] one catalog, bonus by the hull it is installed on; the
    eight SMS-1 lines at +5% to +10%. The General guest-quarters perk does nothing until Short-Range Missions (G1).
    Alt: per-family module variants; or swap the General perk for an unload line now.
14. **Bridge set size** (S4-CP24, open since 2026-09-23). [PROPOSAL] keep the 3 built variants. Alt: grow toward a
    seat-focused set.
15. **Blueprint tiers** (SMS open call 4). The Research Lab tops out at tier 2. [PROPOSAL] the SMS table with Flag
    Command and Elite Quarters at tier 2 for now. Alt: add a Lab tier 3 rung now and gate them there.
16. **Base sensors** (SMS 3). [PROPOSAL] Aurora 35, Orion 25, Eir 15, warships 10, others 0. Alt: explorers only.
17. **Board expansion home.** [PROPOSAL] an upgrade track on Personnel Rosters (+2 per level to 20, both boards).
    Alt: a Recruiter's Office facility (your July 2026 idea, not yet scheduled); or the existing Recruiter captain
    talent only.
18. **Frontier gating** (SMS 5). [PROPOSAL] move it into the G2 Expedition Tiers plan, which owns region unlocks and
    the reach gate, with a sensor threshold per region tier. Alt: sensors gate only how much a scan reveals.
    **ANSWERED** (via the G2 plan's open call 7 / G7, 2026-10-16): "Sensor gate per tier (Recommended)"; built in G2
    (`propulsion.ts FRONTIER_SENSORS`), and CP-14's fix round retired the dead Tier II gate.
19. **Patrol cloak detection** (SMS 6). [PROPOSAL] sensors set the existing detector chance at rating / (rating + 60),
    and patrols gain a rare cloaked-raider opening. Alt: detection only, no new opener (it would then do nothing).
    **DEFERRED** to 0.14.x (T3) with CP-15 (session resume notes 2026-10-26); still unanswered, ask with that release.
20. **Science amplification numbers** (SMS 8). [PROPOSAL] crew 8% x ln(1 + heads / 25); Science seat +12% by rank.
21. **Sensor lift stacking** (SMS 9). [PROPOSAL] each lift multiplies (today's pattern). Alt: lifts add first.
22. **Hall of Command.** [PROPOSAL] game-time stamp shown as an in-game day, a missions counter that starts now, no
    entries for past retirements. Alt: stamp the real date from the device clock at retire time.
23. **Soft cap.** [PROPOSAL] threshold level 30, x1.08 per level past it. Alt: start at the retirement gate (25).
24. **Graph colors.** [PROPOSAL] three presets per graph. Alt: free color pickers.
25. **Slot name** (SMS 10). You call it the Sensor Suite; the game says "Sensor Array". [PROPOSAL] rename the slot to
    Sensor Suite and keep the arrays as its variants.

Not owned here but still open: the Pilot's own Cunning (`CUNNING_PENDING_SEATS`), Reactor Overdrive / Power Discipline /
Martian (E-MOD).

## 5. Conflicts with earlier decisions or plan text

- Task 27's "Reserve" list vs GO / SQ's "reserve" (aboard, unslotted): the benched list needs another name (OC-12).
- Task 24 relies on a "load-time clamp path" that does not exist (OC-6).
- CMR-8 says notables are capped; no cap exists (OC-8).
- Design 6.2 "carrier drone handling" vs D12 and the Task 21 carry "the Complement never feeds battle" (OC-1).
- Task 28's sensor tile, bay group and stamping are already done; Task 30's linked loadout is done (GO-17, not Task 18).
- SMS-2 "Lab tier 3" rows vs the Research Lab's level-2 ceiling (OC-15).
- SMS open call 7 (cloaked ghost) is already built by GO-8.
- Task 32's "docksExpansion pattern" vs the newer facility pattern (telescope), and the dormant Recruiter talent that
  promises the same thing (OC-17).
- Found while reconciling, not in any plan: salvage and retirement ignore expeditions (CP-6 verifies and fixes);
  scrapping a hull destroys its complement (OC-12); the 45 captain secondary talents are mostly unread (only
  Efficient Stowage is, `groundOps.ts` 178), and `no-dead-stats` does not cover them. That last one needs an owner;
  it is outside this plan.

## 6. QA list (delta; desktop and 375 px)

1. New crew never show "Craft Duplicate"; an old bucket with it reads "Held for homeworld staffing".
2. A ship with Damage Control / Mission Turnaround / Crew Output crew repairs, unloads and delivers faster or more; a
   ship without them is unchanged.
3. A new Ground Ops run with Security / Medical / Science complement buffs: squad HP, cures, med bay time, scan speed
   move; a run launched before the update resolves as before.
4. The Eir out-crews the Orion; uninstalling quarters never removes crew; an over-cap column says so.
5. Every crew control on a ship that is out (mission, patrol, expedition, unclaimed) is disabled with the reason; it
   works after return or claim. Retiring or scrapping a ship on an expedition is refused.
6. Scrapping a crewed hull: members appear in the benched list, officers and notables are unassigned, crew return to
   the pool; nothing points at the removed ship (save, reload).
7. Transfer 12 crew pool -> manual ship; partial fill message when caps bind.
8. Graduate one: the group drops by one, the named notable appears; the manifest opens fast and names stay stable.
9. A fresh save researches and crafts a Wide-Beam Array, Balanced Command and Utilitarian Quarters, and installs all
   three from the Ships tab; the Archive shows the new rows.
10. Hull bonus lines appear on the tile and in the stat breakdown; moving a module to another hull changes its line.
11. Explorers show base sensors; foreknowledge and the telescope lift react.
12. The 5th retirement shows the final warning; the Hall of Command lists it once.
13. Roster dropdown applies from the ship screen and warns about an unsaved configuration.
14. Captain levels past 30 cost more XP; nothing below changes.
15. The board upgrade adds 2 candidates per level on both boards; existing candidates stay.
16. The complement graph palette changes from Settings and survives a reload (or falls back quietly in a private window).

## 7. Scope risk (standing rule: push back on scope)

This is 22 slices on top of a release that already carries Ground Ops, Squads, affixes, Field Kits, and still has G1,
G2, Relics v2, the gas giant study, Material Lines and E-MOD ahead. G6 alone is two engine changes to combat and
exploration (CP-14, CP-15) plus a G2 dependency. The plan keeps a clean foundation now, but the user should know where
the weight is and what could move to a 0.14.x follow-up without leaving a dead stat on screen:
- **Smallest honest cut [PROPOSAL]:** keep CP-0 to CP-12, CP-16 to CP-18 (the dead stats, the lock, the acquisition
  path, the small locked fixes). Move CP-15 (patrol cloak), the Spacer ramp half of CP-4, CP-19 and CP-20 to 0.14.x
  only if the user agrees; each has a no-dead-stats or inventory row to carry it.
- **Do not cut** CP-6: scrapping a crewed hull loses people today, and the expedition-salvage gap may be a live bug.
- CP-3 must wait for the Field Kits engine slices; running them together risks golden churn in shared files.

## VERIFIED 2026-10-14: captain secondary talents mostly inert (branch only; main has no secondary tree)

The secondary talent catalog has 45 nodes (model.ts ~11773-12101): 26 stat bonuses, 4 chance bonuses, 9 capstones,
6 "none" placeholders. Only `logistics4` (Efficient Stowage) is read by game code (groundOps.ts ~154, ~178). 38 nodes
show a specific effect ("+8.0% ...", "5% chance-based bonus") that never applies; the 6 placeholders honestly say "No
bonus yet (system pending)". Not covered by no-dead-stats. Needs an owner before 0.14.0 ships: wire them, or label
them honestly, or hide the tree. Raised with the user.

Also verified: the salvage data-loss findings (CP-6) are branch-only (main SAVE 54 has no expeditions or crew);
the CP-6 core fix was dispatched the same day.

## USER ANSWERS (2026-10-16)

- **OC-5 per-hull caps:** "REmember, the Andromeda has 1017. That's the largest." The 1,017-crew flagship (D15, a
  later hull tier, not 0.14.0) is named the ANDROMEDA (user-named) and is the largest crew in the fleet. So Eir's
  description ("the largest crew the fleet fields") is wrong, and every 0.14.0 hull cap stays below 1,017. Exact
  explorer caps re-asked 2026-10-16.
- **OC-23 soft captain cap:** "From level 30 (Recommended)": past level 30 each level needs x1.08 more experience.
- **OC-5 explorer caps (follow-up):** "Eir 900, Orion/Aurora 750 (Recommended)"; Eir's text becomes "the largest
  explorer crew"; the Andromeda (1,017, later hull tier) stays the largest in the fleet.
- **OC-8 notable cap:** "50 fleet-wide (Recommended)".
- **OC-1 Deck Handling:** "Faster drone replenish (Recommended)".
- **OC-3 Crew Effectiveness:** "Boosts other buffs (Recommended)": multiplies every other complement buff on the ship
  by a diminishing curve.
- **OC-4 Survey Aptitude:** "Faster scans (Recommended)".
- **OC-6 over cap:** "Never evict (Recommended)".
- **OC-11 auto-crew while out:** "Pause while out (Recommended)". **OC-7 transfers:** "Manual ships only
  (Recommended)". **OC-10 crew pool:** "In Personnel Rosters (Recommended)".
- **Notables (2026-10-16, verbatim):** "Let's keep it identity only. A scrolling marquee of notable personnel sounds
  nice. Plus, who knows, perhaps we might find someone in there that we might want to eventually promote to senior
  staff. I was considering that as an option as well. They'd have to leave the ship and return to the homeworld to go
  through academy coursework, but then they'd become a proper commissioned officer and could be chosen for a senior
  staff role. Whether that is necessary or not I am not sure. So this goes in the suggestion box haha. But the
  identity only part is perfectly fine." So: notables are identity only (no stat edge). A scrolling MARQUEE of notable
  personnel is wanted (UI; placement [PROPOSAL]). Academy promotion to senior staff goes to SUGGESTIONS.
- **OC-9 send back:** "Stays named (Recommended)".
- **Notable marquee placement:** "Personnel bucket header (Recommended)": a slow, quiet ticker at the top of Personnel.
- **OC-15 Lab tiers:** "Add tiers 3-7 now (Recommended)": the Research Lab gains levels 3 to 7 in 0.14.0 (drive
  classes II to VII, top modules). Shared with G2 (propulsion).
- **OC-16 base sensors:** "Explorers lead (Recommended)": Aurora 35, Orion 25, Eir 15, warships 10, others 0.
- **OC-13 hull bonuses:** "One catalog, by hull (Recommended)": eight lines at +5% to +10%.
- **OC-25 sensor slot name:** "Slot = Sensor Suite (Recommended)"; arrays stay its variants.
- **OC-22 Hall of Command (verbatim):** "I like 1. But perhaps we can add in some notables for that captain. Perhaps
  specific achievements that captain achieved and when. Etc. Since Achievements should be coming pretty soon, that'll
  link up properly with everything we're working on now anyway." So: in-game day stamps, a missions counter from now,
  no entries for past retirements, PLUS each captain's entry lists notable moments: specific achievements earned and
  when (links with the coming achievements system; build the per-captain record shape now so achievements plug in).
  **CP-16 notables (user 2026-11-06, multi-pick):** "Level milestones, Firsts under command, Promotions and titles".
  Level milestones every 10 levels; firsts (first expedition, first relic, first Tier II+ run, first refugee rescued)
  only where the engine can attribute them to that captain's ship; earned ranks or titles if the identity system grants
  them. Each notable carries its in-game day. Not picked: "Lifetime tallies only".
- **OC-20 Science sensor amplification:** "Proposed numbers (Recommended)". **OC-21 stacking:** "Multiply (Recommended)".
- **OC-14 bridge set:** "Keep the 3 built (Recommended)".

## OC-15 Lab and Fabricator tier rungs: carry note (built 2026-10-21, on top of 04a4cb2)

User 2026-10-21 (merge-batch answers, late calls): "Build them in 0.14.0 (Recommended)". For later slices:
- One table, `model.ts LAB_FABRICATOR_TIER_RUNGS` (tiers III to VII), drives BOTH tracks: the Research Lab gains rungs
  [2..6] (levels 3 to 7) and the Fabricator rungs [3..6] (levels 4 to 7); its existing tier III rung (FIX B, 20,000 /
  240 / FA 6) is now that table's first row, byte-identical. `LAB_FABRICATOR_TOP_TIER` = 7.
- **APPROVED** (user 2026-10-21, "Costs OK, +1 slot each (Recommended)") numbers, sized on the existing curve (credits x2.5 and FA +3 per rung, the Shipyard / telescope
  strides; durations on the telescope ladder): III 20,000 / 240 / FA 6, IV 50,000 / 420 / FA 9, V 125,000 / 720 / FA 12,
  VI 300,000 / 1,200 / FA 15, VII 750,000 / 1,800 / FA 18. Credits and FA only (the gates both Upgrades panels show).
- **APPROVED** (same answer): every rung grants one slot (research or craft), the pattern every rung of both tracks carried, so no
  rung is inert even before tier III+ blueprints land: a level VII Lab runs 7 projects, a level VII Fabricator 7 crafts.
  This lifts the Fabricator past FIX B's "three lines, like the Refinery" above level 3 (craftingProgress design 6.4
  now prices level 3 explicitly; the full track only widens fabricating's lead).
- Tier content rides the blueprint `tier` alone (Lab N researches, Fabricator N crafts tier N). Readers for everything
  else: `labTier(state)` / `fabricatorTier(state)` (model.ts). Owners: G2-4 propulsion (`drivesWithinFacilityReach`
  reads the two track lengths, so Class III to VII join BLUEPRINTS at merge with no code change; its
  `facility:audit:heldDriveClasses` row then flips and its blueprint / census pins move); R2-3 identification lanes
  (I 1, III 2, V 3, VII 4 off `labTier`); GG-7 special blueprints (tiers 3 to 5); CP-11 Flag Command and Elite Quarters
  (tier 3 now that the rung exists, not tier 2); EM-7 modules (Lab tiers 2 to 4).
- UI: the Research Lab Upgrades grant line names "unlocks Tier N blueprints" only when a tier N blueprint exists (the
  Fabricator's existing rule); Help (Research topic) names the level VII top and the slot per level.
- Goldens: `labFabricatorTiersGoldens.test.ts` (captured first): existing rungs, slots / researchable / fabricate
  reasons at levels 0 to 3, in-flight research and craft through a save, all unchanged; `top:*` moved on purpose (the
  next rung now builds), proven by `labFabricatorTiers.fixture.ts withPreOc15Tracks`. `wiringGoldens rungs` moved
  (re-pinned `RUNGS_OC15`, the old hash reproduced with the tracks cut back). Registry: nine added LIVE rung entries
  (researchSlots / fabricateSlots probes), held apart in every registry pin via `OC15_ADDED_ENTRY_IDS`.
- Merged feat/crew-0.14.0 (472672d: ML-2, SI gear, EM-2, timed grenades) in: the registry pins union OC15_SLICE with
  ML2_SLICE (shortRangeGoldens registryPin) and keep OC15_ADDED_ENTRY_IDS out of emodGoldens BEFORE_RX beside ml2RowsBack.

## USER ANSWERS (2026-10-30): CP-3 review calls

- Counter-Infiltration crew share curve: "Smooth curve to 90% (Recommended)": share = 0.9 x tanh(raw / 0.9).
- Combined resist: "Combined stays under 90% (Recommended)": a member's own resist and the crew share together bend
  toward the existing 0.9 per-status cap (smoothly, never a hard clamp, D23); members already near 0.9 gain little.
- Away-Team Protection rounding: "Round up (Recommended)": any holder gives a Security member at least +1 max HP;
  larger crews scale as before (ceil, not round).

## USER ANSWERS (2026-11-02): CP-19 and CP-20

- CP-19 / OC-17 + credit sinks OC-C4: "Personnel Rosters track (Recommended)": an upgrade track on the existing
  Personnel Rosters card, 5 rungs, +2 candidate slots each (10 -> 20, both boards), 3,000 x rung credits + time; the
  Recruiter captain talent (candidateRosterSize, currently dead) is wired to +1 slot on the D23 curve. No new facility.
- CP-20 / OC-24: "Default, Colorblind, Mono (Recommended)": three presets for the complement graph: Default (gray cap,
  red/yellow/green), Colorblind-safe (Okabe-Ito vermillion/orange/bluish green), Monochrome (gray ramp). Per-device
  preference (localStorage, one key per graph), never in the save.

## USER ANSWERS (2026-11-02): CP-9 and CP-10 mockups APPROVED

Mockups: docs/mockups/2026-11-02-cp9-complement-manifest-mockup.html and
docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html. User: "The 2 mockups look fantastic." A nitpick pass may
change any of these later ("Depends on how my eyes perceive the final product").
CP-9: (1) sort and filter: A chips ("we can pivot to B if I like that better"); (2) buffs: A one chip per buff;
(3) Graduate: A a button per row; (4) phone filters: A two sideways-scrolling chip rows; (5) phone selection bar: A
sticky at the bottom; (6) send back: A on each notable card (added to CP-9's scope); (7) manifest: A one paged list;
(8) graduate from the manifest: A read-only manifest.
CP-10: (1) destination: A ship cards with room and reasons; (2) over-asking: A allow it, warn per row, the button shows
what will move; (3) per-row amount: A minus, count, plus, ALL; (4) result: A row by row in the modal; (5) phone picker:
A two steps; (6) crew pool: A its own tab in Personnel Rosters; (7) take from pool: A only from the pool view; (8) lock
display: A a line per panel and a lock on each sub-tab; (9) benched list home: A every ship's Away Team tab (built);
(10) benched list name: "Unassigned".

## USER ANSWERS (2026-11-02): CP-5 review calls

- Division mixes: "No division ever shrinks (Recommended)": every division on every hull keeps at least today's seats;
  a hull's lean comes only from where the extra seats go. No existing ship turns "Over cap" from the new caps.
- Eir description: "Approve as written": "Heavy cruiser. A medical transport with the largest explorer crew: the
  largest hold and away teams the fleet fields, for supplies and evacuations."
- Lean fill (2026-11-02): "Fill the lean division first (Recommended)": where a hull's divisions add up to more than
  its total berths (Carrier, likely Battleship), auto-crew seats the hull's specialty division(s) first (Carrier:
  Flight Deck; Battleship: Security, Engineering; Aurora: Science; Eir per its lean) before the rest, so the lean is
  real in practice. Totals stay the OC-5 numbers. Existing crew are never moved or evicted.
- Eir lean order (2026-11-02): Medical, then Science [PROVISIONAL], matching its approved "medical transport" description; only matters once a quarters bonus raises a division.

## USER ANSWERS (2026-11-02): CP-9 build calls

- Notable cap (50) with nothing removing a notable: "Allow Retire (Recommended)": a notable can be retired with a
  farewell line, no penalty; it frees a notable slot. The player chooses when.
- Rank prefix on names: "No, keep names clean (Recommended)": rank stays its own chip.
- The notable marquee (2026-10-16 note): "Add a slow auto-scroll (Recommended)": the strip drifts gently on its own,
  pauses on hover or touch, and stays still with Reduce motion on.

## USER ANSWERS (2026-11-03): CP-11 build calls

- Guest Wing tier: "Tier 1 (Recommended)".
- The three quarters pairs with identical recipes (approved table): "Tell them apart (Recommended)": swap one
  ingredient in one blueprint of each pair so every blueprint has its own recipe, realistic, marked [PROPOSAL] for the
  user's sign-off. (The no-shared-recipe rule is a test convention from the material lines design, not a user rule;
  the user chose distinct recipes anyway.)
- Sensor array recipes (audit 4.8, previously [PROPOSAL]): "Approve as proposed".
- Flag Command (tier 3 bridge): "No, keep it as built (Recommended)": no Iridium Catalyst (M7: top tier only), no
  canister.
- Logged (review): a save mid data-study can learn a different blueprint after CP-11 adds candidates (same precedent as
  every earlier blueprint slice; draws and save bytes unchanged). CP-12 must flip the bridge+quarters:obtainable row.

## USER ANSWERS (2026-11-04): CP-12 calls

- Research list: "Add it to Research too (Recommended)": a Crew Modules section in Research (as the signed CMR-9 mockup
  draws), plus the Fabricator group for crafting.
- Naming: "\"Crew Quarters\" everywhere (Recommended)": display text only, no save change.
- Hub (standing distinct-icon rule): every array variety and the Bio-Resonance Array get their OWN SVG glyph; no item
  shares a relic's glyph unless a mockup signed it (the Precursor Lens precedent).

## USER ANSWERS (2026-11-04): CP-13 calls

- General guest perk: "Yes, grow like the rest (Recommended)": scales with rarity/quality like the other seven lines
  (matches the SMS-1 mockup's "the hull bonus scales the same way").
- Stat breakdown: "Add the rows (Recommended)": Sensors and Unload speed get breakdown rows showing every source.
- Tactician injury perk: "Yes, both paths, new runs only (Recommended)": the non-Ground-Ops injury path too, stamped at
  dispatch so runs in flight don't change.

## USER ANSWERS (2026-11-04): CP-14 calls

- Other crew boosts scaling the Science lifts: "Keep them separate (Recommended)". The Science crew and officer lifts
  stand alone; Quarters lifts, Crew Effectiveness and museum crew bonuses do not scale them.
- Bare explorers clearing Tier II to IV sensor gates: "Yes, intended (Recommended)". Drive class stays the tier pacer.
- After the review showed a full Aurora with no Sensor Suite reaches about 59 (Tier VI, VII with Keen Sensors or
  museum) and Tier II's gate can never fail: "Retire the dead gates (Recommended)". Drop the sensor gates that can no
  longer bind, so no inert values; higher-tier gates stay as they are.
- Builder flag on the pre-SF-2 ground-team stall: reviewer confirmed it is unreachable (prod/staging have no
  expeditions; it is a latent pre-SF-2 path issue, not CP-14). No guard (hub call).
- Plan wording: in-flight surveys keep their dispatch stamp rather than picking up new sensors "from their next
  cycle"; note this so patch notes say it truthfully.

## USER ANSWERS (2026-11-06): CP-16 calls

- Hall placement: "Top of the Archive (Recommended)", as built.
- Missions flown includes short-range: "Count short-range too (Recommended)".
- Firsts are dated at dispatch: "Date at launch (Recommended)". A recalled run still counts.
- Successor: "Fresh record (Recommended)". The successor starts at zero missions with no notables.
- Lost patrol routes: "Count it too (Recommended)". They flew it; the count is a record of service, not of wins.
- Captain titles: "Log for later (Recommended)". Logged in SUGGESTIONS.md beside the CAPTAIN IDENTITY and personnel
  achievements entries: earned captain titles (candidates: the chosen specialization, prestige capstones), to plug into
  the Hall's "Promotions and titles" notable kind when built. Nothing is recorded today.

## USER ANSWERS (2026-11-09): CP-17 calls

- Warning: "Only when something is lost (Recommended)". No warning on a no-op apply, so "will lose it" is always true.
- Tabs: "Senior Staff + Complement only (Recommended)".
- Gear-only rosters: "Keep matching the facility (Recommended)".
- Hull-mismatched loadout: "Say so in both (Recommended)". A short truthful line in both the ship bar and the facility,
  with no silent outcomes.
- Pulled crew: "Warn and log it (Recommended)". Before Apply, name who will be pulled from which ship and let the player
  cancel; the log line says so too. In both the ship dropdown and the facility.

## USER ANSWERS (2026-11-09): CP-20 calls

- Label: "\"Graph colors\" (Recommended)".
- Color-blind preset shape: "Fixed steps (Recommended)". Hold the exact Okabe-Ito colors in steps (orange below a
  third, amber to two thirds, bluish green above) so every bar is one of three distinct safe colors.
- Global toggle: "Follow the toggle (Recommended)". When the global "Color-blind palette" setting is on, the graph's
  Default switches to the color-blind safe colors automatically. Picking Monochrome still overrides it.
- Naming: "Keep both names (Recommended)".

## USER ANSWER (2026-11-11): CP-4 Flight Deck Integrity scope

Review found the built facet multiplies the WHOLE `crew.droneHandling` pool (Belter racials from officers in other
seats, Belter crew in other departments, a Belter captain), while every other Integrity row boosts only that
department's own bonuses. User: "Flight Deck's own only (Recommended)": match the other Integrity bonuses; the facet
boosts only the Flight Deck's own drone handling.

### CP-4 rest BUILT and merged (2026-11-11): the Flight Deck Integrity facet on replenish

- Built 902bee9d / 5ff93e76; review clean. Fix round 4900ea48 (user 2026-11-11 "Flight Deck's own only"): the Flight
  Deck's Integrity now lifts only the Flight Deck's own Deck Handling (its crew and the Pilot). Belter officers in other
  seats (the XO included), Belter crew in other departments and a Belter captain still add Deck Handling but take no
  facet. `PatrolMissionState.deckHandlingSteady` freezes the lift (facet x own share; crewOverlay.ts
  `shipFlightDeckIntegrityDeckHandling`); below half hull, squadrons bank at Deck Handling + lift. The live loop and the
  replay share droneDefense.ts `recoverPatrolDrones`; the registry probe drives it at the real hull pool.
- Re-merge onto feat (f19d06dc, cb0cbf06): WR-8b torpedoes alone moved the CP-4 pins (bisected: WR-13 and OC-G1 change no
  hash; torpedoes off reproduces every capture). The Corsair Carrier torpedo sinks the held Balanced ramp 0.2 carrier in
  its first relaunched cycle, so the trigger is never reached, matching the Warband shift the user kept on 2026-11-10.
  Both cp4 files run with torpedoes off; a new torpedoes-on test (Defensive, ramp 0.1) proves the facet still lifts only
  the Flight Deck's own share with torpedoes live.
- [PROVISIONAL] the facet is linear like every other Integrity row; balancing in 0.16.0. QA:
  docs/qa/2026-11-10-cp4-flight-deck-qa.html.

## CP-21 close-out (2026-11-11)

A read-only close-out review found five items; this pass built them (on feat 8bf79c6b). Four other findings wait on
the user and were NOT built (listed below).

- **Crew pool perf guard** (`crewOverlay.ts resolveCrew`, a pure optimization). Once every passive berth is full each
  transport stays in the pool, and every 1 s tick copied the pool and re-scanned it rank by rank for every passive ship;
  an offline catch-up runs one economyTick per second. Now: no window due uses the pool as it is (the SAME state comes
  back when nobody moved); a ship whose bulk plus notables reach its total berths is skipped before the pool is copied;
  a ship that took nobody from the same pool under the same caps, notables, quarters bonus and lean is remembered
  (`NO_FILL_MEMO`, a WeakMap per complement object, never saved: after a load the first tick fills in full). Goldens
  first: `crewPoolGuardGoldens.test.ts` (seven whole-state pins, one call == 997 s chunks == 1 s steps, captured on
  8bf79c6b, none moved). `crewPoolGuard.test.ts`: every skip equals a fresh fill on a structured clone, including across
  the CP-5 caps switch. Perf: new `crewPool.perf.test.ts` (in `npm run test:perf`): a 35-day pool (20,120 crew) over an
  eight-ship full fleet, 6-hour catch-up: 11,861 us per step before, 18.8 us after; budget 0.25 ms per step.
- **Help** (E-CREW Task 34): new topics `complement`, `officerStats`, `recruitment`, `awayMembers`, `implants`, every
  number from the engine, pinned in `helpTopicsCrew.test.ts`. The notable ticker's placement is not described.
- **QA**: `docs/qa/2026-11-11-complement-qa.html`, the full desktop (1280) + mobile (375) sheet from section 6 plus the
  close-out.
- **Docs**: E-CREW carry notes for Tasks 23 to 29, 32, 33, 34 and G5 / G6; CP-15 marked deferred; OC-18 answered (G2),
  OC-19 deferred.
- **Glyphs**: Personnel Rosters' text stars, triangles and arrow are SVG (`star` filled when favorited, `chevronUp` /
  `chevronDown`, `arrowDown`); the hull tooltip's satellite emoji is the `ship` glyph. No new glyph.

**OPEN user calls (re-present, most important first):**
1. Bounding `crewPool`: with every berth full the pool grows by a transport every 30 minutes forever (the perf guard
   keeps it cheap, but it is unbounded). Send the surplus somewhere, cap it, or leave it.
2. Where the notable crew ticker sits (the marquee is built; its placement is the user's call).
3. Deck Handling's in-combat scope: the in-combat replenish module banks Deck Handling too (CP-4 carry note); keep, or
   between waves only.
4. An "assign to ship" button for an unassigned notable (today only applying a Personnel roster seats one).
5. CP-11 distinct recipes sign-off (Engineering, Science and Guest Wing quarters, marked [PROPOSAL]).
6. The [PROVISIONAL] numbers for the 0.16.0 balance pass: `CREW_EFFECTIVENESS_KNEE` 0.2, the CP-5 division weights and
   the Eir lean order, the Integrity facet (1% per point, 40% XO), `CREW_MODULE_BLUEPRINT_COSTS`, the Personnel Rosters
   track durations (120 / 240 / 420 / 720 / 1,200 s), `CAPTAIN_SOFT_CAP_GROWTH` 1.08, the transport size and window
   (12 crew per 1,800 s).

Closed since: CP-6 note 2 (hull swap while the ship is on an expedition) by S1 "Lock it" (0a077ca5, captainMoveLock); CP-15 and
the Spacer long-haul ramp are 0.14.x (T3).

## USER ANSWERS (2026-11-12) on the CP-21 close-out calls

- Notable ticker: "Build the header ticker (Recommended)": build what the user asked for on 2026-10-16, one fleet-wide
  ticker at the top of Personnel, unassigned notables included. MOCKUP FIRST for approval.
- crewPool surplus: the hub first offered "Homeworld staffing"; the hub then corrected itself (homeworld staffing is the
  user's FUTURE idea, SUGGESTIONS.md "CRAFT-DUPLICATE CREW BUFF": homeworld facility buffs, "defending against invasion";
  not built). Re-asked: "Homeworld reserve (Recommended)": surplus crew move to a "Homeworld reserve" list, the same crew
  groups, shown as a count in the Crew Pool tab, keeping ranks and racials, ready for homeworld staffing when it is
  designed. Ships still refill from the pool first.
- Deck Handling in combat: "Keep both (Recommended)": Deck Handling and the Flight Deck lift act both between waves and
  on the in-combat replenish pod; Help gets a clause.
- Assign-to-ship button for an unassigned notable: "Log it for later (Recommended)" (SUGGESTIONS.md).

## Homeworld reserve BUILT (2026-11-12, carry note)

Built from the 2026-11-12 answer "Homeworld reserve (Recommended)" (homeworld staffing itself is NOT built:
SUGGESTIONS.md "CRAFT-DUPLICATE CREW BUFF" stays the future design).

- **Surplus rule (no new constant)**: AFTER the normal fill of every tick (`crewOverlay.ts resolveCrew`; memoized per
  pool list, so an idle pool is never re-scanned), each pool group keeps as many crew as the fleet's berths could still
  seat of its division and rank (the SUM of every ship's own room: passive, passive crew-locked while out, and manual
  ships, whose open berths the player fills by hand), and the rest moves to `homeworldReserve` (`homeworldReserve.ts
  sweepSurplusToReserve`). Every seating the pool allowed is still possible after the sweep; with every berth full the
  whole leftover moves. Two departures from the brief, both deliberate: (1) manual ships count (the brief said "passive
  berth"): sweeping crew a manual ship could take would take them out of the player's hands; (2) the sweep follows
  every fill, not only a transport's: a big economyTick call that crosses a window and a ship's return swept at a
  different moment than 1 s steps (cp16HallOfCommand.test.ts's short-range relic run broke one call == 997 s chunks ==
  1 s steps), so crew landing in the pool any other way (salvage, send back) with no berth also move at the next tick.
- **Refill**: a passive ship fills from the pool first, then from the reserve with the same filler (`autoCrewShip`:
  lean divisions first, top rank down, the reserve's group order); a Personnel roster's bulk fill draws the same way.
  The reserve never flows back into the pool.
- **Save**: `homeworldReserve?: CrewBucket[]`, optional and never written empty (no SAVE_VERSION bump; a save that never
  had a surplus is byte-identical). An old save's pool is NOT moved at load: the engine moves its surplus at the first
  tick after, by the same rule, so a crewmember any berth could take never moves.
  `withHomeworldReserveOnLoad` (every load) drops only an empty or malformed field.
- **Perf guard**: the fast path needs the reserve empty, an empty pool skips a ship only with an empty reserve, and the
  memo key holds the reserve's reference and length (`NO_RESERVE` is one shared frozen list, so an absent reserve never
  misses the memo).
- **Order**: canonical (signature key order) whenever the sweep adds, the canonicalOrder.ts rule, since a big call sweeps
  a day's pool at once while 1 s steps sweep window by window.
- **Moved pins**: 136 pins in 23 golden files moved (whole-state hashes and pool hashes of fleets whose surplus the
  reserve now moves). Each file runs with `homeworldReserveOffForThisFile()` (`homeworldReserveSwitch.fixture.ts`, the
  orderingSwitch precedent) and every one of its pins reproduces with the switch off; no pin or tolerance was edited.
  Files: captainExplorer, complement, cp13, cp14, cp16, cp18, cp4FlightDeck, cp5, crewPoolGuard, emodEm4, favorsSpec,
  firstRuns, gasGiantNebulaLab, gatheringTrainingWear, gearWear, ordering2, ordering, patrolLegLifts, placeholderTalent,
  refugee, shortRange, shortRangeRelics and wiring Goldens. The perf file keeps its CP-21 case with the reserve off and
  adds a reserve-on case under the same 0.25 ms budget.
- **UI / Help**: the Crew Pool tab shows "Homeworld reserve: N" (a count only); the complement Help topic's Crew Pool
  paragraph has one sentence (pinned in `helpTopicsCrew.test.ts`).
- **Goldens**: `homeworldReserveGoldens.test.ts`, six scenarios (a deep pool across a window, a two-day catch-up, an
  emptied freighter, a quarters install, an open manual ship, a transfer back), each one call == 997 s chunks == 1 s
  steps, pinned with the switch OFF (the pre-reserve hashes captured on 08f2cac8, all reproduced) and ON.
  `homeworldReserve.test.ts`: the rule, the draw, the guard with a reserve, the roster draw, saves.
- Also answered 2026-11-12 and done in the same pass: the Combat Patrols Help says Deck Handling and the Flight Deck
  lift also speed a drone pod's In-Combat Replenish during a wave ("Keep both"); `DOCKED_OVERTIME_CARRIES_INTO_FIRST_PAUSE`
  is no longer an open call ("Yes, keep it"); the Class VI and VII drive fuel amounts are no longer [PROPOSAL]
  ("Deuterium + antimatter"). Open call 1 above (bounding `crewPool`) is closed by this note.

## USER ANSWERS (2026-11-12 afternoon): Homeworld reserve calls and the notable ticker mockup

Homeworld reserve (after the build):
- Manual controls: "Add controls (Recommended)": "Send to a ship" and "Recall to pool" on the reserve so the player can
  hand-pick again. MOCKUP FIRST.
- Sweep timing: "Every tick (Recommended)" (as built).
- Manual ships count as berths: "Keep it (Recommended)" (as built).
Notable ticker (docs/mockups/2026-11-12-personnel-notable-ticker-mockup.html):
- Motion: "A: drift (Recommended)": scrolls like the Complement strip, pauses on hover, focus or touch; static under
  Reduce motion.
- Placement: "Under the tab row (Recommended)".
- Per-ship Complement strip: "Keep it (Recommended)": keep both.
- Tap: "Open the record card (Recommended)".
- Empty state: "Show a short hint (Recommended)".
- Entry: "Name, rank, division, ship (Recommended)": ship or "Unassigned"; favorites first, then the rest.
- Record card: "Offer Send back + Retire (Recommended)".

## USER ANSWERS (2026-11-12 evening): Homeworld reserve controls mockup

docs/mockups/2026-11-12-homeworld-reserve-controls-mockup.html:
- Recall: "Only what a berth can seat (Recommended)": Recall moves only crew some berth can take, so nothing bounces back.
- Layout: "A: section under the pool (Recommended)": its own collapsible section under the pool table on the Crew Pool
  tab (starts closed); ticked rows show "Send N to a ship..." and "Recall N to the pool...".
- Auto-crew ships in the Send picker: "Show, not pickable (Recommended)": listed with a note that they fill themselves.
- Transfer warning: "Warn first (Recommended)": the confirm says how many pool crew will move to the reserve next tick.

## Homeworld reserve controls BUILT (2026-11-12, carry note)

Built from the 2026-11-12 evening answers above (mockup docs/mockups/2026-11-12-homeworld-reserve-controls-mockup.html).

- **Engine** (`crewTransfer.ts`): the reserve is a transfer SOURCE (`HOMEWORLD_RESERVE = "reserve"`), never a target
  (`intoReserve` refusal). To a ship: the same gates and caps as from the pool (manual only, crew-locked refused with the
  real reason). To the pool ("Only what a berth can seat"): each pick's room is the fleet's open berths for its division
  and rank less what of that group already waits in the pool; the rest stay (`noBerth`). A drained reserve is never
  written empty. Pure, RNG-free, never on the tick.
- **One reader**: `homeworldReserve.ts` now exports the sweep's own room reader (`shipsWithOpenBerths`,
  `openShipRoomFor`, `fleetRoomReader`); the sweep calls it with unchanged behavior (every golden pin reproduced, none
  moved, no switch needed), Recall reads it, and `poolSurplusNow` (the sweep's rule, uncached) gives the Send warning's
  count, so the warning equals what the next tick moves. No SAVE_VERSION bump, no new saved field.
- **UI** (option A): `CrewPoolPanel.svelte` has a Homeworld reserve section under the pool's table, closed at first,
  open or closed remembered per device (`homeworldReservePreference.ts`, not the save); the pool's count line links to it
  ("Listed below."). Ticked rows show "Send N to a ship..." and "Recall N to the pool..." (phone: sticky bar, "Send..." /
  "Recall..."); both open `CrewTransferModal.svelte` (Send on the first ship with room, Recall on the crew pool).
  Auto-crew ships are listed, not pickable, with "Auto-crew: fills from the pool, then this reserve, on its own every
  tick." and no switch ("Show, not pickable"). The amber warning line sits under the summary ("Warn first").
- **One call made in the build**: the mockup drew the warning for one pool group; with two or more groups affected the
  warning gives the total and the number of groups in one sentence.
- **The pool's own Send** (USER ANSWER 2026-11-12, verbatim pick: "Yes, same warning (Recommended)"): a Send from the
  pool to a manual ship gets the same warning, the same `poolSurplusNow` count (tested equal to what the next tick
  moves). Review fix round: the several-group words read "After this, N crew in G groups waiting in the crew pool have
  no berth left in the fleet, so they move to the reserve at the next tick." ("At the next tick, ..." when pool crew
  were already over their berths before the Send), and the no-room Recall summary adds "a manual ship that is out comes
  home" to when room opens (a manual ship out on a run is not pickable until home).
- **Tests**: `homeworldReserveControls.test.ts` (conservation, ranks and racials, recall never bounces, the warning's
  count equals the next tick's sweep, locked and auto-crew refusals, the CP-21 memo equals a fresh fill),
  `crewTransferReserveDisplay.test.ts` (the picker's words), `helpTopicsCrew.test.ts` (the Help line).
- **Help**: the complement topic's Crew Pool paragraph. **QA**: docs/qa/2026-11-12-reserve-controls-qa.html.

## Notable crew band BUILT (2026-11-12, carry note)

Built from the answers above and the signed mockup (option A). UI only: no engine or save change.
- **Where**: `NotableTicker.svelte`, under the Personnel (Crew) ConsoleTabs on every tab, outside `.tab-scroll-area`.
  The per-ship Complement strip is unchanged ("Keep it").
- **Entry and order** (`notableTickerDisplay.ts`, tested): name, rank, division, ship or "Unassigned", a star on
  favorites. Favorites first, then the rest; inside each part the graduation order, oldest first, read from the number
  in the notable id (`notable-<nextNotableId>`, never reused), so it never depends on the stored order. No titles or
  milestones (notables have none).
- **Motion**: the Complement strip's `ui/marquee.ts`; one optional `onPaused` callback added so the band shows the
  mockup's "paused" tag. Static with Reduce motion.
- **Record card** (ActionModal, Escape closes, focus returns to the entry): star, origin, buffs, the ship; Open
  Complement (Ships, that ship, Complement tab), Send back (shown only for a notable aboard) and Retire, through the
  same App handlers. The Retire confirm moved out of ComplementPanel into `NotableRetireModal.svelte` unchanged, so both
  places ask the same question. A crew-locked ship's reason shows in words on the card.
- **All** list and the **empty hint** as drawn; Help: one sentence in the Complement topic's Notable Crew paragraph.
- QA: `docs/qa/2026-11-12-notable-ticker-qa.html`.
- (2026-11-12 night) Warning on the older "Send from the pool" picker (it can push pool crew to the reserve too): "Yes,
  same warning (Recommended)": both pickers say how many pool crew move to the reserve next tick. BUILT: see the
  Homeworld reserve controls carry note above ("The pool's own Send").

## USER ANSWERS (2026-11-13): CP-11 distinct recipes sign-off

All three [PROPOSAL] swaps approved ("Approve (Recommended)" on each): Engineering Quarters = Frame Segment 2 + Power
Coupling 2 + Wafer 1; Science Quarters = Frame Segment 2 + Wafer 1 + Titanium Ingot 1 + Power Coupling 1; Guest Wing =
Frame Segment 1 + Titanium Ingot 2 + Power Coupling 2. No longer [PROPOSAL]; the research and craft costs
(`CREW_MODULE_BLUEPRINT_COSTS`) stay [PROVISIONAL] for 0.16.0.
