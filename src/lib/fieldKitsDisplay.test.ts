// fieldKitsDisplay.test.ts: the Field Kits screens' display decisions (FKR-9 dispatch packing and run readouts, FKR-10
// Logistics stock and Quartermaster sale rows), built to the signed-off packing mockup (USER ANSWERS 2026-10-20).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type AwayMember, type EquipmentInstance, type Expedition, type GameState, type GambitProgram, type ShipGroundTeam } from "./game/model";
import { FIELD_KIT_IDS, FIELD_KIT_PRICES, freeBasicFirstAid } from "./game/fieldKits";
import { advanceExpedition } from "./game/expedition";
import { setGroundTeamTopUp, setMemberPack } from "./game/groundTeams";
import { topUpAtLaunch, buyFieldKits } from "./game/quartermaster";
import { createGroundTeamLoadout } from "./game/armory";
import { plainAwayMember, dispatchPastPropulsion } from "./game/awayTeamTestFixtures";
import { FIELD_KITS_RUNS_LIVE as FIELD_KITS_LIVE_NOW } from "./game/fieldKits";
import { kitSlotView, packLineText, savePreview } from "./squadLoadoutDisplay";
import { renameGroundTeam } from "./game/groundTeams";
import { DEFAULT_MEMBER_GAMBIT, FIELD_KITS_DEFAULT_MEMBER_GAMBIT } from "./game/model";
import {
  NEEDS_MEDICAL_TRAINING_TEXT,
  PACK_STEPPER_MAX,
  claimKitsView,
  dispatchPackView,
  enemyRoleWord,
  fieldKitShopRows,
  fieldKitsProgramOf,
  objectiveLine,
  fieldKitStockRows,
  finalFightChip,
  freeSetView,
  CONTACT_FUSE_TEXT,
  TIMED_FUSE_TEXT,
  grenadeFuseText,
  grenadeProgramNote,
  kitCountText,
  kitEffectText,
  kitListText,
  runCardLine,
  runSuppliesView,
  shopQtyMax,
  steppedPack,
  type DispatchPackView,
} from "./fieldKitsDisplay";

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const MEDICS = new Set(["member-3", "member-6"]);

function tool(id: string, variety: string, wearer: string, carry = false): EquipmentInstance {
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
    rolledStats: carry ? { groundCarryCapacity: 1 } : {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

interface Opts {
  stock?: Record<string, number>;
  credits?: number;
  teams?: Partial<ShipGroundTeam>[];
  program?: GambitProgram;
}

// Two Ground teams of three Security and three Science; medics member-3 and member-6; an Impact Grenade with a carry
// line on member-1, a Stun Grenade on member-2, a Med Kit on member-3.
function crewed(o: Opts = {}): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [0, 1].map((i) => ({ kind: "ground", security: SEC.slice(3 * i, 3 * i + 3), science: SCI.slice(3 * i, 3 * i + 3), helpOthers: false, ...(o.teams?.[i] ?? {}) }));
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(teamType === "security" && MEDICS.has(id) ? { traits: ["fieldMedic"] } : {}),
    ...(teamType === "security" && id === "member-2" && o.program ? { gambit: o.program } : {}),
  });
  const inventory = { ...base.inventory };
  for (const [kit, n] of Object.entries(o.stock ?? {})) inventory[kit] = [new Decimal(n)];
  return {
    ...base,
    gameTimeSeconds: 100_000,
    expeditionSeed: 0xc4a2,
    credits: new Decimal(o.credits ?? 0),
    inventory,
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    equipment: [...base.equipment, tool("equip-900", "impactGrenade", "member-1", true), tool("equip-901", "stunGrenade", "member-2"), tool("equip-902", "medKit", "member-3")],
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function view(s: GameState): DispatchPackView {
  const v = dispatchPackView(s, "ship-1", true);
  if (!v) throw new Error("no pack view");
  return v;
}

const member = (v: DispatchPackView, id: string) => v.teams.flatMap((t) => t.members).find((m) => m.id === id)!;
const row = (v: DispatchPackView, id: string, kit: string) => member(v, id).kits.find((k) => k.kit === kit)!;

// The text rules: no em dash and no double hyphen substitute (escaped, so this file holds neither).
const DASHES = /—|\x2d\x2d/;

// Every player-facing string the view holds (text rules check).
function strings(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) for (const x of o) strings(x, out);
  else if (o && typeof o === "object") for (const x of Object.values(o)) strings(x, out);
  return out;
}

