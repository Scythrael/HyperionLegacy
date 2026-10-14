// groundTeamDisplay.test.ts: the Away Team tab's ground team cards and composition picker (GO-11 + SQ-7 7.1).
import { describe, expect, it } from "vitest";
import { freshState } from "./game/model";
import type { AwayMember, GameState, ShipGroundTeam } from "./game/model";
import { setGroundTeamKind, slotMember } from "./game/groundTeams";
import {
  GROUND_TEAMS_INTRO,
  RESERVE_CAP_NOTE,
  RESERVE_INTRO,
  compositionSummary,
  crewRoomText,
  groundTeamsPanelView,
  kindChangeView,
  kindOptionReason,
  nameList,
  overCapacityText,
  slotPickCandidates,
} from "./groundTeamDisplay";

function member(id: string, teamType: AwayMember["teamType"], shipId: string | null, name = `M${id}`): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}
const empty = (): ShipGroundTeam => ({ kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false });

// ship-1 (General Freighter, 3 / 3, 3 reserve berths): Alpha Ground with Grokk + Ossra (Security) and Sho
// (Science); Tamsin (Security) and Vela (Science) in the reserve; Bravo Ground, empty and pending.
function crew(extra: Partial<GameState> = {}): GameState {
  const base = freshState();
  return {
    ...base,
    ships: [
      {
        ...base.ships[0],
        typeKey: "generalFreighter",
        groundTeams: [
          { kind: "ground", security: ["member-1", "member-2", null], science: ["member-11", null, null], helpOthers: false },
          { ...empty(), kindPending: true },
        ],
      },
    ],
    awayMembers: [
      member("member-1", "security", "ship-1", "Grokk"),
      member("member-2", "security", "ship-1", "Ossra"),
      member("member-3", "security", "ship-1", "Tamsin"),
      member("member-11", "science", "ship-1", "Sho"),
      member("member-12", "science", "ship-1", "Vela"),
    ],
    expeditions: [],
    ...extra,
  };
}

const NO_DASHES = (text: string) => !text.includes(String.fromCharCode(0x2014)) && !text.includes("-".repeat(2));

describe("groundTeamsPanelView", () => {
  it("draws one card per team with kind-sized squads, slots in place, and the reserve", () => {
    const v = groundTeamsPanelView(crew(), "ship-1");
    expect(v).not.toBeNull();
    if (v === null) return;
    expect(v.teams.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
    const alpha = v.teams[0];
    expect(alpha.kindLabel).toBe("Ground team");
    expect(alpha.squads.map((q) => q.label)).toEqual(["Security squad", "Science squad"]);
    expect(alpha.squads[0].slots.map((s) => s.member?.name ?? null)).toEqual(["Grokk", "Ossra", null]);
    expect(alpha.squads[0].slots.map((s) => s.slotIndex)).toEqual([0, 1, 2]);
    expect(alpha.deploys).toBe(true);
    expect(v.teams[1].pending).toBe(true);
    expect(v.teams[1].staffed).toBe(false);
    expect(v.reserve.map((m) => m.name)).toEqual(["Tamsin", "Vela"]);
    expect(v.compositionLabel).toBe("Ground + Ground");
    expect(v.pips).toEqual([
      ["security", "science"],
      ["security", "science"],
    ]);
    expect(v.valid).toBe(true);
    expect(v.locked).toBe(false);
    expect(v.lockText).toBeNull();
  });

  it("labels a Strike team's two Security squads by number and flat slot index", () => {
    const s = setGroundTeamKind(crew(), "ship-1", 1, "strike");
    const v = groundTeamsPanelView(s, "ship-1");
    const bravo = v?.teams[1];
    expect(bravo?.squads.map((q) => q.label)).toEqual(["Security squad 1", "Security squad 2"]);
    expect(bravo?.squads[1].slots.map((x) => x.slotIndex)).toEqual([3, 4, 5]);
    expect(bravo?.pending).toBe(false);
  });

  it("refuses the option that would leave no Science squad, with the reason naming the other team", () => {
    const s = setGroundTeamKind(crew(), "ship-1", 0, "strike");
    const bravo = groundTeamsPanelView(s, "ship-1")?.teams[1];
    const strike = bravo?.options.find((o) => o.kind === "strike");
    expect(strike?.disabled).toBe(true);
    expect(strike?.reason).toBe("Strike is off: Alpha is Strike, so the ship would have no Science squad.");
    expect(bravo?.options.filter((o) => o.disabled).map((o) => o.kind)).toEqual(["strike"]);
  });

  it("lists an injured slotted member's wait with the time left (no stand-ins)", () => {
    const base = crew();
    const s: GameState = {
      ...base,
      awayMembers: base.awayMembers.map((m) => (m.id === "member-1" ? { ...m, injuredUntilSeconds: base.gameTimeSeconds + 720 } : m)),
    };
    const alpha = groundTeamsPanelView(s, "ship-1")?.teams[0];
    expect(alpha?.deploys).toBe(false);
    expect(alpha?.waits).toEqual(["Grokk returns to duty in 12m"]);
    expect(alpha?.squads[0].slots[0].readyInSeconds).toBe(720);
  });

  it("is locked with the engine's reason while the ship is out", () => {
    const base = crew();
    const s = { ...base, expeditions: [{ shipId: "ship-1" }] } as unknown as GameState;
    const v = groundTeamsPanelView(s, "ship-1");
    expect(v?.locked).toBe(true);
    expect(v?.lockText).toBe("Ship is out on a mission");
  });

  it("returns null for a ship that is gone", () => {
    expect(groundTeamsPanelView(crew(), "ship-404")).toBeNull();
  });
});

describe("kind change preview", () => {
  it("names who moves to and from the reserve", () => {
    const v = kindChangeView(crew(), "ship-1", 0, "strike");
    expect(v).toEqual({ ok: true, moves: "Sho moves to the reserve. Tamsin joins from the reserve.", overCapacity: null });
  });

  it("says nobody moves when nobody does (Keep Ground on a pending team)", () => {
    const v = kindChangeView(crew(), "ship-1", 1, "ground");
    expect(v).toEqual({ ok: true, moves: "Nobody moves.", overCapacity: null });
  });

  it("shows a direct Strike to Survey switch that overfills the reserve plainly (allowed, no refusal)", () => {
    // Alpha Ground (3 + 3), Bravo Strike (6 Security): 9 Security, 3 Science aboard. Bravo to Survey drops 6
    // Security into the reserve: 6 past the slots for 3 berths.
    const base = freshState();
    const sec = Array.from({ length: 9 }, (_, i) => member(`member-${i + 1}`, "security", "ship-1", `S${i + 1}`));
    const sci = Array.from({ length: 3 }, (_, i) => member(`member-${i + 21}`, "science", "ship-1", `C${i + 1}`));
    const s: GameState = {
      ...base,
      ships: [
        {
          ...base.ships[0],
          typeKey: "generalFreighter",
          groundTeams: [
            { kind: "ground", security: ["member-1", "member-2", "member-3"], science: ["member-21", "member-22", "member-23"], helpOthers: false },
            { kind: "strike", security: ["member-4", "member-5", "member-6", "member-7", "member-8", "member-9"], science: [], helpOthers: false },
          ],
        },
      ],
      awayMembers: [...sec, ...sci],
      expeditions: [],
    };
    const v = kindChangeView(s, "ship-1", 1, "survey");
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.moves).toBe("S4, S5, S6, S7, S8 and S9 move to the reserve.");
    expect(v.overCapacity).toBe(
      "The reserve will be over capacity: 6 members for 3 berths. Nobody has to leave; hiring pauses until it fits again.",
    );
    const after = setGroundTeamKind(s, "ship-1", 1, "survey");
    expect(after).not.toBe(s);
    const view = groundTeamsPanelView(after, "ship-1");
    expect(view?.overCapacity).toBe(true);
    expect(overCapacityText(view!.room)).toContain("Over capacity: 6 members for 3 reserve berths.");
    expect(crewRoomText(view!.room)).toBe("Security 9 / 3 · Science 3 / 9 · Reserve berths 6 / 3");
  });

  it("returns the engine's refusal text for an invalid combo", () => {
    const s = setGroundTeamKind(crew(), "ship-1", 0, "strike");
    expect(kindChangeView(s, "ship-1", 1, "strike")).toEqual({ ok: false, reason: "A ship needs at least one Security squad and one Science squad" });
  });
});

