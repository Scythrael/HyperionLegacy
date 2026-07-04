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

  it("current SAVE_VERSION is 3", () => {
    expect(SAVE_VERSION).toBe(3);
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

  it("current SAVE_VERSION is 3", () => {
    expect(SAVE_VERSION).toBe(3);
  });
});
