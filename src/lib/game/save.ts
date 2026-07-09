// Save file contract — tech spec §6. Versioned from commit one (Ops §8.E.1).
// When the schema changes: bump SAVE_VERSION, add a migrate_vN_to_vN+1
// function to MIGRATIONS, and never touch old migrations again.

import LZString from "lz-string";
import Decimal from "break_infinity.js";
import { type GameState, type CaptainState, type MissionKey, type MissionPhase, freshCaptains, requiredTicksForPhase, MISSIONS } from "./model";

export const SAVE_VERSION = 15;
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
    homePlanet: {
      storage: {
        commonOre: toDecimal(state.homePlanet.storage.commonOre),
        uncommonMaterial: toDecimal(state.homePlanet.storage.uncommonMaterial),
        rareMaterial: toDecimal(state.homePlanet.storage.rareMaterial),
        refinedMaterial: toDecimal(state.homePlanet.storage.refinedMaterial),
        components: toDecimal(state.homePlanet.storage.components),
      },
    },
    fleetAdminXp: toDecimal(state.fleetAdminXp),
    credits: toDecimal(state.credits),
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
const OLD_MISSION_TICKS_V12: Record<MissionKey, {
  transitOutTicks: number; transitBackTicks: number; unloadTicks: number;
  extractionRatePerTick: number; cargoCapacity: number;
}> = {
  shortOreRun: { transitOutTicks: 3, transitBackTicks: 3, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
  longOreRun: { transitOutTicks: 8, transitBackTicks: 8, unloadTicks: 1, extractionRatePerTick: 10, cargoCapacity: 100 },
};

function oldRequiredTicksForPhase_v12(phase: MissionPhase, missionKey: MissionKey): number {
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
    const captainOne: CaptainState = {
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
      const newRequired = requiredTicksForPhase(c.mission.phase, MISSIONS[c.mission.missionKey]);
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
  // and clear every captain's unlockedCaptainTalents. spec === "command" is
  // cleared to null (command was the only other selectable spec besides
  // resourcefulness; diplomacy was never selectable). Homeworld keys are all
  // preserved (Task 3 kept every v14 key), so unlockedHomeworldTalents is left
  // untouched here.
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
          spec: c.spec === "command" ? null : c.spec, // diplomacy never selectable; resourcefulness kept
        };
      }),
    };
  },
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
    const json = LZString.decompressFromBase64(raw);
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