describe("dispatch packing (FKR-9)", () => {
  it("is off while kits are not live in runs, and for a missing ship", () => {
    expect(dispatchPackView(crewed(), "ship-1", false)).toBeNull();
    expect(dispatchPackView(crewed(), "ship-404", true)).toBeNull();
  });

  it("pre-fills each member's pack: 1 of each kit they can use; non-medics get one dim Medical Training line", () => {
    const v = view(crewed());
    expect(v.teams.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
    const plain = member(v, "member-1");
    expect(plain.kits.map((k) => k.kit)).toEqual(["firstAidKit", "antitoxin", "combatStim"]);
    expect(plain.kits.every((k) => k.want === 1)).toBe(true);
    expect(plain.noUseText).toBe(NEEDS_MEDICAL_TRAINING_TEXT);
    expect(NEEDS_MEDICAL_TRAINING_TEXT).toBe("Splint, Trauma Kit and Injury Kit need Medical Training, so they stay home.");
    expect(plain.source).toEqual({ kind: "default", text: "Default: 1 of each kit they can use" });
    const medic = member(v, "member-3");
    expect(medic.medic).toBe(true);
    expect(medic.kits.map((k) => k.kit)).toEqual(FIELD_KIT_IDS);
    expect(medic.noUseText).toBeNull();
    expect(plain.specText).toBe("Security · Offense");
  });

  it("with no stock and top-up off every kit reads a quiet 'N short', and nothing is bought", () => {
    const v = view(crewed());
    const r = row(v, "member-1", "firstAidKit");
    expect(r).toMatchObject({ want: 1, fromStock: 0, bought: 0, short: 1, quiet: true, note: "1 short, packs 0" });
    expect(v.teams[0].summaryText).toBe("0 extras from stock, 12 short");
    expect(v.readyText).toBe("Packs ready");
    expect(v.stock.find((s) => s.kit === "firstAidKit")!.text).toBe("None in stock");
  });

  it("draws stock in team then slot order, and says what is left in the Warehouse", () => {
    const v = view(crewed({ stock: { firstAidKit: 2, antitoxin: 5 } }));
    expect(row(v, "member-1", "firstAidKit").note).toBe("From the Warehouse");
    expect(row(v, "member-2", "firstAidKit").note).toBe("From the Warehouse");
    expect(row(v, "member-3", "firstAidKit").note).toBe("1 short, packs 0");
    expect(v.stock.find((s) => s.kit === "firstAidKit")!.text).toBe("0 of 2 left");
    expect(v.stock.find((s) => s.kit === "antitoxin")!.text).toBe("0 of 5 left");
    expect(v.teams[0].summaryText).toBe("5 extras from stock, 7 short");
  });

  it("top-up on buys the shortfall at launch; the preview cost is the engine's own (topUpAtLaunch)", () => {
    const s = setGroundTeamTopUp(crewed({ credits: 50_000, stock: { firstAidKit: 1 } }), "ship-1", 0, true);
    const v = view(s);
    const alpha = v.teams[0];
    expect(alpha.topUp).toBe(true);
    expect(row(v, "member-1", "firstAidKit").note).toBe("From the Warehouse");
    expect(row(v, "member-2", "firstAidKit")).toMatchObject({ bought: 1, short: 0, quiet: false, note: "1 bought at launch" });
    const engine = topUpAtLaunch(s, "ship-1");
    expect(engine.cost).toBeGreaterThan(0);
    expect(alpha.preview.on).toBe(true);
    expect(alpha.preview.text.startsWith("At launch: buys ")).toBe(true);
    expect(alpha.preview.costText).toBe(`${engine.cost.toLocaleString("en-US")} credits of 50,000`);
    const boughtAll = Object.values(engine.bought).reduce((n, x) => n + (x ?? 0), 0);
    expect(v.readyText).toBe(`Packs ready · top-up buys ${boughtAll} at launch`);
    // Bravo stays off: its kits read short, quietly.
    expect(row(v, "member-4", "firstAidKit").quiet).toBe(true);
  });

  it("top-up off previews what it would buy and its cost, the same plan the toggle would launch", () => {
    const s = crewed({ credits: 50_000 });
    const v = view(s);
    const on = topUpAtLaunch(setGroundTeamTopUp(s, "ship-1", 0, true), "ship-1");
    expect(v.teams[0].preview.on).toBe(false);
    expect(v.teams[0].preview.text).toBe(`Off: Alpha packs what the Warehouse holds. If on, it would buy ${kitListText(on.bought)}.`);
    expect(v.teams[0].preview.costText).toBe(`${on.cost.toLocaleString("en-US")} credits`);
  });

  it("a top-up short of credits buys what it can and says the rest is short", () => {
    const s = setGroundTeamTopUp(crewed({ credits: FIELD_KIT_PRICES.firstAidKit }), "ship-1", 0, true);
    const v = view(s);
    expect(row(v, "member-1", "firstAidKit").note).toBe("1 bought at launch");
    expect(v.teams[0].preview.text).toMatch(/still short: not enough credits\.$/);
  });

  it("an edited pack offers a Reset to the default; the stepper stays inside 0..PACK_STEPPER_MAX", () => {
    const s = setMemberPack(crewed(), "ship-1", 0, "member-1", { firstAidKit: 3 });
    const m = member(view(s), "member-1");
    expect(m.kits.find((k) => k.kit === "firstAidKit")!.want).toBe(3);
    expect(m.kits.find((k) => k.kit === "antitoxin")!.note).toBe("Not packed");
    expect(m.source).toEqual({ kind: "edited", text: "Edited", resetPack: null, resetLabel: "Reset to default" });
    expect(steppedPack({ firstAidKit: 1 }, "firstAidKit", -1)).toEqual({});
    expect(steppedPack({ firstAidKit: PACK_STEPPER_MAX }, "firstAidKit", 1)).toEqual({ firstAidKit: PACK_STEPPER_MAX });
    expect(steppedPack({}, "splint", 1)).toEqual({ splint: 1 });
    // Stepping back to the default reads as the default again.
    const back = setMemberPack(s, "ship-1", 0, "member-1", { firstAidKit: 1, antitoxin: 1, combatStim: 1 });
    expect(member(view(back), "member-1").source.kind).toBe("default");
  });

  it("a pack that matches the team's worn loadout says so; an edit from it resets to the loadout", () => {
    const s0 = setMemberPack(crewed(), "ship-1", 0, "member-1", { firstAidKit: 2 });
    const made = createGroundTeamLoadout(s0, "ship-1", 0, "Breacher");
    if (!made.ok) throw new Error("loadout refused");
    expect(member(view(made.next), "member-1").source).toEqual({ kind: "loadout", text: "Same as loadout: Breacher" });
    const edited = setMemberPack(made.next, "ship-1", 0, "member-1", { firstAidKit: 4 });
    expect(member(view(edited), "member-1").source).toEqual({ kind: "edited", text: "Edited", resetPack: { firstAidKit: 2 }, resetLabel: "Reset to Breacher" });
  });

  it("the tool line: grenade charges with the carry line and the program's reserve; other tools have no charges", () => {
    const v = view(crewed({ program: [{ target: "foeNearest", action: "attack" }] }));
    const impact = member(v, "member-1").tool;
    expect(impact).toMatchObject({ name: "Impact Grenade", glyph: "grenade", base: 4, carry: 1, chargesText: "5 charges (4 + 1 carry)" });
    expect(impact.note).toBe("1 throw per battle · program keeps 1 for an Elite or a Boss");
    expect(member(v, "member-2").tool.note).toBe("1 throw per battle · no rule in the program throws it");
    // Timed grenades (user 2026-10-21): today's dispatch is a catalog 2 run, so the Stun Grenade's fuse is timed and the
    // Impact Grenade (the default) detonates on contact; a tool without charges has no fuse line.
    expect(impact.fuseText).toBe(CONTACT_FUSE_TEXT);
    expect(member(v, "member-2").tool.fuseText).toBe(TIMED_FUSE_TEXT);
    expect(member(v, "member-3").tool.fuseText).toBeNull();
    expect(member(v, "member-3").tool).toMatchObject({ name: "Med Kit", chargesText: null, note: "No charges: works every battle." });
    expect(member(v, "member-4").tool.name).toBe("No tool installed");
  });

  it("the free set reads the ship's support crew on the approved curve and names the next step", () => {
    expect(freeSetView(0)).toMatchObject({ perMember: 1, text: "Free every objective: 1 First Aid Kit per Security member." });
    expect(freeSetView(0).note).toBe("No Medical or Operations crew aboard yet. At 5 crew the free set grows to 2.");
    expect(freeSetView(17).perMember).toBe(freeBasicFirstAid(17));
    expect(freeSetView(17).note).toBe(`From 17 Medical and Operations crew aboard. At 27 crew the free set grows to 4.`);
    expect(member(view(crewed()), "member-1").free).toBe(view(crewed()).free.perMember);
  });

  it("Science packs nothing; a Survey team and a team that waits get a ghost line", () => {
    const v = view(crewed({ teams: [{}, { kind: "survey", security: [], science: SCI.slice(3, 6) }] }));
    expect(v.teams.map((t) => t.index)).toEqual([0]);
    expect(v.teams[0].scienceNote).toMatch(/^Science squad \(.+\): does the fieldwork and never fights, so it packs nothing\.$/);
    expect(v.ghosts).toEqual([{ index: 1, text: "Bravo · Survey team: no Security members, nothing to pack." }]);
    const injured = crewed();
    injured.awayMembers = injured.awayMembers.map((m) => (m.id === "member-4" ? { ...m, injuredUntilSeconds: injured.gameTimeSeconds + 600 } : m));
    expect(view(injured).ghosts).toEqual([{ index: 1, text: "Bravo is not deploying this launch, so it packs nothing." }]);
  });

  it("ghost lines are keyed by team index: two teams may share a name (renameGroundTeam allows it)", () => {
    let s = crewed();
    s = renameGroundTeam(s, "ship-1", 0, "Twin");
    s = renameGroundTeam(s, "ship-1", 1, "Twin");
    s = { ...s, awayMembers: s.awayMembers.map((m) => (m.id === "member-1" || m.id === "member-4" ? { ...m, injuredUntilSeconds: s.gameTimeSeconds + 600 } : m)) };
    const ghosts = view(s).ghosts;
    expect(ghosts.map((g) => g.text)).toEqual(["Twin is not deploying this launch, so it packs nothing.", "Twin is not deploying this launch, so it packs nothing."]);
    expect(new Set(ghosts.map((g) => g.index)).size).toBe(ghosts.length);
  });

  it("the dispatch tool note reads the program the member fights with (a stored copy of D19's default throws too)", () => {
    const s = crewed();
    s.awayMembers = s.awayMembers.map((m) => (m.id === "member-1" ? { ...m, gambit: DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r, ...(r.params ? { params: { ...r.params } } : {}) })) } : m));
    expect(member(view(s), "member-1").tool.note).toBe("1 throw per battle · program keeps 1 for an Elite or a Boss");
    expect(fieldKitsProgramOf(s.awayMembers.find((m) => m.id === "member-1")!)).toEqual(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
  });

  it("text rules: no em dash, no double hyphen, no 'task' in any line", () => {
    const all = strings(view(setGroundTeamTopUp(crewed({ credits: 900, stock: { splint: 1 } }), "ship-1", 0, true)));
    for (const s of all) {
      expect(s, s).not.toMatch(DASHES);
      expect(s.toLowerCase(), s).not.toMatch(/\btask/);
    }
  });
});

