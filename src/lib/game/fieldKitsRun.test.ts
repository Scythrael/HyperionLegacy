// Field Kits FKR-7 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-7): the run plumbing. Flag 2 and the
// frozen free basic set stamped at dispatch (behind FIELD_KITS_RUNS_LIVE, passed true here), each Security member's pack
// from stock (lowest quality first), the off-by-default Quartermaster top-up, basics and charges refreshed as a crew
// lands on an objective, the spends carried fight to fight, the Injury Kit share into that member's bay time, the unused
// extras home at claim, the Quartermaster kit sale, the pack preference setters and the loadout round trip.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionBody, type GambitProgram, type GameState, type GroundFightRecord, type GroundTeamRun, type ShipGroundTeam } from "./model";
import { FIELD_KITS_CATALOG_VERSION, FIELD_KITS_RUNS_LIVE, FIELD_KIT_IDS, FIELD_KIT_PRICES, freeBasicSet } from "./fieldKits";
import {
  carriedExtras,
  defaultMemberPack,
  fieldKitsStamp,
  memberPackPreference,
  planDispatchPacks,
  refreshObjectiveSupplies,
  returnCarriedExtras,
  spendFightSupplies,
} from "./fieldKitsRun";
import { advanceExpedition, claimExpedition, startExpedition } from "./expedition";
import { applyGroundOpsEdit, groundOpsAssignIdle, groundOpsBodyScanned, groundTeamBaySeconds, initGroundTasks } from "./groundOps";
import { getBucket, itemTotal } from "./inventory";
import { shipSupportHeads } from "./gambit";
import { setGroundTeamTopUp, setMemberPack } from "./groundTeams";
import { shipGroundTeams } from "./groundTeamSlots";
import { applyGroundTeamLoadout, checkInGroundTeamLoadout, createGroundTeamLoadout } from "./armory";
import { buyFieldKits, canBuyFieldKits, topUpAtLaunch } from "./quartermaster";
import { asPreCurveDispatch, plainAwayMember, withoutFieldKits } from "./awayTeamTestFixtures";
import { deserialize, migrate, serialize, type SaveFile } from "./save";

const T0 = 100_000;
const FINAL = T0 + 2_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const MEDICS = new Set(["member-3", "member-6"]);
const GRENADIERS: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-2": "stunGrenade", "member-4": "toxinGrenade" };
const SPEND: GambitProgram = [
  { target: "allyDowned", params: { kitId: "injuryKit" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "splint" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "firstAidKit" }, action: "useItem" },
  { target: "foeLargestGroup", action: "throwGrenade" },
  { target: "foeHighestThreat", action: "attack" },
  { target: "foeNearest", action: "attack" },
];

function grenade(id: string, variety: string, wearer: string): EquipmentInstance {
  return {
    id,
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: { groundStatusChance: 30 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

interface CrewOpts {
  seed?: number;
  program?: GambitProgram;
  stock?: Record<string, number[]>;
  credits?: number;
  teams?: Partial<ShipGroundTeam>[];
}

// Two Ground teams of three Security and three Science; medics member-3 and member-6; three grenadiers.
function crewed(o: CrewOpts = {}): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [0, 1].map((i) => ({ kind: "ground", security: SEC.slice(3 * i, 3 * i + 3), science: SCI.slice(3 * i, 3 * i + 3), helpOthers: false, ...(o.teams?.[i] ?? {}) }));
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(teamType === "security" && MEDICS.has(id) ? { traits: ["fieldMedic"] } : {}),
    ...(o.program && teamType === "security" ? { gambit: o.program.map((r) => ({ ...r, ...(r.params ? { params: { ...r.params } } : {}) })) } : {}),
  });
  const stock: Record<string, Decimal[]> = {};
  for (const [kit, buckets] of Object.entries(o.stock ?? {})) stock[kit] = buckets.map((n) => new Decimal(n));
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed: o.seed ?? 0xc4a2,
    credits: new Decimal(o.credits ?? 0),
    inventory: { ...base.inventory, ...stock },
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    equipment: [...base.equipment, ...Object.entries(GRENADIERS).map(([wearer, variety], i) => grenade(`equip-${900 + i}`, variety, wearer))],
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function dispatch(state: GameState, on = true) {
  // Safe first runs SF-3: the run at nominal (asPreCurveDispatch), as these tests were written against.
  const res = asPreCurveDispatch(startExpedition(state, "ship-1", 1, "cand-0", true, on));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res;
}

const held = (s: GameState, kit: string): number => itemTotal(s.inventory, kit).toNumber();
const sumPacks = (exp: Expedition): Partial<Record<string, number>> => carriedExtras(exp);

// A Field Kits run (dispatched with the switch on) placed on one scanned body with `pois`, as FKR-6's goldens place one.
function placedRun(state: GameState, pois: string[], risk: BodyRiskGrades = { ...CALM, combat: 3 }, edit?: (e: Expedition) => void): Expedition {
  const d = dispatch(state).expedition!;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.2,
    scanned: true,
    discoveries: pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...risk },
  };
  const exp: Expedition = structuredClone({
    ...d,
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: risk.combat, fauna: risk.fauna, flora: risk.flora }, difficultyTier: 1, affixCatalog: 2 },
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  edit?.(exp);
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

