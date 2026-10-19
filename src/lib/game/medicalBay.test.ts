// Ground Operations GO-3: the medical bay's cure-time math and the member perk hook (Stoneskin, the BAY
// half; the in-battle half arrives with Task 16b Field Kits). Pure arithmetic, nothing calls it yet.

import { describe, expect, it } from "vitest";
import { type CrewRace, type MemberPerkId } from "./model";
import {
  BAY_MIN_SECONDS,
  GROUND_CONDITIONS,
  STONESKIN_INJURY_MULT,
  bayCareFrom,
  conditionCureSeconds,
  memberBaySeconds,
  memberPerksFor,
  teamBaySeconds,
  type BayCare,
  type GroundConditionDef,
} from "./medicalBay";
import { CREW_RACE_IDS } from "./crewRaces";
import { snapshotMember } from "./awayTeam";
import { injuryRecoverySeconds } from "./injuries";
import { plainAwayMember } from "./awayTeamTestFixtures";

const NO_CARE: BayCare = { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 };
const STONESKIN: MemberPerkId[] = ["stoneskin"];
const C = GROUND_CONDITIONS;

describe("GROUND_CONDITIONS (user 9b.5 cure times, 1 tick = 1 second)", () => {
  it("holds the approved times and classes", () => {
    const rows = Object.values(C).map((c) => [c.id, c.cls, c.cureSeconds]);
    expect(rows).toEqual([
      ["health", "health", 60],
      ["poison", "ailment", 60],
      ["bleed", "injury", 60],
      ["blindness", "ailment", 60],
      ["neurotoxin", "ailment", 300],
      ["hemorrhage", "injury", 300],
      ["concussion", "injury", 900],
      ["fracture", "injury", 1800],
      // Field Kits FKR-4 (user N11 "30m / 1h / 2h"): the bone line's heavier ranks.
      ["brokenBone", "injury", 3600],
      ["shatteredBone", "injury", 7200],
      ["downed", "injury", 1200],
    ]);
    for (const [key, def] of Object.entries(C)) {
      expect(def.id, key).toBe(key);
      expect(def.label.length, key).toBeGreaterThan(0);
    }
  });

  it("pins the constants", () => {
    expect(STONESKIN_INJURY_MULT).toBe(1.25);
    expect(BAY_MIN_SECONDS).toBe(1);
  });
});

describe("conditionCureSeconds", () => {
  it("is the table time with no care and no perks", () => {
    for (const def of Object.values(C)) expect(conditionCureSeconds(def, [], NO_CARE), def.id).toBe(def.cureSeconds);
  });

  it("Stoneskin lasts 25% longer on INJURIES only (Poison on an Ossir member stays 60)", () => {
    expect(conditionCureSeconds(C.fracture, STONESKIN, NO_CARE)).toBe(2250);
    expect(conditionCureSeconds(C.concussion, STONESKIN, NO_CARE)).toBe(1125);
    expect(conditionCureSeconds(C.bleed, STONESKIN, NO_CARE)).toBe(75);
    expect(conditionCureSeconds(C.downed, STONESKIN, NO_CARE)).toBe(1500);
    expect(conditionCureSeconds(C.poison, STONESKIN, NO_CARE)).toBe(60);
    expect(conditionCureSeconds(C.neurotoxin, STONESKIN, NO_CARE)).toBe(300);
    expect(conditionCureSeconds(C.health, STONESKIN, NO_CARE)).toBe(60);
  });

  it("care divides: a total of 1 halves every condition", () => {
    const shares: BayCare[] = [
      { ...NO_CARE, medicalShare: 1 },
      { ...NO_CARE, rapidRecoveryShare: 1 },
      { ...NO_CARE, officerFacetShare: 1 },
      { ...NO_CARE, medicalShare: 0.5, rapidRecoveryShare: 0.25, officerFacetShare: 0.25 },
    ];
    for (const care of shares) {
      expect(conditionCureSeconds(C.fracture, [], care)).toBe(900);
      expect(conditionCureSeconds(C.poison, [], care)).toBe(30);
      expect(conditionCureSeconds(C.health, [], care)).toBe(30);
    }
    expect(conditionCureSeconds(C.fracture, [], NO_CARE, 1)).toBe(900); // the Injury Kit hook (Task 16b)
  });

  it("injurySteady (Medical Integrity) shortens INJURIES only", () => {
    const care: BayCare = { ...NO_CARE, injurySteady: 1 };
    expect(conditionCureSeconds(C.fracture, [], care)).toBe(900);
    expect(conditionCureSeconds(C.downed, [], care)).toBe(600);
    expect(conditionCureSeconds(C.poison, [], care)).toBe(60);
    expect(conditionCureSeconds(C.neurotoxin, [], care)).toBe(300);
    expect(conditionCureSeconds(C.health, [], care)).toBe(60);
  });

  it("Stoneskin and care compose: 1800 x 1.25 / 2", () => {
    expect(conditionCureSeconds(C.fracture, STONESKIN, { ...NO_CARE, medicalShare: 1 })).toBe(1125);
  });

  it("clamps each share at 0 or more (a negative share never lengthens a cure)", () => {
    const negative: BayCare = { medicalShare: -5, rapidRecoveryShare: -1, officerFacetShare: -2, injurySteady: -3 };
    expect(conditionCureSeconds(C.fracture, [], negative, -4)).toBe(1800);
    expect(conditionCureSeconds(C.fracture, [], { ...negative, medicalShare: 1 })).toBe(900);
  });

  it("rounds to whole seconds and never drops below BAY_MIN_SECONDS (D23: no cap on care)", () => {
    expect(conditionCureSeconds(C.poison, [], { ...NO_CARE, medicalShare: 0.7 })).toBe(Math.round(60 / 1.7));
    expect(conditionCureSeconds(C.poison, [], { ...NO_CARE, medicalShare: 1000 })).toBe(BAY_MIN_SECONDS);
    expect(conditionCureSeconds(C.fracture, [], { ...NO_CARE, medicalShare: 1e9 })).toBe(BAY_MIN_SECONDS);
  });

  it("matches the legacy injury care divisor (injuries.ts) for an injury above the old floor", () => {
    // Legacy folds all three Medical facets into one officerFacetShare (every legacy condition is an injury),
    // summed exactly as injuries.ts applyExpeditionInjuries sums them.
    const ship = { medicalShare: 0.3, rapidRecoveryShare: 0.1 };
    const exp = { recoveryTurnaround: 0.05, quickRecovery: 0.5, injurySteady: 0.02 };
    const legacyFacets = (exp.recoveryTurnaround ?? 0) + (exp.quickRecovery ?? 0) + (exp.injurySteady ?? 0);
    const twoHours: GroundConditionDef = { id: "legacy", label: "Legacy", cls: "injury", cureSeconds: 7200 };
    expect(conditionCureSeconds(twoHours, [], bayCareFrom(ship, exp))).toBe(
      injuryRecoverySeconds({ ...ship, officerFacetShare: legacyFacets }),
    );
  });
});

