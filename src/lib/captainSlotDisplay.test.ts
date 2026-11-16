// FR-C R3: a locked captain slot names its unlock requirements (talent, Admin Points, Fleet Admiral level).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HOMEWORLD_TALENTS, MAX_UNLOCKABLE_CAPTAINS } from "./game/model";
import { lockedCaptainSlotRequirement } from "./captainSlotDisplay";

describe("lockedCaptainSlotRequirement", () => {
  it("each unlockable slot names its talent, its Admin Point cost and its level wall, read from the table", () => {
    for (let n = 2; n <= MAX_UNLOCKABLE_CAPTAINS; n++) {
      const r = lockedCaptainSlotRequirement(n)!;
      expect(r, `captain ${n}`).not.toBeNull();
      const def = HOMEWORLD_TALENTS[r.talentKey];
      expect(def.effect.type).toBe("unlockCaptainSlot");
      expect(r.text).toContain(def.label);
      expect(r.text).toContain(`${def.cost} Admin Point`);
      if (def.requiresFleetAdminLevel !== undefined) expect(r.text).toContain(`Fleet Admiral level ${def.requiresFleetAdminLevel}`);
      else expect(r.text).not.toContain("Fleet Admiral level");
      expect(r.text.includes(String.fromCharCode(0x2014))).toBe(false); // no em dash
      expect(r.text.includes("-".repeat(2))).toBe(false); // no double hyphen
    }
    // The 2nd captain's node is ungated, the 3rd needs level 5, the 4th level 25 (today's table).
    expect(lockedCaptainSlotRequirement(3)!.fleetAdminLevel).toBe(HOMEWORLD_TALENTS.fleetLogisticsSlot2.requiresFleetAdminLevel);
  });

  it("no requirement past the last slot a talent opens, nor for the starting captain", () => {
    expect(lockedCaptainSlotRequirement(MAX_UNLOCKABLE_CAPTAINS + 1)).toBeNull();
    expect(lockedCaptainSlotRequirement(1)).toBeNull();
  });

  it("the Captain Roster's locked slot shows it", () => {
    const app = readFileSync("src/App.svelte", "utf8");
    expect(app).toContain("lockedCaptainSlotRequirement(captainNumber)");
  });
});