describe("FKR-7 the switch and the stamp", () => {
  it("the runs switch stays OFF until the pack UI lands (FKR-9 / FKR-10); off, a dispatch stamps nothing and packs nothing", () => {
    expect(FIELD_KITS_RUNS_LIVE).toBe(false);
    const s = crewed({ stock: { firstAidKit: [9] }, credits: 5000, teams: [{ topUp: true }] });
    const res = dispatch(s, false);
    expect("fieldKits" in res.expedition!).toBe(false);
    for (const t of res.expedition!.groundOps!.teams) expect("kits" in t).toBe(false);
    expect(held(res.next, "firstAidKit")).toBe(9);
    expect(res.next.credits.eq(5000)).toBe(true);
  });

  it("on, the run is stamped with the catalog and the free basic set frozen on the ship's support headcount", () => {
    const s = crewed();
    const exp = dispatch(s).expedition!;
    expect(exp.fieldKits).toEqual({ catalog: FIELD_KITS_CATALOG_VERSION, freeBasics: freeBasicSet(shipSupportHeads(s, s.ships[0])) });
    expect(fieldKitsStamp(s, s.ships[0])).toEqual(exp.fieldKits);
    expect(exp.fieldKits!.freeBasics!.firstAidKit).toBeGreaterThanOrEqual(1);
  });
});

