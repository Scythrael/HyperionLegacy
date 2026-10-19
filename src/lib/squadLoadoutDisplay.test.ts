import { describe, expect, it } from "vitest";
import { freshState } from "./game/model";
import type {
  AwayMember,
  AwayTeamType,
  CaptainMissionState,
  EquipmentInstance,
  EquipmentSlotType,
  GameState,
  ShipGroundTeam,
} from "./game/model";
import { applyGroundTeamLoadout, checkInGroundTeamLoadout, createGroundTeamLoadout } from "./game/armory";
import { memberPieceName } from "./awayGearDisplay";
import {
  SQUAD_KIND_FILTERS,
  applyReportView,
  applyTargets,
  armoryCountShort,
  armoryCountText,
  createReportView,
  defaultSquadLoadoutName,
  emptyListText,
  kitSlotView,
  reportLogText,
  rosterSquadOptions,
  savePreview,
  saveShipOptions,
  squadLoadoutCards,
  teamSlotSummary,
} from "./squadLoadoutDisplay";

// The GO-17 engine fixture (armory.test.ts), with names: two General Freighters, Kestrel (ship-1, captain 1,
// idle) and Harrow (ship-2, no captain). Kestrel Alpha: m-s1, m-s2 in Security 1 / 2, m-c1 in Science 1.
// Harrow Alpha: m-s3, m-s4 in Security 1 / 3, m-c2 in Science 1.
function member(id: string, teamType: AwayTeamType, shipId: string | null): AwayMember {
  return {
    id, teamType, spec: teamType === "science" ? "geology" : "offense", name: `Member ${id}`, race: "earthBorn",
    gender: "female", rank: 1, traits: [], assignedShipId: shipId,
  };
}
function piece(id: string, slotType: EquipmentSlotType, moduleVariant: string, overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id, slotType, moduleVariant, rarity: "standard", ascension: "none", quality: 2, iLevel: 10, blueprintKey: "bp-test",
    implicitStats: {}, rolledStats: {}, mass: 0, powerDraw: 0, durabilityMax: 100, durability: 100, fittedToShipId: null,
    ...overrides,
  };
}
function team(security: (string | null)[], science: (string | null)[], kind: ShipGroundTeam["kind"] = "ground"): ShipGroundTeam {
  return { kind, security, science, helpOthers: false };
}
const EMPTY = (): ShipGroundTeam => team([null, null, null], [null, null, null]);

function fixture(extra: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    gameTimeSeconds: 9000,
    ships: [
      { ...base.ships[0], id: "ship-1", name: "Kestrel", typeKey: "generalFreighter", assignedCaptainId: 1, groundTeams: [team(["m-s1", "m-s2", null], ["m-c1", null, null]), EMPTY()] },
      { ...base.ships[0], id: "ship-2", name: "Harrow", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: [team(["m-s3", null, "m-s4"], ["m-c2", null, null]), EMPTY()] },
    ],
    captains: base.captains.map((c) => (c.id === 1 ? { ...c, mission: null } : c)),
    awayMembers: [
      member("m-s1", "security", "ship-1"),
      member("m-s2", "security", "ship-1"),
      member("m-c1", "science", "ship-1"),
      member("m-s3", "security", "ship-2"),
      member("m-s4", "security", "ship-2"),
      member("m-c2", "science", "ship-2"),
    ],
    equipment: [
      piece("a1", "memberArmor", "ballisticWeave", { fittedToMemberId: "m-s1" }),
      piece("w1", "memberWeapon", "pulseRifle", { fittedToMemberId: "m-s1" }),
      piece("t1", "memberTool", "stunGrenade", { fittedToMemberId: "m-s1" }),
      piece("i1", "implant", "neuralBackup", { fittedToMemberId: "m-s1" }),
      piece("w2", "memberWeapon", "scattergun", { fittedToMemberId: "m-s2" }),
      piece("a3", "memberArmor", "fieldSuit", { fittedToMemberId: "m-c1" }),
      ...extra,
    ],
    loadouts: [],
    squadLoadouts: [],
    nextSquadLoadoutId: 1,
    expeditions: [],
  };
}
const nameOf = (s: GameState, id: string) => memberPieceName(s.equipment.find((e) => e.id === id)!);
const mission = (): CaptainMissionState => ({
  kind: "extraction", missionKey: "shortOreRun", phase: "transitOut", phaseProgressTicks: 0, cargo: {} as CaptainMissionState["cargo"], recalled: false,
});
const onMission = (s: GameState): GameState => ({ ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: mission() } : c)) });
const onExpedition = (s: GameState, shipId: string): GameState => ({ ...s, expeditions: [{ shipId } as GameState["expeditions"][number]] });

