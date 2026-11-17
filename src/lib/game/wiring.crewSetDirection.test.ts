// 0.14.0 Standard-Issue crew modules (user 2026-11-17 "free basic set, all ships"), fix pass: a DIRECTION-ONLY pass
// over the wiring registry with the free Sensor Suite, Bridge Module and Crew Quarters KEPT on ship-1 (the hull every
// player has). wiring.sensitivity.test.ts measures every entry on a bare hull (wiringBase takes the set off), exactly
// and through its curve; this pass only asks that each live source still moves its value the declared way when the
// free set is aboard, so no source is silently canceled or flipped by the set. No magnitudes: the set lifts officers,
// divisions and some hull stats, so the size of a move may differ, never its sign.

import { afterAll, describe, expect, it } from "vitest";
import { WIRING_REGISTRY, WIRING_SYSTEMS, type WiringEntry } from "./wiring/registry";
import { dispatchRun, readProbe, WIRING_BARE_HULL, WIRING_SHIP_ID, type ContextId } from "./wiring/probes";
import { CREW_MODULE_STANDARD_ISSUE, type ExpeditionPlanetType, type GameState } from "./model";
import { discoveryOddsPermille } from "./expedition";
import { PLANET_TYPES } from "./expeditionContent";

WIRING_BARE_HULL.live = false;
afterAll(() => {
  WIRING_BARE_HULL.live = true;
});

// The planet bias entries count finds over an 8-seed batch (an event probe). With the free Balanced Array's own small
// bias aboard, that batch can draw the same count both ways (Terrestrial and Gas Giant landmarks: 43 and 25 each way),
// a sample coincidence, so they are checked on the pure odds the roll reads instead (expedition.ts
// discoveryOddsPermille: base + the planet's bias + the array's, the same sum the probe cancels).
function checkPlanetBias(e: WiringEntry): void {
  const [, , planet, kind] = e.probe!.split(":") as [string, string, ExpeditionPlanetType, "landmark" | "underground"];
  const params = dispatchRun(e.base()).scanParams;
  expect(params.landmarkOddsBias, "the free Balanced Array's scan bias is aboard").toBeGreaterThan(0);
  const def = PLANET_TYPES.find((p) => p.id === planet)!;
  const pool = kind === "landmark" ? "surface" : "underground";
  const canceled =
    kind === "landmark"
      ? { ...params, landmarkOddsBias: params.landmarkOddsBias - def.surfaceBias }
      : { ...params, undergroundPoiOddsBias: params.undergroundPoiOddsBias - def.undergroundBias };
  const on = discoveryOddsPermille(params, planet)[pool];
  const off = discoveryOddsPermille(canceled, planet)[pool];
  if (e.direction === "up") expect(on, `${e.id}: odds should rise with the set aboard`).toBeGreaterThan(off);
  if (e.direction === "down") expect(on, `${e.id}: odds should fall with the set aboard`).toBeLessThan(off);
}

function checkDirection(e: WiringEntry, ctx: ContextId): void {
  if (e.probe!.startsWith("content:planetBias:")) return checkPlanetBias(e);
  const s0 = e.base();
  const off = readProbe(e.probe!, e.off(s0), ctx);
  const on = readProbe(e.probe!, e.on(s0), ctx);
  if (e.direction === "up") expect(on, `${e.id} @ ${ctx}: should move UP with the set aboard (off ${off}, on ${on})`).toBeGreaterThan(off);
  if (e.direction === "down") expect(on, `${e.id} @ ${ctx}: should move DOWN with the set aboard (off ${off}, on ${on})`).toBeLessThan(off);
}

// An entry whose source IS a piece in one of the three free slots (a crafted bridge, quarters or sensor array, its
// blueprint, its line) swaps out the free piece, so "with the set aboard" its off side is the free piece itself, not
// an empty slot: the sensitivity test measures those on the bare hull, and this pass leaves them out.
const CREW_SLOTS = Object.keys(CREW_MODULE_STANDARD_ISSUE);
const crewSlotPieces = (s: GameState): string =>
  JSON.stringify(s.equipment.filter((p) => p.fittedToShipId === WIRING_SHIP_ID && CREW_SLOTS.includes(p.slotType)).map((p) => p.id).sort());
function swapsAFreePiece(e: WiringEntry): boolean {
  const s0 = e.base();
  const at = crewSlotPieces(s0);
  return crewSlotPieces(e.on(s0)) !== at || crewSlotPieces(e.off(s0)) !== at;
}

const live = WIRING_REGISTRY.filter((e) => e.contexts.length > 0 && (e.direction === "up" || e.direction === "down"));
const directional = live.filter((e) => !swapsAFreePiece(e));

describe("wiring with the free crew set aboard: every live source still moves its value the declared way", () => {
  it("the fixture really carries the set, and there are entries to check (vacuity guard)", () => {
    expect(directional.length).toBeGreaterThan(100);
    expect(live.length - directional.length, "the crew-slot sources left to the bare-hull test").toBeGreaterThan(0);
    const base = directional[0].base();
    for (const [slot, variety] of Object.entries(CREW_MODULE_STANDARD_ISSUE)) {
      expect(base.equipment.some((p) => p.fittedToShipId === WIRING_SHIP_ID && p.slotType === slot && p.moduleVariant === variety), slot).toBe(true);
    }
  });
  for (const system of WIRING_SYSTEMS) {
    const entries = directional.filter((e) => e.system === system);
    if (entries.length === 0) continue;
    describe(system, () => {
      for (const e of entries) for (const ctx of e.contexts) it(`${e.id} @ ${ctx}`, () => checkDirection(e, ctx));
    });
  }
});
