# Ground Operations (0.14.0, D25) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task
> (the user's standing workflow: fresh subagent per task, two-stage review per task, holistic review at the end).
> superpowers:executing-plans is the fallback for a separate session.

**Goal:** Turn the expedition's ground phase into GROUND OPERATIONS: per-ship ground teams (a slotted Security squad +
a slotted Science squad each), per-planet task queues with a default plan, tasks as progress bars with fight points
whose progress persists across wipes, a return trip after every task (offload, medical bay, reload), a display-only
threat indicator, and ship-side scan events in place of the scan-time ground battles.

**Architecture:** A run stays a PURE function of its stored Expedition record. New runs carry a `groundOps` record
(its presence is the feature flag, like `encounterSteps`); runs launched before it resolve on the legacy path,
byte-identical. The activities phase of a flagged run becomes an event schedule of per-team timelines (deploy, work,
fight, return, offload, bay, reload), advanced step by step in (end time, team index) order from stored values only,
so one big offline advance equals many small live ones. Every roll comes from a private keyed stream (`makeRng(seed ^
SALT ^ key)`); nothing draws on a shared stream. Live queue edits first advance the run to "now", then mutate the
stored queue. One SAVE_VERSION bump (66 -> 67) adds the per-ship ground-team slot state.

**Tech Stack:** Svelte 5 (legacy mode) + TypeScript, Vitest. Engine in `src/lib/game/*.ts` (pure), UI in `src/lib/*.svelte`
+ `src/App.svelte` handlers.

**Sources (authority order: user decisions > design > code):**
- `docs/plans/2026-10-09-ground-operations-design.md`, especially section 9b (user answers 1 to 7, 2026-10-09).
- `docs/plans/2026-10-02-crew-made-real-e-crew-design.md` D18 to D26 (D24 injury/recovery, D25 ground teams, D26 Ground
  Ops items, D23 diminishing returns, D13 officers never act on ground-team stats).
- `docs/plans/2026-10-02-crew-made-real-e-crew-plan.md`: standing rules, carry notes of Tasks 14 to 22, Tasks 16b,
  17, 18, the G-list + BUILD ORDER (Ground Ops is item 1, then Field Kits 16b), Task 35 release gate.
- Mockup: **Ground Operations** https://claude.ai/artifact/RmbGiWspWHUEaRGnGDz6LR (sections 1 to 4 referenced as GO-M1..M4).
  Whole-build mockup: https://claude.ai/artifact/UYTkL2q9PyDHKGbeERcvuj (E-CREW, referenced as EC-M).

---

## 0. Standing rules (inherited from the E-CREW plan, apply to every task)

- **Gate** after every task: `npm run check` (0 ERRORS; the 2 known RadialWeb warnings are fine) and `npx vitest run`
  (all files pass). A task is not done until both are green.
- **Legacy-neutral:** a run WITHOUT `groundOps` (any run dispatched before GO-7) advances, resolves and claims
  byte-identically. Pin it with golden hashes captured BEFORE the change (the Task 20 / 21 precedent), in the same
  commit that changes the engine.
- **Determinism:** randomness only via `makeRng((seed ^ SALT ^ key) >>> 0)`; never `Math.random`, never `Date.now()`
  in engine code; never add a draw to a SHARED stream (the economy stream, a battle stream another roll reads). New
  salts are odd, distinct from every salt in `expedition.ts` and `gambit.ts`; GO-4 adds a test listing them all.
- **Mutation pattern:** UI handler `do*` in `src/App.svelte` calls a pure engine fn, then `state = next`, `pushLog`,
  `doSave`, with a same-ref guard (`if (next === state) return`).
- **Text rules:** US English; no em dashes and no "--" anywhere (text, comments, code: write `i -= 1`, never a
  decrement operator); "install", never "fit/fitting/fitment". Graphics are SVG glyphs in `src/lib/ui/icons.ts`,
  classified in `src/lib/ui/iconPacks.ts` `ICON_SEMANTICS`, reviewed at 16 / 28 / 56 px. No emoji in new UI.
- **Responsive:** one DOM, container queries; no isMobile branch; 375 px with no horizontal page scroll.
- **Explicit actions:** a `<select>` never acts on change (WCAG 3.2.2, the AwayTeamPanel posture): pick, then a button.
- **Commits:** one per task, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push
  the branch; dev deploys are the controller's call (`git push origin feat/crew-0.14.0:staging`, ONE command).
- **No dead stats:** `no-dead-stats.test.ts` fails while a LIVE key stays in `PENDING_IN_RELEASE`. The task that makes
  a Ground Ops entry live removes it in the same commit (GO-7b, GO-9; table in section 3).
- **[PROVISIONAL]** marks a first-pass value or behavior this plan had to pick so the build stays green while an open
  question (section 5) waits on the user. Each lives in ONE named constant or function so the answer is a one-line
  change. Do not present a PROVISIONAL behavior to the user as decided.

---

## 1. What this plan supersedes (call out in each affected commit body)

| Existing item | Superseded by | Notes |
|---|---|---|
| E-CREW Task 14: scan-step ground-battle encounters (`resolveScanEncounter`), the loss pause "until the next activity window", scan-time downs | GO-8 ship-side events | The keyed step roll, its timing, `scanStepCursor`, `scanEvents` and the supply cache STAY (user 9b.6). Legacy runs keep the old battles. |
| Task 21 Security Cunning "softens scan ambushes" (`Expedition.ambushSoften` -> `softenAmbush` on ground enemies) | GO-8: softens the hostile probe | Also resolves a D13 tension (an officer stat reached a ground battle). |
| Task 16 "a downed member sits out the rest of the RUN" (`scanDownedBefore` / `activityDownedBefore`) | GO-7: rest of the TASK; healed in the bay | Legacy runs keep it. |
| `MAX_BATTLE_ATTEMPTS` in-resolution retries + the 40% evacuation haul (`EVAC_REWARD_FRACTION`, `evacuatedResolution`) | GO-7: progress persists, retry after the bay | Legacy runs keep it. |
| Task 16 flat 2h injury on claim; D24 "clock starts at run end"; D24 recovery formula 2h / (1 + care), floor 15m | GO-3 + GO-7: per-condition bay times during the run, frozen medical factors, remainder carried home | Legacy runs keep `applyExpeditionInjuries`. Closes the Task 20 OPEN line "D24's freeze medical factors at dispatch is still a live read at claim". |
| Ground Ops design section 6 "Team A stands scan watch" + open call 6 | moot | 9b.6 removed ground fights from scanning. |
| E-CREW design 5.5 / D10 "ground battles are random encounters during scan progress" | 9b.6 + GO-8 | |
| Dispatch = "first N ready members in hire order" (`deployableMembers` in `snapshotAwayRoster` / `expeditionAwayTeamCheck`) | GO-2 / GO-7a: slotted ready members per ground team | `deployableMembers` stays for legacy readers. |
| Task 17 (scan track pips, encounter dial readout, log lines, per-member gambit editor, Science tab removal) | GO-14, GO-15, GO-16 | Task 17 is fully absorbed. |
| Task 18 (squad loadouts per team TYPE, `memberRole?` question, roster-linked loadout S4-CP39) | GO-17 (per GROUND TEAM) | S4-CP39 wiring carried into GO-17 so Task 18 retires. |
| Task 16b step 4 "Squad Kit ... saved with Squad Loadouts (Task 18)" and step 5 "Injury Kit shortens recovery (Task 16 hook)" | GO-17 loadout kit slot; GO-3 per-member bay `treatmentShare` hook | 16b still owns the kits themselves. |
| Task 6 AwayTeamPanel header copy ("Security fights the random battles, Science does fieldwork while scanning") | GO-11 | |
| E4b `relics.ts resistedHazard` hard clamp of the summed hazard resist at `MUSEUM_HAZARD_RESIST_MAX` (0.75) | GO-5: `effectiveHazardResist` = 0.75 x tanh(raw / 0.75), approaching the cap and never reaching it (user 2026-10-12, D23 "Hazard resist exception") | Every run, legacy included (scan rate, scan encounter odds, battle guards, task work): the user's ruling, the one deliberate exception to legacy-neutral. Pure, so offline == live parity holds; an in-flight run with a resist reads the curve for whatever it has not yet resolved (scan time still to come, steps not yet rolled). No-resist runs are bit-identical. |

Carried to **Task 16b (Field Kits)**, not built here: the Stoneskin IN-BATTLE half (physical conditions land 25% less
often, last 25% longer; D24), since Fracture / Hemorrhage / Concussion arrive with 16b and only Bleed exists today. GO-3
builds the BAY half (x1.25 on injury cure times) and the member perk hook both halves use.

---

## 2. Data model (all of it, so tasks can reference it)

```ts
// == model.ts: per-ship slot state (persisted; SAVE v67) ==
export interface ShipGroundTeam {
  name?: string;                    // custom name; absent = default by index (GROUND_TEAM_DEFAULT_NAMES)
  security: (string | null)[];      // member id per slot; length = the hull's Security squad size
  science: (string | null)[];       // length = the hull's Science squad size
  helpOthers: boolean;              // "When done, help other teams" default for the next dispatch
}
ShipInstance.groundTeams?: ShipGroundTeam[];   // length = groundTeamCount(typeKey); v67 backfills every ship

// == model.ts: Squad Loadouts reshaped per ground team (Task 18 was never built; squadLoadouts is always []) ==
export interface GroundTeamLoadout {
  id: string; name: string;
  security: SquadLoadoutKit[];      // one kit per Security slot, slot order
  science: SquadLoadoutKit[];
  checkedOutTo: { shipId: string; teamIndex: number } | null;
}
GameState.squadLoadouts: GroundTeamLoadout[];  // v67 coerces any stored value to [] (none can exist)

// == model.ts: the snapshot gains the member's physical perks (Stoneskin), frozen at dispatch ==
SnapshotMember.perks?: MemberPerkId[];         // absent = none; "stoneskin" for Ossir (GO-3)

// == model.ts: task fields, OPTIONAL on ExpeditionActivity (absent on legacy runs) ==
ExpeditionActivity.requiredTeams?: number;     // default 1; content may ask for 2+
ExpeditionActivity.fightPoints?: number[];     // ascending fractions in (0, 1)
ExpeditionActivity.progress?: number;          // 0..1, persists across losses
ExpeditionActivity.pointsCleared?: number;     // fights won; the next fight is fightPoints[pointsCleared]
ExpeditionActivity.segmentsBanked?: number;    // segments finished (haul earned), 0..fightPoints.length + 1
ExpeditionActivity.segmentsOffloaded?: number; // segments already offloaded into exp.findings
ExpeditionActivity.fightCount?: number;        // fights started on this task (keys "a fresh encounter per attempt")
ExpeditionActivity.status?: "queued" | "active" | "done" | "skipped";
ExpeditionActivity.assignedTeamIds?: number[]; // owner team index(es)
// `done` stays the completion flag and mirrors status === "done".

// == model.ts: the run's ground operations record; PRESENCE = the feature flag ==
Expedition.groundOps?: GroundOpsState;
export interface GroundOpsState {
  version: 1;
  teams: GroundTeamRun[];           // deployed teams only, ascending ship team index
  factors: GroundOpsFactors;        // frozen at dispatch
  shipEventProfile: ShipEventProfile; // frozen at dispatch (GO-8)
  startedAt?: number;               // gameTimeSeconds the activities phase began (set at the phase boundary)
  endedAt?: number;                 // set once every task is done/skipped and every team is aboard
  editCount: number;                // player edits so far (keys the auto-assign stream)
  history: GroundStepRecord[];      // DISPLAY ONLY, capped (GROUND_HISTORY_CAP per team); resolution never reads it
}
export interface GroundTeamRun {
  index: number;                    // ship team index (0 = Alpha); the name is read live from the ship
  securityIds: string[]; scienceIds: string[]; // members of exp.roster (the union snapshot)
  helpOthers: boolean;
  queue: string[];                  // own ordered task (activity) ids
  step: GroundStepKind; stepStartedAt: number; stepEndsAt: number | null; // null = open-ended (idle, staging)
  taskId?: string; borrowed?: boolean;
  workFrom?: number; workTo?: number;           // progress span of the current work step
  pendingFight?: GroundFightRecord;             // resolved at fight start, applied at fight end
  skippedBorrowed: string[];                    // a helper's give-up list (never re-borrowed)
  downedThisTask: string[];                     // Security members out for the rest of the current task
  conditions: Record<string, string[]>;         // memberId -> condition ids gathered on the current trip
  bayEnds: Record<string, number>;              // memberId -> absolute bay end of the latest bay (carried home)
  bayStart?: number;
}
export type GroundStepKind = "idle" | "staging" | "deploy" | "work" | "fight" | "return" | "offload" | "bay" | "reload";
export interface GroundOpsFactors {
  medicalShare: number; rapidRecoveryShare: number;   // crew.reducedCrewLosses, officer.repairRateMult at dispatch
  officerFacetShare: number;                          // recoveryTurnaround + quickRecovery (all conditions)
  injurySteady: number;                               // Medical Integrity (injury-class conditions only)
  offloadMult: number;                                // effectiveShipStats(...).unloadSpeedMult at dispatch (>= 1 faster)
  reloadMult: number;                                 // 1 + crew.loadSpeed + logistics4 (captain secondary talent)
  securityShare: number[]; scienceShare: number[];    // per team: its share of the crew layers (see GO-7a)
}
```

`ExpeditionScanEvent` gains (GO-8): `kind: "shipEvent"`, `event: "debris" | "probe" | "ghost" | "cloaked" | "storm"`,
`outcome: "pass" | "fail" | "win" | "loss"`, `bonusDiscovery?: true`, `hullWear?: number`, `boarding?: { repelled:
boolean }`, reusing `pauseSeconds` and `findingId`.

