// Expedition Tiers G2-6: the wiring registry rows the dispatch console takes live (the region picker and recall). Each
// row G2-2 / G2-3 / G2-4 / G2-5 left to G2-6 is live with its own probe (the sensitivity level measures each move), the
// tier haul and the tier body counts have their own rows (the G2-2 review note), and no row still waits on G2-6.

import { describe, expect, it } from "vitest";
import { WIRING_REGISTRY } from "./wiring/registry";
import { G2_6_ADDED_ENTRY_IDS, G2_6_FLIPPED_BEFORE } from "./expeditionConsoleRegistry.fixture";

const G2_6_AUDIT_LIVE = [
  "expedition:audit:driveClassTierGate",
  "expedition:audit:frontierSensors",
  "expedition:audit:voyageDeepTiers",
  "away:audit:tierDormant",
  "away:audit:tierHaulMult",
  "expedition:audit:tierBodyCount",
  "expedition:audit:blindLaunch",
  "expedition:audit:oddsRiskyBelow",
  "relic:audit:blankTiers",
  "expedition:audit:recall",
  "expedition:audit:resumableSystems",
];

describe("G2-6 the wiring registry: the console's rows are live", () => {
  it("every row G2-6 flips or adds is live at Ground Ops with a probe (the future difficulty tiers deferred, SF-7)", () => {
    const rows = WIRING_REGISTRY.filter((e) => G2_6_AUDIT_LIVE.includes(e.id));
    expect(rows.map((e) => e.id).sort()).toEqual([...G2_6_AUDIT_LIVE].sort());
    for (const e of rows) {
      expect(e.status.kind, e.id).toBe("live");
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts, e.id).toContain("expedition:groundOps");
    }
    // Safe first runs SF-7: deferred on the user's words (the hooks built, the higher difficulty tiers not designed).
    const difficulty = WIRING_REGISTRY.find((e) => e.id === "away:audit:difficultyTiers")!;
    expect(difficulty.status.kind).toBe("deferred");
    expect([...G2_6_ADDED_ENTRY_IDS].every((id) => WIRING_REGISTRY.some((e) => e.id === id))).toBe(true);
  });

  it("the telescope's reach is live on the region picker: every reach entry and every reach-only rung reads at Ground Ops", () => {
    for (const id of Object.keys(G2_6_FLIPPED_BEFORE)) {
      const e = WIRING_REGISTRY.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.status.kind, id).toBe("live");
      expect(e!.contexts, id).toContain("expedition:groundOps");
    }
  });

  it("no row still waits on G2-6", () => {
    const waiting = WIRING_REGISTRY.filter((e) => (e.status.kind === "pending" || e.status.kind === "deferred") && /^G2-6\b/.test(e.status.owner)).map((e) => e.id);
    expect(waiting).toEqual([]);
  });
});
