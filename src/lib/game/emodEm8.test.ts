// E-MOD EM-8 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-8): the Precursor Lens
// special module, on the real catalog. The plan's tests: masked until identified; mints; the proc acts. Plus the
// standing rules: one per ship (user M8), the Precursor Circuit really feeds it, the piece's rarity and quality lift the
// chance (never inert), the run freezes the proc at dispatch (a run in flight never reads the catalog), offline == live
// (one call == chunked == 1 s steps), a save mid-run replays byte-identically, and the Help and the card tell the truth.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  FABRICATOR_FACILITY_KEY,
  RESEARCH_FACILITY_KEY,
  blueprintRelicLocked,
  freshState,
  moduleEffectScale,
  type AwayMember,
  type EquipmentInstance,
  type EquipmentRarity,
  type Expedition,
  type GameState,
  type ShipTypeKey,
} from "./model";
import { canFabricate, canResearch, installMissingCombatBaselines, startFabricateJob } from "./tick";
import { canFitEquipment, equippedFor, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { advanceExpedition, expeditionCandidates } from "./expedition";
import { generateEquipment } from "./itemgen";
import { addItemQuality } from "./inventory";
import { undiscoveredResearchMask } from "./relics";
import { plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { MODULE_CHANCE_UNITS, PRECURSOR_LENS_MODULE, PRECURSOR_LENS_NUMBERS, UNIVERSAL_MODULES, moduleScanProcs, universalModuleDef, type UniversalModuleDef } from "./shipModules";
import { pieceModuleLines } from "../ui/moduleEffectText";
import { HELP_TOPICS } from "../helpTopics";
import { WIRING_REGISTRY } from "./wiring/registry";

const SHIP = "ship-1";
const LENS = universalModuleDef(PRECURSOR_LENS_MODULE)!;
const scaleOf = (p: EquipmentInstance) => moduleEffectScale(p.rarity, p.quality, p.ascension);

function hullState(hull: ShipTypeKey): GameState {
  const base = freshState();
  return installMissingCombatBaselines({ ...base, credits: new Decimal(1_000_000), ships: base.ships.map((sh) => (sh.id === SHIP ? { ...sh, typeKey: hull } : sh)) });
}
function withoutUtility(s: GameState): GameState {
  const u = equippedFor(s, SHIP).find((e) => e.slotType === "specUtility");
  return u ? unfitEquipmentInstance(s, SHIP, u.id) : s;
}
// A Lens piece minted through the blueprint's own output (the Fabricator's mint).
function mintLens(rarity: EquipmentRarity = "standard", quality = 0, id = `em8-lens-${rarity}-${quality}`): EquipmentInstance {
  const out = BLUEPRINTS.precursorLensBp.equipmentOutput!;
  return generateEquipment({ slotType: out.slotType, varietyKey: out.varietyKey, blueprintKey: "precursorLensBp", iLevel: 20, quality, rarity, ascension: "none", rng: () => 0.5, allocateId: () => id });
}
function install(s0: GameState, piece: EquipmentInstance): GameState {
  const s: GameState = { ...s0, equipment: [...s0.equipment, piece] };
  const v = canFitEquipment(s, SHIP, piece.id);
  if (!v.ok) throw new Error(`install refused: ${v.reason}`);
  return fitEquipment(s, SHIP, piece.id);
}

describe("the def (user M6's ninth row, M8 one per ship)", () => {
  it("a Special on the body-scanned trigger, one more discovery, expeditions only; it validates", () => {
    expect(LENS).toMatchObject({
      id: "precursorLens",
      label: "Precursor Lens",
      category: "special",
      contexts: ["expedition"],
      trigger: { kind: "bodyScanned" },
      chance: PRECURSOR_LENS_NUMBERS.chance,
      effect: { key: "extraDiscovery", magnitude: 1 },
      powerDraw: PRECURSOR_LENS_NUMBERS.powerDraw,
      source: "discovery",
    });
    expect(UNIVERSAL_MODULES.filter((d) => d.category === "special")).toEqual([LENS]);
  });
});

describe("masked until identified; the Precursor Circuit crafts it", () => {
  const lab = (s: GameState = freshState()): GameState => ({ ...s, credits: new Decimal(1_000_000), facilities: { ...s.facilities, [RESEARCH_FACILITY_KEY]: { level: 2 } } });
  it("the research is locked and masked (the set, never the relic) until a Precursor Lens is identified", () => {
    const bp = BLUEPRINTS.precursorLensBp;
    expect(bp.requiresRelicDiscovery).toBe("precursorLens");
    expect(bp.equipmentOutput).toEqual({ slotType: "module", varietyKey: PRECURSOR_LENS_MODULE });
    const locked = lab();
    expect(blueprintRelicLocked(locked, "precursorLensBp")).toBe(true);
    expect(canResearch(locked, "precursorLensBp")).toEqual({ ok: false, reason: "undiscovered" });
    const mask = undiscoveredResearchMask(bp.requiresRelicDiscovery).detail;
    expect(mask).toBe("Requires a Precursor Set relic discovery");
    expect(mask).not.toMatch(/Lens/);
    const open = { ...locked, relicDiscovered: ["precursorLens"] };
    expect(canResearch(open, "precursorLensBp")).toEqual({ ok: true });
  });

  it("researched, it fabricates from a Precursor Circuit, Photonic Gel and an Iridium Catalyst, and refuses without the circuit", () => {
    const inputs = BLUEPRINTS.precursorLensBp.recipe.inputs;
    expect(inputs).toEqual({ precursorCircuit: 1, photonicGel: 2, iridiumCatalyst: 1 });
    const base = freshState();
    let s: GameState = { ...base, researchedBlueprints: [...base.researchedBlueprints, "precursorLensBp"], facilities: { ...base.facilities, [FABRICATOR_FACILITY_KEY]: { level: 2 } } };
    const stocked = (st: GameState, skip?: string) => {
      let inv = st.inventory;
      for (const [id, n] of Object.entries(inputs)) if (id !== skip) inv = addItemQuality(inv, id, new Decimal(n), 0);
      return { ...st, inventory: inv };
    };
    expect(canFabricate(stocked(s, "precursorCircuit"), "precursorLensBp")).toEqual({ ok: false, reason: "materials" });
    s = stocked(s);
    expect(canFabricate(s, "precursorLensBp")).toEqual({ ok: true });
    const r = startFabricateJob(s, "precursorLensBp");
    expect(r.started).toBe(true);
    expect(r.next.inventory.precursorCircuit?.some((q) => q.gt(0)) ?? false).toBe(false);
  });
});

describe("mints and installs (one per ship)", () => {
  it("the minted piece is the Lens: its variety, its draw, the mockup's card", () => {
    const p = mintLens();
    expect(p.slotType).toBe("module");
    expect(p.moduleVariant).toBe(PRECURSOR_LENS_MODULE);
    expect(p.powerDraw).toBe(PRECURSOR_LENS_NUMBERS.powerDraw);
    const lines = pieceModuleLines(p)!;
    expect(lines.kind).toBe("Special · Expeditions");
    expect(lines.gate).toBe("Unlocked: you identified a Precursor Lens relic.");
  });

  it("installs on an Aurora; a second Lens on the same ship is refused (duplicateModule)", () => {
    const s = install(withoutUtility(hullState("aurora")), mintLens("standard", 0, "lens-a"));
    expect(equippedFor(s, SHIP).filter((e) => e.moduleVariant === PRECURSOR_LENS_MODULE)).toHaveLength(1);
    const two: GameState = { ...s, equipment: [...s.equipment, mintLens("standard", 0, "lens-b")] };
    const v = canFitEquipment(two, SHIP, "lens-b");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("duplicateModule");
  });
});

describe("the proc acts (the real catalog, the EM-6 body-scanned engine)", () => {
  const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(id, teamType, SHIP), ...over });
  const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2 }), member("member-11", "science")];
  const dispatch = (piece: EquipmentInstance | null, seed: number): Expedition => {
    const base = withoutUtility(hullState("orion"));
    const s0 = piece ? install(base, piece) : base;
    const s = withSlottedAwayTeams({ ...s0, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
    const res = dispatchPastPropulsion(s, SHIP, 1, expeditionCandidates(s, SHIP)[0].id);
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    return res.expedition;
  };
  const discoveries = (e: Expedition) => e.bodies.reduce((n, b) => n + b.discoveries.length, 0);
  const END = 2_000_000;

  it("the dispatch freezes the Lens's proc: its chance at the piece's own scale, one discovery", () => {
    const std = dispatch(mintLens(), 0x1234);
    expect(std.moduleScanProcs).toEqual([{ moduleId: PRECURSOR_LENS_MODULE, chanceUnits: Math.round(PRECURSOR_LENS_NUMBERS.chance * MODULE_CHANCE_UNITS), count: 1 }]);
    // Rarity and quality are never inert: a better piece rolls a higher chance (MODULE_SCALE_ON), the count stays one.
    const best = mintLens("radiant", 5);
    const hi = dispatch(best, 0x1234).moduleScanProcs!;
    expect(hi[0].count).toBe(1);
    expect(hi[0].chanceUnits).toBe(Math.round(PRECURSOR_LENS_NUMBERS.chance * scaleOf(best) * MODULE_CHANCE_UNITS));
    expect(hi[0].chanceUnits).toBeGreaterThan(std.moduleScanProcs![0].chanceUnits);
    expect(moduleScanProcs([best], scaleOf)).toEqual(hi);
    expect(dispatch(null, 0x1234).moduleScanProcs).toBeUndefined();
  });

  it("the Lens only appends discoveries: every body keeps its own, and some bodies gain one", { timeout: 60_000 }, () => {
    let extra = 0;
    for (const seed of [0x1234, 0x5678, 0x9abc, 0xdef0]) {
      const a = advanceExpedition(dispatch(mintLens(), seed), END);
      const b = advanceExpedition(dispatch(null, seed), END);
      a.bodies.forEach((body, i) => {
        expect(body.discoveries.slice(0, b.bodies[i].discoveries.length).map((d) => d.poiId)).toEqual(b.bodies[i].discoveries.map((d) => d.poiId));
        expect(body.discoveries.length - b.bodies[i].discoveries.length).toBeLessThanOrEqual(1);
      });
      extra += discoveries(a) - discoveries(b);
    }
    expect(extra).toBeGreaterThan(0);
  });

  it("offline == live: one call == chunked == 1 s steps, and a save mid-run continues byte-identically", { timeout: 60_000 }, () => {
    const run = dispatch(mintLens(), 0x5678);
    const one = advanceExpedition(run, END);
    let hourly = run;
    for (let now = run.phaseAnchorSeconds; now < END && hourly.phase !== "complete"; now += 3_600) hourly = advanceExpedition(hourly, now);
    hourly = advanceExpedition(hourly, END);
    expect(JSON.stringify(hourly)).toBe(JSON.stringify(one));
    // 1 s steps through the first scanned body (the first proc roll), then one call to the end.
    const firstScan = (() => {
      for (let t = run.phaseAnchorSeconds + 60; t < END; t += 60) if (advanceExpedition(run, t).bodies.some((b) => b.scanned)) return t;
      throw new Error("no body scanned");
    })();
    let stepped = run;
    for (let now = run.phaseAnchorSeconds + 1; now <= firstScan; now++) stepped = advanceExpedition(stepped, now);
    expect(stepped.bodies.some((b) => b.scanned)).toBe(true);
    // A save mid-run (the JSON round trip the save uses) then the rest of the run.
    const saved = JSON.parse(JSON.stringify(stepped)) as Expedition;
    expect(JSON.stringify(advanceExpedition(saved, END))).toBe(JSON.stringify(one));
    expect(JSON.stringify(advanceExpedition(stepped, END))).toBe(JSON.stringify(one));
  });

  it("a run in flight reads its stamp, never the catalog: a retuned Lens after dispatch moves nothing", () => {
    const run = dispatch(mintLens(), 0x9abc);
    const before = JSON.stringify(advanceExpedition(run, END));
    const catalog = UNIVERSAL_MODULES as UniversalModuleDef[];
    const i = catalog.findIndex((d) => d.id === PRECURSOR_LENS_MODULE);
    const saved = catalog[i];
    try {
      catalog[i] = { ...saved, chance: 1 };
      expect(JSON.stringify(advanceExpedition(run, END))).toBe(before);
    } finally {
      catalog[i] = saved;
    }
  });
});

