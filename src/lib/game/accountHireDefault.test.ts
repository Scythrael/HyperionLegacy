// accountHireDefault.test.ts: OC-F12's control (user answers 2026-11-12 on docs/mockups/2026-11-11-account-default-control-mockup.html):
// "Option A (Recommended)", a "Set for new hires" row on a member's program plus a status line with Clear; Balanced
// "Treat as no default (Recommended)"; Clear "Security only (Recommended)". The two actions are pure, refuse by returning
// the SAME state, write only the account pair's Security half (and the optional gambitDefaultFrom), and reach only members
// hired after them (awayTeam.ts accountProgramForHire, merged with the built-in support rules).
import { describe, expect, it } from "vitest";
import { DEFAULT_GAMBIT_PROGRAMS, freshState, type GambitProgram, type GameState } from "./model";
import { gambitPresetPrograms } from "./gambit";
import { awayRecruitCandidates, hireAwayMember } from "./awayTeam";
import {
  accountHireDefaultSet,
  applyMemberGambitPreset,
  clearAccountHireDefault,
  mergeWithBuiltInDefault,
  setAccountHireDefaultFromMember,
} from "./memberGambits";
import { deserialize, migrate, serialize } from "./save";
import { WIRING_SCIENCE_ID, WIRING_SECURITY_ID, WIRING_SHIP_ID, readProbe, withAwayTeam, wiringBase } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { withWr10Off } from "./wr10Switch.fixture";

const DECAPITATE = gambitPresetPrograms("decapitate")!.security;
const SCIENCE_KEPT: GambitProgram = [{ target: "self", action: "hold" }];

// The wiring base with one Security member (member-901) and one Science member (member-902) on ship-1.
function crew(): GameState {
  return withAwayTeam(wiringBase());
}

// The program the next Security hire starts with of its own (undefined = the built-in default).
function nextHireProgram(s: GameState): GambitProgram | undefined {
  const candidate = awayRecruitCandidates(s).find((c) => c.teamType === "security");
  if (!candidate) throw new Error("no Security candidate");
  const hired = hireAwayMember(s, candidate.id, WIRING_SHIP_ID);
  const m = hired.awayMembers.find((x) => x.hiredFrom === candidate.id);
  if (!m) throw new Error("the hire was refused");
  return m.gambit;
}

describe("OC-F12 Set for new hires", () => {
  it("a hire after Set starts with a merged copy of the member's program; nobody already hired changes", () => {
    const s = applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "decapitate");
    expect(nextHireProgram(s)).toBeUndefined();
    const set = setAccountHireDefaultFromMember(s, WIRING_SECURITY_ID);
    expect(set).not.toBe(s);
    expect(accountHireDefaultSet(set)).toBe(true);
    expect(set.gambitPrograms.security).toEqual(DECAPITATE);
    expect(set.gambitDefaultFrom).toBe(WIRING_SECURITY_ID);
    expect(nextHireProgram(set)).toEqual(mergeWithBuiltInDefault(DECAPITATE));
    // Existing members, ships and runs are the same objects.
    expect(set.awayMembers).toBe(s.awayMembers);
    expect(set.ships).toBe(s.ships);
    expect(set.expeditions).toBe(s.expeditions);
    // The stored copy is the player's own: editing the member later never moves it.
    const edited = applyMemberGambitPreset(set, WIRING_SECURITY_ID, "triage");
    expect(edited.gambitPrograms.security).toEqual(DECAPITATE);
  });

  it("refuses (same state) for an unknown member, a Science member, a member on the built-in default, and the stored program again", () => {
    const s = crew();
    expect(setAccountHireDefaultFromMember(s, "member-nobody")).toBe(s);
    expect(setAccountHireDefaultFromMember(s, WIRING_SCIENCE_ID)).toBe(s);
    expect(setAccountHireDefaultFromMember(s, WIRING_SECURITY_ID)).toBe(s);
    const set = setAccountHireDefaultFromMember(applyMemberGambitPreset(s, WIRING_SECURITY_ID, "decapitate"), WIRING_SECURITY_ID);
    expect(setAccountHireDefaultFromMember(set, WIRING_SECURITY_ID)).toBe(set);
  });

  it("Balanced (\"Treat as no default\"): setting it clears the default, and with nothing set it changes nothing", () => {
    const balanced = applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "balanced");
    expect(setAccountHireDefaultFromMember(balanced, WIRING_SECURITY_ID)).toBe(balanced);
    const set = setAccountHireDefaultFromMember(applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "decapitate"), WIRING_SECURITY_ID);
    const toBalanced = applyMemberGambitPreset(set, WIRING_SECURITY_ID, "balanced");
    const after = setAccountHireDefaultFromMember(toBalanced, WIRING_SECURITY_ID);
    expect(accountHireDefaultSet(after)).toBe(false);
    expect(after.gambitPrograms.security).toEqual(DEFAULT_GAMBIT_PROGRAMS.security);
    expect("gambitDefaultFrom" in after).toBe(false);
    expect(nextHireProgram(after)).toBeUndefined();
  });

  it("an empty program can be set: hires get only the built-in support rules", () => {
    const s = setAccountHireDefaultFromMember(applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "custom"), WIRING_SECURITY_ID);
    expect(s.gambitPrograms.security).toEqual([]);
    expect(nextHireProgram(s)!.some((r) => r.action === "attack")).toBe(false);
  });
});

