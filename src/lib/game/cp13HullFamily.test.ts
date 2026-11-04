// Complement CP-13 (OC-13 "One catalog, by hull"): the hull-family module bonuses. Each family's lines act on its own
// hulls only; moving a module changes its bonus; no module is neutral; a run reads the bonus only when stamped at
// dispatch; the patrol replay fights the live wave's frozen weapon line; one call == chunked == 1 s steps.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { PATROLS, SHIP_TYPES, type GameState, type PatrolKey, type ShipSpec, type ShipTypeKey } from "./model";
import { effectiveShipStats, shipCrewContribution } from "./crewOverlay";
import {
  HULL_FAMILY_MODULE_BONUS,
  hullFamilyBridgeLines,
  hullFamilyQuartersPerk,
  hullFamilyStamp,
  hullFamilyWeaponLine,
  installedQuartersModule,
  quartersCapacityBonus,
  quartersProfessionMultiplier,
  type HullFamilyBridgeStat,
} from "./crewModules";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { installPiece, shipOf, wiringBase, withBuckets, bucketOf } from "./wiring/probes";
import { onHull, stateHash } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withCp13Kit } from "./cp13Goldens.fixture";
import { withoutCp13 } from "./cp13Switch.fixture";
import { hullFamilyBonusLine } from "../crewModuleTileDisplay";
import { HELP_TOPICS } from "../helpTopics";

const SPECS: readonly ShipSpec[] = ["general", "prospector", "tactician", "explorer"];
const HULL_OF: Readonly<Record<ShipSpec, ShipTypeKey>> = { general: "generalFreighter", prospector: "prospectorMiner", tactician: "destroyer", explorer: "aurora" };
const PATROL_KEY = Object.keys(PATROLS)[0] as PatrolKey;
const bridge = (s: GameState): GameState => installPiece(s, { id: "t-bridge", slotType: "bridge", moduleVariant: "bridgeBalancedCommand" });
const quarters = (s: GameState, v = "quartersUtilitarian"): GameState => installPiece(s, { id: "t-quarters", slotType: "quarters", moduleVariant: v });
const withArray = (s: GameState): GameState => installPiece(s, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
const sheet = (s: GameState) => effectiveShipStats(s, shipOf(s));
const run = (s: GameState, n: number, step = 1): GameState => {
  for (let i = 0; i < n; i++) s = economyTick(s, step, () => 0.5);
  return s;
};
const levelled = (s: GameState): GameState => ({ ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) });
const patrolBase = (): GameState => withCp13Kit(asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(100_000) }));

