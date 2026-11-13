// Short-Range Missions G1-7 (the close-out, docs/plans/2026-10-17-short-range-missions-plan.md G1-7): the release
// gate for G1. Every wiring registry row a G1 slice owns is LIVE with a consumer and a measuring probe; none waits on
// a G1 slice. The SF-7 contract test is the precedent (safeFirstRunsContract.test.ts).

import { describe, expect, it } from "vitest";
import { WIRING_REGISTRY, releaseBlockers, wiringEntry } from "./wiring/registry";
import { SHORT_RANGE_TEMPLATE_KEYS } from "./shortRange";

const SR = "mission:shortRange";

describe("G1-7: no registry row waits on a short-range slice", () => {
  it("no pending row is owned by a G1 slice", () => {
    // An owner names its slice first ("G1-4", "G1-6 ..."); a row owned by another slice may still mention G1 in passing
    // (relic:audit:generalPick was the Relics v2 R2-3 follow-up's; that follow-up removed it).
    const waiting = releaseBlockers().filter((e) => e.status.kind === "pending" && /^G1(-\d)?\b/.test(e.status.owner)).map((e) => e.id);
    expect(waiting).toEqual([]);
  });

  it("every row that claims a short-range run is live, and every short-range-named row is live", () => {
    const claims = WIRING_REGISTRY.filter((e) => e.contexts.includes(SR));
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.filter((e) => e.status.kind !== "live").map((e) => e.id)).toEqual([]);
    const named = WIRING_REGISTRY.filter((e) => /shortRange|SHORT_RANGE|guest|colonist/i.test(e.id));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((e) => e.status.kind !== "live").map((e) => e.id)).toEqual([]);
  });

  it("each template's rolls, work and reward rows are live at a short-range run", () => {
    for (const key of SHORT_RANGE_TEMPLATE_KEYS) {
      for (const part of ["rolls", "work", "reward"]) {
        const e = wiringEntry(`mission:SHORT_RANGE_TEMPLATES:${key}:${part}`);
        expect(e, `${key}:${part}`).toBeDefined();
        expect(e!.status.kind, `${key}:${part}`).toBe("live");
        expect(e!.contexts, `${key}:${part}`).toContain(SR);
      }
    }
  });

  it("the board rungs, the Mission Control gate, the Pilot's quicker trip home and the relic blanks are live", () => {
    for (const id of [
      "facility:FACILITIES:missionControl:1",
      "facility:FACILITIES:missionControl:2",
      "facility:audit:missionControlUnlock",
      "crew:audit:pilotCunningReturn",
      "relic:audit:shortRangeBlanks",
    ]) {
      const e = wiringEntry(id);
      expect(e, id).toBeDefined();
      expect(e!.status.kind, id).toBe("live");
    }
  });
});
