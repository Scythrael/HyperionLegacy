// WR-5a (0.14.0): the captain secondary tree's Prospector nodes, wired. One block per node (plus the shared rules:
// own ship, no node = unchanged, offline == live, the player text). The registry's sensitivity level checks each
// node's seam at its catalog magnitude; these tests pin the consumers end to end.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  MISSIONS,
  QUALITY_STEP_CHANCE,
  SECONDARY_CAPTAIN_TALENTS,
  effectiveMissionDef,
  freshState,
  missionPhaseTicks,
  type CaptainMissionState,
  type CaptainState,
  type GameState,
  type MissionKey,
  type SecondaryTalentKey,
} from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, missionDropChances, shipRangeLightYears, tick } from "./tick";
import { effectiveShipStats, shipStatsBeforeCaptain } from "./crewOverlay";
import { snapshotGroundOps } from "./groundOps";
import { makeRng } from "./combat/rng";
import {
  NO_CAPTAIN_LIFTS,
  SUPPLY_RUN_KEYS,
  captainDockedCreditsPerTick,
  captainShipLifts,
  captainTransportTerms,
  describeSecondaryTalentEffect,
  motherlodeSeed,
  secondaryTalentEffectText,
  secondaryTalentMagnitude,
} from "./captainSecondaryEffects";
import { itemTotal } from "./inventory";

const PROSPECTOR = (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).filter((k) => SECONDARY_CAPTAIN_TALENTS[k].tree === "prospector");

function base(): GameState {
  const s = freshState();
  return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => (c.id === 1 ? { ...c, level: 10 } : c)) };
}
function owning(s: GameState, keys: readonly SecondaryTalentKey[]): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, unlockedSecondaryTalents: [...keys] } : c)) };
}
const cap1 = (s: GameState): CaptainState => s.captains.find((c) => c.id === 1)!;
const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === "ship-1")!;
const m = (k: SecondaryTalentKey) => secondaryTalentMagnitude(k);
const commonHeld = (s: GameState) => Number(itemTotal(s.inventory, "commonOre"));

// Captain 1 on the last unloading tick of a recalled `key` cycle carrying `cargo` Titanium Ore: one tick delivers it.
function deliveringState(s: GameState, key: MissionKey, cargo: number, over: Partial<CaptainState> = {}): GameState {
  const def = effectiveMissionDef(MISSIONS[key], effectiveShipStats(s, ship1(s)));
  const load = { commonOre: new Decimal(cargo), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) };
  const mission = { kind: "extraction", missionKey: key, phase: "unloading", phaseProgressTicks: missionPhaseTicks("unloading", def, load) - 1, cargo: load, recalled: true } as CaptainMissionState;
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, ...over, mission } : c)) };
}

describe("WR-5a: the rules every Prospector node shares", () => {
  it("no node: no lift, and effectiveShipStats is the pre-captain fold itself", () => {
    const s = base();
    expect(captainShipLifts(cap1(s))).toBe(NO_CAPTAIN_LIFTS);
    expect(effectiveShipStats(s, ship1(s))).toEqual(shipStatsBeforeCaptain(s, ship1(s)));
  });

  it("acts on the ship its captain COMMANDS only (OC-A2): an unassigned hull gains nothing", () => {
    const s = owning(base(), ["logistics1"]);
    expect(effectiveShipStats(s, ship1(s)).cargoCapacity).toBeCloseTo(shipStatsBeforeCaptain(s, ship1(s)).cargoCapacity * (1 + m("logistics1")), 9);
    const parked = { ...s, ships: s.ships.map((sh) => ({ ...sh, assignedCaptainId: null })) };
    expect(effectiveShipStats(parked, ship1(parked)).cargoCapacity).toBe(shipStatsBeforeCaptain(parked, ship1(parked)).cargoCapacity);
  });

  it("SUPPLY_RUN_KEYS is every transport mission", () => {
    const transports = (Object.keys(MISSIONS) as MissionKey[]).filter((k) => MISSIONS[k].missionType === "transport");
    expect([...SUPPLY_RUN_KEYS].sort()).toEqual([...transports].sort());
  });

  it("offline == live: one 1,000 s call, 397 s chunks and 1 s ticks give the same save (every Prospector branch)", () => {
    for (const branch of ["extraction", "logistics", "trade"]) {
      const keys = PROSPECTOR.filter((k) => SECONDARY_CAPTAIN_TALENTS[k].branch === branch);
      const key: MissionKey = branch === "trade" ? "frontierSupplyRun" : "shortOreRun";
      const r = dispatchCaptainOnMission(owning(base(), keys), 1, key);
      expect(r.success).toBe(true);
      const rngFor = () => {
        let x = 0x5eed;
        return () => {
          x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
          return x / 4294967296;
        };
      };
      const one = tick(1000, r.next, rngFor());
      const rA = rngFor();
      let chunked = r.next;
      for (const span of [397, 397, 206]) chunked = tick(span, chunked, rA);
      const rB = rngFor();
      let stepped = r.next;
      for (let i = 0; i < 1000; i++) stepped = tick(1, stepped, rB);
      expect(JSON.stringify(chunked)).toBe(JSON.stringify(one));
      expect(JSON.stringify(stepped)).toBe(JSON.stringify(one));
    }
  }, 60_000);

  it("every Prospector node's text says what it does (no placeholder, US punctuation rules)", () => {
    for (const k of PROSPECTOR) {
      const text = secondaryTalentEffectText(k);
      expect(text, k).not.toMatch(/No bonus yet|first-pass|pending/i);
      expect(text, k).not.toMatch(/—|-{2}/); // no em dash, no double hyphen
      expect(describeSecondaryTalentEffect(SECONDARY_CAPTAIN_TALENTS[k].effect)).toBe(text);
      expect(m(k), k).toBeGreaterThan(0);
    }
    expect(secondaryTalentEffectText("logistics1")).toBe("+5% cargo capacity (counts toward mission cargo requirements)");
    expect(secondaryTalentEffectText("extraction5")).toBe("Motherlode: 5% chance per delivered mission cycle that its haul doubles");
  });
});