function saved(s: GameState = fixture(), name = "Assault") {
  const r = createGroundTeamLoadout(s, "ship-1", 0, name);
  if (!r.ok) throw new Error(r.reason);
  return r;
}
function resting(s: GameState = fixture()) {
  const r = saved(s);
  const back = checkInGroundTeamLoadout(r.next, r.loadoutId);
  if (!back.ok) throw new Error(back.reason);
  return { s: back.next, id: r.loadoutId };
}

describe("squad loadouts display: the count and filters (GO-17 UI)", () => {
  it("the Armory count reads loadoutsUsed (ship + squad) against the one cap", () => {
    const s = saved().next;
    const withShip = { ...s, loadouts: [{ id: "loadout-1", name: "L", shipTypeKey: "generalFreighter" as const, slots: {}, checkedOutToShipId: null }] };
    expect(armoryCountText(withShip)).toBe("2 of 25 loadouts (ship + squad)");
    expect(armoryCountShort(withShip)).toBe("2 / 25 loadouts");
  });

  it("filter chips run All, Strike, Survey, Ground and narrow the cards by kind", () => {
    expect(SQUAD_KIND_FILTERS.map((f) => f.label)).toEqual(["All", "Strike", "Survey", "Ground"]);
    const s = saved().next;
    expect(squadLoadoutCards(s, "all")).toHaveLength(1);
    expect(squadLoadoutCards(s, "ground")).toHaveLength(1);
    expect(squadLoadoutCards(s, "strike")).toHaveLength(0);
    expect(emptyListText(s, "strike")).toBe("No Strike squad loadouts.");
    expect(emptyListText(fixture(), "all")).toBe("No squad loadouts yet. Save a team's gear to make one.");
  });
});

describe("squad loadouts display: cards (GO-17 UI)", () => {
  it("a worn card names its ship and team, summarizes each kit, and offers Check in", () => {
    const s = saved().next;
    const [card] = squadLoadoutCards(s);
    expect(card.name).toBe("Assault");
    expect(card.kindName).toBe("Ground");
    expect(card.worn).toBe(true);
    expect(card.status).toBe("Worn by Kestrel · Alpha");
    expect(card.stale).toBeNull();
    expect(card.pieces).toBe(6);
    expect(card.checkIn).toEqual({ ok: true });
    expect(card.slots.map((k) => k.label)).toEqual(["Security 1", "Security 2", "Security 3", "Science 1", "Science 2", "Science 3"]);
    expect(card.slots[0].gear).toBe([nameOf(s, "a1"), nameOf(s, "w1"), nameOf(s, "t1")].join(", "));
    expect(card.slots[0].extra).toBe("+1 implant");
    expect(card.slots[2]).toMatchObject({ gear: "Empty kit", empty: true, extra: null }); // an empty slot saves an empty kit
  });

  it("a resting card reads In the locker with its piece count and no Check in", () => {
    const { s } = resting();
    const [card] = squadLoadoutCards(s);
    expect(card.worn).toBe(false);
    expect(card.status).toBe("In the locker · 6 pieces");
    expect(card.checkIn).toBeNull();
  });

  it("Check in shows the real crew lock while the ship is out", () => {
    const s = onMission(saved().next);
    expect(squadLoadoutCards(s)[0].checkIn).toEqual({ ok: false, reason: "Ship is out on a mission" });
    const e = onExpedition(saved().next, "ship-1");
    expect(squadLoadoutCards(e)[0].checkIn).toEqual({ ok: false, reason: "Ship is on an expedition" });
  });

  it("a stale worn loadout (ship gone, team type changed) still lists with Check in and says why", () => {
    const s = saved().next;
    const gone = { ...s, ships: s.ships.filter((x) => x.id !== "ship-1") };
    const [g] = squadLoadoutCards(gone);
    expect(g.status).toBe("Worn by a ship no longer in the fleet");
    expect(g.stale).toContain("no longer in the fleet");
    expect(g.checkIn).toEqual({ ok: true });

    const changed = { ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, groundTeams: [team(["m-s1", "m-s2", null, null, null, null], [], "strike"), EMPTY()] } : x)) };
    expect(squadLoadoutCards(changed)[0].stale).toBe("That team is now a Strike team. Check it in to use this loadout again.");
  });

  it("a kit with only implants, or a missing piece, still reads plainly", () => {
    expect(kitSlotView(fixture(), "science", 0, { armor: null, weapon: null, tool: null, implants: ["i1", "i2"] })).toMatchObject({
      gear: "No armor, weapon or tool",
      extra: "+2 implants",
      empty: false,
    });
    expect(kitSlotView(fixture(), "security", 1, { armor: "gone", weapon: null, tool: null, implants: [] }).gear).toBe("Missing piece");
  });
});

