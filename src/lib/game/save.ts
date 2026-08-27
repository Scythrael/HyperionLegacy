// Save file contract, tech spec §6. Versioned from commit one (Ops §8.E.1).
// When the schema changes: bump SAVE_VERSION, add a migrate_vN_to_vN+1
// function to MIGRATIONS, and never touch old migrations again.

import LZString from "lz-string";
import Decimal from "break_infinity.js";
import { type GameState, type MissionPhase, freshCaptains, freshLifetimeStats, requiredTicksForPhase, MISSIONS, SHIP_TYPES, FUEL_TANK_BASE_CAP, seedStandardIssueForShip, STANDARD_ISSUE_ILEVEL, SI_PLATING_HP, SI_EMITTER_CAP, SI_EMITTER_RECHARGE, isStandardIssueBaseline } from "./model";
// Combat 0.13.0 (Phase 12b Unit B2): the v32->v33 migration backfills a full per-system
// durability carry-state onto any in-flight patrol. combatHullTypeOf resolves the assigned
// hull's combat class and defaultSystemDurabilityForHull builds its FULL (no-wear) durability
// from the SAME loadout source of truth freshPatrolMission uses (so a backfilled patrol matches
// a freshly dispatched one). Both are pure combat/ leaves (they never import save.ts), so this
// introduces no module cycle.
import { combatHullTypeOf, defaultSystemDurabilityForHull } from "./combat/bridge";
// Over-cap reconciliation: run at load so a stack stuck above its warehouse cap (deposited
// before the deposit-clamp fix, or by a live salvage) is trimmed back to cap. Idempotent and
// shape-preserving, so it is applied on EVERY load with no SAVE_VERSION bump. See
// clampInventoryToCaps in tick.ts for the full rationale. This is a one-way import (tick.ts
// never imports save.ts), so it introduces no module cycle.
import { clampInventoryToCaps, installMissingCombatBaselines } from "./tick";

export const SAVE_VERSION = 39;
export const SAVE_KEY = "fleet_admiral_save";

export interface SaveFile {
  version: number;
  created_at: number;
  last_saved_at: number;
  game_time_seconds: number;
  state: GameState;
}

// Converts a value that MIGHT be a plain number (an old, pre-migration save),
// a string (a current-format save, since JSON.parse never reconstructs class
// instances, it just leaves whatever toJSON() produced as a plain string),
// or already a live Decimal instance (calling this twice is harmless) into a
// real Decimal. Safe to call unconditionally on any of the three shapes.
function toDecimal(value: Decimal | number | string): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

// Revives every per-key value of a lifetimeStats tally map (material/mission key
// -> Decimal) back into a real Decimal, returning a NEW map. Progression Pacing
// Rework (Task 6): once these maps carry values (mission loot / completed cycles),
// their per-value Decimals round-trip through JSON as plain strings exactly like
// the scalar sums do, so each must be toDecimal()'d on load, the same per-key
// treatment homePlanet.storage's fixed keys already get, just iterated over the
// map's dynamic keys. Idempotent (toDecimal no-ops on an existing Decimal), and a
// no-op on an empty map (a fresh/never-populated tally). Mutates nothing.
// Hostile-key guard for the dynamic-key hydration loops below. JSON.parse turns a
// `"__proto__"` key into an own data property (reads are unaffected), but a dynamic
// `obj[key] = ...` write with that key invokes the inherited prototype setter. No
// legitimate item id, tally key, or captain field is ever named these, so skipping them
// is a no-op on any valid save while blocking a hostile blob (once cloud save makes the
// input attacker-controlled) from poking at prototypes through the copy loops.
function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function hydrateDecimalMap(map: Record<string, Decimal | number | string>): Record<string, Decimal> {
  const hydrated: Record<string, Decimal> = {};
  if (map === null || typeof map !== "object") return hydrated; // fail-open on a non-map (hostile / partial save)
  for (const key of Object.keys(map)) {
    if (isUnsafeKey(key)) continue;
    hydrated[key] = toDecimal(map[key]);
  }
  return hydrated;
}

// Revives the QUALITY-BUCKETED inventory (Equipment 0.11.0, Task 9a): each item
// maps to a Decimal[] of quality-tier buckets, and every bucket round-trips through
// JSON as a plain string (Decimal.toJSON()) exactly like the scalar values in
// hydrateDecimalMap above, so each bucket must be toDecimal()'d back or the first
// .plus()/.gte() an itemTotal/getBucket read does would throw/NaN on load. Returns a
// NEW map with NEW bucket arrays; mutates nothing. Idempotent (toDecimal no-ops on a
// live Decimal), so calling it on a fresh/already-hydrated state is safe.
//
// DEFENSIVE per-value shape guard: a value reaching here is normally an array (the
// v26+ bucketed shape freshState seeds / MIGRATIONS[25] builds). A NON-array scalar
// (a hand-edited or partially-migrated map) is wrapped into a single quality-0 bucket
// so it becomes a valid Decimal[], never a runtime crash. This mirrors the fail-open,
// defense-in-depth posture the rest of this file's hydration takes.
function hydrateInventoryBuckets(
  map: Record<string, Decimal[] | Array<Decimal | number | string> | Decimal | number | string>
): Record<string, Decimal[]> {
  const hydrated: Record<string, Decimal[]> = {};
  if (map === null || typeof map !== "object") return hydrated; // fail-open on a non-map (hostile / partial save)
  for (const key of Object.keys(map)) {
    if (isUnsafeKey(key)) continue; // hostile-key guard (see isUnsafeKey)
    const value = map[key];
    if (Array.isArray(value)) {
      hydrated[key] = value.map((bucket) => toDecimal(bucket)); // per-bucket revival
    } else {
      // Non-array scalar (defensive): treat as a single quality-0 bucket.
      hydrated[key] = [toDecimal(value)];
    }
  }
  return hydrated;
}

// Applied UNCONDITIONALLY at the end of migrate(), below, NOT only inside
// MIGRATIONS[11]. A save already at the current SAVE_VERSION skips the
// migration while-loop entirely (there's no MIGRATIONS[12] to run), so if
// hydration only happened inside a version-keyed step, saves written by the
// CURRENT serialize()/deserialize() (whose Decimal fields round-trip through
// JSON as plain strings, per toJSON()) would never get converted back into
// live Decimal instances, every .plus()/.gte() call in tick.ts would throw
// at runtime the first time it touched one. Idempotent, so calling it on an
// already-hydrated state (e.g. state built fresh via freshState(), never
// serialized at all) is also safe, toDecimal() no-ops on an existing Decimal.
function hydrateDecimals(state: any): GameState {
  return {
    ...state,
    // Hostile-input guard (cloud / import): tickDurationSeconds is the DIVISOR for offline
    // catch-up (tick() computes ticksElapsed = deltaSeconds / tickDurationSeconds, and
    // offlineCapTicks divides by it too, so the offline cap does NOT bound you). A crafted 0
    // makes that Infinity -> for (i < Infinity) never terminates (hard tab hang); a tiny
    // positive value causes a ~1e17-iteration effective hang. A throw-guard cannot catch a
    // hang, so this must be a VALUE check: reset any non-finite / non-positive cadence to the
    // default 1. A valid save always has a positive finite cadence, so this is a no-op on it.
    tickDurationSeconds:
      Number.isFinite(state.tickDurationSeconds) && state.tickDurationSeconds > 0
        ? state.tickDurationSeconds
        : 1,
    captains: state.captains.map((c: any) => ({
      ...c,
      xp: toDecimal(c.xp),
      // Combat 0.13.0 (Phase 9b.5a): CaptainState.mission is now a discriminated union.
      // Only the EXTRACTION arm carries Decimal cargo needing revival; a PATROL arm holds
      // only plain numbers/strings (hull/shield/seed/waveTicks) and JSON-safe DroneSquadron
      // records, so it rides through UNTOUCHED. Guard on kind === "patrol" (the sole
      // no-cargo arm) so anything else, an extraction mission with or without a stamped
      // kind, still gets the byte-identical cargo hydration below. By the time this runs the
      // v31->v32 migration has already stamped kind:"extraction" on any pre-v32 mission, and
      // a patrol can only exist in a v32+ save, so the kind check is reliable.
      mission: c.mission
        ? c.mission.kind === "patrol"
          ? c.mission
          : {
              ...c.mission,
              cargo: {
                commonOre: toDecimal(c.mission.cargo.commonOre),
                uncommonMaterial: toDecimal(c.mission.cargo.uncommonMaterial),
                rareMaterial: toDecimal(c.mission.cargo.rareMaterial),
              },
            }
        : c.mission,
    })),
    fleetAdminXp: toDecimal(state.fleetAdminXp),
    credits: toDecimal(state.credits),
    // Fuel economy (Mission Rework Task 3): the fleet-wide fuel stockpile is
    // Decimal-typed, so it round-trips through JSON as a plain string exactly like
    // credits above and MUST be toDecimal()'d back or the first .plus()/.gte() a
    // fuel reader (Task 4/5) does would throw. DEFENSIVE `?? new Decimal(0)`: unlike
    // credits (present on every save since v0), `fuel` is brand-new this pass and the
    // migration that seeds it onto existing saves is Task 9 (v20->v21). Until that
    // lands, a pre-migration save reaching here has NO `fuel` field, toDecimal(undefined)
    // would produce a NaN Decimal, so default the absent field to 0. Idempotent and
    // harmless once Task 9's migration guarantees the field's presence.
    fuel: toDecimal(state.fuel ?? new Decimal(0)),
    // craftingXp (Equipment 0.11.0, Task 3 / v26->v27 hotfix): the Crafting Level XP
    // accumulator is Decimal-typed, so it round-trips through JSON as a plain string
    // exactly like credits/fleetAdminXp/fuel above and MUST be toDecimal()'d back or
    // applyCraftingXp's .plus()/.gte() (tick.ts) would throw/NaN on load. DEFENSIVE
    // `?? new Decimal(0)`: MIGRATIONS[26] (v26->v27) backfills this field onto older
    // saves, but default the absent field to 0 so a save that somehow reaches here
    // without it (a partially-migrated / hand-edited shape) hydrates to a live Decimal(0)
    // rather than a NaN, mirroring the `fuel` guard above. THIS revive is now the SOLE
    // guarantee applyCraftingXp (tick.ts) relies on: Task 20 RETIRED applyCraftingXp's
    // own interim coercion guard, so it reads state.craftingXp directly and depends on
    // this rule having produced a live Decimal. Idempotent: toDecimal no-ops on an
    // already-live Decimal (freshState seeds Decimal(0)).
    craftingXp: toDecimal(state.craftingXp ?? new Decimal(0)),
    // Phase 1 (Ship Production Economy) keyed inventory, now QUALITY-BUCKETED
    // (Equipment 0.11.0, Task 9a): each item maps to a Decimal[] of quality-tier
    // buckets, and hydrateInventoryBuckets revives every bucket per-VALUE over this
    // map's DYNAMIC keys (inventory can hold any ITEMS-registry id, not a fixed
    // union). This REPLACED the old scalar hydrateDecimalMap treatment (the shape was
    // `Record<string, Decimal>` before Task 9a), which in turn had replaced the even
    // older homePlanet.storage per-value hydration (storage removed in Task 7, a v18
    // save has NO homePlanet field, so hydrating it here would throw on the unguarded
    // read). Reached unconditionally for the same reason every field here is: any save
    // arriving at hydrateDecimals() has `inventory` guaranteed present, it was written
    // at v18+ (freshState seeds it) or MIGRATIONS[17] built it from the old save's
    // homePlanet.storage before this runs, and MIGRATIONS[25] (v25 -> v26) has already
    // converted a pre-Task-9a scalar inventory into the bucketed shape by the time
    // this runs, so the unguarded read is safe, same posture as the lifetimeStats reads.
    //
    // Task 8 / Fuel v2: a persisted mid-flight timed process (startProcess pushes them
    // into activeProcesses) can carry a Decimal on its effect's `amount`, an `addItem`
    // refine-job output OR an `addFuel` fuel-refine batch (Fuel Depot pipelines), which
    // round-trips through JSON as a plain string exactly like every other Decimal here, so
    // it MUST be toDecimal()'d back or a resolver .plus()/.gt() on it would throw/NaN on
    // load. Guarded on PRESENCE of an `amount` (both addItem and addFuel carry one; any
    // future amount-bearing effect is covered automatically, no per-type opt-in seam): a
    // `facilityLevelUp` effect (and the process's id/kind/remainingTicks/durationTicks
    // scalars) have NO `amount`, so they ride through untouched. Safe unguarded on
    // state.activeProcesses for the same reason inventory is: any save reaching
    // hydrateDecimals() has the field present (v18+ freshState seeds [] / MIGRATIONS[17]
    // backfills [] before this runs), and the .map() no-ops on the empty array the
    // overwhelmingly common (no-process) save carries. facilities/nextProcessId hold no
    // Decimals, so they ride through via the `...state` spread with no hydration.
    activeProcesses: state.activeProcesses.map((p: any) =>
      p.effect && "amount" in p.effect
        ? { ...p, effect: { ...p.effect, amount: toDecimal(p.effect.amount) } }
        : p
    ),
    inventory: hydrateInventoryBuckets(state.inventory),
    // lifetimeStats' 3 scalar sums are Decimal-typed (Progression Pacing
    // Rework), so, exactly like credits/fleetAdminXp above, they round-trip
    // through JSON as plain strings (Decimal.toJSON()) and MUST be converted
    // back here, or the first .plus() a future Completions/Achievements reader
    // does would throw. Reached unconditionally for the same reason every field
    // above is: any save arriving here has already had lifetimeStats guaranteed
    // present, either it was written at v17+ (freshState seeds it) or the
    // migration chain's MIGRATIONS[16] backfilled it before this runs, so the
    // unguarded `state.lifetimeStats.*` reads are safe, same posture as the
    // unguarded credits/inventory reads above.
    //
    // The 4 tally maps (itemsGathered/itemsRefined/itemsCrafted/
    // missionsCompleted) now get per-VALUE hydration too (Progression Pacing
    // Rework, Task 6, the task the earlier "flagged now so it isn't missed"
    // note pointed to). tickCaptainMission started populating itemsGathered/
    // missionsCompleted with real Decimal values (and the crafting path will feed
    // itemsRefined/itemsCrafted later), so each map's per-key Decimals round-trip
    // through JSON as plain strings with the identical hazard the scalars have --
    // hydrateDecimalMap() iterates each map's keys and toDecimal()s every value.
    // All four are covered (not just the two missions feed) so the round-trip is
    // complete regardless of which map a value lands in; empty maps stay empty
    // (hydrateDecimalMap no-ops over zero keys). Reached unconditionally for the
    // same reason as every field above, lifetimeStats is guaranteed present by
    // freshState()/MIGRATIONS[16] before this runs.
    lifetimeStats: {
      ...state.lifetimeStats,
      itemsGathered: hydrateDecimalMap(state.lifetimeStats.itemsGathered),
      itemsRefined: hydrateDecimalMap(state.lifetimeStats.itemsRefined),
      itemsCrafted: hydrateDecimalMap(state.lifetimeStats.itemsCrafted),
      missionsCompleted: hydrateDecimalMap(state.lifetimeStats.missionsCompleted),
      creditsEarned: toDecimal(state.lifetimeStats.creditsEarned),
      captainXpAwarded: toDecimal(state.lifetimeStats.captainXpAwarded),
      fleetAdminXpAwarded: toDecimal(state.lifetimeStats.fleetAdminXpAwarded),
    },
  };
}