describe("OC-F12 Clear (\"Security only\")", () => {
  it("clears the Security half only: a hire after Clear starts on the built-in default; the Science half stays", () => {
    const s0 = applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "decapitate");
    const s = { ...s0, gambitPrograms: { ...s0.gambitPrograms, science: SCIENCE_KEPT } };
    const set = setAccountHireDefaultFromMember(s, WIRING_SECURITY_ID);
    const cleared = clearAccountHireDefault(set);
    expect(accountHireDefaultSet(cleared)).toBe(false);
    expect(cleared.gambitPrograms.security).toEqual(DEFAULT_GAMBIT_PROGRAMS.security);
    expect(cleared.gambitPrograms.science).toBe(SCIENCE_KEPT);
    expect("gambitDefaultFrom" in cleared).toBe(false);
    expect(nextHireProgram(cleared)).toBeUndefined();
    expect(cleared.awayMembers).toBe(set.awayMembers);
    // Nothing set: Clear refuses.
    expect(clearAccountHireDefault(cleared)).toBe(cleared);
    expect(clearAccountHireDefault(freshState())).toEqual(freshState());
  });

  it("clears a pair set before the control (no gambitDefaultFrom)", () => {
    const old = { ...crew(), gambitPrograms: { security: DECAPITATE, science: [] } };
    expect(accountHireDefaultSet(old)).toBe(true);
    expect(accountHireDefaultSet(clearAccountHireDefault(old))).toBe(false);
  });
});

describe("OC-F12 determinism and the save", () => {
  it("the same actions give the same state, and Set then Clear survives a save round trip", () => {
    const run = () => setAccountHireDefaultFromMember(applyMemberGambitPreset(crew(), WIRING_SECURITY_ID, "decapitate"), WIRING_SECURITY_ID);
    expect(run()).toEqual(run());
    const loaded = migrate(deserialize(serialize(run(), 1, 2))!);
    expect(loaded.gambitPrograms.security).toEqual(DECAPITATE);
    expect(loaded.gambitDefaultFrom).toBe(WIRING_SECURITY_ID);
    expect(nextHireProgram(loaded)).toEqual(mergeWithBuiltInDefault(DECAPITATE));
    const clearedLoaded = migrate(deserialize(serialize(clearAccountHireDefault(run()), 1, 2))!);
    expect(accountHireDefaultSet(clearedLoaded)).toBe(false);
    expect(clearedLoaded.gambitDefaultFrom).toBeUndefined();
  });
});

describe("OC-F12 registry row", () => {
  it("away:audit:accountDefaultControl is live and its probe reads 1 on the wiring base", () => {
    const row = WIRING_REGISTRY.find((e) => e.id === "away:audit:accountDefaultControl")!;
    expect(row.status.kind).toBe("live");
    expect(row.probe).toBe("content:ocf12:accountDefaultControl");
    expect(readProbe(row.probe!, wiringBase(), "ground")).toBe(1);
    // Honest: with the hire read switched off (no hire takes the account program) the probe reads 0.
    expect(withWr10Off(() => readProbe(row.probe!, wiringBase(), "ground"))).toBe(0);
  });
});