describe("words", () => {
  it("counts and lists kits", () => {
    expect(kitCountText("firstAidKit", 1)).toBe("1 First Aid Kit");
    expect(kitCountText("antitoxin", 2)).toBe("2 Antitoxins");
    expect(kitListText({ antitoxin: 1, firstAidKit: 3, splint: 0 })).toBe("3 First Aid Kits, 1 Antitoxin");
  });

  it("each kit's effect reads the catalog; Advanced Medical says it needs Medical Training", () => {
    expect(kitEffectText("splint")).toBe("Heals a Fracture in 3 rounds and turns a Broken Bone into a Fracture. Needs Medical Training.");
    expect(kitEffectText("antitoxin")).toBe("Clears Poison.");
    expect(kitEffectText("combatStim")).toBe("Inspired for 2 rounds.");
    expect(kitEffectText("traumaKit")).toBe("Clears Hemorrhage, Neurotoxin and Concussion, and a Fracture or Broken Bone. Needs Medical Training.");
    expect(kitEffectText("injuryKit")).toMatch(/divided by 1\.5\. Needs Medical Training\.$/);
    for (const id of FIELD_KIT_IDS) expect(kitEffectText(id)).not.toMatch(DASHES);
  });

  it("the program note for grenades", () => {
    expect(grenadeProgramNote([{ target: "foeNearest", action: "attack" }])).toBe("no rule in the program throws it");
    expect(grenadeProgramNote([{ target: "foeLargestGroup", action: "throwGrenade" }])).toBe("");
    expect(grenadeProgramNote([{ target: "foeLargestGroup", params: { reserveForBoss: 2 }, action: "throwGrenade" }])).toBe("program keeps 2 for a Boss");
  });

  it("an enemy's role word comes from its id", () => {
    expect(enemyRoleWord("enemy-bruiser-1")).toBe("Bruiser");
    expect(enemyRoleWord("enemy-striker-12")).toBe("Striker");
    expect(enemyRoleWord("member-1")).toBeNull();
  });
});