// Migration table, keyed by the version a save is migrating FROM.
// v1 -> v2: tick bar feature added tickDurationSeconds (see MIGRATIONS[1]).
// v2 -> v3: research feature (docs/plans/2026-07-03-research-plan.md, Task 3)
// added `research` to GameState. Saves made before that field existed need
// it backfilled to a fresh, not-yet-started alloySynthesis entry.
// v3 -> v4: HOTFIX. The same research feature also added a 4th module/
// resource pair (modules.synthesizer, resources.alloys) to MODULES/
// RESOURCE_ORDER, but MIGRATIONS[2] only backfilled `research`, it never
// backfilled these two fields. Any save migrated through the *unpatched*
// MIGRATIONS[2] already got re-stamped as v3 by the next autosave (serialize()
// always writes the current SAVE_VERSION), but still has an object literal
// missing the `synthesizer`/`alloys` keys entirely, not just a numeric
// zero. That undefined count makes costFor() -> Math.pow(x, undefined) ->
// NaN, which makes affordable = ore >= NaN always false: Synthesizer looks
// permanently unaffordable no matter how much ore you have.
// Because those already-v3-stamped saves will never re-run MIGRATIONS[2]
// (their version field already reads 3), patching MIGRATIONS[2] cannot fix
// them. Per Ops §8.E.1 (never edit a shipped migration body), this repair
// has to be a new v3 -> v4 step instead, so it runs for both the
// already-corrupted v3 saves and any v1/v2 save still chaining through.
// v4 -> v5: Multi-Captain Stacks (docs/plans/2026-07-03-captain-ship-plan.md,
// Task 3). The single flat resources/modules/research/lifetimeComponents/
// tickDurationSeconds shape moves into captains[0]; a fresh captains[1] is
// added alongside it. The old top-level fields are dropped from the migrated
// shape (they no longer exist on GameState at all, there is nothing to
// backfill them TO on the fleet-wide object, unlike prior migrations which
// only ever added missing fields to an otherwise-intact shape).
// v5 -> v6: HOTFIX. freshCaptains() originally gave Captain 2 a deliberately
// empty stack (0 modules) to feel distinct from a "just reset" captain. That
// was a genuine softlock: every module (including the miner) costs ore, and
// only a miner produces ore, so a captain starting at 0 miners can never
// afford anything, ever. Confirmed live in production. freshCaptains() itself
// is already fixed (both captains now get 1 free miner), which is enough for
// brand-new saves, but any save that already migrated through the
// unpatched MIGRATIONS[4] has a captain permanently frozen at 0 miners baked
// into its serialized state, and (per Ops §8.E.1) that migration body can't
// be edited to fix them retroactively. This step repairs any captain with
// modules.miner === 0: there's no "sell modules" mechanic anywhere in this
// game, so the ONLY way a captain can be sitting at 0 miners is this exact
// bug, a captain who was ever actually playable would have bought
// something by now. Safe to apply unconditionally for that reason.
// v6 -> v7: Fleet Admiral Skill Tree (docs/plans/2026-07-06-skill-tree-plan.md,
// Task 3). GameState gains `skillPoints`/`unlockedSkillNodes`. Existing v6
// saves already have 2 captains from Phase 1 (freshState() used to always
// give 2), rather than shrinking their roster to match the NEW "starts at
// 1" default (which would delete a captain's progress), this grandfathers
// them: if a save already has 2+ captains, commandRank1 is marked as already
// unlocked (so captainSlotCount(state) matches what they already have,
// keeping Fleet Prestige's reset consistent going forward), with no bonus
// skillPoints granted, just "don't lose what you already earned." Only
// commandRank1 is ever granted here, never rank 2/3, no real save can have
// more than 2 captains pre-v7, so there's nothing to grandfather beyond
// rank 1. If that ever stops being true (a future path produces a >2-captain
// save arriving here), this ONLY grants rank 1 regardless of actual count --
// not reachable through any current code path, but worth knowing, same
// category of gap as MIGRATIONS[2]/[3]'s comments above.
// v7 -> v8: Home Planet & Mission Expeditions (docs/plans/2026-07-06-home-
// planet-expeditions-plan.md, Task 4). GameState gains `homePlanet.storage`
// (a fleet-wide loot stockpile, separate from any captain's own resources)
// and CaptainState gains `mission` (null when idle, populated while a
// captain is off running a mission expedition). Existing v7 saves have
// neither: `homePlanet` is backfilled to a fresh, all-zero storage object,
// and every captain in the roster gets `mission: null` if they don't already
// have a `mission` field. `c.mission ?? null` is written so it's a no-op
// (not a fresh reassignment) when `mission` is already present and already
// `null`, this matters for the chained multi-version test below, where a
// v1 save chains all the way to v8 and captains picked up other fields along
// the way; we don't want this step to clobber anything already correctly
// set by an earlier step in the same chain.
// v8 -> v9: Navigation Restructuring & Progression Overhaul (docs/plans/2026-
// 07-06-phase4-navigation-progression-overhaul-plan.md, Task 7). This is the
// first migration in this project's history to correspond to a batch of
// REMOVED fields as well as added ones, but unlike v4->v5 above, which
// actively deletes its old top-level fields via destructuring (that data had
// a new home to move to: captains[0]), this step does NOT delete anything,
// because there's nowhere for Generator-Stack-era fields to move to: the
// Generator Stack economy (and everything built on top of it, Research,
// Specializations, the Skill Tree, both Prestige tiers) is gone from
// CaptainState/GameState, replaced by a Homeworld crafting system and a
// captain XP/leveling system, not migrated to a new location. Per the
// design doc, this migration does NOT attempt to strip the old fields
// (`modules`, `resources`, `research`, `captainPoints`, `captainPrestigeCount`,
// `specialization`, `skillPoints`, `unlockedSkillNodes`, `augmentPoints`,
// `prestigeCount`) out of an old save's JSON, once CaptainState/GameState
// stop declaring them, nothing reads them, so they become harmless, inert
// extra properties riding along in the serialized blob. Stripping them would
// be extra risk (more code touching the migrated shape) for zero behavioral
// benefit. This step's only real job is backfilling the NEW required fields:
// CaptainState gains `xp`/`level`/`statPoints` (all absent entirely on any
// pre-v9 save, backfilled to 0/1/0, the same baseline freshCaptainStack()
// gives a brand-new captain), and homePlanet.storage gains the 2 new crafted-
// goods keys `refinedMaterial`/`components` (absent entirely pre-v9,
// backfilled to 0 each) alongside its existing 3 mission-loot keys, which are
// preserved via the spread rather than reconstructed.
// v9 -> v10: Captain & Homeworld Talent Trees (docs/plans/2026-07-07-captain-
// homeworld-talent-trees-plan.md, Task 5). CaptainState gains
// `unlockedCaptainTalents` (a per-captain list of purchased captain-talent
// keys), and GameState gains `unlockedHomeworldTalents` (the fleet-wide
// counterpart list) plus the new Fleet Admiral leveling trio `fleetAdminXp`/
// `fleetAdminLevel`/`adminPoints` (mirrors the captain xp/level/statPoints
// baseline MIGRATIONS[8] already established, just at the fleet-wide level
// instead of per-captain). All five fields are absent entirely on any pre-v10
// save, backfilled to `[]`, `[]`, `0`, `1`, `0` respectively, the same
// baseline freshState()/freshCaptainStack() give a brand-new game.
// v10 -> v11: UI Redesign (docs/plans/2026-07-07-ui-redesign-plan.md, Task 3).
// Collapses `tickDurationSeconds` from per-captain (where it has lived since
// MIGRATIONS[4]'s Multi-Captain Stacks split moved it onto captains[0], and
// onto every subsequently-added captain since) back to a single fleet-wide
// field on GameState, every captain now advances on the same shared
// cadence (see the design doc for why). Reads the value off the FIRST
// captain (any pre-v11 save's captains all share the same value, nothing
// has ever diverged them) as the new fleet-wide default, then strips the
// now-removed field from every captain via destructuring (same "delete via
// destructure" idiom MIGRATIONS[4] used when it moved fields IN the other
// direction). Falls back to 10 if captains[0] somehow has no
// tickDurationSeconds at all, not reachable through any current code path
// (freshCaptainStack always set it pre-v11), but defense in depth, same
// category as several earlier migrations' `??` comments.
// v11 -> v12: Big-Number (Decimal) Migration (docs/plans/2026-07-08-big-
// number-migration-plan.md). homePlanet.storage's 5 keys, each captain's
// mission.cargo (3 keys) and xp, and fleetAdminXp switch from plain number to
// break_infinity.js's Decimal, to support unbounded scale (up to e1,000,000+).
// This migration step itself does no real conversion work, on a pre-v12
// save, every one of these fields is still a plain JS number at this point in
// the chain (JSON.parse of an OLD save's JSON never produced anything else),
// and migrate()'s hydrateDecimals() call (see below, applied unconditionally
// AFTER this while loop finishes, regardless of which migrations ran) is what
// actually converts them into live Decimal instances. This step exists purely
// so the version-bump/migration-table convention (Ops §8.E.1: bump
// SAVE_VERSION, add a migrate_vN_to_vN+1 entry when the schema changes) has a
// documented marker at the exact version where Decimal fields were
// introduced, for any future reader scanning this table.
// v12 -> v13: Tick Granularity Rebalance (docs/plans/2026-07-08-tick-granularity-
// rebalance-plan.md). tickDurationSeconds drops from 10 to 1 real second per tick,
// and MISSIONS' phase tick-counts are genuinely rebalanced (not just multiplied by
// 10), so an in-progress mission's old phaseProgressTicks doesn't map onto the new
// tick-counts via simple multiplication. Instead, this preserves the RELATIVE
// (percentage) position within the captain's current phase, remapped onto the new
// tick-count for that same phase. The pre-rebalance (v12-era) MISSIONS tick-counts
// are snapshotted as literal values here, NOT read from the live MISSIONS/
// requiredTicksForPhase in model.ts, which already reflect the NEW post-rebalance
// values by the time this migration runs, so this keeps producing the correct
// v12 ratio permanently, even after MISSIONS is rebalanced again in some future
// update. phaseProgressTicks is already documented as continuous/fractional, so
// the remapped result needs no rounding.
// v13 -> v14: Talent Tree Visual Redesign (docs/plans/2026-07-08-talent-tree-
// visual-redesign-plan.md, Task 1). GameState gains `credits` (a fleet-wide
// currency, Decimal-typed from the start, see hydrateDecimals below, which
// converts it unconditionally same as fleetAdminXp/homePlanet.storage/etc.),
// and CaptainState gains `spec` (this captain's chosen Captain Specialization
// branch, or null if none chosen yet, NOT Decimal-typed, so no hydration
// step is needed for it). Both fields are absent entirely on any pre-v14
// save, backfilled to 0 and null respectively, the same baseline
// freshState()/freshCaptainStack() give a brand-new game/captain. Note this
// backfill applies to EVERY captain in state.captains at this point in the
// chain regardless of how that captain object was originally constructed
// (e.g. MIGRATIONS[4]'s inline `captainOne` literal, far below, predates
// `spec` entirely, same as it predates `xp`/`level`/`statPoints` (backfilled
// by MIGRATIONS[8]) and `unlockedCaptainTalents` (backfilled by MIGRATIONS[9]),
// neither of which needed touching at MIGRATIONS[4]'s own construction site
// either). Because MIGRATIONS runs strictly in increasing numeric order (see
// migrate()'s while-loop below), this step always executes AFTER MIGRATIONS[4]
// (or any other earlier step) has already run, and maps over whatever
// state.captains looks like at THAT point, so every captain, regardless of
// origin, picks up `spec: null` here.
// Mission Rework (Task 1): FROZEN to the exact 2 mission keys that existed at save
// v12. Was `Record<MissionKey, ...>`, but MissionKey now includes salvageWreckage/
// forageFlora, missions that did NOT exist at v12 and can never appear in a v12
// save, so this migration snapshot must NOT be forced to carry entries for them.
// Pinning the key type to the historical literal union keeps the v12 migration a
// faithful record of the v12 world (the migration LOGIC is unchanged) and stops the
// evolving MissionKey union from dragging new missions into a shipped migration.
type MissionKeyV12 = "shortOreRun" | "longOreRun";
const OLD_MISSION_TICKS_V12: Record<MissionKeyV12, {
  transitOutTicks: number; transitBackTicks: number; unloadTicks: number;
  extractionRatePerTick: number; cargoCapacity: number;
}> = {
  shortOreRun: { transitOutTicks: 3, transitBackTicks: 3, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
  longOreRun: { transitOutTicks: 8, transitBackTicks: 8, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
};

function oldRequiredTicksForPhase_v12(phase: MissionPhase, missionKey: MissionKeyV12): number {
  const def = OLD_MISSION_TICKS_V12[missionKey];
  switch (phase) {
    case "ordersReceived": return 1;
    case "transitOut": return def.transitOutTicks;
    case "extracting": return Math.ceil(def.cargoCapacity / def.extractionRatePerTick);
    case "transitBack": return def.transitBackTicks;
    case "unloading": return def.unloadTicks;
  }
}

type Migration = (state: any) => any;
const MIGRATIONS: Record<number, Migration> = {
  1: (state: any): GameState => ({ ...state, tickDurationSeconds: state.tickDurationSeconds ?? 10 }),
  2: (state: any): GameState => ({
    ...state,
    // `??` only catches `research` being entirely absent (the actual v2
    // shape). It does NOT repair a present-but-malformed research object
    // (e.g. `research: {}`), not reachable through any current code path
    // (serialize() always writes a fully-typed GameState), but worth
    // knowing if a future migration or refactor ever produces a partial one.
    research: state.research ?? { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
  }),
  3: (state: any): GameState => ({
    ...state,
    // `state.modules?.` / `state.resources?.` guard against `modules`/
    // `resources` being wholesale absent, not just missing one key, not
    // reachable through any current code path (freshState() has always
    // populated both objects fully, and every mutation site spreads the
    // existing object rather than reconstructing it), but if that ever
    // stopped being true, this would silently drop the other module/
    // resource keys rather than throwing. Same category of unreachable-but-
    // worth-knowing gap as MIGRATIONS[2]'s `??` comment above.
    modules: { ...state.modules, synthesizer: state.modules?.synthesizer ?? 0 },
    resources: { ...state.resources, alloys: state.resources?.alloys ?? 0 },
  }),
  4: (state: any): GameState => {
    // fresh[0] is discarded, captainOne below carries the real migrated
    // data instead of a blank stack. Only fresh[1] (a genuinely never-played
    // second captain) is used, byte-for-byte identical to what a brand-new
    // save's Captain 2 looks like, since it's the same function call.
    const fresh = freshCaptains(2); // a v4 save is, by construction, always exactly the 2-captain Phase-1 shape
    // historical shape, predates the current CaptainState; typed loose so this frozen body isn't coupled to the live interface.
    const captainOne: any = {
      id: 1,
      label: "Captain 1",
      shipType: "resourcer",
      // Cloned (not passed by reference) so the pre-migration `state` object
      // and the new captains[0] can never end up aliased to the same nested
      // objects, defense in depth, consistent with MIGRATIONS[3]'s spread
      // above, even though no current caller retains a handle to the raw
      // pre-migration object.
      resources: { ...state.resources },
      modules: { ...state.modules },
      research: { ...state.research },
      lifetimeComponents: state.lifetimeComponents,
      tickDurationSeconds: state.tickDurationSeconds,
      captainPoints: 0,
      captainPrestigeCount: 0,
      specialization: null,
    };
    const { resources, modules, research, lifetimeComponents, tickDurationSeconds, ...fleetWide } = state;
    return {
      ...fleetWide,
      captains: [captainOne, fresh[1]],
    };
  },
  5: (state: any): GameState => ({
    ...state,
    captains: state.captains.map((c: any) =>
      c.modules?.miner === 0 ? { ...c, modules: { ...c.modules, miner: 1 } } : c
    ),
  }),
  6: (state: any): GameState => ({
    ...state,
    // Grandfathers ONLY commandRank1, never rank 2/3, see the file-header
    // comment above for why that's the only case a real pre-v7 save can be in.
    unlockedSkillNodes: state.unlockedSkillNodes ?? ((state.captains?.length ?? 1) >= 2 ? ["commandRank1"] : []),
    skillPoints: state.skillPoints ?? 0,
  }),
  7: (state: any): GameState => ({
    ...state,
    // Fleet-wide loot stockpile, absent entirely on any pre-v8 save, backfill
    // to a fresh, all-zero storage object. See the file-header comment above.
    homePlanet: state.homePlanet ?? { storage: { commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 } },
    captains: state.captains.map((c: any) => ({ ...c, mission: c.mission ?? null })),
  }),
  8: (state: any): GameState => ({
    ...state,
    captains: state.captains.map((c: any) => ({
      ...c,
      xp: c.xp ?? 0,
      level: c.level ?? 1,
      statPoints: c.statPoints ?? 0,
    })),
    homePlanet: {
      storage: {
        ...state.homePlanet.storage,
        refinedMaterial: state.homePlanet.storage.refinedMaterial ?? 0,
        components: state.homePlanet.storage.components ?? 0,
      },
    },
  }),
  9: (state: any): GameState => ({
    ...state,
    captains: state.captains.map((c: any) => ({ ...c, unlockedCaptainTalents: c.unlockedCaptainTalents ?? [] })),
    unlockedHomeworldTalents: state.unlockedHomeworldTalents ?? [],
    fleetAdminXp: state.fleetAdminXp ?? 0,
    fleetAdminLevel: state.fleetAdminLevel ?? 1,
    adminPoints: state.adminPoints ?? 0,
  }),
  10: (state: any): GameState => {
    // v10 -> v11: UI Redesign (docs/plans/2026-07-07-ui-redesign-plan.md,
    // Task 3). Collapses tickDurationSeconds from per-captain (where it lived
    // since MIGRATIONS[4]'s Multi-Captain Stacks split) back to a single
    // fleet-wide field on GameState, every captain now advances on the same
    // shared cadence (see the design doc for why). Reads the value off the
    // FIRST captain (any pre-v11 save's captains all share the same value --
    // nothing has ever diverged them) as the new fleet-wide default, then
    // strips the now-removed field from every captain via destructuring --
    // the same "delete via destructure" idiom MIGRATIONS[4] used, applied
    // per-captain here rather than once on the top-level state object (since
    // MIGRATIONS[4] moved fields IN the other direction: off GameState, onto
    // captains[0]). Falls back to 10 if captains[0] somehow
    // has no tickDurationSeconds at all, not reachable through any current
    // code path (freshCaptainStack always set it pre-v11), but defense in
    // depth, same category as several earlier migrations' `??` comments.
    const tickDurationSeconds = state.captains[0]?.tickDurationSeconds ?? 10;
    return {
      ...state,
      tickDurationSeconds,
      captains: state.captains.map((c: any) => {
        const { tickDurationSeconds: _unused, ...rest } = c;
        return rest;
      }),
    };
  },
  11: (state: any): GameState => state, // no-op, see the comment above; hydrateDecimals() (called unconditionally in migrate(), below) does the real work for both old AND already-current-version saves.
  12: (state: any): GameState => ({
    ...state,
    tickDurationSeconds: 1,
    captains: state.captains.map((c: any) => {
      if (!c.mission) return c;
      const oldRequired = oldRequiredTicksForPhase_v12(c.mission.phase, c.mission.missionKey);
      // Math.min(1, ...) guards against a ratio > 1 if phaseProgressTicks ever
      // exceeded oldRequired before migration ran, not reachable through any
      // current code path (nothing lets progress overrun a phase boundary
      // pre-migration), but defense in depth, same category as MIGRATIONS[2]/
      // [3]/[10]'s ??/fallback comments above.
      const progressRatio = Math.min(1, c.mission.phaseProgressTicks / oldRequired);
      const newRequired = requiredTicksForPhase(c.mission.phase, MISSIONS[c.mission.missionKey as keyof typeof MISSIONS]);
      return { ...c, mission: { ...c.mission, phaseProgressTicks: progressRatio * newRequired } };
    }),
  }),
  13: (state: any): GameState => ({
    ...state,
    // Plain number here, not `new Decimal(0)`, hydrateDecimals() (called
    // unconditionally in migrate(), below) converts this to a real Decimal
    // for both old AND already-current-version saves, same pattern as
    // MIGRATIONS[11]'s no-op step used for the prior Decimal migration.
    credits: 0,
    // spec needs no such hydration, it's not Decimal-typed. Backfilled here
    // for every captain regardless of origin; see the file-header comment
    // above for why this covers MIGRATIONS[4]'s inline captainOne literal too.
    captains: state.captains.map((c: any) => ({ ...c, spec: null })),
  }),
  // v14 -> v15: Radial Skill Web. Captain talent tree fully restructured
  // (linear `requires` chains -> radial graph; command/diplomacy specs removed;
  // command's extraction talents re-homed to resourcefulness). Old captain
  // talent KEYS no longer exist in CAPTAIN_TALENTS, so we refund from a FROZEN
  // snapshot of the v14 costs (never reference the live table for removed keys)
  // and clear every captain's unlockedCaptainTalents. Both removed specs
  // (command AND diplomacy) are nulled defensively: command was the only other
  // selectable spec besides resourcefulness, and diplomacy was never selectable
  // so no legitimate save should carry it, but nulling it too costs one token
  // and neutralizes any orphaned/hand-edited `diplomacy` value rather than
  // letting it survive into v15 as an invalid spec with no CAPTAIN_SPEC_BONUS
  // entry (same defense-in-depth posture as the ??-guards throughout this file).
  // resourcefulness (and the new tactical/science) are valid v15 specs, so they
  // pass through. Homeworld keys are all preserved (Task 3 kept every v14 key),
  // so unlockedHomeworldTalents is left untouched here.
  14: (state: any): GameState => {
    const V14_CAPTAIN_TALENT_COSTS: Record<string, number> = {
      commandExtractionI: 2, commandExtractionII: 4,
      resourcefulnessRareChanceI: 2, resourcefulnessRareChanceII: 4,
      resourcefulnessBonusRollI: 6, resourcefulnessBonusRollII: 8,
    };
    return {
      ...state,
      captains: state.captains.map((c: any) => {
        const refund = (c.unlockedCaptainTalents ?? []).reduce(
          (sum: number, key: string) => sum + (V14_CAPTAIN_TALENT_COSTS[key] ?? 0),
          0
        );
        return {
          ...c,
          statPoints: (c.statPoints ?? 0) + refund,
          unlockedCaptainTalents: [],
          spec: c.spec === "command" || c.spec === "diplomacy" ? null : c.spec, // clear BOTH removed specs; resourcefulness/tactical/science kept
        };
      }),
    };
  },
  // v15 -> v16: Ships stats foundation. Captain/ship separation, every existing
  // captain is grandfathered a General Freighter (== today's implicit ship:
  // cargo 90 / 1.0x / 1.0x, so in-flight missions are unaffected). shipType is
  // dropped from captains; ships/shipStorageCapacity/nextShipId are added.
  // Frozen once shipped (never edit this body).
  15: (state: any): any => {
    let nextShipId = 1;
    const ships = (state.captains ?? []).map((c: any) => ({
      id: `ship-${nextShipId++}`,
      typeKey: "generalFreighter",
      assignedCaptainId: c.id,
    }));
    const captains = (state.captains ?? []).map(({ shipType, ...rest }: any) => rest);
    return { ...state, captains, ships, shipStorageCapacity: 8, nextShipId };
  },
  // v16 -> v17: Progression Pacing Rework (docs/plans/2026-07-11-progression-
  // pacing-rework-*). GameState gains `lifetimeStats`, monotonic LIFETIME
  // totals reserved now for a future Completions/Achievements system to read.
  // Absent entirely on any pre-v17 save (freshState() only began seeding it in
  // this same feature), so backfill the identical clean-slate zeroed shape a
  // brand-new game gets, via the SHARED freshLifetimeStats() factory (model.ts)
  // that freshState() also calls, so the migrated and fresh shapes can never
  // drift apart (Omega 4, DRY). freshLifetimeStats() returns live Decimal(0)
  // scalars, so this migrated shape already carries real Decimals; the
  // unconditional hydrateDecimals() at the end of migrate() re-confirms them
  // (idempotent, toDecimal() no-ops on an existing Decimal), the same
  // pattern every prior Decimal field in this file relies on for its round-trip
  // (a re-saved v17 blob serializes those Decimals to strings, and that same
  // hydrateDecimals() call converts them back). The 4 tally maps start empty
  // ({}), so there are no per-key values to backfill or hydrate yet.
  // Frozen once shipped (never edit this body).
  16: (state: any): any => ({ ...state, lifetimeStats: freshLifetimeStats() }),
  // v17 -> v18: Ship Production Economy, Phase 1 (docs/plans/2026-07-11-facility-
  // framework-refinery-design.md §8, reconciled §0 to v17->v18). GameState gains
  // the keyed `inventory` (replacing homePlanet.storage's fixed union, Task 7
  // DROPS the old homePlanet field in this same migration, after reading its
  // storage to build inventory), the `discovered` set, and the
  // facility/timed-process reservation fields (facilities/activeProcesses/
  // nextProcessId). Absent entirely on any genuine pre-v18 (shipped-v17) save.
  //
  // - inventory is built 1:1 from homePlanet.storage: every storage key copies
  //   across, value-for-value. toDecimal() each value here so (a) the >0 discovery
  //   test below has a real Decimal to call .gt() on even when the source is a
  //   plain JSON number/string, and (b) inventory already carries live Decimals
  //   (the unconditional hydrateDecimals() at the end of migrate() re-confirms them
  //   via hydrateDecimalMap, idempotent, same pattern MIGRATIONS[16] relies on).
  // - discovered is seeded with every itemId whose storage balance is > 0
  //   (already-owned == already-discovered, so existing saves show no false ❓ on
  //   items they already hold). Empty-balance keys are NOT added, they stay masked
  //   until first acquired, exactly like a brand-new save (freshState: discovered []).
  // - facilities/activeProcesses/nextProcessId get the SAME clean-slate baseline
  //   freshState seeds (refinery not built, no processes, next id 1).
  // - lifetimeStats is NOT touched, it already shipped live in v17 (MIGRATIONS[16]
  //   / freshLifetimeStats), so re-seeding it here would clobber a returning
  //   player's accrued totals. The `...state` spread carries it through untouched.
  // homePlanet is DROPPED by this migration (Task 7): it's destructured out of the
  // returned state below so migrated v18 saves carry NO homePlanet field, only the
  // keyed `inventory` built from it. `state.homePlanet?.storage ?? {}` reads the old
  // save's storage to build inventory, guarding the wholesale-absent case defensively
  // (not reachable on a real save, every save since v8 has homePlanet.storage --
  // same defense-in-depth posture as this file's other ?? guards); an empty source
  // simply yields an empty inventory + no discoveries.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to
  // production, so it is still editable (the frozen-once-shipped rule applies only to
  // production-released migrations).
  17: (state: any): any => {
    const oldStorage = state.homePlanet?.storage ?? {};
    const inventory: Record<string, Decimal> = {};
    const discovered: string[] = [];
    for (const key of Object.keys(oldStorage)) {
      const value = toDecimal(oldStorage[key]); // handles plain number/string (old save) OR live Decimal (chained/fresh)
      inventory[key] = value;
      if (value.gt(0)) discovered.push(key); // already-owned == already-discovered; zero-balance keys stay masked
    }
    // Destructure `homePlanet` OUT of the spread so it is stripped from the migrated
    // shape (fully replaced by `inventory`); everything else in `state` rides through
    // `rest` untouched (lifetimeStats, captains, credits, etc.).
    const { homePlanet: _removedHomePlanet, ...rest } = state;
    return {
      ...rest,
      inventory,
      discovered,
      facilities: { refinery: { level: 0 } },
      activeProcesses: [],
      nextProcessId: 1,
    };
  },
  // v18 -> v19: Tiered Warehouse facilities (Phase 2, Task B2/B4, docs/plans/
  // 2026-07-13-phase-2-warehouse-refine-economy-design.md §3.1-§3.3). Task B2 added
  // two tiered Warehouse facilities to freshState (facilities.warehouseT1 /
  // facilities.warehouseT2, each { level: 0 }); this step backfills them onto an
  // existing v18 save, whose facilities map was seeded refinery-ONLY by MIGRATIONS[17]
  // (Phase 1). Both warehouses are added at level 0 IF ABSENT, warehouseT1's level 0
  // is the base tier's LIVE starting state (cap 1,000,000; NOT "unbuilt", T1 is
  // available from the start), and warehouseT2's level 0 is LOCKED (its rung 0 is the
  // unlock). Uses the SAME `{ level: 0 }` literal freshState (model.ts) seeds, so the
  // migrated and fresh shapes cannot drift apart (Omega 4).
  //
  // - refinery is preserved value-for-value via `...state.facilities`; ONLY the two
  //   warehouse keys are added. inventory / activeProcesses / lifetimeStats /
  //   nextProcessId and every other GameState field ride through untouched on the outer
  //   `...state` spread, this step's sole job is the two warehouse facility seeds.
  // - `?? { level: 0 }` is idempotent + belt-and-suspenders: a genuine v18 save has
  //   neither key (so both are seeded), but if a chained/hand-edited save somehow
  //   already carries one, its existing level is preserved rather than reset to 0.
  //   `state.facilities?.` guards the wholesale-absent facilities case defensively
  //   (not reachable on a real v18 save, MIGRATIONS[17] always seeds facilities --
  //   same defense-in-depth posture as this file's other ?? guards).
  // - Warehouse facility state is `{ level: number }`, NO Decimal, so hydrateDecimals
  //   needs NO change: facilities rides through its own `...state` spread there with no
  //   per-key hydration, exactly as the refinery key already has since v18.
  // - Refine-order state and the refine confirmation preference are NOT migrated here --
  //   they belong to a later Group-D (refine orders) task, which adds its OWN migration
  //   when built. Task B4 is warehouses ONLY (keep it minimal).
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to
  // production, so it is still editable (the frozen-once-shipped rule applies only to
  // production-released migrations).
  18: (state: any): any => ({
    ...state,
    facilities: {
      ...state.facilities,
      warehouseT1: state.facilities?.warehouseT1 ?? { level: 0 },
      warehouseT2: state.facilities?.warehouseT2 ?? { level: 0 },
    },
  }),
  // v19 -> v20: Refine-order engine (Phase 2, Task D1, docs/plans/2026-07-13-phase-
  // 2-warehouse-refine-economy-design.md §4/§5). Task D1 added `refineOrder`
  // (RefineOrder | null) to GameState + freshState (seeded null); this step backfills
  // that same null seed onto an existing v19 save, which predates the field entirely.
  //
  // - `?? null` is idempotent + belt-and-suspenders: a genuine v19 save has NO
  //   refineOrder key (so it is seeded null), but if a chained/hand-edited save somehow
  //   already carries one, its existing order is PRESERVED rather than wiped. Mirrors
  //   the `?? { level: 0 }` posture MIGRATIONS[18] uses for the warehouse facilities.
  // - Every OTHER GameState field rides through untouched on the outer `...state`
  //   spread, this step's sole job is the one `refineOrder` seed, exactly the
  //   minimal-single-field shape MIGRATIONS[18] set the template for.
  // - RefineOrder carries NO Decimal (recipeKey string, mode.remaining a plain number,
  //   pausedReason a string literal), so hydrateDecimals needs NO change: refineOrder
  //   rides through its own `...state` spread there with no per-field revival, exactly
  //   as the Decimal-free `facilities`/`nextProcessId` fields already do.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to
  // production, so it is still editable (the frozen-once-shipped rule applies only to
  // production-released migrations).
  19: (state: any): any => ({
    ...state,
    refineOrder: state.refineOrder ?? null,
  }),
  // v20 -> v21: Mission Rework + Fuel Economy (docs/plans/2026-07-14-mission-rework-
  // plan.md Task 9 / design §6). Three additive seeds for the new state this feature
  // introduced (Tasks 3/4/6), mirroring the minimal single-purpose shape MIGRATIONS[18]/
  // [19] set the template for:
  //
  // - `fuel` (the fleet-wide Decimal stockpile, Task 3): seeded FUEL_TANK_BASE_CAP as a
  //   PLAIN NUMBER, not `new Decimal(...)`, the unconditional hydrateDecimals() at the end
  //   of migrate() converts it to a real Decimal (its `fuel` branch already handles this
  //   defensively, added in Task 3), the exact same plain-number pattern MIGRATIONS[13] uses
  //   for `credits`.
  //   SOFT-LOCK FIX (2026-07-14): the seed changed from 0 to FUEL_TANK_BASE_CAP (a FULL tank)
  //   to match freshState's new full-tank start. A pre-fuel v20 save has NO `fuel` key, no
  //   Deuterium Ice, and possibly no credits, so an empty-tank seed would have soft-locked a
  //   returning player exactly as it did a new one, canDispatch fuelEmpty on every mission,
  //   no way to bootstrap the fuel economy. The `??` is DELIBERATELY KEPT: only a save with
  //   NO fuel field (a genuine pre-fuel v20) gets the one-time full-tank grant; a chained/
  //   hand-edited save that ALREADY carries a fuel balance keeps it exactly (never reset,
  //   never topped up). Non-exploitable: the grant fires once, only when fuel is absent.
  // - `facilities.fuelStorage` at level 0 (Task 4): the base tank's LIVE starting state
  //   (cap FUEL_TANK_BASE_CAP; NOT "unbuilt", the tank is usable from level 0, so
  //   missions can be fueled immediately, no soft-lock). Same `{ level: 0 }` literal
  //   freshState seeds, so migrated and fresh shapes cannot drift apart (Omega 4).
  // - `facilities.missionControl` at level 1 (Task 6), ⚠️ LOAD-BEARING, level 1 NOT 0.
  //   ALL FOUR missions are `unlockLevel: 1` (USER REVISION 2026-07-14) and
  //   missionUnlocked() derives purely from this facility's LEVEL (no separate flag).
  //   Seeding level 0 ("not built") would make missionUnlocked() return false for every
  //   mission, silently LOCKING the whole default set on every returning player's save --
  //   a soft-lock/regression. Level 1 keeps all four dispatchable. The mission-control
  //   unlock UPGRADE is deferred (track caps at level 1) until future missions exist.
  //
  // `?? { level: 0 }` / `?? { level: 1 }` are idempotent + belt-and-suspenders (a re-run
  // or partially-migrated save keeps an existing level rather than resetting it), and
  // `state.facilities?.` guards the wholesale-absent facilities case defensively, not
  // reachable on a real v20 save (MIGRATIONS[17] always seeds facilities), same defense-
  // in-depth posture as this file's other ?? guards. NO ShipInstance grandfathering: hull
  // fuel stats (fuelCapacity/engineEfficiency) live on ShipTypeDef and instances derive
  // them from SHIP_TYPES (Task 3), so there is nothing to backfill onto ships here.
  // fuelStorage/missionControl facility state is `{ level: number }`, NO Decimal, so
  // hydrateDecimals needs NO change (facilities rides through its own `...state` spread
  // there, same as refinery/warehouse have since v18). Every OTHER GameState field rides
  // through untouched on the outer `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to
  // production, so it is still editable (the frozen-once-shipped rule applies only to
  // production-released migrations).
  20: (state: any): any => ({
    ...state,
    fuel: state.fuel ?? FUEL_TANK_BASE_CAP,
    facilities: {
      ...state.facilities,
      fuelStorage: state.facilities?.fuelStorage ?? { level: 0 },
      missionControl: state.facilities?.missionControl ?? { level: 1 },
    },
  }),
  // v21 -> v22: Research (docs/plans/…research-plan.md Task R6 / design). Two additive seeds
  // for the new state the Research feature introduced (Tasks R1/R2), mirroring the minimal
  // single-purpose shape MIGRATIONS[18]/[19]/[20] set the template for:
  //
  // - `researchedBlueprints` (the fleet-wide unlocked-blueprint list, Task R1): seeded `[]` if
  //   absent. A string[] of blueprint KEYS, NO Decimal, so hydrateDecimals needs NO change:
  //   it rides through its own `...state` spread there with no per-value revival, exactly as the
  //   Decimal-free `discovered` string[] already does. The `?? []` is idempotent + belt-and-
  //   suspenders: a genuine v21 save has NO researchedBlueprints key (so it is seeded `[]`), but
  //   a chained/hand-edited save that already carries unlocks keeps them exactly (never wiped).
  // - `facilities.research` at level 1 (Task R2), ⚠️ LOAD-BEARING, level 1 NOT 0, the same
  //   reasoning missionControl carries in MIGRATIONS[20]. Level 0 is "not built"; seeding at
  //   level 1 makes the Research Lab ESTABLISHED from game start, so tier-1 blueprints are
  //   researchable immediately on a returning player's save (blueprintResearchable() gates on
  //   research-facility level >= tier). A level-0 seed would silently LOCK all research on every
  //   existing save, a soft-lock/regression. Same `{ level: 1 }` literal freshState seeds, so
  //   migrated and fresh shapes cannot drift apart (Omega 4). researchSlotCount tolerates an
  //   absent key (?? 0) regardless, but seeding keeps the facility present for the R5 UI.
  //
  // `?? { level: 1 }` is idempotent + belt-and-suspenders (a re-run or partially-migrated save
  // keeps an existing level rather than resetting it), and `state.facilities?.` guards the
  // wholesale-absent facilities case defensively, not reachable on a real v21 save
  // (MIGRATIONS[17] always seeds facilities), same defense-in-depth posture as this file's other
  // ?? guards. research facility state is `{ level: number }`, NO Decimal, so hydrateDecimals
  // needs NO change (facilities rides through its own `...state` spread there, same as refinery/
  // warehouse/fuelStorage/missionControl have since v18/v21). R3's researchProject timed processes
  // ride `activeProcesses`, which is ALREADY migrated + hydrated (its unlockBlueprint effect carries
  // no `amount`, so hydrateDecimals leaves it untouched), so there is nothing to do for them here.
  // Every OTHER GameState field rides through untouched on the outer `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it
  // is still editable (the frozen-once-shipped rule applies only to production-released migrations).
  21: (state: any): any => ({
    ...state,
    researchedBlueprints: state.researchedBlueprints ?? [],
    facilities: {
      ...state.facilities,
      research: state.facilities?.research ?? { level: 1 },
    },
  }),
  // v22 -> v23: Fabricator (docs/plans/2026-07-16-fabricator-plan.md Task F6 / design). Two additive
  // seeds for the new state the Fabricator feature introduced (Tasks F1/F2), mirroring the minimal
  // single-purpose shape MIGRATIONS[18]/[19]/[20]/[21] set the template for:
  //
  // - `facilities.fabricator` at level 1 (Task F1), ⚠️ LOAD-BEARING, level 1 NOT 0, the same
  //   reasoning research carries in MIGRATIONS[21] (and missionControl in MIGRATIONS[20]). Level 0 is
  //   "not built"; seeding at level 1 makes the Fabricator ESTABLISHED from game start, so tier-1
  //   blueprints are fabricable immediately on a returning player's save (canFabricate gates
  //   blueprint.tier > fabricator level -> tierLocked). A level-0 seed would silently LOCK all tier-1
  //   fabrication on every existing save, a soft-lock/regression. Same `{ level: 1 }` literal
  //   freshState seeds, so migrated and fresh shapes cannot drift apart (Omega 4).
  // - `fabricateOrder` (the standing fabricate order, Task F2): seeded null if absent, the same
  //   fresh idle value freshState gives, and the exact `?? null` nullable-field idiom MIGRATIONS[19]
  //   used to seed `refineOrder`. FabricateOrder carries NO Decimal (blueprintKey string, mode.remaining
  //   a plain number, pausedReason a string literal), so hydrateDecimals needs NO change: it rides
  //   through its own `...state` spread there with no per-field revival, exactly as `refineOrder` does.
  //
  // `?? { level: 1 }` / `?? null` are idempotent + belt-and-suspenders: a genuine v22 save has neither
  // key (so both are seeded), but a chained/hand-edited save that already carries a fabricator level or
  // an active fabricateOrder keeps it exactly (never reset, never wiped). `state.facilities?.` guards
  // the wholesale-absent facilities case defensively, not reachable on a real v22 save (MIGRATIONS[17]
  // always seeds facilities), same defense-in-depth posture as this file's other ?? guards. F2's
  // fabricateJob timed processes ride `activeProcesses`, which is ALREADY migrated + hydrated (its
  // addItem effect's Decimal `amount` is revived by hydrateDecimals), so there is nothing to do for them
  // here. Every OTHER GameState field rides through untouched on the outer `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it is
  // still editable (the frozen-once-shipped rule applies only to production-released migrations).
  22: (state: any): any => ({
    ...state,
    fabricateOrder: state.fabricateOrder ?? null,
    facilities: {
      ...state.facilities,
      fabricator: state.facilities?.fabricator ?? { level: 1 },
    },
  }),
  // v23 -> v24: Crafting Allocation Redesign (docs/plans/2026-07-16-crafting-allocation-redesign-
  // plan.md Task C6 / design). The single-order refine/fabricate model (refineOrder/fabricateOrder,
  // each RefineOrder|FabricateOrder|null) is RETIRED and replaced by independent per-slot production
  // LINES: GameState now carries `refineLines`/`fabricateLines` (CraftLine[]) plus `nextCraftLineId`
  // (the monotonic id source, mirroring nextShipId/nextProcessId). This step seeds those three new
  // fields onto an existing v23 save AND, unlike every prior additive migration in this file --
  // it also DROPS two now-removed keys.
  //
  // - refineLines / fabricateLines seeded `[]` if absent (a returning player starts with no
  //   configured lines, exactly the empty seed freshState gives; the first line is minted by
  //   startLine when they configure a slot). CraftLine carries NO Decimal (id/kind/recipeKey are
  //   strings, remaining a plain number, mode a plain object), so hydrateDecimals needs NO change:
  //   both arrays ride through their own `...rest` spread there with no per-element revival, exactly
  //   as the Decimal-free `discovered` string[] already does. Any in-flight refine/fabricate timed
  //   job rides `activeProcesses` (already migrated + hydrated, its addItem effect's Decimal
  //   `amount` is revived there), so there is nothing to do for those here.
  // - nextCraftLineId seeded `1` if absent, byte-identical to freshState's seed, so the migrated
  //   and fresh shapes cannot drift apart (Omega 4). `1` makes the first minted id "craft-1".
  // - refineOrder / fabricateOrder are DROPPED. They are pulled out of the object via a rest-
  //   destructure (`_ro`/`_fo` are the intentionally-unused captures) so the returned shape carries
  //   NEITHER key, even a v23 save that still holds a legacy standing order (shipped MIGRATIONS[19]
  //   seeds refineOrder, MIGRATIONS[22] seeds fabricateOrder) comes out CLEAN, with only the new
  //   line fields. Those legacy orders have no home in the line model (the line engine never reads
  //   them), so leaving them behind would be dead, misleading state riding along in every save.
  //
  // `?? []` / `?? 1` are idempotent + belt-and-suspenders: a genuine v23 save has none of the three
  // line fields (so all are seeded), but a chained/hand-edited save that already carries configured
  // lines or a bumped id keeps them exactly (never reset). Every OTHER GameState field rides through
  // untouched on the `...rest` spread. Additive-plus-drop, defensive, idempotent, re-running it on
  // an already-v24-shaped state (no order keys, lines present) is a no-op beyond re-confirming the
  // seeds.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it is
  // still editable (the frozen-once-shipped rule applies only to production-released migrations).
  23: (state: any): any => {
    // Rest-destructure drops the two retired single-order keys; `_ro`/`_fo` are unused captures.
    const { refineOrder: _ro, fabricateOrder: _fo, ...rest } = state;
    return {
      ...rest,
      refineLines: rest.refineLines ?? [],
      fabricateLines: rest.fabricateLines ?? [],
      nextCraftLineId: rest.nextCraftLineId ?? 1,
    };
  },
  // v24 -> v25: Shipyard (Phase 5, Task S6, docs/plans/2026-07-16-shipyard-plan.md). One additive
  // seed for the new state the Shipyard feature introduced (Task S1), mirroring the minimal single-
  // purpose facility-seed shape MIGRATIONS[18]/[20]/[21]/[22] set the template for:
  //
  // - `facilities.shipyard` at level 0 (Task S1), ⚠️ LOAD-BEARING CONTRAST: level 0 NOT 1, the
  //   OPPOSITE of the level-1 seeds research (MIGRATIONS[21]) and fabricator (MIGRATIONS[22]) carry.
  //   The Shipyard starts LOCKED / UNFOUNDED: level 0 is "not built", and the founding rung (its
  //   level 0 -> 1 upgrade, gated on credits + Fleet Admiral level) is a REAL buildable unlock the
  //   player establishes, NOT pre-granted like the research/fabricator facilities, which are
  //   established from game start so their tier-1 work is available immediately. Building a hull is
  //   gated on shipyard level >= 1 (S3's canBuildShip -> notFounded), so seeding level 0 here is
  //   CORRECT (it does not soft-lock anything the way a level-0 research/fabricator seed would have):
  //   a returning player founds the Shipyard exactly as a brand-new one does. Same `{ level: 0 }`
  //   literal freshState seeds, so the migrated and fresh shapes cannot drift apart (Omega 4).
  //
  // `?? { level: 0 }` is idempotent + belt-and-suspenders: a genuine v24 save has NO shipyard key
  // (so it is seeded), but a chained/hand-edited save that already carries a shipyard level keeps it
  // exactly (never reset). `state.facilities?.` guards the wholesale-absent facilities case
  // defensively, not reachable on a real v24 save (MIGRATIONS[17] always seeds facilities), same
  // defense-in-depth posture as this file's other ?? guards. shipyard facility state is
  // `{ level: number }`, NO Decimal, so hydrateDecimals needs NO change: shipyard rides through
  // its own `...state` spread there with no per-key revival, exactly as refinery/warehouse/
  // fuelStorage/missionControl/research/fabricator have since v18/v21/v23. S3's shipBuild timed
  // jobs ride `activeProcesses`, which is ALREADY migrated + hydrated (its addShip effect carries NO
  // `amount`, so hydrateDecimals leaves it untouched, a ShipInstance is Decimal-free), so there is
  // nothing to do for them here. Every OTHER GameState field rides through untouched on the outer
  // `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it is
  // still editable (the frozen-once-shipped rule applies only to production-released migrations).
  24: (state: any): any => ({
    ...state,
    facilities: {
      ...state.facilities,
      shipyard: state.facilities?.shipyard ?? { level: 0 },
    },
  }),
  // v25 -> v26: Quality-bucketed inventory (Equipment 0.11.0, Phase 4, Task 9a,
  // docs/plans/2026-07-17-equipment-0.11.0-plan.md). The fleet-wide `inventory`
  // changed SHAPE from `Record<string, Decimal>` (one balance per item) to
  // `Record<string, Decimal[]>` (a per-item array of quality-tier buckets, index =
  // quality tier 0..5; an item's total is the sum of its buckets). This step converts
  // an old scalar inventory into the bucketed shape by dropping EACH existing count
  // into that item's QUALITY-0 bucket (`[count]`), so a returning player's totals are
  // byte-identical after migration (a single q0 bucket holding exactly what the scalar
  // held). This is a PURE shape refactor: nothing rolls a quality above 0 yet.
  //
  // Per-value handling:
  // - A scalar value (the real v25 shape: a Decimal, or a plain number/string on a raw
  //   pre-hydration save) is wrapped into a single-element array via toDecimal, so
  //   `commonOre: "750"` becomes `commonOre: [Decimal(750)]`. The unconditional
  //   hydrateDecimals() at the end of migrate() (hydrateInventoryBuckets) re-confirms
  //   each bucket is a live Decimal afterward, idempotent.
  // - An ALREADY-array value (a chained / hand-edited / re-run save that is already in
  //   bucketed shape) is passed through UNTOUCHED (never re-wrapped into `[[...]]`), so
  //   re-running this step on a v26-shaped inventory is a no-op beyond the copy. This is
  //   the same idempotent, belt-and-suspenders posture every other migration here takes.
  //
  // `state.inventory ?? {}` guards the wholesale-absent case defensively (not reachable
  // on a real v25 save, MIGRATIONS[17] always builds inventory and freshState seeds it),
  // same defense-in-depth posture as this file's other ?? guards. Every OTHER GameState
  // field rides through untouched on the outer `...state` spread. Timed refine/fabricate
  // jobs ride `activeProcesses` (already migrated + hydrated), whose addItem effect
  // carries a SCALAR Decimal `amount` (a single deposit quantity, NOT a bucket array),
  // so that effect is unchanged by this shape migration and needs no touch here.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to
  // production, so it is still editable (the frozen-once-shipped rule applies only to
  // production-released migrations).
  25: (state: any): any => {
    const oldInventory = state.inventory ?? {};
    const inventory: Record<string, any> = {};
    for (const key of Object.keys(oldInventory)) {
      const value = oldInventory[key];
      // Already bucketed (array) -> pass through; scalar -> wrap into a q0 bucket.
      inventory[key] = Array.isArray(value) ? value : [toDecimal(value)];
    }
    return { ...state, inventory };
  },
  // v26 -> v27: Equipment 0.11.0 GameState fields (docs/plans/2026-07-17-equipment-
  // 0.11.0-plan.md, Task 3 state; CRASH HOTFIX). Task 3 added four fields to freshState:
  // `equipment` (the fleet-wide EquipmentInstance pool, fitted + spare), `nextEquipmentId`
  // (the monotonic id source, mirrors nextShipId/nextProcessId/nextCraftLineId),
  // `craftingLevel` (the 1-based crafting skill track, parallels fleetAdminLevel) and
  // `craftingXp` (its Decimal accumulator). BUT the migration that backfills them onto an
  // existing save was DEFERRED to a later task (Task 20). MIGRATIONS[25] (v25->v26) bumped
  // SAVE_VERSION to 26 for the quality-bucketed-inventory shape refactor ONLY, with NO
  // equipment-field backfill, so a save migrated to v26 has `equipment === undefined`. The
  // dev-only Equipment panel (App.svelte) reads `state.equipment.filter(...)` UNGUARDED and
  // crashed on first render (Cannot read properties of undefined (reading 'filter')). This
  // step seeds the four fields idempotently onto a v26 save that predates them, the same
  // minimal additive-seed shape MIGRATIONS[19]/[20]/[21]/[22]/[24] set the template for.
  //
  // - equipment `?? []`: an empty pool (a returning player owns no equipment yet), the same
  //   seed freshState gives. An EquipmentInstance carries NO top-level Decimal, so it rides
  //   hydrateDecimals's `...state` spread untouched (equipment is not a Decimal field).
  // - nextEquipmentId `?? 1`: byte-identical to freshState's seed (first minted id "equip-1").
  // - craftingLevel `?? 1`: 1-based, matches freshState / the fleetAdminLevel baseline.
  // - craftingXp: converted to a real Decimal here. A pre-Task-3 save has NO craftingXp key
  //   (seed a fresh Decimal(0)); a chained / hand-edited save that already carries one (a live
  //   Decimal, or a plain number/string) is CONVERTED rather than reset, so accumulated
  //   progress survives. hydrateDecimals ALSO revives craftingXp unconditionally at the end of
  //   migrate() (a re-saved v27 blob serializes it to a string), so this is belt-and-
  //   suspenders and idempotent either way.
  //
  // All four `??` guards are idempotent + defensive: a genuine v26 save has none of the fields
  // (so all are seeded), but a chained/re-run save that already carries them keeps them exactly
  // (never reset). Every OTHER GameState field rides through untouched on the outer `...state`
  // spread. This migration does the ONE job of seeding these four fields; the rest of Task 20
  // (Standard-Issue seeding, etc.) is out of scope for this hotfix.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so
  // it is still editable (the frozen-once-shipped rule applies only to production-released
  // migrations).
  26: (state: any): any => ({
    ...state,
    equipment: state.equipment ?? [],
    nextEquipmentId: state.nextEquipmentId ?? 1,
    craftingLevel: state.craftingLevel ?? 1,
    craftingXp: state.craftingXp instanceof Decimal ? state.craftingXp : new Decimal(state.craftingXp ?? 0),
  }),
  // v27 -> v28: Standard-Issue baseline SEED (Equipment 0.11.0, Task 20, docs/plans/
  // 2026-07-17-equipment-0.11.0-plan.md Phase 9). MIGRATIONS[26] (the v26->v27 crash
  // hotfix) backfilled the four equipment GameState FIELDS but left the pool EMPTY. This
  // step fits every EXISTING ship out with its Standard-Issue baseline: a craft-less,
  // quality-0, Standard-rarity piece per LIVE slot (cargoBay/ftlDrive/reactorCore/
  // specUtility), all fitted to that ship, so a migrated ship's live slots are never
  // empty and it stays dispatchable, exactly as the ships-foundation migration
  // (MIGRATIONS[15]) grandfathered a Freighter onto every captain.
  //
  // - Uses the SHARED seedStandardIssueForShip helper (model.ts), the SAME one freshState
  //   and the tick.ts new-ship / new-captain paths call, so a migrated save and a fresh
  //   game (and a newly-built ship) land on the byte-identical fully-fitted shape and can
  //   never drift apart (Omega 4, DRY). Ids are allocated from nextEquipmentId and the
  //   counter is threaded forward across ships, so every minted id is unique and monotonic.
  // - IDEMPOTENT per-ship: a ship that ALREADY has any fitted piece is SKIPPED (never
  //   double-seeded). A genuine v27 save has an EMPTY pool (MIGRATIONS[26] seeded []), so
  //   every ship is seeded; the skip only guards a re-run / chained / hand-edited save
  //   that somehow already carries fitted gear, the same belt-and-suspenders posture this
  //   file's other ?? guards take.
  // - Standard-Issue is STAT-NEUTRAL this patch (model.ts STANDARD_ISSUE_IMPLICIT_MAGNITUDE
  //   0, mass/powerDraw 0), so folding it into shipDerivedStats is bit-identical to the bare
  //   hull: an in-flight mission resolves IDENTICALLY pre/post migration (no economy shift),
  //   the never-empty invariant is established WITHOUT a balance change.
  // - equipment / nextEquipmentId are read with defensive `?? []` / `?? 1`: MIGRATIONS[26]
  //   guarantees both on any v27 save, but the guard keeps a partially-migrated / hand-edited
  //   shape from crashing (same posture as the rest of this file). An EquipmentInstance carries
  //   no top-level Decimal, so it rides hydrateDecimals's `...state` spread untouched; the
  //   craftingXp revive rule (added in the v26->v27 hotfix) is unchanged. Every OTHER field
  //   rides through untouched on the outer `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so
  // it is still editable (the frozen-once-shipped rule applies only to production-released migrations).
  27: (state: any): any => {
    const ships = state.ships ?? [];
    let equipment = [...(state.equipment ?? [])];
    let nextEquipmentId = state.nextEquipmentId ?? 1;
    for (const ship of ships) {
      // Skip a ship that already carries fitted gear (idempotent re-run guard); a genuine
      // v27 save's pool is empty, so this fits out every ship exactly once.
      const alreadyFitted = equipment.some((e: any) => e.fittedToShipId === ship.id);
      if (alreadyFitted) continue;
      const seeded = seedStandardIssueForShip(ship.id, nextEquipmentId);
      equipment = [...equipment, ...seeded.pieces];
      nextEquipmentId = seeded.nextId;
    }
    return { ...state, equipment, nextEquipmentId };
  },
  // v28 -> v29: Item-catalog reconciliation (0.11.0 Storage/Salvage, Tasks A1/A2/A3).
  // Three prior tasks changed the item catalog; this step reconciles an old save's
  // quality-bucketed inventory (Record<string, Decimal[]>, index = quality tier 0..N) so
  // it no longer holds retired keys:
  //
  //   - A1 (MERGE): the duplicate `refinedMaterial` item was folded into `titaniumIngot`
  //     (the sole refined-titanium item). An old save's orphan `refinedMaterial` buckets
  //     are added into titaniumIngot ELEMENT-WISE by quality tier, then the
  //     `refinedMaterial` key is DELETED. The two arrays are merged lazily to the LONGER
  //     length (a tier one side lacks contributes 0), so a titaniumIngot of [10,3,1] and a
  //     refinedMaterial of [20,5] merge to [30,8,1] with no truncation either way. When
  //     titaniumIngot was absent entirely, it is CREATED straight from the merged buckets.
  //   - A2 (DROP): the dead `components` item was removed from the catalog. Its bucket key
  //     is DELETED and the quantity is DISCARDED, `components` was never craftable into
  //     anything, so there is no target item to convert it to.
  //   - A3 (NO-OP): `intactReactorCore` was reclassified to a `salvagedMaterial`, but its id
  //     is UNCHANGED and the category/label change is display-only, so there is NOTHING to
  //     migrate, existing stacks ride through untouched on the `...state` spread and will
  //     render under the Salvaged Materials tab once that UI lands.
  //
  // DECIMAL-SAFETY: this step runs BEFORE the unconditional hydrateInventoryBuckets() at the
  // end of migrate(), so a genuine (serialized) v28 save's bucket elements are still plain
  // JSON strings here, not live Decimals. We therefore toDecimal() each element on BOTH
  // sides of the merge (the inventory addItemQuality helper assumes already-live Decimal
  // buckets, which do not exist yet at this point in the chain, which is why the merge is
  // done manually rather than through that helper). toDecimal() no-ops on an already-live
  // Decimal, so a chained / re-run save merges just as safely. The merged buckets are real
  // Decimals; hydrateInventoryBuckets() re-confirms them afterward (idempotent), so
  // hydrateDecimals needs NO change for this migration.
  //
  // Every OTHER GameState field (including `discovered`, which may still list a retired key
  // harmlessly, nothing renders it once the item is gone) rides through untouched on the
  // outer `...state` spread. Idempotent: re-running on an already-reconciled v29-shaped
  // inventory (no refinedMaterial / components keys) is a no-op beyond the inventory copy.
  //
  // B1 (equipment storage cap, DONE): this SAME v28->v29 body ALSO seeds the new GameState
  // field `equipmentStorageLevel` to 0 on an old save (see the return below). Note it seeds the
  // stored LEVEL, not a stored cap value: equipmentStorageCap (model.ts) DERIVES the cap from the
  // level times the reached-rung mults, so nothing here stores a cap that could drift. B1 folded
  // its seed into this step rather than bumping the version again (the version was already at 29).
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production,
  // so it is still editable (the frozen-once-shipped rule applies only to production-released
  // migrations).
  28: (state: any): any => {
    // Shallow-clone the inventory so the deletes/writes below never mutate the input map.
    const inventory: Record<string, any> = { ...(state.inventory ?? {}) };

    // A1: fold refinedMaterial buckets element-wise into titaniumIngot, then drop the key.
    const refined = inventory.refinedMaterial;
    if (Array.isArray(refined)) {
      const target = Array.isArray(inventory.titaniumIngot) ? inventory.titaniumIngot : [];
      const tiers = Math.max(target.length, refined.length); // lazy-grow to the LONGER array
      const merged: Decimal[] = [];
      for (let quality = 0; quality < tiers; quality++) {
        // A tier one side lacks contributes 0; toDecimal() handles the pre-hydration
        // string buckets AND any already-live Decimal (no number coercion, no NaN).
        const existing = quality < target.length ? toDecimal(target[quality]) : new Decimal(0);
        const addition = quality < refined.length ? toDecimal(refined[quality]) : new Decimal(0);
        merged.push(existing.plus(addition));
      }
      inventory.titaniumIngot = merged;
      delete inventory.refinedMaterial;
    }

    // A2: drop the removed `components` item; its quantity is discarded (never craftable).
    delete inventory.components;

    // A3: intactReactorCore is intentionally NOT touched (id unchanged; display-only).
    //
    // B1 (equipment storage cap): seed the new `equipmentStorageLevel` GameState field to 0
    // (base cap, no upgrade rung purchased). `?? 0` keeps a chained / re-run save's existing
    // level intact (idempotent), while a genuine v28 save (no such field) gets 0. Seeding the
    // stored LEVEL, not a cap value, keeps the cap COMPUTED (equipmentStorageCap derives it).
    return { ...state, inventory, equipmentStorageLevel: state.equipmentStorageLevel ?? 0 };
  },
  // v29 -> v30: equipment iLevel BACKFILL (0.11.0 Phase D UI). EquipmentInstance gained a stored
  // `iLevel` field (model.ts) so the Ship Systems tiles / tooltip can show item power ("iL N")
  // without recomputing it. Existing pieces were minted BEFORE the field existed, so their iLevel
  // is absent; this step stamps a coherent value on every piece that lacks one.
  //
  // BACKFILL VALUES (documented choice):
  //   - Baseline (blueprintKey === null): the authoritative STANDARD_ISSUE_ILEVEL floor (model.ts).
  //     This is the EXACT value generateStandardIssue stamps on a fresh baseline, so a migrated
  //     baseline and a freshly seeded one land on the identical iLevel (no drift), the same
  //     single-source posture MIGRATIONS[27] took for the Standard-Issue seed itself.
  //   - Crafted (blueprintKey set): a piece's TRUE mint iLevel was computed at generation
  //     (computeItemLevel) then DISCARDED before this feature, so it is UNRECOVERABLE from the
  //     stored shape. Rather than fabricate a fake power number, we stamp the same modest floor
  //     (STANDARD_ISSUE_ILEVEL). This is honest: the feature is NOT in production (dev-preview test
  //     items only), so a clean floor is acceptable, and any piece the player cares about can be
  //     re-fabricated to mint a real, stored iLevel. Pieces minted AFTER the feature already carry
  //     their true iLevel and are left untouched (the `?? floor` guard below), so this never
  //     clobbers a real value, it only fills a genuinely missing one (idempotent).
  //
  // An EquipmentInstance carries no top-level Decimal (iLevel is a PLAIN number), so it rides
  // hydrateDecimals's `...state` spread untouched, hydrateDecimals needs NO change. Every OTHER
  // field rides through on the outer `...state` spread. `?? []` guards a hand-edited/partial save.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it
  // is still editable (the frozen-once-shipped rule applies only to production-released migrations).
  29: (state: any): any => {
    const equipment = (state.equipment ?? []).map((piece: any) => {
      // Already has a stored iLevel (minted after the feature): leave it exactly as-is.
      if (typeof piece.iLevel === "number") return piece;
      // Baseline vs crafted both backfill to the STANDARD_ISSUE_ILEVEL floor (see the note above):
      // the baseline floor is authoritative; the crafted floor is an honest, documented default for
      // an unrecoverable value.
      return { ...piece, iLevel: STANDARD_ISSUE_ILEVEL };
    });
    return { ...state, equipment };
  },

  // v30 -> v31: nextCaptainId BACKFILL (Combat 0.13.0, Task 1.3). GameState gained a monotonic
  // captain-id counter (model.ts) so a future captain removal (captain death) can never let a
  // slot-unlock reissue a freed id and collide. Old saves carry `captains` but NO nextCaptainId,
  // so this stamps a coherent starting value: strictly greater than every id currently in use.
  //
  // BACKFILL VALUE (documented choice): max(existing captain ids) + 1, exactly the invariant the
  // counter must always satisfy (every future id > every id ever issued). Using max(ids)+1 rather
  // than captains.length+1 is deliberate and load-bearing: a roster with a GAP (ids [1, 3], id 2
  // freed by a future removal) has length 2, so length+1 would be 3, a COLLISION with the live
  // id-3 captain. max(ids)+1 is 4, which clears every surviving id. Math.max(0, ...ids) floors an
  // EMPTY roster at 0 (-> counter 1); an empty roster should never occur (one starter captain is an
  // invariant), but the floor keeps a hand-edited/partial save from producing max()=-Infinity.
  //
  // nextCaptainId is a PLAIN number (no Decimal), so it rides hydrateDecimals's `...state` spread
  // untouched, hydrateDecimals needs NO change. `?? []` guards a hand-edited/partial save.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production, so it
  // is still editable (the frozen-once-shipped rule applies only to production-released migrations).
  30: (state: any): any => {
    const captainIds = (Array.isArray(state.captains) ? state.captains : []).map((captain: any) => captain.id);
    // reduce, NOT Math.max(0, ...captainIds): a hostile save with a huge captains array would
    // exceed the argument-spread limit on the spread form (RangeError). reduce is O(n), needs
    // no spread, and is byte-identical to the old floor-at-0 behavior on any real roster.
    const nextCaptainId = captainIds.reduce((m: number, x: number) => Math.max(m, x), 0) + 1;
    return { ...state, nextCaptainId };
  },
  // v31 -> v32: mission-KIND discriminant + patrol master-seed counter (Combat 0.13.0,
  // Phase 9b.5a). CaptainState.mission became a DISCRIMINATED UNION (extraction | patrol)
  // keyed on a required `kind` tag, and GameState gained `nextPatrolSeed` (the monotonic
  // patrol master-seed source). This step backfills both onto an existing v31 save:
  //
  // (a) DISCRIMINANT BACKFILL: every captain whose `mission` is a non-null EXTRACTION
  //     mission lacking `kind` gets `kind: "extraction"` stamped (its extraction fields
  //     already prove which arm it is). A null mission stays null (idle captain). A PATROL
  //     mission CANNOT exist in a v31 save (patrols did not exist pre-v32), so there is no
  //     patrol case to handle here. `?? "extraction"` is idempotent + belt-and-suspenders:
  //     a genuine v31 mission has no `kind` (so it is stamped), but a chained/hand-edited
  //     save that already carries one keeps it exactly (never clobbered). An in-flight
  //     extraction mission keeps EVERY other field (missionKey/phase/progress/cargo/recalled/
  //     refuelDelayTicks) via the spread, so it resumes running byte-identically; the sole
  //     change is the added tag. The Decimal cargo is revived by hydrateDecimals AFTER this
  //     runs (its extraction branch), unchanged by this step.
  // (b) nextPatrolSeed BACKFILL: seeded 1 if absent (the same value freshState seeds), via
  //     `?? 1` so a chained/re-run save keeps an existing counter. A PLAIN number (no
  //     Decimal), so it rides hydrateDecimals's `...state` spread untouched.
  //
  // Every OTHER GameState field rides through untouched on the outer `...state` spread.
  // NOTE: this migration is on the CURRENT feature branch and NOT yet shipped to production,
  // so it is still editable (the frozen-once-shipped rule applies only to production-released
  // migrations).
  31: (state: any): any => ({
    ...state,
    captains: (state.captains ?? []).map((c: any) =>
      c.mission ? { ...c, mission: { ...c.mission, kind: c.mission.kind ?? "extraction" } } : c
    ),
    nextPatrolSeed: state.nextPatrolSeed ?? 1,
  }),
  // v32 -> v33: PER-SYSTEM DURABILITY carry-state on in-flight patrols (Combat 0.13.0, Phase
  // 12b Unit B2). PatrolMissionState gained `playerSystemDurability` so weapon/reactor/ftl wear
  // now ACCUMULATES across a cycle's waves (Unit B1 wore systems but rebuilt them full each
  // wave). An existing v32 save's in-flight patrol predates the field, so this backfills it to
  // FULL (no wear = the safe default): the patrol simply resumes with pristine systems, exactly
  // as a freshly dispatched one starts.
  //
  // WHY IT MIRRORS the v31->v32 discriminant step: only a non-null PATROL mission lacking the
  // field is touched (a null/idle mission and an extraction mission pass through untouched; a
  // patrol that already carries it is preserved via the `=== undefined` guard, so a chained /
  // re-run migration is idempotent). Unlike v31->v32, a PATROL mission CAN exist in a v32 save
  // (patrols shipped at v32), which is exactly why this step is needed where v31->v32 had no
  // patrol case.
  //
  // FULL is computed from the captain's ASSIGNED combat hull via defaultSystemDurabilityForHull
  // (the SAME source freshPatrolMission seeds from), so a backfilled patrol's ceilings match a
  // freshly dispatched one's. A genuine v32 patrol ALWAYS has a resolvable combat hull (dispatch
  // required one and assignment is locked mid-mission); the ship/hull guards cover only a
  // corrupt/hand-edited save, where the field is left ABSENT and the build path treats absent as
  // full (buildPatrolPlayerCombatant), so such a save still loads + plays. NOTE: on the current
  // feature branch, NOT yet shipped to production, so still editable (the frozen-once-shipped
  // rule applies only to production-released migrations).
  32: (state: any): any => {
    const ships = state.ships ?? [];
    return {
      ...state,
      captains: (state.captains ?? []).map((c: any) => {
        const m = c.mission;
        // Untouched: null/idle mission, an extraction mission, or a patrol already carrying it.
        if (!m || m.kind !== "patrol" || m.playerSystemDurability !== undefined) return c;
        // Resolve the assigned combat hull to compute its FULL durability. Corrupt/unresolvable
        // (no ship or a non-combat hull) -> leave the field absent (=> full at build time).
        const ship = ships.find((s: any) => s.assignedCaptainId === c.id);
        const hullType = ship ? combatHullTypeOf(ship.typeKey) : null;
        if (!ship || !hullType) return c;
        const full = defaultSystemDurabilityForHull(
          hullType,
          SHIP_TYPES[ship.typeKey as keyof typeof SHIP_TYPES],
        );
        return { ...c, mission: { ...m, playerSystemDurability: full } };
      }),
    };
  },
  // v33 -> v34: Standard-Issue COMBAT baseline SEED (Combat 1.0, Unit 1.3, docs/plans/
  // 2026-07-31-combat-1.0-integration-plan.md). Units 1.1/1.2 added the combat gear slots +
  // craftable weapons, but no ship carried any combat gear yet. This step fits every EXISTING
  // COMBAT hull (destroyer/battleship/carrier) out with its free Standard-Issue combat set (one
  // weapon + one shield emitter + one hull plating), so a migrated combat hull clears the new
  // empty-required-slot dispatch blocker (canDispatchPatrol) and stays dispatchable. Economy hulls
  // are untouched (they cannot patrol and have no combat slots).
  //
  // - Delegates to the SHARED installMissingCombatBaselines (tick.ts), the SAME fold a fresh ship
  //   build applies, so a migrated and a freshly-built combat hull land on the byte-identical
  //   fully-installed shape and can never drift (Omega 4, DRY). Ids are allocated from
  //   nextEquipmentId and threaded forward across ships, so every minted id is unique + monotonic,
  //   exactly as the v27->v28 economy Standard-Issue seed does.
  // - IDEMPOTENT per ship: a combat hull already carrying its three required combat slots is
  //   SKIPPED (never double-seeded). A genuine v33 save has NO combat gear, so every combat hull is
  //   seeded once; the skip guards a re-run / chained / hand-edited save (same belt-and-suspenders
  //   posture as MIGRATIONS[27]).
  // - ECONOMY-NEUTRAL: the combat baseline is mass 0 / powerDraw 0 with combat-only stat lines, so
  //   folding it into shipDerivedStats is bit-identical to the bare hull (an in-flight extraction
  //   mission resolves IDENTICALLY pre/post migration; the offline==live parity fuzz stays green).
  //   An EquipmentInstance carries no top-level Decimal, so the minted pieces ride hydrateDecimals's
  //   `...state` spread untouched. `?? []` / `?? 1` guard a partial/hand-edited save (a genuine v33
  //   save always has both, guaranteed by MIGRATIONS[26]/[27]).
  // NOTE: on the current feature branch, NOT yet shipped to production, so still editable (the
  // frozen-once-shipped rule applies only to production-released migrations).
  33: (state: any): any =>
    installMissingCombatBaselines({
      ...state,
      ships: state.ships ?? [],
      equipment: state.equipment ?? [],
      nextEquipmentId: state.nextEquipmentId ?? 1,
    }),
  // v34 -> v35: Standard-Issue DRONE-POD baseline SEED (Combat 1.0, Unit 2.3a, docs/plans/
  // 2026-07-31-combat-1.0-integration-plan.md Phase 2). Unit 2.3a made the combat sim read a ship's
  // INSTALLED drone pods as its squadrons; a v34 carrier carries its weapon/shield/plating baseline
  // (from MIGRATIONS[33]) but NO drone pod yet, so without this step a migrated carrier would fold to
  // ZERO drones (a regression from its default attack squadron). This step APPENDS the free
  // Standard-Issue attack drone pod to every EXISTING carrier missing one (droneBays > 0), so a
  // migrated carrier fields the SAME one attack squadron it did before (behaviour-preserving).
  // Destroyers/battleships (no bays) and economy hulls are untouched.
  //
  // - Delegates to the SAME SHARED installMissingCombatBaselines (tick.ts) a fresh build uses, which
  //   is now Unit-2.3a-aware: it SKIPS the weapon/shield/plating a v34 carrier already carries and
  //   mints ONLY the missing drone pod, threading nextEquipmentId forward (unique + monotonic ids;
  //   the existing pieces keep theirs). Omega 4 (DRY): migrated and freshly-built carriers converge.
  // - IDEMPOTENT per ship: a carrier already carrying its attack pod is SKIPPED (the per-bay count
  //   check), so a re-run / chained / hand-edited save never double-seeds. Same belt-and-suspenders
  //   posture as MIGRATIONS[27]/[33].
  // - ECONOMY-NEUTRAL: the drone-pod baseline is mass 0 / powerDraw 0 (like every combat baseline),
  //   so shipDerivedStats is bit-identical to before and the offline==live parity fuzz stays green.
  //   An EquipmentInstance carries no top-level Decimal, so the minted pod rides hydrateDecimals's
  //   `...state` spread untouched. NOTE: on the current feature branch, NOT yet shipped to
  //   production, so still editable (the frozen-once-shipped rule applies only to prod migrations).
  34: (state: any): any =>
    installMissingCombatBaselines({
      ...state,
      ships: state.ships ?? [],
      equipment: state.equipment ?? [],
      nextEquipmentId: state.nextEquipmentId ?? 1,
    }),
  // v35 -> v36: EVERY-HULL combat baseline SEED ("every hull is combat-capable", user
  // decision). Units 1.x/2.3 seeded the combat baseline for COMBAT hulls only; economy
  // hulls (generalFreighter/prospectorHauler/prospectorRunner/prospectorMiner) were left
  // combat-bare because they could not patrol. That gate is now lifted: every hull ships a
  // WEAK Standard-Issue combat set and is dispatchable. This step fits every EXISTING economy
  // hull out with its weak combat set (its default weapon loadout + shield emitter + hull
  // plating; economy hulls get NO drone pod, builtInBays 0), so an old economy ship becomes
  // dispatchable on load and clears the empty-required-slot dispatch blocker (canDispatchPatrol).
  //
  // - Delegates to the SAME SHARED installMissingCombatBaselines (tick.ts) MIGRATIONS[33]/[34]
  //   and a fresh build use. It is now every-hull-aware (combatHullTypeOf resolves ALL hulls),
  //   so it seeds the economy hulls it previously skipped while re-running the combat hulls as a
  //   pure no-op (they already carry their full set: the per-slot idempotence guard skips them).
  //   Omega 4 (DRY): a migrated and a freshly-built economy hull converge on the byte-identical
  //   weak combat set (both go through generateCombatStandardIssue in the same order + ids).
  // - ADDITIVE + IDEMPOTENT: existing combat hulls and any already-seeded economy hull are
  //   untouched (only ABSENT required slots are minted); a re-run / chained / hand-edited save
  //   never double-seeds. Same belt-and-suspenders posture as MIGRATIONS[27]/[33]/[34].
  // - ECONOMY-NEUTRAL: every combat baseline is mass 0 / powerDraw 0 with combat-only stat
  //   lines, so folding it into shipDerivedStats is bit-identical to the bare economy hull (an
  //   in-flight extraction mission resolves IDENTICALLY pre/post migration; the offline==live
  //   parity fuzz stays green). An EquipmentInstance carries no top-level Decimal, so the minted
  //   pieces ride hydrateDecimals's `...state` spread untouched. `?? []` / `?? 1` guard a
  //   partial/hand-edited save. NOTE: on the current feature branch, NOT yet shipped to
  //   production, so still editable (the frozen-once-shipped rule applies only to prod migrations).
  35: (state: any): any =>
    installMissingCombatBaselines({
      ...state,
      ships: state.ships ?? [],
      equipment: state.equipment ?? [],
      nextEquipmentId: state.nextEquipmentId ?? 1,
    }),
  // v36 -> v37: NEUTERED to a pure pass-through 2026-08-26 (before ever reaching production, so it
  // is still editable, the frozen-once-shipped rule applies only to prod-released migrations).
  //
  // HISTORY + WHY IT WAS NEUTERED: this step originally DELETED "orphaned economy baseline spares" on
  // load, identifying them by `fittedToShipId === null && blueprintKey === null && economy slotType`.
  // Two problems, both serious:
  //   1) DATA LOSS by heuristic. `blueprintKey === null` is NOT a safe test for "worthless baseline":
  //      dev-granted gear (devGrantEquipment) is ALSO minted blueprintKey null while being a RADIANT
  //      iL-400 item the player expects to keep. This step silently DELETED those on load (the
  //      reported "my items disappeared"). Silently deleting a player's items on load is never
  //      acceptable (Omega 6 posture). See isStandardIssueBaseline (model.ts) for the strict predicate
  //      the surviving destructive paths now use, and the 0.14.0 item-`origin` plan for the real fix.
  //   2) OBSOLETE PREMISE. Economy slots are now ALLOW-EMPTY: an economy baseline spare is a LEGITIMATE
  //      re-installable item (uninstall pools it, the install picker re-offers it), not an orphan to
  //      purge. The clutter it was chasing is now handled the safe, opt-in way (Salvage Bay destroy +
  //      the 0.13.1 auto-salvage rules), never by deleting on load.
  //
  // It now touches NOTHING except guaranteeing the equipment array exists (the `?? []` a partial /
  // hand-edited save needs). The version bump is retained so v37 saves already written on staging stay
  // valid. Any legacy dupe-bug orphan baselines simply ride through as harmless, re-installable spares.
  36: (state: any): any => ({ ...state, equipment: state.equipment ?? [] }),
  // v37 -> v38: Standard-Issue COMBAT baseline RE-STAT (combat-defense rework BUG-U6, design
  // 2026-08-27-combat-defense-rework-design.md sections 4 + 7). The rework moved a hull's defense
  // out of its Standard-Issue GEAR and into DERIVED innate ship stats: SI combat gear is now a
  // MODEST, FIXED floor (the SI_PLATING_HP / SI_EMITTER_CAP / SI_EMITTER_RECHARGE dials, model.ts),
  // the SAME on every hull, and the bridge fold is now `hull = innateHullArmor + plating.hullStrength`
  // (innate armor is derived per-hull, NOT stored, so there is NO per-ship innate field to backfill).
  //
  // THE PROBLEM this repairs: a save written BEFORE the rework carries SI combat baselines minted at
  // the OLD per-hull magnitudes (SI plating hullStrength = hullIntegrity - frameHp, e.g. 480 or 880;
  // SI emitter shieldCapacity = the hull's FULL value, e.g. 200 or 500). Loaded under the NEW additive
  // fold, an old carrier's 880 plating would fold to `innate 1000 + 880 = 1880` hull -> WRONG (badly
  // inflated). This step re-stats every SI combat baseline down to the fixed dials so a loaded ship
  // folds byte-identically to a freshly built one.
  //
  // WHAT IS RE-STATTED (magnitudes live in piece.implicitStats, see generateCombatStandardIssue in
  // model.ts, the SAME locations set here so a migrated baseline == a freshly minted one, Omega 4):
  //   - a hullPlating baseline -> implicitStats.hullStrength   = SI_PLATING_HP     (100)
  //   - a shieldEmitters baseline -> implicitStats.shieldCapacity = SI_EMITTER_CAP  (100)
  //                                  implicitStats.shieldRecharge  = SI_EMITTER_RECHARGE (3)
  // Whether the piece is FITTED or a SPARE is irrelevant (both fold the same magnitudes), so both are
  // re-statted; only the slotType + the strict-baseline test below gate what is touched.
  //
  // WHAT IS LEFT UNTOUCHED (deliberate):
  //   - WEAPON + droneBay baselines: the rework did NOT re-stat weapons/drones (their signature lines
  //     are unchanged, a fixed 0-bonus over the base def/template), so their implicits stay as minted.
  //   - CRAFTED gear (blueprintKey set): keeps its stored magnitudes, a dev-only artifact the 0.16.0
  //     balance pass owns (prod has no crafted defensive gear); a save migration must never silently
  //     re-stat a player's crafted item.
  //   - all economy gear (cargoBay/ftlDrive/reactorCore/specUtility) and any other slot.
  //
  // STRICT BASELINE TEST via the SHARED isStandardIssueBaseline (model.ts) = blueprintKey === null &&
  // rarity === "standard". This is SAFETY-CRITICAL: `blueprintKey === null` ALONE also matches dev-
  // granted RADIANT gear (devGrantEquipment mints it blueprintKey null while being an iL-400 keeper),
  // and re-statting one of those down to the SI floor would silently gut a valuable item, the exact
  // false-positive that predicate exists to prevent. Requiring rarity "standard" excludes every dev /
  // crafted / loot piece, so only a genuine free baseline is ever touched.
  //
  // IDEMPOTENT: a save whose baselines already carry the new magnitudes (a fresh game; an already-
  // migrated save; or a prod v30 save whose baselines were seeded by the v33/34/35 chain, which calls
  // the now-updated generateCombatStandardIssue at these same dials) is re-statted to the IDENTICAL
  // values, a value-level no-op. Re-running changes nothing.
  //
  // An EquipmentInstance carries no top-level Decimal (implicitStats magnitudes are PLAIN numbers), so
  // the re-statted pieces ride hydrateDecimals's `...state` spread untouched, hydrateDecimals needs NO
  // change. `?? []` guards a partial / hand-edited save. Every OTHER field rides through on the outer
  // `...state` spread. NOTE: on the current feature branch, NOT yet shipped to production, so still
  // editable (the frozen-once-shipped rule applies only to production-released migrations).
  37: (state: any): any => {
    const equipment = (state.equipment ?? []).map((piece: any) => {
      // Only a genuine free Standard-Issue baseline is a re-stat candidate (strict predicate: never a
      // dev radiant / crafted / loot piece). Everything else rides through untouched.
      if (!isStandardIssueBaseline(piece)) return piece;
      // hull-plating baseline: overwrite hullStrength to the fixed floor (the fold ADDS this to innate
      // armor). Spread the existing implicits so no other line on the piece is dropped.
      if (piece.slotType === "hullPlating") {
        return { ...piece, implicitStats: { ...piece.implicitStats, hullStrength: SI_PLATING_HP } };
      }
      // shield-emitter baseline: overwrite cap + recharge to the fixed floor (the fold SCALES these by
      // the hull's innate mults).
      if (piece.slotType === "shieldEmitters") {
        return {
          ...piece,
          implicitStats: { ...piece.implicitStats, shieldCapacity: SI_EMITTER_CAP, shieldRecharge: SI_EMITTER_RECHARGE },
        };
      }
      // A standard baseline of any OTHER slot (weapon / droneBay / economy) is left exactly as minted.
      return piece;
    });
    return { ...state, equipment };
  },
  // v38 -> v39: Standard-Issue SHIELD baseline RE-STAT to the shield REFERENCES (combat-defense rework
  // addendum, design 2026-08-27-combat-defense-rework-design.md; HYBRID model, user-locked 2026-08-27).
  // The rework's SECOND pass made the SHIELD stats multiplicative via an EFFECTIVENESS ratio (finalStat =
  // installedEmitter * authoredShield/REF), with SI emitters providing EXACTLY each shield reference, so
  // the SI shield dials moved UP: SI_EMITTER_CAP = REF_SHIELD_CAPACITY (300), SI_EMITTER_RECHARGE =
  // REF_SHIELD_RECHARGE (6). HULL STAYS ADDITIVE (user-locked: a bare hull keeps a nonzero frame), so
  // SI_PLATING_HP STAYS 100 and this step does NOT touch hullPlating.hullStrength.
  //
  // THE PROBLEM this repairs: a save written under the INTERIM v38 magnitudes carries SI shield baselines
  // at shieldCapacity 100 / shieldRecharge 3 (the old flat floor). Loaded under the multiplicative shield
  // fold, a 100-cap SI emitter on a destroyer would fold to 100 * (300/300) = 100 shield -> WRONG (should
  // be 300). This step re-stats every SI SHIELD baseline UP to the references so a loaded ship's shields
  // fold byte-identically to a freshly built one. Hull needs no re-stat: the additive SI plating stayed at
  // 100, and the prior v38 (MIGRATIONS[37]) already set it there.
  //
  // WHAT IS RE-STATTED (magnitudes live in piece.implicitStats, the SAME locations generateCombatStandardIssue
  // sets so a migrated baseline == a freshly minted one, Omega 4):
  //   - a shieldEmitters baseline -> implicitStats.shieldCapacity = SI_EMITTER_CAP      (300)
  //                                  implicitStats.shieldRecharge  = SI_EMITTER_RECHARGE (6)
  //
  // WHAT IS LEFT UNTOUCHED (deliberate): hullPlating baselines (hull is additive; SI_PLATING_HP stays 100,
  // set by the prior v38 step); weapon + droneBay baselines; CRAFTED gear (blueprintKey set) keeps its
  // stored magnitudes; all economy gear; any other slot.
  //
  // STRICT BASELINE TEST via the SHARED isStandardIssueBaseline (blueprintKey === null && rarity ===
  // "standard"). SAFETY-CRITICAL: this EXCLUDES a dev-minted RADIANT item (devGrantEquipment mints it
  // blueprintKey null but rarity "radiant", NOT "standard"), so re-statting can never gut a valuable dev
  // keeper. Requiring rarity "standard" is the whole guard; do NOT weaken it.
  //
  // v38 IS LEFT UNEDITED (it may already have run on a device): this v39 step simply OVERWRITES the shield
  // fields to the new values on top of whatever v38 wrote. IDEMPOTENT: a save whose shield baselines already
  // carry the references (a fresh game seeded by the updated generateCombatStandardIssue; an already-migrated
  // save) is re-statted to the IDENTICAL values, a value-level no-op. Re-running changes nothing. `?? []`
  // guards a partial / hand-edited save; every other field rides through on the outer `...state` spread.
  38: (state: any): any => {
    const equipment = (state.equipment ?? []).map((piece: any) => {
      // Only a genuine free Standard-Issue baseline is a re-stat candidate (strict predicate: never a
      // dev radiant / crafted / loot piece). Everything else rides through untouched.
      if (!isStandardIssueBaseline(piece)) return piece;
      // shield-emitter baseline: overwrite cap + recharge to the references (the fold MULTIPLIES these by
      // the hull's shield effectivenesses). Spread the existing implicits so no other line is dropped.
      if (piece.slotType === "shieldEmitters") {
        return {
          ...piece,
          implicitStats: { ...piece.implicitStats, shieldCapacity: SI_EMITTER_CAP, shieldRecharge: SI_EMITTER_RECHARGE },
        };
      }
      // Every OTHER slot (hullPlating [additive, untouched] / weapon / droneBay / economy) is left as minted.
      return piece;
    });
    return { ...state, equipment };
  },
};

export function migrate(save: SaveFile): GameState {
  let state = save.state;
  let version = save.version;
  while (MIGRATIONS[version]) {
    state = MIGRATIONS[version](state);
    version += 1;
  }
  // Hydrate the SHAPE first (Decimals, quality buckets), THEN reconcile any over-cap stack
  // down to its warehouse cap. clampInventoryToCaps needs the hydrated Decimal inventory +
  // the facility levels (both present after hydrateDecimals) to resolve each item's cap. It
  // runs on every load (idempotent, no SAVE_VERSION bump), which is what un-sticks a legacy
  // over-cap stack that the deposit clamp + materialAtCap auto-stop can never re-clamp on
  // their own (a stuck stack gets no further deposit to trigger the deposit-side clamp).
  return clampInventoryToCaps(hydrateDecimals(state));
}

export function serialize(state: GameState, createdAt: number): string {
  const payload: SaveFile = {
    version: SAVE_VERSION,
    created_at: createdAt,
    last_saved_at: Date.now(),
    game_time_seconds: state.gameTimeSeconds,
    state,
  };
  return LZString.compressToBase64(JSON.stringify(payload));
}

export function deserialize(raw: string): SaveFile | null {
  try {
    // Trim BEFORE decoding: a save exported to a .json file and re-imported
    // often picks up a trailing newline (editors / downloads append one), and
    // LZString.decompressFromBase64 returns null on that stray whitespace ->
    // import silently rejected. Base64 has no meaningful leading/trailing
    // whitespace, so trimming can never corrupt a VALID save; it only rescues
    // an otherwise-valid one. Scheme (LZString base64 + JSON.parse) unchanged.
    const trimmed = raw?.trim();
    if (!trimmed) return null; // null/empty/whitespace-only input -> not a save
    const json = LZString.decompressFromBase64(trimmed);
    if (!json) return null;
    const parsed = JSON.parse(json) as unknown;
    // STRUCTURAL GUARD. Decompress + JSON.parse only prove the blob is well-formed JSON,
    // NOT that it is a real save. A decompressible-but-malformed blob (a truncated or
    // hand-edited export, or any foreign LZString+JSON file) must be REJECTED here so it
    // flows into the corrupt-recovery path exactly like non-JSON garbage does. Without this
    // guard, importRawSave() persists it (it only checks deserialize() is truthy), and the
    // next load's migrate() -> hydrateDecimals() then throws on the missing state
    // (state.captains of undefined), white-screening on EVERY reload with no in-app escape.
    // A genuine save always carries an integer version and a non-null object state, so this
    // can never reject a valid save. (The integer check also rejects a string version, which
    // would otherwise partially-migrate via "5" + 1 = "51".)
    const shape = parsed as { version?: unknown; state?: unknown } | null;
    if (
      shape === null ||
      typeof shape !== "object" ||
      !Number.isInteger(shape.version) ||
      typeof shape.state !== "object" ||
      shape.state === null
    ) {
      return null;
    }
    return parsed as SaveFile;
  } catch {
    // Corrupt save, tech spec §6 says preserve raw data and surface it
    // rather than silently discarding. The caller decides what to show.
    return null;
  }
}

export function saveToLocalStorage(state: GameState, createdAt: number): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state, createdAt));
    localStorage.setItem(`${SAVE_KEY}_created_at`, String(createdAt));
    return true;
  } catch {
    return false;
  }
}

