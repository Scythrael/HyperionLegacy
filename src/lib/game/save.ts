// Save file contract — tech spec §6. Versioned from commit one (Ops §8.E.1).
// When the schema changes: bump SAVE_VERSION, add a migrate_vN_to_vN+1
// function to MIGRATIONS, and never touch old migrations again.

import LZString from "lz-string";
import Decimal from "break_infinity.js";
import { type GameState, type MissionPhase, freshCaptains, freshLifetimeStats, requiredTicksForPhase, MISSIONS, FUEL_TANK_BASE_CAP } from "./model";

export const SAVE_VERSION = 23;
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
// instances -- it just leaves whatever toJSON() produced as a plain string),
// or already a live Decimal instance (calling this twice is harmless) into a
// real Decimal. Safe to call unconditionally on any of the three shapes.
function toDecimal(value: Decimal | number | string): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

// Revives every per-key value of a lifetimeStats tally map (material/mission key
// -> Decimal) back into a real Decimal, returning a NEW map. Progression Pacing
// Rework (Task 6): once these maps carry values (mission loot / completed cycles),
// their per-value Decimals round-trip through JSON as plain strings exactly like
// the scalar sums do -- so each must be toDecimal()'d on load, the same per-key
// treatment homePlanet.storage's fixed keys already get, just iterated over the
// map's dynamic keys. Idempotent (toDecimal no-ops on an existing Decimal), and a
// no-op on an empty map (a fresh/never-populated tally). Mutates nothing.
function hydrateDecimalMap(map: Record<string, Decimal | number | string>): Record<string, Decimal> {
  const hydrated: Record<string, Decimal> = {};
  for (const key of Object.keys(map)) {
    hydrated[key] = toDecimal(map[key]);
  }
  return hydrated;
}