describe("in the run (FKR-9)", () => {
  const ranked = { enemyRanks: { version: 1 } } as Pick<Expedition, "enemyRanks" | "difficulty">;
  const task = (difficulty: number, points = 3) => ({ difficulty, fightPoints: Array.from({ length: points }, (_, i) => (i + 1) / (points + 1)) });

  it("the final fight chip follows the grade; training and unranked runs show none", () => {
    expect(finalFightChip(ranked, task(1))).toBeNull();
    expect(finalFightChip(ranked, task(2))).toBeNull();
    expect(finalFightChip(ranked, task(3))).toMatchObject({ rank: "elite", glyph: "rankElite", text: "Final fight: Elite" });
    expect(finalFightChip(ranked, task(4))?.text).toBe("Final fight: Elite");
    expect(finalFightChip(ranked, task(5))).toMatchObject({ rank: "boss", text: "Final fight: Boss" });
    expect(finalFightChip({}, task(5))).toBeNull();
    expect(finalFightChip({ ...ranked, difficulty: { firstRun: true } } as never, task(5))).toBeNull();
    expect(finalFightChip(ranked, task(5, 0))).toBeNull();
  });

  it("names the lead's role once the team is fighting the final fight", () => {
    const fight = { pointIndex: 2, fightNumber: 4, outcome: "win" as const, rounds: 3, downedMemberIds: [], memberConditions: {}, memberEnd: {}, ranks: { "enemy-bruiser-2": "elite" as const } };
    expect(finalFightChip(ranked, task(3), { pendingFight: fight })?.text).toBe("Final fight: Elite Bruiser");
    expect(finalFightChip(ranked, task(3), { pendingFight: { ...fight, pointIndex: 1 } })?.text).toBe("Final fight: Elite");
  });

  it("an unstamped run has no supplies readout, card line or claim line", () => {
    const res = dispatchPastPropulsion(crewed(), "ship-1", 1, "cand-0", true, false);
    const exp = res.expedition!;
    expect(runSuppliesView(exp, null, [])).toEqual([]);
    expect(runCardLine(exp, null)).toBeNull();
    expect(claimKitsView(exp)).toBeNull();
  });

  it("a Field Kits run reads its free set, extras, charges and conditions per member", () => {
    const s = crewed({ stock: { firstAidKit: 6, splint: 2, injuryKit: 1 } });
    const res = dispatchPastPropulsion(s, "ship-1", 1, "cand-0", true, true);
    const exp = structuredClone(res.expedition!);
    const alpha = exp.groundOps!.teams[0];
    const free = exp.fieldKits!.freeBasics!.firstAidKit!;
    // Before landing: the free set is full.
    let v = runSuppliesView(exp, s.ships[0], s.awayMembers);
    expect(v[0].rows[0]).toMatchObject({ freeLeft: free, freeTotal: free });
    // Hand-place a mid-objective state: one free kit spent, one extra spent, two charges thrown, a splinted Fracture.
    alpha.basics = { "member-1": { firstAidKit: free - 1 }, "member-2": { firstAidKit: free }, "member-3": { firstAidKit: free } };
    alpha.kits = { ...alpha.kits!, "member-1": { firstAidKit: 0, antitoxin: 1, combatStim: 1 } };
    alpha.charges = { "member-1": 3 };
    alpha.carry = { "member-3": { hp: 40, hpMax: 90, statuses: [{ id: "fracture", magnitude: 0.2, remaining: 3 }] } };
    alpha.conditions = { "member-2": ["health", "brokenBone"] };
    v = runSuppliesView(exp, s.ships[0], s.awayMembers);
    const [r1, r2, r3] = v[0].rows;
    expect(r1).toMatchObject({ freeLeft: free - 1, charges: { left: 3, total: 5 } });
    expect(r1.extras.find((e) => e.kit === "firstAidKit")).toMatchObject({ left: 0, packed: 1 });
    expect(r2.charges).toEqual({ left: 2, total: 2 });
    // Timed grenades: this run is stamped with today's catalog (2), so member-2's Stun Grenade reads its timed fuse; a
    // run in flight on catalog 1 reads every grenade on contact.
    expect(r1.fuseNote).toBe(CONTACT_FUSE_TEXT);
    expect(r2.fuseNote).toBe(TIMED_FUSE_TEXT);
    expect(runSuppliesView({ ...exp, fieldKits: { ...exp.fieldKits!, catalog: 1 } }, s.ships[0], s.awayMembers)[0].rows[1].fuseNote).toBe(CONTACT_FUSE_TEXT);
    expect(r2.conditions).toEqual([{ key: "brokenBone", glyph: "boneBroken", text: "Broken Bone", bayText: expect.stringMatching(/^bay .+ after this objective$/) }]);
    expect(r3.conditions).toEqual([{ key: "fracture", glyph: "boneFracture", text: "Fracture, splinted", bayText: "no bay time" }]);
    expect(r3).toMatchObject({ toolNote: "Med Kit: no charges", charges: null, healthText: "40 of 90 HP", medic: true });
    expect(v[0].refreshText).toMatch(new RegExp(`^At the next objective the free set refills to ${free} each and every grenade resets to full\\. Extras carry on until used\\.`));
    expect(v[0].refreshText).toContain("program keeps 1 grenade charge for an Elite or a Boss.");
    const card = runCardLine(exp, s.ships[0])!;
    // Free set 0 + 1 + 1 (at the free set of 1), extras: member-1 two left, member-2 one, member-3 three (First Aid, Splint, Injury).
    expect(card.teams[0].text).toBe(`Alpha kits ${free - 1 + free + free + 2 + 1 + 3} left`);
    expect(card.teams[0].charges).toBe(5);
  });

  it("the claim line: kits home and what the run used; nothing for a run that packed nothing", () => {
    const s = crewed({ stock: { firstAidKit: 6 } });
    const exp = structuredClone(dispatchPastPropulsion(s, "ship-1", 1, "cand-0", true, true).expedition!);
    const alpha = exp.groundOps!.teams[0];
    alpha.kits = { ...alpha.kits!, "member-1": { firstAidKit: 0 } };
    const line = claimKitsView(exp)!;
    expect(line.homeText).toBe("Kits home: 5 First Aid Kits");
    expect(line.subText).toBe(
      "Back in the Warehouse at claim. Used on the run: 1 First Aid Kit. Free kits are never carried home; they refill every objective. Returning kits may sit above the Warehouse cap.",
    );
    const none = dispatchPastPropulsion(crewed(), "ship-1", 1, "cand-0", true, true).expedition!;
    expect(claimKitsView(none)).toBeNull();
  });

  it("a whole Field Kits run reads without throwing at every step", () => {
    const s = crewed({ stock: { firstAidKit: 6, antitoxin: 6, splint: 2 } });
    const exp = dispatchPastPropulsion(s, "ship-1", 1, "cand-0", true, true).expedition!;
    for (const t of [100_000, 200_000, 400_000, 1_000_000, 2_100_000]) {
      const at = advanceExpedition(exp, t);
      const v = runSuppliesView(at, s.ships[0], s.awayMembers);
      for (const team of v) for (const r of team.rows) for (const e of r.extras) expect(e.left).toBeLessThanOrEqual(e.packed);
      expect(() => runCardLine(at, s.ships[0])).not.toThrow();
      for (const str of strings(v)) expect(str).not.toMatch(DASHES);
    }
  });
});

