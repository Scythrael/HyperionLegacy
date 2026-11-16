// WR-5b (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5b): golden hashes
// captured on the code BEFORE any WR-5b engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 pattern). Each fixture is
// run once with NO captain node and once per Tactician node (the captain owning only that node, a hand-edited save;
// the allocation rules are not the subject here).
//
//   patrol : a Repeat Crimson Reaver Warband patrol on a carrier (weapons and an Attack drone screen) with a Damage
//            Control Suite installed: the dispatch record, the display replay at 12 s and 25 s (one won
//            cycle, then the relaunched cycle a wave lost on a plain carrier), the state after 900 s (or the end).
//   event  : the Ground Ops ship-event profile frozen at dispatch, and one battle of its combatant against the
//            Cloaked Vessel (resolveBattle, a fixed seed).
//   repair : a damaged carrier's Shipyard repair duration (437 hull to restore).
//
// Before WR-5b every node was inert, so each node's hashes equaled the no-node hashes (bar the whole-state hash,
// which carries the captain's owned node list). The no-node row must never move; a node's row moves exactly where
// its commit says.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { goldenJson, withV1Museum } from "./firstRunsGoldens.fixture"; // gear wear: goldenJson puts the retired durability back
import Decimal from "break_infinity.js";
import { freshState, type EquipmentInstance, type GameState, type PatrolMissionState, type SecondaryTalentKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, shipRepairDurationTicks, shipyardRepairSpeedBonus } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { resolveBattle } from "./combat/resolveBattle";
import { shipToCombatant } from "./combat/bridge";
import { makeWeaponInstance } from "./combat/weapons";
import { equippedFor } from "./equipment";
import { generateEquipment } from "./itemgen";
import { DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";
import { CLOAKED_VESSEL_HULL, buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";
import { asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about WR-5b (the Tactician tree);
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
combatRulesOffForThisFile();
// Gear wear step 4 (0.14.0): the same for battle wear (battleWearSwitch.fixture.ts): the pins predate it, and a patrol
// cycle stamped for it fights its carried wear (gearWearCombatGoldens.test.ts pins that).
import { battleWearOffInThisFile } from "./battleWearSwitch.fixture";
battleWearOffInThisFile();
// WR-7 follow-up OC-D5 (favorsSpec, "+10% on its ship type"): the same for the favored-spec bonus (the carrier's Damage
// Control Suite favors the Tactician spec): the pins predate it; favorsSpecGoldens.test.ts pins it.
import { favoredSpecOffForThisFile } from "./favoredSpecSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): the stop rule (lane 4 q3, PATROL_STOP_DOOMED_SWITCH: Repeat stops "outmatched" before a
// route it would lose even fully repaired) moves every row's patrol (it meets a route it would lose). The pins here
// predate the round and are about another slice, so the file runs with that fix off (fixRoundESwitch.fixture.ts); every
// other fix of the round runs here. The round's own pins: patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("stopDoomed");
favoredSpecOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(v));

function seededRng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

function dcSuite(): EquipmentInstance {
  const piece = generateEquipment({
    slotType: "specUtility",
    varietyKey: DAMAGE_CONTROL_SUITE_KEY,
    blueprintKey: null,
    iLevel: 30,
    quality: 2,
    rarity: "augmented",
    ascension: "none",
    rng: seededRng(30 * 31 + 2),
    allocateId: () => "dcs-1",
  });
  return { ...piece, fittedToShipId: "ship-1" };
}

// A carrier with its Standard Issue combat gear and a Damage Control Suite, captain 1 owning `nodes`.
function carrier(nodes: readonly SecondaryTalentKey[]): GameState {
  const base = freshState();
  const onCarrier: GameState = {
    ...base,
    credits: new Decimal(1_000_000),
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: "carrier" } : sh)),
  };
  const s = installMissingCombatBaselines(onCarrier);
  return {
    ...s,
    equipment: [...s.equipment, dcSuite()],
    captains: s.captains.map((c) => (c.id === 1 ? { ...c, unlockedSecondaryTalents: [...nodes] } : c)),
  };
}

function patrolRow(s0: GameState): string[] {
  const r = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(s0, 1, "crimsonReaverWarband", "balanced", true));
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  let s = r.next;
  const out = [hash(s.captains[0].mission)];
  for (let i = 1; i <= 900; i++) {
    s = economyTick(s, 1, () => 0.5);
    if (i === 12 || i === 25) out.push(hash(replayPatrol(s, s.captains[0])));
    if ((s.captains[0].mission as PatrolMissionState | null) === null) break;
  }
  out.push(hash({ ...withV1Museum(s), runCounts: undefined })); // R2-1: the museum in its v1 form, as captured
  return out;
}

function eventRow(s0: GameState): string[] {
  const profile = snapshotShipEventProfile(s0, s0.ships[0]);
  const ship = buildShipCombatant("ship-1", profile.battle!, 0, 0);
  const hull = CLOAKED_VESSEL_HULL;
  const enemy = shipToCombatant({
    id: "enemy-1",
    team: "enemy",
    stats: hull.stats,
    weaponLoadout: hull.weapons.map((w, i) => makeWeaponInstance(w, `enemy-1-w${i}-${w}`)),
    stance: hull.stance,
  });
  const fight = resolveBattle({ combatants: [ship, enemy] }, 0x5b5b);
  return [hash(profile), hash({ outcome: fight.outcome, final: fight.finalCombatants })];
}

