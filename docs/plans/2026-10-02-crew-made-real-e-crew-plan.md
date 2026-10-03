# E-CREW "Crew Made Real" Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task
> (the user's standing workflow: fresh subagent per task, review between tasks, two-stage review at the end).

**Goal:** Turn the away team into a persistent named roster with per-member gear and implants, make every crew
bonus a player can see do something, open the crew-module and early-sensor acquisition paths, and land the small
locked crew features.

**Architecture:** Additive, dormant-first layers on the existing seams. Members are stored like Senior Staff
officers; their gear rides the ship-system gear engine (new slot types, `fittedToMemberId` authority behind one
`isSparePiece` predicate). Expeditions snapshot the roster at dispatch so resolution stays a pure function of the
stored expedition (offline == live). Officer and crew effects fold through `crewOverlay.ts` and the combat bridge.

**Tech stack:** Svelte 5 (legacy mode) + TypeScript, Vitest. Design: `docs/plans/2026-10-02-crew-made-real-e-crew-design.md`.
Mockup: https://claude.ai/artifact/UYTkL2q9PyDHKGbeERcvuj.

---

## Standing rules for every task (read once, apply always)

- **Gate** after every task: `npm run check` (expect `0 ERRORS`, the 2 known RadialWeb warnings are fine) and
  `npx vitest run` (expect all files passed). A task is not done until both are green.
- **Additive-neutral:** an empty feature (no members, no new gear, neutral officer stats) must leave every
  existing derived value byte-identical. Each task that touches a fold adds a neutrality test.
- **Determinism:** randomness only via `makeRng` keyed `seed ^ salt ^ index`. Never `Math.random`, never
  `Date.now()` in engine code. Never add a draw to the SHARED economy stream (it would shift later rolls).
- **Mutation pattern:** UI handler `do*` in `src/App.svelte` calls a pure engine fn, then `state = next`,
  `pushLog`, `doSave`, with a same-ref guard (`if (next === state) return`).
- **Text rules:** US English; no em dashes and no "--" in any text, comment or doc; say "install", never
  "fit/fitting/fitment" in player-facing text. Graphics are SVG glyphs added to `src/lib/ui/icons.ts` and
  classified in `src/lib/ui/iconPacks.ts` `ICON_SEMANTICS` (compile error otherwise). No emoji in new UI.
- **Commits:** one per task, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never push the branch; dev deploys are the controller's call (`git push origin feat/crew-0.14.0:staging`).
- **Close inventory rows:** each commit body lists the inventory row IDs it closes (design section 3).

---

## Stage 1: Foundation

### Task 1: `isSparePiece` single predicate

**Files:**
- Modify: `src/lib/game/model.ts` (add helper near `isStandardIssueBaseline`, ~line 8510)
- Modify: every raw spare check (20 sites today): `src/App.svelte` (6), `src/lib/ShipSystemsPanel.svelte` (3),
  `src/lib/game/armory.ts`, `archive.ts`, `model.ts` (2), `quartermaster.ts` (2), `salvage.ts` (3), `save.ts`, `tick.ts`
- Test: `src/lib/game/spare-predicate.test.ts` (new)

**Step 1: failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSparePiece } from "./model";

const piece = (over: Partial<any> = {}) => ({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null, ...over }) as any;

describe("isSparePiece", () => {
  it("a loose piece is spare", () => expect(isSparePiece(piece())).toBe(true));
  it("a ship-installed piece is not spare", () => expect(isSparePiece(piece({ fittedToShipId: "ship-1" }))).toBe(false));
  it("a member-installed piece is not spare", () => expect(isSparePiece(piece({ fittedToMemberId: "member-1" }))).toBe(false));
  it("a loadout-committed piece is not spare", () => expect(isSparePiece(piece({ committedToLoadoutId: "loadout-1" }))).toBe(false));
});

describe("no raw spare checks outside the helper", () => {
  it("src has no `fittedToShipId === null` outside model.ts isSparePiece", () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|svelte)$/.test(f) && !f.endsWith(".test.ts")) {
        readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (/fittedToShipId\s*===?\s*null/.test(l) && !l.includes("isSparePiece-ok")) hits.push(`${p}:${i + 1}`); });
      } } };
    walk("src");
    expect(hits).toEqual([]);
  });
});
```
(Check the real loadout-commit field name on `EquipmentInstance` (~model.ts:1544) before writing the helper; use it.)

**Step 2:** `npx vitest run src/lib/game/spare-predicate.test.ts`, expect FAIL (`isSparePiece` not exported).

**Step 3: implement**
```ts
// The ONE answer to "is this piece free to take?" Member gear (fittedToMemberId) and loadout-committed
// gear have fittedToShipId === null but are NOT spare. Every spare check routes through here.
export function isSparePiece(piece: EquipmentInstance): boolean {
  return piece.fittedToShipId === null /* isSparePiece-ok */ && !piece.fittedToMemberId && !piece.<loadoutCommitField>;
}
```
Add `fittedToMemberId?: string | null;` to `EquipmentInstance` (optional, additive, documented like `weaponType`).
Replace each of the 20 sites with `isSparePiece(piece)` (or `!isSparePiece`) **only where the check means
"spare"**. Where a site means "not on a ship" for another reason, keep the comparison and tag the line
`// isSparePiece-ok: <why>`. Read each site; do not bulk-replace.