describe("the player text and the registry tell the truth", () => {
  it("Help names the Special with the engine's own numbers (no em dash, install never fit)", () => {
    const body = HELP_TOPICS.find((t) => t.id === "powerAndModules")!.body;
    expect(body).toContain(`a ${Math.round(PRECURSOR_LENS_NUMBERS.chance * 100)}% chance to uncover one extra hidden discovery`);
    expect(body).toContain(`It draws ${PRECURSOR_LENS_NUMBERS.powerDraw} power.`);
    expect(body).toContain("Precursor Circuit");
    expect(body).not.toMatch(/—|\x2d\x2d/);
    expect(body).not.toMatch(/\b(fit|fits|fitting|fitted)\b/i);
    // The card reads the chance the engine rolls for THIS piece.
    const best = mintLens("radiant", 5);
    const pct = Math.round(PRECURSOR_LENS_NUMBERS.chance * scaleOf(best) * 1000) / 10;
    expect(pieceModuleLines(best)!.effect).toBe(`Each body scanned: a ${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}% chance to uncover one extra hidden discovery.`);
  });

  it("every EM-8 row is LIVE: the module's proc, the relic's first find, the relic's Museum copies; no reserve is left", () => {
    const row = (id: string) => WIRING_REGISTRY.find((e) => e.id === id);
    for (const id of ["ship:UNIVERSAL_MODULES:precursorLens", "relic:em8:precursorLensFirstFind", "relic:RELICS:precursorLens", "facility:BLUEPRINTS:precursorLensBp", "facility:audit:precursorCircuit"]) {
      expect(row(id)?.status, id).toEqual({ kind: "live" });
    }
    expect(row("ship:UNIVERSAL_MODULES:precursorLens")?.probe).toBe("moduleScanDiscoveries");
    expect(row("relic:em8:precursorLensFirstFind")?.probe).toBe("researchableBlueprints");
    expect(row("facility:ITEMS:precursorCircuit:reserved")).toBeUndefined();
  });
});
