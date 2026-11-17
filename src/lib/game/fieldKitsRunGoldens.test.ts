// Field Kits FKR-7 goldens (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-7), captured on FKR-6's engine
// (047b133) BEFORE any FKR-7 engine edit. FKR-7 plumbs the run: flag 2 stamped at dispatch (behind its own switch), each
// member's pack deducted from stock, the free basics and grenade charges refreshed at each objective start, the spends
// carried fight to fight, the Injury Kit share into the medical bay, the unused extras home at claim. These pin:
//   - SWITCH OFF: a real dispatch from a state that HOLDS kit stock, credits, a per-member pack preference and a team
//     top-up toggle, run to its claim. While the stamp switch is off nothing a player can reach moves, so the dispatch
//     and the claim must stay byte-identical across FKR-7 (no stock leaves, no credit is spent, no flag is stamped).
//   - STAMPED BY HAND: a run stamped with flag 2 by hand whose teams carry extras placed by hand (no engine wrote them
//     before FKR-7, and no fight read them). FKR-7 MOVES it on purpose and names the move: the fights now read the
//     teams' kits, basics refresh each objective and charges carry between an objective's fights.
//   - ITS UNSTAMPED TWIN (withoutFieldKits): must stay byte-identical across FKR-7.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// OC-F14 (the field repair rules stamped at dispatch on a system mixing repair worlds with other bodies) came after every pin
// here, traced: the file runs with it off (fieldRepairRulesSwitch.fixture.ts), so its pins keep proving their own slice
// (fieldRepairOrderGoldens.test.ts pins OC-F14's moves and proves them with the switch off).
import { repairRulesOffForThisFile } from "./fieldRepairRulesSwitch.fixture";
repairRulesOffForThisFile();
import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionBody, type GambitProgram, type GameState, type ShipGroundTeam } from "./model";
import { FIELD_KITS_CATALOG_VERSION, FIELD_KITS_RUNS_LIVE } from "./fieldKits";
import { carriedExtras } from "./fieldKitsRun";
import { topUpAtLaunch } from "./quartermaster";
import { advanceExpedition, claimExpedition } from "./expedition";
import { groundCrewClearOdds, groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { itemTotal } from "./inventory";
import { asPreCurveDispatch, plainAwayMember, withoutFieldKits, withoutRelicBlanks, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

const T0 = 100_000;
const FINAL = T0 + 2_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const GRENADIERS: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-2": "stunGrenade", "member-4": "toxinGrenade" };

// A program that spends kits and throws: First Aid on an afflicted ally, an Injury Kit on a downed one, a Splint, then
// a grenade at the largest group, then attacks.
const KIT_PROGRAM: GambitProgram = [
  { target: "allyDowned", params: { kitId: "injuryKit" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "splint" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "firstAidKit" }, action: "useItem" },
  { target: "foeLargestGroup", action: "throwGrenade" },
  { target: "foeHighestThreat", action: "attack" },
  { target: "foeNearest", action: "attack" },
];

function piece(id: string, variety: string, wearer: string): EquipmentInstance {
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
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// Two ground teams; three grenadiers; a medic on each team (member-3, member-6) running `program` (absent: the built-in
// default). The state holds kit stock (two Antitoxin quality buckets), 2,000 credits, a pack preference for two members
// on the ship and the top-up toggle on Alpha (the FKR-7 fields; nothing reads them before FKR-7).
function crewed(expeditionSeed: number, program?: GambitProgram): GameState {
  const base = freshState();
  const teams = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false, packs: { "member-3": { splint: 2, injuryKit: 1 }, "member-1": { firstAidKit: 3 } }, topUp: true },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ] as unknown as ShipGroundTeam[];
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(teamType === "security" && (id === "member-3" || id === "member-6") ? { traits: ["fieldMedic"] } : {}),
    ...(program && teamType === "security" ? { gambit: program.map((r) => ({ ...r, ...(r.params ? { params: { ...r.params } } : {}) })) } : {}),
  });
  const gear = Object.entries(GRENADIERS).map(([wearer, variety], i) => piece(`equip-${900 + i}`, variety, wearer));
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    credits: new Decimal(2000),
    inventory: {
      ...base.inventory,
      firstAidKit: [new Decimal(5)],
      splint: [new Decimal(1)],
      antitoxin: [new Decimal(1), new Decimal(2)],
      injuryKit: [new Decimal(1)],
    },
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    equipment: [...base.equipment, ...gear],
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The extras placed by hand on the stamped run's teams (memberId -> kit -> count).
const HAND_KITS: readonly Record<string, Record<string, number>>[] = [
  { "member-1": { firstAidKit: 2 }, "member-3": { splint: 2, injuryKit: 1, firstAidKit: 1 } },
  { "member-6": { injuryKit: 1, firstAidKit: 2 } },
];

