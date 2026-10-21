// memberGambits.test.ts: the per-member gambit program actions behind the GO-16 editor (Ground Operations
// 0.14.0, absorbs E-CREW Task 17's editor). Every action is pure and refuses by returning the SAME state.
import { describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_GAMBIT, FIELD_KITS_DEFAULT_MEMBER_GAMBIT, freshState } from "./model";
// Field Kits FKR-10 (named move): once kits are live in runs a default member's first edit copies the Field Kits default they
// fight with (memberGambits.ts memberEditableProgram), not D19's; the snapshot still reads D19's default.
const EDIT_BASE = FIELD_KITS_DEFAULT_MEMBER_GAMBIT;
import type { AwayMember, GambitProgram, GameState, ShipGroundTeam } from "./model";
import { GAMBIT_PRESETS } from "./gambit";
import { snapshotMember } from "./awayTeam";
import {
  addMemberGambitRule,
  applyMemberGambitPreset,
  copyMemberGambitToSquad,
  matchedMemberPreset,
  memberGambitProgram,
  memberHasOwnGambit,
  memberSecuritySquadmates,
  moveMemberGambitRule,
  squadmatesCopyWouldChange,
  removeMemberGambitRule,
  resetMemberGambit,
  setMemberGambitRule,
} from "./memberGambits";