**Step 4:** test passes; full gate green (existing behavior unchanged because no piece has `fittedToMemberId` yet).

**Step 5:** commit `refactor(0.14.0): isSparePiece single spare predicate (E-CREW prep)`.

### Task 2: Data model + save v65

**Files:**
- Modify: `src/lib/game/model.ts` (types + `freshState` ~line 10515)
- Modify: `src/lib/game/save.ts` (`SAVE_VERSION` 64 -> 65; `MIGRATIONS[64]`)
- Test: `src/lib/game/save.test.ts` (append), `src/lib/game/model.test.ts` (append)

**Types (model.ts, beside the Senior Staff block ~5280):**
```ts
export type AwayTeamType = "security" | "science" | "prospecting";
export const AWAY_TEAM_TYPES: readonly AwayTeamType[] = ["security", "science", "prospecting"];
export type SecuritySpec = "offense" | "defense" | "debuff";
export type ScienceSpec = "archaeology" | "xenobiology" | "geology" | "cryptography";
export type AwayMemberSpec = SecuritySpec | ScienceSpec;
export interface AwayMember {
  id: string; teamType: AwayTeamType; spec: AwayMemberSpec;
  name: string; race: CrewRace; gender: string;
  rank: CrewRank; traits: string[];
  assignedShipId: string | null;
  injuredUntilSeconds?: number;
  gambit?: GambitProgram;            // per-member program (Security); absent = preset default
  favorite?: boolean;
}
export interface OfficerStats { strength: number; integrity: number; cunning: number; constitution: number }
export interface SquadLoadoutKit { armor: string | null; weapon: string | null; tool: string | null; implants: string[] }
export interface SquadLoadout { id: string; name: string; teamType: AwayTeamType; kits: SquadLoadoutKit[]; checkedOutToShipId: string | null }
```
`SeniorStaffOfficer.stats?: OfficerStats` (optional so old fixtures compile; migration fills it).
`GameState`: `awayMembers: AwayMember[]; nextAwayMemberId: number; awayRecruitSeed: number; squadLoadouts: SquadLoadout[]; nextSquadLoadoutId: number;`
`ShipTypeDef.awayTeams?: { type: AwayTeamType; size: number; count: number }[]` (data lands in Task 3).

**Migration `MIGRATIONS[64]` (v64 -> v65):**
```ts
64: (state: any): any => ({
  ...state,
  awayMembers: state.awayMembers ?? [],
  nextAwayMemberId: state.nextAwayMemberId ?? 1,
  awayRecruitSeed: state.awayRecruitSeed ?? ((state.seniorStaffSeed ?? 1) ^ 0x5a17c0de) >>> 0,
  squadLoadouts: state.squadLoadouts ?? [],
  nextSquadLoadoutId: state.nextSquadLoadoutId ?? 1,
  officers: (state.officers ?? []).map((o: any) => (o.stats ? o : { ...o, stats: rollOfficerStats(officerStatSeed(state.seniorStaffSeed ?? 1, o.id), o.rank) })),
}),
```
`rollOfficerStats` / `officerStatSeed` live in `seniorStaff.ts` (Task 19 fills the real roll; for now export a
deterministic stub that returns the NEUTRAL stats `{10,10,10,10}`, so this task is behavior-neutral). Note: Task 19
replaces the stub with the real roll, and its migration test asserts determinism.

**Tests:** v64 fixture migrates to v65 with empty containers + every officer has `stats`; migrating twice is
idempotent; `freshState()` has the new fields; JSON round-trip preserves them.

Commit `feat(0.14.0): E-CREW data model + save v65`.

---

## Stage 2: Recruitment + squads

### Task 3: Squad sizes + team-type data

**Files:** `src/lib/game/model.ts` (`SHIP_TYPES` entries ~1031-1224), new `src/lib/game/awayTeam.ts`, test `awayTeam.test.ts`.

Add `awayTeams` to every `SHIP_TYPES` entry per the design table (Security/Science sizes; Prospecting
`{ type: "prospecting", size: 3, count: 0 }` = wired, never fielded). In `awayTeam.ts`:
```ts
export function squadSlots(typeKey: ShipTypeKey, team: AwayTeamType): number // size * count, 0 if absent
export function membersInSquad(state: GameState, shipId: string, team: AwayTeamType): AwayMember[]
export function squadHasRoom(state: GameState, shipId: string, team: AwayTeamType): boolean
```
Tests: Eir 4/4; Destroyer 4/3; Orion 3/4; prospecting slots 0 on every hull; a hull missing `awayTeams` returns 0.

### Task 4: Traits + recruit candidates (derived board)

**Files:** new `src/lib/game/awayTraits.ts`, `awayTeam.ts`, tests.

