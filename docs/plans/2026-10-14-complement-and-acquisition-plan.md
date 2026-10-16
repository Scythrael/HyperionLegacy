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
| **32** Candidate board expansion | **Not built** | `SENIOR_STAFF_ROSTER_BASE` 10 (`model.ts` 6485); both boards read `seniorStaffRosterSize` (`seniorStaff.ts` 509, `awayTeam.ts` 285). **Overlap found:** the captain secondary talent Recruiter already promises "+candidate roster size" (`model.ts` 12089, `candidateRosterSize` 0.08) and nothing reads it. Personnel Rosters is a service facility with no levels (App 10294 to 10300). | CP-19 (home is OC-17). |
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
their ship is on an expedition (decision for the user). OC-11 (auto-crew pause) not built, still open.

### CP-7: Transfer (Task 25 engine)

**Files:** `crew.ts` (`canTransferCrew` + `transferCrew(state, from: shipId | "pool", to: shipId | "pool",
picks: { signatureKey, count }[])`), tests.
**Behavior:** moves up to each requested count, cap-aware per pick through `remainingCapacityForSignature` with the
target's quarters bonus AND its assigned notables counted (the `applyRoster` occupancy rule); partial when the target
fills, reported per pick; refuses on a locked ship (CP-6) and [PROPOSAL, OC-7] when a ship involved is in auto-crew
mode (the UI offers to switch it to manual first). No crew created or destroyed.
**Determinism:** RNG-free; picks applied in the given order. **Save:** none. **Tests:** division and inclusive rank caps
hold; partial fill; pool round trip; locked and auto refusals are same-ref.

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

### CP-9: Complement table, graduate modal, manifest (Tasks 25 / 26 UI part 1)

**Files:** `ComplementPanel.svelte` (bucket table under the graphs: Group, Division, Rank, Rarity, Buffs, Count, sort
by rank / rarity / division, division filter, row checkboxes), new `ManifestModal.svelte`, App handlers
`doGraduate`, glyphs `graduate`, `manifest` (icons.ts + ICON_SEMANTICS).
**UI:** mocked in CMR-8 (table, sort chips, filter chips, "Graduate one", the graduate confirm with the generated name,
the Manifest button). The manifest LIST layout and paging for 750 rows are not mocked: **sketch sign-off needed** for
the manifest view only. Verify in preview (`?dev`): graduate from a full ship, see the notable strip update; open the
manifest; 375 px no horizontal scroll.

### CP-10: Transfer, the crew pool, lock badges, the benched list (Tasks 25 / 27 UI part 2) [needs a sketch]

**Files:** `ComplementPanel.svelte` (Transfer N selected... opens a target picker: another ship or the pool, per-row
counts, the per-pick partial result), a crew pool view [PROPOSAL home: a "Crew pool" section on the Personnel
Rosters facility, OC-10], lock badges on Senior Staff, Complement and Away Team ("Aurora is on an expedition: crew
locked", CMR-8), and the benched members list [PROPOSAL name "Unassigned", on the recruitment board, with Move to
ship and Fire, OC-12], App handlers.
**UI: needs user mockup sign-off** for the pool view, the transfer picker and the benched list (CMR-8 shows only the
"Transfer 12 selected..." button and the lock line). Verify in preview: transfer 12 from pool to a manual ship; a
locked ship disables every crew control with the reason; salvage a hull with members and find them in the list.

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

### CP-12: Bridge and Crew Quarters tiles (Task 28 UI)

**Files:** `ShipSystemsPanel.svelte` `SYSTEM_SLOTS` (+ Bridge Module, Crew Quarters, SVG glyphs `bridge`,
`quarters`), App `BAY_SLOT_ORDER` (+ bridge, quarters), the Fabricator group for crew modules, icons.ts +
ICON_SEMANTICS.
**UI:** mocked in CMR-9 and SMS-1 (tiles with the variant line and Swap / Install). Verify in preview: install a
Balanced Command on the Aurora and see the officer lift in the stat breakdown; 375 px.

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

### CP-15: Patrol cloak and threat detection (G6 part 2) [blocked on OC-19]

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

### CP-17: Roster dropdown on the ship personnel screen (Task 30)

**Files:** `SeniorStaffPanel.svelte` (or the ship detail header shared by Senior Staff and Complement), App handler
reuses `doApplyRoster`.
**Behavior:** a select of saved rosters plus an Apply button (never acts on change); if the ship's current people
differ from every saved roster, Apply first shows the locked "unsaved configuration will be lost" warning (crew spec
450 to 452); disabled with the reason while the ship is locked (CP-6). **Tests:** display helper picks and the warning
condition. **UI:** CMR-10 one-liner; follows the existing select + button pattern, no mockup needed.

### CP-18: Soft captain level cap (Task 31)

**Files:** `model.ts` `xpForNextLevel` (+ `CAPTAIN_SOFT_CAP_LEVEL` 30, `CAPTAIN_SOFT_CAP_GROWTH` 1.08
[PROVISIONAL, OC-23]), `offlineSummary.ts` (already shares the curve).
**Behavior:** identical below the threshold; past it, `300 * level * growth^(level - threshold)`, so levels never stop.
A captain already past 30 keeps every level and simply needs more XP for the next. **Tests:** both sides; offline
summary uses the same curve; integer-safe for level 200.

### CP-19: Candidate board expansion (Task 32) [home blocked on OC-17]

**Files:** depends on OC-17; default proposal: give Personnel Rosters an upgrade track on the facility framework
(`FACILITIES.personnelRosters`, pre-granted level 1, each rung +2 board slots up to 20, credits + time), seeded in
`MIGRATIONS[68]` if v69 has not reached staging, else a v70 step (the telescope precedent, `save.ts` 2526 to 2529).
Reads stay `seniorStaffRosterSize` (both boards). Decide in the same call whether the Recruiter secondary talent
(`model.ts` 12089) adds board slots for that captain's ship or is retargeted.
**Determinism:** a larger board appends slots; existing slots' candidates are unchanged (slot-keyed seeds). **Tests:**
board grows by 2 per level; slot 0..9 candidates identical before and after. **UI:** a facility card like the
telescope (SQ-7.4 pattern); no new mockup if it reuses that card.

### CP-20: Graph color option (Task 33)

**Files:** new `src/lib/graphPalettePreference.ts` (localStorage via `safeStorage`, one key per graph, starting with
the complement graph), Settings row, `ComplementPanel.svelte` reads it.
**Behavior [PROPOSAL, OC-24]:** presets: Default (gray cap, red / yellow / green), Colorblind-safe (Okabe-Ito ramp),
Monochrome. Per-viewer convenience only, never in the save. **Tests:** preference round trip and fallback when storage
throws. **UI:** a Settings select; no mockup needed.

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
19. **Patrol cloak detection** (SMS 6). [PROPOSAL] sensors set the existing detector chance at rating / (rating + 60),
    and patrols gain a rare cloaked-raider opening. Alt: detection only, no new opener (it would then do nothing).
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
- **OC-20 Science sensor amplification:** "Proposed numbers (Recommended)". **OC-21 stacking:** "Multiply (Recommended)".
