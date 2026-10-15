// E-CREW Task 6: the Away Team display helpers (labels, rank emphasis band, ship name, countdown).

import { describe, it, expect } from "vitest";
import { AWAY_TEAM_TYPES, freshState } from "./game/model";
import { AUGMENT_AFFINITY_RACES, canReassignAwayMember, implantSlotsFor, specsFor } from "./game/awayTeam";
import { plainAwayMember } from "./game/awayTeamTestFixtures";
import { AWAY_TRAITS, traitDisplayText } from "./game/awayTraits";
import { CREW_RACE_IDS } from "./game/crewRaces";
import { CREW_RANK_ORDER } from "./game/crewRank";
import { ICON_NAMES } from "./ui/icons";
import { SCIENCE_SPEC_POIS } from "./game/fieldwork";
import { getPoiById } from "./game/expeditionContent";
import {
  SQUAD_META,
  awaySpecLabel,
  rankTier,
  awayShipName,
  awayCountdownText,
  awayRaceLabel,
  awayTargetLabel,
  pickedMoveTarget,
  awaySpecDescription,
  AUGMENT_AFFINITY_TEXT,
  UNIQUE_TAG_TEXT,
  RANK_TEXT,
  UNASSIGNED_INTRO,
  unassignedMembersView,
  crewLockText,
  awayGateText,
} from "./awayTeamDisplay";
import { memberFitReasonText } from "./awayGearDisplay";