- `AWAY_TRAITS`: first-pass catalog keyed by team type, each `{ id, label, description, teamTypes, effect }`.
  Include the mockup's names (Steady Aim, Breacher, Bulwark, Field Medic, Saboteur, Quick Draw, Iron Will,
  Veteran, Keen Eye, Patient Hands, Green Thumb, Codebreaker, Deep Survey, Steady). Medic traits carry
  `effect: { kind: "medic" }` so curing works from Security (design section 10).
- `traitCountForRank(rank)`: reuse `buffCountForRank` from `crewRank.ts`.
- `AUGMENT_AFFINITY_RACES: ReadonlySet<CrewRace> = new Set(["martian", "stheni"])` and
  `implantSlotsFor(member) = AUGMENT_AFFINITY_RACES.has(member.race) ? 2 : 1`.
- `awayRecruitCandidates(state): AwayMember[]`: copy the `seniorStaffCandidates` pattern exactly
  (`officerRosterWindowIndex`, a local `candidateSeed(baseSeed=state.awayRecruitSeed, window, slot)`, size
  `state.seniorStaffRosterSize`). Per candidate: team type (security/science only, 50/50), spec from that type,
  race, rank via a WEIGHTED roll (first-pass weights ranks 1..8 = 30,24,18,12,7,5,3,1), traits (distinct, count by
  rank), identity via `generateCrewIdentity(race, seed, slot)`. Id `away-candidate-<window>-<slot>`.
- Tests: deterministic across calls; changes when the window steps; never yields prospecting; trait count matches
  rank; affinity races get 2 implant slots.

### Task 5: Hire / fire / assign

**Files:** `awayTeam.ts`, test.

```ts
export function hireAwayMember(state, candidateId, shipId): GameState   // refuses: not on board, no room, ship locked
export function fireAwayMember(state, memberId): GameState              // returns member gear + implants to storage FIRST
export function reassignAwayMember(state, memberId, shipId | null): GameState
```
Fire must unfit every piece with `fittedToMemberId === memberId` (set it to null) before removing the member,
and refuse while the member's ship is on a mission (lock lands fully in Task 27; add the check now via a helper
`shipCrewLocked(state, shipId)` that reads the existing on-mission predicate, `onMissionLock` in `equipment.ts`).
Hire re-ids to `member-${nextAwayMemberId}`. Tests: hire fills the squad; full squad refuses (same ref);
firing returns gear (no piece left pointing at a removed member); hire twice of the same candidate refuses.

### Task 6: Away Team UI (tab + member cards + recruitment board)

**Files:** new `src/lib/AwayTeamPanel.svelte`, new `src/lib/RecruitmentBoard.svelte`, `src/App.svelte` (tab
wiring beside Senior Staff / Complement + `doHireAwayMember` / `doFireAwayMember` / `doReassignAwayMember`),
`src/lib/ui/icons.ts` + `iconPacks.ts` (glyphs: `team`, `armor`, `weaponHand`, `tool`, `implant`, `injury`,
`recruit`). Follow the mockup section 1 + 2 layout exactly (squad header with counts, member cards with spec
chip, traits, affinity chip, 3 gear cells, implant chips, stat line, injury bar; open slot card links to the
board). One DOM, responsive via `@container`. Empty gear cells render "Empty" (gear lands in Stage 3).

**Engine contract (Tasks 3-5 landed, `112fc55`):** use the gates `canHireAwayMember` / `canFireAwayMember` /
`canReassignAwayMember` and `hireTargetsFor` for disabled-with-reason buttons (add an `awayCrewBlockText(reason)`
exhaustive switch, no default, like `requisitionBlockText`). Trait chips use `traitDisplayText`. Before wiring, add
a private helper so `hireAwayMember` + `hireTargetsFor` build the recruit board ONCE per call (today the gate and
the action each rebuild it, and hireTargetsFor rebuilds per ship; the UI calls these on render). Make
`awayTraitEffectText` sign-aware (no "+-5%") and keep one decimal when a percent is fractional, before tuning.
**Verify in preview** (`preview_start({name:"dev"})`, `?dev`): hire a candidate into the Aurora's Science
squad, see the card, fire it; console has no errors; mobile width has no horizontal scroll. Screenshot for the
controller.

---

## Stage 3: Member gear on the gear engine

### Task 7: Slot types + catalog + blueprints

**Files:** `src/lib/game/model.ts` (`EquipmentSlotType` ~1446, `EQUIPMENT_SLOTS`, `BLUEPRINTS`), `itemgen.ts`
(if slot-specific stat lines need it), tests `member-gear.test.ts`.

Add slot types `memberArmor`, `memberWeapon`, `memberTool`, `implant`. Each variety:
`{ key, label, teamTypes: AwayTeamType[], statRatios, ... }` plus, for tools, `planetTypes?: ExpeditionPlanetType[]`
and `encounterBias?: number` (Shroud -0.4, Lure +0.4); for implants `uniqueEquipped?: true` and
`teamTypes: ["security"]` or `["science"]`. Catalog = design section 5.4 (names exactly). Ground stats are their
own keys (`groundPower`, `groundArmor`, `groundAccuracy`, `groundHp`, `fieldwork`, `relicFind`, `hazardResist`,
`organicsYield`, `vaultYield`, ...) and are NEVER folded by `equipmentStatMods` (ship stats). Add each new key to
the reserved/ignored branch there with a comment, plus a test that a ship with member gear in storage has
byte-identical ship stats.