describe("bayCareFrom (the explicit mapping onto the frozen medical factors)", () => {
  it("maps each field to its source; absent facets read 0", () => {
    expect(bayCareFrom({ medicalShare: 0.2, rapidRecoveryShare: 0.1 }, {})).toEqual({
      medicalShare: 0.2,
      rapidRecoveryShare: 0.1,
      officerFacetShare: 0,
      injurySteady: 0,
    });
    expect(
      bayCareFrom({ medicalShare: 0.2, rapidRecoveryShare: 0.1 }, { recoveryTurnaround: 0.04, quickRecovery: 0.5, injurySteady: 0.03 }),
    ).toEqual({ medicalShare: 0.2, rapidRecoveryShare: 0.1, officerFacetShare: 0.54, injurySteady: 0.03 });
  });
});

describe("memberBaySeconds / teamBaySeconds (all conditions tick down at once: the wait is the longest)", () => {
  it("the mockup's bay (GO-M4): Health 60, Poison 60, Fracture on an Ossir member 2250, Concussion 900 -> 2250", () => {
    const team = [
      { conditionIds: ["health", "poison"], perks: [] as MemberPerkId[] },
      { conditionIds: ["fracture"], perks: STONESKIN },
      { conditionIds: ["concussion"], perks: [] as MemberPerkId[] },
    ];
    expect(team.map((m) => memberBaySeconds(m.conditionIds, m.perks, NO_CARE))).toEqual([60, 2250, 900]);
    expect(teamBaySeconds(team, NO_CARE)).toBe(2250);
  });

  it("1000 ailments and 1 fracture take the fracture's time", () => {
    const ids = [...Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? "poison" : "blindness")), "fracture"];
    expect(memberBaySeconds(ids, [], NO_CARE)).toBe(1800);
  });

  it("no conditions is 0; unknown ids are ignored (0)", () => {
    expect(memberBaySeconds([], [], NO_CARE)).toBe(0);
    expect(memberBaySeconds(["stun", "fear", "toString", "constructor", "__proto__"], STONESKIN, NO_CARE)).toBe(0);
    expect(memberBaySeconds(["stun", "poison"], [], NO_CARE)).toBe(60);
    expect(teamBaySeconds([], NO_CARE)).toBe(0);
    expect(teamBaySeconds([{ conditionIds: [], perks: [] }], NO_CARE)).toBe(0);
  });

  it("a member's own treatmentShare reaches only that member", () => {
    const team = [
      { conditionIds: ["fracture"], perks: [] as MemberPerkId[], treatmentShare: 1 },
      { conditionIds: ["concussion"], perks: [] as MemberPerkId[] },
    ];
    expect(teamBaySeconds(team, NO_CARE)).toBe(900);
    expect(memberBaySeconds(["fracture"], [], NO_CARE, 1)).toBe(900);
  });
});

describe("memberPerksFor (racial physical perks, D24)", () => {
  it("Ossir get Stoneskin; every other race none (the user names the rest later)", () => {
    for (const race of CREW_RACE_IDS) {
      expect(memberPerksFor(race), race).toEqual(race === "ossir" ? ["stoneskin"] : []);
    }
  });

  it("returns a fresh array every call", () => {
    const a = memberPerksFor("ossir");
    a.push("stoneskin");
    expect(memberPerksFor("ossir")).toEqual(["stoneskin"]);
  });
});

describe("snapshotMember freezes perks (Ossir only, so every other snapshot stays deep-equal)", () => {
  const member = (race: CrewRace) => ({ ...plainAwayMember("member-1", "security", "ship-1"), race });

  it("writes perks: ['stoneskin'] for an Ossir member", () => {
    expect(snapshotMember(member("ossir"), []).perks).toEqual(["stoneskin"]);
  });

  it("omits perks for every other race", () => {
    for (const race of CREW_RACE_IDS.filter((r) => r !== "ossir")) {
      expect("perks" in snapshotMember(member(race), []), race).toBe(false);
    }
  });

  it("an Ossir snapshot differs from the human one only by perks", () => {
    const { perks, ...rest } = snapshotMember(member("ossir"), []);
    expect(perks).toEqual(["stoneskin"]);
    expect(rest).toEqual(snapshotMember(member("earthBorn"), []));
  });
});