describe("awayTeamDisplay", () => {
  it("labels every squad type with a real icon, and every spec", () => {
    for (const t of AWAY_TEAM_TYPES) {
      const meta = SQUAD_META[t];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.role.length).toBeGreaterThan(0);
      expect(ICON_NAMES).toContain(meta.icon);
      for (const spec of specsFor(t)) expect(awaySpecLabel(spec)).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("bands ranks lo / mid / hi with the top two ranks as the rare find", () => {
    expect(CREW_RANK_ORDER.map(rankTier)).toEqual(["lo", "lo", "lo", "mid", "mid", "mid", "hi", "hi"]);
  });

  it("names a ship by its custom name, else its hull label", () => {
    const ship = freshState().ships[0];
    expect(awayShipName({ ...ship, name: "Aurora Prime" })).toBe("Aurora Prime");
    expect(awayShipName({ ...ship, name: undefined })).toBe("General Freighter");
    expect(awayTargetLabel({ ...ship, name: "Aurora Prime" }, "science")).toBe("Aurora Prime · Science");
  });

  it("labels a race from the catalog", () => {
    expect(awayRaceLabel("stheni")).toBe("Stheni");
    expect(awayRaceLabel("earthBorn")).toBe("Earth-born");
  });

  it("returns the picked move target only while the move would go through", () => {
    const targets = [
      { shipId: "ship-a", gate: { ok: true } },
      { shipId: "ship-b", gate: { ok: false } },
    ];
    expect(pickedMoveTarget(targets, "ship-a")).toBe(targets[0]);
    expect(pickedMoveTarget(targets, "ship-b")).toBeNull();
    expect(pickedMoveTarget(targets, "ship-gone")).toBeNull();
    expect(pickedMoveTarget(targets, "")).toBeNull();
    expect(pickedMoveTarget(targets, undefined)).toBeNull();
  });

  it("renders a countdown in s / m / h m, rounding minutes up", () => {
    expect(awayCountdownText(0)).toBe("0s");
    expect(awayCountdownText(-5)).toBe("0s");
    expect(awayCountdownText(35)).toBe("35s");
    expect(awayCountdownText(60)).toBe("1m");
    expect(awayCountdownText(61)).toBe("2m");
    expect(awayCountdownText(41 * 60)).toBe("41m");
    expect(awayCountdownText(3600)).toBe("1h");
    expect(awayCountdownText(3600 + 12 * 60)).toBe("1h 12m");
  });
});

// The chip tooltips (hover / tap / focus) on the member and candidate cards.
describe("awayTeamDisplay chip explanations", () => {
  const EM_DASH = String.fromCharCode(0x2014);
  // Player text rules: a sentence, no em dash, no "--" stand-in.
  function expectCleanSentence(text: string): void {
    expect(text.trim().length).toBeGreaterThan(10);
    expect(text).toMatch(/^[A-Z]/);
    expect(text.endsWith(".")).toBe(true);
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toContain("--");
  }

  it("describes every spec of every squad type, with no invented numbers", () => {
    // The Record is exhaustive at compile time; this walks the runtime spec sets too, so a spec the
    // roll can produce always has a line.
    let n = 0;
    for (const t of AWAY_TEAM_TYPES) {
      for (const spec of specsFor(t)) {
        const text = awaySpecDescription(spec);
        expectCleanSentence(text);
        // No hand-typed figure: a number here would go stale on the next tuning pass.
        expect(text).not.toMatch(/[0-9]/);
        n++;
      }
    }
    expect(n).toBe(7);
  });

  it("names the right squad in each spec line", () => {
    for (const spec of specsFor("security")) expect(awaySpecDescription(spec)).toMatch(/^Security specialty/);
    for (const spec of specsFor("science")) expect(awaySpecDescription(spec)).toMatch(/^Science specialty/);
  });

  it("says what each Science spec now does: a bigger haul at the PoIs fieldwork maps to it (Task 15)", () => {
    for (const spec of specsFor("science")) {
      const text = awaySpecDescription(spec);
      expect(text).not.toMatch(/yet/);
      expect(text).toMatch(/bigger haul/);
      // Every favored PoI is named by its catalog label, so the line can never drift from the mapping.
      for (const poi of SCIENCE_SPEC_POIS[spec as keyof typeof SCIENCE_SPEC_POIS]) {
        expect(text.toLowerCase()).toContain(getPoiById(poi)!.label.toLowerCase());
      }
    }
  });

  it("states the augment-affinity slot counts the engine actually grants", () => {
    expectCleanSentence(AUGMENT_AFFINITY_TEXT);
    const aff = CREW_RACE_IDS.find((r) => AUGMENT_AFFINITY_RACES.has(r));
    const plain = CREW_RACE_IDS.find((r) => !AUGMENT_AFFINITY_RACES.has(r));
    expect(aff).toBeDefined();
    expect(plain).toBeDefined();
    const withAff = implantSlotsFor({ race: aff! });
    const without = implantSlotsFor({ race: plain! });
    expect(withAff).toBeGreaterThan(without);
    expect(AUGMENT_AFFINITY_TEXT).toContain(`${withAff} implant slots instead of ${without}`);
    // Only those two figures appear.
    expect((AUGMENT_AFFINITY_TEXT.match(/[0-9]+/g) ?? []).sort()).toEqual([String(withAff), String(without)].sort());
  });

  it("explains the Unique tag and the rank label without numbers", () => {
    for (const text of [UNIQUE_TAG_TEXT, RANK_TEXT]) {
      expectCleanSentence(text);
      expect(text).not.toMatch(/[0-9]/);
    }
    expect(UNIQUE_TAG_TEXT).toMatch(/whole fleet/);
    expect(RANK_TEXT).toMatch(/never changes/);
    // US English + the install vocabulary rule.
    for (const text of [UNIQUE_TAG_TEXT, RANK_TEXT, AUGMENT_AFFINITY_TEXT]) expect(text).not.toMatch(/fit/i);
  });

  it("gives every trait chip a non-empty tooltip line", () => {
    for (const trait of AWAY_TRAITS) expectCleanSentence(traitDisplayText(trait));
  });
});

// CP-6: the Unassigned list (away members with no ship, e.g. released by a hull salvage) on the Away Team tab.
describe("unassignedMembersView (CP-6)", () => {
  const withMembers = () => {
    const base = freshState();
    return {
      ...base,
      awayMembers: [
        plainAwayMember("member-1", "security", "ship-1"),
        { ...plainAwayMember("member-2", "science", "ship-1"), assignedShipId: null },
        { ...plainAwayMember("member-3", "security", "ship-1"), assignedShipId: null },
      ],
    };
  };

  it("lists exactly the members with no ship, in roster order, with this ship's move gate and the fire gate", () => {
    const s = withMembers();
    const view = unassignedMembersView(s, "ship-1");
    expect(view.map((v) => v.member.id)).toEqual(["member-2", "member-3"]);
    for (const v of view) {
      expect(v.join).toEqual(canReassignAwayMember(s, v.member.id, "ship-1"));
      expect(v.fire).toEqual({ ok: true });
    }
  });

  it("is empty when everyone has a ship, and the intro reads cleanly", () => {
    expect(unassignedMembersView(freshState(), "ship-1")).toEqual([]);
    expect(UNASSIGNED_INTRO).toMatch(/^[A-Z].{10,}\.$/);
    expect(UNASSIGNED_INTRO).not.toContain(String.fromCharCode(0x2014));
    expect(UNASSIGNED_INTRO).not.toContain("--");
  });
});

// CP-6 review: an Unassigned card names the real lock (expedition vs captain mission), not always "mission".
describe("crewLockText (CP-6 review)", () => {
  const benched = () => {
    const base = freshState();
    return { ...base, awayMembers: [{ ...plainAwayMember("member-2", "science", "ship-1"), assignedShipId: null }] };
  };

  it("an expedition reads as an expedition; a captain mission as a mission; a free ship has none", () => {
    const s = benched();
    expect(crewLockText(s, "ship-1")).toBeNull();
    const onExp = { ...s, expeditions: [{ id: "expedition-1", shipId: "ship-1" } as any] };
    expect(crewLockText(onExp, "ship-1")).toBe("Ship is on an expedition");
    expect(unassignedMembersView(onExp, "ship-1")[0].joinText).toBe("Ship is on an expedition");
    const flying = { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: { kind: "extraction" } as any } : c)) };
    expect(crewLockText(flying, "ship-1")).toBe("Ship is out on a mission");
    expect(unassignedMembersView(flying, "ship-1")[0].joinText).toBe("Ship is out on a mission");
    expect(unassignedMembersView(s, "ship-1")[0].joinText).toBeUndefined();
  });
});

// CP-6: every away-crew refusal names the real lock for the ships it involves (not always "mission").
describe("awayGateText + memberFitReasonText name the real lock (CP-6)", () => {
  it("an onMission gate reads the first locked ship's cause; other reasons keep their text", () => {
    const base = freshState();
    const s = { ...base, awayMembers: [plainAwayMember("member-1", "security", "ship-1")], expeditions: [{ id: "expedition-1", shipId: "ship-1" } as any] };
    expect(awayGateText(s, { ok: false, reason: "onMission" }, [null, "ship-1"])).toBe("Ship is on an expedition");
    expect(awayGateText(s, { ok: false, reason: "squadFull" }, ["ship-1"])).toBe("No open slot or reserve berth");
    expect(awayGateText(s, { ok: true }, ["ship-1"])).toBeUndefined();
    expect(awayGateText(base, { ok: false, reason: "onMission" }, ["ship-1"])).toBe("Ship is out on a mission"); // fallback
    expect(memberFitReasonText(s, "any", "onMission", "member-1")).toBe("Ship is on an expedition");
  });
});
