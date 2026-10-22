// expeditionDispatchGate.test.ts: Expedition Tiers G2-4 review follow-up (D18 "Launch can never offer a dispatch the
// engine would refuse"). The Expedition Console disables Launch on dispatchGateLine (expeditionDispatchDisplay.ts),
// which reads expedition.ts expeditionDispatchGate: it must name exactly the propulsion refusal startExpedition gives,
// and nothing when startExpedition passes the propulsion gates.

import { describe, expect, it } from "vitest";
import type { GameState } from "./game/model";
import { expeditionDispatchGate, startExpedition } from "./game/expedition";
import { expeditionGateText } from "./game/propulsion";
import { asExpeditionVeteran } from "./game/awayTeamTestFixtures";
import { onHull, withCrew } from "./game/firstRunsGoldens.fixture";
import { dispatchGateLine } from "./expeditionDispatchDisplay";

const PROPULSION = new Set(["notExplorer", "driveClassUnavailable", "driveClassTooLow", "frontierSensors", "outOfReach"]);
const crewed = (hull: Parameters<typeof onHull>[0]): GameState => asExpeditionVeteran(withCrew(onHull(hull, 0x51f3), "rank6"));
const ship1 = (s: GameState) => s.ships.find((x) => x.id === "ship-1")!;

describe("G2-4: the console's Launch gate is the engine's propulsion refusal", () => {
  it("a non-explorer hull: the gate line names it, with or without a candidate, and the engine refuses it", () => {
    const s = crewed("generalFreighter");
    const res = startExpedition(s, "ship-1", 1, "cand-1-0");
    expect(res.reason).toBe("notExplorer");
    expect(expeditionDispatchGate(s, ship1(s), "cand-1-0")?.reason).toBe("notExplorer");
    expect(dispatchGateLine(s, ship1(s), "cand-1-0")).toBe("This hull cannot reach any expedition system. Expeditions need an explorer hull.");
    expect(dispatchGateLine(s, ship1(s), null)).toBe(dispatchGateLine(s, ship1(s), "cand-1-0"));
  });

  it("an explorer at Tier I: no gate line, and the engine launches it", () => {
    const s = crewed("eir");
    expect(dispatchGateLine(s, ship1(s), "cand-1-0")).toBeNull();
    expect(startExpedition(s, "ship-1", 1, "cand-1-0").success).toBe(true);
  });

  it("every tier I to VII: the gate is set exactly when the engine refuses on propulsion, with the same reason and text", () => {
    for (const hull of ["eir", "orion", "aurora", "generalFreighter"] as const) {
      const s = crewed(hull);
      for (const tier of [1, 2, 3, 4, 5, 6, 7]) {
        const id = `cand-${tier}-0`;
        const res = startExpedition(s, "ship-1", 1, id);
        const gate = expeditionDispatchGate(s, ship1(s), id);
        const refused = !res.success && PROPULSION.has(res.reason ?? "");
        expect(gate?.reason ?? null, `${hull} tier ${tier}`).toBe(refused ? res.reason : null);
        if (refused) {
          expect(gate).toEqual(res.gate);
          expect(dispatchGateLine(s, ship1(s), id)).toBe(expeditionGateText(res.gate!));
        }
      }
    }
  });

  it("an unknown candidate reads no gate on an explorer (the engine's own noSuchCandidate refusal covers it)", () => {
    const s = crewed("eir");
    expect(expeditionDispatchGate(s, ship1(s), "cand-9-9")).toBeNull();
    expect(startExpedition(s, "ship-1", 1, "cand-9-9").reason).toBe("noSuchCandidate");
  });
});