describe("WR-5a Extraction", () => {
  it("extraction1 Prospector's Eye: every extracting tick yields x (1 + 5%)", () => {
    const plain = economyTick(owning(onMissionAt(base(), "shortOreRun", "extracting"), []), 1, () => 0.999999);
    const eye = economyTick(owning(onMissionAt(base(), "shortOreRun", "extracting"), ["extraction1"]), 1, () => 0.999999);
    const cargo = (s: GameState) => Number((cap1(s).mission as CaptainMissionState).cargo.commonOre);
    expect(cargo(eye)).toBeCloseTo(cargo(plain) * (1 + m("extraction1")), 9);
  });

  it("extraction2 Deep Veins: the rare AND uncommon odds rise by 5% (relative), and the dispatch popup shows it", () => {
    const plain = missionDropChances(base(), cap1(base()), "salvageWreckage");
    const s = owning(base(), ["extraction2"]);
    const veins = missionDropChances(s, cap1(s), "salvageWreckage");
    expect(veins.uncommon).toBeCloseTo(plain.uncommon * (1 + m("extraction2")), 12);
    expect(veins.rare).toBeCloseTo(plain.rare * (1 + m("extraction2")), 12);
  });

  it("extraction3 Efficient Haul: a shorter extracting phase, the same haul per cycle", () => {
    const plain = effectiveMissionDef(MISSIONS.longOreRun, effectiveShipStats(base(), ship1(base())));
    const s = owning(base(), ["extraction3"]);
    const fast = effectiveMissionDef(MISSIONS.longOreRun, effectiveShipStats(s, ship1(s)));
    const ticks = (d: typeof plain) => d.extractionTicksOverride ?? Math.ceil(d.cargoCapacity / d.extractionRatePerTick);
    expect(ticks(fast)).toBeLessThan(ticks(plain));
    expect(ticks(fast) * (fast.extractionRatePerTick ?? 1)).toBeCloseTo(ticks(plain) * plain.extractionRatePerTick, 9);
  });

  it("extraction4 Assayer: the delivery's quality climb widens by 5%, with the same number of draws", () => {
    // A draw just above the base first-climb chance lands quality 0 without the node and 1 with it.
    const climb = QUALITY_STEP_CHANCE[0];
    const draw = climb * (1 + m("extraction4") / 2);
    const quality = (s: GameState) => {
      const after = economyTick(s, 1, () => draw);
      return (after.inventory.commonOre ?? []).findIndex((q, i) => i > 0 && Number(q) > 0);
    };
    expect(quality(deliveringState(base(), "shortOreRun", 10))).toBe(-1);
    expect(quality(deliveringState(owning(base(), ["extraction4"]), "shortOreRun", 10))).toBe(1);
    const draws = (s: GameState) => {
      let n = 0;
      economyTick(s, 1, () => {
        n++;
        return draw;
      });
      return n;
    };
    expect(draws(deliveringState(owning(base(), ["extraction4"]), "shortOreRun", 10))).toBe(draws(deliveringState(base(), "shortOreRun", 10)));
  });

  it("extraction5 Motherlode: the seeded roll doubles a delivered haul at its configured rate, on a lifetime counter", () => {
    const chance = m("extraction5");
    const hit = (i: number) => makeRng(motherlodeSeed(1, i)).next() < chance;
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (hit(i)) hits++;
    expect(hits / 20000).toBeGreaterThan(chance * 0.85);
    expect(hits / 20000).toBeLessThan(chance * 1.15);
    const first = [...Array(400).keys()].find(hit)!;
    const miss = [...Array(400).keys()].find((i) => !hit(i))!;
    const owner = owning(base(), ["extraction5"]);
    const delivered = (s: GameState) => commonHeld(economyTick(s, 1, () => 0.999999)) - commonHeld(s);
    expect(delivered(deliveringState(owner, "shortOreRun", 10, { motherlodeCycles: first }))).toBe(20);
    expect(delivered(deliveringState(owner, "shortOreRun", 10, { motherlodeCycles: miss }))).toBe(10);
    expect(delivered(deliveringState(base(), "shortOreRun", 10, { motherlodeCycles: first }))).toBe(10);
    // The counter steps once per delivered cycle (a redispatch never replays a roll), and only for the owner.
    expect(cap1(economyTick(deliveringState(owner, "shortOreRun", 10, { motherlodeCycles: 7 }), 1, () => 0.999999)).motherlodeCycles).toBe(8);
    expect(cap1(economyTick(deliveringState(base(), "shortOreRun", 10), 1, () => 0.999999)).motherlodeCycles).toBeUndefined();
  });
});