Blueprints: one per variety, normal research tiers, recipes from existing refined materials (first-pass). The
Neural Backup blueprint is `requiresRelicDiscovery: "heartOfTheArchive"` (check the exact relic id in `relics.ts`)
and consumes 1 `intactDataCore`. Do not edit the Intact Data Core's flavor text (its easter-egg line stays as is
and must never appear in patch notes).

Tests: every new variety has a blueprint; every blueprint's slot accepts it; Neural Backup is masked until the
relic is discovered (reuse `blueprintRelicLocked`).

### Task 8: Install to a member + item-side install

**Files:** `src/lib/game/equipment.ts` (new `canFitToMember` / `fitToMember` / `unfitFromMember` beside
`canFitEquipment` ~340), tests.

Rules (each a typed block reason, mirrored on `EquipFitBlockReason`): member exists; slot is member-type; the
variety's `teamTypes` includes the member's team; piece is spare (`isSparePiece`); member's ship not locked;
locked (Lock flag) pieces refuse; implant slot count (`implantSlotsFor`); unique-equipped: refuse if any OTHER
piece of the same variety has `fittedToMemberId` set anywhere in the fleet. Swapping returns the old piece to
storage. Item-side install: a pure `installTargetsFor(state, pieceId)` listing valid ships AND members for a
spare piece (ship gear lists ships via `canFitEquipment`, member gear lists members), so the Warehouse can offer
"Install on..." for every gear type (S5-151).

Tests: team mismatch refuses; second Neural Backup refuses even on another ship; implant slot overflow refuses;
swap returns the old piece; the item-side list matches the per-target predicates.

### Task 9: Quartermaster baseline for member slots

**Files:** `src/lib/game/quartermaster.ts` (`REQUISITION_CATALOGUE`, `freeSpareBaselinesFor`), tests.
Add Standard-Issue Armor / Weapon / Tool per team type (Security + Science), stat-neutral-low, through the same
requisition path and `isStandardIssueBaseline`. Test: requisition mints a baseline that installs on a member of the
right team; the economy floor rule still holds.

### Task 10: Gear UI (member cells, install modal, Warehouse + Fabricator tabs)