// Applied UNCONDITIONALLY at the end of migrate(), below -- NOT only inside
// MIGRATIONS[11]. A save already at the current SAVE_VERSION skips the
// migration while-loop entirely (there's no MIGRATIONS[12] to run), so if
// hydration only happened inside a version-keyed step, saves written by the
// CURRENT serialize()/deserialize() (whose Decimal fields round-trip through
// JSON as plain strings, per toJSON()) would never get converted back into
// live Decimal instances -- every .plus()/.gte() call in tick.ts would throw
// at runtime the first time it touched one. Idempotent, so calling it on an
// already-hydrated state (e.g. state built fresh via freshState(), never
// serialized at all) is also safe -- toDecimal() no-ops on an existing Decimal.
function hydrateDecimals(state: any): GameState {
  return {
    ...state,
    captains: state.captains.map((c: any) => ({
      ...c,
      xp: toDecimal(c.xp),
      mission: c.mission
        ? {
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
    // lands, a pre-migration save reaching here has NO `fuel` field -- toDecimal(undefined)
    // would produce a NaN Decimal -- so default the absent field to 0. Idempotent and
    // harmless once Task 9's migration guarantees the field's presence.
    fuel: toDecimal(state.fuel ?? new Decimal(0)),
    // Phase 1 (Ship Production Economy) keyed inventory: revive every per-VALUE
    // Decimal over this map's DYNAMIC keys (inventory can hold any ITEMS-registry
    // id, not a fixed union) -- the exact hydrateDecimalMap treatment lifetimeStats'
    // tally maps already get. This REPLACED the old homePlanet.storage per-value
    // hydration (storage removed in Task 7 -- a v18 save has NO homePlanet field, so
    // hydrating it here would throw on the unguarded read). Reached unconditionally
    // for the same reason every field here is: any save arriving at hydrateDecimals()
    // has `inventory` guaranteed present -- it was written at v18+ (freshState seeds
    // it) or MIGRATIONS[17] built it from the old save's homePlanet.storage before
    // this runs -- so the unguarded read is safe, same posture as the lifetimeStats
    // reads.
    //
    // Task 8 / Fuel v2: a persisted mid-flight timed process (startProcess pushes them
    // into activeProcesses) can carry a Decimal on its effect's `amount` -- an `addItem`
    // refine-job output OR an `addFuel` fuel-refine batch (Fuel Depot pipelines) -- which
    // round-trips through JSON as a plain string exactly like every other Decimal here, so
    // it MUST be toDecimal()'d back or a resolver .plus()/.gt() on it would throw/NaN on
    // load. Guarded on PRESENCE of an `amount` (both addItem and addFuel carry one; any
    // future amount-bearing effect is covered automatically -- no per-type opt-in seam): a
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
    inventory: hydrateDecimalMap(state.inventory),
    // lifetimeStats' 3 scalar sums are Decimal-typed (Progression Pacing
    // Rework), so -- exactly like credits/fleetAdminXp above -- they round-trip
    // through JSON as plain strings (Decimal.toJSON()) and MUST be converted
    // back here, or the first .plus() a future Completions/Achievements reader
    // does would throw. Reached unconditionally for the same reason every field
    // above is: any save arriving here has already had lifetimeStats guaranteed
    // present -- either it was written at v17+ (freshState seeds it) or the
    // migration chain's MIGRATIONS[16] backfilled it before this runs -- so the
    // unguarded `state.lifetimeStats.*` reads are safe, same posture as the
    // unguarded credits/inventory reads above.
    //
    // The 4 tally maps (itemsGathered/itemsRefined/itemsCrafted/
    // missionsCompleted) now get per-VALUE hydration too (Progression Pacing
    // Rework, Task 6 -- the task the earlier "flagged now so it isn't missed"
    // note pointed to). tickCaptainMission started populating itemsGathered/
    // missionsCompleted with real Decimal values (and the crafting path will feed
    // itemsRefined/itemsCrafted later), so each map's per-key Decimals round-trip
    // through JSON as plain strings with the identical hazard the scalars have --
    // hydrateDecimalMap() iterates each map's keys and toDecimal()s every value.
    // All four are covered (not just the two missions feed) so the round-trip is
    // complete regardless of which map a value lands in; empty maps stay empty
    // (hydrateDecimalMap no-ops over zero keys). Reached unconditionally for the
    // same reason as every field above -- lifetimeStats is guaranteed present by
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
// RESOURCE_ORDER, but MIGRATIONS[2] only backfilled `research` -- it never
// backfilled these two fields. Any save migrated through the *unpatched*
// MIGRATIONS[2] already got re-stamped as v3 by the next autosave (serialize()
// always writes the current SAVE_VERSION), but still has an object literal
// missing the `synthesizer`/`alloys` keys entirely -- not just a numeric
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
// shape (they no longer exist on GameState at all -- there is nothing to
// backfill them TO on the fleet-wide object, unlike prior migrations which
// only ever added missing fields to an otherwise-intact shape).
// v5 -> v6: HOTFIX. freshCaptains() originally gave Captain 2 a deliberately
// empty stack (0 modules) to feel distinct from a "just reset" captain. That
// was a genuine softlock: every module (including the miner) costs ore, and
// only a miner produces ore, so a captain starting at 0 miners can never
// afford anything, ever. Confirmed live in production. freshCaptains() itself
// is already fixed (both captains now get 1 free miner), which is enough for
// brand-new saves -- but any save that already migrated through the
// unpatched MIGRATIONS[4] has a captain permanently frozen at 0 miners baked
// into its serialized state, and (per Ops §8.E.1) that migration body can't
// be edited to fix them retroactively. This step repairs any captain with
// modules.miner === 0: there's no "sell modules" mechanic anywhere in this
// game, so the ONLY way a captain can be sitting at 0 miners is this exact
// bug -- a captain who was ever actually playable would have bought
// something by now. Safe to apply unconditionally for that reason.
// v6 -> v7: Fleet Admiral Skill Tree (docs/plans/2026-07-06-skill-tree-plan.md,
// Task 3). GameState gains `skillPoints`/`unlockedSkillNodes`. Existing v6
// saves already have 2 captains from Phase 1 (freshState() used to always
// give 2) -- rather than shrinking their roster to match the NEW "starts at
// 1" default (which would delete a captain's progress), this grandfathers
// them: if a save already has 2+ captains, commandRank1 is marked as already
// unlocked (so captainSlotCount(state) matches what they already have,
// keeping Fleet Prestige's reset consistent going forward), with no bonus
// skillPoints granted -- just "don't lose what you already earned." Only
// commandRank1 is ever granted here, never rank 2/3 -- no real save can have
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
// `null` -- this matters for the chained multi-version test below, where a
// v1 save chains all the way to v8 and captains picked up other fields along
// the way; we don't want this step to clobber anything already correctly
// set by an earlier step in the same chain.
// v8 -> v9: Navigation Restructuring & Progression Overhaul (docs/plans/2026-
// 07-06-phase4-navigation-progression-overhaul-plan.md, Task 7). This is the
// first migration in this project's history to correspond to a batch of
// REMOVED fields as well as added ones -- but unlike v4->v5 above, which
// actively deletes its old top-level fields via destructuring (that data had
// a new home to move to: captains[0]), this step does NOT delete anything,
// because there's nowhere for Generator-Stack-era fields to move to: the
// Generator Stack economy (and everything built on top of it -- Research,
// Specializations, the Skill Tree, both Prestige tiers) is gone from
// CaptainState/GameState, replaced by a Homeworld crafting system and a
// captain XP/leveling system, not migrated to a new location. Per the
// design doc, this migration does NOT attempt to strip the old fields
// (`modules`, `resources`, `research`, `captainPoints`, `captainPrestigeCount`,
// `specialization`, `skillPoints`, `unlockedSkillNodes`, `augmentPoints`,
// `prestigeCount`) out of an old save's JSON -- once CaptainState/GameState
// stop declaring them, nothing reads them, so they become harmless, inert
// extra properties riding along in the serialized blob. Stripping them would
// be extra risk (more code touching the migrated shape) for zero behavioral
// benefit. This step's only real job is backfilling the NEW required fields:
// CaptainState gains `xp`/`level`/`statPoints` (all absent entirely on any
// pre-v9 save -- backfilled to 0/1/0, the same baseline freshCaptainStack()
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
// save -- backfilled to `[]`, `[]`, `0`, `1`, `0` respectively, the same
// baseline freshState()/freshCaptainStack() give a brand-new game.
// v10 -> v11: UI Redesign (docs/plans/2026-07-07-ui-redesign-plan.md, Task 3).
// Collapses `tickDurationSeconds` from per-captain (where it has lived since
// MIGRATIONS[4]'s Multi-Captain Stacks split moved it onto captains[0], and
// onto every subsequently-added captain since) back to a single fleet-wide
// field on GameState -- every captain now advances on the same shared
// cadence (see the design doc for why). Reads the value off the FIRST
// captain (any pre-v11 save's captains all share the same value -- nothing
// has ever diverged them) as the new fleet-wide default, then strips the
// now-removed field from every captain via destructuring (same "delete via
// destructure" idiom MIGRATIONS[4] used when it moved fields IN the other
// direction). Falls back to 10 if captains[0] somehow has no
// tickDurationSeconds at all -- not reachable through any current code path
// (freshCaptainStack always set it pre-v11), but defense in depth, same
// category as several earlier migrations' `??` comments.
// v11 -> v12: Big-Number (Decimal) Migration (docs/plans/2026-07-08-big-
// number-migration-plan.md). homePlanet.storage's 5 keys, each captain's
// mission.cargo (3 keys) and xp, and fleetAdminXp switch from plain number to
// break_infinity.js's Decimal, to support unbounded scale (up to e1,000,000+).
// This migration step itself does no real conversion work -- on a pre-v12
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
// are snapshotted as literal values here -- NOT read from the live MISSIONS/
// requiredTicksForPhase in model.ts, which already reflect the NEW post-rebalance
// values by the time this migration runs -- so this keeps producing the correct
// v12 ratio permanently, even after MISSIONS is rebalanced again in some future
// update. phaseProgressTicks is already documented as continuous/fractional, so
// the remapped result needs no rounding.
// v13 -> v14: Talent Tree Visual Redesign (docs/plans/2026-07-08-talent-tree-
// visual-redesign-plan.md, Task 1). GameState gains `credits` (a fleet-wide
// currency, Decimal-typed from the start -- see hydrateDecimals below, which
// converts it unconditionally same as fleetAdminXp/homePlanet.storage/etc.),
// and CaptainState gains `spec` (this captain's chosen Captain Specialization
// branch, or null if none chosen yet -- NOT Decimal-typed, so no hydration
// step is needed for it). Both fields are absent entirely on any pre-v14
// save -- backfilled to 0 and null respectively, the same baseline
// freshState()/freshCaptainStack() give a brand-new game/captain. Note this
// backfill applies to EVERY captain in state.captains at this point in the
// chain regardless of how that captain object was originally constructed
// (e.g. MIGRATIONS[4]'s inline `captainOne` literal, far below, predates
// `spec` entirely -- same as it predates `xp`/`level`/`statPoints` (backfilled
// by MIGRATIONS[8]) and `unlockedCaptainTalents` (backfilled by MIGRATIONS[9]),
// neither of which needed touching at MIGRATIONS[4]'s own construction site
// either). Because MIGRATIONS runs strictly in increasing numeric order (see
// migrate()'s while-loop below), this step always executes AFTER MIGRATIONS[4]
// (or any other earlier step) has already run, and maps over whatever
// state.captains looks like at THAT point -- so every captain, regardless of
// origin, picks up `spec: null` here.
// Mission Rework (Task 1): FROZEN to the exact 2 mission keys that existed at save
// v12. Was `Record<MissionKey, ...>`, but MissionKey now includes salvageWreckage/
// forageFlora -- missions that did NOT exist at v12 and can never appear in a v12
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
    // (e.g. `research: {}`) -- not reachable through any current code path
    // (serialize() always writes a fully-typed GameState), but worth
    // knowing if a future migration or refactor ever produces a partial one.
    research: state.research ?? { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
  }),
  3: (state: any): GameState => ({
    ...state,
    // `state.modules?.` / `state.resources?.` guard against `modules`/
    // `resources` being wholesale absent, not just missing one key -- not
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
    // fresh[0] is discarded -- captainOne below carries the real migrated
    // data instead of a blank stack. Only fresh[1] (a genuinely never-played
    // second captain) is used, byte-for-byte identical to what a brand-new
    // save's Captain 2 looks like, since it's the same function call.
    const fresh = freshCaptains(2); // a v4 save is, by construction, always exactly the 2-captain Phase-1 shape
    // historical shape — predates the current CaptainState; typed loose so this frozen body isn't coupled to the live interface.
    const captainOne: any = {
      id: 1,
      label: "Captain 1",
      shipType: "resourcer",
      // Cloned (not passed by reference) so the pre-migration `state` object
      // and the new captains[0] can never end up aliased to the same nested
      // objects -- defense in depth, consistent with MIGRATIONS[3]'s spread
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
    // Grandfathers ONLY commandRank1 -- never rank 2/3 -- see the file-header
    // comment above for why that's the only case a real pre-v7 save can be in.
    unlockedSkillNodes: state.unlockedSkillNodes ?? ((state.captains?.length ?? 1) >= 2 ? ["commandRank1"] : []),
    skillPoints: state.skillPoints ?? 0,
  }),
  7: (state: any): GameState => ({
    ...state,
    // Fleet-wide loot stockpile, absent entirely on any pre-v8 save -- backfill
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
    // fleet-wide field on GameState -- every captain now advances on the same
    // shared cadence (see the design doc for why). Reads the value off the
    // FIRST captain (any pre-v11 save's captains all share the same value --
    // nothing has ever diverged them) as the new fleet-wide default, then
    // strips the now-removed field from every captain via destructuring --
    // the same "delete via destructure" idiom MIGRATIONS[4] used, applied
    // per-captain here rather than once on the top-level state object (since
    // MIGRATIONS[4] moved fields IN the other direction: off GameState, onto
    // captains[0]). Falls back to 10 if captains[0] somehow
    // has no tickDurationSeconds at all -- not reachable through any current
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
  11: (state: any): GameState => state, // no-op -- see the comment above; hydrateDecimals() (called unconditionally in migrate(), below) does the real work for both old AND already-current-version saves.
  12: (state: any): GameState => ({
    ...state,
    tickDurationSeconds: 1,
    captains: state.captains.map((c: any) => {
      if (!c.mission) return c;
      const oldRequired = oldRequiredTicksForPhase_v12(c.mission.phase, c.mission.missionKey);
      // Math.min(1, ...) guards against a ratio > 1 if phaseProgressTicks ever
      // exceeded oldRequired before migration ran -- not reachable through any
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
    // Plain number here, not `new Decimal(0)` -- hydrateDecimals() (called
    // unconditionally in migrate(), below) converts this to a real Decimal
    // for both old AND already-current-version saves, same pattern as
    // MIGRATIONS[11]'s no-op step used for the prior Decimal migration.
    credits: 0,
    // spec needs no such hydration -- it's not Decimal-typed. Backfilled here
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
  // so no legitimate save should carry it -- but nulling it too costs one token
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
  // v15 -> v16: Ships stats foundation. Captain/ship separation — every existing
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
  // pacing-rework-*). GameState gains `lifetimeStats` -- monotonic LIFETIME
  // totals reserved now for a future Completions/Achievements system to read.
  // Absent entirely on any pre-v17 save (freshState() only began seeding it in
  // this same feature), so backfill the identical clean-slate zeroed shape a
  // brand-new game gets, via the SHARED freshLifetimeStats() factory (model.ts)
  // that freshState() also calls -- so the migrated and fresh shapes can never
  // drift apart (Omega 4, DRY). freshLifetimeStats() returns live Decimal(0)
  // scalars, so this migrated shape already carries real Decimals; the
  // unconditional hydrateDecimals() at the end of migrate() re-confirms them
  // (idempotent -- toDecimal() no-ops on an existing Decimal), the same
  // pattern every prior Decimal field in this file relies on for its round-trip
  // (a re-saved v17 blob serializes those Decimals to strings, and that same
  // hydrateDecimals() call converts them back). The 4 tally maps start empty
  // ({}), so there are no per-key values to backfill or hydrate yet.
  // Frozen once shipped (never edit this body).
  16: (state: any): any => ({ ...state, lifetimeStats: freshLifetimeStats() }),
  // v17 -> v18: Ship Production Economy, Phase 1 (docs/plans/2026-07-11-facility-
  // framework-refinery-design.md §8, reconciled §0 to v17->v18). GameState gains
  // the keyed `inventory` (replacing homePlanet.storage's fixed union -- Task 7
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
  //   via hydrateDecimalMap -- idempotent, same pattern MIGRATIONS[16] relies on).
  // - discovered is seeded with every itemId whose storage balance is > 0
  //   (already-owned == already-discovered, so existing saves show no false ❓ on
  //   items they already hold). Empty-balance keys are NOT added -- they stay masked
  //   until first acquired, exactly like a brand-new save (freshState: discovered []).
  // - facilities/activeProcesses/nextProcessId get the SAME clean-slate baseline
  //   freshState seeds (refinery not built, no processes, next id 1).
  // - lifetimeStats is NOT touched -- it already shipped live in v17 (MIGRATIONS[16]
  //   / freshLifetimeStats), so re-seeding it here would clobber a returning
  //   player's accrued totals. The `...state` spread carries it through untouched.
  // homePlanet is DROPPED by this migration (Task 7): it's destructured out of the
  // returned state below so migrated v18 saves carry NO homePlanet field, only the
  // keyed `inventory` built from it. `state.homePlanet?.storage ?? {}` reads the old
  // save's storage to build inventory, guarding the wholesale-absent case defensively
  // (not reachable on a real save -- every save since v8 has homePlanet.storage --
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
  // v18 -> v19: Tiered Warehouse facilities (Phase 2, Task B2/B4 -- docs/plans/
  // 2026-07-13-phase-2-warehouse-refine-economy-design.md §3.1-§3.3). Task B2 added
  // two tiered Warehouse facilities to freshState (facilities.warehouseT1 /
  // facilities.warehouseT2, each { level: 0 }); this step backfills them onto an
  // existing v18 save, whose facilities map was seeded refinery-ONLY by MIGRATIONS[17]
  // (Phase 1). Both warehouses are added at level 0 IF ABSENT -- warehouseT1's level 0
  // is the base tier's LIVE starting state (cap 1,000,000; NOT "unbuilt" -- T1 is
  // available from the start), and warehouseT2's level 0 is LOCKED (its rung 0 is the
  // unlock). Uses the SAME `{ level: 0 }` literal freshState (model.ts) seeds, so the
  // migrated and fresh shapes cannot drift apart (Omega 4).
  //
  // - refinery is preserved value-for-value via `...state.facilities`; ONLY the two
  //   warehouse keys are added. inventory / activeProcesses / lifetimeStats /
  //   nextProcessId and every other GameState field ride through untouched on the outer
  //   `...state` spread -- this step's sole job is the two warehouse facility seeds.
  // - `?? { level: 0 }` is idempotent + belt-and-suspenders: a genuine v18 save has
  //   neither key (so both are seeded), but if a chained/hand-edited save somehow
  //   already carries one, its existing level is preserved rather than reset to 0.
  //   `state.facilities?.` guards the wholesale-absent facilities case defensively
  //   (not reachable on a real v18 save -- MIGRATIONS[17] always seeds facilities --
  //   same defense-in-depth posture as this file's other ?? guards).
  // - Warehouse facility state is `{ level: number }` -- NO Decimal -- so hydrateDecimals
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
  // v19 -> v20: Refine-order engine (Phase 2, Task D1 -- docs/plans/2026-07-13-phase-
  // 2-warehouse-refine-economy-design.md §4/§5). Task D1 added `refineOrder`
  // (RefineOrder | null) to GameState + freshState (seeded null); this step backfills
  // that same null seed onto an existing v19 save, which predates the field entirely.
  //
  // - `?? null` is idempotent + belt-and-suspenders: a genuine v19 save has NO
  //   refineOrder key (so it is seeded null), but if a chained/hand-edited save somehow
  //   already carries one, its existing order is PRESERVED rather than wiped. Mirrors
  //   the `?? { level: 0 }` posture MIGRATIONS[18] uses for the warehouse facilities.
  // - Every OTHER GameState field rides through untouched on the outer `...state`
  //   spread -- this step's sole job is the one `refineOrder` seed, exactly the
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
  //   PLAIN NUMBER, not `new Decimal(...)` -- the unconditional hydrateDecimals() at the end
  //   of migrate() converts it to a real Decimal (its `fuel` branch already handles this
  //   defensively, added in Task 3), the exact same plain-number pattern MIGRATIONS[13] uses
  //   for `credits`.
  //   SOFT-LOCK FIX (2026-07-14): the seed changed from 0 to FUEL_TANK_BASE_CAP (a FULL tank)
  //   to match freshState's new full-tank start. A pre-fuel v20 save has NO `fuel` key, no
  //   Deuterium Ice, and possibly no credits, so an empty-tank seed would have soft-locked a
  //   returning player exactly as it did a new one -- canDispatch fuelEmpty on every mission,
  //   no way to bootstrap the fuel economy. The `??` is DELIBERATELY KEPT: only a save with
  //   NO fuel field (a genuine pre-fuel v20) gets the one-time full-tank grant; a chained/
  //   hand-edited save that ALREADY carries a fuel balance keeps it exactly (never reset,
  //   never topped up). Non-exploitable: the grant fires once, only when fuel is absent.
  // - `facilities.fuelStorage` at level 0 (Task 4): the base tank's LIVE starting state
  //   (cap FUEL_TANK_BASE_CAP; NOT "unbuilt" -- the tank is usable from level 0, so
  //   missions can be fueled immediately, no soft-lock). Same `{ level: 0 }` literal
  //   freshState seeds, so migrated and fresh shapes cannot drift apart (Omega 4).
  // - `facilities.missionControl` at level 1 (Task 6) -- ⚠️ LOAD-BEARING, level 1 NOT 0.
  //   ALL FOUR missions are `unlockLevel: 1` (USER REVISION 2026-07-14) and
  //   missionUnlocked() derives purely from this facility's LEVEL (no separate flag).
  //   Seeding level 0 ("not built") would make missionUnlocked() return false for every
  //   mission, silently LOCKING the whole default set on every returning player's save --
  //   a soft-lock/regression. Level 1 keeps all four dispatchable. The mission-control
  //   unlock UPGRADE is deferred (track caps at level 1) until future missions exist.
  //
  // `?? { level: 0 }` / `?? { level: 1 }` are idempotent + belt-and-suspenders (a re-run
  // or partially-migrated save keeps an existing level rather than resetting it), and
  // `state.facilities?.` guards the wholesale-absent facilities case defensively -- not
  // reachable on a real v20 save (MIGRATIONS[17] always seeds facilities), same defense-
  // in-depth posture as this file's other ?? guards. NO ShipInstance grandfathering: hull
  // fuel stats (fuelCapacity/engineEfficiency) live on ShipTypeDef and instances derive
  // them from SHIP_TYPES (Task 3), so there is nothing to backfill onto ships here.
  // fuelStorage/missionControl facility state is `{ level: number }` -- NO Decimal -- so
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
  //   absent. A string[] of blueprint KEYS -- NO Decimal -- so hydrateDecimals needs NO change:
  //   it rides through its own `...state` spread there with no per-value revival, exactly as the
  //   Decimal-free `discovered` string[] already does. The `?? []` is idempotent + belt-and-
  //   suspenders: a genuine v21 save has NO researchedBlueprints key (so it is seeded `[]`), but
  //   a chained/hand-edited save that already carries unlocks keeps them exactly (never wiped).
  // - `facilities.research` at level 1 (Task R2) -- ⚠️ LOAD-BEARING, level 1 NOT 0, the same
  //   reasoning missionControl carries in MIGRATIONS[20]. Level 0 is "not built"; seeding at
  //   level 1 makes the Research Lab ESTABLISHED from game start, so tier-1 blueprints are
  //   researchable immediately on a returning player's save (blueprintResearchable() gates on
  //   research-facility level >= tier). A level-0 seed would silently LOCK all research on every
  //   existing save -- a soft-lock/regression. Same `{ level: 1 }` literal freshState seeds, so
  //   migrated and fresh shapes cannot drift apart (Omega 4). researchSlotCount tolerates an
  //   absent key (?? 0) regardless, but seeding keeps the facility present for the R5 UI.
  //
  // `?? { level: 1 }` is idempotent + belt-and-suspenders (a re-run or partially-migrated save
  // keeps an existing level rather than resetting it), and `state.facilities?.` guards the
  // wholesale-absent facilities case defensively -- not reachable on a real v21 save
  // (MIGRATIONS[17] always seeds facilities), same defense-in-depth posture as this file's other
  // ?? guards. research facility state is `{ level: number }` -- NO Decimal -- so hydrateDecimals
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
  // - `facilities.fabricator` at level 1 (Task F1) -- ⚠️ LOAD-BEARING, level 1 NOT 0, the same
  //   reasoning research carries in MIGRATIONS[21] (and missionControl in MIGRATIONS[20]). Level 0 is
  //   "not built"; seeding at level 1 makes the Fabricator ESTABLISHED from game start, so tier-1
  //   blueprints are fabricable immediately on a returning player's save (canFabricate gates
  //   blueprint.tier > fabricator level -> tierLocked). A level-0 seed would silently LOCK all tier-1
  //   fabrication on every existing save -- a soft-lock/regression. Same `{ level: 1 }` literal
  //   freshState seeds, so migrated and fresh shapes cannot drift apart (Omega 4).
  // - `fabricateOrder` (the standing fabricate order, Task F2): seeded null if absent -- the same
  //   fresh idle value freshState gives, and the exact `?? null` nullable-field idiom MIGRATIONS[19]
  //   used to seed `refineOrder`. FabricateOrder carries NO Decimal (blueprintKey string, mode.remaining
  //   a plain number, pausedReason a string literal), so hydrateDecimals needs NO change: it rides
  //   through its own `...state` spread there with no per-field revival, exactly as `refineOrder` does.
  //
  // `?? { level: 1 }` / `?? null` are idempotent + belt-and-suspenders: a genuine v22 save has neither
  // key (so both are seeded), but a chained/hand-edited save that already carries a fabricator level or
  // an active fabricateOrder keeps it exactly (never reset, never wiped). `state.facilities?.` guards
  // the wholesale-absent facilities case defensively -- not reachable on a real v22 save (MIGRATIONS[17]
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
};

export function migrate(save: SaveFile): GameState {
  let state = save.state;
  let version = save.version;
  while (MIGRATIONS[version]) {
    state = MIGRATIONS[version](state);
    version += 1;
  }
  return hydrateDecimals(state);
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
    return JSON.parse(json) as SaveFile;
  } catch {
    // Corrupt save — tech spec §6 says preserve raw data and surface it
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
  return { state: migrate(save), lastSavedAt: save.last_saved_at, createdAt: save.created_at };
}

export function exportRawSave(): string | null {
  return localStorage.getItem(SAVE_KEY);
}

// Counterpart to exportRawSave -- writes a previously-exported raw save
// string back into localStorage, after confirming it actually deserializes
// (rejects garbage/corrupt input rather than silently corrupting the
// current save). Writes the RAW string as-is (same LZ-compressed-base64
// shape exportRawSave produces) rather than re-serializing through
// migrate()/serialize() -- avoids any risk of that round-trip silently
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
