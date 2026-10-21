// gambitEditorFieldKits.test.ts: the gambit editor's Field Kits pass (FKR-10): the kit picker, Throw Grenade, "Ally:
// downed", the rank conditions, the "Keep N for a Boss" stepper, the Field Kits conditions with their severity, the
// rule hints, the Field Kits default shown (and copied on a first edit), and the label tables' exhaustiveness.
import { describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_GAMBIT, FIELD_KITS_DEFAULT_MEMBER_GAMBIT, freshState, type AwayMember, type GambitActionId, type GambitTargetSelector, type GameState } from "./game/model";
import { GAMBIT_STATUSES, isActionLegalForRole } from "./game/gambit";
import { FIELD_KIT_IDS, FIELD_KIT_STATUS_IDS } from "./game/fieldKits";
import { memberEditableProgram, memberGambitProgram, setMemberGambitRule } from "./game/memberGambits";
import {
  ACTION_LABEL,
  DEFAULT_RULE_KIT,
  KIT_OPTIONS,
  RANK_OPTIONS,
  SELECTOR_LABEL,
  defaultProgramText,
  editorActions,
  editorSelectorGroups,
  editorStatuses,
  installedGrenadeName,
  normalizeEditorRule,
  ruleHints,
  ruleNeedsKit,
  ruleTakesRank,
  ruleTakesReserve,
  statusOptionLabel,
} from "./gambitEditorDisplay";

const ALL_ACTIONS = Object.keys(ACTION_LABEL) as GambitActionId[];

describe("label tables and offered lists", () => {
  it("every offered selector and action has a label; the lists only offer what Security may do", () => {
    for (const live of [false, true]) {
      for (const g of editorSelectorGroups(live)) for (const id of g.ids) expect(SELECTOR_LABEL[id], id).toBeTruthy();
      for (const a of editorActions(live)) {
        expect(ACTION_LABEL[a], a).toBeTruthy();
        expect(isActionLegalForRole("security", a), a).toBe(true);
      }
    }
    expect(ALL_ACTIONS).toContain("flashGrenade");
    expect(editorActions(true)).not.toContain("flashGrenade");
  });

  it("the Field Kits pieces are offered only once kits are live in runs", () => {
    const sel = (live: boolean) => editorSelectorGroups(live).flatMap((g) => g.ids as GambitTargetSelector[]);
    expect(sel(false)).not.toContain("allyDowned");
    expect(sel(true)).toContain("allyDowned");
    expect(editorActions(false)).not.toContain("throwGrenade");
    expect(editorActions(true)).toContain("throwGrenade");
    expect(editorActions(true).indexOf("throwGrenade")).toBe(editorActions(true).indexOf("useItem") + 1);
    for (const id of FIELD_KIT_STATUS_IDS) {
      expect(editorStatuses(false)).not.toContain(id);
      expect(editorStatuses(true)).toContain(id);
    }
    expect(editorStatuses(true).length).toBe(Object.keys(GAMBIT_STATUSES).length);
  });

  it("the bone line reads its severity; every other status its plain label", () => {
    expect(statusOptionLabel("fracture")).toBe("Fracture (severity 1 of 3)");
    expect(statusOptionLabel("brokenBone")).toBe("Broken Bone (severity 2 of 3)");
    expect(statusOptionLabel("shatteredBone")).toBe("Shattered Bone (severity 3 of 3)");
    expect(statusOptionLabel("hemorrhage")).toBe("Hemorrhage");
    expect(statusOptionLabel("poison")).toBe("Poison");
  });

  it("the kit and rank pickers", () => {
    expect(KIT_OPTIONS.map((k) => k.id)).toEqual(FIELD_KIT_IDS);
    expect(DEFAULT_RULE_KIT).toBe("firstAidKit");
    expect(RANK_OPTIONS.map((r) => r.label)).toEqual(["Any rank", "Target is Elite or stronger", "Target is a Boss"]);
  });
});