describe("WR-5a Logistics", () => {
  it("logistics1 Quartermaster: +5% cargo, and canDispatch reads it (the same stats sheet)", () => {
    const s = owning(base(), ["logistics1"]);
    expect(effectiveShipStats(s, ship1(s)).cargoCapacity).toBeCloseTo(effectiveShipStats(base(), ship1(base())).cargoCapacity * (1 + m("logistics1")), 9);
    expect(canDispatch(s, 1, "frontierSupplyRun").ok).toBe(true);
  });

  it("logistics2 Fuel Discipline: +5% engine efficiency lengthens the range", () => {
    const s = owning(base(), ["logistics2"]);
    const before = effectiveShipStats(base(), ship1(base())).engineEfficiency;
    expect(effectiveShipStats(s, ship1(s)).engineEfficiency).toBeCloseTo(before + m("logistics2"), 12);
    expect(shipRangeLightYears(s, ship1(s))).toBeCloseTo((shipRangeLightYears(base(), ship1(base())) * (1 + before + m("logistics2"))) / (1 + before), 9);
  });

  it("logistics3 Rapid Turnaround: a shorter mission unload, and the Ground Ops offload frozen at dispatch", () => {
    const big = (s: GameState) => effectiveMissionDef(MISSIONS.longOreRun, { ...effectiveShipStats(s, ship1(s)), cargoCapacity: 9000 }).unloadTicks;
    const s = owning(base(), ["logistics3"]);
    expect(big(s)).toBeLessThan(big(base()));
    expect(snapshotGroundOps(s, ship1(s), { recoveryTurnaround: 0 } as never).factors.offloadMult).toBeCloseTo(1 + m("logistics3"), 12);
  });

  it("logistics5 Overloaded Holds: +10% cargo above the hold, unloaded at no extra time", () => {
    const s = owning(base(), ["logistics5"]);
    const plain = effectiveShipStats(base(), ship1(base()));
    const over = effectiveShipStats(s, ship1(s));
    expect(over.cargoCapacity).toBeCloseTo(plain.cargoCapacity * (1 + m("logistics5")), 9);
    expect(over.unloadCargoCapacity).toBe(plain.cargoCapacity);
    const def = (st: typeof plain) => effectiveMissionDef(MISSIONS.shortOreRun, st);
    expect(def(over).unloadTicks).toBe(def(plain).unloadTicks);
    expect(def(over).cargoCapacity).toBeGreaterThan(def(plain).cargoCapacity);
    // With Quartermaster the overflow is a share of the bigger hold, which itself unloads as usual.
    const both = owning(base(), ["logistics1", "logistics5"]);
    const qm = owning(base(), ["logistics1"]);
    expect(effectiveShipStats(both, ship1(both)).unloadCargoCapacity).toBeCloseTo(effectiveShipStats(qm, ship1(qm)).cargoCapacity, 9);
  });
});