export function loadFromLocalStorage(): { state: GameState; lastSavedAt: number; createdAt: number } | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  const save = deserialize(raw);
  if (!save) return null;
  try {
    return { state: migrate(save), lastSavedAt: save.last_saved_at, createdAt: save.created_at };
  } catch {
    // A save that passes deserialize's shape guard (integer version + object state) can
    // still throw INSIDE migrate()/hydrateDecimals() when its FIELDS are the wrong type (a
    // hand-edited or, once cloud save lands, a hostile blob: captains a string, a mission
    // missing its cargo, lifetimeStats null, etc). Returning null routes it to the caller's
    // corrupt-recovery path (hasRawSave() true + a null load => offer recovery) instead of
    // letting the throw propagate out of onMount and white-screen with no in-app escape
    // (re-throwing on every reload). A valid save never throws here, so this cannot change
    // valid-load behavior.
    return null;
  }
}

export function exportRawSave(): string | null {
  return localStorage.getItem(SAVE_KEY);
}

// Distinguishes "no save exists" from "a save exists but failed to load".
// loadFromLocalStorage() returns null in BOTH cases (missing key, or a present
// but corrupt raw that deserialize() rejected), so the caller cannot tell them
// apart on its own. This tiny, pure check lets the load path see that a raw save
// IS present, and therefore treat a null load as CORRUPT (offer recovery) rather
// than EMPTY (start fresh and let autosave overwrite the unloadable raw).
export function hasRawSave(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

// Browser-side convenience: export the raw save AND trigger a file download.
// Single source of truth for the download glue so both the in-game "Export Save"
// button and the update-detector banner's "Export save" action produce identical
// behavior (same filename shape, same blob type). Returns false when there is no
// save to export. DOM-dependent, only call from the browser (no-op targets like
// SSR/tests have no document/URL).
export function downloadRawSave(): boolean {
  const raw = exportRawSave();
  if (!raw) return false;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fleet-admiral-save-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// Counterpart to exportRawSave, writes a previously-exported raw save
// string back into localStorage, after confirming it actually deserializes
// (rejects garbage/corrupt input rather than silently corrupting the
// current save). Writes the RAW string as-is (same LZ-compressed-base64
// shape exportRawSave produces) rather than re-serializing through
// migrate()/serialize(), avoids any risk of that round-trip silently
// changing the save's shape before the caller even gets a chance to reload
// and let the normal load-time migration path run.
export function importRawSave(raw: string): boolean {
  const save = deserialize(raw);
  if (!save) return false;
  try {
    localStorage.setItem(SAVE_KEY, raw);
    localStorage.setItem(`${SAVE_KEY}_created_at`, String(save.created_at));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(`${SAVE_KEY}_created_at`);
}
