// S1 / S2 crew locks (0.14.0, docs/plans/2026-10-17-small-calls-answers.md, both "Lock it (Recommended)"): golden
// readings captured on the code BEFORE the lock edits (the CP-0 / EM-0 pattern). Each later commit keeps these green,
// or re-pins a row ONLY where its commit names the move and why.
//
//   paths   : every ship gear change path (hand install, hand uninstall, Armory check-out, Armory check-in) and the
//             captain move (assignShipToCaptain, off ship-1 and onto ship-2) on the shipGearLock fixture, with ship-1
//             home and out in each of the five ways the one crew lock knows. A refusal reads "refused" (the same state
//             back) or the thrown token; a change reads the new state's hash.
//   inFlight: a real expedition and a real captain mission flown 400 ticks on the fixture, whole state hashed: the
//             locks only refuse player actions, so no run in flight may move.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
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
import type { GameState } from "./model";
import { canFitEquipment, fitEquipment, unfitEquipmentInstance } from "./equipment";
import { checkInLoadout, checkOutLoadout } from "./armory";
import { assignShipToCaptain, dispatchCaptainOnMission, economyTick } from "./tick";
import { expeditionCandidates } from "./expedition";
import { asPreStaggerDispatch, dispatchPastPropulsion, withMinimumAwayTeam } from "./awayTeamTestFixtures";
import { stateHash } from "./firstRunsGoldens.fixture";
import { GEAR_LOCK_KINDS, GL_LOADOUT, GL_SPARE, gearLockFleet, lockShip, withLoadoutWorn, type GearLockKind } from "./shipGearLock.fixture";
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

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const changed = (before: GameState, after: GameState): string => (after === before ? "refused" : stateHash(after));

function fittedCargoId(s: GameState): string {
  const p = s.equipment.find((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay");
  if (!p) throw new Error("no fitted Cargo Bay on ship-1");
  return p.id;
}

// One lock state's readings over every path. "home" is ship-1 with nothing out.
function pathReadings(kind: GearLockKind | "home"): Record<string, string> {
  const fleet = gearLockFleet();
  const at = (s: GameState, shipId = "ship-1") => (kind === "home" ? s : lockShip(s, kind, shipId));
  const s = at(fleet);
  const out: Record<string, string> = {};

  const gate = canFitEquipment(s, "ship-1", GL_SPARE);
  out.installGate = gate.ok ? "ok" : gate.reason;
  out.install = gate.ok ? stateHash(fitEquipment(s, "ship-1", GL_SPARE)) : "refused";

  try {
    out.uninstall = stateHash(unfitEquipmentInstance(s, "ship-1", fittedCargoId(s)));
  } catch (e) {
    out.uninstall = `throw:${(e as Error).message}`;
  }

  out.checkOut = changed(s, checkOutLoadout(s, GL_LOADOUT, "ship-1"));
  const worn = at(withLoadoutWorn(fleet, checkOutLoadout));
  out.checkIn = changed(worn, checkInLoadout(worn, GL_LOADOUT));

  const off = assignShipToCaptain(s, 1, "ship-2");
  out.assignOff = off.success ? stateHash(off.next) : "refused";
  // Onto a ship that is out: only an expedition can lock a parked hull (a captain lock needs a captain aboard).
  if (kind === "expedition" || kind === "expeditionUnclaimed" || kind === "home") {
    const onto = at(fleet, "ship-2");
    const r = assignShipToCaptain(onto, 2, "ship-2");
    out.assignOnto = r.success ? stateHash(r.next) : "refused";
  }
  return out;
}

function inFlightExpedition(): string {
  const s = withMinimumAwayTeam(gearLockFleet());
  // Relics v2 tier stagger (after this pin): a pre-stagger dispatch (asPreStaggerDispatch, no draw moves).
  const res = asPreStaggerDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success) throw new Error(`dispatch refused: ${res.reason}`);
  let st = res.next;
  const rng = lcg(0x51a7);
  for (let i = 0; i < 400; i++) st = economyTick(st, 1, rng);
  return stateHash(st);
}

function inFlightMission(): string {
  const r = dispatchCaptainOnMission(gearLockFleet(), 1, "shortOreRun");
  if (!r.success) throw new Error("mission refused");
  let st = r.next;
  const rng = lcg(0x51a9);
  for (let i = 0; i < 400; i++) st = economyTick(st, 1, rng);
  return stateHash(st);
}

const GOLDEN: Record<string, unknown> = {
  "paths:home": { installGate: "ok", install: "67bb6a1c", uninstall: "6357abc7", checkOut: "a47e5327", checkIn: "64087489", assignOff: "31b570f3", assignOnto: "80706ec2" },
  "paths:mission": { installGate: "onMission", install: "refused", uninstall: "throw:unfitEquipmentInstance blocked: onMission", checkOut: "refused", checkIn: "refused", assignOff: "refused" },
  "paths:patrol": { installGate: "onMission", install: "refused", uninstall: "throw:unfitEquipmentInstance blocked: onMission", checkOut: "refused", checkIn: "refused", assignOff: "refused" },
  "paths:shortRange": { installGate: "onMission", install: "refused", uninstall: "throw:unfitEquipmentInstance blocked: onMission", checkOut: "refused", checkIn: "refused", assignOff: "refused" },
  // RE-PINNED by the S1 / S2 lock commit, the ONLY move: before it an expedition (in flight, or complete but
  // unclaimed) locked none of these paths (captured: install "3054208e" / "de9a40f6", uninstall "406880e9" /
  // "4bf00273", checkOut "7cc85ec9" / "9128cbd3", checkIn "d0bfb4e3" / "fee2c62d", assignOff "a56571a5" / "836624df",
  // assignOnto "615c6e56" / "c7fc147e", installGate "ok"). Now every path refuses with the same state back, exactly
  // as the captain-run rows above always did. The home and captain-run rows and the runs in flight did not move.
  "paths:expedition": { installGate: "onMission", install: "refused", uninstall: "throw:unfitEquipmentInstance blocked: onMission", checkOut: "refused", checkIn: "refused", assignOff: "refused", assignOnto: "refused" },
  "paths:expeditionUnclaimed": { installGate: "onMission", install: "refused", uninstall: "throw:unfitEquipmentInstance blocked: onMission", checkOut: "refused", checkIn: "refused", assignOff: "refused", assignOnto: "refused" },
  inFlight: ["514cd0a6", "760d471c"],
};

describe("S1 / S2 goldens: the ship gear and captain move paths (re-pinned by the lock commit where named)", () => {
  for (const kind of ["home", ...GEAR_LOCK_KINDS] as const) {
    it(`paths: ship-1 ${kind}`, () => {
      expect(pathReadings(kind)).toEqual(GOLDEN[`paths:${kind}`]);
    });
  }
  it("inFlight: a real expedition and a real captain mission, 400 ticks", () => {
    expect([inFlightExpedition(), inFlightMission()]).toEqual(GOLDEN.inFlight);
  });
});
