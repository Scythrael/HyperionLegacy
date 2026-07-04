import { describe, it, expect } from "vitest";
import { migrate, SAVE_VERSION, type SaveFile } from "./save";
import { freshState } from "./model";

describe("migrate — tickDurationSeconds backfill", () => {
  it("defaults tickDurationSeconds to 10 on a v1 save that predates the field", () => {
    const legacyState = freshState();
    // simulate an old save: strip the field to mimic a pre-migration record
    delete (legacyState as any).tickDurationSeconds;

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.tickDurationSeconds).toBe(10);
  });

  it("current SAVE_VERSION is 4", () => {
    expect(SAVE_VERSION).toBe(4);
  });
});

describe("migrate — research field backfill", () => {
  it("defaults research to a fresh alloySynthesis entry on a v2 save that predates the field", () => {
    const legacyState = freshState();
    delete (legacyState as any).research;

    const save: SaveFile = {
      version: 2,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
  });

  it("current SAVE_VERSION is 4", () => {
    expect(SAVE_VERSION).toBe(4);
  });
});

describe("migrate — synthesizer/alloys field backfill (hotfix)", () => {
  it("defaults modules.synthesizer and resources.alloys to 0 on a v3 save that predates the fields", () => {
    const legacyState = freshState();
    delete (legacyState.modules as any).synthesizer;
    delete (legacyState.resources as any).alloys;

    const save: SaveFile = {
      version: 3,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.modules.synthesizer).toBe(0);
    expect(migrated.resources.alloys).toBe(0);
  });

  it("repairs a save that was already re-stamped v3 by the unpatched migration (the real-world corrupted shape)", () => {
    // The bug this hotfix fixes: MIGRATIONS[2] (v2->v3) only ever backfilled
    // `research`, never `modules.synthesizer`/`resources.alloys`. Any save
    // that passed through the unpatched version already got its version
    // field re-stamped to 3 by the next autosave (serialize() always writes
    // current SAVE_VERSION), even though those two fields are still missing
    // entirely. This is that exact shape -- version already 3, fields gone.
    const corruptedState = freshState();
    delete (corruptedState.modules as any).synthesizer;
    delete (corruptedState.resources as any).alloys;
    corruptedState.modules.miner = 19; // realistic non-fresh save: progress exists elsewhere
    corruptedState.research.alloySynthesis.completed = true;

    const save: SaveFile = {
      version: 3,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: corruptedState,
    };

    const migrated = migrate(save);
    expect(migrated.modules.synthesizer).toBe(0);
    expect(migrated.resources.alloys).toBe(0);
    expect(migrated.modules.miner).toBe(19); // untouched fields survive the repair
    expect(migrated.research.alloySynthesis.completed).toBe(true);
  });
});

describe("migrate — chained v1 -> v4 migration", () => {
  it("backfills tickDurationSeconds, research, and the synthesizer/alloys fields on a genuine v1 save missing all of them", () => {
    // A real pre-tick-bar save never had tickDurationSeconds, research, OR
    // the synthesizer/alloys fields -- all three were added by later
    // features. Stripping only one (as the other describe blocks above do)
    // never exercises MIGRATIONS[1], [2], and [3] actually running
    // back-to-back on the same object.
    const legacyState = freshState();
    delete (legacyState as any).tickDurationSeconds;
    delete (legacyState as any).research;
    delete (legacyState.modules as any).synthesizer;
    delete (legacyState.resources as any).alloys;

    const save: SaveFile = {
      version: 1,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated = migrate(save);
    expect(migrated.tickDurationSeconds).toBe(10);
    expect(migrated.research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
    expect(migrated.modules.synthesizer).toBe(0);
    expect(migrated.resources.alloys).toBe(0);
  });
});