describe("normalizeEditorRule", () => {
  it("keeps the kit on a Use Item, the rank on a foe target and a reserve of 1 or more on a spending rule", () => {
    expect(normalizeEditorRule({ target: "allyHasStatus", action: "useItem", params: { kitId: "splint", statusId: "fracture" } }, true)).toEqual({
      target: "allyHasStatus",
      action: "useItem",
      params: { statusId: "fracture", kitId: "splint" },
    });
    expect(normalizeEditorRule({ target: "foeLargestGroup", action: "throwGrenade", params: { minRank: "elite", reserveForBoss: 2 } }, true)).toEqual({
      target: "foeLargestGroup",
      action: "throwGrenade",
      params: { minRank: "elite", reserveForBoss: 2 },
    });
  });

  it("drops what the rule no longer reads", () => {
    // An ally target cannot be ranked; an attack spends nothing; a 0 reserve is none; Attack takes no kit.
    expect(normalizeEditorRule({ target: "allyLowestHp", action: "attack", params: { minRank: "boss", reserveForBoss: 1, kitId: "splint" } }, true)).toEqual({
      target: "allyLowestHp",
      action: "attack",
    });
    expect(normalizeEditorRule({ target: "foeNearest", action: "throwGrenade", params: { reserveForBoss: 0 } }, true)).toEqual({ target: "foeNearest", action: "throwGrenade" });
    // While kits are off, the Field Kits params never stick (the editor never offered them).
    expect(normalizeEditorRule({ target: "foeNearest", action: "useItem", params: { minRank: "elite", kitId: "splint" } }, false)).toEqual({ target: "foeNearest", action: "useItem" });
  });

  it("the predicates", () => {
    expect(ruleNeedsKit({ action: "useItem" }, true)).toBe(true);
    expect(ruleNeedsKit({ action: "useItem" }, false)).toBe(false);
    expect(ruleTakesRank({ target: "foeHighestThreat" }, true)).toBe(true);
    expect(ruleTakesRank({ target: "self" }, true)).toBe(false);
    expect(ruleTakesReserve({ action: "throwGrenade" }, true)).toBe(true);
    expect(ruleTakesReserve({ action: "attack" }, true)).toBe(false);
  });
});

describe("rule hints", () => {
  const plain = { medic: false, grenade: "Impact Grenade" };
  it("an Advanced Medical kit fires only for a medic; a throw skips without a charge", () => {
    expect(ruleHints({ target: "allyDowned", action: "useItem", params: { kitId: "injuryKit" } }, plain, true)).toEqual([
      "Fires only for a member with Medical Training.",
      "Skips when no kit of that kind is left.",
    ]);
    expect(ruleHints({ target: "allyDowned", action: "useItem", params: { kitId: "injuryKit" } }, { medic: true, grenade: null }, true)).toEqual(["Skips when no kit of that kind is left."]);
    expect(ruleHints({ target: "foeLargestGroup", action: "throwGrenade" }, plain, true)).toEqual(["Skips when no charge is left, or after this battle's throw."]);
    expect(ruleHints({ target: "foeLargestGroup", action: "throwGrenade" }, { medic: false, grenade: null }, true)).toEqual([
      "No grenade installed in the Tool slot: this rule never fires.",
    ]);
    expect(ruleHints({ target: "allyDowned", action: "aidHeal" }, plain, true)).toEqual(["Ally: downed fires only for Use Item (the Injury Kit's target)."]);
    expect(ruleHints({ target: "foeNearest", action: "attack" }, plain, true)).toEqual([]);
    expect(ruleHints({ target: "foeLargestGroup", action: "throwGrenade" }, plain, false)).toEqual([]);
  });

  it("the default program's words name the grenade rules once kits are live", () => {
    expect(defaultProgramText(false)).toBe("full targeting, attack and defense, no automatic kit use");
    expect(defaultProgramText(true)).toMatch(/grenades at the largest group \(one charge kept for an Elite or a Boss\)/);
  });
});

describe("the editable program (FKR-10 shows the Field Kits default)", () => {
  const m = (gambit?: AwayMember["gambit"]): Pick<AwayMember, "gambit" | "teamType"> => ({ teamType: "security", ...(gambit ? { gambit } : {}) });

  it("a member on the default edits the Field Kits default once kits are live; their own program is theirs", () => {
    expect(memberEditableProgram(m(), true)).toEqual(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
    expect(memberEditableProgram(m(), false)).toEqual(DEFAULT_MEMBER_GAMBIT);
    const own = [{ target: "self" as const, action: "hold" as const }];
    expect(memberEditableProgram(m(own), true)).toEqual(own);
    // The snapshot's program is untouched: still D19's default.
    expect(memberGambitProgram(m())).toEqual(DEFAULT_MEMBER_GAMBIT);
    expect(memberEditableProgram({ teamType: "science" }, true)).toEqual([]);
  });

  it("the grenade the member has installed", () => {
    const s: GameState = freshState();
    expect(installedGrenadeName(s, "member-1")).toBeNull();
    const withGrenade = {
      ...s,
      equipment: [...s.equipment, { ...s.equipment[0], id: "g1", slotType: "memberTool" as const, moduleVariant: "stunGrenade", fittedToShipId: null, fittedToMemberId: "member-1" }],
    };
    expect(installedGrenadeName(withGrenade, "member-1")).toBe("Stun Grenade");
  });

  it("a first edit of a default member keeps the program they fight with (no rule silently lost)", () => {
    const base = freshState();
    const s: GameState = { ...base, awayMembers: [{ id: "member-1", teamType: "security", spec: "offense", name: "Grokk", race: "earthBorn", gender: "female", rank: 1, traits: [], assignedShipId: "ship-1" }] };
    const program = memberEditableProgram(s.awayMembers[0]);
    const next = setMemberGambitRule(s, "member-1", program.length - 1, { target: "foeLowestHp", action: "attack" });
    const stored = next.awayMembers[0].gambit!;
    expect(stored.length).toBe(program.length);
    expect(stored.slice(0, -1)).toEqual(program.slice(0, -1));
  });
});