Module graph (no cycles): `groundTeams.ts` (model, awayTeam) <- `medicalBay.ts` (model, crewRaces) <- `groundTasks.ts`
(model, fieldwork, relics) <- `groundFight.ts` (gambit) <- `groundThreat.ts` (groundFight, combat/threatAssessment) <-
`groundOps.ts` (all of the above) <- `expedition.ts`. `shipScanEvents.ts` (combat/*, gambit rollHaul) <- `expedition.ts`.
**`groundOps.ts` and `shipScanEvents.ts` never import `expedition.ts`**; expedition passes in what they need
(hours since dispatch, the reward seed helpers).

---

## 3. no-dead-stats entries Ground Operations owns

| Entry | Goes live in | How the test sees it |
|---|---|---|
| `crew:crew.loadSpeed` (Rapid Loadout; FA talent logistics4 targets the same stat) | GO-7b | reload step length -> the run's timeline (task start times, `endedAt`) |
| `gear:security:assaultHardsuit:groundHazardResist` | GO-7b | task work time on a hazardous body |
| `crew:crew.boardingDefense` | GO-9 | boarding repel outcome -> scan pause / scan end time |
| `racial:ossir` | GO-9 | same consumer (the racial targets crew.boardingDefense) |
| `facet:tactical:strength` (reason names boarding) | GO-9 if it turns live there (Strength scales the Security division's Boarding Defense); otherwise leave it to Task 23 and update its reason text | the test tells you: it fails "now LIVE, remove the entry" |

GO-7b also re-points the test's expedition probes ("a full run + claim", "injury recovery") at the Ground Ops path:
`crew.reducedCrewLosses`, Rapid Recovery, `facet:medical:*` must stay LIVE through the bay (fingerprint the timeline
and the claimed injuries, never the frozen `factors`).

---

## 4. Tasks

Order keeps the build green after every task: data + pure modules first, the engine switch (GO-7b) only when every
piece it calls exists, then scan events, then UI. Mockup-bearing UI tasks come last so the engine is QA-able first.

### GO-0 (recommended chore, Task 34b pulled forward): consolidate SAVE_VERSION pins

`save.test.ts` pins `toBe(66)` 39 times. Do Task 34b now (ONE canonical pin; per-migration blocks assert migrated
fields and use the imported `SAVE_VERSION` for "current") so GO-1's bump edits one line. Behavior-neutral; separate
commit `chore(0.14.0): one SAVE_VERSION pin (Task 34b)`. The controller may skip it and edit the pins in GO-1 instead.

**Carry from GO-0 (built 2026-10-12, commit `chore(0.14.0): consolidate SAVE_VERSION pins (GO-0)`):** the ONE literal
pin is the top `describe("SAVE_VERSION")` block of `save.test.ts`; a bump edits that line only. Removed: 24 per-describe
`it("SAVE_VERSION is pinned ...")` blocks (including `it("SAVE_VERSION is 66")` in the v65 -> v66 block), 9 inline
`expect(SAVE_VERSION).toBe(66)` / duplicate `.version).toBe(66)` lines, and the stray pin in `injuries.test.ts`;
6 `.version).toBe(66)` lines now read `.toBe(SAVE_VERSION)`. Test count 4019 -> 3996 (23 fewer duplicate pins), no
behavior change. Also closes E-CREW Task 34b.

---

### Stage A: Ground teams (data + slotting)

### GO-1: Ground-team data model + SAVE v67

**Files:**
- Modify: `src/lib/game/model.ts` (types of section 2; `freshState` gives the starting ship its `groundTeams`)
- Create: `src/lib/game/groundTeams.ts` (pure helpers)
- Modify: `src/lib/game/save.ts` (`SAVE_VERSION` 66 -> 67; `MIGRATIONS[66]`)
- Test: `src/lib/game/groundTeams.test.ts` (new), `src/lib/game/save.test.ts` (append)

**Behavior (groundTeams.ts):**
```ts
export const GROUND_TEAM_DEFAULT_NAMES = ["Alpha", "Bravo", "Charlie"] as const; // user 9b.7
export function groundTeamCount(typeKey: ShipTypeKey): number        // the Security entry's `count` (1:1 with Science); 0 if absent
export function groundSquadSize(typeKey: ShipTypeKey, teamType: "security" | "science"): number // the entry's `size`
export function emptyGroundTeams(typeKey: ShipTypeKey): ShipGroundTeam[]   // count teams, null-filled slots, helpOthers false
export function groundTeamName(ship: ShipInstance, index: number): string  // custom name, else default, else "Team N" [PROVISIONAL]
export function groundTeamShortLabel(index: number): string                // "A" / "B" / "C", by INDEX even after a rename [PROVISIONAL]
export function shipGroundTeams(ship: ShipInstance): ShipGroundTeam[]      // stored value, else emptyGroundTeams (absent-safe reader)
```
**Migration `MIGRATIONS[66]`:** for every ship, if `groundTeams` is not a well-formed array, build `emptyGroundTeams` and
fill team 0 (then team 1, ...) Security / Science slots with that ship's members of the matching `teamType`, in HIRE
order (the same `idNumber` order `deployableMembers` uses, ignoring injury: an injured member stays slotted and simply
does not deploy while injured), up to each squad's size; overflow members stay aboard unslotted. This reproduces
today's "first N members in hire order". `squadLoadouts`: keep if an array of well-formed `GroundTeamLoadout`, else
`[]` (no build ever created a squad loadout). Plain data only; idempotent (a second pass keeps well-formed values).

**Tests:**
- `groundTeamCount` is 1 on every SHIP_TYPES hull today; a synthetic hull with `count: 3` gives 3 teams with the
  entry's sizes; a hull missing `awayTeams` gives 0.
- Names: index 0/1/2 -> Alpha/Bravo/Charlie; a custom name wins; short labels A/B/C by index.
- v66 fixture with a ship holding 4 Security (size 3) + 2 Science members, one injured: migrates to slots holding
  the first 3 Security by hire order (injured included) and both Science; the 4th Security stays unslotted.
- Migrating twice is idempotent; JSON round-trip keeps `groundTeams`; `freshState()` has well-formed teams.

**Determinism:** no randomness. **Acceptance:** gate green; no engine reads `groundTeams` yet (behavior-neutral).
Commit `feat(0.14.0): ground team slot state + save v67 (Ground Ops GO-1)`.

**Carry from GO-1 (built 2026-10-12, commit `feat(0.14.0): ground-team data model + SAVE v67 (GO-1)`; GO-0 = `4477337`):**
- Added ONLY the persisted part of section 2: `ShipGroundTeam`, `ShipInstance.groundTeams?`, and `GroundTeamLoadout`
  (replaces the never-built Task 2 `SquadLoadout`; `SquadLoadoutKit` unchanged, GO-17 adds `consumables?`). The run-side
  types (`SnapshotMember.perks`, the `ExpeditionActivity` task fields, `GroundOpsState` and friends) are all optional on
  stored records, so they land with GO-3 / GO-4 / GO-7a / GO-7b with no save bump.
- `groundTeamCount` / `groundSquadSize` / `emptyGroundTeams` LIVE IN `model.ts` (freshState needs them and model.ts
  must not import groundTeams.ts); `groundTeams.ts` re-exports them. Count = the FIRST Security entry's `count`, size =
  the first matching entry's `size` (every hull lists one of each). `groundTeams.ts` also holds the migration helpers
  `backfillShipGroundTeams(ship, members)`, `isWellFormedShipGroundTeams(value, typeKey)` (shape only: hull-sized slot
  lists, boolean help, optional string name; it does NOT check that ids name members aboard, that is GO-2's invariant)
  and `isWellFormedGroundTeamLoadout`. `awayTeam.ts byIdNumber` is now exported (the one hire order).
- `groundTeamName`: a blank custom name reads as the default; past Charlie "Team N". `groundTeamShortLabel`: A..Z by
  index, then the number [PROVISIONAL, Q15].
- `MIGRATIONS[66]` (SAVE 67): a ship whose `groundTeams` is not well-formed for its hull is backfilled by hire order
  (injured members included, overflow unslotted); `squadLoadouts` is kept only if EVERY entry is a well-formed
  GroundTeamLoadout, else `[]`. Hardened (non-array ships pass through, malformed ship entries untouched, non-array
  awayMembers = no members). Proven byte-identical: a migrated save equals the no-step load except `groundTeams`, and
  its in-flight run, claim and an hour of `tick` serialize identically.
- Ships minted after v67 (shipBuild completion and the captain-unlock grant in `tick.ts`) are NOT seeded; they read as
  empty teams through `shipGroundTeams`. **For GO-2 / GO-7b:** a member hired or reassigned onto a ship on a GO-1 build
  (before GO-2's hire auto-slot) is aboard but UNSLOTTED. GO-7b switches dispatch to slots before GO-11 ships the
  slotting UI, so a staging save from that window could be unable to dispatch. GO-2 should decide: an every-load,
  no-bump reconcile that auto-slots unslotted members into empty slots (hire order), or accept it as staging-only.
- Test support: `awayTeamTestFixtures.ts` gains `registerSyntheticHull(key, awayTeams)` (returns its cleanup; GO-7c's
  3-team fixture) and `withoutGroundTeams(state)`. The whole-state golden hashes in `officerBonuses.test.ts` and
  `officerStatFacets.test.ts` now hash through `withoutGroundTeams`; their golden VALUES are unchanged (still the
  pre-Task-20 / pre-Task-21 captures), which is the proof nothing else moved. Two old-shape `squadLoadouts` fixtures in
  the v64 -> v65 block of `save.test.ts` were rewritten to the GroundTeamLoadout shape (the full chain now runs v67).
- Tests: `groundTeams.test.ts` (16) + the v66 -> v67 block in `save.test.ts` (9). Suite 3996 -> 4021 passed.

### GO-2: Slotting engine + crew-action sync

**Files:** `src/lib/game/groundTeams.ts`, `src/lib/game/awayTeam.ts` (hire / fire / reassign), `src/lib/game/salvage.ts`
(bench on salvage, if it benches members; else leave a TODO pointing at Task 27), test `groundTeams.test.ts`.

**Behavior:**
```ts
export type GroundSlotBlockReason = "noShip" | "noMember" | "onMission" | "wrongShip" | "wrongTeamType" | "noSuchSlot" | "noSuchTeam";
export function canSlotMember(state, shipId, teamIndex, teamType, slotIndex, memberId): { ok: true } | { ok: false; reason: GroundSlotBlockReason }
export function slotMember(state, shipId, teamIndex, teamType, slotIndex, memberId): GameState  // moves the member out of any other slot first; an occupant is unslotted (stays aboard)
export function unslotMember(state, shipId, memberId): GameState
export function renameGroundTeam(state, shipId, teamIndex, name: string | null): GameState     // trimmed, max 24 chars, "" or null clears; allowed while on a mission (cosmetic) [PROVISIONAL]
export function setGroundTeamHelp(state, shipId, teamIndex, on: boolean): GameState            // the ship default for the next dispatch
export function groundSlotBlockText(reason: GroundSlotBlockReason): string                     // exhaustive switch, no default
export function deployableGroundTeams(state, ship): { index: number; security: AwayMember[]; science: AwayMember[] }[]
// slotted members who are ready (isMemberReady), slot order; a team deploys only with >= MIN_SECURITY_MEMBERS
// Security AND >= MIN_SCIENCE_MEMBERS Science (D18 per team). Teams that miss it are left out.
```
Every slot change refuses while `shipCrewLocked(state, shipId)` (except rename). Sync: `hireAwayMember` auto-slots the
new member into the FIRST empty slot of the matching squad, lowest team index first (QoL: set-and-forget); `fireAwayMember`
and `reassignAwayMember` unslot first; benching (assignedShipId null) unslots.

**Tests:** invariant helper `assertSlotInvariants(state)` (a member sits in at most one slot fleet-wide; a slot only
holds a member aboard that ship with the matching team type; slot array lengths equal the hull sizes) run after every
action in the file; hire auto-slots; a full team leaves the hire unslotted (aboard, reserve); fire / reassign leave no
dangling id; slotting onto an occupied slot unslots the occupant; on-mission refuses with the same state reference;
`deployableGroundTeams` skips an injured slotted member and drops a team with no ready Science member.

**Acceptance:** gate green; dispatch unchanged (still `deployableMembers`). Commit
`feat(0.14.0): ground team slotting engine (Ground Ops GO-2)`.

**Carry from GO-2 (built 2026-10-12, commit `feat(0.14.0): ground-team slotting engine + crew sync (GO-2)`):**
- **New module `groundTeamSlots.ts`** (imports model.ts ONLY): `shipGroundTeams`, `findGroundSlot`,
  `firstEmptyGroundSlot`, `shipsWithMemberAutoSlotted`, `shipsWithMemberUnslotted`, `GroundSquadType` /
  `GROUND_SQUAD_TYPES` / `isGroundSquadType`. It exists so awayTeam.ts can sync slots without a cycle
  (groundTeams.ts imports awayTeam.ts). Graph: model <- groundTeamSlots <- awayTeam <- groundTeams; groundTeams.ts
  re-exports all of it, so callers import from groundTeams.ts.
- **`shipGroundTeams` now returns a NORMALIZED COPY** (GO-1 review): exactly `groundTeamCount` teams, slot lists sized
  to the hull (extra dropped, missing null, non-string ids null), boolean help, string name only. Fresh arrays every
  call; "never mutate the result" is documented. Every action edits a copy and writes it onto a new ship object, so a
  ship minted after v67 (no field) gets its teams on its first slot write.
- **Actions (groundTeams.ts), each with a same-ref guard on refusal / no-op:** `canSlotMember` / `slotMember` (moves
  the member out of any slot first; an occupant goes to the reserve), `canUnslotMember` / `unslotMember`,
  `canSwapGroundMembers` / `swapGroundMembers` (same ship, same team type, at least one slotted; works across teams;
  a reserve member swapped with a slotted one takes the slot), `renameGroundTeam` (trimmed, `GROUND_TEAM_NAME_MAX` 24
  [PROVISIONAL]; blank, null or the team's own default name clears it), `setGroundTeamHelp`. Reasons
  (`GroundSlotBlockReason`, exhaustive `groundSlotBlockText`): noShip, onMission (the crew lock: the ship is out, its
  members busy on the run), noSuchTeam, noSuchSlot, noMember, wrongShip, wrongTeamType, alreadyThere, notSlotted.
- **[PROVISIONAL] deviation:** rename AND the help toggle are allowed while the ship is out (the plan exempted only
  rename). The help toggle is the ship default for the NEXT dispatch and touches no slot or live run. One-line change in
  `setGroundTeamHelp` if the user wants it locked.
- **Crew sync (awayTeam.ts):** `hireAwayMember` and `reassignAwayMember` (a move or an unbench) AUTO-SLOT on arrival
  into the first empty slot of the member's squad, lowest team first; `fireAwayMember`, `reassignAwayMember` (away or
  bench) unslot first. No every-load reconcile (it would undo a deliberate unslot). **The hire cap stays**
  (`squadGate` at `squadSlots`): a ship's reserve exists only by a deliberate unslot (or a pre-GO-2 save), and the
  Task 27 Reserve list is the BENCHED members (`assignedShipId === null`); moving a member between ships is reassign +
  auto-slot. Salvage does not bench members yet: the hull's slots leave with it (TODO in `salvage.ts` for Task 27).
- **Accepted as staging-only (controller ruling):** a member hired or reassigned on a GO-1 build sits aboard UNSLOTTED.
  Until GO-11 ships the slotting UI, the only fix is to move them away and back (reassign auto-slots). GO-7b switches
  dispatch to slots, so a staging save from that window can be unable to dispatch until the player re-slots.
- **The deployable reader** `deployableGroundTeams(state, shipId): GroundDeployCheck` (NO automatic stand-ins, user
  2026-10-12): `{ ok, reason?: "noShip" | "noGroundTeams" | "noTeamReady", teams: GroundTeamReadiness[], security,
  science, readyAtSeconds }`. Per team: `{ index, name, security, science (slotted members, slot order), staffed,
  deploys, waits, readyAtSeconds }`; a `GroundTeamWait` is `injured` (memberId, memberName, teamType, readyAtSeconds,
  secondsLeft) or `needSecurity` / `needScience` (fewer than `MIN_SECURITY_MEMBERS` / `MIN_SCIENCE_MEMBERS` slotted:
  D18 per team). A team deploys only when every slotted member is ready AND each squad meets D18; a ready RESERVE
  member never stands in. The ship is ok when at least one team deploys and the deploying teams meet D18 in total.
  `readyAtSeconds`: per team, the last injured member's return (null when it needs the player to slot someone); per
  ship, the soonest team. The crew lock is NOT part of the reader (dispatch has its own gates). UI-free formatters:
  `groundTeamWaitText` ("Grokk returns to duty in 12m") and `groundDeployBlockText(check, now)`. Dispatch still reads
  `deployableMembers` (a test pins it: an unslotted ready member still counts for the legacy gate).
- `MIN_SECURITY_MEMBERS` / `MIN_SCIENCE_MEMBERS` moved to groundTeams.ts (expedition.ts imports and re-exports them).
  `awayTeamDisplay.ts awayCountdownText` now delegates to the new `format.ts formatCountdown` (the one seconds
  countdown, shared with the wait text).
- **For GO-7a / GO-7b:** `awayTeamTestFixtures.ts withMinimumAwayTeam` adds members WITHOUT slotting them; when dispatch
  switches to slots, route it through the slot sync (or slot the pair) so every dispatching test keeps testing what it
  tested. "Busy" today means only the ship lock; a future per-member busy state (training, another run) would be a new
  `GroundTeamWait` kind.
- Removed the duplicate `roundTripped!.version` assertion in `save.test.ts` (GO-1 review minor).
- Tests: `groundTeams.test.ts` 16 -> 58 (the `assertSlotInvariants` helper runs after every action). Suite 4021 -> 4063
  passed; `npm run check` 0 errors.

---

### Stage B: Pure building blocks (no engine switch yet)

### GO-3: Medical bay math + member perks (Stoneskin bay half)

**Files:** Create `src/lib/game/medicalBay.ts`, test `medicalBay.test.ts`; modify `src/lib/game/awayTeam.ts`
(`snapshotMember` writes `perks` for Ossir), `src/lib/game/model.ts` (`MemberPerkId = "stoneskin"`).

**Behavior:**
```ts
export type ConditionClass = "health" | "ailment" | "injury";
export interface GroundConditionDef { id: string; label: string; cls: ConditionClass; cureSeconds: number }
// User 9b.5 approved times (1 tick = 1 second). Class per D24's physical list; see open question Q6.
export const GROUND_CONDITIONS: Readonly<Record<string, GroundConditionDef>> = {
  health:     { id: "health",     label: "Health",     cls: "health",  cureSeconds: 60 },
  poison:     { id: "poison",     label: "Poison",     cls: "ailment", cureSeconds: 60 },
  bleed:      { id: "bleed",      label: "Bleed",      cls: "injury",  cureSeconds: 60 },   // D24 lists Bleed as physical [PROVISIONAL class]
  blindness:  { id: "blindness",  label: "Blindness",  cls: "ailment", cureSeconds: 60 },   // arrives with 16b [PROVISIONAL class]
  neurotoxin: { id: "neurotoxin", label: "Neurotoxin", cls: "ailment", cureSeconds: 300 },  // 16b
  hemorrhage: { id: "hemorrhage", label: "Hemorrhage", cls: "injury",  cureSeconds: 300 },  // 16b
  concussion: { id: "concussion", label: "Concussion", cls: "injury",  cureSeconds: 900 },  // 16b
  fracture:   { id: "fracture",   label: "Fracture",   cls: "injury",  cureSeconds: 1800 }, // 16b
  downed:     { id: "downed",     label: "Downed",     cls: "injury",  cureSeconds: 1200 }, // D9: a downed member is injured [PROVISIONAL class]
};
// Battle statuses NOT in this table (stun, weakened, suppressed, corroded, fear, buffs) end with the battle [PROVISIONAL, Q6].
export const STONESKIN_INJURY_MULT = 1.25;          // D24, user
export const BAY_MIN_SECONDS = 1;                   // D23 style floor [PROVISIONAL, Q8]
export interface BayCare { medicalShare: number; rapidRecoveryShare: number; officerFacetShare: number; injurySteady: number }
export function conditionCureSeconds(cond: GroundConditionDef, perks: readonly MemberPerkId[], care: BayCare, treatmentShare = 0): number
//   care_c = medicalShare + rapidRecoveryShare + officerFacetShare + treatmentShare (+ injurySteady when cls === "injury"), each clamped >= 0
//   t = cureSeconds * (cls === "injury" && perks has stoneskin ? 1.25 : 1) / (1 + care_c); max(BAY_MIN_SECONDS, round(t))
export function memberBaySeconds(conditionIds: readonly string[], perks, care, treatmentShare = 0): number  // the LONGEST of its conditions; 0 for none
export function teamBaySeconds(members: { conditionIds: string[]; perks: MemberPerkId[]; treatmentShare?: number }[], care): number // the longest member (user: "you wait for 10 ticks")
export function memberPerksFor(race: CrewRace): MemberPerkId[]      // ossir -> ["stoneskin"]; others [] (the user names other races' perks later)
```
`treatmentShare` is the Injury Kit hook (Task 16b step 5); always 0 here.

**Tests:** the mockup's bay (GO-M4): Health 60, Poison 60, Fracture on an Ossir member 2250, Concussion 900 -> team bay
2250 with zero care; "1000 ailments and 1 fracture" takes the fracture's time; Stoneskin touches injuries only (Poison
on an Ossir member stays 60); `injurySteady` shortens injuries only; care divides (1 + 1 halves); unknown condition ids
are ignored (0); `snapshotMember` writes `perks: ["stoneskin"]` for an Ossir member and omits `perks` otherwise (so every
existing snapshot test stays deep-equal).

**Determinism:** pure arithmetic. **Acceptance:** gate green; nothing calls it yet. Commit
`feat(0.14.0): medical bay cure-time math + Stoneskin bay half (Ground Ops GO-3)`.

**Carry from GO-3 (built 2026-10-12, commit `feat(0.14.0): medical bay cure-time math + Stoneskin bay half (Ground Ops GO-3)`):**
- **`medicalBay.ts`** (imports model.ts TYPES only) as specified: `ConditionClass`, `GroundConditionDef`,
  `GROUND_CONDITIONS` (9 rows, the [PROVISIONAL, Q6] classes marked; lookups are own-key only, so "toString" is
  never a condition), `STONESKIN_INJURY_MULT` 1.25 (injury class only), `BAY_MIN_SECONDS` 1 [PROVISIONAL, Q8],
  `BayCare`, `conditionCureSeconds`, `memberBaySeconds` (longest condition, unknown ids ignored, 0 for none),
  `teamBaySeconds` (longest member, per-member `treatmentShare`), `memberPerksFor` (ossir -> ["stoneskin"], a
  fresh array). `model.ts` gains `MemberPerkId = "stoneskin"` and `SnapshotMember.perks?`; `snapshotMember`
  writes `perks` ONLY when non-empty (Ossir), so every other snapshot is deep-equal to before (tested: an Ossir
  snapshot equals the human one minus `perks`). No golden moved. Module graph note: medicalBay.ts sits BELOW
  awayTeam.ts (awayTeam imports `memberPerksFor`; medicalBay imports model.ts types only), not above groundTeams.ts
  as section 2 drew it; no cycle.
- **BayCare mapping (written once, `bayCareFrom(ship, run)`; GO-7a freezes the two ship shares into
  `GroundOpsFactors`, GO-7b passes `bayCareFrom(factors, exp)` in):** `medicalShare` = crew.reducedCrewLosses
  (injuries.ts `shipInjuryFactors.medicalShare`); `rapidRecoveryShare` = officerBonusTotal(officer.repairRateMult);
  `officerFacetShare` = `exp.recoveryTurnaround` (Medical Constitution) + `exp.quickRecovery` (Medical Cunning),
  every class; `injurySteady` = `exp.injurySteady` (Medical Integrity), injury class only. A test pins that an
  injury-class condition with the legacy 2h base gives exactly `injuryRecoverySeconds` (same care divisor; only
  the per-condition base and the floor differ).
- **GO-2 review (b) folded in:** new `groundTeamSlots.ts cleanShipGroundTeams(ship, members)` (re-exported by
  groundTeams.ts with the `GroundSlotMember` type): the normalized copy with every slot id nulled that does not
  name a member aboard THIS ship with the slot's type, and any repeat of a member within the ship (first slot
  kept). EVERY write path starts from it: `shipsWithMemberAutoSlotted` / `shipsWithMemberUnslotted` now take a
  REQUIRED `members` argument (awayTeam.ts passes `state.awayMembers`), and `slotMember`, `unslotMember`,
  `swapGroundMembers`, `renameGroundTeam`, `setGroundTeamHelp` write through a local `writableTeams`. So a hire or
  reassign onto a ship with a corrupt slot fills that slot instead of leaving the member in the reserve. The
  same-ref no-ops are unchanged (a primitive that changes no slot returns the SAME ships, even over corrupt ids).
  `renameGroundTeam` cuts to `GROUND_TEAM_NAME_MAX` 24 CODE POINTS (`Array.from`, never splitting a surrogate
  pair) and clears on the team's own default name in any case ("ALPHA"); another team's default stays custom.
- **GO-3 review fix (`fix(0.14.0): ground-team gates read cleaned slots (GO-3 review)`):** the `can*` gates
  (`canSlotMember`, `canUnslotMember`, `canSwapGroundMembers`) read the same cleaned teams the writes edit, so a
  member held only in a corrupt slot reads `notSlotted` (same-ref refusal; `unslotMember` used to throw there) and
  a corrupt duplicate of a member in the target slot no longer reads `alreadyThere`. +3 tests (suite 4093).
- Tests: `medicalBay.test.ts` (20) + 7 in `groundTeams.test.ts`. Suite 4063 -> 4090 passed; `npm run check` 0 errors.
- **For GO-7b (suggestion, not decided):** the bay reads condition ids from `GroundTeamRun.conditions`; the
  natural recording is "health" for a member who ends a trip below full HP (Q5 carry damage) and "downed" for a
  member downed on the trip. Battle-only statuses may be recorded or not: the bay ignores ids it does not hold.

### GO-4: Ground task model (fight points, segments, work time) + salt registry

**Files:** Create `src/lib/game/groundTasks.ts`, tests `groundTasks.test.ts`, `salts.test.ts` (new: reads the exported
salt constants of expedition.ts, gambit.ts, groundTasks.ts and later groundOps.ts / shipScanEvents.ts; asserts all distinct
and odd); modify `gambit.ts` (export `rollHaul`, `REWARD_SALT`-keyed `taskRewardSeed(exp, flatIndex)` so legacy and Ground
Ops share ONE reward seed definition; legacy output unchanged).

**Behavior:**
```ts
// Fight points from the SITE'S THREAT (user 9b.2). FIRST-PASS TUNABLE counts (mockup GO-M2 values where shown).
export const FIGHT_POINTS_BY_POI: Readonly<Record<string, number>> = {
  mineralOutcrop: 1, caveNetwork: 2, ancientRuins: 2, xenoFloraBloom: 2,
  crashedShip: 3, geothermalChamber: 3, buriedVault: 3, derelictOutpost: 4, subterraneanCivilization: 4,
};
export const FIGHT_POINTS_DEFAULT = 2, FIGHT_POINTS_HAZARD_STEP = 0.6, FIGHT_POINTS_MAX = 5;
export function fightPointCount(poiId: string, hazard: number): number   // table (default 2) + 1 at hazard >= 0.6, clamped [1, 5]
export function fightPointFractions(n: number): number[]                 // evenly spaced k / (n + 1), k = 1..n (mockup GO-M4 shows 3 points)
export function segmentCount(task): number                                // fightPoints.length + 1
// Haul per finished segment: the task's FULL haul is rolled once (rollHaul(taskRewardSeed, planet, RAW hazard, yieldMult of
// the team(s) banking it)), then split exactly across segments: share(total, N, s) = floor(total*(s+1)/N) - floor(total*s/N).
export function segmentHaul(full: { materials: Record<string, number>; credits: number }, N: number, s: number)
// Work time (D25 + D26): the task's full work seconds for a team set on a body:
//   ACTIVITY_SECONDS / fieldworkSpeedMult(teamRun, planetType) * (1 + resistedHazard(hazard, museumResist + teamHazardResist) * TASK_HAZARD_PENALTY)
// teamRun = { roster: { security: [], science: teamScience }, scienceStrength: exp.scienceStrength * scienceShare } (fieldwork.ts readers, unchanged)
// teamHazardResist = fieldworkHazardResist(teamRun, planetType) + the Security members' groundStats.hazardResist (THE Assault Hardsuit line, D26)
export const TASK_HAZARD_PENALTY = 0.5;  // [PROVISIONAL, Q10] mirrors SCAN_HAZARD_PENALTY
export function taskWorkSeconds(exp, teams: GroundTeamRun[], body): number   // floored at 1 second (D23)
```
**Tests:** counts per table + hazard step + clamp; fractions for n = 1, 3; segment shares sum exactly to the total for
odd totals and N = 2..6; a Science member with fieldwork shortens work; an Assault Hardsuit on a SECURITY member
shortens work on a hazardous body and does nothing on a hazard-0 body; legacy `resolveExpeditionActivity` output is
unchanged after the `taskRewardSeed` extraction (existing tests stay green); salts test passes.

**Determinism:** no draws here except the reused task reward stream (same key as legacy). **Acceptance:** gate green.
Commit `feat(0.14.0): ground task model (fight points, segments, work time) (Ground Ops GO-4)`.

**Carry from GO-4 (built 2026-10-12, commit `feat(0.14.0): ground task model (fight points, segments, work time) (Ground Ops GO-4)`):**
- **`groundTasks.ts`** (imports model types, expeditionContent types, fieldwork, relics, gambit; NEVER expedition.ts):
  `FIGHT_POINTS_BY_POI` (a Record over `ExpeditionPoiId`, so a new PoI is a compile error until rated),
  `FIGHT_POINTS_DEFAULT` 2, `FIGHT_POINTS_HAZARD_STEP` 0.6, `FIGHT_POINTS_MIN` 1 / `FIGHT_POINTS_MAX` 5,
  `fightPointCount(poiId, hazard)` (own-key lookup; the caller passes the body's RAW hazard; NaN adds nothing),
  `fightPointFractions(n)` (k / (n + 1); [] for n < 1 or non-integer), `segmentCount(task)`, `segmentHaul(full, N, s)`
  (exact telescoping split per material and credits; a zero share is LEFT OUT of `materials`; out-of-range s or bad N
  = empty haul), `TASK_HAZARD_PENALTY` 0.5 [PROVISIONAL, Q10], `TASK_MIN_WORK_SECONDS` 1, `taskWorkSeconds(exp, teams,
  body)` (ACTIVITY_SECONDS / pace * (1 + resistedHazard(hazard, museum + team resist) * 0.5), ROUNDED to whole seconds
  like the legacy `activityDurationSeconds`, floored at 1 s; equals it exactly on a hazard-0 body with one team holding
  the whole roster, tested). Plus helpers GO-5 / GO-7b reuse: `taskFieldworkRun(exp, teams)` (the union Science party,
  `scienceStrength * sum(max(0, scienceShare))`), `taskSecurityHazardResist` (the Security members'
  `groundStats.hazardResist`: THE Assault Hardsuit line, plus any Security trait resist), `taskTeamHazardResist`, and
  `taskFullHaul(exp, teams, body, poiId, flatIndex)` (rollHaul on `taskRewardSeed`, RAW hazard, the team set's
  yieldMult; equals the legacy win haul for one whole-roster team, tested).
- **Deviation: the team input is `GroundTaskTeam { securityIds, scienceIds, scienceShare }`**, not `GroundTeamRun[]`:
  the run-side types do not exist yet and the share lives in `GroundOpsFactors.scienceShare` (per team), not on the
  run. GO-7b passes each team as `{ ...teamRun, scienceShare: factors.scienceShare[pos] }` (GroundTeamRun satisfies the
  id fields structurally). Repeat / unknown ids are skipped, so a member never counts twice.
- **`ACTIVITY_SECONDS` MOVED to groundTasks.ts** (expedition.ts re-exports it unchanged) so groundTasks.ts never imports
  expedition.ts (expedition.ts will import groundOps.ts which imports this).
- **`ExpeditionActivity` gains the section 2 task fields**, all optional (requiredTeams, fightPoints, progress,
  pointsCleared, segmentsBanked, segmentsOffloaded, fightCount, status, assignedTeamIds). No save bump; legacy records
  keep their shape. The other run-side types (GroundOpsState, GroundTeamRun, ...) still land with GO-7a / GO-7b.
- **gambit.ts:** `rollHaul` exported; new `taskRewardSeed(exp, flatIndex)` = `(seed ^ REWARD_SALT ^ imul(flatIndex + 1,
  0x27d4eb2f)) >>> 0` and `taskRelicSeed(exp, flatIndex)` = reward seed ^ `TASK_RELIC_SEED_MIX` (0x165667b1, the old
  inline literal, unexported, NOT a top-level salt; it equals waveSeed's `WAVE_LOOT_SEED_SALT`, harmless since the base
  seeds differ). The legacy win haul, relic roll and evacuation haul all read them now. **Proof of byte-identity:**
  `groundTasks.test.ts` pins five `resolveExpeditionActivity` outputs captured BEFORE the extraction (two wins, a
  relic win with a Science party and an hours-out ramp, an evacuation, the D18 no-team path) plus literal seed values;
  every existing test stayed green. **GO-7b's relic at 100% must call `taskRelicSeed`.**
- **Salt registry `salts.test.ts`:** collects every exported `*_SALT` of expedition.ts, gambit.ts, groundTasks.ts,
  officerStats.ts, combat/waveSeed.ts (distinct, odd, uint32) plus model.ts (distinct only: `AWAY_RECRUIT_SEED_SALT`
  0x5a17c0de is EVEN, predates the rule; changing it would reroll recruit offers). The expedition.ts (4) and gambit.ts
  (6) salts are now exported for it. Not covered (not exported): tick.ts `MISSION_OUTPUT_ROUNDING_SALT`, relics.ts
  `RELIC_STUDY_SALT`, salvage.ts `SALVAGE_ROUNDING_SEED_SALT`, seniorStaff.ts `OFFICER_STAT_SEED_SALT`. **GO-5 / GO-7 /
  GO-8 add their module namespace to `MODULES`** (and the expected-names list). 16 strict salts today, no clash.
- **no-dead-stats:** `gear:security:assaultHardsuit:groundHazardResist` STAYS in `PENDING_IN_RELEASE` until GO-7b reads
  `taskWorkSeconds` inside a run (nothing calls it yet); GO-7b removes it in the same commit.
- **Not included, for the user / GO-7b:** the scan's Science Integrity resist (`exp.hazardSteady`) is NOT in the task
  hazard resist (the spec lists museum + Science fieldwork + Security only); a one-line add in `taskWorkSeconds` if
  wanted. Downed Security members still count their suit toward the task's work time (the time is per task, set when
  the team works it).
- Tests: `groundTasks.test.ts` (23) + `salts.test.ts` (4). Suite 4093 -> 4120 passed; `npm run check` 0 errors.

### GO-5: One task fight (pure)

**Files:** Create `src/lib/game/groundFight.ts`, test `groundFight.test.ts`.

**Behavior:**
```ts
export const GROUND_FIGHT_SALT = 0x4d2a7e1b;  // new, odd, add to salts.test.ts
export const GROUND_ROUND_SECONDS = 6;        // a fight step lasts rounds * this [PROVISIONAL, Q9]
export interface GroundFightRecord {
  pointIndex: number; fightNumber: number;    // fightNumber = the task's fightCount at the start (the key)
  outcome: "win" | "loss"; rounds: number;
  downedMemberIds: string[];
  memberConditions: Record<string, string[]>; // memberId -> condition ids at the battle's end (GROUND_CONDITIONS ids only):
                                              // "health" when hp < hpMax, each remaining status that is in the table, "downed" when downed
  neuralBackup?: { memberId?: string; revived: boolean };
}
export function resolveTaskFight(exp: Expedition, teams: GroundTeamRun[], body: ExpeditionBody, task: ExpeditionActivity,
  flatIndex: number, logSink?: GambitLogEvent[]): GroundFightRecord
// seed = (exp.seed ^ GROUND_FIGHT_SALT ^ imul(flatIndex + 1, 0x9e3779b9) ^ imul((task.fightCount ?? 0) + 1, 0x85ebca6b)) >>> 0
// team = buildRosterCombatants(union of teams' Security snapshot members, exp.securityStrength * sum(securityShare),
//        idPrefix `${exp.id}-${task.id}-f${fightNumber}`, sittingOut = union of teams' downedThisTask,
//        { triage: exp.squadTriage, fearResist: exp.squadFearResist })
// enemies = generateEncounter(seed, resistedHazard(body.hazard, exp.hazardResist ?? 0), task.poiId)   (NO ambush soften: D13 + GO-8)
// result = resolveGroundBattle(team, enemies, exp.teamKit, makeRng(seed), logSink, seed); conditions read off the mutated team combatants
```
**Tests:** same inputs -> deep-equal record; a different `fightCount` -> a different enemy set or course ("a fresh
encounter per attempt"); a member in `downedThisTask` never appears in the team; a wiped squad records every member
"downed"; a survivor below max HP gets "health"; poison remaining at the end is recorded, weakened is not; the log sink
does not change the record; a Neural Backup wearer's revive rolls on its own stream (record identical with and without
a log).

**Determinism:** one private stream per fight, keyed by (task flat index, fight number); never the legacy COMBAT_SALT
stream. **Acceptance:** gate green. Commit `feat(0.14.0): ground task fight resolver (Ground Ops GO-5)`.

**Carry from GO-5 (built 2026-10-12, commits `feat(0.14.0): hazard resist curves toward the 75% cap (Ground Ops GO-5)`
then `feat(0.14.0): ground task fight resolver (Ground Ops GO-5)`):**
- **`groundFight.ts`** (imports model types, combat/rng, gambit, medicalBay, relics, groundTasks; never expedition.ts):
  `GROUND_FIGHT_SALT` 0x4d2a7e1b, `GROUND_ROUND_SECONDS` 6 [PROVISIONAL, Q9], `taskFightSeed(exp, flatIndex,
  fightNumber)` (the spec formula; pinned, and pinned to differ from the legacy COMBAT_SALT battle seed),
  `taskFightTeam(exp, teams, task, carried?)` (the squad as fresh combatants: the teams' Security members, team then
  slot order, each once, minus every team's `downedThisTask`; crew layer `securityStrength * sum(securityShare > 0)`;
  idPrefix `${exp.id}-${task.id}-f${fightNumber}`; the run's officer care; then the carry. **GO-6 should build its
  sample squads with it**), `resolveTaskFight(exp, teams, body, task, flatIndex, carried?, logSink?)`,
  `memberEndConditions(c)`, `isCarriedStatus(id)` (own key in GROUND_CONDITIONS AND GAMBIT_STATUSES: Poison and
  Bleed today), `taskFightSeconds(record)` = max(1, rounds * 6).
- **Deviation: the team input is `GroundFightTeam { securityIds, downedThisTask?, securityShare }`** (GroundTeamRun
  does not exist yet; the share lives in `GroundOpsFactors.securityShare`). GO-7b passes `{ ...teamRun,
  securityShare: factors.securityShare[pos] }`. `groundTasks.ts teamMembers` became the exported generic
  `teamSnapshotMembers<T>` so both modules pick members by one rule.
- **Carry damage (user Q5):** `carried` is a `Record<memberId, GroundMemberCarry { hp, statuses }>`; a carried member
  is fielded at its HP clamped to [1, hpMax] (a non-finite HP is ignored) with only its persisting statuses (live
  duration, finite magnitude, first of each id, fresh copies). Combat-only statuses end with the battle
  [PROVISIONAL, Q6]; a carried status resumes with the rounds it had left (the battle clock stops between fights)
  [PROVISIONAL]; the team kit refills each fight (`exp.teamKit` per battle, the legacy rule) [PROVISIONAL]. The record
  gains **`memberEnd: Record<memberId, GroundMemberEnd { hp, hpMax, statuses }>`** for every member still STANDING
  (downed members are left out: they sit out the task). **GO-7b threads `pendingFight.memberEnd` into the task's next
  fight as `carried`, drops it after a wipe and after the bay**, and needs a place on GroundTeamRun for it between
  fights (suggestion: `carry?: Record<string, GroundMemberCarry>`, cleared with `conditions` at reload).
- **Record details:** `rounds` = rounds FOUGHT (resolveGroundBattle reports the 0-based round a fight ended in, or
  MAX_ROUNDS at the cap; `MAX_ROUNDS` is now exported from gambit.ts); 0 only when nobody can be fielded, which is a
  loss with no battle and no draw. `memberConditions` lists only members with a condition: "health" when below max
  (always when downed), each persisting status once, "downed" when downed. `pointIndex` = `pointsCleared ?? 0`,
  `fightNumber` = `fightCount ?? 0`. The log sink is appended to (never cleared) and never changes the record.
- **Hazard resist curve (user ruling, D23 exception):** `relics.ts effectiveHazardResist(raw)` = 0.75 x tanh(raw /
  0.75), held one ulp under the cap where tanh rounds to 1; `resistedHazard` uses it instead of the clamp. tanh over
  the exp form because its slope is 1 with zero curvature at 0 (raw 0.1 keeps 99.4%; the exp form keeps 93.6%), and
  over diminishing() because it is bounded by construction. Before / after: 0.1 -> 0.0994 (was 0.1), 0.3 -> 0.2850
  (0.3), 0.5 -> 0.4371 (0.5), 0.75 -> 0.5712 (0.75), 1.5 -> 0.7230 (0.75). Every run with a resist moves (legacy too:
  scan rate, scan encounter odds, battle guards, task work; section 1 row); no-resist runs are bit-identical; a new
  parity test (one advance == 997 s chunks, resists 0.3 and 2). Moved expectations: museum-bonuses 0.8 -> 0.8046,
  fieldwork scan progress x2 (0.3 cuts 0.2850), groundTasks 720 -> 735 and 810 -> 815.
- **GO-4 review items:** tick.ts `MISSION_OUTPUT_ROUNDING_SALT`, relics.ts `RELIC_STUDY_SALT`, salvage.ts
  `SALVAGE_ROUNDING_SEED_SALT` exported and on the strict list; seniorStaff.ts `OFFICER_STAT_SEED_SALT` (EVEN)
  exported and on the distinct-only list beside `AWAY_RECRUIT_SEED_SALT` (a test pins exactly those two);
  `GROUND_FIGHT_SALT` registered (20 strict + 2 distinct-only salts, no clash). `taskRewardSeed` comments that its multiplier
  0x27d4eb2f equals RELAUNCH_SEED_SALT in another role. `taskWorkSeconds` NaN guard: a pace that is not a positive
  finite number reads 1, a presented hazard that is not a finite number > 0 reads calm, so it is always a whole
  number >= 1.
- Tests: `groundFight.test.ts` (21), +1 NaN test (groundTasks), +2 hazard curve tests (museum-bonuses: the table,
  the parity). Suite 4120 -> 4144 passed; `npm run check` 0 errors.

### GO-6: Threat indicator (display only)

**Files:** Create `src/lib/game/groundThreat.ts`, test `groundThreat.test.ts`; modify `combat/threatAssessment.ts`
(add `THREAT_TIER_ORDER` and `tierAtLeast(tier, floor)`; add a `shortName` per tier [PROVISIONAL text, Q17]).

**Behavior:**
```ts
export const GROUND_THREAT_SALT = 0x6e5b3c27;  // new, odd
export const GROUND_THREAT_SAMPLES = 32;       // TUNABLE (cost vs precision); ship combat uses DEFAULT_SAMPLES 64
export function groundTaskClearOdds(exp, teams: GroundTeamRun[], body, task, flatIndex, samples = GROUND_THREAT_SAMPLES): { wins: number; samples: number }
// sample s simulates the task's REMAINING fights (pointsCleared .. n-1) in order with seeds
// (exp.seed ^ GROUND_THREAT_SALT ^ imul(flatIndex + 1, 0x9e3779b9) ^ imul(s + 1, 0x85ebca6b) ^ imul(j + 1, 0x27d4eb2f)),
// members downed in an earlier fight of the SAME sample sit out its later fights (the in-task rule); a sample wins
// only when every remaining fight wins ("clear the WHOLE task in one go", design 7). 0 remaining fights -> all wins.
export function groundTaskThreat(...same args): ThreatAssessment   // threatAssessment(wins, samples): the 7 named tiers
export const HELPER_MIN_TIER: ThreatTier = "likely";             // "Favorable" (user 9b.4) [PROVISIONAL mapping, Q2]
```
**Tests:** deterministic; a strong geared squad vs a 1-fight Mineral Outcrop reads Guaranteed or Likely, a lone
bare-handed member vs a 4-fight Subterranean Civilization reads Extreme or Impossible; computing it changes nothing
(the run passed in is deep-equal afterwards, and resolving the real fight after a threat read gives the same record
as without it); `tierAtLeast` ordering.

**Determinism:** samples use their own salt, so a threat read can never shift a real fight. Display only, EXCEPT the
two uses the user approved: the default plan (GO-7c) and the helper floor (GO-7c). **Acceptance:** gate green. Commit
`feat(0.14.0): ground threat indicator on the 7 tiers (Ground Ops GO-6)`.

**Carry from GO-6 (built 2026-10-12, commit `feat(0.14.0): ground threat indicator on the 7 tiers (Ground Ops GO-6)`):**
- **`groundThreat.ts`** (imports model types, groundFight, groundTasks, combat/threatAssessment; never expedition.ts):
  `GROUND_THREAT_SALT` 0x6e5b3c27 (registered in salts.test.ts: 21 strict + 2 distinct-only, no clash),
  `GROUND_THREAT_SAMPLES` 32, `HELPER_MIN_TIER` "likely" [PROVISIONAL mapping, Q2], `groundThreatSampleSeed(exp,
  flatIndex, sample, pointIndex)` (the spec formula; j = the fight point's ABSOLUTE index, so a retry with an
  unchanged squad reads the same guards), `remainingTaskFights(task, body)` (stamped fightPoints, else
  `fightPointCount(poiId, RAW hazard)`; minus pointsCleared, floored at 0), `groundThreatSampleFights(...)` (one
  sample's fight records, for tests and a future "how it would go" readout), `groundTaskClearOdds(exp, teams, body,
  task, flatIndex, samples = 32, carried?)` and `groundTaskThreat(...same)` = threatAssessment(wins, samples).
- **Samples follow carry damage (user Q5):** each fight of a sample starts from the previous fight's `memberEnd`
  (resolveTaskFight's carry); the sample's FIRST fight starts from the optional `carried` argument (GO-7b passes the
  team's current in-task carry, e.g. the suggested `GroundTeamRun.carry`), so a hurt team reads its real odds; members
  downed earlier in the sample sit out its later fights (added to every team's `downedThisTask` for the sample). A
  sample fight carries `fightCount + (j - pointsCleared)`, the fight number a real fight there would have, so the
  combatant ids match. Squads are built by `taskFightTeam` (same squad as a real fight).
- **groundFight.ts refactor (real fights unchanged, GO-5 tests green):** the fight body moved to
  `resolveTaskFightOnSeed(exp, teams, body, task, seed, carried?, logSink?)`; `resolveTaskFight` = it on
  `taskFightSeed`. Engine code resolves real fights through `resolveTaskFight` only. New `TaskFightExp` type = every
  Expedition field a fight reads after its seed (id, roster, securityStrength, squadTriage, squadFearResist,
  hazardResist, teamKit). **A new read in the fight must widen `TaskFightExp`**, which then fails to compile in
  groundThreat.ts's memo key list until listed.
- **Measured cost (vitest, this machine):** a decisive 5-fight task about 2 ms (32 samples x 5 fights); the slowest
  squad in a grid sweep (tanky, zero damage, fights grinding long) about 15 ms per task; a cold 20-task planet of
  those about 180 ms (mixed planet about 15 ms). Too slow to recompute on every reactive update of a queue screen
  (tasks x teams), so `groundTaskClearOdds` is **memoized on its WHOLE input** (`groundThreatOddsKey`: the
  TaskFightExp fields + seed, each team's securityIds / downedThisTask / securityShare, body hazard, the task fields,
  flat index, sample count, carried; NaN / Infinity / undefined spelled out), bounded at `GROUND_THREAT_MEMO_SIZE`
  256 (least recently used evicted), returning a fresh object. Because the key is the full input, a hit equals a
  fresh computation for any save: nothing can leak across saves, runs or edits (an in-place edit is a miss, tested).
  Warm 20-task pass: about 0.6 ms. The key lists use `satisfies Record<keyof T, true>`, so a field added to
  TaskFightExp / GroundFightTeam / the task Pick is a compile error until keyed.
- **threatAssessment.ts:** `THREAT_TIER_ORDER` (best first), `tierAtLeast(tier, floor)`, and `shortName` per tier
  (Guaranteed, Likely, Worthy, Even, Not Advised, Extreme, Impossible) [PROVISIONAL text, Q17]. Patrol chips untouched
  (they still read `icon`, the emoji; GO-10 owns the SVG dots).
- **Display fix (GO-5 review b):** new `src/lib/ui/hazardResistText.ts` (`hazardResistEffectParts / Text`,
  `pieceHazardResist`, `pieceHazardResistText`). The museum's Deep Earth 4-piece tier now reads "+2.5% hazard resist
  (diminishing)" (relicIcons.ts `formatMuseumStatBonus`, used by MuseumPanel's tier line); the item tooltip adds a
  line under the stat lines for any piece with a hazard line that a run reads ("Hazard resist 28.5% (diminishing from
  30.0%)": a Pathfinder Suite through its own curve, a member piece through convertGroundPoints). The "+30 Hazard
  Resist" stat lines stay as POINTS (every tooltip stat line is points). Each readout curves its own source; in a
  run the curve applies to the combined sum. Verified in the dev preview by mounting the real MuseumPanel and
  EquipmentTooltip on an injected save (Deep Earth at 160 copies each, a Pathfinder Suite, an Assault Hardsuit); the
  save was restored byte-identical. Console clean.
- Tests: `groundThreat.test.ts` (21), threatAssessment +3, `hazardResistText.test.ts` (6), relicIcons +2. Suite 4144
  -> 4176 passed; `npm run check` 0 errors.

---

### Stage C: The engine

### GO-7a: Dispatch snapshot for ground teams (written, not yet read)

**Files:** `src/lib/game/groundOps.ts` (create: `snapshotGroundOps(state, ship)` and types re-exported), `expedition.ts`
(no behavior change yet), test `groundOps.test.ts`.

**Behavior:** `snapshotGroundOps` returns `{ teams, factors, shipEventProfile: NEUTRAL_SHIP_EVENT_PROFILE }` from
`deployableGroundTeams` and the ship at dispatch:
- teams: index, member ids (slot order), `helpOthers` from the ship, empty queues, `step: "idle"`.
- `securityShare[i]` = team i's Security count / all deployed Security; `scienceShare` likewise. With one team both are
  `[1]`, so every crew-layer read equals today's [PROPOSAL, flagged in Q20: splits the ship's crew layer across teams].
- factors: `medicalShare` / `rapidRecoveryShare` = `shipInjuryFactors(state, ship)` (D24: FROZEN at dispatch);
  `officerFacetShare` = the run's `recoveryTurnaround + quickRecovery`; `injurySteady`; `offloadMult` =
  `effectiveShipStats(state, ship).unloadSpeedMult ?? 1`; `reloadMult` = `1 + crew.loadSpeed (shipCrewContribution)
  + (captain.unlockedSecondaryTalents includes "logistics4" ? 0.08 : 0)` (D26; the secondary tree is otherwise dormant,
  note it in a comment).
Also the union roster: `snapshotAwayRosterForTeams(state, ship, teams)` = Security then Science members of the deployed
teams, team order then slot order (scan readers keep reading `exp.roster`).

**Tests:** one team: shares [1]; three-team synthetic hull: shares sum to 1; a team missing a ready Science member is
left out; frozen factors match the live readers at dispatch and do not change when the ship's officers change later;
`reloadMult` rises with Rapid Loadout and with logistics4.

**Acceptance:** gate green, still behavior-neutral (startExpedition does not call it). Commit
`feat(0.14.0): ground ops dispatch snapshot (Ground Ops GO-7a)`.

**Carry from GO-7a (built 2026-10-12, commit `feat(0.14.0): ground ops dispatch snapshot (Ground Ops GO-7a)`):**
- **Types (model.ts, plain data, nothing stores them yet):** `GroundStepKind`, `GroundTeamRun` (section 2 plus
  **`carry?: Record<memberId, GroundMemberCarry>`**, the GO-5 in-task carry: absent = full HP; GO-7b sets it from a won
  fight's `memberEnd`, drops it after a wipe and after the bay), `GroundOpsFactors`, `ShipEventProfile` (evasion,
  sensors, shieldCapacity, engineering, boardingDefense; GO-8 adds the frozen ship battle inputs). model.ts takes
  `GroundFightRecord` / `GroundMemberCarry` by a TYPE-ONLY import from groundFight.ts (erased; no runtime cycle).
  **Not added (GO-7b owns them):** `GroundOpsState`, `GroundStepRecord`, `Expedition.groundOps`.
- **`groundOps.ts`** (imports model, awayTeam, groundTeams, medicalBay, injuries, crewOverlay, crewBuffs; never
  expedition.ts) re-exports those types and holds:
  `snapshotGroundOps(state, ship, run) -> { teams, factors, shipEventProfile }` (`GroundOpsSnapshot`);
  `snapshotAwayRosterForTeams(state, ship, teams)`; `groundOpsBayCare(factors)` (the frozen BayCare GO-7b passes to
  `memberBaySeconds`); `groundReloadMult(state, ship)`; `NEUTRAL_SHIP_EVENT_PROFILE` (all zeros, `Object.freeze`d; the
  snapshot writes a fresh copy); `EFFICIENT_STOWAGE_RELOAD` (0.08, READ from `SECONDARY_CAPTAIN_TALENTS.logistics4`).
- **Deviation: a third argument `run: Pick<Expedition, "recoveryTurnaround" | "quickRecovery" | "injurySteady">`.**
  `quickRecovery` is rolled on the run's seed in startExpedition, so the snapshot cannot read it from the ship; GO-7b
  computes the facets first, then calls `snapshotGroundOps(state, ship, { recoveryTurnaround, quickRecovery,
  injurySteady })`. The bay factors are `bayCareFrom(shipInjuryFactors(state, ship), run)`: the mapping stays written
  once (medicalBay.ts).
- **Teams:** `deployableGroundTeams(state, ship.id).teams.filter(t => t.deploys)` (a team with ANY not-ready slotted
  member stays aboard; no stand-ins), ascending index, ids in SLOT order, `helpOthers` from `shipGroundTeams(ship)`,
  `queue: []`, `step: "idle"`, `stepStartedAt: state.gameTimeSeconds`, `stepEndsAt: null`, empty `skippedBorrowed` /
  `downedThisTask` / `conditions` / `bayEnds`, no `carry`. No deploying team = `teams: []` and empty shares (the D18
  gate in startExpedition must refuse first; the snapshot does not gate).
- **Factors:** `medicalShare` / `rapidRecoveryShare` = `shipInjuryFactors`; `officerFacetShare` = recoveryTurnaround +
  quickRecovery; `injurySteady`; `offloadMult` = `effectiveShipStats(...).unloadSpeedMult` (crew Efficient Unloading x
  the officer turnaround cut); `reloadMult` = 1 + crew.loadSpeed (Rapid Loadout) + 0.08 when the ship's ASSIGNED
  captain owns logistics4 (a parked captain or logistics3 alone adds nothing; Q22 still open). Both multipliers read 1
  for a non-finite or non-positive value, so a bad value can never stall a step. Shares = squad size / every DEPLOYED
  squad of that type (a held team is out of the split).
- **Union roster:** `snapshotAwayRosterForTeams` = Security then Science, team then slot order, each member once,
  only members aboard that ship with the squad's type; frozen by new `awayTeam.ts snapshotMembers(state, members)`
  (the same freeze as `snapshotAwayRoster`, which now shares the private `wornByMember`). One team slotted in hire
  order deep-equals today's `snapshotAwayRoster` (tested), so GO-7b's switch keeps every one-team roster read.
- **GO-6 review minors folded in:** (1) `groundThreat.ts keyReplacer` is a TYPED encoding: every string value is
  tagged `s:`, undefined is `u`, a non-finite number `n:NaN` / `n:Infinity` / `n:-Infinity`, so a real string
  ("#u", "u", "n:NaN") can never read as a sentinel (tested pairwise). (4) MuseumPanel's per-copy line goes through
  new `relicIcons.ts museumPerCopyText(stat, copies, total)`, whose total is `formatMuseumStatBonus` (a hazard resist
  per-copy total would read effective). Visible copy change: the total now names its stat ("total +0.5% research
  speed", was "total +0.5%").
- **For GO-7b:** `withMinimumAwayTeam` still adds UNSLOTTED members (GO-2 note); after the switch every dispatching
  test must slot them (or route through the hire / reassign auto-slot), or the snapshot deploys no team.
- Tests: `groundOps.test.ts` (17), groundThreat +1, relicIcons +2. Suite 4176 -> 4196 passed (1 skipped, unchanged);
  `npm run check` 0 errors. No golden or parity test moved.

### GO-7b: The timeline engine, single team, own queue (THE SWITCH)

**Files:** `src/lib/game/groundOps.ts`, `expedition.ts` (`startExpedition`, `advanceExpedition`, phase durations, scan
completion hook, `claimExpedition`), `injuries.ts` (`applyGroundOpsInjuries`), `no-dead-stats.test.ts` (probes +
remove `crew:crew.loadSpeed` and the Assault Hardsuit entry), tests `groundOps.test.ts`, `groundOpsParity.test.ts`,
`groundOpsLegacy.test.ts` (golden hashes FIRST).

**Step 1 (before any engine edit):** capture golden hashes of legacy runs (no `groundOps`): plain pre-Task-14 run,
Task-14 encounter run with a loss pause, a run with wipes + evacuation, each advanced in one call and in 997 s chunks,
plus their claims. Commit them inside this task's commit; they must stay green.

**Behavior:**
- `startExpedition`: D18 now reads `deployableGroundTeams` (at least one team deploys); `roster` = the union snapshot;
  writes `groundOps = { version: 1, ...snapshotGroundOps(...), editCount: 0, history: [] }`. Update
  `expeditionDispatchBlockText("needsAwayTeam")` to "Needs a ground team with at least 1 Security and 1 Science member
  slotted and ready: set it up on the ship's Away Team tab".
- Scan completion (both scan resolvers, right after `assignDiscoveriesAndActivities` for a flagged run):
  `initGroundTasks(exp, bodyIndex)` stamps each new activity (`requiredTeams: 1`, `fightPoints`, `progress: 0`,
  `pointsCleared: 0`, `segmentsBanked: 0`, `segmentsOffloaded: 0`, `fightCount: 0`, `status: "queued"`) and
  `planNewTasks(exp, bodyIndex)` appends them to queues. One team: its queue gets the body's tasks EASIEST FIRST by
  `groundTaskClearOdds` (ties: discovery order) [PROVISIONAL, Q3].
- Activities phase of a flagged run: at the boundary set `startedAt = anchor`. `advanceGroundOps(exp, now, hoursAt)`
  processes step ends in (stepEndsAt, team index) order while `stepEndsAt <= now + PHASE_EPS`, then runs
  `assignIdleTeams(t)` (team index order) after every batch of ends at the same instant:
  - idle -> pick the first `queued` task in its own queue -> `deploy` (DEPLOY_SECONDS) [PROVISIONAL, Q7], status `active`.
  - deploy end -> pending fight at `progress` (pointsCleared < n and progress == fightPoints[pointsCleared]) ? `fight`
    : `work` to the next point or 1, lasting `(to - from) * taskWorkSeconds`.
  - work end -> `progress = to`; bank the segment just finished (`segmentsBanked += 1`); if `to === 1`: status
    `done`, `done = true`, relic rolled now (rollRelicToken on the legacy relic seed, find bonus with the team's
    fieldwork relicFind + `crewRareFind` ramped at `hoursAt(t)`), -> `return`; else -> `fight`.
  - fight START: `resolveTaskFight` (GO-5), `fightCount += 1`, store `pendingFight`, step length `rounds *
    GROUND_ROUND_SECONDS` (min 1). Fight END: merge `memberConditions` into `conditions`, add downed to
    `downedThisTask`; win -> `pointsCleared += 1`, -> `work`; loss -> progress stays at the point, -> `return`.
  - return (RETURN_SECONDS) -> offload (`OFFLOAD_BASE_SECONDS / offloadMult`) -> at offload END append one finding per
    offloaded batch: id `${exp.id}-find-task-${task.id}-s${from}-${to}`, source `"activity"`, `poiId`, the summed
    `segmentHaul` of segments `segmentsOffloaded..segmentsBanked-1` (yieldMult of the team that banked them), the relic
    on the completing batch; `segmentsOffloaded = segmentsBanked`.
  - bay: per member `memberBaySeconds(conditions[m], perks, factors care)`; step length = the longest (0 -> straight to
    reload); record `bayEnds[m] = t + own`, `bayStart = t`. -> reload (`RELOAD_BASE_SECONDS / reloadMult`) -> idle;
    clear `conditions`, `downedThisTask`, `taskId`.
  - Run end: when no task is `queued` / `active` / `staging` and every team is `idle`, `bay` or `reload`, set
    `endedAt = t`. Activities duration = `endedAt - startedAt` (unknown before: the phase does not end).
- `expedition.ts`: `phaseDurationSeconds("activities")` for a flagged run = `endedAt - startedAt` when set, else
  `Infinity` (the loop breaks); `activitiesDurationSeconds` (return-leg ramp) reads the same; the legacy branches are
  untouched. `expeditionPhaseFraction` in activities reads `groundOpsProgress(exp, now)` (tasks done / total, plus the
  working team's interpolated progress).
- Claim of a flagged run: deposit findings (already offloaded), then `applyGroundOpsInjuries`: every member whose
  latest `bayEnds` is after `now` becomes injured until it (injuredAtSeconds = that team's `bayStart`); everyone else is
  ready ("anyone still in the bay comes home with the remaining time"; the bay keeps running through the return leg, so
  unclaimed time counts, matching D24's intent). Never the flat 2h.
- `GROUND_HISTORY_CAP` = 200 records per team, display only (the timeline UI). Resolution never reads history.
- Constants [PROVISIONAL, Q7]: `DEPLOY_SECONDS = 60`, `RETURN_SECONDS = 60`, `OFFLOAD_BASE_SECONDS = 120`,
  `RELOAD_BASE_SECONDS = 120`.

**Tests (`groundOps.test.ts`, one team, hand-built rosters via `awayTeamTestFixtures.ts`):**
- A 3-fight task with a strong squad: work, fight, work, fight, work, fight, work, done; 4 segments banked; findings
  offloaded only at offload end; the relic only on the completing batch.
- A wipe at fight 2 (weak squad, then a strong retry fixture): progress held at fightPoints[1]; segments 0..1 banked
  and offloaded on that return; the retry re-fights point 2 with `fightCount` 3 (a different encounter); no segment is
  ever banked twice (user 9b.1: no farming).
- A member downed in a WON fight is absent from the task's later fights, present again after the bay.
- Bay length = the longest member condition; the mockup bay (Fracture on an Ossir member) gives 2250 s with no care.
- Reload shortens with Rapid Loadout and logistics4; offload shortens with the unload bonus.
- Run end: `endedAt` set, the return leg runs, claim injures exactly the members still in the bay.
- An Assault Hardsuit on Security shortens task work on a hazardous body (the D26 consumer).

**Tests (`groundOpsParity.test.ts`):** a two-body run with a wipe and a retry: one big advance == 997 s chunks == 1 s
chunks over the first 2 hours (deep-equal, with an explicit timeout like the slow parity test). Each `stepEndsAt` is a
pure function of stored values.

**no-dead-stats:** point the expedition probes at a flagged run (fingerprint `endedAt`, each task's completion time,
the claim's injuries); remove `crew:crew.loadSpeed` and `gear:security:assaultHardsuit:groundHazardResist`; confirm
Medical, Rapid Recovery and the Medical facets stay live.

**Acceptance:** gate green; legacy golden hashes unchanged; new dispatches run Ground Ops (the old ExpeditionPanel still
works: `done` flags flip as tasks finish). Commit `feat(0.14.0): ground ops timeline engine, single team (Ground Ops GO-7b)`.

**Carry from GO-7b (built 2026-10-12, three commits: `test(0.14.0): legacy expedition golden hashes before the switch
(Ground Ops GO-7b step 1)`, `refactor(0.14.0): ground fight record types live in model.ts (Ground Ops GO-7b, GO-7a
review)`, then `feat(0.14.0): ground ops timeline engine, single team (Ground Ops GO-7b)`):**
- **THE COMBINED OPERATIONS WINDOW (user Q1, overrides the plan's activities-phase-only engine).** A flagged run's
  scanning and task work share ONE window (`GroundOpsState.startedAt` = the scanning phase anchor). A team starts a
  body's tasks the moment THAT body's scan completes while the ship scans the rest. The window closes (`endedAt`) only
  when every body is scanned AND no task is queued / active AND every team is idle, in the bay or reloading; the return
  phase starts then. The expedition's `phase` still reads "scanning" until the last body is scanned (its end time is
  exact, recovery legs included) and "activities" after, until `endedAt`; both ends are LATCHES the window sets, so the
  phase math never disagrees with the event schedule. `phaseDurationSeconds("activities")` is Infinity until `endedAt`;
  `expeditionPhaseFraction` in activities reads `groundOpsProgress`; `returnDurationSeconds` reads `endedAt - startedAt`.
- **Ship position + the RECOVERY LEG.** While scanning, the ship is at the first unscanned body (teams only work
  scanned bodies, so a working team is always elsewhere). A team WIPED (every Security member down) while the ship
  still scans gets a `GroundShipLeg` (`kind: "recovery"`, stored at the wipe): the ship breaks off at `startsAt`,
  arrives at `arrivesAt = startsAt + IN_SYSTEM_LEG_SECONDS` (the team's return step ends there, history record
  `recovered: true`) and is back on its scan at `endsAt = startsAt + 2 x IN_SYSTEM_LEG_SECONDS`. Legs never overlap
  (a second waits for the first). The scan runs on a SCAN CLOCK (`scanClockToTime` / `scanClockAt`: seconds since the
  window opened minus every leg), so a leg pauses scan progress for exactly its length and shifts only LATER scan
  events; recorded pauses (Task 14 / GO-8) stay on the clock (they freeze during a leg). Ordinary returns (a win, a
  round-cap retreat with someone standing, or any loss once the scan is done) take RETURN_SECONDS and never delay the
  scan. `groundShipPosition(exp, t)` reads scanning / recovery / holding for the UI.
- **Event schedule (groundOps.ts `advanceGroundOpsWindow(exp, now, driver)`).** The earliest pending event goes first;
  at one instant scan events (a step boundary, a body's completion) precede team step ends; team ends at the same
  instant run as a batch in team index order; after every event / batch `groundOpsAssignIdle(exp, t)` (exported for
  GO-7d) and the run-end check run. The scan side stays in expedition.ts behind `GroundOpsScanDriver`
  (`nextScanEventAt`, `processScanEvent`, `hoursAt`): `flaggedScanNext` walks the SAME boundary times as
  `resolveEncounterScanningPhase`, mapped through the legs. Every stepEndsAt is written from the step's own start and
  stored values. A non-finite `now` is ignored (a NaN once looped the guard in a scratch run).
- **Step machine** as specified, with: work steps rounded to whole seconds (`max(1, round((to - from) x
  taskWorkSeconds(standing members)))`); the segment a work step finishes is index `pointsCleared` (`segmentBankers[s] =
  [team index]`, GO-7a review: `number[][]` for GO-7c's joint tasks, the banking team set's yield at offload); a fight is
  resolved at its START with the team's `carry` and applied at its END; a win clears the point and sets `carry =
  memberEnd` (`GroundTeamRun.carry` is now typed `Record<id, GroundMemberEnd>`, so it holds hpMax for display); a loss
  drops the carry, puts the task back to `queued` (progress held) and returns the team; the bay clears conditions, the
  task's downed list and the carry at its END; `taskId` / `attemptPoints` clear at the reload's end. The relic rolls at
  the completing batch's offload on `taskRelicSeed` with the completing team's fieldwork find and the crew rare find
  ramped at `completedAt` (new optional task field). Findings: one per offloaded batch, id
  `groundTaskFindingId(exp, taskId, first, last)` = `<exp>-find-task-<task>-s<first>-<last>` (inclusive); only the
  completing batch carries a `relic` key.
- **Hold and flag (user Q4).** `lossStreak` (new optional task field) counts consecutive failed attempts that cleared no
  new point (a point win resets it; `GroundTeamRun.attemptPoints` = pointsCleared at deploy). `groundTaskStuck(task)` at
  `GROUND_STUCK_LOSSES` (3). **Deviation from the brief's "the run is stuck when every remaining task is stuck":** a lost
  task is retried BEFORE the rest of its team's queue (D25 "when recovered ... they retry the mission"), so a stuck task
  at the head blocks easier tasks queued behind it (the common case: a hard task on body 1 holds body 2's easy ones), and
  the literal rule would never flag it. `groundOpsStuck(exp)` is therefore: the window is open and EVERY team that still
  has work is blocked by a stuck head task (`groundTeamStuck` / `groundTeamHeadTask`), which includes the literal case.
  `GROUND_OPS_STUCK_TEXT` = "Stuck: needs a stronger team or a skip"; the old ExpeditionPanel shows it. Also
  `groundOpsStuckTaskIds` for per-card flags. **SUPERSEDED by the follow-up below (user: back of the line).**
- **Planning:** GO-7b gives a body's new tasks to the LOWEST-index deployed team, easiest first by
  `groundTaskClearOdds` on a fresh squad (ties: discovery order); 2+ teams all land in team 0 until GO-7c. No team
  deployed: the tasks are `skipped`. The first scanned body resets every idle team's `stepStartedAt` (GO-7a review).
- **Scan encounters on a flagged run (user 9b.6):** `scanStepRoll` takes draw 1 at chance 0 when `exp.groundOps` is
  present, so the supply cache (draw 2) reads the same stream position; legacy runs keep Task 14 exactly. NOTE for GO-8:
  `rollStepBoundary` receives the boundary's SCAN-CLOCK time, so `expeditionHoursAtScan` (the Flight Deck ramp) ignores
  recovery legs; convert through `scanClockToTime` if GO-8's events read the ramp (see the follow-up: GO-8 MUST pass
  wall time).
- **Dispatch:** `expeditionAwayTeamCheck` IS `deployableGroundTeams` now (`{ ok, security, science, ground }`); the
  roster is `snapshotAwayRosterForTeams`; `groundOps = newGroundOpsState(snapshotGroundOps(...))`. Block text per the
  plan. The ExpeditionPanel block lists every team's waits ("Alpha: Grokk returns to duty in 12m"). `deployableMembers`
  stays for legacy readers (the AwayTeamPanel "N ready" counts still read it: GO-12's console should switch them).
- **Claim:** `injuries.ts applyGroundOpsInjuries`: every member whose latest `bayEnds` is after the claim comes home
  injured until it (`injuredAtSeconds` = that team's `bayStart`); never the flat 2h.
- **Other UI (minimal, GO-13 / GO-14 replace it):** an activity card sums the task's offloaded batches
  (`groundTaskFindingPrefix`); the legacy battle-log toggle is hidden on flagged runs; the notes line explains the return
  trip.
- **Tests:** `groundOpsLegacy.test.ts` (3: pre-Task-14 plain, Task-14 loss pause, activities wipes + evacuation; 16
  checkpoints + claim each, captured on the pre-switch commit), `groundOpsTimeline.test.ts` (19: plan's one-team list +
  carry threading against `resolveTaskFight`, stuck, step-length purity, segment split; it is a new file rather than
  appended to groundOps.test.ts), `groundOpsParity.test.ts` (8: overlap, a recovery leg while scanning on a pinned seed,
  the scan pause = 2 legs, no scan battles on a flagged run, big == 997 s == 1 s chunks over the first 2 h of the window
  with carry damage and a retry, whole-run big == 997 s, a mid-leg save round trip). Every test that pins LEGACY behavior
  now dispatches through new fixtures `asLegacyDispatch` / `withSlottedAwayTeams` / `withoutGroundOps`
  (awayTeamTestFixtures.ts; `withMinimumAwayTeam` now auto-slots its pair); every existing golden (officerBonuses,
  officerStatFacets, injuries) is unchanged. no-dead-stats: the dispatch scaffold is slotted; "injury recovery" adds the
  Ground Ops bay (`groundTeamBaySeconds` on a full condition set) and its claim; "expedition run + claim" fingerprints the
  flagged run (horizon 200 000 s: a held run is fingerprinted where it stands) AND its legacy twin; `crew:crew.loadSpeed`
  and `gear:security:assaultHardsuit:groundHazardResist` removed (live). Suite 4196 -> 4226 passed (1 skipped).
- **[PROVISIONAL] constants, each one line in groundOps.ts:** `DEPLOY_SECONDS` 60, `RETURN_SECONDS` 60,
  `OFFLOAD_BASE_SECONDS` 120, `RELOAD_BASE_SECONDS` 120 (Q7); `IN_SYSTEM_LEG_SECONDS` 300 (a recovery leg pauses the scan
  600 s); `GROUND_STUCK_LOSSES` 3 (Q4); `GROUND_HISTORY_CAP` 200; behaviors: a return with nothing new banked skips the
  offload; a round-cap retreat with someone standing is not a wipe (no leg); queue easiest first (Q3). (The late-wipe
  default was answered by the user: see the follow-up below.)
- **For GO-7c:** the step machine is per team and already batches same-instant ends in team order; joint tasks need
  `startFight` / `startWork` to take the lead's union team set and `finishWork` to bank `[...assignedTeamIds]`.
  `planNewTasks` is the one place the default plan replaces. **For GO-7d:** advance, edit, then
  `groundOpsAssignIdle(exp, now)`; `groundTaskProgressAt` gives the interpolated progress for a mid-work stop.
  **For GO-8b:** a repair leg can be a new `GroundShipLeg.kind` (the scan clock already stops for every leg; legs are
  serialized) and the "can the ship still recover them" rule reads `groundShipPosition`.

**Carry from the GO-7b follow-up (user answers 2026-10-12 + review minors; commit `feat(0.14.0): back of the line after 3
losses, ship recovers late wipes (Ground Ops GO-7b follow-up)`):**
- **BACK OF THE LINE.** On the `GROUND_STUCK_LOSSES`-th (3rd) loss in a row (no new point cleared), the task moves to the
  BACK of its team's queue and `sentBack` (new optional task field) counts it; easier tasks behind it go first. Its
  `lossStreak` resets when it is deployed again; its progress, points and banked segments are kept as always; a point won
  clears `sentBack`. `groundTaskStuck(task)` = streak at 3 OR `sentBack > 0` (and not done / skipped).
  `groundTeamStuck(exp, team)` = the team still has tasks (`groundTeamRemainingTasks`) and EVERY one is stuck;
  `groundOpsStuck(exp)` = the window is open and every team with tasks is stuck. So a hard task no longer blocks easier
  ones, and a run of only hard tasks reads stuck continuously while it keeps retrying (it never gives up).
  `groundTeamHeadTask` stays as a display reader ("next up"). This replaces the head-of-queue deviation above.
- **LATE WIPES.** A wipe AFTER the system is fully scanned also gets a recovery leg (`scanBodyIndex: null`): the team's
  return ends when the ship arrives (`IN_SYSTEM_LEG_SECONDS` 300 each way, unchanged), nothing else is delayed. The scan
  clock (`scanClockToTime` / `scanClockAt`) skips legs with `scanBodyIndex === null`, so a late leg can never touch the
  scan's end even at a float edge. Legs stay serialized. Only a round-cap retreat with someone standing is an ordinary
  60 s return now.
- **Scanning bar is monotonic.** `expeditionPhaseFraction` on a flagged run's scanning phase reads the SCAN CLOCK over
  the whole scan (`scanClockAt(now) / encounterScanDurationSeconds`), so a recovery leg holds the bar instead of pulling
  it back (a GO-8 pause rolled mid-scan still grows the total, the same as a legacy Task 14 pause).
- **For GO-8 (required):** `rollStepBoundary` is handed the boundary's SCAN-CLOCK time. Ramped ship events (the Flight
  Deck Constitution ramp, `expeditionHoursAtScan`) MUST read WALL time: pass `flaggedHoursAt(exp, scanClockToTime(ops,
  at))` (expedition.ts) for a flagged run, never the scan clock.
- **For GO-7c (required):** a same-instant batch is now FIXED before any team moves (`advanceGroundOpsWindow` filters
  the teams ending at `t`, then processes that list); an end at `t` that processing creates (a zero-length step, or a
  joint step touching a partner) is picked up by the next pass at the same instant, never mid-loop. Keep that when joint
  tasks start moving partner teams. Guard test: `groundOpsTimeline.test.ts` "same-instant batch" (synthetic 2-team hull).
- Tests: `groundOpsTimeline.test.ts` 19 -> 22 (back of the line with an easy task behind, only-hard runs stuck and
  retrying, late wipe legs, the batch guard), `groundOpsParity.test.ts` 8 -> 10 (monotonic bar through a leg, late legs
  on the pinned run; the whole-run parity now covers late legs and tasks sent back). Suite 4226 -> 4231 passed.

### GO-7c: Multi-team, default plan, helpers, multi-team tasks

**Files:** `groundOps.ts`, tests `groundOpsTeams.test.ts` (synthetic 3-team hull fixture; every real hull stays at 1).

**Behavior:**
- Default plan (user 9b.3) when a body completes with 2+ deployed teams: rank teams by their mean clear rate over the
  body's tasks (strongest first); sort tasks hardest first by the strongest team's clear rate; give team A the hardest
  ceil(n / teams) tasks, B the next, and so on ("harder tasks to A, middling to B, easy to C"); each team's new tasks are
  appended EASIEST FIRST [PROVISIONAL, Q3]. One team skips the ranking.
- Helpers (user D25 + 9b.4): an idle team with `helpOthers` and an empty own queue borrows the first task (other teams
  in index order, their queue order) that is `queued`, `requiredTeams === 1`, not in its `skippedBorrowed`, and rates at
  least `HELPER_MIN_TIER` for the helper from the task's current progress. A helper LOSS adds the task to
  `skippedBorrowed`, returns it to `queued` for its owner, keeps its progress; the helper takes the return trip and
  moves on. A helper win finishes it normally; the owner skips a `done` task.
- `requiredTeams` N (wired, no content uses it): a team that picks it goes `staging`; when every team in
  `assignedTeamIds` is staging they deploy together; the LEAD (lowest index) carries the joint work / fight steps
  (Security squads fight as one side, Science fieldwork sums via the union `teamRun`), partners mirror the lead's
  `taskId` with step `"staging"` until the joint return, then each team runs its own return trip, offload and bay. A task
  needing more teams than deployed is `skipped` at planning with a log line [PROVISIONAL, Q20].

**Tests:** default plan on a 3-team hull matches the A/B/C split; two teams work in parallel and their steps interleave
by time; a helper borrows only at or above the floor, fails, skips, and never loops on that task (the mockup GO-M3 Team C
lane); a 2-team task runs both squads in one fight; parity (big == chunked) on the 3-team run.

**Acceptance:** gate green. Commit `feat(0.14.0): ground ops multi-team, default plan, helpers (Ground Ops GO-7c)`.

**Carry from GO-7c (built 2026-10-12, commit `feat(0.14.0): ground ops multi-team, default plan, helpers (Ground Ops
GO-7c)`):**
- **Planning (`planNewTasks(exp, bodyIndex, t)` -> `planTasksForTeams(exp, refs)`, exported for GO-7d's "Default
  plan").** One team: unchanged (easiest first). 2+ teams: the 9b.3 default plan as specified; a team's rank = its mean
  fresh-squad wins over the body's playable tasks (ties: team index); one-team tasks hardest first by the strongest
  team (ties: discovery order), chunks of ceil(n / teams); each team's new tasks appended easiest first by its OWN odds
  (ties: discovery order). **[PROVISIONAL]** a joint task (requiredTeams N) goes to the N STRONGEST teams, appended into
  each of their queues, ordered by the whole set's odds. A task needing more teams than deployed is `skipped` at
  planning with a log line **[PROVISIONAL, Q20]**: new optional `GroundOpsState.log?: GroundOpsLogEntry[]` (display
  only, absent until a line is written, so a run without one keeps its exact shape; kind `skippedNeedsTeams`), worded
  by `groundOpsLogText` ("Skipped Crashed Ship: needs 4 ground teams, 3 deployed"). `initGroundTasks` keeps a content
  `requiredTeams` that is a whole number >= 1 (`requiredTeamsOf`), else 1; no content sets it yet.
- **Assignment (`groundOpsAssignIdle`), two passes in team index order.** Pass 1, own work: an idle team first JOINS a
  joint task a partner is staging for that lists it (own queue order first), else takes its first queued task (a joint
  task it is not assigned to is passed over). Joining first is the no-deadlock rule: a team only starts staging when
  no staged partner waits for it, so two joint tasks can never wait on each other (tested with two joint tasks queued
  in opposite orders). Pass 2, HELPERS: a team still idle (no queued task of its own) with `helpOthers` borrows the
  first task of the other teams' queues (index order, queue order) that is queued, needs one team, is not in its
  `skippedBorrowed` and reads at least `HELPER_MIN_TIER` (`tierAtLeast(groundTaskThreat(fresh helper squad, task as it
  stands))`). Own work goes first, so a helper never takes a task from an owner who is free at the same instant.
  **Interpretation:** "an empty own queue" = no queued task of its own (an own task a helper is working, or a done /
  skipped one, does not keep it from helping).
- **Helpers (user rulings):** `borrowed` is set on the helper and cleared at idle. A helper LOSS never touches the
  owner's `lossStreak` / `sentBack` and never moves the task in the owner's queue; the helper adds the task to
  `skippedBorrowed` (never borrowed again), the task goes back to `queued` with its progress and banked segments kept,
  and the helper takes its return trip (a WIPE while the ship scans is a recovery leg like any team's; tested). A
  borrowed deploy does not reset the owner's streak either. **Note:** a fight point a helper WINS still clears the
  streak and `sentBack` (the task progressed), as any point win does.
- **Joint tasks (requiredTeams N, wired):** the first assigned team to pick it sets it `active` and goes `staging`
  (open-ended); when every assigned team is staging on it the LEAD (lowest index) deploys; partners stay `staging`
  with the lead's `taskId` until the joint return. `crewOf(lead)` = the lead plus the teams staging on its task. The
  lead's work step uses `taskWorkSeconds` over the whole crew's standing members (Science fieldwork summed); a fight
  is ONE side (`resolveTaskFight` over every crew team, team then slot order) with the crew's merged carry; each
  member's conditions, downed state and carry land on its own team; `segmentBankers[s]` = the crew's indices and the
  offload pays that set's yield (`bankingTeams`, unchanged). At the joint return every crew team runs its own return,
  offload, bay and reload. A loss counts ONCE (the lead's `attemptPoints`); at 3 it goes to the back of every crew
  team's queue. A zero-length staging is not written to history (the last joiner who is also the lead).
- **Recovery legs:** unchanged machinery; one leg at a time, so several wiped teams queue and each waits for its own
  pickup (tested: the second leg starts at the first leg's end, its team's return ends on its own arrival). A team is
  WIPED when its OWN Security squad is all down, so a joint wipe gives one leg per wiped team in team index order
  **[PROVISIONAL]** (they share a body; one shared pickup would be the alternative), and a joint round-cap loss gives
  a leg only to a team whose own squad is all down.
- **Batch rule:** the same-instant batch is fixed before any team moves AND each entry is skipped if a batch-mate's
  processing changed its step (step + start captured), so a joint return moving partners can never process a partner
  mid-loop.
- **Offload note:** an offload still delivers every banked segment not yet offloaded at its END, whoever banked it (at
  that team set's yield, never twice), so a helper's segment banked while the owner is still offloading arrives with
  the owner's batch. Totals are exact; only the arrival moment differs.
- **For GO-7d:** `crewOf` (internal) gives the teams to stop when an active joint task is skipped or reassigned;
  `planTasksForTeams` re-runs the plan; validate `notEnoughTeams` for a joint task (a joint task whose assigned,
  deployed teams are fewer than `requiredTeams` would stage forever).
- Tests: `groundOpsTeams.test.ts` (17, synthetic 3-team hull via `registerSyntheticHull`; every real hull keeps 1
  team): the hull, the default plan split + parallel interleave, helper floor / win / loss / no loop / owner streak
  untouched / leg while scanning / no-help and own-work-first, two wiped teams queue for the ship, joint stamping, a
  2-team task end to end (one fight side, union work time, team-set banking and yield), a staged team waiting for a
  busy partner, opposite-order joint tasks, a joint wipe (a leg each, counted once, back of both queues), the skip log
  line, and parity (big == 997 s == 1 s chunks over 2 h) on a hand-built 3-team run with a joint task, a helper and
  wipes, and on a REAL dispatched 3-team run (plus big == 997 s over 150 000 s), explicit timeouts. Legacy goldens and
  every GO-7b test unchanged. Suite 4231 -> 4248 passed (1 skipped); `npm run check` 0 errors.

### GO-7d: Live queue edits ("apply from now")

**Files:** `groundOps.ts` (edit API), `App.svelte` (no UI yet; handlers land with GO-13), tests `groundOpsEdits.test.ts`.

**Behavior:**
```ts
export type GroundOpsEdit =
  | { kind: "assign"; taskId: string; teamIndex: number; position?: number } // move into a team's queue (from any queue)
  | { kind: "reorder"; teamIndex: number; taskId: string; delta: -1 | 1 }
  | { kind: "skip"; taskId: string }
  | { kind: "requeue"; taskId: string; teamIndex: number }                    // a skipped task back into a queue
  | { kind: "defaultPlan"; bodyIndex: number }
  | { kind: "autoAssign"; bodyIndex: number }                                // user's "Auto-assign randomly"
  | { kind: "setHelp"; teamIndex: number; on: boolean };
export type GroundOpsEditBlockReason = "noExpedition" | "notGroundOps" | "runFinished" | "noSuchTask" | "taskDone" | "noSuchTeam" | "notEnoughTeams";
export function canEditGroundOps(state, expeditionId, edit): { ok: true } | { ok: false; reason: GroundOpsEditBlockReason }
export function editGroundOps(state, expeditionId, edit): GameState
// 1) advance the run to state.gameTimeSeconds (advanceExpedition); 2) validate; 3) apply to the stored queues;
// 4) editCount += 1; 5) if in the activities phase, assignIdleTeams(now). Same state reference on refusal.
```
- Allowed during scanning (queues of scanned bodies) and activities; refused after `endedAt` (`runFinished`).
- Editing an ACTIVE task [PROVISIONAL, Q14]: `skip` or `assign` away during deploy / work stops the team at the edit
  instant (progress = the interpolated value, no partial segment haul), the team takes the return trip; during a fight
  the edit waits for the fight to end. Reorder never interrupts the current task.
- `autoAssign`: the body's unfinished, non-active tasks to deployed teams uniformly at random, on
  `makeRng((exp.seed ^ AUTO_ASSIGN_SALT ^ imul(editCount + 1, 0x9e3779b9)) >>> 0)` (new odd salt), appended in drawn order.
- `defaultPlan`: re-runs GO-7c's plan for that body's unfinished, non-active tasks.

**Tests:** EDIT PARITY: (advance to T in one call, edit, advance to end) deep-equals (advance to T in chunks, edit,
chunks to end); skip of the active task returns the team and keeps progress; requeue resumes from the kept progress;
autoAssign is deterministic for a given editCount and differs for the next; refused edits return the same state.

**Acceptance:** gate green. Commit `feat(0.14.0): ground ops live queue edits (Ground Ops GO-7d)`.

**Carry from GO-7d (built 2026-10-13, commit `feat(0.14.0): ground ops live queue edits and skip (Ground Ops GO-7d)`):**
- **Where it lives.** The pure core is in `groundOps.ts` ("GO-7d: LIVE QUEUE EDITS"): `GroundOpsEdit`,
  `GroundOpsEditBlockReason`, `GroundOpsEditCheck`, `groundOpsEditBlockText` (exhaustive), `checkGroundOpsEdit(exp,
  edit)` (pure) and `applyGroundOpsEdit(exp, edit, t)` (mutates the advanced clone only when valid), plus
  `groundTaskCrews(exp, taskId)` and `AUTO_ASSIGN_SALT` 0x71c3e8a9 (registered in salts.test.ts). The state-level
  `canEditGroundOps` / `editGroundOps(state, expeditionId, edit)` live in `expedition.ts` (**deviation**: they need
  `advanceExpedition`, and groundOps.ts never imports expedition.ts). Order: advance the run to
  `state.gameTimeSeconds`, validate, apply at that instant, `editCount += 1`, `groundOpsAssignIdle(now)` and the
  window-end check (both only once the window is open), then one more `advanceExpedition(now)` to settle the phase
  latches (an edit that closes the window moves the run to its return leg). A refusal returns the SAME state; the
  stored record is never mutated. Allowed in transit (only the help toggle has anything to change), scanning and
  activities; `runFinished` once the window closed. No App.svelte handler yet (GO-13).
- **Reasons (replace `notEnoughTeams`, squad-aware):** noExpedition, notGroundOps, runFinished, noSuchTask, taskDone,
  taskSkipped (assign / skip of a skipped task), notSkipped (requeue of one that is not), noSuchTeam, noSuchBody
  (Default plan / Auto-assign on an unscanned or missing body), noTasks (no queued task there), notInQueue (reorder),
  **notEnoughSquads** (the deployed squads summed cannot cover the task: e.g. re-queueing a task the plan skipped for
  squads), **crewDoesNotCover** (the named crew does not cover the needs: the SQ-3 review's "an edited joint crew
  must still cover, else it stages forever"), noChange (an edge reorder, the help toggle at its value, an assign that
  moves nothing).
- **Squad crews (deviation: optional `partners?: number[]` on assign and requeue).** The crew = `teamIndex` +
  `partners` (repeats dropped), written whole into `assignedTeamIds` (the joint flag, SQ-3 note). A team that cannot
  cover a task alone is refused (`crewDoesNotCover`) unless partners make up the squads, so on Strike + Survey every
  `{ 1, 1 }` task needs `partners`; a crew LARGER than needed is allowed (both teams on a hard solo task: a joint
  task). `groundTaskCrews` = the smallest covering crews (GO-13's choices; "Needs a partner" when none is a single
  team). Partners get the task appended (kept where they had it); every other queue drops it.
- **Edits.** `assign` (position = an index among the team's REMAINING tasks, default the end); `reorder` (one place
  among the REMAINING tasks: done ones keep their places; never interrupts); `skip` (every queue drops it; status
  skipped; progress, points and banked segments kept); `requeue` (status queued, crew and position rules as assign,
  **its loss streak and sentBack reset** [PROVISIONAL]: a deliberate new try); `defaultPlan` / `autoAssign` over the
  body's **QUEUED** tasks only (active ones untouched; a player-skipped task stays skipped [PROVISIONAL]):
  `planTasksForTeams(exp, refs, now)` (logs its skips), or the Auto-assign stream `makeRng(seed ^ AUTO_ASSIGN_SALT ^
  imul(editCount + 1, 0x9e3779b9))` with a fixed layout per task (one draw picks the next task among those left, the
  drawn order; one picks its crew uniformly among the SMALLEST covering crews; a task nobody covers is skipped with
  the plan's log line); `setHelp` (the run team's flag; a helper already on a borrowed task finishes it
  [PROVISIONAL]).
- **An active task (Q14) [PROVISIONAL].** A skip, or an assign / requeue whose crew differs from the crew in the
  field: during the DROP or the WORK the crew stops at the edit instant (progress = the value interpolated along the
  work step, nothing banked, so the cut segment is never paid), every crew team takes its ordinary return trip (joint
  partners straight to their bay, the lead offloading what was already banked), the closed step is recorded
  `stopped: true` (new optional `GroundStepRecord.stopped`). During a FIGHT the edit waits: the lead gets new
  `GroundTeamRun.recalled` (cleared at the fight's end, at idle, or when an edit gives the task back to that crew),
  the fight's result stands (a win clears its point), then the crew heads back (the fight record `stopped`); the
  task stays skipped, or turns queued for its new crew at the fight's end (it stays `active` meanwhile so two crews
  never share it). A task only STAGED releases its staging teams to idle. An assign that keeps the crew never
  interrupts (a helper on it carries on); an assign that names the crew already in the field (a helper made the
  owner, or a recalled crew given its task back) clears `borrowed` / `recalled` and carries on.
- **The escape hatch (user: retry forever, skip by hand).** Skipping every stuck task leaves no remaining task, so
  `groundOpsStuck` reads false and the window closes as the teams settle (tested on the GO-7b all-unwinnable run:
  it closes, comes home, claims). The GO-7b review staging gate is lifted ENGINE-side, but a player still has no
  button until GO-13's handler (or a dev hook) lands.
- **For GO-13:** `canEditGroundOps` advances a COPY of the run to now on every call (one `advanceExpedition`), so
  call it on Apply (or once per tick per run), not per rendered button. The handler is `doEditGroundOps(expeditionId,
  edit)` -> `editGroundOps` with the same-ref guard; texts from `groundOpsEditBlockText`; the "Assigned" choices from
  `groundTaskCrews`; a skipped task's Re-queue offers the same crews.
- Tests: new `groundOpsEdits.test.ts` (25): every refusal same-ref with its reason and plain text; an edit advances
  to now first and touches nothing else; skip during work (interpolated progress, no partial haul, return now,
  `stopped`), during the drop, during a fight (waits, result stands), skipped mid-fight then re-queued to the same crew
  (carries on as if untouched); requeue resumes from the kept progress with each segment paid once; reorder (never
  interrupts); assign at a position; assign AWAY an active task (stops, the new team finishes it); Auto-assign
  deterministic per editCount and different for the next; Default plan == planTasksForTeams (and its skip log, then
  `notEnoughSquads` on a requeue); the help toggle borrows at once; a stuck all-hard run finished by skipping; Strike +
  Survey: a reassignment that breaks coverage refused, partners accepted, skipping the active joint task mid-work
  (both teams back, the partner straight to its bay, the rest finishes), requeue needs the partner; Survey-only /
  Security-only crews; EDIT PARITY (one call to T + edit + one call to the end deep-equals 997 s chunks) on a one-team
  run (skip, Auto-assign, reorder, requeue), a Strike + Survey run with helpers (joint skip, Default plan, requeue
  with the partner, help off) and a REAL dispatched run edited while the ship still scans (plus a transit edit).
  salts.test.ts lists `AUTO_ASSIGN_SALT`. Suite 4453 -> 4478 passed (1 skipped); `npm run check` 0 errors. Legacy,
  pre-SQ-4, pre-clearing goldens and every existing parity test unchanged.
- **GO-7d review minors (commit `fix(0.14.0): GO-7d review minors`):** (1) a RECALLED crew's fight LOSS no longer
  touches the task's `lossStreak` or `sentBack` (that crew no longer holds the task, so it can never flag it stuck or
  send it back); the crew still returns as any loss does (a wipe still waits for the ship; a recalled helper still
  lists the task in `skippedBorrowed`). (2) Edit parity at 1 s chunks: one call == 997 s == 1 s chunks over 2 h of an
  edited one-team run (skip, Auto-assign, reorder, requeue). (3) Staging teams an edit releases (a skip, or an assign
  away, of a task only staged) get their staging step recorded `stopped: true`, even a zero-length one (`moveTo`
  records a zero-length idle or staging step only when it is `stopped`), so GO-14's timeline shows the moment.
  Tests 25 -> 28.
- **Staging gate (design decision f1b858e):** the GO-7b review's "do not deploy to staging" gate now waits for GO-13's
  skip button (the engine skip alone is not reachable by a player).

---

### Stage D: Ship-side scan events

### GO-8: Ship-side scan events replace scan-time ground battles (flagged runs)

**Files:** Create `src/lib/game/shipScanEvents.ts`, test `shipScanEvents.test.ts`; modify `expedition.ts`
(`rollStepBoundary` branches on `exp.groundOps`), `groundOps.ts` (`snapshotShipEventProfile` at dispatch),
`model.ts` (`ExpeditionScanEvent` fields, `ShipEventProfile`), `gambit.ts` (no change to `resolveScanEncounter`; it
stays for legacy runs).

**Behavior:** the step roll is unchanged (draw 1 = event chance via the existing `scanEncounterChance` formula, draw 2 =
supply cache) [PROVISIONAL: the Shroud / Lure dial keeps scaling it, Q11]. On a flagged run draw 1 fires
`resolveShipScanEvent(exp, body, bodyIndex, step)` instead of a ground battle. Its own stream
`makeRng((exp.seed ^ SHIP_EVENT_SALT ^ imul(scanStepKey + 1, 0x9e3779b9)) >>> 0)` with a FIXED draw layout so later
additions shift nothing: draw 1 kind (weights debris 35, probe 25, ghost 25, storm 15), draw 2 the check, draw 3 cloaked
(a ghost is a cloaked vessel at 10%), draw 4 boarding attempt, draw 5 boarding repel (draws 4 and 5 are taken and
ignored until GO-9). All numbers FIRST-PASS TUNABLE.
- `ShipEventProfile` frozen at dispatch: `evasion` (the ship combatant's evasion with officer combat applied), `sensors`
  (`exp.sensorPower`), `shieldCapacity` (combatant), `engineering` (`departmentFacet(state, ship, "engineering",
  "integrity")`, first-pass), `boardingDefense` (GO-9), and the frozen ship battle inputs `{ hullType, installedGear
  (deep copies of equippedFor), officerCombat }`.
- Debris field (pilot's evasion): pass chance from `evasion`; fail -> `pauseSeconds` DEBRIS_DELAY_SECONDS and a recorded
  `hullWear` (display only) [PROVISIONAL, Q12].
- Hostile probe / drone: `resolveBattle` on the existing combat engine: the frozen player ship vs a small probe enemy
  built through `shipToCombatant` from a new data entry (stats scaled by the body's hazard), the probe SOFTENED by
  `exp.ambushSoften` (Security Cunning moves here: hull, shield and weapon damage x (1 - soften)); battle seed on its own
  salt PROBE_BATTLE_SALT. Win -> salvage finding (`rollHaul` at PROBE_SALVAGE_SCALE, source `"encounter"`); loss ->
  `pauseSeconds` PROBE_REPAIR_SECONDS (the ship repairs in the field) [PROVISIONAL, Q12].
- Sensor ghost (Science + sensors): pass -> `bonusDiscovery: true` (when the body completes, ONE extra discovery is
  appended from its own stream GHOST_FIND_SALT, never the body's discovery stream); fail -> lost scan progress expressed
  as `pauseSeconds` (re-scanning) [PROVISIONAL amount, Q19]. Cloaked vessel (rare ghost, user idea + D26): a probe-style
  fight against a stronger cloaked hull, sensors add to the player's opening odds (first-pass: the check passes = the
  player strikes first); win -> a bonus find, loss -> repair pause.
- Radiation storm (Engineering + shields): pass chance from `shieldCapacity * (1 + engineering)`; fail -> slowdown
  as `pauseSeconds` STORM_SLOW_SECONDS.
Every negative outcome is a `pauseSeconds`, so the existing scan walk (`pauseAt`, `encounterScanDurationSeconds`) times
it exactly and offline == live holds unchanged. Nobody is downed during scanning (no ground fight), so
`scanDownedBefore` stays legacy-only.

**Tests:** each kind fires on some boundary over a seed sweep; legacy (unflagged) runs still fight ground encounters
(golden hashes from GO-7b stay green); the probe battle is deterministic and softer with `ambushSoften`; a ghost's bonus
discovery adds exactly one task and does not change the body's other discoveries; parity (big == chunked) on a flagged
scan with a pause; the fixed draw layout (stubbing boarding draws changes nothing else).

**Acceptance:** gate green. Commit `feat(0.14.0): ship-side scan events replace scan ground battles (Ground Ops GO-8)`.

**Carry from GO-8 (built 2026-10-13, commit `feat(0.14.0): ship-side scan events with light ship damage (Ground Ops
GO-8)`):**
- **`shipScanEvents.ts`** (new; imports model, combat/*, gambit rollHaul / scanStepKey, crewOverlay, equipment,
  officerStats, diminishing, relics; never expedition.ts or groundOps.ts). Salts `SHIP_EVENT_SALT` 0x5c9e2b47,
  `PROBE_BATTLE_SALT` 0x3d71a6e9, `PROBE_SALVAGE_SALT` 0x6f2c84b3, `GHOST_FIND_SALT` 0x1a9d5e77 (registered in
  salts.test.ts). The FIXED five-draw layout per boundary (`shipEventDraws`): draw 1 the kind (`nextInt(100)`, debris
  35 / probe 25 / ghost 25 / storm 15), draw 2 the check, draw 3 cloaked (a ghost is a cloaked vessel below
  `GHOST_CLOAKED_CHANCE` 0.1), draws 4 and 5 boarding (taken, unread until GO-9); a test stubs 4 and 5 and nothing else moves.
- **THE FLAG.** `ShipEventProfile.battle?: ShipEventBattle` (frozen at dispatch: hullType, the installed COMBAT pieces
  as deep copies (absent when the ship carries none: it fights with its hull's default loadout [PROVISIONAL]), the
  officers' combat PROFILE (crewOverlay.ts officerCombatProfile) and the folded hullMax). `snapshotGroundOps` now
  writes the real profile (`snapshotShipEventProfile`: evasion, sensors, shieldCapacity, Engineering Integrity,
  boardingDefense 0 until GO-9, battle). `shipEventsLive(exp)` = battle present. A flagged run dispatched before GO-8
  carries `NEUTRAL_SHIP_EVENT_PROFILE` (no battle) and still rolls draw 1 at chance 0 (its exact shape; the pre-SQ-4
  and pre-clearing goldens pass through the new fixture `withoutShipEvents`, which `withoutRisk` and `withoutClearing`
  now apply: those runs never had ship events). Legacy runs keep Task 14's ground battles (goldens untouched).
- **The roll.** `scanStepRoll` on a ship-event run fires draw 1 at `shipScanEventChance` (expedition.ts: the same
  `encounterChance` formula, the Shroud / Lure dial [PROVISIONAL, Q11], Evasive Command; nobody sits out); the supply
  cache (draw 2) is unchanged. `rollStepBoundary` reads the ramps at WALL time (`flaggedHoursAt(exp,
  scanClockToTime(ops, at))`, the GO-7b carry note), and the battle ship is rebuilt from the frozen inputs at that
  hour (`officerCombatModsFromProfile(profile, hoursOut)`: the officers' Constitution ramp) carrying the run's damage.
- **The events (all [PROVISIONAL]; checks use the odds form 1 - (1 - base) / (1 + diminishing(power, 1)), never
  certain):** DEBRIS base 0.5, power = evasion share x 10; fail = `DEBRIS_DELAY_SECONDS` 120 + hull wear 4% of
  hullMax. PROBE: `resolveBattle` (precharge) of the ship vs `HOSTILE_PROBE_HULL` (90 hull / 30 shield / 2 recharge,
  autocannon, aggressive) x (1 + resisted hazard) x (1 - `exp.ambushSoften`) on hull, shield and weapon damage; win =
  salvage (`rollHaul` x 0.4, source "encounter", no relic, id `<exp>-find-ship-b<i>-s<k>`); loss (a draw too) =
  `PROBE_REPAIR_SECONDS` 300 + 8% wear. GHOST: base 0.4, power = sensors / 40 (sensors fold the Science officer and
  division); pass = `bonusDiscovery` (one discovery appended LAST when the body completes, on `GHOST_FIND_SALT`
  keyed by the boundary: draw the pool when both have candidates, then the PoI; the body's other discoveries are
  untouched); fail = `GHOST_RESCAN_SECONDS` 180 [Q19]. CLOAKED: the sensor check decides who ambushes (pass: the ship
  strikes first; fail: the vessel does), vs `CLOAKED_VESSEL_HULL` (220 / 100 / 4, autocannon + railgun) scaled the same
  way; win = salvage x 0.8; loss = 420 s + 12% wear. STORM: base 0.5, power = shieldMax x (1 + Engineering
  Integrity) / 300; fail = `STORM_SLOW_SECONDS` 240. Every negative outcome is a `pauseSeconds`, so the scan walk
  times it exactly (tested: scan end = bodies + pauses + legs).
- **Light hull damage (user Q12).** `ExpeditionScanEvent.hullWear` is summed on `GroundOpsState.hullDamage`; at claim
  `applyShipEventDamage` marks the ship `damaged` and adds the whole points to `repairDamage`, so the Shipyard's
  auto-repair (tick.ts processShipRepairs) repairs it. Note: a ship already mid-repair when it is claimed has the
  added points cleared with that repair (the duration was fixed at its start).
- **Model:** `ExpeditionScanEvent.kind` gains "shipEvent" with `event` (`ShipScanEventKind`), `outcome` pass / fail /
  win / loss, `hullWear`, `bonusDiscovery`, `boarding?` (GO-9); `ShipEventBattle`; `GroundOpsState.hullDamage?`.
- **The telescope preview** (launchPreview.test.ts) compares the run with its ship events off: a ghost's bonus find
  is a scan EVENT the telescope cannot foresee; it joins after the previewed tasks (shipScanEvents.test.ts pins it).
  **Question for the user:** fine that the forecast counts the system's tasks and a ghost can turn up one more?
- **GO-7b's parity file** pins its scenario with `withoutShipEvents` (it is about the window); the new parity lives in
  shipScanEvents.test.ts. Observed on 60 fresh-freighter runs: the hostile probe never beat the starting freighter (its
  default autocannon); the cloaked vessel wins about half; balance-pass item.
- Tests: new `shipScanEvents.test.ts` (17: the draw shares, the fixed layout, the check curve, the gate both ways and
  the supply cache's draw, every kind and outcome on four pinned real runs, pauses and wear, salvage and the ghost's
  one discovery, the scan's length, the claim's damage and the Shipyard repair, battle determinism, hazard and
  softening, the lost battle, parity one call == 997 s == 1 s over the scan plus the whole run at 997 s on each
  pinned run); salts.test.ts +4 names; groundOps.test.ts (the real profile). Suite 4481 -> 4498 passed (1 skipped);
  `npm run check` 0 errors. Legacy, pre-SQ-4, pre-clearing goldens unchanged; no-dead-stats unchanged.

### GO-9: Boarding attempts (D26)

**Files:** `shipScanEvents.ts`, `groundOps.ts` (profile), `no-dead-stats.test.ts`, test `shipScanEvents.test.ts`.

**Behavior:** on a probe or cloaked event, draw 4 decides an attempt (BOARDING_ATTEMPT_CHANCE 0.25), draw 5 the repel:
chance = clamp(BOARDING_REPEL_BASE 0.5 + `boardingDefense` * BOARDING_DEFENSE_COEFF, 0.05, 0.95), where `boardingDefense`
= `shipCrewContribution(state, ship)[crew.boardingDefense]` frozen at dispatch (the Security division's Boarding
Defense, the Ossir racial, Strength's facet through the crew rollup). Repelled -> recorded only. Not repelled ->
`pauseSeconds` BOARDING_PAUSE_SECONDS [PROVISIONAL, Q13]. Record `boarding: { repelled }` on the event.

**no-dead-stats:** add a scan-event probe (a flagged run seeded to hit a boarding attempt) and remove
`crew:crew.boardingDefense`, `racial:ossir`; handle `facet:tactical:strength` per section 3.

**Tests:** more boarding defense, higher repel rate over a seed sweep; a boarding-free run is identical with and without
the profile value; draws 1 to 3 unchanged by this task.

**Acceptance:** gate green, including `no-dead-stats`. Commit `feat(0.14.0): boarding attempts on ship scan events (Ground Ops GO-9)`.

**Carry from GO-9 (built 2026-10-13, commit `feat(0.14.0): boarding attempts (Ground Ops GO-9)`):**
- **The profile.** `ShipEventProfile.boardingDefense` = `shipCrewContribution(state, ship)[crew.boardingDefense]`
  (floored at 0), frozen at dispatch by `snapshotShipEventProfile`: the Security division's Boarding Defense buff,
  the Ossir racial, and the Tactical officer's Strength through the Security division rollup. No new flag: draws 4
  and 5 were always taken (GO-8), so a ship-event run's other outcomes are unchanged; only the boarding record and its
  pause and loss are new (no GO-8-only run was ever deployed).
- **The rule [PROVISIONAL numbers].** On a PROBE or CLOAKED-VESSEL event (whatever the battle's result), draw 4 <
  `BOARDING_ATTEMPT_CHANCE` 0.25 is an attempt; draw 5 < `boardingRepelChance(bd)` repels it, where the chance is
  the odds-form check `1 - (1 - 0.5) / (1 + diminishing(bd x BOARDING_DEFENSE_SCALE 4, 1))` (0.5 with no defense,
  rising on the D23 curve, never certain; the plan's clamp(0.5 + bd x coeff, 0.05, 0.95) was replaced by the D23 form:
  "diminishing returns, not caps"). Repelled: `boarding: { repelled: true }`, recorded only. Not repelled (user Q13):
  the event's `pauseSeconds` grows by `BOARDING_PAUSE_SECONDS` 300, and `boarding.creditsLost` =
  floor(`BOARDING_CREDIT_LOSS_SHARE` 0.1 x the credits the run's findings hold, the event's own salvage included),
  taken off the newest findings first by `takeBoardingLoss` (expedition.ts rollStepBoundary, after appending the
  salvage), never below zero and never the player's bank. Credits only [PROVISIONAL: the user said "cargo or
  credit"; materials are never taken].
- **no-dead-stats:** new probe "ship scan events" (per dispatch: `boardingRepelChance` on the frozen profile and one
  forced boarding event). Removed `crew:crew.boardingDefense`, `racial:ossir` and `facet:tactical:strength` (section
  3: it turned live through Boarding Defense; Away-Team Protection and Counter-Infiltration, the other Security
  division buffs it scales, still wait on Task 23 under their own entries); the `GROUND_OPS_BOARDING` phase constant
  is gone.
- Tests: `shipScanEvents.test.ts` 17 -> 23 (the repel curve, the Ossir racial in the frozen profile, attempts only on
  probe / cloaked events and more defense repelling more over a sweep, a not-repelled boarding's pause and newest-first
  credit loss (repelled: recorded only), a real run losing credits that a strong defense keeps, a boarding-free run
  identical at any defense); the GO-8 layout and pause tests now account for a boarding's pause. The GO-8 parity
  seeds include a run with a repelled and a not-repelled boarding (one call == 997 s == 1 s over the scan). Suite
  4510 -> 4516 passed (1 skipped); `npm run check` 0 errors; `RELEASE_GATE` lists no Ground Ops entry from GO-9.

**Carry from the GO-8 / 8b / 9 review (2026-10-14, commit `fix(0.14.0): a damaged ship cannot launch an expedition;
integer outcome draws (GO-8 review)`):**
- **USER RULING "Must be repaired first" (the patrol rule).** New `ExpeditionDispatchBlockReason` `shipDamaged`
  (checked after `shipAlreadyOnExpedition`): `expeditionShipDamaged(state, ship)` = `ship.damaged` or a running
  Shipyard `shipRepair` process for it. Text "Ship is damaged, repair it first" (the patrol gate's wording); detail
  line `expeditionShipRepairText`: "Repairing: ready in 4m" (the process's remainingTicks x tickDurationSeconds,
  format.ts formatCountdown) or "Damaged: waiting for a free Shipyard repair bay". ExpeditionPanel disables Launch and
  shows both. This closes the free-repair glitch (a damaged ship launching, its Shipyard repair then clearing the
  expedition's damage at claim) and full-hull ship-event fights on a damaged ship. The candidate list and the launch
  view (recommendation, forecast) still read on a blocked ship (display only; they simulate the launch as if
  repaired). save.test.ts's v67 -> v68 replay now strips ship events from its v67-era run (`withoutShipEvents`: a v67
  build froze no battle inputs); with them its brought-home damage would rightly hold the next dispatch.
- **Integer outcome draws (review Minor 2, combat/rng.ts integer-first).** Draws 2 to 5 are now
  `nextInt(SHIP_EVENT_DRAW_UNITS)` (1,000,000) compared against `chanceUnits(chance)` (the chance x the units,
  rounded, clamped): still one step per draw, the same FIXED five-draw layout. Checked over 120 fresh-freighter runs:
  every scan event is identical to the float version, so no GO-8 / 8b / 9 test seed moved (none re-pinned); the
  stubbed-draw tests now stub integers. Legacy and pre-GO-8 goldens untouched (they take no ship-event draw).
- **[PROVISIONAL, user list, Q11]** the Security squad's Shroud Emitter / Lure Beacon dial scales the ship-event
  chance (it was built for the scan ground battles).
- **For GO-18 (Help):** a sensor ghost's bonus find cannot be forecast (the telescope preview and the launch forecast
  count the system's tasks; a ghost read true adds one more when its body completes).
- **Balance note:** across 60 fresh-freighter runs the hostile probe never beat the starting freighter, while the
  cloaked vessel wins about half; tune the probe hull (or scale it by region tier) in the balance pass.
- Tests: shipScanEvents.test.ts 23 -> 26 (damaged and waiting, under repair with its countdown, a repair process alone
  holds it, repaired launches again, the candidate list and launch view read while blocked). Suite 4516 -> 4519
  passed (1 skipped); `npm run check` 0 errors.

---

### Stage E: UI (mockup-referenced; each verifies in the preview, desktop + 375 px)

Preview loop: `preview_start({name:"dev"})` -> localhost:5173, `?dev` for Debug (Offline sim, grants). Origin must be
HyperionLegacy.git. Console clean. Screenshot desktop and mobile for the controller.

### GO-10: Shared ground-ops UI atoms

**Files:** `src/lib/ui/icons.ts` + `iconPacks.ts` (glyphs: `groundTeam`, `fightPoint`, `medBay`, `offload`, `reload`,
`deploy`, `shipDebris`, `shipProbe`, `sensorGhost`, `radiationStorm`, `boarding`, `threatDot`), new
`src/lib/ui/ThreatChip.svelte` (tier `colorHex` + dot glyph + `shortName`, full name + `fuzzyRange` + `voice` in a HelpTip;
NO emoji, unlike the patrol chip, see Q17), new `src/lib/ui/TeamBadge.svelte` (A / B / C badge, GO-M1 `.badge`).
**Acceptance:** glyphs reviewed at 16 / 28 / 56 px (screenshot); gate green. Commit `feat(0.14.0): ground ops glyphs + threat chip (Ground Ops GO-10)`.

**Carry from GO-10 (built 2026-10-14, commit `feat(0.14.0): ground ops glyphs + threat chip (Ground Ops GO-10)`):**
- **Glyphs (icons.ts, each classified in ICON_SEMANTICS).** The plan's twelve: `groundTeam`, `fightPoint`, `medBay`,
  `offload`, `reload`, `deploy`, `shipDebris`, `shipProbe`, `sensorGhost`, `radiationStorm`, `boarding`, `threatDot`.
  The squad redesign's (SQ-7): `strikeTeam`, `surveyTeam`, `telescope` (a radio dish: the Precursor Lens relic already
  owns the tripod telescope), `riskCombat` (crosshair), `riskFauna` (paw), `riskFlora` (leaf), `riskHazard` (a hazard
  diamond, kept apart from `warning`'s triangle), `blindLaunch` (eye struck through), `lock`, `flag` ("Pick a type").
  For GO-15's scan pips: `cloakedVessel` (the delta in broken strokes) and `supplyCache` (a lidded crate).
  Classes: `threatDot`, `lock`, `flag` are `alert`; `offload`, `reload`, `deploy` are `action`; the rest `subject`.
- **Team kind glyphs** are the PAIR of squads they hold: a front emblem lower left, a back emblem upper right with its
  hidden part knocked out (shield = Security, flask = Science). Ground = shield + flask, Strike = two shields, Survey =
  two flasks. `groundOpsAtoms.ts TEAM_KIND_GLYPHS` maps `GroundTeamKind` to them (exhaustive).
- **`threatDot`** is a solid disc drawn stroke-only (concentric rings closer than the stroke width), so the
  stroke-only contract holds and the dot takes the tier color through currentColor.
- **Redrawn during the 16 px review:** `boarding` (a grappling hook read as an anchor; now an arrow driving into the
  delta's flank), `fightPoint` (pommels and wide guards turned it into a hash mark; kept blades + short guards),
  `deploy` (an exhaust trail made a stick figure; dropped), the team kind pairs (emblems enlarged), `threatDot` (center
  pinhole plugged). Sheets reviewed at 16 / 28 / 56 px on the dark theme, the white accent theme and a light ground.
- **ThreatChip.svelte** (`assessment`, `full`, `context`, `size` md / sm, `maxWidth`): band color border + wash, the SVG
  dot, the short name (or the full name with `full`); the shared HelpTip bubble shows the full name (when the face is
  short), the odds phrase and the officer's line; the trigger's accessible name is the whole readout ("Team A odds: A
  Worthy Adversary. ..."). GO-13 cells: `<ThreatChip assessment={...} size="sm" context="Team A odds" />`.
- **HelpTip gained two optional props, back-compatible:** a named `tip` slot (rich bubble content; `text` stays the
  fallback) and `buttonLabel` (overrides "What does X do?" for a chip that is a readout).
- **TeamBadge.svelte** (`index`, `kind?`, `name?`, `size` md / sm): the GO-M1 `.badge` square (display font, accent
  letter, the app's `--corner`), the letter by position (`groundTeamShortLabel`), the kind glyph beside it when given;
  `role="img"` with "Bravo, Strike team" / "Team A" as the name.
- **Patrol chip converted (GO-6 note):** both App.svelte sites (the patrol row statline, capped at 190 px via
  `maxWidth`, and the Dispatch popup's Threat assessment row) now render `<ThreatChip ... full />`. The old
  `.threat-chip*` / `.threat-tooltip*` CSS is deleted; the bubble is now HelpTip's (portaled, flips above near the
  fold) instead of the hand-rolled absolute tooltip. The `ThreatAssessment.icon` emoji field is REMOVED (no reader
  left; standing rule). Same visible name, same accessible name, same odds phrase and voice. In passing: the patrol
  placeholder "Threat &mdash; pick a captain to assess" now reads "Threat: pick a captain to assess" (no em dash).
- **Not converted (existing prod emoji, outside GO-10):** the patrol row's leading glyph (`mpane-glyph`, a crossed
  swords emoji) could take `fightPoint` in a later pass.
- **Contrast note for the user:** the Impossible tier's literal `#7f1d1d` reads dim on the dark panel (an existing
  ramp color, unchanged here; the ramp is user-approved and theme-independent by design).
- Tests: `icons.test.ts` +2 (the GO / SQ set is registered; no two names draw identically), new
  `groundOpsAtoms.test.ts` (8: every tier's chip view has the dot, the band color and no emoji or em dash; short vs
  full; the patrol accessible name; badge letters by position, kind glyphs, names), `threatAssessment.test.ts` shape
  test asserts `shortName` and that no `icon` field remains. Suite 4519 -> 4529 passed (1 skipped); `npm run check` 0
  errors (the 2 known RadialWeb warnings).

### GO-11: Ground team slotting in AwayTeamPanel (mockup GO-M1)

**Files:** `src/lib/AwayTeamPanel.svelte`, `src/App.svelte` (`doSlotMember`, `doUnslotMember`, `doRenameGroundTeam`,
`doSetGroundTeamHelp`).
**Behavior:** one card per ground team (badge + name + Rename; Security squad slots then Science squad slots, empty slots
dashed "Empty slot"; GO-M1 layout); each filled slot shows the member (existing member card condensed) with Unslot;
an empty slot opens a picker of that ship's unslotted members of the matching type (pick, then Slot button); an
"Aboard, not slotted" reserve section lists unslotted members (they do not deploy, said in plain words); "When done, help
other teams" toggle per team (ship default for the next dispatch). Locked while on a mission (reason text from
`groundSlotBlockText`; rename stays enabled). Header copy replaces the Task 6 line (Security fights during TASKS, Science
does the task fieldwork; scanning is ship-side). The member gear install flow is unchanged.
**Verify:** slot / unslot / rename / toggle on the Aurora; reload keeps them; mobile slot grid is 2 columns (GO-M1 rule).
Commit `feat(0.14.0): ground team slotting UI (Ground Ops GO-11)`.
**Squads SQ-2 note (2026-10-12):** GO-11 lands AFTER SQ-2 (squads design doc, SQ-2 carry note): every team is now
kind-sized (Ground / Strike / Survey), the slot / swap actions already respect each team's kind, and the composition
picker builds on `setGroundTeamKind` / `previewGroundTeamKind` with `shipCrewRoom` for the per-type caps.

### GO-12: Dispatch console: ground teams that will deploy

**Files:** `src/lib/ExpeditionPanel.svelte`.
**Behavior:** the dispatch strip lists each team that will deploy (badge, name, Security / Science ready counts) and
each team that will not, with why (no ready Science, and so on); the block reason text from GO-7b.
Commit `feat(0.14.0): dispatch shows deploying ground teams (Ground Ops GO-12)`.

### GO-13: Per-planet task queue screen with odds per team (mockup GO-M2)

**Files:** new `src/lib/GroundTaskQueue.svelte`, `ExpeditionPanel.svelte` (in-progress view, per scanned body),
`App.svelte` (`doEditGroundOps(expeditionId, edit)` through `editGroundOps`).
**Behavior:** per body: title (body name + planet type), task count; table: Task, Fights, one odds column per deployed
team (ThreatChip from `groundTaskThreat`, memoized per (expedition, task, team, pointsCleared)), Assigned (select +
Apply, or Skip / Re-queue), up / down reorder within the team's queue; header buttons "Default plan" and
"Auto-assign randomly" (user's words); note line "Nothing ever waits for you; reorder, reassign or skip at any time".
Table scrolls horizontally inside its own wrapper on a phone (GO-M2 `.tw`), never the page.
**Verify:** with Debug grants, dispatch, Offline-sim to a scanned body; reassign, skip, auto-assign; odds render;
console clean. Commit `feat(0.14.0): per-planet task queue screen (Ground Ops GO-13)`.

### GO-14: Team timelines + task cards + bay card (mockups GO-M3, GO-M4)

**Files:** new `src/lib/GroundTeamTimeline.svelte`, new `src/lib/GroundTaskCard.svelte`, `ExpeditionPanel.svelte`.
**Behavior:** one lane per team from `groundOps.history` + the live step (segments: working, fight, wipe, travel,
offload / reload, medical bay, idle; key row; GO-M3 colors as theme tokens). Task card: title, state chip (Queued, In
progress, Paused: team in med bay, Done, Skipped), progress bar with fight pips (won / pending / wiped here), haul
banked vs offloaded line, the assigned team badge (GO-M4 left). Bay card for a team in the bay: one bar per member
condition with time, the longest highlighted, "Bay time: N (the longest one)", the Stoneskin note on Ossir members (GO-M4
right). The activities phase label reads "Ground Operations" [PROVISIONAL copy]. Battle log per fight via a lazy
re-derivation (`resolveTaskFight` with a log sink; display only).
Commit `feat(0.14.0): team timelines, task cards, med bay card (Ground Ops GO-14)`.

### GO-15: Scan track: ship-event pips + log lines (absorbs Task 17's scan track)

**Files:** `ExpeditionPanel.svelte`.
**Behavior:** per-body scan track with pips from `scanEvents` (debris, probe, ghost / cloaked, storm, supply cache,
boarding), each with its outcome and pause; log lines in plain words. Legacy runs keep the ground-encounter pips
(`deriveScanEncounterLog`). Uses EC-M section 5 layout; new glyphs from GO-10.
Commit `feat(0.14.0): ship-event scan track (Ground Ops GO-15)`.

### GO-16: Per-member gambit editor by ground team (absorbs Task 17's editor)

**Files:** `src/lib/GambitEditorPanel.svelte`, `App.svelte`.
**Behavior:** pick a ship, a ground team, then a Security member; edit that member's program; "Apply preset"; "Copy to
squad" (that team's Security squad); the Science tab is removed; the inert account pair gets a one-line notice (Task 17
must "decide the account pair's future": keep it stored and hidden, flagged in Q21). EC-M gambit section.
Commit `feat(0.14.0): per-member gambit editor by ground team (Ground Ops GO-16)`.

### GO-17: Squad Loadouts per ground team (reshaped Task 18)

**Needs a sketch first** (no mockup covers it; feedback rule "visual UI needs mockup"). Do not build the UI half until
the user signs off; the engine half can land first.

**Files:** `src/lib/game/armory.ts`, `App.svelte` (Armory tab "Squad Loadouts"), `personnelRosters.ts` (S4-CP39), tests
`armory.test.ts`.
**Behavior:** `createGroundTeamLoadout(state, shipId, teamIndex, name)` snapshots the team's slotted members' installed
pieces into kits in slot order (committing them like ship loadouts); `applyGroundTeamLoadout(state, loadoutId, shipId,
teamIndex)` installs kits onto the slotted members in slot order, skipping and REPORTING missing / locked /
unique-conflict / wrong-team pieces (never forcing); `checkInGroundTeamLoadout`. Counts against the shared `loadoutCap`.
`SquadLoadoutKit` gains an optional `consumables?` slot left empty for Task 16b's Squad Kit. Carried from Task 18:
`applyRoster` applies its linked SHIP loadout (S4-CP39).
**Tests:** round trip restores the same kits; a unique conflict is skipped with a reason; the cap is shared; refused
while the ship is on a mission.
Commit `feat(0.14.0): ground team loadouts (Ground Ops GO-17, reshapes Task 18)`.

### GO-18: Help topics

**Files:** `src/lib/helpTopics.ts` (+ the existing shape test).
**Behavior:** new topic `groundOperations`: ground teams (Alpha / Bravo / Charlie, rename, slotting, reserve aboard), the
D18 minimum per team, tasks appear after a planet's scan, queues + default plan + Auto-assign randomly + edits apply
from now, progress persists and the team resumes at the fight that stopped it, haul kept per finished segment and the
relic at 100%, the return trip (offload, medical bay, reload) and what speeds each (unload bonus; Rapid Loadout and
Efficient Stowage; Medical crew, Rapid Recovery, the Medical officer), the cure-time table, Stoneskin, helpers and their
floor, the 7 threat tiers (chance to clear the whole task in one go; display only). New topic `scanEvents`: the four
ship-side events, what resolves each, boarding. Text rules apply (no em dashes, US English, "install").
Commit `docs(0.14.0): Ground Operations help topics (Ground Ops GO-18)`.

### GO-19: Close-out (docs + review + QA)

1. Annotate the E-CREW plan: Tasks 14, 16, 17, 18 and the 16b steps of section 1 get a "SUPERSEDED / ABSORBED by Ground
   Operations (plan 2026-10-09)" note; the Task 22 carry notes list which entries GO removed; add a Task 16b carry note
   for the Stoneskin battle half and the `treatmentShare` / loadout `consumables` hooks.
2. Update the design doc section 10 (open calls answered by 9b; call 6 moot) and add any answers to section 5 below.
3. Holistic review (bug-check subagent, then full-ledger fix pass), then the QA sheet below to the user. Deploy only
   after the user confirms.
Commit `docs(0.14.0): Ground Operations close-out notes`.

---

## 4b. USER ANSWERS (2026-10-12), override the matching Q below and the GO tasks that use them

- **Q1 Overlap: YES**, with a rule (verbatim): "If a task is lost while the ship is off scanning, the ship should
  have to return and retrieve the ground team that ran into trouble, delaying the scanning steps. Rightfully so, of
  course. Can't leave them to die." So teams work a scanned planet while the ship scans the next; a WIPE while the
  ship is elsewhere makes the ship break off, fly back and recover the team (a recovery leg), and scanning resumes
  after. GO-7b/7c must model the ship's position and the recovery leg.
- **Q4 Stuck run: HOLD AND FLAG.** Keep retrying as decided, but the expedition card shows a clear "Stuck: needs a
  stronger team or a skip" flag. No automatic giving up.
- **Q5 HP: CARRY DAMAGE** between the fights of one task; full recovery only in the ship's medical bay on the return
  trip. Medics and first aid matter mid-task.
- **Q12/Q13 Event stakes: LIGHT SHIP DAMAGE** (debris and a lost probe fight leave a little hull damage; a failed
  boarding repel = a scan pause plus a small cargo or credit loss) PLUS a new requirement, **EXPEDITION FIELD REPAIR**
  (verbatim): "if the ship gets too heavily damaged, then basically having to limp home at a reduced speed for 6+
  hours sucks. Here's an idea. WWVD. What Would Voyager Do? They'd find a planet with atmosphere nearby and set a
  course. Then land and conduct repairs and so forth. I think we'd have to do the same in this case. Because returning
  home wouldn't make any sense. So we'd not want to soft-lock or force someone to return home. That'd feel awful. I'd
  never want to touch a mission without a 100% chance of succeeding, if I risked wasting so much time like that."
  So: a damaged ship on an expedition NEVER has to go home; it sets down at a suitable in-system body (a rocky world
  with an atmosphere; never a gas giant, D22) for a timed field repair (Engineering crew/officers speed it), then
  resumes the run. **[PROPOSAL, to confirm]** it triggers automatically past a damage threshold (or by the player any
  time), and if the system has no suitable world the ship repairs in orbit, slower. New task **GO-8b** below.
- Remaining Q2, Q3, Q6-Q11, Q14-Q22: build with the plan's [PROVISIONAL] defaults (each in one named constant or
  function); they are surfaced to the user as a list of defaults to override.

- **Not-ready slotted members (user, 2026-10-12, verbatim):** "You will have to swap one member out for another if
  that member is not ready. Otherwise, the team will not dispatch. The attempt to dispatch can show what we're waiting
  on in order to dispatch (x turns until this member returns to duty, etc)." So: NO automatic stand-ins. A ground team
  with any slotted member who is not ready (injured or otherwise) does not deploy; the dispatch attempt lists what it
  is waiting on with the time remaining ("Grokk returns to duty in 12m"). The player swaps members by hand. A ship
  whose ground teams cannot meet D18's minimum cannot launch, and says why.
- **GO-1 review (2026-10-12):** GO-2 auto-slots a member into the first empty slot on EVERY arrival aboard (hire,
  reassign, unbench), never by an every-load reconcile (which would undo a deliberate unslot). Reconcile the plan's
  "a full team leaves the hire unslotted (reserve)" with the existing hire cap (`squadGate`): decide whether GO-2
  lifts the cap to allow reserves (a member aboard but unslotted). `shipGroundTeams` should return a normalized copy
  (lengths match the hull) and callers never mutate it; ships built after v67 get their teams through it.

- **GO-2 review (2026-10-12), carried forward:** (a) PROVISIONAL, surfaced to the user: the "help other teams" toggle
  may change while the ship is out (it is only the next dispatch's default). (b) GO-3 folds in two minors: write paths
  null out slot ids that do not name a member aboard (so auto-slot never skips a corrupt slot), and the default-name
  match in `renameGroundTeam` is case-insensitive with a code-point-safe 24 character cut. (c) GO-11 wording: when a
  member was deliberately unslotted, hire says "Squad is full" while an empty slot shows, because reserves count toward
  the hire cap; explain that in the UI. (d) The GO-1-window staging fix is: bench, then unbench (re-slots the member).

- **GO-4 questions, coordinator rulings (2026-10-12):** (a) Science Integrity (`exp.hazardSteady`) stays SCAN-only, as
  the user-approved per-seat table says ("scanning a hazardous world"); task work does not read it. (b) The even
  `AWAY_RECRUIT_SEED_SALT` stays as a documented exception (changing it would reroll recruit offers). (c) GO-7b passes
  only members still standing in the task to `taskWorkSeconds` (a downed member sits out the rest of the task, so their
  suit stops counting). (d) GO-5 exports the four unregistered salts (tick.ts MISSION_OUTPUT_ROUNDING_SALT, relics.ts
  RELIC_STUDY_SALT, salvage.ts SALVAGE_ROUNDING_SEED_SALT, seniorStaff.ts OFFICER_STAT_SEED_SALT) and adds them to
  salts.test.ts.

- **GO-4 review, carried to GO-5 (2026-10-12):** export the four unregistered salts and add their modules to
  salts.test.ts (OFFICER_STAT_SEED_SALT is EVEN: distinct-only list, like AWAY_RECRUIT); comment that taskRewardSeed's
  multiplier 0x27d4eb2f equals RELAUNCH_SEED_SALT in a different role; NaN-guard taskWorkSeconds; and the user's hazard
  ruling: `resistedHazard`'s summed resist approaches the 0.75 cap on a diminishing curve instead of clamping (affects
  scans and task work; update affected expectations with a justification, parity stays exact).

- **GO-5 review (2026-10-12):** (a) the hazard curve (15d3c37) is a NAMED EXCEPTION to section 0's "legacy-neutral"
  rule (user-ruled); GO-7b's legacy goldens are captured WITH the curve. (b) GO-6 folds in a display fix: the museum
  relic readout (relicIcons.ts ~109) and the EquipmentTooltip "Hazard Resist" label (~218) show the EFFECTIVE resist
  (or "raw X, effective Y"), not the raw sum. (c) GO-19's list of defaults for the user adds: carried statuses keep
  their remaining rounds between fights, the team kit refills every fight, the carried HP floor is 1.

- **GO-6 notes (2026-10-12):** GO-10 converts the patrol threat chips' EMOJI to SVG glyphs (standing rule: graphics are
  SVG via icons.ts + ICON_SEMANTICS, never emoji; this is an existing prod gap, fixed alongside the new ground chip).
  GO-18 Help says hazard resist sources combine BEFORE the diminishing curve, so several sources add up to slightly
  less than their individual readouts.

- **GO-7b answers (user, 2026-10-12):** (a) BACK OF THE LINE: after 3 losses in a row on a task, it moves to the back
  of that team's queue so easier tasks get done first; it comes back around later; the Stuck flag shows when only
  such tasks remain. (b) LATE WIPES: after the system is fully scanned, a wiped team still waits for the ship to come
  get them (the 5 minute leg), consistent with "can't leave them to die"; nothing else is delayed. (c) Leg length:
  keep 300 s each way.
- **GO-7b review gating (2026-10-12):** do NOT deploy to staging between GO-7b and GO-7d: there is no skip / recall
  action yet, so a run whose every remaining task is unwinnable holds its ship, crew and captain. GO-7d lands the
  skip; consider a dev-only recall if staging is needed sooner.

- **GO-7c review (2026-10-12), carried forward:** (a) rank teams on SOLO tasks only in planTasksForTeams; (b) cache an
  idle helper's threat reads per (task, fightCount, pointsCleared) if long catch-ups get slow; (c) a joint return makes
  every crew team spend offload time though one pays: revisit in the squad redesign; (d) ask the user (with Q20): one
  shared pickup leg for a joint wipe on one body, or one leg per wiped team (built). The staging gate until GO-7d stands.

- **GO-7d coordinator calls (2026-10-13):** the staging gate now waits for GO-13's skip button (the engine skip alone
  does not help a player); `partners` is the joint-crew API for assign / requeue; a requeue resets the stuck streak as a
  deliberate new try (as built).

- **GO-10 calls (user, 2026-10-14):** (a) BRIGHTEN the Impossible threat tier (the ramp may brighten slightly too);
  worst case keep the color and add a glow ("dude. You're going to die." is the INTENT only: never in game
  text or flavor; the presentation carries it, user 2026-10-14); (b) the patrol row's crossed-swords emoji
  becomes the SVG fightPoint glyph. The user will run their own nitpicking QA pass after 0.14.0 development.

### GO-8b: Expedition field repair (WWVD)
Files: expedition.ts (a repair leg in the run timeline), combat repair math (reuse the Shipyard repair formula and the
Engineering repair divisor: Rapid Recovery, Veteran Instincts, Engineering Constitution), model.ts (Expedition fields:
repair legs, frozen at the moment they start), ExpeditionPanel (a "Setting down for repairs at <body>" state).
Behavior: past the threshold (or player-ordered), the ship diverts to the nearest suitable body, repairs on a timer,
then resumes where it was; ground teams on other bodies keep working only if the ship can still recover them (Q1
rule). Pure function of the stored record; parity tests. Never forces a return home.

**Carry from GO-8b (built 2026-10-13, commit `feat(0.14.0): expedition field repair (Ground Ops GO-8b)`):**
- **The flag.** `ShipEventBattle.repairSpeed` (frozen at dispatch: crewOverlay.ts `officerRepairSpeedBonus` = Rapid
  Recovery + Veteran Instincts + the Engineering Constitution, the Shipyard's divisor). A run without it (a GO-8-only
  run, any pre-GO-8 flagged run, a legacy run) never sets down. No new salt (nothing random).
- **The leg (`GroundRepairLeg`, model.ts; stored on new `GroundOpsState.repairLegs?`, absent until the first, so every
  earlier run keeps its exact shape).** `{ kind: "repair", siteBodyIndex (null = orbit), ordered?, scanBodyIndex,
  startsAt, arrivesAt, repairedAt, endsAt, hullRepaired, done? }`. A separate list (not a GroundShipLeg kind) so every
  recovery-leg reader keeps its shape; `shipLegsInOrder(ops)` merges both (start order) for the scan clock
  (`scanClockToTime` / `scanClockAt`: a repair while scanning pauses the scan for the whole leg, like a recovery leg;
  one after the scan, `scanBodyIndex` null, pauses nothing) and `shipFreeAt(ops)` serializes every leg (a wipe during
  a repair waits for it; a repair ordered during a pickup waits for that). `groundShipPosition` gains `{ kind:
  "repair", leg }`.
- **Trigger.** AUTOMATIC at the scan event whose light damage brings `hullDamage` to `FIELD_REPAIR_DAMAGE_SHARE` 0.25
  of `ShipEventBattle.hullMax` [PROVISIONAL] (expedition.ts rollStepBoundary -> groundOps.ts `maybeAutoFieldRepair`,
  starting at that event's wall time), or BY ORDER: pure actions `canOrderFieldRepair(state, expeditionId)` /
  `orderFieldRepair(state, expeditionId)` in expedition.ts (advance to now, validate, store the leg at now, settle;
  the SAME state on a refusal; no UI yet). Reasons `FieldRepairOrderBlockReason`: noExpedition, notGroundOps,
  noFieldRepair, runFinished, alreadyRepairing, noDamage (`fieldRepairBlockText`, exhaustive).
- **Site.** `fieldRepairSite(exp, from)`: the nearest body of `FIELD_REPAIR_PLANET_TYPES` (terrestrial, ocean, arid,
  frozen: rocky with an atmosphere [PROVISIONAL]; never a gas giant (D22), nor barren (airless), volcanic or toxic)
  by body index from the ship's position (the body it scans, else the last body: holding station), ties to the lower
  index [PROVISIONAL: bodies have no positions]. Travel `IN_SYSTEM_LEG_SECONDS` (300) each way, 0 when the site is the
  body the ship is at; none in the system = IN ORBIT where it is (no travel, slower).
- **Time.** `fieldRepairSeconds(damage, repairSpeed, landed)` = model.ts `repairTicksForDamage(damage, repairSpeed)`
  (the Shipyard formula REPAIR_BASE_TICKS + ceil(damage x REPAIR_TICKS_PER_HULL), divided by 1 + the speed-up; now
  ONE definition that tick.ts `shipRepairDurationTicks` also builds on, byte-identical) x `FIELD_REPAIR_TIME_MULT` 2
  on the ground or `ORBIT_REPAIR_TIME_MULT` 3 in orbit [PROVISIONAL] (one tick = one second). The Damage Control
  Suite and the Cunning free tick stay Shipyard-only.
- **End.** The window processes a repair's end as an event (before scan events and team ends at one instant):
  `done` latches and the damage it set out to fix is removed (later damage stays). `checkRunEnd` waits for any
  repair in progress, so the ship heads home whole.
- **Ground teams (Q1 rule, interpretation):** they keep working during a repair; a team that wipes waits for the
  ship, whose pickup leg starts when the repair ends (tested). **Question for the user:** should teams instead hold
  off deploying while the ship is down for repairs?
- Tests: new `fieldRepair.test.ts` (12: the shared formula vs the Shipyard, the site rules, the frozen speed-up, the
  threshold repair on a real run (time, travel, the paused scan clock, the ship position, the damage fixed at its end,
  the claim), the scan's length and parity one call == 997 s == 1 s over the scan, orbit, the flag both ways, the
  order's refusals, an order mid-scan (and its 997 s parity), an order after the scan holding the window open, a wipe
  waiting for the repair with no overlapping legs and teams working meanwhile). Suite 4498 -> 4510 passed (1 skipped);
  `npm run check` 0 errors. Every golden and parity test unchanged.

## 5. Open questions (the user's to decide; each has a [PROVISIONAL] build default)

1. **Q1 Scanning vs operations overlap.** Do teams start a planet's tasks as soon as its scan completes while the ship
   scans the next body (design section 1 reads that way), or does the ground work wait until every body is scanned
   (today's phase order, the plan's default)? Overlap needs the ops engine to start during scanning.
2. **Q2 "Favorable" is not one of the 7 tiers.** Which tier is the helper floor: Likely Victory (80%+, plan default) or
   A Worthy Adversary (60%+)? (The mockup used a 5-tier set: Guaranteed, Favorable, Even, Unfavorable, Impossible.)
3. **Q3 Queue order inside a team.** Default plan appends a team's tasks easiest first (so an unwinnable task cannot block
   the rest, given "retry until done"). Alternatives: hardest first, or discovery order.
4. **Q4 A task nobody can win never ends the run.** By the rule "retries until done or skipped by hand", an Impossible
   task loops through the bay forever and holds the ship out (the run never reaches its return leg). Want a safety
   (a recall action, a notice, an auto-skip after N failures), or keep it pure?
5. **Q5 HP between fights of one task.** Plan default: every fight starts at full HP (today's engine); damage and statuses
   only matter for the bay. Alternative: survivors carry HP and statuses from fight to fight within a task.
6. **Q6 Condition classes.** Plan: injuries = Bleed, Hemorrhage, Concussion, Fracture (D24's physical list) + Downed;
   ailments = Poison, Neurotoxin, Blindness. Combat-only statuses (Stun, Weakened, Suppressed, Corroded, Fear) end with
   the battle and need no bay time. Confirm (design section 5 grouped Bleed with the 60 s ailments).
7. **Q7 Offload, reload and travel times.** 9b.5 approved "offload / reload times as proposed", but no number was written.
   Plan: offload 120 s, reload 120 s (each divided by its bonus), drop 60 s, return 60 s.
8. **Q8 Bay floor.** Plan: 1 second (D23 style). The old injury floor was 15 minutes.
9. **Q9 Fight length and fight counts.** Plan: a fight takes rounds x 6 s; fight points per site from the table in GO-4
   (+1 on hazardous worlds, 1 to 5).
10. **Q10 Task-work hazard slowdown.** D26 gives the Assault Hardsuit "less planet-hazard slowdown on task work", which
    implies task work slows on hazardous worlds; plan uses the scan's 0.5 coefficient. Also: should the Science Hazard
    Suit keep cutting the ORBITAL scan slowdown now that scanning is ship-side (plan: yes, unchanged), or move to task work?
11. **Q11 The encounter dial (Shroud Emitter / Lure Beacon).** With no scan-time ground fights, plan keeps it scaling the
    ship-event chance. Alternative: it changes a task's fight-point count (Lure more fights and more drops, Shroud fewer).
12. **Q12 Ship damage from events.** Plan: a debris "minor hull wear" and a lost probe fight only pause the scan (field
    repair); the wear is shown, never carried to the Shipyard. Alternative: they leave the ship damaged after the run.
13. **Q13 Boarding consequences.** Plan: an unrepelled boarding pauses the scan (no lost findings, nobody hurt); a repelled
    one is logged. Attempt chance 25%. Confirm or name the consequence.
14. **Q14 Editing an active task.** Plan: skipping or reassigning the task a team is working stops it at once (progress
    kept, no partial-segment haul) and sends the team back; a fight in progress finishes first.
15. **Q15 Team names past Charlie.** No hull has a 4th team yet; plan falls back to "Team 4". Short labels stay A / B / C
    by position even after a rename.
16. **Q16 Squad Loadouts shape.** Plan: one loadout per whole ground team (Security + Science kits), gear only (who is
    slotted stays a Personnel choice). Needs a sketch before the UI.
17. **Q17 Threat chip text and icons.** The 7 tier names are long for a table cell; plan adds short names (Guaranteed,
    Likely, Worthy, Even, Not Advised, Extreme, Impossible) and SVG dots instead of the patrol chip's emoji. Should the
    patrol chip move off emoji too (outside this plan)?
18. **Q18 Supply cache.** It is not in the approved four events; plan keeps it as the step roll's second draw.
19. **Q19 Sensor ghost amounts.** A pass adds one extra discovery (one more task) on that body; a fail loses N seconds of
    scan progress. Confirm, and whether the cloaked-vessel fight result should differ from the probe's.
20. **Q20 Several teams on one ship.** Plan splits the ship's Security and Science crew layers across the deployed teams
    (one team = exactly today), and skips a task that needs more teams than deployed. Confirm both.
21. **Q21 The inert account gambit pair.** Task 17 had to decide its future; plan keeps it stored and hidden with a notice.
22. **Q22 Rapid Turnaround (captain secondary talent logistics3, unload speed).** D26 wires logistics4 into the reload; the
    secondary tree is otherwise dormant. Should logistics3 join the offload the same way?

---

## 6. QA checklist (desktop + mobile at 375 px; produce the curated sheet from this at GO-19)

Setup: `?dev`, Debug grants, a ship with a hired Security + Science squad, Offline sim for time.

**Ground teams (Away Team tab)**
- [ ] Each hull shows one ground team card "Alpha" with badge A; Security and Science slot counts match the hull.
- [ ] Existing members appear slotted after the update (hire order); extra members show under "Aboard, not slotted".
- [ ] Slot, unslot, swap into an occupied slot; rename (and clear back to Alpha); the help toggle persists after reload.
- [ ] All slot controls are disabled with a reason while the ship is on an expedition; rename still works.
- [ ] Hiring auto-slots into the first empty slot; firing frees the slot.
- [ ] Mobile: slot grid in 2 columns, no horizontal page scroll.

**Dispatch**
- [ ] The strip lists the teams that will deploy and why any will not; Launch is blocked with the new text when no team
      has a ready Security and Science member.

**Scanning (ship-side events)**
- [ ] Scan pips show debris / probe / ghost / storm / supply cache with outcomes; pauses visibly hold the scan bar.
- [ ] No ground battle appears during scanning on a new run; an expedition launched before the update still shows its
      old scan battles and finishes normally.
- [ ] A boarding attempt shows repelled or not; Help explains it.

**Task queues**
- [ ] A body's tasks appear when its scan completes, already assigned by the default plan.
- [ ] Odds chips per team show a tier name and color, tooltip has the fuzzy range and officer line; no emoji.
- [ ] Reassign (pick, then Apply), reorder, Skip, Re-queue, Default plan, Auto-assign randomly all work and persist.
- [ ] Mobile: the table scrolls inside its frame only.

**Running tasks**
- [ ] Team lane shows deploy, work, fight, return, offload, medical bay, reload in order; idle when the queue is done.
- [ ] Task card progress bar with fight pips; after a wipe the card reads "Paused: team in med bay", the bar holds at the
      fight, and the retry resumes there; the haul line shows banked vs offloaded segments.
- [ ] Findings arrive only after an offload; the relic only when a task reaches 100%.
- [ ] Bay card lists each member's conditions with times; bay time equals the longest; an Ossir member's injury reads 25%
      longer.
- [ ] With "help other teams" on (Debug multi-team hull, if available): a helper borrows, fails, and moves on.

**Claim**
- [ ] Members still in the bay at run end come home injured with the remaining time; everyone else is ready; no flat
      2-hour injuries on new runs.

**Gambits + loadouts**
- [ ] Gambit editor: ship, team, member; edit, apply preset, copy to squad; no Science tab.
- [ ] Squad Loadouts (after the sketch is approved): save, apply with skipped-piece report, check in.

**Regression**
- [ ] Patrols, captain missions, the Shipyard repair, Armory ship loadouts unchanged.
- [ ] Offline catch-up of a long run matches leaving the tab open (spot-check the task list and findings).
- [ ] Console clean on every screen; light and dark themes; colorblind-safe palette on the threat chips.
- [ ] `RELEASE_GATE=1 npx vitest run src/lib/game/no-dead-stats.test.ts` lists no Ground Ops entry.

---

## 7. Task list (one line each)

- GO-0: (recommended chore) one SAVE_VERSION pin in save.test.ts (Task 34b pulled forward).
- GO-1: ground-team slot state on ShipInstance, GroundTeamLoadout reshape, names, SAVE 66 -> 67 migration.
- GO-2: slotting engine (slot / unslot / rename / help toggle), hire-fire-reassign sync, deployableGroundTeams.
- GO-3: medical bay cure-time math with frozen medical factors, condition table, Stoneskin bay half, member perks.
- GO-4: ground task model: fight points from site threat, segment haul split, work time with the task hazard slowdown; salt registry test.
- GO-5: one task fight resolver on a private keyed stream with end-of-fight conditions.
- GO-6: Monte Carlo threat indicator on resolveGroundBattle mapped to the 7 tiers; helper floor constant.
- GO-7a: dispatch snapshot for ground teams (members, shares, frozen bay / offload / reload factors).
- GO-7b: the timeline engine for one team (the switch): work, fights, wipes, return trip, offload findings, bay, reload, run end, claim; legacy golden hashes; no-dead-stats loadSpeed + Hardsuit live.
- GO-7c: multi-team timelines, default plan (hardest to strongest), helpers with skip-on-fail, requiredTeams N.
- GO-7d: live queue edits applied from now, auto-assign randomly, edit parity.
- GO-8: ship-side scan events (debris, hostile probe on the combat engine with Security Cunning's softening, sensor ghost / cloaked vessel, radiation storm).
- GO-9: boarding attempts decided by crew.boardingDefense + the Ossir racial; no-dead-stats entries removed.
- GO-10: SVG glyphs, ThreatChip, TeamBadge.
- GO-11: ground team slotting UI in AwayTeamPanel (GO-M1).
- GO-12: dispatch console lists deploying teams.
- GO-13: per-planet task queue screen with per-team odds (GO-M2).
- GO-14: team timelines, task cards with segment progress, med bay card (GO-M3, GO-M4).
- GO-15: ship-event scan track pips and log lines.
- GO-16: per-member gambit editor by ground team.
- GO-17: Squad Loadouts per ground team (sketch first) + S4-CP39 roster-linked loadout.
- GO-18: Help topics (Ground Operations, scan events).
- GO-19: close-out notes in the E-CREW plan and design, holistic review, QA sheet.
