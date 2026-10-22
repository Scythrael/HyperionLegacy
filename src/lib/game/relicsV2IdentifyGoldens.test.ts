// Relics v2 R2-3 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-3): the PRE-R2-3 GOLDENS. Tests only, captured on
// the code BEFORE the identification v2 engine edit (on top of R2-2). They pin what a study does today, so R2-3 proves
// what it moves and what it keeps:
//   1. a v1 study over a grid (4 sets x 4 rarities x 8 tokens), started and resolved: museum, first finds, log record.
//   2. v1 studies of tier-stamped and setless blanks (R2-2 tokens): which museum record they land in.
//   3. one tick where a relic study, a Research Lab upgrade and another upgrade complete together: the log order and
//      the whole state, one call and 1 s steps.
//   4. the relic-study lane count per Research Lab level 0 to 7.
// NEVER regenerate these from a later build. A slice that moves one names it and the reason in its commit.

import { describe, it, expect } from "vitest";
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
  it("a Tier II sited blank, a Tier VII setless blank and a Tier I setless blank land in the Tier I record", () => {
    const tokens: RelicVaultToken[] = [
      sited("b-t2", "shipwright", "stellar", { regionTier: 2, cultureId: "culture-t2-3" }),
      { id: "b-t7", tier: "radiant", quality: 0, regionTier: 7, cultureId: "culture-t7-1", source: "completion" },
      { id: "b-t1", tier: "augmented", quality: 0, regionTier: 1, cultureId: "culture-t1-2", source: "shortRange" },
    ];
    const out = tokens.map((t) => studyV1({ ...freshState(), relicVault: [t] }).museumV2);
    expect(out.map((m) => m.general)).toEqual([{ "1": { ancientDriveCoil: 1 } }, { "1": { tectonicKeystone: 1 } }, { "1": { starChartFragment: 1 } }]);
    expect(hash(out)).toBe("f713ac30");
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
});

describe("R2-3 golden 4: relic-study lanes per Research Lab level", () => {
  it("levels 0 to 7", () => {
    const lanes = [0, 1, 2, 3, 4, 5, 6, 7].map((level) => relicStudySlotCount({ ...freshState(), facilities: { ...freshState().facilities, research: { level } } }));
    expect(lanes).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
  });
});
