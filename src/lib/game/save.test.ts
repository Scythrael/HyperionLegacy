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

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
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

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
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

    // Captain 2: fresh, never played, but still gets the shared 1-miner
    // floor -- see model.ts's freshCaptains() regression comment.
    expect(migrated.captains[1].id).toBe(2);
    expect(migrated.captains[1].label).toBe("Captain 2");
    expect(migrated.captains[1].modules.miner).toBe(1);
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

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
  });
});

describe("migrate — captain miner-floor backfill (hotfix)", () => {
  it("repairs a captain permanently stuck at 0 miners, leaves an unaffected captain untouched", () => {
    // The real-world corrupted shape: a save that already migrated through
    // the unpatched v4->v5 step (or was otherwise created with the old
    // freshCaptains()), so captains[1] is permanently stuck at 0 miners --
    // and since every module costs ore and only a miner produces ore, that
    // captain can never afford anything, ever (confirmed live in
    // production). captains[0] has real, non-zero progress and must survive
    // completely untouched.
    const corruptedState: any = {
      augmentPoints: 5,
      prestigeCount: 1,
      gameTimeSeconds: 4000,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 800, ingots: 300, components: 40, alloys: 0 },
          modules: { miner: 12, refinery: 3, fabricator: 1, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 40,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
        {
          id: 2,
          label: "Captain 2",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 0, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 5,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 4000,
      state: corruptedState,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains[1].modules.miner).toBe(1); // repaired
    expect(migrated.captains[1].modules.refinery).toBe(0); // other modules untouched
    expect(migrated.captains[0].modules.miner).toBe(12); // unaffected captain fully untouched
    expect(migrated.captains[0].resources.ore).toBe(800);
  });

  it("does not touch a captain who already has miners (only exactly-0 is repaired)", () => {
    const state: any = {
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 3, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 5,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state,
    };

    const migrated: any = migrate(save);
    expect(migrated.captains[0].modules.miner).toBe(3); // untouched, not reset
  });

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
  });
});

// NOTE: the pre-Task-3 "migrate — chained v1 -> v6 migration" describe block
// that used to live here was deleted, not just edited -- same deliberate,
// authorized deviation from this task's own "keep every existing describe
// block untouched" instruction as the v1->v5 deletion noted above. It
// exercised the exact same legacyState literal and is now strictly redundant
// with "migrate — chained v1 -> v7 migration" below, which covers the same
// "one genuine legacy save chained through every migration step" property,
// correctly extended through v7's grandfathering. Keeping both would mean
// maintaining two overlapping tests of the same property, one of them stale.

describe("migrate — skill tree backfill (v6 -> v7)", () => {
  it("grandfathers an existing v6 save's 2nd captain as if commandRank1 were already bought", () => {
    // A genuine v6 save: 2 captains (Phase 1's fixed starting count), no
    // skill tree fields at all. Hand-written literal -- freshState() no
    // longer produces this shape (it now starts at 1 captain, post this
    // same feature), so it can't stand in for a real legacy save here.
    const legacyState: any = {
      augmentPoints: 10,
      prestigeCount: 1,
      gameTimeSeconds: 500,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 100, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 5, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 20,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
        {
          id: 2,
          label: "Captain 2",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 6,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 500,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.unlockedSkillNodes).toEqual(["commandRank1"]);
    expect(migrated.skillPoints).toBe(0); // no bonus grant, just "don't lose what you already have"
    expect(migrated.captains).toHaveLength(2); // unchanged roster, nothing deleted
    expect(migrated.captains[0].modules.miner).toBe(5); // existing progress untouched
    expect(migrated.captains[1].id).toBe(2);
  });

  it("does not grandfather commandRank1 for a genuine single-captain v6 save", () => {
    const legacyState: any = {
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 0,
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 0, ingots: 0, components: 0, alloys: 0 },
          modules: { miner: 1, refinery: 0, fabricator: 0, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 0,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
        },
      ],
    };

    const save: SaveFile = {
      version: 6,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.unlockedSkillNodes).toEqual([]);
    expect(migrated.skillPoints).toBe(0);
  });

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
  });
});