describe("squad loadouts display: save a team's gear (GO-17 UI)", () => {
  it("lists ships with teams, team summaries and the default name (team name + type)", () => {
    const opts = saveShipOptions(fixture());
    expect(opts.map((o) => o.label)).toEqual(["Kestrel", "Harrow"]);
    expect(opts[0].teams.map((t) => `${t.name}: ${t.summary}`)).toEqual(["Alpha: Ground · 3 Security + 3 Science", "Bravo: Ground · 3 Security + 3 Science"]);
    expect(teamSlotSummary({ kind: "strike", security: [1, 2, 3, 4], science: [] })).toBe("Strike · 4 Security");
    expect(defaultSquadLoadoutName(fixture(), "ship-1", 1)).toBe("Bravo Ground set");
    expect(defaultSquadLoadoutName(fixture(), "ship-9", 0)).toBe("New Loadout");
  });

  it("previews each slot's member and gear in kit order, matching what the engine saves", () => {
    const s = fixture([piece("t9", "memberTool", "decryptor", { fittedToMemberId: "m-c1", locked: true })]);
    const p = savePreview(s, "ship-1", 0)!;
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ label: "Security 1", member: "Member m-s1", armor: nameOf(s, "a1"), weapon: nameOf(s, "w1"), tool: nameOf(s, "t1"), implants: 1 });
    expect(p.rows[2]).toMatchObject({ label: "Security 3", member: null, armor: null, implants: 0 });
    expect(p.rows[3]).toMatchObject({ label: "Science 1", member: "Member m-c1", armor: nameOf(s, "a3"), tool: null });
    expect(p.skipped).toEqual([{ label: "Science 1", piece: nameOf(s, "t9"), reason: "Locked (unlock it first). It stays on the member, not saved." }]);
    expect(p.gate).toEqual({ ok: true });
    expect(p.saveLabel).toBe("Save loadout (1 of 25)");
    const real = createGroundTeamLoadout(s, "ship-1", 0, "x");
    expect(real.ok && real.pieces).toBe(p.pieces);
  });

  it("refuses with the reason: the team already wears one (naming it for Check in), or the ship is out", () => {
    const s = saved().next;
    const p = savePreview(s, "ship-1", 0)!;
    expect(p.gate).toEqual({
      ok: false,
      reason: 'This team already wears "Assault" (check it in first)',
      wornLoadoutId: "squad-1",
      wornLoadoutName: "Assault",
    });
    expect(p.skipped[0].reason).toBe('Part of "Assault", which this team wears.');
    const locked = savePreview(onExpedition(fixture(), "ship-1"), "ship-1", 0)!;
    expect(locked.gate).toMatchObject({ ok: false, reason: "Ship is on an expedition", wornLoadoutId: null });
    expect(savePreview(fixture(), "ship-1", 5)).toBeNull();
  });
});