describe("the detail header's objective line (the mockup's Objective N of M)", () => {
  const exp = {
    bodies: [
      {
        activities: [
          { id: "a", poiId: "derelictOutpost", status: "done" },
          { id: "b", poiId: "ancientRuins", status: "active" },
          { id: "c", poiId: "crashedShip", status: "queued" },
          { id: "d", poiId: "caveNetwork", status: "skipped" },
          { id: "x", poiId: "buriedVault", status: "active" },
        ],
      },
    ],
  } as unknown as Expedition;
  const act = (id: string) => exp.bodies[0].activities.find((a) => a.id === id)!;
  it("counts the team's own objectives (skipped left out), the current one after the finished ones", () => {
    expect(objectiveLine(exp, { queue: ["a", "b", "c", "d"], taskId: "b" }, act("b"))).toBe("Objective 2 of 3: Ancient Ruins");
    expect(objectiveLine(exp, { queue: ["a", "b", "c", "d"], taskId: "x", borrowed: true }, act("x"))).toMatch(/^Helping on /);
    expect(objectiveLine(exp, { queue: ["a", "b", "c"] }, null)).toBe("Between objectives · 1 of 3 done");
    expect(objectiveLine(exp, { queue: [] }, null)).toBe("Between objectives");
  });
});

describe("the Squad Loadouts pack row (FKR-10)", () => {
  it("a Security kit's pack line: its kits, the default, or no extras; nothing while kits are off", () => {
    expect(packLineText({ firstAidKit: 2, antitoxin: 1 }, true)).toBe("Pack: 2 First Aid Kits, 1 Antitoxin");
    expect(packLineText(undefined, true)).toBe("Pack: default kits");
    expect(packLineText({}, true)).toBe("Pack: no extra kits");
    expect(packLineText({ firstAidKit: 2 }, false)).toBeNull();
  });

  it("a saved loadout's Security kit carries the member's pack; the save preview names it", () => {
    const s = setMemberPack(crewed(), "ship-1", 0, "member-1", { firstAidKit: 2 });
    const preview = savePreview(s, "ship-1", 0)!;
    expect(preview.rows.find((r) => r.teamType === "security" && r.slotIndex === 0)!.pack).toBe(FIELD_KITS_LIVE_NOW ? "Pack: 2 First Aid Kits" : null);
    expect(preview.rows.find((r) => r.teamType === "science")!.pack).toBeNull();
    const made = createGroundTeamLoadout(s, "ship-1", 0, "Kits");
    if (!made.ok) throw new Error("refused");
    const loadout = made.next.squadLoadouts.find((l) => l.id === made.loadoutId)!;
    expect(kitSlotView(made.next, "security", 0, loadout.security[0]).pack).toBe(FIELD_KITS_LIVE_NOW ? "Pack: 2 First Aid Kits" : null);
  });
});