**Carry from Task 7 (`a8aac59`, `d601f6e`):** until this task, crafted member pieces are invisible
(`BAY_SLOT_ORDER` is ship-only) yet count toward the SHARED equipment storage cap and are subject to auto-salvage
rules. Decide + implement deliberately: (a) storage: shared cap vs a separate away-team gear cap (ask the user if
it changes balance; default proposal: shared cap, shown in the new tab's header); (b) auto-salvage: member pieces
follow the same rarity/duplicate rules, and the rules UI says so; (c) Salvage Bay + Archive list member pieces in
their own groups; (d) EquipmentTooltip gets labels/icons for the 11 `ground*` stat keys (no camelCase fallback).
The Archive gained 31 member slots, so existing players' completion % drops when 0.14.0 lands: say so in the 0.14.0
patch notes.
**Carry from Task 8 (`3415ca8`, memberEquipment.ts):** show "Install on..." only on SPARE rows (canFitEquipment does
not require a spare, so installTargetsFor on an installed ship piece lists every ship); implants need a Swap flow
(at cap a plain install reports implantSlotsFull: pass the chosen implant as replacingInstanceId); list implants
via memberSlotPieces(state, memberId, "implant") (deterministic mint order, NOT position-stable: after a targeted
implant swap the new implant may render in a different slot than the one tapped; if that reads badly in the grid,
add an optional persisted `implantSlotIndex` on the piece, set on install, and sort by it); consider a member compare-preview helper (the ship
side has applyHypotheticalInstall). Task 9: Quartermaster member baselines MUST carry a moduleVariant whose variety
has member.teamTypes, or canFitToMember refuses them as wrongTeam. Task 11: add a "worn by" query (wearer of a
unique variety) for "Installed on Lt. X (Aurora)". Open rule: injured members can currently be given gear (no rule
says otherwise; fine unless the user objects).

**Files:** `AwayTeamPanel.svelte`, the existing install modal component used by `ShipSystemsPanel.svelte`
(reuse it with a member target), `App.svelte` Logistics (`Away-Team Gear`, `Implants` tabs) and Fabricator
(`Away-Team Gear` tab), `EquipmentTooltip.svelte` (new stat keys get labels; tooltip design itself unchanged).
"Install on..." button on spare rows in Logistics for ALL gear (opens a target picker from `installTargetsFor`).
Verify in preview: craft (dev grant) a Pulse Rifle blank, inspect, install on a Security member, see it on the
card and in the tooltip; item-side install of a ship cargo bay from Logistics works.

---

## Stage 4: Implants

### Task 11: Implant effects data + unique-equipped surfacing

**Files:** `model.ts` implant varieties (from Task 7), `AwayTeamPanel.svelte` (implant chips, the gold
"Unique" marker), tests. The unique check already lives in Task 8; this task adds the UI states (a second Neural
Backup in storage shows "Installed on Lt. X (Aurora)" and its Install is disabled with that reason) and a test that
salvaging/firing/transferring never duplicates a unique-equipped piece.

---

## Stage 5: Expedition rework (Security fights, Science does fieldwork)

### Task 12: Roster snapshot at dispatch

**Files:** `src/lib/game/gambit.ts` (new `AwayRosterSnapshot`), `expedition.ts` (`startExpedition` ~465),
`model.ts` (`Expedition` fields, optional), tests.

```ts
export interface SnapshotMember { memberId: string; teamType: AwayTeamType; spec: AwayMemberSpec; rank: CrewRank;
  traits: string[]; groundStats: Record<string, number>; implants: string[]; gambit: GambitProgram }
export interface AwayRosterSnapshot { security: SnapshotMember[]; science: SnapshotMember[] }
```
`snapshotAwayRoster(state, ship)` folds each READY (not injured) member's gear + implants into `groundStats`.
`Expedition.roster?: AwayRosterSnapshot`. Cap each squad's snapshot to `squadSlots` (a later balance pass that
shrinks a hull's squad size must not let an over-capacity squad deploy; extra members stay aboard, unassigned to the run). Keep the existing `AwayTeamSnapshot` strengths as the squad-wide crew
layer. **Fallback:** an empty squad snapshots as `[]` and resolution uses today's anonymous `buildTeamCombatants`
path, so a ship with no roster resolves exactly as now (neutrality test: existing expedition fixtures replay
byte-identical).

### Task 13: Security-only battles + per-member gambits

**Files:** `gambit.ts` (`buildTeamCombatants`, `resolveGroundBattle`, presets ~296), `model.ts`
(`GambitRole`, `DEFAULT_GAMBIT_PROGRAMS`), `save.ts` (fold into `MIGRATIONS[64]` if no release has shipped v65 yet,
otherwise a new step), tests.

- Combatants come from `roster.security` (one per member, stats from `groundStats` + rank factor + the crew
  strength layer). Science never enters a battle.
- Each member runs its own `gambit` program. Hire seeds `gambit` from the account's current Security program
  (migration: every hired member without one gets `state.gambitPrograms.security`).
- Curing: `cureCleanse` / `aidHeal` become legal for Security members whose traits include a medic trait, and
  "Use Item" spends team kit (unchanged).
- Remove the "secure objective" mid-fight win; a battle ends on clear or wipe.
- Presets keep titles; rewrite rules for Security only; Triage = medic priority.

Tests: Science members never appear in combatants; a member's own program fires (two members, two programs,
two different first actions); the six preset titles are unchanged; determinism (same seed, same log).

### Task 14: Random encounters during scan progress

**Files:** `expedition.ts` (scan advance), `gambit.ts` (`generateEncounter` reuse), tests.

Divide each body's scan into fixed steps (first-pass 10). At each step boundary roll
`makeRng(exp.seed ^ ENCOUNTER_SALT ^ (bodyIndex * 100 + step))`: chance = base by hazard tier (first-pass 8% +
hazard * 20%) * (1 + sum of encounter biases on Security tools) * (1 - Evasive Command share), clamped 0..0.9.
Encounters resolve via Task 13. Win: enemy drops (reuse the salvage loot pool, first-pass) + continue. Loss: the
team withdraws, findings so far stay, the scan pauses until the next activity window (record the pause on the
expedition), downed members recorded as injured (Task 16). A random EVENT (supply cache) uses the same step
roll's second draw. Offline parity test: one big advance == many small advances.

### Task 15: Fieldwork from Science members

**Files:** `expedition.ts` (`resolveActivitiesPhase` ~708), `gambit.ts` (`resolveExpeditionActivity` ~1309), tests.
Fieldwork speed/yield/relic odds read `roster.science` (spec vs PoI match, planet-tuned tools vs the body's planet
type, Hazard Suit vs hazard, implants) on top of the existing Science strength. Empty Science squad uses the
existing path. Discovery Instinct and the Science division's rare find feed the relic roll (Task 20/23 add the
values; this task adds the read). Tests: a Flora Scanner raises organics only on terrestrial/ocean/toxic bodies;
spec match raises the matching PoI's yield.

### Task 16: Injuries + Neural Backup + claim

**Files:** `gambit.ts` (battle end), `expedition.ts` (`claimExpedition` ~924, `depositExpeditionFindings`),
`awayTeam.ts`, tests.
- Neural Backup: once per battle, the first ally downed rolls 50% (battle rng) to revive at 30% HP; log it.
- Downed-at-end members are listed on the expedition result; claim sets `injuredUntilSeconds = now + recovery`
  where recovery = first-pass 2h * (1 - Medical division share - Rapid Recovery share), floor 15m.
- Injured members are excluded from snapshots and show the recovery bar. Interlock hook: a pure
  `memberFallOutcome(context): "injured"` function with a comment marking the future Safety Interlock branch.
Tests: Neural Backup fires at most once per battle; never on two members; injury timer shortened by Medical;
injured member excluded from the next dispatch snapshot.

