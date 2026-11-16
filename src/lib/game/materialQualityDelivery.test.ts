// Material Lines ML-3 (0.14.0, OC-D2; plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 ML-3):
// material quality on delivery. A ship's materialQualityChance lines climb part of each delivery one quality step:
// floor(amount x p) units plus one keyed rounding roll (L4), off the captain's private stream.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { FAVORED_SPEC_LINE_BONUS, freshState, pieceFavorsHull, shipDerivedStats, type GameState } from "./model";
import { favoredReadPiece } from "../ui/favoredSpecText";
import { dispatchCaptainOnMission, economyTick, itemCap, worksDirectorateSaveSeed } from "./tick";
import { equippedFor } from "./equipmentQueries";
import { effectiveShipStats } from "./crewOverlay";
import { getBucket, itemTotal } from "./inventory";
import {
  MATERIAL_QUALITY_CURVE,
  MAX_MATERIAL_QUALITY,
  climbedQuality,
  deliveryClimbUnits,
  materialQualityClimbChance,
  materialQualitySeed,
  materialQualityStream,
} from "./materialQuality";
import { countedLcg, rigFleet, withBuckets, withMaterialQualityOff } from "./materialQualityGoldens.fixture";
import { pieceMaterialQualityText, shipMaterialQualityText } from "../ui/materialQualityText";
import { wiringEntry } from "./wiring/registry";
import { withNeverDiscardOff } from "./neverDiscardSwitch.fixture";

// Steps a dispatched fleet one tick at a time until its first delivery lands (commonOre rises), on `rng`.
function toFirstDelivery(s0: GameState, rng: () => number, item = "commonOre"): { before: GameState; after: GameState } {
  let s = s0;
  const start = itemTotal(s0.inventory, item);
  for (let i = 0; i < 2000; i++) {
    const next = economyTick(s, 1, rng);
    if (itemTotal(next.inventory, item).gt(start)) return { before: s, after: next };
    s = next;
  }
  throw new Error("no delivery");
}

function dispatched(s: GameState): GameState {
  const r = dispatchCaptainOnMission(s, 1, "shortOreRun");
  expect(r.success).toBe(true);
  return r.next;
}

const rigChance = (s: GameState): number => effectiveShipStats(s, s.ships[0]).materialQuality ?? 0;

describe("ML-3 the climb count (L4: expected count plus one keyed rounding roll)", () => {
  it("delivers floor(amount x p) exactly when the fraction is 0, whatever the roll", () => {
    expect(deliveryClimbUnits(new Decimal(100), 0.1, () => 0).toString()).toBe("10");
    expect(deliveryClimbUnits(new Decimal(100), 0.1, () => 0.999999).toString()).toBe("10");
  });

  it("rounds the leftover fraction with the one roll", () => {
    expect(deliveryClimbUnits(new Decimal(15), 0.1, () => 0.49).toString()).toBe("2");
    expect(deliveryClimbUnits(new Decimal(15), 0.1, () => 0.5).toString()).toBe("1");
  });

  it("never climbs more than was delivered, and takes no draw without a chance", () => {
    expect(deliveryClimbUnits(new Decimal(0.5), 1, () => 0).toString()).toBe("0.5");
    let draws = 0;
    expect(deliveryClimbUnits(new Decimal(90), 0, () => (draws++, 0)).toString()).toBe("0");
    expect(draws).toBe(0);
  });

  it("lifts one step, and Q5 stays Q5", () => {
    expect(climbedQuality(0)).toBe(1);
    expect(climbedQuality(3)).toBe(4);
    expect(climbedQuality(MAX_MATERIAL_QUALITY)).toBe(MAX_MATERIAL_QUALITY);
  });

  it("the chance rises on a concave curve with no cap below a probability of 1 (D23)", () => {
    expect(materialQualityClimbChance(0)).toBe(0);
    const a = materialQualityClimbChance(10);
    const b = materialQualityClimbChance(20);
    const c = materialQualityClimbChance(40);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(b - a).toBeGreaterThan(c - b - (b - a)); // each extra point is worth a little less
    expect(c - b).toBeLessThan(2 * (b - a));
  });
});