describe("FKR-7 packs (FK4 per member, N16 default)", () => {
  it("the default pack is one of each kit the member can use (Advanced Medical needs Medical Training)", () => {
    expect(defaultMemberPack(false)).toEqual({ firstAidKit: 1, antitoxin: 1, combatStim: 1 });
    expect(defaultMemberPack(true)).toEqual({ firstAidKit: 1, antitoxin: 1, combatStim: 1, splint: 1, traumaKit: 1, injuryKit: 1 });
  });

  it("a stored preference wins (an empty one packs nothing); a kit the member cannot use is never packed", () => {
    const team = { packs: { a: { splint: 2, firstAidKit: 3 }, b: {} } };
    expect(memberPackPreference(team, "a", false)).toEqual({ firstAidKit: 3 });
    expect(memberPackPreference(team, "a", true)).toEqual({ firstAidKit: 3, splint: 2 });
    expect(memberPackPreference(team, "b", true)).toEqual({});
    expect(memberPackPreference(team, "c", false)).toEqual(defaultMemberPack(false));
  });

  it("a stored pack whose every count is bad falls back to the default; a stored {} still packs nothing", () => {
    const packs = {
      "member-1": { firstAidKit: 0, splint: "two", antitoxin: Number.NaN, combatStim: -1 },
      "member-2": {},
      "member-3": { splint: 2.7, combatStim: 0 },
    } as unknown as ShipGroundTeam["packs"];
    const team = shipGroundTeams(crewed({ teams: [{ packs }] }).ships[0])[0];
    expect(team.packs).toEqual({ "member-2": {}, "member-3": { splint: 2 } });
    expect(memberPackPreference(team, "member-1", true)).toEqual(defaultMemberPack(true));
    expect(memberPackPreference(team, "member-2", true)).toEqual({});
    expect(memberPackPreference(team, "member-3", true)).toEqual({ splint: 2 });
    // Every member's pack bad: no preference is kept at all.
    const allBad = { "member-1": { firstAidKit: 0 } } as unknown as ShipGroundTeam["packs"];
    expect(shipGroundTeams(crewed({ teams: [{ packs: allBad }] }).ships[0])[0].packs).toBeUndefined();
  });

  it("dispatch deducts EXACTLY the packs, from stock in team then slot order, lowest quality first", () => {
    const s = crewed({ stock: { firstAidKit: [4], antitoxin: [1, 9], splint: [1], injuryKit: [3] } });
    const res = dispatch(s);
    const exp = res.expedition!;
    // Default packs everywhere: First Aid for the first four Security members in team then slot order.
    expect(exp.groundOps!.teams[0].kits).toEqual({
      "member-1": { firstAidKit: 1, antitoxin: 1 },
      "member-2": { firstAidKit: 1, antitoxin: 1 },
      "member-3": { firstAidKit: 1, antitoxin: 1, splint: 1, injuryKit: 1 },
    });
    expect(exp.groundOps!.teams[1].kits).toEqual({
      "member-4": { firstAidKit: 1, antitoxin: 1 },
      "member-5": { antitoxin: 1 },
      "member-6": { antitoxin: 1, injuryKit: 1 },
    });
    const packed = sumPacks(exp);
    for (const kit of FIELD_KIT_IDS) expect(held(s, kit) - held(res.next, kit), kit).toBe(packed[kit] ?? 0);
    // Six Antitoxins: the one at quality 0 first, then five of the nine at quality 1.
    expect(getBucket(res.next.inventory, "antitoxin", 0).toNumber()).toBe(0);
    expect(getBucket(res.next.inventory, "antitoxin", 1).toNumber()).toBe(4);
    // Science packs nothing (a Survey team would pack nothing).
    for (const t of exp.groundOps!.teams) for (const id of t.scienceIds) expect(t.kits?.[id]).toBeUndefined();
  });

  it("with no stock nothing is packed and the dispatch still launches", () => {
    const res = dispatch(crewed());
    for (const t of res.expedition!.groundOps!.teams) expect(t.kits).toBeUndefined();
  });
});

describe("FKR-7 the Quartermaster top-up at launch (credit sinks pass, off by default)", () => {
  it("off by default: a shortfall is NOT bought and no credit is spent", () => {
    const s = crewed({ credits: 10_000 });
    expect(shipGroundTeams(s.ships[0]).every((t) => t.topUp === undefined)).toBe(true);
    const res = dispatch(s);
    expect(res.next.credits.eq(10_000)).toBe(true);
    expect(sumPacks(res.expedition!)).toEqual({});
  });

  it("on (Alpha only): Alpha's members' shortfall is bought at the listed price, Bravo's is not", () => {
    const s = setGroundTeamTopUp(crewed({ credits: 10_000, stock: { firstAidKit: [1] } }), "ship-1", 0, true);
    const res = dispatch(s);
    const alpha = res.expedition!.groundOps!.teams[0].kits!;
    expect(alpha["member-1"]).toEqual({ firstAidKit: 1, antitoxin: 1, combatStim: 1 }); // the one stocked First Aid Kit + bought
    expect(alpha["member-3"]).toEqual(defaultMemberPack(true));
    expect(res.expedition!.groundOps!.teams[1].kits).toBeUndefined();
    const bought = { firstAidKit: 2, antitoxin: 3, combatStim: 3, splint: 1, traumaKit: 1, injuryKit: 1 };
    const cost = Object.entries(bought).reduce((n, [k, q]) => n + q * FIELD_KIT_PRICES[k as keyof typeof FIELD_KIT_PRICES], 0);
    expect(10_000 - res.next.credits.toNumber()).toBe(cost);
    expect(held(res.next, "firstAidKit")).toBe(0);
    expect(topUpAtLaunch(s, "ship-1")).toEqual({ bought, cost });
  });

  it("buys only what the credits allow, member by member, and never refuses the launch", () => {
    const s = setGroundTeamTopUp(crewed({ credits: 130 }), "ship-1", 0, true);
    const res = dispatch(s);
    // member-1: a First Aid Kit (60) and an Antitoxin (60); the Combat Stim (150) is out of reach, so is the rest.
    expect(res.expedition!.groundOps!.teams[0].kits).toEqual({ "member-1": { firstAidKit: 1, antitoxin: 1 } });
    expect(res.next.credits.toNumber()).toBe(10);
  });

  it("setters: the toggle and a pack preference shape only the next dispatch, and an unknown member is refused", () => {
    const s0 = crewed();
    const s1 = setMemberPack(s0, "ship-1", 0, "member-1", { firstAidKit: 2, splint: 1.7 });
    expect(shipGroundTeams(s1.ships[0])[0].packs).toEqual({ "member-1": { firstAidKit: 2, splint: 1 } });
    expect(setMemberPack(s1, "ship-1", 0, "member-1", { firstAidKit: 2, splint: 1 })).toBe(s1);
    expect(setMemberPack(s1, "ship-1", 0, "member-4", { firstAidKit: 1 })).toBe(s1);
    expect(shipGroundTeams(setMemberPack(s1, "ship-1", 0, "member-1", null).ships[0])[0].packs).toBeUndefined();
    const s2 = setGroundTeamTopUp(s0, "ship-1", 1, true);
    expect(shipGroundTeams(s2.ships[0])[1].topUp).toBe(true);
    expect(setGroundTeamTopUp(s2, "ship-1", 1, true)).toBe(s2);
    expect(shipGroundTeams(setGroundTeamTopUp(s2, "ship-1", 1, false).ships[0])[1].topUp).toBeUndefined();
  });
});