### Task 17: Expedition + gambit UI

**Files:** `ExpeditionPanel.svelte`, `GambitEditorPanel.svelte`, `App.svelte`.
Scan track with event pips (find / battle / relic), encounter-dial readout, log lines (mockup section 5).
Gambit editor: pick a Security member, edit their program, "apply preset", "copy to squad"; the Science tab is
removed. Verify in preview with the Debug offline sim: an expedition with a hired squad shows battles + an injury.

---

## Stage 6: Squad loadouts

### Task 18: Squad loadouts in the Armory

**Files:** `src/lib/game/armory.ts`, `App.svelte` (Armory tab `Squad Loadouts`), tests.
Decide here whether `SquadLoadoutKit` needs the design's optional `memberRole?` (design 5.7 lists it; Task 2 left
it out) to match a kit to a member by spec rather than slot order; add it as optional if so (no migration).
`createSquadLoadout(state, shipId, teamType, name)` snapshots the squad's installed pieces into kits (committing
them like ship loadouts); `applySquadLoadout(state, loadoutId, shipId)` installs kits onto members in slot order,
skipping and reporting missing/locked/unique-conflict pieces (never forcing); `checkInSquadLoadout`. Capacity:
counts against the same `loadoutCap`. Also wire the roster-linked loadout so `applyRoster` applies its linked
ship loadout (S4-CP39, `personnelRosters.ts` ~278). Tests: round-trip save then apply restores the same kit;
unique conflict is skipped with a reason; cap shared with ship loadouts.

---

## Stage 7: Officers

### Task 19: Officer stats roll + promotion points + weighted bonus rolls

**Files:** `src/lib/game/seniorStaff.ts` (`rollCandidate` ~296, `promoteOfficer` ~228), `seniorStaffBonuses.ts`
(`rollWeight` per bonus), `save.ts` (replace the Task 2 stub), `SeniorStaffPanel.svelte` (stat bars), tests.
- Append stat draws AFTER the existing bonus draws in `rollCandidate` (so every existing roll is unchanged):
  four `1 + rng.nextInt(20)`.
- Weighted bonus pick replaces the uniform `rng.nextInt(pool.length)` (weights: common 6, uncommon 3, rare 2,
  very rare 1 per the mockup table). Note: this changes which bonuses future candidates roll (acceptable: the board
  is ephemeral), but NOT hired officers.
