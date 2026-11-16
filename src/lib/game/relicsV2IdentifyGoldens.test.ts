// Relics v2 R2-3 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-3): the PRE-R2-3 GOLDENS. Tests only, captured on
// the code BEFORE the identification v2 engine edit (on top of R2-2). They pin what a study does today, so R2-3 proves
// what it moves and what it keeps:
//   1. a v1 study over a grid (4 sets x 4 rarities x 8 tokens), started and resolved: museum, first finds, log record.
//   2. v1 studies of tier-stamped and setless blanks (R2-2 tokens): which museum record they land in.
//   3. one tick where a relic study, a Research Lab upgrade and another upgrade complete together: the log order and
//      the whole state, one call and 1 s steps.
//   4. the relic-study lane count per Research Lab level 0 to 7.
// NEVER regenerate these from a later build. A slice that moves one names it and the reason in its commit.

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { asOrdering2Normalized, ordering2OffForThisFile, withOrdering2On } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, it, expect } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
recapFoldsOffForThisFile();
import { freshState, type EquipmentRarity, type GameState, type RelicSetId, type RelicVaultToken, type TimedProcess } from "./model";
import { RELIC_SETS } from "./relics";
import { economyTick, relicStudySlotCount, resolveProcesses, tick } from "./tick";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { startV1RelicStudy } from "./relicStudyV1.fixture";

const SETS: readonly RelicSetId[] = ["precursor", "shipwright", "xenobiology", "deepEarth"];
const RARITIES: readonly EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];

function sited(id: string, setId: RelicSetId, tier: EquipmentRarity, extra: Partial<RelicVaultToken> = {}): RelicVaultToken {
  const poiId = RELIC_SETS.find((s) => s.id === setId)!.sources[0];
  return { id, tier, quality: 0, setId, poiId, ...extra };
}

// Start the first vault token as a v1 study and resolve it in one closed-form call.
function studyV1(s: GameState): GameState {
  const started = startV1RelicStudy(s, s.relicVault[0].id);
  expect(started.started).toBe(true);
  const proc = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
  return resolveProcesses(started.next, proc.remainingTicks, () => 0).next;
}

describe("R2-3 golden 1: a v1 study over 4 sets x 4 rarities x 8 tokens", () => {
  it("museum, first finds and the log record hash to their pre-R2-3 value", () => {
    const rows: unknown[] = [];
    for (const set of SETS) {
      for (const rarity of RARITIES) {
        for (let i = 0; i < 8; i++) {
          const s: GameState = { ...freshState(), relicVault: [sited(`g-${set}-${rarity}-${i}`, set, rarity)], nextRelicStudyIndex: 1 + i * 3 };
          const done = studyV1(s);
          const rec = done.completionLog[done.completionLog.length - 1];
          rows.push([set, rarity, i, done.museumV2, done.relicDiscovered, rec.kind, rec.reward, rec.subjectKey]);
        }
      }
    }
    expect(hash(rows)).toBe("9664345b");
  });
});

describe("R2-3 golden 2: v1 studies of R2-2 blanks", () => {
  // MOVED by R2-3 (named in its commit; R2-2 carry note "R2-3 owns per-tier deposit"): a v1 study now deposits into its
  // token's region tier record, so the Tier II and Tier VII blanks land in "2" and "7". Same relics, same counts; the
  // Tier I blank and every pre-R2-2 token (no regionTier) still land in "1". Pre-R2-3: all three in "1", hash f713ac30.
  // MOVED by the R2-3 follow-up (2026-11-13, the generalPick retirement): the Tier VII and Tier I rows were SETLESS
  // blanks, which only the retired v1 general pick identified (no build ever started a v1 study of a setless blank, so a
  // save holding one is tampered and lands nothing). They are now sited blanks of the same tiers, so the golden keeps
  // proving that a v1 study lands in its token's region tier; the new rows and hash were captured on 424f5089, before
  // the retirement. The Tier II row is unchanged. Pre-follow-up: tectonicKeystone / starChartFragment, hash b594007d.
  it("a Tier II, a Tier VII and a Tier I sited blank land in their own tier's record", () => {
    const tokens: RelicVaultToken[] = [
      sited("b-t2", "shipwright", "stellar", { regionTier: 2, cultureId: "culture-t2-3" }),
      sited("b-t7", "deepEarth", "radiant", { regionTier: 7, cultureId: "culture-t7-1" }),
      sited("b-t1", "precursor", "augmented", { regionTier: 1, cultureId: "culture-t1-2" }),
    ];
    const out = tokens.map((t) => studyV1({ ...freshState(), relicVault: [t] }).museumV2);
    expect(out.map((m) => m.general)).toEqual([{ "2": { ancientDriveCoil: 1 } }, { "7": { deepVeinCompass: 1 } }, { "1": { resonanceShard: 1 } }]);
    expect(hash(out)).toBe("6ee455fc");
  });
});