describe("CP-13 hull-family bonuses", () => {
  it("each family's bridge lines appear on its own hulls only, at the catalog size", () => {
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      const s = bridge(wiringBase(hull));
      const lines = hullFamilyBridgeLines(s, shipOf(s))!;
      const own = HULL_FAMILY_MODULE_BONUS[SHIP_TYPES[hull].spec].bridge;
      for (const stat of Object.keys(lines) as HullFamilyBridgeStat[]) expect(lines[stat], `${hull} ${stat}`).toBeCloseTo(own[stat] ?? 0, 12);
    }
  });

  it("the sheet lines act on the sheet: transit and unload (General), yield (Prospector), sensors (Explorer)", () => {
    const lift = (hull: ShipTypeKey, read: (s: GameState) => number): number => {
      const off = withArray(wiringBase(hull));
      return read(bridge(off)) / read(off) - 1;
    };
    expect(lift("generalFreighter", (s) => sheet(s).transitSpeedMult)).toBeCloseTo(0.06, 12);
    expect(lift("generalFreighter", (s) => sheet(s).unloadSpeedMult ?? 1)).toBeCloseTo(0.06, 12);
    expect(lift("prospectorMiner", (s) => sheet(s).extractionYieldMult)).toBeCloseTo(0.06, 12);
    expect(lift("aurora", (s) => sheet(s).sensors)).toBeCloseTo(0.1, 12);
    // Off its family, the same bridge moves none of them.
    expect(lift("aurora", (s) => sheet(s).transitSpeedMult)).toBe(0);
    expect(lift("destroyer", (s) => sheet(s).sensors)).toBe(0);
  });

  it("the quarters lift only the family's two signature divisions, inside the quarters multiplier", () => {
    for (const spec of SPECS) {
      const s = quarters(wiringBase(HULL_OF[spec]), "quartersGuestWing");
      const mod = installedQuartersModule(s, shipOf(s))!;
      for (const p of ["security", "engineering", "science", "medical", "operations", "flightDeck"] as const) {
        const want = HULL_FAMILY_MODULE_BONUS[spec].quarters.divisions.includes(p) ? 1.08 : 1;
        expect(quartersProfessionMultiplier(mod, p, spec), `${spec} ${p}`).toBeCloseTo(want, 12);
        expect(quartersProfessionMultiplier(mod, p)).toBe(1);
      }
    }
  });

  it("moving a module to another hull changes its bonus; no module is neutral", () => {
    const crew = (hull: ShipTypeKey) => withBuckets(wiringBase(hull), [bucketOf("science", "sci.extraction")]);
    const sci = (s: GameState) => shipCrewContribution(s, shipOf(s))["crew.extractionYield"] ?? 0;
    // Science is an Explorer signature division, not a Tactician one: the same module lifts it only on the Aurora.
    expect(sci(quarters(crew("aurora"))) / sci(crew("aurora"))).toBeCloseTo(1 + 0.1 + 0.08, 12);
    expect(sci(quarters(crew("destroyer"))) / sci(crew("destroyer"))).toBeCloseTo(1 + 0.1, 12);
    for (const spec of SPECS) {
      const s = withArray(crew(HULL_OF[spec]));
      expect(sheet(s)).toEqual(withoutCp13(() => sheet(s)));
      expect(hullFamilyStamp(s, shipOf(s))).toBeUndefined();
    }
  });

  it("the perks and the weapon line read on their own hull only", () => {
    const at = (hull: ShipTypeKey) => quarters(bridge(wiringBase(hull)));
    expect(hullFamilyQuartersPerk(at("prospectorMiner"), shipOf(at("prospectorMiner")), "rareFind")).toBeCloseTo(0.03, 12);
    expect(hullFamilyQuartersPerk(at("aurora"), shipOf(at("aurora")), "rareFind")).toBe(0);
    expect(hullFamilyQuartersPerk(at("destroyer"), shipOf(at("destroyer")), "injuryRecovery")).toBeCloseTo(0.15, 12);
    // Explorer: 10% shorter at a Standard module is the care share 0.1 / 0.9 (time / (1 + share) = time x 0.9).
    expect(hullFamilyQuartersPerk(at("aurora"), shipOf(at("aurora")), "bayTime")).toBeCloseTo(0.1 / 0.9, 12);
    expect(hullFamilyWeaponLine(at("destroyer"), shipOf(at("destroyer")))).toBeCloseTo(0.05, 12);
    expect(hullFamilyWeaponLine(at("aurora"), shipOf(at("aurora")))).toBe(0);
  });

  it("a quarters hull bonus never adds crew berths (the capacity principle)", () => {
    for (const spec of SPECS) {
      for (const v of ["quartersUtilitarian", "quartersEfficient", "quartersElite", "quartersScienceWing"]) {
        const s = quarters(wiringBase(HULL_OF[spec]), v);
        expect(quartersCapacityBonus(s, shipOf(s))).toBe(withoutCp13(() => quartersCapacityBonus(s, shipOf(s))));
      }
    }
  });

  it("a mission reads the bonus only when stamped at dispatch; unstamped it plays as before CP-13", () => {
    const base = levelled(withCp13Kit(onHull("prospectorMiner")));
    const fresh = dispatchCaptainOnMission(base, 1, "shortOreRun");
    expect((fresh.next.captains[0].mission as { hullBonus?: 1 }).hullBonus).toBe(1);
    const before = withoutCp13(() => dispatchCaptainOnMission(base, 1, "shortOreRun"));
    expect((before.next.captains[0].mission as { hullBonus?: 1 }).hullBonus).toBeUndefined();
    expect(stateHash(run(before.next, 600))).toBe(withoutCp13(() => stateHash(run(before.next, 600))));
    expect(stateHash(run(fresh.next, 600))).not.toBe(stateHash(run(before.next, 600)));
  });

  // Offline == live: the offline catch-up (tick) over one span, in chunks, and in 1 s steps lands on the same state.
  it("one call == chunked == 1 s steps on a stamped mission and a stamped Repeat patrol", () => {
    const m = dispatchCaptainOnMission(levelled(withCp13Kit(onHull("generalFreighter"))), 1, "shortOreRun").next;
    const p = dispatchCaptainOnPatrol(patrolBase(), 1, PATROL_KEY, "balanced", true).next;
    const offline = (s: GameState, n: number, step: number): GameState => {
      for (let i = 0; i < n; i++) s = tick(step, s, () => 0.5);
      return s;
    };
    for (const start of [m, p]) {
      expect((start.captains[0].mission as { hullBonus?: 1 }).hullBonus).toBe(1);
      const steps = offline(start, 900, 1);
      expect(stateHash(offline(start, 9, 100))).toBe(stateHash(steps));
      expect(stateHash(offline(start, 1, 900))).toBe(stateHash(steps));
    }
  });

  it("a patrol freezes the weapon line per cycle, and the replay fights it", () => {
    const r = dispatchCaptainOnPatrol(patrolBase(), 1, PATROL_KEY, "aggressive", true);
    const mission = r.next.captains[0].mission as { hullWeapon?: number; hullBonus?: 1 };
    expect(mission.hullBonus).toBe(1);
    expect(mission.hullWeapon).toBeCloseTo(0.05, 12);
    const replay = replayPatrol(r.next, r.next.captains[0]);
    const unlined = { ...r.next, captains: r.next.captains.map((c, i) => (i === 0 ? { ...c, mission: { ...(c.mission as object), hullWeapon: undefined } as typeof c.mission } : c)) };
    expect(replay.available).toBe(true);
    expect(JSON.stringify(replay.waves)).not.toBe(JSON.stringify(replayPatrol(unlined, unlined.captains[0]).waves));
    // A patrol dispatched before CP-13 freezes none, and its relaunches freeze none either.
    const before = withoutCp13(() => dispatchCaptainOnPatrol(patrolBase(), 1, PATROL_KEY, "aggressive", true));
    const later = run(before.next, 3000);
    const m = later.captains[0].mission as { hullWeapon?: number; hullBonus?: 1 } | null;
    expect(m?.hullWeapon).toBeUndefined();
    expect(m?.hullBonus).toBeUndefined();
  });

  it("the tile line and Help read the engine's numbers", () => {
    const s = quarters(bridge(wiringBase("aurora")));
    const piece = (x: GameState, id: string) => x.equipment.find((e) => e.id === id)!;
    expect(hullFamilyBonusLine(s, shipOf(s), piece(s, "t-bridge"))).toBe("Hull bonus on Explorer: sensors +10%");
    expect(hullFamilyBonusLine(s, shipOf(s), piece(s, "t-quarters"))).toBe("Hull bonus on Explorer: Science and Medical crew +8%, ground-team medical bay time 10% shorter");
    const g = quarters(bridge(wiringBase("generalFreighter")));
    expect(hullFamilyBonusLine(g, shipOf(g), piece(g, "t-bridge"))).toBe("Hull bonus on General: FTL transit speed +6% and unload speed +6%");
    expect(hullFamilyBonusLine(g, shipOf(g), piece(g, "t-quarters"))).toBe("Hull bonus on General: Operations and Flight Deck crew +8%, guest quarters +10%");
    const d = quarters(bridge(wiringBase("destroyer")));
    expect(hullFamilyBonusLine(d, shipOf(d), piece(d, "t-quarters"))).toBe("Hull bonus on Tactician: Security and Engineering crew +8%, injured crew recover 15% faster");
    expect(hullFamilyBonusLine(d, shipOf(d), piece(d, "t-bridge"))).toBe("Hull bonus on Tactician: weapon damage +5%");
    const p = quarters(bridge(wiringBase("prospectorMiner")));
    expect(hullFamilyBonusLine(p, shipOf(p), piece(p, "t-quarters"))).toBe("Hull bonus on Prospector: Engineering and Science crew +8%, +3% rare finds on mining and survey hauls");
    // A better module lifts its hull bonus by the same share as its own effect.
    const stellar = installPiece(wiringBase("aurora"), { id: "t-bridge", slotType: "bridge", moduleVariant: "bridgeBalancedCommand", rarity: "stellar", quality: 2 });
    expect(hullFamilyBonusLine(stellar, shipOf(stellar), piece(stellar, "t-bridge"))).not.toBe("Hull bonus on Explorer: sensors +10%");
    const help = HELP_TOPICS.find((t) => t.id === "hullBonuses")!.body;
    expect(help).toContain("Explorer hulls (Orion, Aurora and Eir) +10% sensors");
    expect(help).toContain("Tactician: Security and Engineering crew +8%, and injured crew recover 15% faster in the medical bay");
    expect(help).toContain("Prospector: Engineering and Science crew +8%, and +3% rare finds on mining and survey hauls");
    expect(help).not.toMatch(/—|--|\bfit\b|fitting/);
  });
});