describe("ML-3 the ship sheet", () => {
  it("a Standard-Issue loadout folds to no material quality (the field stays absent)", () => {
    const s = freshState();
    const stats = shipDerivedStats(s.ships[0], equippedFor(s, s.ships[0].id));
    expect("materialQuality" in stats).toBe(false);
    expect(effectiveShipStats(s, s.ships[0]).materialQuality).toBeUndefined();
  });

  it("a Refinery-Feed Rig reads its points through the curve", () => {
    const s = rigFleet();
    const rig = s.equipment.find((e) => e.id === "rig-1")!;
    const points = (rig.implicitStats.materialQualityChance ?? 0) + (rig.rolledStats.materialQualityChance ?? 0);
    expect(points).toBeGreaterThan(0);
    // WR-7 follow-up (OC-D5): the rig's variety favors the Prospector spec, so on this hull its points count +10%.
    expect(pieceFavorsHull(rig, s.ships[0].typeKey)).toBe(true);
    expect(rigChance(s)).toBeCloseTo(materialQualityClimbChance(points * (1 + FAVORED_SPEC_LINE_BONUS)), 12);
  });
});

describe("ML-3 the delivery", () => {
  it("a rig ship's delivery lands floor(amount x p) units, plus the rounding roll, one step up", () => {
    const s0 = dispatched(rigFleet());
    const p = rigChance(s0);
    // Draws pinned at 0.999999: the delivery's own quality roll lands Q0, so the climbed units are exactly the Q1 rise.
    const { before, after } = toFirstDelivery(s0, () => 0.999999);
    const delivered = itemTotal(after.inventory, "commonOre").minus(itemTotal(before.inventory, "commonOre"));
    const expected = deliveryClimbUnits(delivered, p, materialQualityStream(worksDirectorateSaveSeed(s0), 1, 0));
    expect(expected.gt(0)).toBe(true);
    expect(getBucket(after.inventory, "commonOre", 1).minus(getBucket(before.inventory, "commonOre", 1)).toString()).toBe(expected.toString());
    expect(after.captains[0].materialQualityCycles).toBe(1);
  });

  it("the roll is keyed by the save's own seed too (delivery N does not roll alike in every save)", () => {
    expect(materialQualitySeed(1, 1, 0)).not.toBe(materialQualitySeed(2, 1, 0));
    expect(materialQualitySeed(1, 1, 0)).not.toBe(materialQualitySeed(1, 1, 1));
    expect(materialQualitySeed(1, 1, 0)).not.toBe(materialQualitySeed(1, 2, 0));
    // A seeded save's delivery climbs exactly what its own keyed stream says.
    const seeded = dispatched({ ...rigFleet(), homeworld: { version: 1, seed: 0x5eed } });
    const p = rigChance(seeded);
    const { before, after } = toFirstDelivery(seeded, () => 0.999999);
    const delivered = itemTotal(after.inventory, "commonOre").minus(itemTotal(before.inventory, "commonOre"));
    const expected = deliveryClimbUnits(delivered, p, materialQualityStream(0x5eed, 1, 0));
    expect(getBucket(after.inventory, "commonOre", 1).minus(getBucket(before.inventory, "commonOre", 1)).toString()).toBe(expected.toString());
  });

  it("the next delivery rolls on the next key (the lifetime counter steps)", () => {
    const s0 = dispatched(rigFleet());
    const first = toFirstDelivery(s0, () => 0.999999).after;
    const second = toFirstDelivery(first, () => 0.999999).after;
    expect(second.captains[0].materialQualityCycles).toBe(2);
  });

  it("a Q5 delivery stays Q5 (the climb clamps at the top)", () => {
    const s0 = dispatched(rigFleet());
    // Draws pinned at 0: every extraction tick finds the rare tier and every quality step succeeds (Q5).
    const { before, after } = toFirstDelivery(s0, () => 0, "rareMaterial");
    const delivered = itemTotal(after.inventory, "rareMaterial").minus(itemTotal(before.inventory, "rareMaterial"));
    expect(delivered.gt(0)).toBe(true);
    expect(getBucket(after.inventory, "rareMaterial", MAX_MATERIAL_QUALITY).minus(getBucket(before.inventory, "rareMaterial", MAX_MATERIAL_QUALITY)).toString()).toBe(delivered.toString());
    expect(after.inventory.rareMaterial.length).toBeLessThanOrEqual(MAX_MATERIAL_QUALITY + 1);
  });

  // Pre-FR-C rule (the cap trimmed a delivery), kept as its trace with Never discard off (neverDiscardSwitch.fixture.ts).
  it("with Never discard off: the climbed units deposit first, so a warehouse cap trims ordinary units", () => withNeverDiscardOff(() => {
    const fleet = rigFleet();
    const cap = itemCap(fleet, "commonOre").toNumber();
    // Room for 60: the climbed units (well under 60 of the haul) all land, then the ordinary units fill the rest.
    const s0 = dispatched(withBuckets(fleet, { commonOre: [cap - 60] }));
    const { after } = toFirstDelivery(s0, () => 0.999999);
    const climbed = getBucket(after.inventory, "commonOre", 1).toNumber();
    expect(climbed).toBeGreaterThan(0);
    expect(climbed).toBeLessThan(60);
    expect(itemTotal(after.inventory, "commonOre").toNumber()).toBeCloseTo(cap, 6);
    expect(getBucket(after.inventory, "commonOre", 0).toNumber()).toBeCloseTo(cap - climbed, 6);
  }));

  // FR-C (user 2026-11-13/14, "Never discard"): the whole delivery lands, climbed and ordinary units alike, past the cap.
  it("a delivery crossing the cap lands in full, climbed units and ordinary units alike", () => {
    const fleet = rigFleet();
    const cap = itemCap(fleet, "commonOre").toNumber();
    const s0 = dispatched(withBuckets(fleet, { commonOre: [cap - 60] }));
    const { after } = toFirstDelivery(s0, () => 0.999999);
    const off = withNeverDiscardOff(() => toFirstDelivery(dispatched(withBuckets(rigFleet(), { commonOre: [cap - 60] })), () => 0.999999).after);
    expect(itemTotal(after.inventory, "commonOre").toNumber()).toBeGreaterThan(cap);
    expect(getBucket(after.inventory, "commonOre", 1).toNumber()).toBe(getBucket(off.inventory, "commonOre", 1).toNumber());
  });

  it("takes exactly the shared draws a ship without the climb takes (never the shared stream)", () => {
    const run = (): number => {
      const live = countedLcg(0x51);
      let s = dispatched(rigFleet());
      for (let i = 0; i < 400; i++) s = economyTick(s, 1, live.rng);
      return live.draws();
    };
    expect(run()).toBe(withMaterialQualityOff(run));
    expect(MATERIAL_QUALITY_CURVE.perPoint).toBeGreaterThan(0); // the switch restored the curve
  });

  it("with the climb off, a rig ship delivers as before and writes no counter", () => {
    const { after } = withMaterialQualityOff(() => toFirstDelivery(dispatched(rigFleet()), () => 0.999999));
    expect(getBucket(after.inventory, "commonOre", 1).toString()).toBe("0");
    expect(after.captains[0].materialQualityCycles).toBeUndefined();
  });
});

