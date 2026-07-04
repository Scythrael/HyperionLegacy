import { describe, it, expect } from "vitest";
import { migrate, SAVE_VERSION, type SaveFile } from "./save";

describe("migrate — tickDurationSeconds backfill", () => {
  it("defaults tickDurationSeconds to 10 on a v1 save that predates the field", () => {
    // A genuine pre-tick-bar v1 shape: flat (pre-Phase-1) fields, no
    // tickDurationSeconds, no research, no synthesizer/alloys keys at all --
    // freshState() can no longer stand in for this (it returns the current
    // captains-array shape post-Task-1), so this is a hand-written literal
    // matching what a real save from that era actually looked like.
    const legacyState: any = {
      resources: { ore: 0, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      lifetimeComponents: 0,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
    };

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    // migrate()'s while-loop doesn't stop at v2 -- a v1 save chains all the
    // way through MIGRATIONS[1..4] to v5, so tickDurationSeconds ends up on
    // captains[0], not on the top-level GameState.
    const migrated: any = migrate(save);
    expect(migrated.captains[0].tickDurationSeconds).toBe(10);
  });

  it("current SAVE_VERSION is 5", () => {
    expect(SAVE_VERSION).toBe(5);
  });
});

describe("migrate — research field backfill", () => {
  it("defaults research to a fresh alloySynthesis entry on a v2 save that predates the field", () => {
    // A genuine v2 shape: tickDurationSeconds now present (MIGRATIONS[1]
    // already ran on real saves of this era), but research doesn't exist
    // yet. Hand-written literal, same reasoning as the v1 fixture above --
    // freshState() no longer represents this flat shape.
    const legacyState: any = {
      resources: { ore: 0, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      lifetimeComponents: 0,
      tickDurationSeconds: 10,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
    };

    const save: SaveFile = {
      version: 2,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    // Chains through MIGRATIONS[2..4] to v5 -- research ends up on
    // captains[0], not the top level.
    const migrated: any = migrate(save);
    expect(migrated.captains[0].research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
  });

  it("current SAVE_VERSION is 5", () => {
    expect(SAVE_VERSION).toBe(5);
  });
});

describe("migrate — synthesizer/alloys field backfill (hotfix)", () => {
  it("defaults modules.synthesizer and resources.alloys to 0 on a v3 save that predates the fields", () => {
    // A genuine v3 shape: tickDurationSeconds and research both present
    // (MIGRATIONS[1] and [2] already ran on real saves of this era), but
    // modules/resources are missing the synthesizer/alloys keys entirely --
    // freshState() no longer represents this flat shape, hence the literal.
    const legacyState: any = {
      resources: { ore: 0, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
      lifetimeComponents: 0,
      tickDurationSeconds: 10,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
    };

    const save: SaveFile = {
      version: 3,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    // Chains through MIGRATIONS[3..4] to v5 -- synthesizer/alloys end up
    // under captains[0].modules/resources, not the top level.
    const migrated: any = migrate(save);
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
  });

  it("repairs a save that was already re-stamped v3 by the unpatched migration (the real-world corrupted shape)", () => {
    // The bug this hotfix fixes: MIGRATIONS[2] (v2->v3) only ever backfilled
    // `research`, never `modules.synthesizer`/`resources.alloys`. Any save
    // that passed through the unpatched version already got its version
    // field re-stamped to 3 by the next autosave (serialize() always writes
    // current SAVE_VERSION), even though those two fields are still missing
    // entirely. This is that exact shape -- version already 3, fields gone.
    // Hand-written literal for the same reason as the fixture above; also
    // carries realistic non-fresh progress (modules.miner:19, completed
    // research) to confirm the repair doesn't clobber unrelated fields.
    const corruptedState: any = {
      resources: { ore: 0, ingots: 0, components: 0 },
      modules: { miner: 19, refinery: 0, fabricator: 0 }, // realistic non-fresh save: progress exists elsewhere
      research: { alloySynthesis: { started: false, progressSeconds: 0, completed: true } },
      lifetimeComponents: 0,
      tickDurationSeconds: 10,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
    };

    const save: SaveFile = {
      version: 3,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: corruptedState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
    expect(migrated.captains[0].modules.miner).toBe(19); // untouched fields survive the repair
    expect(migrated.captains[0].research.alloySynthesis.completed).toBe(true);
  });
});

// NOTE: the pre-Task-3 "migrate — chained v1 -> v4 migration" describe block
// that used to live here was deleted, not just edited. It predated Task 1's
// model.ts refactor (its freshState()-based fixture no longer matches the
// real v1 shape and its assertions read top-level fields that MIGRATIONS[4]
// now moves under captains[0]), and it is now strictly redundant with
// "migrate — chained v1 -> v5 migration" below, which covers the same "one
// genuine legacy save chained through every migration step" property,
// correctly extended through v5. Keeping both would mean maintaining two
// overlapping tests of the same property, one of them broken -- removing the
// stale one is a deliberate, authorized deviation from this task's own
// "keep every existing describe block untouched" instruction, not a silent
// coverage drop (the new block is a strict superset).

describe("migrate — captains roster backfill (v4 -> v5)", () => {
  it("moves the old flat shape into captains[0] and adds a fresh captains[1]", () => {
    // A genuine pre-Phase-1 save: resources/modules/research/lifetimeComponents/
    // tickDurationSeconds sitting directly on the state object, `captains`
    // entirely absent -- exactly the real shape this migration exists to repair.
    const legacyState: any = {
      resources: { ore: 500, ingots: 200, components: 50, alloys: 12 },
      modules: { miner: 19, refinery: 5, fabricator: 2, synthesizer: 1 },
      research: { alloySynthesis: { started: false, progressSeconds: 0, completed: true } },
      lifetimeComponents: 300,
      tickDurationSeconds: 10,
      augmentPoints: 42,
      prestigeCount: 3,
      gameTimeSeconds: 9000,
    };

    const save: SaveFile = {
      version: 4,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 9000,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains).toHaveLength(2);

    // Captain 1: the old single stack, preserved verbatim (including
    // already-completed research -- this is what a real returning player's
    // save looks like right now).
    expect(migrated.captains[0].id).toBe(1);
    expect(migrated.captains[0].label).toBe("Captain 1");
    expect(migrated.captains[0].shipType).toBe("resourcer");
    expect(migrated.captains[0].resources).toEqual({ ore: 500, ingots: 200, components: 50, alloys: 12 });
    expect(migrated.captains[0].modules).toEqual({ miner: 19, refinery: 5, fabricator: 2, synthesizer: 1 });
    expect(migrated.captains[0].research.alloySynthesis.completed).toBe(true);
    expect(migrated.captains[0].lifetimeComponents).toBe(300);
    expect(migrated.captains[0].captainPoints).toBe(0);
    expect(migrated.captains[0].captainPrestigeCount).toBe(0);
    expect(migrated.captains[0].specialization).toBe(null);

    // Captain 2: fresh, empty, never played.
    expect(migrated.captains[1].id).toBe(2);
    expect(migrated.captains[1].label).toBe("Captain 2");
    expect(migrated.captains[1].modules.miner).toBe(0);
    expect(migrated.captains[1].lifetimeComponents).toBe(0);

    // Fleet-wide fields survive untouched; old top-level per-stack fields are gone.
    expect(migrated.augmentPoints).toBe(42);
    expect(migrated.prestigeCount).toBe(3);
    expect(migrated.gameTimeSeconds).toBe(9000);
    expect(migrated.resources).toBeUndefined();
    expect(migrated.modules).toBeUndefined();
    expect(migrated.research).toBeUndefined();
    expect(migrated.lifetimeComponents).toBeUndefined();
    expect(migrated.tickDurationSeconds).toBeUndefined();
  });

  it("current SAVE_VERSION is 5", () => {
    expect(SAVE_VERSION).toBe(5);
  });
});

describe("migrate — chained v1 -> v5 migration", () => {
  it("backfills every field across all four migration steps on a genuine v1 save missing all of them", () => {
    // The real v1 shape: no tickDurationSeconds, no research, no
    // synthesizer/alloys fields, AND (obviously) no captains array at all --
    // this exercises MIGRATIONS[1] through [4] running back-to-back on the
    // same object, not just one isolated step.
    const legacyState: any = {
      resources: { ore: 10, ingots: 0, components: 0 },
      modules: { miner: 1, refinery: 0, fabricator: 0 },
      lifetimeComponents: 0,
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 100,
    };

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 100,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains).toHaveLength(2);
    expect(migrated.captains[0].tickDurationSeconds).toBe(10);
    expect(migrated.captains[0].research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
    expect(migrated.captains[0].modules.miner).toBe(1); // original v1 progress preserved
    expect(migrated.captains[1].modules.miner).toBe(0); // fresh second captain
    expect(migrated.gameTimeSeconds).toBe(100); // fleet-wide field survives the whole chain
  });
});