// NOTE: the pre-Task-4 "migrate — chained v1 -> v7 migration" describe block
// that used to live here was deleted, not just edited -- same deliberate,
// authorized deviation from this task's own "keep every existing describe
// block untouched" instruction as the v1->v5 and v1->v6 deletions noted
// above. It exercised the exact same legacyState literal and is now strictly
// redundant with "migrate — chained v1 -> v8 migration" below, which covers
// the same "one genuine legacy save chained through every migration step"
// property, correctly extended through v8's homePlanet/mission backfill.
// Keeping both would mean maintaining two overlapping tests of the same
// property, one of them stale.

describe("migrate — home planet storage & captain mission backfill (v7 -> v8)", () => {
  it("backfills homePlanet.storage and mission: null on a genuine v7 save that predates both fields", () => {
    // A genuine v7 shape: skill tree fields present (MIGRATIONS[6] already ran
    // on real saves of this era), but `homePlanet` doesn't exist anywhere on
    // GameState yet, and captains have no `mission` field at all -- hand-
    // written literal, same reasoning as every other legacy fixture in this
    // file: freshState() no longer represents this shape (it now always
    // includes homePlanet and every captain always has `mission`).
    const legacyState: any = {
      augmentPoints: 0,
      prestigeCount: 0,
      gameTimeSeconds: 1000,
      skillPoints: 2,
      unlockedSkillNodes: ["commandRank1"],
      captains: [
        {
          id: 1,
          label: "Captain 1",
          shipType: "resourcer",
          resources: { ore: 400, ingots: 100, components: 20, alloys: 5 },
          modules: { miner: 8, refinery: 2, fabricator: 1, synthesizer: 0 },
          research: { alloySynthesis: { started: false, progressSeconds: 0, completed: false } },
          lifetimeComponents: 60,
          tickDurationSeconds: 10,
          captainPoints: 0,
          captainPrestigeCount: 0,
          specialization: null,
          // no `mission` key at all -- the real pre-v8 shape
        },
      ],
    };

    const save: SaveFile = {
      version: 7,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 1000,
      state: legacyState,
    };

    const migrated: any = migrate(save);
    expect(migrated.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
    expect(migrated.captains[0].mission).toBe(null);

    // Unrelated pre-existing fields on the captain survive the backfill untouched.
    expect(migrated.captains[0].modules.miner).toBe(8);
    expect(migrated.captains[0].resources.ore).toBe(400);
    expect(migrated.captains[0].research.alloySynthesis.completed).toBe(false);
    expect(migrated.captains[0].lifetimeComponents).toBe(60);
  });

  it("current SAVE_VERSION is 8", () => {
    expect(SAVE_VERSION).toBe(8);
  });
});

describe("migrate — chained v1 -> v8 migration", () => {
  it("backfills every field across all seven migration steps on a genuine v1 save missing all of them", () => {
    // The real v1 shape: no tickDurationSeconds, no research, no
    // synthesizer/alloys fields, no captains array, no skill tree fields, no
    // homePlanet, no mission -- this exercises MIGRATIONS[1] through [7]
    // running back-to-back on the same object, not just one isolated step.
    // Same legacyState literal the deleted v1->v7 block used (see the NOTE
    // above), extended one step further.
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
    expect(migrated.captains).toHaveLength(2); // v4->v5's fresh[1], per Step 1's fix above
    expect(migrated.captains[0].tickDurationSeconds).toBe(10);
    expect(migrated.captains[0].research.alloySynthesis).toEqual({
      started: false,
      progressSeconds: 0,
      completed: false,
    });
    expect(migrated.captains[0].modules.synthesizer).toBe(0);
    expect(migrated.captains[0].resources.alloys).toBe(0);
    expect(migrated.captains[0].modules.miner).toBe(1); // original v1 progress preserved
    expect(migrated.captains[1].modules.miner).toBe(1); // fresh second captain, shared 1-miner floor
    expect(migrated.unlockedSkillNodes).toEqual(["commandRank1"]); // 2 captains -> grandfathered
    expect(migrated.skillPoints).toBe(0);
    expect(migrated.gameTimeSeconds).toBe(100); // fleet-wide field survives the whole chain
    expect(migrated.homePlanet.storage).toEqual({ commonOre: 0, uncommonMaterial: 0, rareMaterial: 0 });
    expect(migrated.captains[0].mission).toBe(null);
    expect(migrated.captains[1].mission).toBe(null);
  });
});
