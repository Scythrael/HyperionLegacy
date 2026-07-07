// Save file contract — tech spec §6. Versioned from commit one (Ops §8.E.1).
// When the schema changes: bump SAVE_VERSION, add a migrate_vN_to_vN+1
// function to MIGRATIONS, and never touch old migrations again.

import LZString from "lz-string";
import { type GameState, type CaptainState, freshCaptains } from "./model";

export const SAVE_VERSION = 10;
export const SAVE_KEY = "fleet_admiral_save";

export interface SaveFile {
  version: number;
  created_at: number;
  last_saved_at: number;
  game_time_seconds: number;
  state: GameState;
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
};

export function migrate(save: SaveFile): GameState {
  let state = save.state;
  let version = save.version;
  while (MIGRATIONS[version]) {
    state = MIGRATIONS[version](state);
    version += 1;
  }
  return state as GameState;
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

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(`${SAVE_KEY}_created_at`);
}