function member(id: string, teamType: AwayMember["teamType"], shipId: string | null, extra: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `M${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
    ...extra,
  };
}
const ground = (security: (string | null)[], science: (string | null)[]): ShipGroundTeam => ({
  kind: "ground",
  security,
  science,
  helpOthers: false,
});

// ship-1 (General Freighter, squads of 3): Alpha Ground with member-1 + member-2 (Security) and member-11
// (Science); Bravo Strike with member-3 in Security squad 1 and member-4 + member-5 in Security squad 2;
// member-6 is Security in the reserve.
function crew(): GameState {
  const base = freshState();
  return {
    ...base,
    ships: [
      {
        ...base.ships[0],
        typeKey: "generalFreighter",
        groundTeams: [
          ground(["member-1", "member-2", null], ["member-11", null, null]),
          { kind: "strike", security: ["member-3", null, null, "member-4", "member-5", null], science: [], helpOthers: false },
        ],
      },
    ],
    awayMembers: [
      member("member-1", "security", "ship-1"),
      member("member-2", "security", "ship-1"),
      member("member-3", "security", "ship-1"),
      member("member-4", "security", "ship-1"),
      member("member-5", "security", "ship-1"),
      member("member-6", "security", "ship-1"),
      member("member-11", "science", "ship-1"),
    ],
    expeditions: [],
  };
}
const byId = (s: GameState, id: string) => s.awayMembers.find((m) => m.id === id) as AwayMember;
const HOLD: GambitProgram = [{ target: "self", action: "hold" }];

describe("memberGambitProgram", () => {
  it("is the member's own program, else the D19 default for Security, else empty", () => {
    expect(memberGambitProgram(member("a", "security", null))).toEqual(DEFAULT_MEMBER_GAMBIT);
    expect(memberGambitProgram(member("a", "security", null, { gambit: HOLD }))).toEqual(HOLD);
    expect(memberGambitProgram(member("a", "science", null))).toEqual([]);
    expect(memberHasOwnGambit(member("a", "security", null))).toBe(false);
    expect(memberHasOwnGambit(member("a", "security", null, { gambit: [] }))).toBe(true);
  });

  it("hands back a copy, never the shared default", () => {
    const p = memberGambitProgram(member("a", "security", null));
    expect(p).not.toBe(DEFAULT_MEMBER_GAMBIT);
    p.push({ target: "self", action: "hold" });
    expect(DEFAULT_MEMBER_GAMBIT.length).toBe(7);
  });
});

describe("rule edits", () => {
  it("SET on a member running the default stores the default with that one rule changed", () => {
    const s = crew();
    const next = setMemberGambitRule(s, "member-1", 0, { target: "foeNearest", action: "attack" });
    const g = byId(next, "member-1").gambit as GambitProgram;
    expect(g.length).toBe(EDIT_BASE.length);
    expect(g[0]).toEqual({ target: "foeNearest", action: "attack" });
    expect(g.slice(1)).toEqual(EDIT_BASE.slice(1));
    // only that member changed; the others keep their references
    expect(byId(next, "member-2")).toBe(byId(s, "member-2"));
    expect(next.ships).toBe(s.ships);
  });

  it("ADD appends, REMOVE drops, MOVE swaps neighbors", () => {
    let s = setMemberGambitRule(crew(), "member-1", 0, { target: "self", action: "hold" });
    s = addMemberGambitRule(s, "member-1", { target: "foeFarthest", action: "suppress" });
    let g = byId(s, "member-1").gambit as GambitProgram;
    expect(g[g.length - 1]).toEqual({ target: "foeFarthest", action: "suppress" });
    s = moveMemberGambitRule(s, "member-1", 0, "down");
    g = byId(s, "member-1").gambit as GambitProgram;
    expect(g[1]).toEqual({ target: "self", action: "hold" });
    s = removeMemberGambitRule(s, "member-1", 1);
    g = byId(s, "member-1").gambit as GambitProgram;
    expect(g.some((r) => r.action === "hold")).toBe(false);
  });

  it("refuses with the same state: unknown member, a Science member, an index out of range, a move off the end, no change", () => {
    const s = crew();
    const rule = { target: "foeNearest", action: "attack" } as const;
    expect(setMemberGambitRule(s, "member-99", 0, rule)).toBe(s);
    expect(setMemberGambitRule(s, "member-11", 0, rule)).toBe(s);
    expect(setMemberGambitRule(s, "member-1", 99, rule)).toBe(s);
    expect(removeMemberGambitRule(s, "member-1", -1)).toBe(s);
    expect(moveMemberGambitRule(s, "member-1", 0, "up")).toBe(s);
    expect(moveMemberGambitRule(s, "member-1", EDIT_BASE.length - 1, "down")).toBe(s);
    expect(addMemberGambitRule(s, "member-11", rule)).toBe(s);
    // setting a rule to what it already is changes nothing
    expect(setMemberGambitRule(s, "member-1", 0, { ...EDIT_BASE[0] })).toBe(s);
  });

  it("stores a deep copy: mutating the passed rule later changes nothing stored", () => {
    const rule = { target: "allyHpBelow" as const, action: "aidHeal" as const, params: { hpThreshold: 0.4 } };
    const next = addMemberGambitRule(crew(), "member-1", rule);
    rule.params.hpThreshold = 0.9;
    const g = byId(next, "member-1").gambit as GambitProgram;
    expect(g[g.length - 1].params?.hpThreshold).toBe(0.4);
  });
});

describe("presets and reset", () => {
  it("applies a preset's Security program to one member", () => {
    const s = crew();
    const next = applyMemberGambitPreset(s, "member-1", "decapitate");
    const decapitate = GAMBIT_PRESETS.find((p) => p.id === "decapitate");
    expect(byId(next, "member-1").gambit).toEqual(decapitate?.programs.security);
    expect(matchedMemberPreset(byId(next, "member-1"))?.title).toBe("Decapitate");
    expect(byId(next, "member-2")).toBe(byId(s, "member-2"));
    // the account pair is never touched
    expect(next.gambitPrograms).toBe(s.gambitPrograms);
  });

  it("refuses an unknown preset, a Science member, and a preset already in place", () => {
    const s = applyMemberGambitPreset(crew(), "member-1", "triage");
    expect(applyMemberGambitPreset(s, "member-1", "nope")).toBe(s);
    expect(applyMemberGambitPreset(s, "member-11", "triage")).toBe(s);
    expect(applyMemberGambitPreset(s, "member-1", "triage")).toBe(s);
  });

  it("Custom stores an empty program (the member holds), distinct from the default", () => {
    const next = applyMemberGambitPreset(crew(), "member-1", "custom");
    expect(byId(next, "member-1").gambit).toEqual([]);
    expect(memberHasOwnGambit(byId(next, "member-1"))).toBe(true);
  });

  it("reset clears the member's own program back to the default, and refuses when already on it", () => {
    const s = applyMemberGambitPreset(crew(), "member-1", "triage");
    const next = resetMemberGambit(s, "member-1");
    expect("gambit" in byId(next, "member-1")).toBe(false);
    expect(memberGambitProgram(byId(next, "member-1"))).toEqual(DEFAULT_MEMBER_GAMBIT);
    expect(resetMemberGambit(next, "member-1")).toBe(next);
  });

  it("matchedMemberPreset is null on the default and on a custom-edited program", () => {
    expect(matchedMemberPreset(byId(crew(), "member-1"))).toBeNull();
    const s = addMemberGambitRule(applyMemberGambitPreset(crew(), "member-1", "triage"), "member-1", { target: "self", action: "hold" });
    expect(matchedMemberPreset(byId(s, "member-1"))).toBeNull();
  });
});

describe("copy to squad", () => {
  it("names the other Security members of the member's own squad, in slot order", () => {
    const s = crew();
    expect(memberSecuritySquadmates(s, "ship-1", "member-1")).toEqual(["member-2"]);
    // a Strike team: squad 1 holds member-3 alone, squad 2 holds member-4 + member-5
    expect(memberSecuritySquadmates(s, "ship-1", "member-3")).toEqual([]);
    expect(memberSecuritySquadmates(s, "ship-1", "member-5")).toEqual(["member-4"]);
    // the reserve, a Science member, an unknown ship: nobody
    expect(memberSecuritySquadmates(s, "ship-1", "member-6")).toEqual([]);
    expect(memberSecuritySquadmates(s, "ship-1", "member-11")).toEqual([]);
    expect(memberSecuritySquadmates(s, "ship-9", "member-1")).toEqual([]);
  });

  it("copies the member's program to each squadmate as its own copy", () => {
    const s = applyMemberGambitPreset(crew(), "member-4", "triage");
    const next = copyMemberGambitToSquad(s, "ship-1", "member-4");
    expect(byId(next, "member-5").gambit).toEqual(byId(s, "member-4").gambit);
    expect(byId(next, "member-5").gambit).not.toBe(byId(next, "member-4").gambit);
    // the other squad and the other team are untouched
    expect(byId(next, "member-3")).toBe(byId(s, "member-3"));
    expect(byId(next, "member-1")).toBe(byId(s, "member-1"));
  });

  it("copying a member on the default puts the squadmates back on the default", () => {
    const s = applyMemberGambitPreset(crew(), "member-2", "triage");
    const next = copyMemberGambitToSquad(s, "ship-1", "member-1");
    expect("gambit" in byId(next, "member-2")).toBe(false);
  });

  it("squadmatesCopyWouldChange names only the squadmates whose program a copy changes", () => {
    let s = applyMemberGambitPreset(crew(), "member-4", "triage");
    expect(squadmatesCopyWouldChange(s, "ship-1", "member-4")).toEqual(["member-5"]);
    s = copyMemberGambitToSquad(s, "ship-1", "member-4");
    expect(squadmatesCopyWouldChange(s, "ship-1", "member-4")).toEqual([]);
    // both on the default: nobody changes
    expect(squadmatesCopyWouldChange(crew(), "ship-1", "member-1")).toEqual([]);
    // a squadmate with their own program changes when the source is on the default
    s = applyMemberGambitPreset(crew(), "member-2", "triage");
    expect(squadmatesCopyWouldChange(s, "ship-1", "member-1")).toEqual(["member-2"]);
  });

  it("refuses with the same state when nobody would change", () => {
    const s = crew();
    expect(copyMemberGambitToSquad(s, "ship-1", "member-1")).toBe(s); // both on the default
    expect(copyMemberGambitToSquad(s, "ship-1", "member-3")).toBe(s); // alone in the squad
    expect(copyMemberGambitToSquad(s, "ship-1", "member-6")).toBe(s); // reserve
    expect(copyMemberGambitToSquad(s, "ship-9", "member-1")).toBe(s);
  });
});

describe("combat reads the edited program", () => {
  it("the dispatch snapshot freezes the member's own program (an edit reaches the next launch only)", () => {
    const s = applyMemberGambitPreset(crew(), "member-1", "decapitate");
    const snap = snapshotMember(byId(s, "member-1"), []);
    const stored = byId(s, "member-1").gambit as GambitProgram;
    expect(snap.gambit).toEqual(stored);
    expect(snap.gambit).not.toBe(stored);
    const frozen = JSON.parse(JSON.stringify(snap.gambit));
    // a later edit (a new rule, a preset, a reset) never reaches the frozen program
    let later = addMemberGambitRule(s, "member-1", { target: "self", action: "hold" });
    later = applyMemberGambitPreset(later, "member-1", "triage");
    later = resetMemberGambit(later, "member-1");
    expect(later).not.toBe(s);
    expect(snap.gambit).toEqual(frozen);
  });
});
