// OC-15 (complement plan, "Add tiers 3-7 now"; user 2026-10-21 "Build them in 0.14.0"): golden records captured on
// the code BEFORE the Research Lab and Fabricator tier III to VII rungs were added (on top of 04a4cb2). Every pin here
// is the "today" record the rung slice compares against; a pin the slice moves on purpose names the move beside it.
//
//   1. rungs   : the existing rungs of both tracks (Lab 0 and 1, Fabricator 0 to 2), whole, hashed.
//   2. levels  : at every level each track has today (Lab 0 to 2, Fabricator 0 to 3) the slot counts, the
//                researchable blueprint keys and every blueprint's fabricate reason on a save that has researched all.
//   3. top     : the build check of the NEXT rung at today's top level (Lab 2, Fabricator 3) for a rich, high-FA save.
//   4. save    : a save at Lab 2 / Fabricator 3 with a research project and a craft in flight, through serialize,
//                deserialize and ten minutes of economyTick, hashed every minute (in-flight work byte-identical).
//
// MOVED BY the OC-15 rungs, on purpose; every other pin here is unchanged:
//   top:research / top:fabricator   "fully upgraded" -> buildable: the Lab's level 3 and the Fabricator's level 4
//                                   rungs now exist (TOP_BEFORE_OC15 keeps the old record; golden 3 proves the old
//                                   reasons return with the tier rows cut off the tracks, so the new rungs are the
//                                   only cause).
import { describe, expect, it } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
recapFoldsOffForThisFile();
import { GG7_BLUEPRINT_KEYS } from "./gasGiantSpecials.fixture";
// E-MOD EM-8 came after this capture: the Precursor Lens's blueprint, variety and the circuit's recipe held apart.
import { EM8_BLUEPRINT_KEYS, withoutEm8Content } from "./emodEm8Switch.fixture";
import { CP11_BLUEPRINT_KEYS } from "./cp11BlueprintsSwitch.fixture";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, FABRICATOR_FACILITY_KEY, FACILITIES, RESEARCH_FACILITY_KEY, blueprintResearchable, freshState, type GameState } from "./model";
import { canBuildFacilityUpgrade, canFabricate, economyTick, fabricateSlotCount, researchSlotCount, startProcess } from "./tick";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { withPreOc15Tracks } from "./labFabricatorTiers.fixture";
import { EM7_BLUEPRINT_KEYS } from "./emodEm7.fixture";

const GOLDEN: Record<string, unknown> = {
  "rungs:research": "8146c32f",
  "rungs:fabricator": "15f89365",
  levels: "e6e8127",
  "top:research": { ok: true },
  "top:fabricator": { ok: true },
  save: ["1a5d85c2", "45343a9c", "1dcacd16", "2ac86ef9", "d7db168b", "a4a5dfaf", "233cb0d", "3147e2ee", "2143df04", "f3acc625", "e14abac6"],
};

const TOP_BEFORE_OC15 = {
  "top:research": { ok: false, reason: "Research Lab is fully upgraded" },
  "top:fabricator": { ok: false, reason: "Fabricator is fully upgraded" },
};

function pin(key: string, value: unknown): void {
  expect(value, key).toEqual(GOLDEN[key]);
}

const rungJson = (up: (typeof FACILITIES)[string]["upgrades"][number]) => ({
  ...up,
  materials: Object.fromEntries(Object.entries(up.materials).map(([k, v]) => [k, v.toString()])),
  ...(up.credits ? { credits: up.credits.toString() } : {}),
});

function atLevels(research: number, fabricator: number): GameState {
  const s = freshState();
  s.facilities = { ...s.facilities, [RESEARCH_FACILITY_KEY]: { level: research }, [FABRICATOR_FACILITY_KEY]: { level: fabricator } };
  return s;
}