describe("ML-3 the readout and the registry", () => {
  it("the rig tooltip names the real chance per unit", () => {
    const s = rigFleet();
    const rig = s.equipment.find((e) => e.id === "rig-1")!;
    const pct = (Math.round(rigChance(s) * 1000) / 10).toFixed(1);
    // WR-7 follow-up (OC-D5): the tooltip on the rig's own (favored) hull reads its favored lines, as the run does.
    expect(pieceMaterialQualityText(favoredReadPiece(rig, s.ships[0].typeKey))).toBe(`+${pct}% chance per unit to arrive one quality higher`);
    const plain = s.equipment.find((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay")!;
    expect(pieceMaterialQualityText(plain)).toBeNull();
  });

  it("two pieces with the line show the ship's combined chance: the points add, then the curve diminishes", () => {
    const s = rigFleet();
    const rig = s.equipment.find((e) => e.id === "rig-1")!;
    const twin = { ...rig, id: "rig-2" };
    const points = (rig.implicitStats.materialQualityChance ?? 0) + (rig.rolledStats.materialQualityChance ?? 0);
    const total = materialQualityClimbChance(2 * points);
    expect(total).toBeLessThan(2 * materialQualityClimbChance(points)); // concave
    const pct = (Math.round(total * 1000) / 10).toFixed(1);
    expect(shipMaterialQualityText(rig, [rig, twin])).toBe(`Ship total, 2 pieces: +${pct}% per unit (the points add, then diminish)`);
    // One carrier (its own readout is the ship's), no ship context, or a spare not installed there: no total line.
    expect(shipMaterialQualityText(rig, [rig])).toBeNull();
    expect(shipMaterialQualityText(rig, undefined)).toBeNull();
    expect(shipMaterialQualityText({ ...rig, id: "spare" }, [rig, twin])).toBeNull();
  });

  it("materialQualityChance is a LIVE gear line on mission deliveries", () => {
    const e = wiringEntry("ship:gearLine:materialQualityChance")!;
    expect(e.status.kind).toBe("live");
    expect(e.contexts).toContain("mission:extraction");
  });
});