function repairRow(s0: GameState): string {
  const ship = { ...s0.ships[0], damaged: true, repairDamage: 437 };
  // WR-5b: the Shipyard's divisor is shipyardRepairSpeedBonus now (the officers' x the captain's Damage Control),
  // exactly officerRepairSpeedBonus without the node (the capture's call), so the no-node row reads the same.
  return String(shipRepairDurationTicks(ship, equippedFor(s0, ship.id), shipyardRepairSpeedBonus(s0, ship)));
}

const TACTICIAN: readonly SecondaryTalentKey[] = [
  "gunnery1", "gunnery2", "gunnery3", "gunnery4", "gunnery5",
  "aegis1", "aegis2", "aegis3", "aegis4", "aegis5",
  "fleetOps1", "fleetOps2", "fleetOps3", "fleetOps4", "fleetOps5",
];

// Re-pinned by WR-5b (the nodes wired). The `none` row never moved: a save without a node is byte-identical. Per node,
// the columns that moved (every other column is the capture) and why:
//   gunnery1: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; every projectile x1.05).
//   gunnery2: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; accuracy x1.05, so more hits land).
//   gunnery3: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; x1.08 on a target above half hull).
//   gunnery4: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; weapons recharge 1.08x as fast).
//   gunnery5: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; each weapon's first shot x1.5).
//   aegis1: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record and the folded shield pool; shield and recharge x1.05 (the profile's shieldCapacity)).
//   aegis2: dispatch, replay@12, replay@25, final, eventProfile, eventBattle (the frozen record and the folded hull pool; hull x1.05 (the profile's hullMax; the limp-home repair damage is the larger pool)).
//   aegis3: dispatch, final, eventProfile, repair (the frozen record; the Shipyard divisor x1.08 (156 to 145 ticks, so the repair ends sooner) and the frozen field repair divisor. The replays and the event battle hold: the suite's patch-up already tops this hull up to its cap (captainTacticianEffects.test.ts proves the lift on a damaged hull)).
//   aegis4: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; incoming hit chance / 1.05).
//   aegis5: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; a lethal hit leaves 1 hull once per battle).
//   fleetOps1: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; drone hits x1.05).
//   fleetOps2: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; the seeded drones' hit points x1.05).
//   fleetOps3: dispatch, final, eventProfile (the frozen record; the won waves' loot x1.08. The replays and the event battle hold (loot only)).
//   fleetOps4: dispatch, replay@12, replay@25, eventProfile, eventBattle (the frozen record; the seeded replenish rate x1.05).
//   fleetOps5: dispatch, replay@12, replay@25, final, eventProfile, eventBattle (the frozen record; one more seeded squadron, which also changes how the run ends).
// The final state holds where the run still ends the same way (the same waves won and lost, the same loot). The
// repair column now reads shipyardRepairSpeedBonus, which equals the capture's officerRepairSpeedBonus without a node.
// [patrol dispatch, patrol replay @12 s, @25 s, patrol final state, event profile, event battle, repair ticks]
const GOLDEN: Record<string, string[]> = {
  none: ["5178250e", "f8d1a282", "19067d1b", "43013dc9", "469fe665", "4e0baba", "156"],
  gunnery1: ["abe30654", "81d7f014", "8da17c63", "50194f86", "e8b2918b", "2c30cf99", "156"],
  gunnery2: ["50587d54", "40617fd0", "d43cf5be", "b12b0125", "1c2886cb", "ca5a56e9", "156"],
  gunnery3: ["a4cd49b5", "7d714225", "e46145c1", "e7b5da0", "85bce386", "72590ef7", "156"],
  gunnery4: ["7b3dd517", "bf39cec3", "877a6163", "e82f99e7", "4d4f79e0", "5e616e80", "156"],
  gunnery5: ["b6f24926", "f0ee4404", "fb6de65b", "a24252b2", "8ac2417d", "59d805c3", "156"],
  aegis1: ["d18d435", "fd56a76d", "2df986df", "a4382707", "3479f2a2", "447844fd", "156"],
  aegis2: ["59d4caa0", "ed78e89", "3fdc527a", "9604a23e", "598dda03", "3fd9b84a", "156"],
  aegis3: ["834d9263", "f8d1a282", "19067d1b", "a31ca87d", "6be2ff35", "4e0baba", "145"],
  aegis4: ["4fb28b28", "cb5b44ca", "e563b729", "8a41a126", "1284e9cd", "3cce7bd5", "156"],
  aegis5: ["9fe233a3", "2751e4da", "d3812e73", "d802aceb", "f86c7e34", "21768082", "156"],
  fleetOps1: ["36f4dbfc", "28ce5790", "93298185", "ff5f4d56", "c93fb19", "701d030", "156"],
  fleetOps2: ["b5d4acc4", "c057b657", "81dac34d", "c16cb235", "815c953c", "3930570f", "156"],
  fleetOps3: ["7ce825b2", "f8d1a282", "19067d1b", "cfd67a94", "9bc512a1", "4e0baba", "156"],
  fleetOps4: ["c732f35c", "38cc1e5e", "7fc698ab", "bc73e8f7", "40785546", "fb47a727", "156"],
  fleetOps5: ["af9ef029", "91dc42b", "298a80f8", "63adff7", "49f066db", "854a268", "156"],
};

describe("WR-5b tactician goldens", () => {
  for (const key of ["none", ...TACTICIAN]) {
    it(`${key}: patrol, ship event, Shipyard repair`, () => {
      const s0 = carrier(key === "none" ? [] : [key as SecondaryTalentKey]);
      const row = [...patrolRow(s0), ...eventRow(s0), repairRow(s0)];
      expect(row).toEqual(GOLDEN[key]);
    }, 60_000);
  }
});