- `promoteOfficer` adds +2 to the officer's two highest stats (first-pass).
- `officerStatSeed(seed, officerId)` + `rollOfficerStats` real implementation used by the migration.
- **Stub-era saves:** any save that loaded at v65 before this task got the neutral 10/10/10/10 stub. Add a
  `v65 -> v66` migration that re-rolls every officer whose stats are MISSING (`!o.stats`, e.g. hired on a v65
  save before this task) OR deep-equal `NEUTRAL_OFFICER_STATS` (a genuine all-10 roll is vanishingly rare and
  harmless to re-roll). Because the seed is keyed on (seniorStaffSeed, officer id), this yields exactly the stats a
  save going straight v64 -> v66 gets. Also set `stats` at hire time (`hireOfficer` copies the
  candidate's rolled stats) so no hired officer is ever missing them; readers fall back to neutral until then.
Tests: candidate stats deterministic; existing bonus picks for a fixed seed: document the change in the test;
promotion raises stats; migration gives the same stats for the same save every time.

### Task 20: Officer bonuses go live

**Files:** `src/lib/game/crewOverlay.ts` (`OFFICER_STATKEY_TO_CREW` ~79), `src/lib/game/combat/bridge.ts`
(weapon damage + shield effectiveness + evasion folds), `expedition.ts` / `gambit.ts` (relic chance, encounter
chance, squad healing, Fear resist), `tick.ts` (Shipyard repair speed, mission output, turnaround), tests.
Map each of the 11 dormant bonuses per design 6.1. Weapons/Shield Command read ONLY officers (complement stays
excluded; comment the D12 exemption). Reactor Overdrive maps to `powerEfficiency` and stays dormant until E-MOD,
with a `// LIVE WITH E-MOD power budget` marker and an entry in the Task 22 allow-list. Neutrality: no officer =
byte-identical patrol and expedition replays.

### Task 21: Officer stat facets

**Files:** new `src/lib/game/officerStats.ts`, `crewOverlay.ts`, `combat/bridge.ts` or `resolveBattle.ts`
(Integrity), `tick.ts` (Cunning procs, Constitution turnaround), `expedition.ts` (Constitution ramp), tests.
- `DEPARTMENT_OF_SEAT`: tactical->security, science->science, medical->medical, engineering->engineering,
  operations->operations, pilot->flightDeck, executive->all at 0.4 share.
- Neutral point 10: facet value = (stat - 10) * per-point coefficient (first-pass 1% per point), so stats of 10
  are byte-identical.
- Strength: multiplies the department's complement buff magnitudes in `scaleCrewContribution`.
- Integrity: in ship battles/patrol waves, while hull < 50%, the department's buffs gain the Integrity facet.
- Cunning: per completed mission, a keyed roll (mission seed ^ CUNNING_SALT ^ seat index) for the department's
  over-deliver effect (design 7 table).
- Constitution: expedition + patrol ramp (+facet per hour out, capped 5 hours) and shorter post-mission turnaround.
Tests per facet + the neutrality test at all-10s.

### Task 22: The "no dead stats" standing test

**Files:** new `src/lib/game/no-dead-stats.test.ts`.
Iterate every rollable officer bonus `statKey`, every complement buff and exclusive-pool key (minus craft
duplicate), and every member gear stat key; for each, build a minimal state that has ONLY that effect and assert
some derived value (ship stats, combat snapshot, expedition snapshot, repair time) differs from the baseline.
Keys whose system is pending in this same release (power efficiency) live in an explicit `PENDING_IN_RELEASE`
allow-list with the phase name; the test fails if the list contains anything after E-MOD lands. This test is the
guard that keeps the "nothing on screen does nothing" rule true.

---

## Stage 8: Complement

### Task 23: Division pools + exclusive pool live

**Files:** `crewOverlay.ts`, `crewBuffs.ts` (`SECOND_LEVEL_EXCLUSIVE` ~105: remove craft duplicate from the
rollable set with a comment pointing at SUGGESTIONS "CRAFT-DUPLICATE CREW BUFF"), consumers per design 6.2, tests.
Existing buckets that already carry craft duplicate keep it in the save but it contributes nothing and the UI
labels it "Held for homeworld staffing" (no dead-roll surprise). Tests: each pool key changes its consumer.

### Task 24: Per-hull complement caps

**Files:** `src/lib/game/commandStructure.ts` (`commandStructureForHull` ~143, `SPEC_BASE_TOTAL` ~47), `model.ts`
(`SHIP_TYPES` gain `complementCap` + optional division weights), tests.
Caps move to per-hull values with the spec values as defaults (so a hull without an override is unchanged). Give
Eir a larger cap than Orion/Aurora. Over-cap existing complements clamp through the existing load-time clamp path.
Tests: Eir > Orion; a hull without overrides is byte-identical.

### Task 25: Active-mode transfer + sort/filter/multi-select

**Files:** new pure `transferCrew(state, fromShipId | "pool", toShipId | "pool", signatureKeys, counts)` in
`crew.ts` or `autoCrew.ts` (cap-aware via `remainingCapacityForSignature`), `ComplementPanel.svelte`, `App.svelte`.
Tests: transfer respects division and rank caps; partial transfer when the target fills; locked ships refuse.

### Task 26: Graduate + manifest

**Files:** `crew.ts` (`graduateStandout(state, shipId, signatureKey)` decrements the bucket, pushes a
`NotableCrewMember` with a name from `generateCrewIdentity`, bumps `nextNotableId`, respects the notable cap),
`ComplementPanel.svelte` (Graduate button + confirm modal from the mockup; Manifest view generating names lazily
from the bucket seed, never stored). Tests: count drops by one, notable created, cap refuses, manifest is pure.

### Task 27: Mission lock

**Files:** `seniorStaff.ts` (assign/unassign), `personnelRosters.ts` (`applyRoster`), `autoCrew.ts`,
`crew.ts` (transfer/graduate), `awayTeam.ts`, UI lock badges. One helper `shipCrewLocked(state, shipId)`; every
crew-changing action refuses with reason `"onMission"`. Tests: each action refuses while the ship is out and works
after it returns. (`shipCrewLocked` already exists from Task 5 and also locks while an expedition is out or
unclaimed.) **Salvage gap (from Task 5 review):** `salvageShip` (salvage.ts ~596) must BENCH the ship's away members
(`assignedShipId = null`, gear stays on them) atomically with the salvage, and the same for officers/notables if not
already handled; test that no member points at a removed ship. **Reserve list (from Task 6 review):** members with
`assignedShipId === null` (benched by salvage or "Move to... none") must be visible and reassignable: add a
"Reserve" section (unassigned members, with Move-to-ship and Fire) where the recruitment board lives, so no member
can ever become invisible. Also replace Task 6's provisional injury bar (2h nominal span) with the real recovery
start once Task 16 stores it.

---

## Stage 9: Acquisition

### Task 28: Crew module + early sensor blueprints + install tiles

**Files:** `model.ts` (`BLUEPRINTS`: 3 bridge + 9 quarters variants, Wide-Beam / Focused-Beam / Balanced arrays;
equipmentOutput slotType `bridge` / `quarters` / `sensor`), `ShipSystemsPanel.svelte` (`SYSTEM_SLOTS` gains Bridge
Module + Crew Quarters), `App.svelte` (`BAY_SLOT_ORDER` gains `bridge`, `quarters`), tests.
Check `generateEquipment` stamps `moduleVariant` for bridge/quarters (it does for sensor). Tests: each blueprint
mints its variant; a new player can research + craft a Wide-Beam array with no relic; tiles render.
Verify in preview: install a Balanced Command bridge module on the Aurora and see the officer amplification change.

---

## Stage 10: Small fixes

### Task 29: Final-retirement warning + Hall of Command
`captainRetirement.ts` (`MAX_CAPTAIN_RETIREMENTS`), the retire modal in `App.svelte`: when this retirement is the
last, show a warning callout. Hall of Command: `GameState.hallOfCommand?: { name, ranks, missions, retiredAtSeconds }[]`
appended by `retireCaptain` (optional field, no bump needed beyond v65; fold into `MIGRATIONS[64]` if v65 has not
shipped). Archive gets a "Hall of Command" subsection. Tests: entry appended once per retirement.

### Task 30: Roster dropdown on the ship personnel screen
A select on `SeniorStaffPanel.svelte` / ship personnel view listing saved rosters; applies via `applyRoster`
(which now also applies the linked loadout from Task 18). Verify in preview.

### Task 31: Soft captain level cap
`model.ts` `xpForNextLevel` (~8647): past a threshold level (first-pass 30) the cost grows by an extra factor per
level (first-pass 1.08^(level-30)). Below the threshold byte-identical. Tests both sides.

### Task 32: Candidate board expansion upgrade
A Homeworld (or Personnel) timed upgrade raising `seniorStaffRosterSize` by 2 per level up to 20; the recruit
board reads the same size. Reuse the existing timed-upgrade machinery (`docksExpansion` pattern). Tests.

### Task 33: Graph color option
A per-graph color setting in Settings (localStorage preference module like `tickBarPreference.ts`, one key per
graph, starting with the complement graph). Verify in preview.

---

## Stage 11: Close-out

### Task 34: Help topics
`src/lib/helpTopics.ts`: add topics for Away Teams, Recruitment, Implants, Officer Stats, Complement Active Mode;
rewrite the `fuel` topic for fuel-to-reach and remove the Fuel Depot mention from the Homeworld topic (inventory
A8; wrong in prod since 0.13.6). Test: the existing help-topic shape test passes.

### Task 34b: Consolidate SAVE_VERSION pins (chore)
`save.test.ts` repeats `expect(SAVE_VERSION).toBe(N)` about 25 times and `.version).toBe(N)` about 11 times, so
every bump edits ~36 lines. Keep ONE canonical pin; per-migration blocks assert the migrated fields (and use the
imported `SAVE_VERSION` where they need "current"). Separate chore commit, no behavior change.

### Task 34d: Merge 0.13.9 into feat/crew-0.14.0 (do as soon as the user promotes it)
Known conflicts (from the hotfix + Task 1/8 reviews): `spareEquipmentCount` -> `isSparePiece(p) && blueprintKey !== null`;
`freeSpareBaselinesFor` -> `isSparePiece`; `salvageEquipment` + `salvageTargetBlock` keep Task 1's `!isUninstalledPiece`
"fitted" guard THEN the hotfix's "committed" guard; rewrite the Task 1 comments that say committed gear "has always
counted" (now false); salvage chance-rounding keeps the 0.14.0 museum multiplier inside the fraction with the shared
draw count still one; `installIntoLoadout` / `loadoutInstallCandidates` raw `fittedToShipId === null` -> `isSparePiece`
(the source-scan test will flag them); keep the 0.13.9 patch-notes entry below 0.14.0's; Help topics may conflict.
**Harmonize the singleton swap rule:** the ship gate (0.13.9) refuses `replacingInstanceId` on a singleton, while the
member gate accepts it when it names the occupant. Make the ship side ALSO accept "the occupant" (same result as
omitting it), so Task 10's shared Swap picker can pass the occupant uniformly. Apply the Task 7/8 review perf notes
(ship-label helper per-row scans: use the batched `shipDisplayLabels` in the swap picker and Armory lists).
Then remove the hotfix worktree (`git worktree remove`) and the "hotfix" entry in `.claude/launch.json`.

### Task 34e: Shared "return piece to storage" helper (chore, from Task 8 review)
The transition `startAutoSalvageGrace({ ...e, fittedToX: null }, now)` is hand-written in ~7 places (memberEquipment
x2, awayTeam fire, equipment x3, armory). Add one `returnToStorage(piece, now)` in model.ts (nulls fittedToShipId AND
fittedToMemberId, stamps grace) and route every storage-return through it, so the grace rule is structural rather
than a header list. Behavior-neutral; separate commit.

### Task 34c: Danger-color token migration (chore, from Task 6 review)
About 31 hardcoded `rgba(248, 113, 113, ...)` danger tints across the app (e.g. SeniorStaffPanel ~742-749) ignore
the colorblind-safe palette (`:root[data-palette="cbsafe"]` remaps `--color-danger`). Add `--color-danger-rgb` to
`:root` and the cbsafe block (and any theme that overrides danger), then migrate the literals. Visual check in
both palettes. Separate chore commit.

### Task 35: Review, QA sheet, staging
Two-stage review (bug-check subagent, then a full-ledger fix pass), holistic review, then the controller
produces a delta + full QA sheet (desktop + mobile, steps + expected + regression) and deploys with
`git push origin feat/crew-0.14.0:staging` only after the user confirms. Update the inventory rows to BUILT with
commit hashes.
