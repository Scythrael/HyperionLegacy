# E5 Refugee Posts (0.14.0): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> One fresh builder per slice, then the two-stage review (spec, then quality), re-review after fixes, then the
> holistic review. Never push the branch; deploys are the controller's call, and 0.14.0 stays off staging until the
> wiring gate passes and the user says go.

Status: PLAN, written 2026-11-02 against `feat/crew-0.14.0` @ `778d1ce`. Doc only; nothing here is built. Every
number or name the user did not give is marked **[PROPOSAL]** (mine, the user's to accept or change) or
**[PROVISIONAL]** (a first-pass value a slice needs to stay green until the balance pass). Each lives in ONE named
constant so a retune is a one-line change.

**Goal:** Evacuation runs on the short-range board bring home one named refugee each; refugees are posted at
facilities (posts grow with facility level) and buff that facility, strongly where their background matches and a
little anywhere else; the waiting list lives under Personnel; nobody is ever lost.

**Architecture:** A pure `refugees.ts` module owns the catalog, the record, posts per level, shares and the posting
actions. The short-range draw gains an eighth template behind a versioned draw (a per-slot stamp written at load keeps
existing boards' upcoming draws byte-identical). The cycle engine reports evacuation and relocation deliveries; one
post-pass in `economyTick`, sorted by (atTick, slotId), rolls arrivals (seeded off the roll, tapered against open
posts) and relocation farewells against a threaded refugee state, so one call == chunked == 1 s steps. Facility buffs
are derived on read (`refugeeFacilityBonus`) and folded into eight existing consumer seams, each a wiring registry row.

**Tech Stack:** TypeScript, Svelte 5, Vitest, break_infinity.js; seeded `makeRng` (combat/rng.ts); D23 `diminishing`.

**Spec:** `docs/plans/2026-11-02-refugee-posts-e5-design.md` (design, section 7 builder-check answers, APPROVED,
MOCKUP APPROVED with all 14 calls as drawn) and `docs/mockups/2026-11-02-e5-refugee-posts-mockup.html` (signed).
Context: `docs/plans/2026-10-17-short-range-missions-plan.md` and its carry notes.

## Global Constraints

- Determinism: offline == live; one `economyTick(s, N)` == chunked == N x `economyTick(s, 1)`; every refugee draw comes
  from a seeded stream keyed off the delivering roll's `seed`, never the shared economy rng, never the clock.
- Old saves: load with zero refugees; existing boards' upcoming draws byte-identical (the stamp, E5-1); runs in flight
  replay byte-identically.
- Goldens first for every engine change; every moved pin traced by a switch fixture; never loosen a tolerance.
- Save: `SAVE_VERSION` 70 -> 71 (the board stamp needs a migration); every new field optional with a safe default.
- Wiring: every refugee facility buff is a registry row with a probe through the real consumer and a measuring audit;
  status `live` by E5-4's end (no `pending` E5 row at the release gate).
- D23: stacked refugees on one facility pass through `diminishing(x, knee)`; never a hard cap.
- Anti-goals: no loss, no upkeep, no cooldown, no cost to move, no babysitting timers.
- Text: US English; no em dashes and no "--" anywhere (text, code, comments, docs); say "install" never "fit" for gear;
  for refugee placement say "match" (player text and identifiers).
- Graphics: SVG only (icons.ts + ICON_SEMANTICS; glyphs reviewed at 16, 28 and 56 px). Portraits are simple SVG
  silhouettes (four hair shapes, eight color sets), not the officer art.
- Worktrees: never junction or symlink `node_modules` into a worktree; run `npm ci` there if one is used.
- Gates for every slice (all four must pass before the slice's commit is reviewed):
  - `npx vitest run --maxWorkers=4 --testTimeout=60000`
  - `npm run test:perf`
  - `npm run check`
  - `RELEASE_GATE=1 npx vitest run src/lib/game/no-dead-stats.test.ts` (must list no `pending` row owned by E5 from
    E5-4 on; before E5-4 it may list the E5-4 rows only)

## Numbers (all in one place; each a named constant)

| Constant (file) | Value | Mark |
|---|---|---|
| `REFUGEE_BACKGROUNDS` (refugees.ts) | refiner -> refinery, fuelHandler -> fuelStorage, dispatcher -> missionControl, scholar -> research, machinist -> fabricator, shipwright -> shipyard, salvager -> salvageBay, stargazer -> subspaceTelescope; labels "Refiner", "Fuel handler", "Dispatcher", "Scholar", "Machinist", "Shipwright", "Salvager", "Stargazer" | [PROPOSAL] (as drawn in the signed mockup) |
| Background roll | uniform over the eight | [PROPOSAL] |
| `REFUGEE_SKILL_SPANS` | Tier I [20, 50], Tier II [40, 75], whole numbers | [PROPOSAL] (mockup) |
| `REFUGEE_MATCH_SHARE_PER_SKILL` | 0.001 (skill 42 matched = +4.2%) | [PROPOSAL] (mockup) |
| `REFUGEE_OFF_MATCH_RATIO` | 0.25 | [PROPOSAL] (design) |
| `REFUGEE_STACK_KNEE` | 0.5 (the D23 knee on the summed shares) | [PROPOSAL] |
| `REFUGEE_POSTS_EVERY` | posts = 0 at level 0, else 1 + floor((level - 1) / 3): opens at Levels 1, 4, 7, 10 ... | [PROPOSAL] (mockup) |
| `REFUGEE_TAPER_K` | 4: chance = 1 / (1 + max(0, waiting - openPosts) / K) | [PROPOSAL] |
| Training run (first evacuation) | always brings someone home | [PROPOSAL] (safe first runs) |
| `SHORT_RANGE_TEMPLATES.evacuation` | label "Evacuation"; destinations "surface"; Tier I distance [15, 45], guests [30, 60]; Tier II distance [30, 65], guests [60, 100]; site "passengers" 16 ticks, home "none"; reward passengers 0.0285 / 0.016 cr per person-ly, XP_JOB | [PROVISIONAL] (the Refugee Relocation row, so board income holds, hub call) |
| Evacuation draw weight | 1 in 8 (uniform with the seven) | design ("Random, like the others") |
| Stamp offset | `evacuationFrom[slot] = nextCycle(slot) + 1` at the v71 migration | [PROPOSAL] |
| Farewell pick | the longest-waiting refugee (lowest id among the waiting) | [PROPOSAL] |
| Name pool | `generateCrewIdentity("earthBorn", seed, 0).name` (the diverse human pool; no race stored, no racial bonus, gender discarded) | [PROPOSAL] (E5-0 confirms the pool id) |

Stat each background improves (the consumer seam; E5-0 confirms each):

| Background | Facility | Player stat | Consumer (applied when b > 0 only; b = 0 is bit-identical) |
|---|---|---|---|
| Refiner | refinery | refine speed | refine duration: `ceil(base / (refineSpeedMult x (1 + b)))`, at job start |
| Fuel handler | fuelStorage | fleet reach | `fleetReachBonus(state) + b` |
| Dispatcher | missionControl | short-range run speed | each phase of `shortRangeCyclePlan`: `max(1, ceil(t / (1 + b)))`, frozen at cycle start |
| Scholar | research | research speed | `museumResearchDurationTicks`: `ceil(base / ((1 + museum) x (1 + b)))`, at start |
| Machinist | fabricator | craft speed | fabricate duration `ceil(craftDurationTicks / (1 + b))`, at start |
| Shipwright | shipyard | build speed | `shipBuildSpeedMult(state) x (1 + b)` |
| Salvager | salvageBay | salvage yield | `salvageYieldMult(state) x (1 + b)` |
| Stargazer | subspaceTelescope | scan range | `telescopeReading(...).rangeLy x (1 + b)` |

## Review Focus

1. **A posted count above a facility's posts** (a hand-edited save, or a future level loss): the extra people go back
   to the waiting list at load, last posted first; nobody is dropped. Test owned by E5-1.
2. **Relocation with nobody waiting** (everyone posted, or no refugees): the run delivers and logs exactly as today,
   nobody leaves, no farewell line. Test owned by E5-3.
3. **The Refugees tab after relocations empty the list**: it stays visible once anyone has ever arrived
   (`arrivedTotal > 0`), and shows a calm empty line. Test owned by E5-6.
4. **Two evacuations delivered in the same tick on different slots**, one call vs 1 s steps: the same people, the same
   ids, the same order (sorted by atTick, then slotId). Test owned by E5-2.
5. **Posting to a full facility, or posting someone where they already are**: a full facility swaps (the posted person
   with the lowest share goes back to waiting, design call 10 A); posting in place returns the same state (no-op). An
   unbuilt (level 0) facility has no posts and no strip. Tests owned by E5-4 and E5-5.

---

### Task E5-0: Goldens and study (tests and a carry note only) [small]

**Files:**
- Create: `src/lib/game/refugeeGoldens.test.ts`
- Modify: `docs/plans/2026-11-02-refugee-posts-e5-plan.md` (append the E5-0 carry note under this task)

**Interfaces:**
- Produces: `E5_ADDED_ENTRY_IDS: readonly string[]` (exported from the golden file, empty now; E5-4 fills it so the
  registry pin keeps proving nothing else moved). Capture with `E5_CAPTURE=<path>` (the `G1_CAPTURE` precedent in
  shortRangeGoldens.test.ts).

- [ ] **Step 1: Write the pins (all pass on `778d1ce`)**
  - `golden 1 draws`: `rollShortRangeJob` JSON for slots 0..3 x cycles 0..63 x three board seeds (fresh, a fixed
    homeworld seed, `SHORT_RANGE_DEFAULT_SEED`), hashed per (seed, slot).
  - `golden 2 fleet`: the shortRangeGoldens mixed fleet over 6 h (short-range Repeat on all slots including a run whose
    current roll is `refugeeRelocation`), whole-state hash at 1 h steps.
  - `golden 3 consumers`: refine duration per recipe, research and relic study durations, fabricate duration per
    blueprint, build duration per hull, salvage fraction (fixed rng), `fleetReachBonus`, `telescopeReading().rangeLy`
    per level, and `shortRangeCyclePlan` for 20 rolls, on three facility-level fixtures.
  - `golden 4 registry`: ids and statuses snapshot.
  - `golden 5 old save`: the v70 mixed-fleet save through deserialize + migrate, then 6 h; state hash and every
    slot's preview.
  - `golden 6 help`: the `shortRange` Help topic text and the board's job types list (shortRangeBoardDisplay.ts).
- [ ] **Step 2: Run** `npx vitest run src/lib/game/refugeeGoldens.test.ts`. Expected: PASS.
- [ ] **Step 3: Study, recorded as the carry note (no code):** confirm or correct each row of the consumer table
  (seam, start-time freeze vs live read, call sites, whether the craft XP award reads the shortened duration as the
  refine speed rung already does); the telescope range consumers (`readSystem` in-range, `telescopeCardDisplay`'s
  `band.far === rangeLy` equality, `expeditionConsoleDisplay`), and whether a non-tier range breaks them; every site
  that writes `shortRangeBoard` (tick.ts writes `{ version: 1, nextCycle }` and would drop a stamp); the completion
  log allocator order (`appendShortRangeLog`); whether `runCounts.shortRange` or any hydration validates template
  keys; the human name pool's race id. Anything that contradicts this plan goes to the controller before E5-1.
- [ ] **Step 4: Gates** (Global Constraints), then commit
  `test: E5-0 refugee posts goldens and study`.

#### E5-0 carry note (built 2026-11-02 on `19e5ac4`)

**Goldens** (`src/lib/game/refugeeGoldens.test.ts`, its own commit before any engine edit; `E5_CAPTURE=<path>`
recaptures): (1) `draws:<seed>:<counters>:slot<n>`, 64 cycles per slot for the fresh board seed (which IS
`SHORT_RANGE_DEFAULT_SEED`, asserted), a fixed homeworld's seed and the default seed, each with fresh counters and with
every template a veteran (full size); (2) `fleet`, `fleet:previews`, `fleet:board`: four General Freighters on all four
slots, slot 0 starting on its first Refugee Relocation, six hours at 1 h calls; (3) `consumers:low|mid|top` and
`telescope:levels`; (4) `registry` [1728, bf47b0ce] with `E5_ADDED_ENTRY_IDS` (exported, empty) held apart;
(5) `old`, `old:previews` (the fleet saved at v70, migrated with fixed entropy, six hours: identical to golden 2, as a
v70 save runs no migration today; E5-1's v71 step must keep it so); (6) `help:shortRange`, `types:fresh`.
Deviations from Step 1: golden 2 starts each run through `startShortRangeCycle` (the G1-4 golden 7 precedent), since a
bare General Freighter fails the sheet at the dispatch gate; and the fleet buys every transit berth rung
(`transitBerthCapacity: 8`, the shortRangeCycle.test.ts parity fleet's). Without it the hour-long calls let slots 0
and 1 reclaim their own freed berth all hour and slots 2 and 3 never docked in six hours (by design: a berth freed in a
call is reclaimable only by that run, and production steps 1 s; noted, not changed).

**Study: does +5% on each facility stat measurably act?** Measured with a throwaway probe (not committed), applying
the plan's formula for each row at b = 0.05, on today's content (PROVISIONAL_HOMEWORLD bands for the telescope).
The general rule for every ceil'd integer duration T: it moves at b only when b >= 1 / (T - 1) (5% needs T >= 21; the
off-match 25% of a skill 42 refugee, about 1.05%, needs T >= 97).

| Facility | Stat (seam) | Consumer file:line | Measured effect of +5% |
|---|---|---|---|
| refinery | refine duration, `refineJobDurationTicks` (start-time, frozen on the process) | tick.ts:7855, read at tick.ts:9691 (line job start) | **Does not act at Levels 1 to 3**: the 14 recipes are 12 or 20 ticks and `ceil(20 / 1.05) = 20`, `ceil(12 / 1.05) = 12`, so 0 of 14 shorten (needs b >= 5.3% for the 20-tick, 9.1% for the 12-tick). At Level 4 (x1.5) 12 of 14 shorten (14 -> 13 ticks), total 184 -> 172 (6.5%); the 12-tick pair (8 ticks) still holds. **Game question below.** |
| fuelStorage | fleet reach, `fleetReachBonus + b` in `shipReachDef` (live read) | tick.ts:5870 (bonus tick.ts:9555) | Acts on every hull: e.g. General Freighter 105.0 -> 110.0 ly at Level 1, Orion 241.0 -> 252.5 ly; missions in reach move at the gate edge (Prospector Miner 9 -> 10 of 10, Destroyer 7 -> 8 at Level 1). Continuous. |
| missionControl | each phase of `shortRangeCyclePlan`, `max(1, ceil(t / (1 + b)))` (frozen at cycle start) | shortRangeBoard.ts:140 (startShortRangeCycle; plan shortRange.ts:470); the cost preview re-plans at shortRangeBoardDisplay.ts:439 and :456, which must read the same fold | Acts: 49 of 80 phases shorten over 20 veteran rolls (both legs always; the 3-tick home unload and small on-site phases never), total 4053 -> 3893 ticks (3.95%). |
| research | `museumResearchDurationTicks` (start-time) | blueprint research tick.ts:8898 (startResearch tick.ts:8867); relic study tick.ts:8993 (relicStudyDurationFor), started at tick.ts:9018 and the queue at tick.ts:9245 | Acts: 98 of 98 blueprints shorten (60 to 480 ticks), total 14330 -> 13707 (4.35%); relic study 600 -> 572, 900 -> 858, 1200 -> 1143, 1800 -> 1715. |
| fabricator | `ceil(craftDurationTicks / (1 + b))` (start-time) | tick.ts:9722 (line job plan) and tick.ts:12098 (one-off fabricate); both read `bp.craftDurationTicks` raw today, so E5-4 adds the one seam both call | Acts: 93 of 98 blueprints shorten (the 1-tick ones cannot), total 27875 -> 26581 (4.64%). |
| shipyard | `shipBuildSpeedMult x (1 + b)` (start-time, fractional is parity-safe) | tick.ts:8419 (shipBuildDurationTicks), started at tick.ts:8560 | Acts fully (no rounding): General Freighter 300 -> 285.71 ticks at Level 1, 100 -> 95.24 at Level 3+; Battleship 1200 -> 1142.86. |
| salvageBay | `salvageYieldMult x (1 + b)` (live read, no extra draw) | salvage.ts:207, read by recycle salvage.ts:447 and teardown salvage.ts:825 | Acts: the fraction 0.35 -> 0.3675 at the band's middle (0.30 -> 0.315 to 0.3999 -> 0.4199); expected recovery of 10 units 3.50 -> 3.675 (chance-rounded on the private stream, so the shared one-draw contract holds). |
| subspaceTelescope | `telescopeReading().rangeLy x (1 + b)` (live read) | telescope.ts:142; readers: readSystem telescope.ts:259 (inRange, then detail and risk view), expedition.ts:1092 (console candidates) and :1562 (the blind-launch count), expeditionConsoleDisplay.ts:198 (`band.far <= rangeLy`); the Facilities card reads telescopeReadingAtLevel (telescopeCardDisplay.ts:136), not telescopeReading | **Acts only on a sliver, display only.** The range is a region band's far edge, so +5% reaches only the next region's nearest systems: T2 0 -> 4 of 2000 at Level 1, T3/T4 0 -> 55 at Levels 2 and 3, T5 0 -> 152 at Levels 4 and 5, T6 0 -> 115 at Level 6, T7 0 -> 1689 at Level 7 (T7's band is narrow), nothing at Level 8. What moves is the candidate's reading (detail and risk preview instead of blind) and the blind-launch counter; no run outcome reads it. A non-tier range also breaks `farRegionsText`'s `far === rangeLy` (telescopeCardDisplay.ts:63: the region names go blank) and `sameRange` (:151). `expeditionConsoleDisplay`'s `<=` stays right. **Game question below.** |

**Game questions for the user (before E5-4):**
1. **Refiner.** A percent refine speed cannot act at Refinery Levels 1 to 3 on today's 12 and 20 tick recipes (the
   integer ceil the crafting XP needs swallows it), and one post opens at Level 1. Options: (a) keep speed and accept it
   acts only from about 5.3% (a Tier II refiner of skill 53 and up) or Level 4; (b) the refiner raises refine OUTPUT
   instead (a chance-rounded extra unit on a private stream, the salvage precedent; acts at every level); (c) speed
   with a carried fractional tick (keeps the XP integer but is new engine work).
2. **Stargazer.** The telescope has no continuous stat today (its rungs set a region reach and a detail level). A
   percent range acts only on the few next-region systems just past the edge, and only on what the console shows.
   Options: (a) keep the range (and fix the card's `far === rangeLy` names); (b) lower the ship lift threshold
   (`TELESCOPE_SHIP_LIFT_SENSORS` = 40, telescope.ts:60) by the share, so a ship with fewer sensors gets the detail
   lift (also display only); (c) point the Stargazer at a stat that changes runs (for example the expedition scan, a
   sensors-read stat), which is a design change for the user to name.

**The rest of Step 3:**
- Start-time freeze vs live read: as the table says; the four duration seams freeze on the TimedProcess or the cycle
  plan, so a posting never re-times work in flight; reach, salvage and telescope are live reads.
- Crafting XP: the refine award is `floor(durationTicks x rate x weight)` on the stored (shortened) duration
  (craftingProgress.ts:201), as the speed rung already does, so a faster job pays proportionally less XP, XP per tick
  unchanged. Fabricate reads the same stored duration, so a Machinist seam behaves the same.
- Every site that writes `shortRangeBoard`: tick.ts:5509 (`{ version: 1, nextCycle: { ...srCursorAfter } }`, which
  would drop a stamp, as the plan says) and save.ts:209 to 211 (`withWellFormedShortRangeBoard` drops a malformed board
  whole). No other writer outside tests.
- Completion log order: `appendShortRangeLog` (tick.ts:1460) sorts this call's finds and run endings by atTick, finds
  before endings in a tick, then appends, allocating `done-<nextCompletionLogId>` in that order. E5-2's farewell and
  arrival lines must join that same sort to stay chunk-free.
- Template keys: `runCounts.shortRange` hydration (runDifficulty.ts:260 to 261) checks only the counts' shape, never the
  key, so an `evacuation` key needs no save change; `countShortRangeCycleStart` creates a key on first use.
- The human name pool: `generateCrewIdentity("earthBorn", seed, index)` (crew.ts:217); `earthBorn` is the CrewRace id
  (model.ts:7545, crewRaces.ts:62). Confirmed as the plan writes it.

### Task E5-1: Data and save [medium]

**Files:**
- Create: `src/lib/game/refugees.ts`, `src/lib/game/refugees.test.ts`
- Modify: `src/lib/game/model.ts` (types, `GameState.refugees?`, `ShortRangeBoardState.evacuationFrom?`),
  `src/lib/game/save.ts` (v71 migration, hydration), `src/lib/game/shortRangeBoard.ts` (`isWellFormedShortRangeBoard`
  accepts the stamp), `src/lib/game/tick.ts` (the board write keeps the stamp), `src/lib/game/save.test.ts`

**Interfaces:**
- Produces (refugees.ts):
  ```ts
  export type RefugeeBackground = "refiner" | "fuelHandler" | "dispatcher" | "scholar" | "machinist" | "shipwright" | "salvager" | "stargazer";
  export type RefugeeFacilityKey = "refinery" | "fuelStorage" | "missionControl" | "research" | "fabricator" | "shipyard" | "salvageBay" | "subspaceTelescope";
  export const REFUGEE_FACILITY_KEYS: readonly RefugeeFacilityKey[];
  export const REFUGEE_BACKGROUNDS: Readonly<Record<RefugeeBackground, { label: string; facility: RefugeeFacilityKey; statLabel: string }>>;
  export interface RefugeeRecord {
    id: number; name: string; background: RefugeeBackground; skill: number;
    origin: { tier: ShortRangeTier; destinationIndex: number }; // label derived via shortRangeDestinationLabel
    portrait: { hair: 0 | 1 | 2 | 3; palette: number /* 0..7 */ };
    arrivedAtSeconds: number; posting: RefugeeFacilityKey | null;
  }
  export interface RefugeeState { version: 1; list: RefugeeRecord[]; nextId: number; arrivedTotal: number; greet: number[]; hintSeen?: true }
  export function refugeesOf(state: Pick<GameState, "refugees">): RefugeeState; // absent -> the empty state
  export function refugeePostsAt(level: number): number;
  export function refugeePostCount(state: GameState, facility: RefugeeFacilityKey): number;
  export function refugeesPostedAt(state: GameState, facility: RefugeeFacilityKey): RefugeeRecord[];
  export function refugeeWaiting(state: GameState): RefugeeRecord[];
  export function refugeeOpenPosts(state: GameState): number; // sum of posts minus posted, never negative
  export function isWellFormedRefugeeRecord(v: unknown): v is RefugeeRecord;
  export function hydrateRefugees(state: GameState): GameState; // drops malformed records only, returns overflow to waiting
  ```
- Produces (model.ts): `ShortRangeBoardState.evacuationFrom?: Record<number, number>`.

- [ ] **Step 1: Failing tests** (refugees.test.ts, save.test.ts):
  - `refugeePostsAt`: `[0,1,2,3,4,6,7,10].map(refugeePostsAt)` equals `[0,1,1,1,2,2,3,4]`.
  - `refugeesOf` on a state without the field returns `{ version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [] }`
    and a fresh state has no `refugees` key.
  - `refugeeOpenPosts` on a fresh state equals the posts of the four level-1 facilities (4) and never goes below 0.
  - `hydrateRefugees`: a record with an unknown background or a non-finite skill is dropped, the rest kept in order;
    a refinery at level 1 holding two posted refugees keeps the earlier-posted one and returns the other to waiting
    (Review Focus 1); a posting to a non-refugee facility key returns to waiting.
  - save: a v70 save migrates to 71 with `shortRangeBoard.evacuationFrom[slot] === nextCycle(slot) + 1` for every slot
    in `shortRangeBoardSlots`; a v71 save round-trips the stamp and `refugees` unchanged; a fresh v71 state has no stamp.
  - `isWellFormedShortRangeBoard` accepts a whole-count stamp and rejects a negative or fractional one.
  - tick: after a delivered cycle on a stamped board, `shortRangeBoard.evacuationFrom` is the same object as before.
- [ ] **Step 2: Run** `npx vitest run src/lib/game/refugees.test.ts src/lib/game/save.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the types and readers; `SAVE_VERSION = 71` with a numbered migration-comment entry; the
  migration writes the stamp (creating `{ version: 1, nextCycle: {}, evacuationFrom }` when the board is absent);
  hydration runs `hydrateRefugees` after `withWellFormedShortRangeBoard`; tick.ts spreads the stored board when it
  writes the cursor.
- [ ] **Step 4: Run** the two files, then the gates. Determinism: golden 5 (old save) and goldens 1 to 3 unchanged
  (no engine reads the new fields yet). Golden 4 unchanged.
- [ ] **Step 5: Commit** `feat: E5-1 refugee records, posts per level, v71 board stamp`.

### Task E5-2: Evacuation template, versioned draw, refugee roll and taper [large]

**Files:**
- Create: `src/lib/game/refugeeArrival.ts`, `src/lib/game/refugeeArrival.test.ts`,
  `src/lib/game/evacuationDrawSwitch.fixture.ts`
- Modify: `src/lib/game/shortRange.ts`, `src/lib/game/shortRangeCycle.ts`, `src/lib/game/tick.ts` (post-pass and log),
  `src/lib/game/model.ts` (`CompletionLogKind` + entry fields), `src/lib/game/shortRangeBoardDisplay.ts` (job types
  list reads the eight), golden files whose pins move (traced, below)

**Interfaces:**
- Consumes: E5-1 `refugeesOf`, `refugeeWaiting`, `refugeeOpenPosts`, `RefugeeRecord`, `ShortRangeBoardState.evacuationFrom`.
- Produces (shortRange.ts):
  ```ts
  export type ShortRangeTemplateKey = /* the seven */ | "evacuation";
  export const SHORT_RANGE_DRAW_V1_KEYS: readonly ShortRangeTemplateKey[]; // the frozen seven, in today's order
  export const SHORT_RANGE_TEMPLATE_KEYS: readonly ShortRangeTemplateKey[]; // the eight (lists and Help)
  export const SHORT_RANGE_EVACUATION_SALT: number;
  export const EVACUATION_DRAW_SWITCH: { live: boolean }; // test-only off switch, default true
  export function shortRangeDrawVersion(state: Pick<GameState, "shortRangeBoard">, slotId: number, cycleIndex: number): 1 | 2;
  ```
- Produces (refugeeArrival.ts):
  ```ts
  export const REFUGEE_SALT: number;
  export const REFUGEE_TAPER_K = 4; // [PROPOSAL]
  export function refugeeArrivalChance(waiting: number, openPosts: number): number;
  export interface RefugeeDelivery { kind: "evacuation" | "relocation"; atTick: number; slotId: number; roll: ShortRangeRoll }
  export interface RefugeeEvent { kind: "arrival" | "noArrival" | "farewell"; atTick: number; slotId: number; refugeeId?: number; name?: string; background?: RefugeeBackground; destinationIndex: number; tier: ShortRangeTier }
  export function rollRefugee(roll: ShortRangeRoll, id: number, arrivedAtSeconds: number): RefugeeRecord;
  export function applyRefugeeDeliveries(refugees: RefugeeState, openPosts: number, deliveries: readonly RefugeeDelivery[], call: { gameTimeSeconds: number; tickDurationSeconds: number }): { refugees: RefugeeState; events: RefugeeEvent[] };
  ```
- Produces (shortRangeCycle.ts): `ShortRangeTickResult.refugeeDeliveries: RefugeeDelivery[]` (evacuation and
  refugeeRelocation cycles delivered this call, in delivery order).

- [ ] **Step 1: Failing tests** (refugeeArrival.test.ts):
  - `drawShortRangeJob` with version 1 equals today's roll for every golden-1 case (byte-identical JSON).
  - version 2: over 8,000 (slot, cycle) pairs the evacuation share is within 0.125 +/- 0.01; every non-evacuation roll
    at version 2 equals the version 1 roll for the same (seed, slot, cycle) (the overlay never shifts a non-evacuation
    job); an evacuation roll never exceeds its tier sheet (`shortRangeRollUses` <= `SHORT_RANGE_SHEETS`).
  - `shortRangeDrawVersion`: a slot with stamp 5 reads 1 at cycles 0..4 and 2 from 5; a slot without an entry reads 2;
    with `EVACUATION_DRAW_SWITCH.live = false` it reads 1 everywhere.
  - `refugeeArrivalChance(0, 0) === 1`, `(3, 3) === 1`, `(7, 3) === 0.5` with K 4, strictly decreasing in waiting past
    open posts, `> 0` at waiting 1e6.
  - `rollRefugee` is a pure function of (roll.seed, id): same inputs, same record; skill within the tier span; the draw
    layout is fixed (arrival, background, skill, name, hair, palette: six draws always taken).
  - `applyRefugeeDeliveries`: a training-run evacuation always arrives; a miss emits `noArrival` and mints no id;
    `arrivedTotal` and `nextId` advance per arrival; each new id is appended to `greet`.
  - Review Focus 4: two Repeat evacuations on slots 0 and 2 timed to deliver on the same tick; one 6 h call, 997 s
    chunks and 1 s steps give identical `refugees` and identical log entries.
  - cycle engine: `tickCaptainShortRange` reports one `RefugeeDelivery` per delivered evacuation or relocation cycle,
    with the cycle's `atTick`.
  - log: an arrival writes a `refugeeArrival` completion entry ("Evacuation complete: {name}, a {background}, joins
    your homeworld."), a miss a `refugeeNoArrival` entry ("Evacuate {destination} complete. Everyone aboard reached the
    camps; nobody new came home this time."), allocated after `appendShortRangeLog` from the same counter.
- [ ] **Step 2: Run** `npx vitest run src/lib/game/refugeeArrival.test.ts`; expect FAIL.
- [ ] **Step 3: Implement.**
  - Draw: `drawShortRangeJob` keeps its six-draw layout on `SHORT_RANGE_DRAW_V1_KEYS`. At version 2, a second stream
    `makeRng((seed ^ SHORT_RANGE_EVACUATION_SALT) >>> 0)` draws `nextInt(8)`; on 0 the whole job is redrawn on that
    stream with the template fixed to `evacuation` (same layout: template draw skipped, then destination, distance,
    primary, secondary spent, flavor). `rollShortRangeJob` passes `shortRangeDrawVersion(state, slot.id, cycleIndex)`.
  - Template: add the `evacuation` row (Numbers table). Its training run, slow start and wear follow the existing
    per-template counters with no new code.
  - Arrival: a roll's stream `makeRng((roll.seed ^ REFUGEE_SALT) >>> 0)`; draw 1 is the arrival check against
    `refugeeArrivalChance(waiting, openPosts)` (skipped as a pass on the training run but still taken); the record's
    name is `generateCrewIdentity(<pool>, roll.seed ^ REFUGEE_SALT, id).name` (its own stream, so the six-draw layout
    holds); `arrivedAtSeconds = gameTimeSeconds + atTick x tickDurationSeconds`.
  - Post-pass (tick.ts): collect every captain's `refugeeDeliveries`, sort by (atTick, slotId), call
    `applyRefugeeDeliveries` with `openPosts` read from the INCOMING state (call-constant, the board-slot precedent);
    write `refugees` only when it changed; append the log entries after the short-range log.
  - Relocation deliveries are passed through but do nothing until E5-3 (a `relocation` delivery is ignored here).
- [ ] **Step 4: Switch fixture and traced moves.** `evacuationDrawSwitch.fixture.ts` exports
  `withEvacuationDrawOff<T>(run: () => T): T` and `evacuationDrawOffForThisFile(): void` (the crewHoursSwitch pattern).
  Every golden pin that moves (expected: golden 1 for unstamped fresh-seed cases, golden 2, golden 6's job list, and
  any shortRange*/firstRuns golden built from a fresh state) is re-captured, and a trace test proves the old value is
  reproduced exactly under `withEvacuationDrawOff`. Golden 5 (old save) must NOT move for any roll before each slot's
  stamp; list any later-cycle move with its trace. Golden 3 and 4 unchanged.
- [ ] **Step 5: Run** the gates. Determinism checks: offline == live (the 2 h offline replay in shortRangeCycle.test.ts
  extended with an evacuation run); one call == 997 s chunks == 1 s steps over 20 cycles with two evacuation slots;
  old save identical up to the stamp.
- [ ] **Step 6: Commit** `feat: E5-2 Evacuation template and refugee arrivals (versioned draw)`.

### Task E5-3: Relocation takes one waiting refugee [small]

**Files:**
- Modify: `src/lib/game/refugeeArrival.ts`, `src/lib/game/refugeeArrival.test.ts`, `src/lib/game/tick.ts` (log kind)

**Interfaces:**
- Consumes: E5-2 `applyRefugeeDeliveries`, `RefugeeDelivery`, `RefugeeEvent`.
- Produces: `refugeeFarewellPick(refugees: RefugeeState): RefugeeRecord | null` (the lowest-id waiting refugee).

- [ ] **Step 1: Failing tests:**
  - a delivered relocation with three waiting removes the lowest-id waiting refugee only, emits a `farewell` event and a
    `refugeeFarewell` log entry ("{name} leaves to lead the new camp on {destination}.");
  - Review Focus 2: with nobody waiting (all posted, or none at all) the state and the log are identical to a run
    without E5 (the same object for `refugees`);
  - a posted refugee is never picked; `arrivedTotal` does not drop;
  - an evacuation and a relocation on the same tick resolve in slotId order, one call == 1 s steps.
- [ ] **Step 2: Run** `npx vitest run src/lib/game/refugeeArrival.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the relocation branch in `applyRefugeeDeliveries` and the log kind. No draw is taken (the
  pick is deterministic), so no stream moves.
- [ ] **Step 4: Gates.** Goldens: no pin moves (golden 2 has no refugees waiting when a relocation delivers; if it
  does after E5-2, the move is traced to this rule in the golden's comment).
- [ ] **Step 5: Commit** `feat: E5-3 Refugee Relocation takes one waiting refugee`.

#### E5-3 carry note (built 2026-11-02 on `999809f`)

- Who: `refugeeFarewellPick`, the lowest id among the waiting (ids are minted in arrival order, so the longest-waiting).
  When: at delivery, inside `applyRefugeeDeliveries` in the (atTick, slotId) order; no draw. The leaver also leaves
  `greet`; `arrivedTotal` never drops. Log kind `refugeeFarewell` (`refugee` + `refugeeOrigin`), line "{name} leaves to
  lead the new camp on {destination}." Icon "home" until E5-6 adds the leaf glyph [PROVISIONAL].
- Goldens: `e5-2:fleet` and `e5-2:old` moved (slot 0's Repeat Relocations take the people Evacuations brought); traced
  with `refugeeFarewellSwitch.fixture.ts` `withRefugeeFarewellOff`, new values in `e5-3:fleet` / `e5-3:old`; previews,
  boards and the draw-off pins unchanged. Two E5-2 test assertions traced (the capped log's first lines, the list size).
- Found, not fixed (pre-existing on `999809f`, short-range engine): two captains on Repeat while a template is still in
  its slow-start ramp diverge between one long call and 1 s steps (board cursor and `runCounts`), apparently because the
  captain map threads `runCounts` captain by captain across the whole call. The E5-3 determinism tests use a veteran
  fleet, as E5-2's did. For the controller.
- FIXED (slow-start parity fix, on `739b49a`): root cause tick.ts's short-range arm ran each captain's whole call
  through `tickCaptainShortRange` in captain order, so a cycle start (shortRangeCycle.ts, the delivery's
  `countShortRangeCycleComplete` and the next `startShortRangeCycle` roll) saw this captain's later cycles but none of
  a later captain's earlier deliveries. Now the run is a generator over its sync points (departure gate, berth claim,
  delivery) and `tickShortRangeFleet` serves a long call's runs in (whole tick, captain order, instant) order, the
  order 1 s steps produce. Only calls longer than one tick with two or more runs take it; production only ever steps
  economyTick(state, 1), so no live or offline trajectory moves (no stamp needed). Goldens 2 and 5 moved (one-hour
  calls), traced with `shortRangeFleetSwitch.fixture.ts`, new values in `srfix:*`. The E5-2/E5-3 determinism blocks now
  run a fresh fleet as well as the veteran one. Left as is: the first-seen key order of `lifetimeStats` maps and of
  `discovered` within one multi-captain call follows the captain map (values identical; readers use membership).

### Task E5-4: Posts, actions and facility buffs, with registry rows [large]

**Files:**
- Create: `src/lib/game/refugeeBuffs.ts`, `src/lib/game/refugeeBuffs.test.ts`
- Modify: `src/lib/game/refugees.ts` (actions), `src/lib/game/tick.ts` (refine, research, fabricate, build, fleet
  reach seams), `src/lib/game/salvage.ts`, `src/lib/game/telescope.ts`, `src/lib/game/shortRangeBoard.ts`
  (`startShortRangeCycle` plan), `src/lib/game/wiring/registry.ts`, `src/lib/game/wiring/catalogs.ts`,
  `src/lib/game/wiring/probes.ts`, `src/lib/game/refugeeGoldens.test.ts` (`E5_ADDED_ENTRY_IDS`)

**Interfaces:**
- Consumes: E5-1 readers and records.
- Produces (refugees.ts, all pure, returning the SAME state on a no-op):
  ```ts
  export function postRefugee(state: GameState, refugeeId: number, facility: RefugeeFacilityKey): { next: GameState; success: boolean; swappedOutId?: number };
  export function unpostRefugee(state: GameState, refugeeId: number): { next: GameState; success: boolean };
  export function greetRefugee(state: GameState, refugeeId: number): GameState; // removes the id from greet
  export function dismissRefugeeHint(state: GameState): GameState;
  ```
- Produces (refugeeBuffs.ts):
  ```ts
  export const REFUGEE_MATCH_SHARE_PER_SKILL = 0.001; // [PROPOSAL]
  export const REFUGEE_OFF_MATCH_RATIO = 0.25; // [PROPOSAL]
  export const REFUGEE_STACK_KNEE = 0.5; // [PROPOSAL]
  export function refugeeShare(r: Pick<RefugeeRecord, "background" | "skill">, facility: RefugeeFacilityKey): number; // raw, before the curve
  export function refugeeFacilityBonus(state: GameState, facility: RefugeeFacilityKey): number; // diminishing(sum of shares, knee)
  export function refugeeBonusIfPosted(state: GameState, refugeeId: number, facility: RefugeeFacilityKey): { gain: number; total: number }; // for the picker
  ```

- [ ] **Step 1: Failing tests** (refugees.test.ts, refugeeBuffs.test.ts):
  - `postRefugee` to a facility with an open post posts; to a full facility swaps out the lowest-share posted person
    to waiting and reports `swappedOutId`; to the facility they already hold returns the same state; to a level-0
    facility fails; moving a posted person empties their old post (Review Focus 5).
  - `unpostRefugee` returns them to waiting; never removes a record. No action costs anything or sets a timer.
  - `refugeeShare({ background: "refiner", skill: 42 }, "refinery") === 0.042`; off match `0.0105`.
  - `refugeeFacilityBonus` is 0 with nobody posted, equals `diminishing(sum, REFUGEE_STACK_KNEE)` with two, strictly
    increasing and unbounded as posts fill (D23, no cap).
  - each consumer: with b = 0 the value is bit-identical to golden 3; with one matched refugee posted it moves by its
    curve (duration divides by 1 + b, multiplier times 1 + b, reach adds b); a dispatcher's effect is frozen into the
    cycle plan at the cycle start and a reposting mid-cycle changes only the next cycle.
- [ ] **Step 2: Run** `npx vitest run src/lib/game/refugees.test.ts src/lib/game/refugeeBuffs.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the actions, `refugeeBuffs.ts`, and the eight consumer folds (table above), each guarded so
  b = 0 takes the old code path.
- [ ] **Step 4: Registry.** Add `REFUGEE_BACKGROUNDS` to `CATALOGS` and catalogs.ts. Sixteen rows, system "facility",
  status live: `facility:REFUGEE_BACKGROUNDS:<background>` (the matched share, eight rows) and
  `facility:REFUGEE_OFF_MATCH:<facility>` (an off-match refugee at that facility, eight rows). Each: a probe through the
  real consumer (reuse the existing probe where one already reads the seam; add one per missing seam), curve
  `divisor` (durations), `linearRelative` (build speed, salvage, scan range) or `linearAbsolute` (reach), magnitude
  read from the catalog through `refugeeFacilityBonus` (never a literal), `on` = the base with one refugee of skill 50
  posted, `off` = the same without. List the ids in `E5_ADDED_ENTRY_IDS`.
- [ ] **Step 5: Gates**, including the RELEASE_GATE run (no E5 row pending). Determinism: the dispatcher change keeps
  one call == chunked == 1 s steps (cycle-start freeze); old save golden 5 unchanged (no refugees posted); golden 3 and
  4 move only by the added ids.
- [ ] **Step 6: Commit** `feat: E5-4 refugee posts and facility buffs (16 registry rows)`.

### Task E5-5: UI, facility Posts strips and the post picker [medium-large]

**Files:**
- Create: `src/lib/refugeeDisplay.ts`, `src/lib/refugeeDisplay.test.ts`, `src/lib/RefugeePostsStrip.svelte`,
  `src/lib/RefugeePostPicker.svelte`, `src/lib/ui/RefugeePortrait.svelte`
- Modify: `src/lib/ui/icons.ts` (+ ICON_SEMANTICS; eight background glyphs, a posts glyph), `src/lib/ui/icons.test.ts`,
  `src/App.svelte` (Facilities dashboard panes; the Operations Mission Control tab; the action handlers)

**Interfaces:**
- Consumes: E5-4 actions and `refugeeFacilityBonus`, `refugeeBonusIfPosted`, `refugeeShare`.
- Produces (refugeeDisplay.ts, pure):
  ```ts
  export function postsStripView(state: GameState, facility: RefugeeFacilityKey): PostsStripView | null; // null when no refugee ever arrived or level 0
  export function postPickerView(state: GameState, facility: RefugeeFacilityKey): PostPickerView; // waiting sorted by gain here, then "Posted elsewhere"
  export function refugeeBestPost(state: GameState, refugeeId: number): { facility: RefugeeFacilityKey; gain: number; open: boolean } | null;
  export function percentText(fraction: number): string; // "+4.2%"
  ```

- [ ] **Step 1: Failing tests** (refugeeDisplay.test.ts): the strip reads "Posts 2 / 3" and "4th post at Level 10"
  for a level-7 refinery with two posted; each filled post shows name, background chip, "match" or "other" and its
  share; the total line reads the curved total ("stacked on the diminishing curve"); the off-match hint ("Dov would give
  +3.7% craft speed at the Fabricator") appears only when another facility gives more; the picker sorts waiting by gain
  here, shows "total becomes" for a match and the home-facility gain for an off match, lists posted people under
  "Posted elsewhere" with "Move here"; a full facility's picker offers the swap (call 10 A); `postsStripView` is null on
  a fresh save and for a level-0 facility.
- [ ] **Step 2: Run** `npx vitest run src/lib/refugeeDisplay.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** per the signed mockup sections 1 and 2: the strip under each Facilities dashboard pane,
  outside the pane's button (call 1 A); the popover on a filled post with "Move to another post" and "Back to waiting
  list" and "Moving is free, any time." (call 2 A); each share plus the total (call 3 A); Mission Control's strip on
  the Operations, Mission Control tab under its level readout (call 4 A); phone rows one line per post with the share on
  the right and only the total underneath (call 5 A); the picker as a modal on desktop and a bottom sheet at 375 px
  (calls 6 A, 7 A). Locked future posts are one text line, never drawn slots. Portraits: four hair shapes x eight
  palettes from `RefugeeRecord.portrait`.
- [ ] **Step 4: Visual check** with `preview_start({ name: "dev" })` at 1280 px and 375 px (a DEV_MODE build seeds
  refugees through the Debug tab only if a dev mint exists; otherwise a fixture save): no horizontal scroll at 375 px;
  glyphs reviewed at 16, 28 and 56 px.
- [ ] **Step 5: Gates**, then commit `feat: E5-5 facility Posts strips and post picker`.

### Task E5-6: UI, Personnel Refugees tab, arrival card, log lines, first-arrival hint [medium]

**Files:**
- Create: `src/lib/RefugeesPanel.svelte`
- Modify: `src/lib/refugeeDisplay.ts` (+ tests), `src/lib/ShortRangePanel.svelte` (the arrival card),
  `src/App.svelte` (Personnel sub-tab, toast, Facilities hint, log rendering), the completion log display helper that
  maps kinds to verbs and icons

**Interfaces:**
- Consumes: E5-4 `postRefugee`, `greetRefugee`, `dismissRefugeeHint`; E5-5 `refugeeBestPost`, `RefugeePortrait`,
  `RefugeePostPicker`.
- Produces (refugeeDisplay.ts): `refugeesTabView(state, filter: "waiting" | "posted" | "everyone", sort: "skill" |
  "background" | "arrived")`, `refugeesTabVisible(state): boolean` (`arrivedTotal > 0`), `arrivalCardView(state,
  refugeeId)`, `slowArrivalsLine(state): string` (words only), `firstArrivalHintView(state)`.

- [ ] **Step 1: Failing tests:** the tab is hidden while `arrivedTotal === 0` and stays visible after relocations
  empty the list, showing the calm empty line (Review Focus 3); the header counts read "Waiting 5", "Posted 4", "Open
  posts 2 of 13"; the slowing line appears only while waiting > open posts and contains no number (call 9 A); each row's
  "Best post" reads "Refinery 1 open +6.1%" or "no open post"; "Post..." on a full best facility offers the swap (call
  10 A); the arrival card offers "Post at the {facility} (+x%)" for the best open post and "Leave on the waiting list"
  (call 11 A), and greeting removes the id from `greet`; a `refugeeNoArrival` entry renders as a neutral line, never as
  a failure (call 12 A); the hint shows once after the first arrival and never after `dismissRefugeeHint` (call 14 A).
- [ ] **Step 2: Run** `npx vitest run src/lib/refugeeDisplay.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** per mockup sections 3 to 6: the Refugees sub-tab after Rosters with its waiting count
  (call 8 A), filters and sort, the facility chooser behind "Post..."; the run card arrival block and the phone toast
  with "Post at {facility}" and "Later"; fleet log lines for arrival, no arrival and farewell with SVG icons; the
  empty state on a new save exactly as today (call 13 A).
- [ ] **Step 4: Visual check** at 1280 px and 375 px as in E5-5.
- [ ] **Step 5: Gates**, then commit `feat: E5-6 Refugees tab, arrival card and log lines`.

### Task E5-7: Help, QA sheet, close-out [small]

**Files:**
- Modify: `src/lib/helpTopics.ts`, `src/lib/helpTopics.test.ts`, the 0.14.0 patch notes draft,
  `docs/inventory/2026-09-30*` (S1-06, S4-C30, S4-EX23 marked BUILT), this plan (carry notes)
- Create: `docs/qa/<date>-refugee-posts-qa.html`

- [ ] **Step 1: Failing tests** (helpTopics.test.ts): a new `refugees` topic whose every number (skill spans, match
  share, off-match ratio, posts per level, the taper's behavior in words) is read from its owner constant; the
  `shortRange` topic lists eight jobs and says an evacuation can bring someone home; every buff the topic names is LIVE
  in the registry; no em dash, no "--", no "fit" in either topic.
- [ ] **Step 2: Implement** the topic (Personnel > Refugees, linked from the Refugees tab and the hint) and the patch
  note lines [PROPOSAL wording, the user's to edit].
- [ ] **Step 3: QA sheet** (desktop 1280 px and mobile 375 px, pointing at staging
  `devpreview.crystalisoft.com` on the 0.14.0 build, "once the user says go"): fresh save has no Posts rows and no
  Refugees tab; first evacuation is a training run and brings someone home; the hint, arrival card and one-tap post;
  strip shares and total; picker swap and "Move here"; relocation farewell names a waiting person only; reload and
  2 h offline give the same people; an old save keeps its board previews; 375 px has no horizontal scroll.
- [ ] **Step 4: Gates**, including the RELEASE_GATE run (no E5 row pending), then commit
  `docs: E5-7 refugee posts Help, QA sheet, close-out`.

## Size (honest)

Eight slices: E5-0 small, E5-1 medium, E5-2 large (the versioned draw, the post-pass and the traced golden moves),
E5-3 small, E5-4 large (eight consumer seams and sixteen registry rows), E5-5 medium-large, E5-6 medium, E5-7 small.
About the size of G1-2 to G1-4 plus a UI round. Push-back flag: E5-4 could split (four consumers each) if its builder
runs long; the split line is after the refine, research, craft and build seams.

## Open questions for the controller (not answerable from the docs)

1. **Evacuation place names.** The mockup shows named planets ("Sabine Reach", "Calder's Rest") as the origin and the
   "Evacuate [planet]" label, but short-range destinations are placeholder designations ("Body II, desert world") until
   charted planets join (call 12). The plan uses the existing surface list; a named list would be a new game entity
   the user has not named.
2. **Stamp offset** (`nextCycle + 1`) keeps every visible preview and every in-flight job; a stricter reading of
   "upcoming draws" would need a larger offset. [PROPOSAL] as written.
3. **Scan range as a percent**: the telescope's range is tiered today; E5-0 confirms that a continuous range is safe
   for its consumers, or brings an alternative stat for the Stargazer to the user.

## USER ANSWERS (2026-11-02): E5-0 study calls

- Refiner (Refinery): "Extra output (Recommended)": a chance for each finished batch to yield extra refined goods,
  instead of a speed boost (speed under ~5% is swallowed by tick rounding at levels 1 to 3).
- Stargazer (Subspace Telescope): "Rare-aspect spotting (Recommended)": raise the chance to spot rare planet aspects
  (the same lever Deep Field Refinement improves), instead of a percent scan range (which only touched edge systems
  and was display-only).

## E5-2 provisional items for the balance/polish pass (hub, 2026-11-03)

Evacuation uses the "home" icon and Relocation's pay row; job line "N people to bring out of {dest}"; the Help topic
gained one Evacuation job line; the no-arrival line uses placeholder destinations (as short-range does today); taper
K = 4 [PROPOSAL]. Review minor (accepted, corrupted saves only): a malformed stamp is dropped, so that save's slots
move to the v2 draw.

## Short-range fleet parity fix (137c5b4, 2026-11-03)

Root cause: tick.ts ran each captain's whole multi-tick call in captain order, so cycle starts missed later captains'
earlier deliveries. Fixed with run generators served in (tick, captain, instant) order (tickShortRangeFleet).
Production only calls economyTick with delta <= 1 (review-verified), so no player trajectory changed and no stamp was
needed. Known test-only gaps (multi-tick calls only, never production): a non-short-range captain listed between
short-range runs draws credits/berths after both; another run's income reaches a departure gate only up to that run's
own draw when credits are tight; record key order differs by path (values equal).