// A dispatched run placed on one scanned body with `pois`, flag 2 stamped by hand and HAND_KITS on its teams.
function stampedRun(state: GameState, pois: string[], risk: BodyRiskGrades, hazard = 0.2): Expedition {
  const res = dispatchPastPropulsion(state, "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  // Relics v2 R2-2: pinned on the record as dispatched before R2-2 (withoutRelicBlanks: no relic blanks flag).
  const d = withoutRelicBlanks(withoutFieldKits(res.expedition));
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard,
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
    // Catalog 1 as a literal (timed grenades, 2026-10-21): the Stun and Toxin throws here stay the pre-fuse run.
    fieldKits: { catalog: 1 },
  });
  exp.groundOps!.teams.forEach((t, i) => {
    (t as unknown as Record<string, unknown>).kits = structuredClone(HAND_KITS[i] ?? {});
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

// The run's ground operations after 200,000 s, the first objective's clear odds for Alpha, the claim's whole state.
function runPins(exp: Expedition, state: GameState): { run: string; odds: string; claim: string } {
  const odds = groundCrewClearOdds(exp, [exp.groundOps!.teams[0].index], exp.bodies[0].activities[0].id);
  const done = advanceExpedition(exp, FINAL);
  const claimed = done.phase === "complete" ? claimExpedition({ ...state, expeditions: [done] }, done.id) : null;
  return {
    run: hash(advanceExpedition(exp, T0 + 200_000).groundOps),
    odds: hash(odds),
    claim: claimed && claimed.success ? stateHash(claimed.next) : `unclaimed:${done.phase}`,
  };
}

const SEED = 0xc4a2;
const SWITCH_OFF_SEED = 0x51f3;

// Captured on FKR-6 (047b133).
const SWITCH_OFF_PINS = { dispatch: "de6856f1", claim: "b4583b50" } as const;
const STAMPED_PINS = { run: "61824ec6", odds: "fae5feaa", claim: "268249ad" } as const;
const UNSTAMPED_TWIN_PINS = { run: "65e15d57", odds: "fae5feaa", claim: "ceb4d88d" } as const;

// MOVED AT FKR-7, named: the stamped run's fights now read the teams' hand-placed extras and spend them (an Injury Kit,
// a Splint, First Aid Kits by the program's Use Item rules), its grenade charges carry between an objective's fights,
// the Injury Kit shares reach the bay, and the extras left come home at claim (the claim's inventory). The odds read
// is unchanged: the first objective's samples clear it either way. Re-pinned on FKR-7.
const FKR7_MOVED_STAMPED: Partial<Record<keyof typeof STAMPED_PINS, string>> = { run: "47822be2", claim: "af9b5caf" };

describe("FKR-7 goldens: what dispatch, the run and the claim did at FKR-6", () => {
  // FKR-9 / FKR-10 (the switch-on): this pin is now the IN-FLIGHT proof. The dispatch the switch-off engine made (the
  // record a save holds at the update: no stamp, nothing packed) resolves and claims byte-identically under the
  // switched-on engine. The same Launch made today is the SWITCH ON test below.
  it("SWITCH OFF: a real dispatch holding stock, credits, packs and a top-up deducts nothing, stamps nothing, claims as before", { timeout: 120_000 }, () => {
    const state = crewed(SWITCH_OFF_SEED);
    // Safe first runs SF-3: pinned on the run as dispatched before the curve (asPreCurveDispatch: a new save's ordinary run
    // now sits on the curve's floor).
    const res = asPreCurveDispatch(dispatchPastPropulsion(state, "ship-1", 1, "cand-0", true, false));
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect("fieldKits" in exp).toBe(false);
    for (const kit of ["firstAidKit", "splint", "antitoxin", "injuryKit"]) expect(itemTotal(res.next.inventory, kit).eq(itemTotal(state.inventory, kit))).toBe(true);
    expect(res.next.credits.eq(state.credits)).toBe(true);
    const done = advanceExpedition(exp, FINAL);
    expect(done.phase).toBe("complete");
    const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
    expect(claimed.success).toBe(true);
    expect({ dispatch: stateHash(res.next), claim: stateHash(claimed.next) }).toEqual(SWITCH_OFF_PINS);
  });

  it("SWITCH ON (FKR-9 / FKR-10): the same Launch today stamps flag 2, packs from stock, buys Alpha's top-up and claims the leftovers home", { timeout: 120_000 }, () => {
    const state = crewed(SWITCH_OFF_SEED);
    expect(FIELD_KITS_RUNS_LIVE).toBe(true);
    const topUp = topUpAtLaunch(state, "ship-1");
    const res = dispatchPastPropulsion(state, "ship-1", 1, "cand-0");
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect(exp.fieldKits?.catalog).toBe(FIELD_KITS_CATALOG_VERSION);
    // Stock left the Warehouse (every kit the pack preferences and defaults asked for, as far as stock went) and the
    // top-up's purchases cost exactly the preview the dispatch screen shows.
    const packed = carriedExtras(exp);
    for (const kit of ["firstAidKit", "splint", "antitoxin", "injuryKit"] as const) {
      const bought = topUp.bought[kit] ?? 0;
      expect(itemTotal(res.next.inventory, kit).toNumber(), kit).toBe(itemTotal(state.inventory, kit).toNumber() - ((packed[kit] ?? 0) - bought));
    }
    expect(state.credits.minus(res.next.credits).toNumber()).toBe(topUp.cost);
    expect(topUp.cost).toBeGreaterThan(0);
    // The run resolves to its claim; what comes home is what the teams still carry.
    const done = advanceExpedition(exp, FINAL * 4);
    expect(done.phase).toBe("complete");
    const home = carriedExtras(done);
    const claimed = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
    expect(claimed.success).toBe(true);
    for (const kit of ["firstAidKit", "splint", "antitoxin", "injuryKit"] as const) {
      expect(itemTotal(claimed.next.inventory, kit).toNumber(), kit).toBe(itemTotal(res.next.inventory, kit).toNumber() + (home[kit] ?? 0));
    }
  });

  it("STAMPED BY HAND: the run with hand-placed extras MOVED on purpose at FKR-7 (named below)", { timeout: 120_000 }, () => {
    const state = crewed(SEED, KIT_PROGRAM);
    const exp = stampedRun(state, ["enemyColony", "derelictOutpost"], { ...CALM, combat: 3 });
    const got = runPins(exp, state);
    expect(got.run).not.toBe(STAMPED_PINS.run);
    expect(got.claim).not.toBe(STAMPED_PINS.claim);
    expect(got).toEqual({ ...STAMPED_PINS, ...FKR7_MOVED_STAMPED });
  });

  it("ITS UNSTAMPED TWIN: the same run without flag 2 (byte-identical across FKR-7)", { timeout: 120_000 }, () => {
    const state = crewed(SEED, KIT_PROGRAM);
    const exp = withoutFieldKits(stampedRun(state, ["enemyColony", "derelictOutpost"], { ...CALM, combat: 3 }));
    expect(runPins(exp, state)).toEqual(UNSTAMPED_TWIN_PINS);
  });
});