describe("R2-3 golden 3: a relic study, a Lab upgrade and another upgrade completing on one tick", () => {
  const seed = (): GameState => {
    const base: GameState = { ...freshState(), relicVault: [sited("c-1", "precursor", "stellar"), sited("c-2", "deepEarth", "standard")] };
    const started = startV1RelicStudy(base, "c-1").next;
    const study = started.activeProcesses.find((p) => p.kind === "relicStudy")!;
    const upgrades: TimedProcess[] = [
      { id: "proc-900", kind: "facilityUpgrade", remainingTicks: 5, durationTicks: 5, effect: { type: "facilityLevelUp", facility: "salvageBay" } },
      { id: "proc-901", kind: "facilityUpgrade", remainingTicks: 5, durationTicks: 5, effect: { type: "facilityLevelUp", facility: "research" } },
    ];
    return { ...started, activeProcesses: [upgrades[0], { ...study, remainingTicks: 5 }, upgrades[1]] };
  };
  it("the log order and the whole state, one call and 1 s steps", () => {
    const offline = tick(8, seed(), () => 0);
    let live = seed();
    for (let i = 0; i < 8; i++) live = economyTick(live, 1, () => 0);
    const log = (st: GameState) => st.completionLog.map((e) => [e.kind, e.reward, e.subjectKey]);
    expect(log(offline)).toEqual([
      ["facilityUpgrade", "level", "salvageBay"],
      ["relicStudy", "relic", "glyphTablet"],
      ["facilityUpgrade", "level", "research"],
    ]);
    expect(log(live)).toEqual(log(offline));
    expect(stateHash(offline)).toBe("2ff5c2d3");
    expect(stateHash(live)).toBe(stateHash(offline));
  });

  // MOVED by ordering determinism part 2 (canonicalOrder.ts), pinned with it ON: same-tick completions are logged by
  // process id, not array position, so the study (proc-1) comes before proc-900 and proc-901. The three entries are the
  // same, only their order and `done-N` numbering moved; one call and 1 s steps still agree.
  it("part 2 on: the log in process id order, the whole state, one call and 1 s steps", () => {
    const [offline, live] = withOrdering2On(() => {
      const once = tick(8, seed(), () => 0);
      let stepped = seed();
      for (let i = 0; i < 8; i++) stepped = economyTick(stepped, 1, () => 0);
      return [once, stepped];
    });
    const log = (st: GameState) => st.completionLog.map((e) => [e.id, e.kind, e.reward, e.subjectKey]);
    expect(log(offline)).toEqual([
      ["done-1", "relicStudy", "relic", "glyphTablet"],
      ["done-2", "facilityUpgrade", "level", "salvageBay"],
      ["done-3", "facilityUpgrade", "level", "research"],
    ]);
    expect(log(live)).toEqual(log(offline));
    expect(stateHash(offline)).toBe("6fdb179f");
    // Order is all it moved: with both orders normalized it is the part 2 off state (pinned 2ff5c2d3 above).
    expect(stateHash(asOrdering2Normalized(offline))).toBe(stateHash(asOrdering2Normalized(tick(8, seed(), () => 0))));
    expect(stateHash(live)).toBe(stateHash(offline));
  });
});

describe("R2-3 golden 4: relic-study lanes per Research Lab level", () => {
  it("levels 0 to 7", () => {
    const lanes = [0, 1, 2, 3, 4, 5, 6, 7].map((level) => relicStudySlotCount({ ...freshState(), facilities: { ...freshState().facilities, research: { level } } }));
    // MOVED by R2-3 (user call 12 "lanes by Lab": I 1, III 2, V 3, VII 4). Levels 0 to 2 (today's top Lab) unchanged;
    // pre-R2-3 every built level read 1.
    expect(lanes).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});
