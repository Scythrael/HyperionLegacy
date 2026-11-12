// gambitEditorDisplay.test.ts: the GO-16 per-member gambit editor's picker and readouts (Ground Operations
// 0.14.0, absorbs E-CREW Task 17's editor).
import { describe, expect, it } from "vitest";
import { DEFAULT_GAMBIT_PROGRAMS, FIELD_KITS_DEFAULT_MEMBER_GAMBIT, freshState } from "./game/model";
import type { AwayMember, Expedition, GameState, ShipGroundTeam } from "./game/model";
import { applyMemberGambitPreset, addMemberGambitRule, setAccountHireDefaultFromMember } from "./game/memberGambits";
import { renameGroundTeam } from "./game/groundTeams";
import {
  HIRE_CLEARED,
  HIRE_NO_PICK,
  HIRE_SET_ALREADY,
  HIRE_SET_SAVED,
  gambitEditorView,
  hireDefaultStatus,
  hireSetRow,
  mergeAddedKindsText,
} from "./gambitEditorDisplay";

function member(id: string, teamType: AwayMember["teamType"], shipId: string | null, name: string): AwayMember {
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
const ground = (security: (string | null)[], science: (string | null)[]): ShipGroundTeam => ({
  kind: "ground",
  security,
  science,
  helpOthers: false,
});

// ship-1: Alpha Ground (Grokk + Ossra Security, Sho Science), Bravo Strike (Tamsin in squad 1, Vela + Ruo in
// squad 2). ship-2: Alpha Survey (no Security squad), Bravo Ground with nobody slotted.
function crew(): GameState {
  const base = freshState();
  const s1 = base.ships[0];
  return {
    ...base,
    ships: [
      {
        ...s1,
        typeKey: "generalFreighter",
        groundTeams: [
          ground(["member-1", "member-2", null], ["member-11", null, null]),
          { kind: "strike", security: ["member-3", null, null, "member-4", "member-5", null], science: [], helpOthers: false },
        ],
      },
      {
        ...s1,
        id: "ship-2",
        name: "Second",
        typeKey: "generalFreighter",
        groundTeams: [
          { kind: "survey", security: [], science: ["member-12", null, null, null, null, null], helpOthers: false },
          ground([null, null, null], [null, null, null]),
        ],
      },
    ],
    awayMembers: [
      member("member-1", "security", "ship-1", "Grokk"),
      member("member-2", "security", "ship-1", "Ossra"),
      member("member-3", "security", "ship-1", "Tamsin"),
      member("member-4", "security", "ship-1", "Vela"),
      member("member-5", "security", "ship-1", "Ruo"),
      member("member-11", "science", "ship-1", "Sho"),
      member("member-12", "science", "ship-2", "Ama"),
    ],
    expeditions: [],
  };
}

const NO_DASHES = (text: string) => !text.includes(String.fromCharCode(0x2014)) && !text.includes("-".repeat(2));

describe("gambitEditorView", () => {
  it("defaults to the first ship, the first team with a Security member, and its first Security member", () => {
    const v = gambitEditorView(crew(), {});
    expect(v.ships.map((s) => s.id)).toEqual(["ship-1", "ship-2"]);
    expect(v.shipId).toBe("ship-1");
    expect(v.teams.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
    expect(v.teamIndex).toBe(0);
    expect(v.squads.map((q) => q.label)).toEqual(["Security squad"]);
    expect(v.squads[0].members.map((m) => m.name)).toEqual(["Grokk", "Ossra"]);
    expect(v.member?.id).toBe("member-1");
    // Field Kits FKR-10 (named move): a default member shows the Field Kits default they fight with once kits are live.
    expect(v.member?.program).toEqual(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
    expect(v.member?.programLabel).toBe("Default");
    expect(v.member?.hasOwn).toBe(false);
  });

  it("uses renamed team names, and splits a Strike team into its two Security squads", () => {
    const s = renameGroundTeam(crew(), "ship-1", 1, "Hammer");
    const v = gambitEditorView(s, { shipId: "ship-1", teamIndex: 1 });
    expect(v.teams[1].name).toBe("Hammer");
    expect(v.squads.map((q) => q.label)).toEqual(["Security squad 1", "Security squad 2"]);
    expect(v.squads[1].members.map((m) => m.name)).toEqual(["Vela", "Ruo"]);
    expect(v.member?.id).toBe("member-3");
  });

  it("keeps a picked member, labels their program, and names the squadmates a copy reaches", () => {
    let s = applyMemberGambitPreset(crew(), "member-5", "decapitate");
    let v = gambitEditorView(s, { shipId: "ship-1", teamIndex: 1, memberId: "member-5" });
    expect(v.member?.id).toBe("member-5");
    expect(v.member?.programLabel).toBe("Decapitate");
    expect(v.member?.presetId).toBe("decapitate");
    expect(v.member?.hasOwn).toBe(true);
    expect(v.member?.squadmates).toEqual(["Vela"]);
    expect(v.member?.copyLabel).toBe("Copy to Security squad 2");
    expect(v.squads[1].members.find((m) => m.id === "member-5")?.programLabel).toBe("Decapitate");
    s = addMemberGambitRule(s, "member-5", { target: "self", action: "hold" });
    v = gambitEditorView(s, { shipId: "ship-1", teamIndex: 1, memberId: "member-5" });
    expect(v.member?.programLabel).toBe("Custom");
    expect(v.member?.presetId).toBeNull();
  });

  it("the copy is off with a reason when every squadmate already runs the program", () => {
    let s = applyMemberGambitPreset(crew(), "member-1", "triage");
    let v = gambitEditorView(s, { shipId: "ship-1", teamIndex: 0, memberId: "member-1" });
    expect(v.member?.copyBlockedText).toBeNull();
    expect(v.member?.copyTargets).toEqual(["Ossra"]);
    s = applyMemberGambitPreset(s, "member-2", "triage");
    v = gambitEditorView(s, { shipId: "ship-1", teamIndex: 0, memberId: "member-1" });
    expect(v.member?.copyBlockedText).toBe("Everyone in this squad already runs it.");
    expect(v.member?.copyTargets).toEqual([]);
    // both on the default
    v = gambitEditorView(crew(), { shipId: "ship-1", teamIndex: 0, memberId: "member-1" });
    expect(v.member?.copyBlockedText).toBe("Everyone in this squad already runs it.");
  });

  it("a lone member has nobody to copy to and says so", () => {
    const v = gambitEditorView(crew(), { shipId: "ship-1", teamIndex: 1, memberId: "member-3" });
    expect(v.member?.squadmates).toEqual([]);
    expect(v.member?.copyLabel).toBe("Copy to squad");
    expect(v.member?.copyBlockedText).toBe("Nobody else is slotted in this squad.");
  });

  it("a member picked from another team falls back to the picked team's first Security member", () => {
    const v = gambitEditorView(crew(), { shipId: "ship-1", teamIndex: 0, memberId: "member-4" });
    expect(v.member?.id).toBe("member-1");
  });

  it("explains a team with no Security squad and a team with nobody slotted", () => {
    const survey = gambitEditorView(crew(), { shipId: "ship-2", teamIndex: 0 });
    expect(survey.member).toBeNull();
    expect(survey.squads).toEqual([]);
    expect(survey.emptyText).toBe("Alpha is a Survey team: it fields no Security squad, so nobody on it fights.");
    const bare = gambitEditorView(crew(), { shipId: "ship-2", teamIndex: 1 });
    expect(bare.member).toBeNull();
    expect(bare.emptyText).toBe("No Security member is slotted in Bravo. Slot one on the ship's Away Team tab.");
  });

  it("with no ship fielding ground teams there is nothing to pick", () => {
    const v = gambitEditorView({ ...crew(), ships: [] }, {});
    expect(v.ships).toEqual([]);
    expect(v.shipId).toBeNull();
    expect(v.member).toBeNull();
    expect(v.emptyText).toBe("No ship fields a ground team yet.");
  });

  it("says a ship on an expedition keeps the programs it launched with", () => {
    const s = crew();
    const out = { ...s, expeditions: [{ id: "exp-1", shipId: "ship-1" } as unknown as Expedition] };
    expect(gambitEditorView(out, {}).launchedText).toBe(
      "This ship is on an expedition: its teams fight with the programs they launched with. Changes apply from the next launch.",
    );
    expect(gambitEditorView(s, {}).launchedText).toBeNull();
  });

  it("a finished run awaiting its claim reads as back, not out on an expedition", () => {
    const s = crew();
    const back = { ...s, expeditions: [{ id: "exp-1", shipId: "ship-1", phase: "complete" } as unknown as Expedition] };
    expect(gambitEditorView(back, {}).launchedText).toBe(
      "This ship is back from an expedition, awaiting its claim. Changes apply from the next launch.",
    );
  });

  it("team and member picks work before any ship is picked (the panel's first state)", () => {
    const v = gambitEditorView(crew(), { teamIndex: 1, memberId: "member-5" });
    expect(v.shipId).toBe("ship-1");
    expect(v.teamIndex).toBe(1);
    expect(v.member?.id).toBe("member-5");
    const nulls = gambitEditorView(crew(), { shipId: null, teamIndex: 1, memberId: "member-4" });
    expect(nulls.teamIndex).toBe(1);
    expect(nulls.member?.id).toBe("member-4");
  });

  it("a ship pick that falls back drops the team pick of the old ship", () => {
    const v = gambitEditorView(crew(), { shipId: "ship-9", teamIndex: 1, memberId: "member-4" });
    expect(v.shipId).toBe("ship-1");
    expect(v.teamIndex).toBe(0);
    expect(v.member?.id).toBe("member-1");
  });

  it("player-facing text has no em dashes or double hyphens", () => {
    const v = gambitEditorView(crew(), { shipId: "ship-2", teamIndex: 0 });
    for (const t of [v.emptyText ?? "", HIRE_SET_ALREADY, HIRE_SET_SAVED, HIRE_CLEARED, HIRE_NO_PICK]) expect(NO_DASHES(t)).toBe(true);
  });
});

// OC-F12 control (user answers 2026-11-12, Option A): the "Set for new hires" row and the "New hires" status line.
describe("OC-F12 new-hire default: the status line and the Set row", () => {
  const statusText = (s: Parameters<typeof hireDefaultStatus>[0]) => {
    const st = hireDefaultStatus(s);
    return `${st.before}${st.bold}${st.after}`;
  };
  const viewOf = (s: GameState, memberId: string) => gambitEditorView(s, { shipId: "ship-1", teamIndex: 0, memberId }).member!;

  it("nothing set: hires start on the built-in default, and a member's program can be set", () => {
    const s = applyMemberGambitPreset(crew(), "member-1", "decapitate");
    expect(hireDefaultStatus(s).set).toBe(false);
    expect(statusText(s)).toBe("New Security hires start on the built-in default.");
    const row = hireSetRow(s, viewOf(s, "member-1"));
    expect(row).toEqual({
      enabled: true,
      warn: false,
      note: "Every Security member you hire from now on starts with a copy of Grokk's program, plus the built-in cure, heal, brace and grenade rules it lacks, placed first. Nobody already hired changes.",
    });
  });

  it("set: the line names the program and the member it came from; the same program reads as already set", () => {
    const s = setAccountHireDefaultFromMember(applyMemberGambitPreset(crew(), "member-1", "decapitate"), "member-1");
    expect(hireDefaultStatus(s).set).toBe(true);
    expect(statusText(s)).toBe("New Security hires start with Decapitate (from Grokk), the built-in support rules first.");
    expect(hireSetRow(s, viewOf(s, "member-1"))).toEqual({ enabled: false, warn: false, note: HIRE_SET_ALREADY });
    // The member gone from the roster: the line drops "from" (it never names a stranger).
    const gone = { ...s, awayMembers: s.awayMembers.filter((m) => m.id !== "member-1") };
    expect(statusText(gone)).toBe("New Security hires start with Decapitate, the built-in support rules first.");
    // A program that is no preset reads as a custom program; one with every support kind adds none, so no "first" clause.
    const own = [
      { target: "allyHasStatus" as const, action: "cure" as const },
      { target: "allyHpBelow" as const, params: { hpThreshold: 0.5 }, action: "aidHeal" as const },
      { target: "selfHpBelow" as const, params: { hpThreshold: 0.25 }, action: "brace" as const },
      { target: "foeLargestGroup" as const, action: "throwGrenade" as const },
      { target: "foeNearest" as const, action: "attack" as const },
    ];
    const full = { ...s, gambitPrograms: { ...s.gambitPrograms, security: own }, gambitDefaultFrom: undefined };
    expect(statusText(full)).toBe("New Security hires start with a custom program.");
    expect(mergeAddedKindsText(own)).toBe("");
  });

  it("a member on the built-in default cannot be set; the note points at Clear once a default is set", () => {
    const s = crew();
    expect(hireSetRow(s, viewOf(s, "member-2"))).toEqual({ enabled: false, warn: false, note: "Ossra runs the built-in default, which new Security hires already start on." });
    const set = setAccountHireDefaultFromMember(applyMemberGambitPreset(s, "member-1", "decapitate"), "member-1");
    expect(hireSetRow(set, viewOf(set, "member-2"))).toEqual({ enabled: false, warn: false, note: "Ossra runs the built-in default. To give new hires the built-in default, use Clear." });
  });

  it("Balanced (user 2026-11-12 \"Treat as no default\"): off with nothing set, a Clear when a default is set", () => {
    const s = applyMemberGambitPreset(crew(), "member-2", "balanced");
    expect(hireSetRow(s, viewOf(s, "member-2")).enabled).toBe(false);
    expect(hireSetRow(s, viewOf(s, "member-2")).note).toBe("Balanced means no default, and none is set: new Security hires start on the built-in default.");
    const set = setAccountHireDefaultFromMember(applyMemberGambitPreset(s, "member-1", "decapitate"), "member-1");
    const row = hireSetRow(set, viewOf(set, "member-2"));
    expect(row).toEqual({ enabled: true, warn: false, note: "Balanced means no default: this clears it, and new Security hires start on the built-in default." });
    const after = setAccountHireDefaultFromMember(set, "member-2");
    expect(statusText(after)).toBe("New Security hires start on the built-in default.");
  });

  it("an empty program warns that hires get only the built-in support rules", () => {
    const s = applyMemberGambitPreset(crew(), "member-1", "custom");
    expect(viewOf(s, "member-1").program).toEqual([]);
    expect(hireSetRow(s, viewOf(s, "member-1"))).toEqual({ enabled: true, warn: true, note: "Hires would get only the built-in cure, heal, brace and grenade rules, and no attack rule." });
    // Before kits are live in runs the built-in default has no grenade rules.
    expect(hireSetRow(s, viewOf(s, "member-1"), false).note).toBe("Hires would get only the built-in cure, heal and brace rules, and no attack rule.");
  });

  it("the Science half is never read: a changed Science program alone sets nothing", () => {
    const s = crew();
    const oldScience = { ...s, gambitPrograms: { security: DEFAULT_GAMBIT_PROGRAMS.security, science: [{ target: "self" as const, action: "hold" as const }] } };
    expect(hireDefaultStatus(oldScience).set).toBe(false);
  });

  it("every line has no em dashes or double hyphens", () => {
    const s = setAccountHireDefaultFromMember(applyMemberGambitPreset(crew(), "member-1", "decapitate"), "member-1");
    for (const id of ["member-1", "member-2"]) expect(NO_DASHES(hireSetRow(s, viewOf(s, id)).note)).toBe(true);
    expect(NO_DASHES(statusText(s))).toBe(true);
  });
});