describe("Logistics stock and Quartermaster sales (FKR-10)", () => {
  it("lists every kit with its count, the warehouse cap and its effect", () => {
    const rows = fieldKitStockRows(crewed({ stock: { firstAidKit: 5 } }));
    expect(rows.map((r) => r.kit)).toEqual(FIELD_KIT_IDS);
    const first = rows[0];
    expect(first.owned).toBe(5);
    expect(first.cap).toBeGreaterThan(5);
    expect(first.text).toBe(`5 of ${first.cap.toLocaleString("en-US")}`);
    expect(rows.find((r) => r.kit === "splint")!.medical).toBe(true);
  });

  it("the sale rows gate on the engine's own refusal and price the chosen quantity", () => {
    const poor = fieldKitShopRows(crewed(), () => 2);
    expect(poor[0]).toMatchObject({ qty: 2, price: FIELD_KIT_PRICES.firstAidKit, canBuy: false, blockText: "Not enough credits." });
    expect(poor[0].totalText).toBe(`Total: ${(2 * FIELD_KIT_PRICES.firstAidKit).toLocaleString("en-US")} CR`);
    const rich = crewed({ credits: 100_000 });
    const rows = fieldKitShopRows(rich, () => 3);
    expect(rows.every((r) => r.canBuy && r.blockText === null)).toBe(true);
    const bought = buyFieldKits(rich, "firstAidKit", 3);
    expect(bought.ok).toBe(true);
    if (bought.ok) expect(fieldKitStockRows(bought.next)[0].owned).toBe(3);
    expect(shopQtyMax({ owned: 3, cap: 10 })).toBe(7);
    expect(shopQtyMax({ owned: 10, cap: 10 })).toBe(1);
  });
});

describe("timed grenades: the fuse words (user 2026-10-21)", () => {
  it("a grenade reads timed only with a fuse on a run that reads fuses", () => {
    expect(grenadeFuseText({ fuse: { movedClearChance: 0.2 } }, true)).toBe(TIMED_FUSE_TEXT);
    expect(grenadeFuseText({ fuse: { movedClearChance: 0.2 } }, false)).toBe(CONTACT_FUSE_TEXT);
    expect(grenadeFuseText({}, true)).toBe(CONTACT_FUSE_TEXT);
  });

  it("text rules: no em dash, no double hyphen, no 'task' in the fuse words", () => {
    for (const t of [CONTACT_FUSE_TEXT, TIMED_FUSE_TEXT]) {
      expect(t).not.toMatch(DASHES);
      expect(t).not.toMatch(/\btask\b/i);
    }
  });
});