describe("squad loadouts display: put it on a team (GO-17 UI)", () => {
  it("only same-type teams are enabled; the others say why as text", () => {
    const { s, id } = resting();
    const strikeBravo = { ...s, ships: s.ships.map((x) => (x.id === "ship-2" ? { ...x, groundTeams: [x.groundTeams![0], team([null, null, null, null, null, null], [], "strike")] } : x)) };
    const targets = applyTargets(onExpedition(strikeBravo, "ship-1"), id);
    const by = (k: string) => targets.find((t) => t.key === k)!;
    expect(by("ship-2:0")).toMatchObject({ title: "Harrow · Alpha", sub: "Ground · docked", disabled: false, reason: null });
    expect(by("ship-2:1")).toMatchObject({ disabled: true, reason: "Strike team: this is a Ground loadout" });
    expect(by("ship-1:0")).toMatchObject({ disabled: true, reason: "Ship is on an expedition" });
    expect(targets.every((t) => t.sub === (t.reason ?? t.sub))).toBe(true);
  });

  it("the type reason wins over a passing one (a locked or busy team of another type)", () => {
    const { s, id } = resting();
    const strike = { ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, groundTeams: [x.groundTeams![0], team([null, null, null, null, null, null], [], "strike")] } : x)) };
    expect(applyTargets(onMission(strike), id).find((t) => t.key === "ship-1:1")).toMatchObject({ reason: "Strike team: this is a Ground loadout" });
  });

  it("a team already wearing a loadout names it", () => {
    const { s, id } = resting();
    const other = createGroundTeamLoadout(s, "ship-2", 0, "Harrow kit");
    if (!other.ok) throw new Error(other.reason);
    expect(applyTargets(other.next, id).find((t) => t.key === "ship-2:0")).toMatchObject({ disabled: true, reason: 'Wears "Harrow kit" (check it in first)' });
  });

  it("the install report lists what went on, then each skip and why (an empty slot keeps its kit in the locker)", () => {
    const { s, id } = resting();
    // Harrow Alpha: Security 2 is empty (m-s2's kit has nowhere to go); m-s3 already wears the unique Neural Backup.
    const withUnique = { ...s, equipment: [...s.equipment, piece("i9", "implant", "neuralBackup", { fittedToMemberId: "m-s4" })] };
    const r = applyGroundTeamLoadout(withUnique, id, "ship-2", 0);
    if (!r.ok) throw new Error(r.reason);
    const report = applyReportView(r.next, id, "ship-2", 0, r.pieces, r.skipped);
    expect(report.title).toBe(`Installed ${r.pieces} of 6 pieces on Harrow · Alpha`);
    expect(report.noSkips).toBe(false);
    expect(report.lines[0]).toEqual({ ok: true, text: "Science 1: all pieces installed", reason: null });
    expect(report.lines[1]).toEqual({ ok: true, text: "Security 1: 3 of 4 pieces installed", reason: null });
    expect(report.lines).toContainEqual({ ok: false, text: "Security 2 · nobody in this slot", reason: "The kit stays in the locker" });
    expect(report.lines).toContainEqual({ ok: false, text: `Security 1 · ${nameOf(s, "i1")} skipped`, reason: "Unique: only one can be installed in the whole fleet" });
    expect(reportLogText(report)).toContain("Security 2 · nobody in this slot (The kit stays in the locker)");
  });

  it("the save report says where it is worn and what stayed on the members", () => {
    const s = fixture([piece("t9", "memberTool", "decryptor", { fittedToMemberId: "m-c1", locked: true })]);
    const r = saved(s, "Kit");
    const report = createReportView(r.next, r.loadoutId, r.pieces, r.skipped);
    expect(report.title).toBe('Saved "Kit" with 6 pieces');
    expect(report.lines[0]).toMatchObject({ ok: true, text: "Worn by Kestrel · Alpha now" });
    expect(report.lines[1]).toEqual({ ok: false, text: `Science 1 · ${nameOf(s, "t9")} not saved`, reason: "Locked (unlock it first)" });
  });

  it("rosters list squad loadouts with their type", () => {
    expect(rosterSquadOptions(saved().next)).toEqual([{ id: "squad-1", label: "Assault (Ground)" }]);
  });
});