describe("slot picker candidates", () => {
  it("an empty slot offers the reserve of its type only", () => {
    expect(slotPickCandidates(crew(), "ship-1", "security", null, false).map((c) => [c.member.name, c.where])).toEqual([["Tamsin", null]]);
  });

  it("a swap also offers that type's members slotted elsewhere, with where they sit, never the occupant", () => {
    const s = slotMember(crew(), "ship-1", 1, "security", 0, "member-3");
    const list = slotPickCandidates(s, "ship-1", "security", "member-1", true);
    expect(list.map((c) => [c.member.name, c.where])).toEqual([
      ["Ossra", "Alpha, Security squad"],
      ["Tamsin", "Bravo, Security squad"],
    ]);
  });
});

describe("wording", () => {
  it("lists names in plain English", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Sho"])).toBe("Sho");
    expect(nameList(["Sho", "Vela"])).toBe("Sho and Vela");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
  });

  it("summarizes squads with plurals", () => {
    expect(compositionSummary(3, 1)).toBe("3 Security squads, 1 Science squad");
  });

  it("names the other teams when an option is refused", () => {
    expect(kindOptionReason([{ name: "Alpha", kind: "survey" }, { name: "Bravo", kind: "ground" }], 1, "survey")).toBe(
      "Survey is off: Alpha is Survey, so the ship would have no Security squad.",
    );
    expect(kindOptionReason([{ name: "Alpha", kind: "ground" }, { name: "Bravo", kind: "ground" }], 1, "survey")).toBeNull();
  });

  it("says what each squad does on the ground and what the reserve is, with no em dashes", () => {
    expect(GROUND_TEAMS_INTRO).toContain("Security fights during tasks");
    expect(GROUND_TEAMS_INTRO).toContain("Science does the task fieldwork");
    expect(GROUND_TEAMS_INTRO).toContain("Scanning is ship-side");
    expect(RESERVE_INTRO).toContain("do not deploy");
    for (const text of [GROUND_TEAMS_INTRO, RESERVE_INTRO, RESERVE_CAP_NOTE]) expect(NO_DASHES(text)).toBe(true);
  });
});