describe("WR-5a Trade", () => {
  // One whole Frontier Supply Run cycle's net credits (every draw common).
  function cycleCredits(s: GameState): number {
    const r = dispatchCaptainOnMission(s, 1, "frontierSupplyRun");
    expect(r.success).toBe(true);
    let after = r.next;
    for (let i = 0; i < 230; i++) after = economyTick(after, 1, () => 0.999999);
    return Number(after.credits) - Number(r.next.credits);
  }
  const load = () => effectiveShipStats(base(), ship1(base())).cargoCapacity * (MISSIONS.frontierSupplyRun.supplyCostPerCargo ?? 0);
  const margin = MISSIONS.frontierSupplyRun.rewardMargin ?? 0;

  it("trade1 + trade3: the supply run margin x (1 + 5% + 5%)", () => {
    expect(cycleCredits(base())).toBeCloseTo(load() * margin, 9);
    expect(cycleCredits(owning(base(), ["trade1"]))).toBeCloseTo(load() * margin * (1 + m("trade1")), 9);
    expect(cycleCredits(owning(base(), ["trade1", "trade3"]))).toBeCloseTo(load() * margin * (1 + m("trade1") + m("trade3")), 9);
  });

  it("trade2 Shrewd Negotiator: the supplies cost 5% less at the same sale value, and the working capital gate reads the discount", () => {
    expect(cycleCredits(owning(base(), ["trade2"]))).toBeCloseTo(load() * margin + load() * m("trade2"), 9);
    expect(captainTransportTerms(cap1(owning(base(), ["trade2"]))).supplyDiscount).toBe(m("trade2"));
  });

  it("trade4 Trade Routes [PROVISIONAL]: 1 credit/tick while docked on an established route, closed-form", () => {
    const route = (s: GameState): GameState => ({
      ...s,
      lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...s.lifetimeStats.missionsCompleted, colonySupplyLift: new Decimal(3) } },
    });
    const s = route(owning(base(), ["trade1", "trade2", "trade3", "trade4"]));
    expect(captainDockedCreditsPerTick(s, cap1(s))).toBe(m("trade4"));
    expect(Number(economyTick(s, 10, () => 0.5).credits) - Number(s.credits)).toBeCloseTo(10 * m("trade4"), 6);
    // No route yet, out on a mission, or nothing owned: nothing.
    const noRoute = owning(base(), ["trade4"]);
    expect(captainDockedCreditsPerTick(noRoute, cap1(noRoute))).toBe(0);
    const out = dispatchCaptainOnMission(s, 1, "shortOreRun").next;
    expect(captainDockedCreditsPerTick(out, cap1(out))).toBe(0);
    expect(captainDockedCreditsPerTick(route(base()), cap1(route(base())))).toBe(0);
  });

  it("trade5 Trade Baron: x2 every Trade 1 to 4 value", () => {
    const four = owning(base(), ["trade1", "trade2", "trade3", "trade4"]);
    const five = owning(base(), ["trade1", "trade2", "trade3", "trade4", "trade5"]);
    const f = m("trade5");
    const t4 = captainTransportTerms(cap1(four));
    const t5 = captainTransportTerms(cap1(five));
    expect(t5.marginBonus).toBeCloseTo(t4.marginBonus * f, 12);
    expect(t5.supplyDiscount).toBeCloseTo(t4.supplyDiscount * f, 12);
    const routed = (s: GameState): GameState => ({
      ...s,
      lifetimeStats: { ...s.lifetimeStats, missionsCompleted: { ...s.lifetimeStats.missionsCompleted, frontierSupplyRun: new Decimal(1) } },
    });
    expect(captainDockedCreditsPerTick(routed(five), cap1(five))).toBe(m("trade4") * f);
    expect(cycleCredits(five) - load() * margin).toBeCloseTo((cycleCredits(four) - load() * margin) * f, 9);
  });
});

// Captain 1 on `key` at the start of `phase` (the probes' fixture shape).
function onMissionAt(s: GameState, key: MissionKey, phase: CaptainMissionState["phase"]): GameState {
  const mission = {
    kind: "extraction",
    missionKey: key,
    phase,
    phaseProgressTicks: 0,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
    recalled: false,
  } as CaptainMissionState;
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission } : c)) };
}
