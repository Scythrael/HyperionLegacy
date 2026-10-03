// E-CREW Task 6: the Away Team display helpers (labels, rank emphasis band, ship name, countdown).

import { describe, it, expect } from "vitest";
import { AWAY_TEAM_TYPES, freshState } from "./game/model";
import { specsFor } from "./game/awayTeam";
import { CREW_RANK_ORDER } from "./game/crewRank";
import { ICON_NAMES } from "./ui/icons";
import {
  SQUAD_META,
  awaySpecLabel,
  rankTier,
  awayShipName,
  awayCountdownText,
  awayRaceLabel,
  awayTargetLabel,
  pickedMoveTarget,
} from "./awayTeamDisplay";

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