describe("FKR-7 each objective and each fight", () => {
  it("refresh: as the crew lands every Security member's free basics refill and every charge resets to full", () => {
    const team = { securityIds: ["a", "b"], basics: { a: { firstAidKit: 0 } }, charges: { a: 0 } } as unknown as GroundTeamRun;
    refreshObjectiveSupplies({ fieldKits: { catalog: 1, freeBasics: { firstAidKit: 2 } } }, [team]);
    expect(team.basics).toEqual({ a: { firstAidKit: 2 }, b: { firstAidKit: 2 } });
    expect(team.charges).toBeUndefined();
    const plain = { securityIds: ["a"], charges: { a: 0 } } as unknown as GroundTeamRun;
    refreshObjectiveSupplies({}, [plain]);
    expect(plain.charges).toEqual({ a: 0 });
  });

  it("a fight's spends come off the team (charges, basics, extras) and its Injury Kit shares add up on the trip", () => {
    const exp = { fieldKits: { catalog: 1 }, roster: { security: [], science: [] } } as unknown as Expedition;
    const team = { securityIds: ["a", "b"], basics: { a: { firstAidKit: 2 } }, kits: { b: { splint: 2, injuryKit: 1 } }, charges: { a: 3 } } as unknown as GroundTeamRun;
    const record: Pick<GroundFightRecord, "chargesUsed" | "basicsUsed" | "kitsUsed" | "treated"> = {
      basicsUsed: { a: { firstAidKit: 1 } },
      kitsUsed: { b: { splint: 1, injuryKit: 1 } },
      treated: { a: 0.5 },
    };
    spendFightSupplies(exp, [team], record, () => team);
    spendFightSupplies(exp, [team], { treated: { a: 0.5 } }, () => team);
    expect(team.basics).toEqual({ a: { firstAidKit: 1 } });
    expect(team.kits).toEqual({ b: { splint: 1, injuryKit: 0 } });
    expect(team.treatment).toEqual({ a: 1 });
    const before = structuredClone(team);
    spendFightSupplies({ roster: exp.roster }, [team], record, () => team);
    expect(team).toEqual(before);
  });

  it("an Injury Kit shortens ONLY the treated member's bay time", () => {
    const factors = { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 };
    const exp = { roster: { security: [], science: [] }, groundOps: { factors } } as unknown as Expedition;
    const team = { securityIds: ["a", "b"], scienceIds: [], conditions: { a: ["brokenBone"], b: ["brokenBone"] }, treatment: { a: 0.5 } };
    expect(groundTeamBaySeconds(exp, team)).toEqual({ a: 2400, b: 3600 });
  });

  it("a whole stamped run: every landing refreshes, spent extras never come home, the rest do (even over the cap)", { timeout: 120_000 }, () => {
    const s = crewed({ program: SPEND, stock: { firstAidKit: [6], splint: [2], injuryKit: [2], antitoxin: [6], combatStim: [6], traumaKit: [2] } });
    const res = dispatch(s);
    const exp = placedRun(s, ["enemyColony", "derelictOutpost"]);
    const packed = sumPacks(exp);
    expect(Object.keys(packed).length).toBeGreaterThan(0);
    const done = advanceExpedition(exp, FINAL);
    expect(done.phase).toBe("complete");
    // Every landing refilled the free set: at each drop's end the crew holds exactly the frozen set, charges full.
    const free = exp.fieldKits!.freeBasics!;
    const drops = done.groundOps!.history.filter((r) => r.step === "deploy");
    expect(drops.length).toBeGreaterThan(1);
    for (const d of drops) {
      const at = advanceExpedition(exp, d.endedAt);
      const team = at.groundOps!.teams.find((t) => t.index === d.teamIndex)!;
      for (const id of team.securityIds) expect(team.basics?.[id], `${id} @ ${d.endedAt}`).toEqual(free);
      expect(team.charges).toBeUndefined();
    }
    // Extras: some were spent across the run (never refilled), none grew; the claim brings back exactly what is left.
    const left = carriedExtras(done);
    for (const kit of FIELD_KIT_IDS) expect(left[kit] ?? 0).toBeLessThanOrEqual(packed[kit] ?? 0);
    expect(FIELD_KIT_IDS.some((k) => (left[k] ?? 0) < (packed[k] ?? 0))).toBe(true);
    const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
    expect(claimed.success).toBe(true);
    for (const kit of FIELD_KIT_IDS) expect(held(claimed.next, kit) - held(res.next, kit), kit).toBe(left[kit] ?? 0);
    // Over the cap: a warehouse already at its cap still takes them back (call 17).
    const capped = { ...res.next, inventory: { ...res.next.inventory, firstAidKit: [new Decimal(1_000_000)] } };
    expect(held(returnCarriedExtras(capped, { groundOps: { teams: [{ kits: { x: { firstAidKit: 3 } } }] } } as unknown as Expedition), "firstAidKit")).toBe(1_000_003);
  });

  it("parity: one call == 997 s chunks == 1 s steps with packs, a Reinforcing objective and a joint crew", { timeout: 120_000 }, () => {
    const s = crewed({ program: SPEND, stock: { firstAidKit: [6], splint: [2], injuryKit: [2] } });
    const exp = placedRun(s, ["enemyColony", "derelictOutpost", "mineralOutcrop"], { ...CALM, combat: 3 }, (e) => {
      const task = e.bodies[0].activities[0];
      task.affixes = [{ id: "reinforcing", rank: 3, alignment: "negative" }];
      task.difficultyScore = 10;
    });
    const joint = exp.bodies[0].activities[1];
    expect(applyGroundOpsEdit(exp, { kind: "assign", taskId: joint.id, teamIndex: 0, partners: [1], position: 0 }, T0).ok).toBe(true);
    const far = T0 + 40_000;
    const one = advanceExpedition(exp, far);
    expect(one.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
    expect(one.groundOps!.history.some((r) => r.teamIndex === 1 && r.step === "staging" && r.taskId === joint.id)).toBe(true);
    const chunked = (step: number, to: number) => {
      let e = exp;
      for (let t = T0 + step; t < to; t += step) e = advanceExpedition(e, t);
      return advanceExpedition(e, to);
    };
    expect(chunked(997, far)).toEqual(one);
    const hour = T0 + 3600;
    expect(chunked(1, hour)).toEqual(advanceExpedition(exp, hour));
  });

  it("a save mid-objective (packs, basics, charges on the run; packs and the top-up on the ship) reloads and resolves identically", { timeout: 120_000 }, () => {
    const s = setGroundTeamTopUp(setMemberPack(crewed({ program: SPEND, stock: { firstAidKit: [6], splint: [2], injuryKit: [2] } }), "ship-1", 0, "member-1", { firstAidKit: 2 }), "ship-1", 0, true);
    const exp = placedRun(s, ["enemyColony", "derelictOutpost"]);
    const firstFightEnd = advanceExpedition(exp, FINAL).groundOps!.history.find((r) => r.step === "fight")!.endedAt;
    const mid = advanceExpedition(exp, firstFightEnd + 1);
    expect(mid.groundOps!.teams.some((t) => t.basics !== undefined)).toBe(true);
    const state = { ...s, gameTimeSeconds: firstFightEnd + 1, expeditions: [mid] };
    const loaded = migrate(deserialize(serialize(state, 0)) as SaveFile);
    expect(loaded.expeditions[0]).toEqual(mid);
    expect(shipGroundTeams(loaded.ships[0])[0]).toMatchObject({ packs: { "member-1": { firstAidKit: 2 } }, topUp: true });
    expect(advanceExpedition(loaded.expeditions[0], FINAL)).toEqual(advanceExpedition(exp, FINAL));
  });

  it("a run without flag 2 never writes kits, basics, charges or treatment", { timeout: 120_000 }, () => {
    const s = crewed({ program: SPEND });
    const exp = withoutFieldKits(placedRun(s, ["enemyColony", "derelictOutpost"]));
    const done = advanceExpedition(exp, FINAL);
    for (const t of done.groundOps!.teams) for (const k of ["kits", "basics", "charges", "treatment"]) expect(k in t, k).toBe(false);
  });
});

describe("FKR-7 the Quartermaster kit sale", () => {
  it("sells a kit at its listed price into the warehouse, and refuses an unknown kit, a bad count, too few credits or a full warehouse", () => {
    const s = { ...freshState(), credits: new Decimal(200) };
    const r = buyFieldKits(s, "firstAidKit", 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cost).toBe(3 * FIELD_KIT_PRICES.firstAidKit);
    expect(r.next.credits.toNumber()).toBe(200 - 180);
    expect(held(r.next, "firstAidKit")).toBe(3);
    expect(canBuyFieldKits(s, "deuteriumIce", 1)).toEqual({ ok: false, reason: "noSuchKit" });
    expect(canBuyFieldKits(s, "firstAidKit", 0)).toEqual({ ok: false, reason: "noneRequested" });
    expect(canBuyFieldKits(s, "firstAidKit", 1.5)).toEqual({ ok: false, reason: "noneRequested" });
    expect(canBuyFieldKits(s, "traumaKit", 1)).toEqual({ ok: false, reason: "insufficientCredits" });
    const full = { ...s, inventory: { ...s.inventory, firstAidKit: [new Decimal(1_000_000)] } };
    expect(canBuyFieldKits(full, "firstAidKit", 1)).toEqual({ ok: false, reason: "overCap" });
  });
});

describe("FKR-7 the loadout round trip (SquadLoadoutKit.consumables written and applied)", () => {
  it("a team's pack preferences ride in the loadout and land on whoever holds those slots when it is applied", () => {
    const s0 = setMemberPack(crewed(), "ship-1", 0, "member-2", { splint: 2, firstAidKit: 1 });
    const made = createGroundTeamLoadout(s0, "ship-1", 0, "Kits");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const loadout = made.next.squadLoadouts.find((l) => l.id === made.loadoutId)!;
    expect(loadout.security.map((k) => k.consumables)).toEqual([undefined, { splint: 2, firstAidKit: 1 }, undefined]);
    // Check it in, clear the preference, apply it again: the preference comes back from the loadout.
    const rested = checkInGroundTeamLoadout(made.next, made.loadoutId);
    expect(rested.ok).toBe(true);
    if (!rested.ok) return;
    const cleared = setMemberPack(rested.next, "ship-1", 0, "member-2", null);
    expect(shipGroundTeams(cleared.ships[0])[0].packs).toBeUndefined();
    const applied = applyGroundTeamLoadout(cleared, made.loadoutId, "ship-1", 0);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(shipGroundTeams(applied.next.ships[0])[0].packs).toEqual({ "member-2": { firstAidKit: 1, splint: 2 } });
  });
});