describe("OC-15 golden 1: the existing rungs of both tracks", () => {
  it("Lab rungs 0 and 1, Fabricator rungs 0 to 2, whole", () => {
    pin("rungs:research", hash(FACILITIES[RESEARCH_FACILITY_KEY].upgrades.slice(0, 2).map(rungJson)));
    pin("rungs:fabricator", hash(FACILITIES[FABRICATOR_FACILITY_KEY].upgrades.slice(0, 3).map(rungJson)));
  });
});

describe("OC-15 golden 2: slots, researchable keys and fabricate reasons at today's levels", () => {
  it("Lab 0 to 2 x Fabricator 0 to 3", () => {
    // Merged with G2-4 (0.14.0 integration): its classed drive blueprints (driveClass set, Class II to VII) came after
    // this capture and are held apart, the census precedent; every other key reads as captured. E-MOD EM-7's eight module
    // blueprints (Lab tiers 2 to 4) are held apart the same way.
    // Gas Giant Study GG-7's four blueprints (Lab tiers 3 to 5) likewise, and Complement CP-11's fifteen (tiers 1 to 3).
    const keys = Object.keys(BLUEPRINTS).filter((k) => BLUEPRINTS[k].driveClass === undefined && !EM7_BLUEPRINT_KEYS.has(k) && !GG7_BLUEPRINT_KEYS.has(k) && !EM8_BLUEPRINT_KEYS.has(k) && !CP11_BLUEPRINT_KEYS.has(k)).sort();
    const rows: string[] = [];
    for (let lab = 0; lab <= 2; lab++) {
      for (let fab = 0; fab <= 3; fab++) {
        const s = atLevels(lab, fab);
        const researchable = keys.filter((k) => blueprintResearchable(s, k));
        const all = { ...s, researchedBlueprints: keys };
        const reasons = keys.map((k) => {
          const r = canFabricate(all, k);
          return r.ok ? "ok" : r.reason;
        });
        rows.push(`${lab}/${fab}|${researchSlotCount(s)}|${fabricateSlotCount(s)}|${hash(researchable)}|${hash(reasons)}`);
      }
    }
    pin("levels", hash(rows));
  });
});

describe("OC-15 golden 3: the next rung at today's top level", () => {
  it("Lab 2 and Fabricator 3 on a rich, high Fleet Admiral save", () => {
    const s = { ...atLevels(2, 3), fleetAdminLevel: 40, credits: new Decimal(1e12) };
    pin("top:research", canBuildFacilityUpgrade(s, RESEARCH_FACILITY_KEY));
    pin("top:fabricator", canBuildFacilityUpgrade(s, FABRICATOR_FACILITY_KEY));
  });
  it("the OC-15 tier rows are the only cause of the move (cut off, the old reasons return)", () => {
    const s = { ...atLevels(2, 3), fleetAdminLevel: 40, credits: new Decimal(1e12) };
    withPreOc15Tracks(() => {
      expect(canBuildFacilityUpgrade(s, RESEARCH_FACILITY_KEY)).toEqual(TOP_BEFORE_OC15["top:research"]);
      expect(canBuildFacilityUpgrade(s, FABRICATOR_FACILITY_KEY)).toEqual(TOP_BEFORE_OC15["top:fabricator"]);
    });
  });
});

describe("OC-15 golden 4: in-flight research and craft at today's top levels", () => {
  it("serialize, deserialize, ten minutes of economyTick", () => {
    let s = atLevels(2, 3);
    s = startProcess(s, "researchProject", {}, 300, { type: "unlockBlueprint", key: "frameSegmentBp" }).next;
    s = startProcess(s, "fabricateJob", {}, 240, { type: "addBlank", blueprintKey: "frameSegmentBp" }).next;
    s = migrate(deserialize(serialize(s, 0)) as SaveFile);
    const minutes: string[] = [stateHash(s)];
    for (let m = 1; m <= 10; m++) {
      for (let t = 0; t < 60; t++) s = economyTick(s, 1, () => 0.5);
      minutes.push(stateHash(s));
    }
    pin("save", minutes);
  });
});
