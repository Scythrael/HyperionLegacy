// G1-0 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-0): golden hashes and
// tables captured on the code BEFORE any short-range engine edit (on top of a678241). They are the "today" record every
// G1 slice compares against: with no short-range dispatch every pin here stays byte-identical, and a slice that moves
// one on purpose (G1-1's quarters affix line is the first) must name the move beside the pin. Whole records, never a
// narrow subset; every whole STATE goes through g1StateHash (no `runCounts`, no `homeworld`, no `shortRangeBoard`),
// so the counters and the board G1-3 adds move nothing by themselves.
//
//   1. fleet    : a mixed fleet (a captain mission on Repeat, a patrol on Repeat, an expedition) advanced six hours
//                 through economyTick, the whole state hashed every hour.
//   2. views    : the Home dashboard and the Ships roster (the Operations pure view helpers) on that fleet at 0, 3
//                 and 6 hours.
//   3. stats    : effectiveShipStats for every hull carrying an Operations and an Engineering complement bucket (so a
//                 quarters module's division multipliers show), bare and with each quarters variety installed (a
//                 derelict piece: implicit lines only, so the affix pool cannot reach it), hashed through statsHash.
//   4. gen      : generateEquipment for the quarters slot at 50 fixed seeds (varieties, rarities, qualities and item
//                 levels cycled), one readable line per seed. Adding an affix to the quarters pool moves these.
//   5. registry : the wiring registry's ids and statuses (hash and count), with the entries a G1 slice adds held
//                 apart (G1_ADDED_ENTRY_IDS), so the base pin proves no existing entry moved.
//   6. old save : a v69 save of the same fleet through deserialize + migrate, its state and every ship's stats.
//   7. beside   : (G1-4) the same fleet with a short-range run added, the OTHER runs' state hashed every hour, captured
//                 while the run still held still (G1-3), so the cycle engine provably leaves every other run as it was.
// Already pinned elsewhere and covered by the same rule: one delivered cycle for every MISSIONS key x every hull
// (firstRunsGoldens.test.ts `gather:*`) and the SF-0 old save (`old:v69` there).
//
// MOVED BY G1-1 (guest quarters), each on purpose; every other pin here is unchanged:
//   gen:quarters   the Crew Quarters pool gained the guest quarters affix (appended, weight 2: total weight 8 -> 10),
//                  so the weighted picks of 46 of the 50 seeds land on other lines, and a guest line is stored in
//                  berths (4 per budget point). GEN_QUARTERS_AT_G1_0 keeps the G1-0 record, and golden 4b proves the
//                  generator reproduces it exactly with the G1-0 pool: the appended affix is the only cause.
//   registry       8 entries ADDED (G1_ADDED_ENTRY_IDS, pinned as `registry:g1`); the base pin is unchanged, so no
//                  existing entry moved.
// MOVED BY G1-2 (templates, sheets and the roll): `registry:g1` gains the 21 short-range template entries (seven
// templates x rolls, work, reward), all pending G1-4; the base pin and every other pin here are unchanged.
// MOVED BY FKR-4 (Field Kits conditions, merged before G1-1): the base `registry` pin moves 1170 -> 1181, entirely
// FKR-4's added and flipped entries (its new condition, severity and inflictor rows, and the rows it flipped live).
// G2-2's registry edits only reword pending owners (pending stays pending), so they hash the same. Then the review
// rulings (user 2026-10-19) flip two entries pending -> live (29f0a757 -> 74fa057, the count unchanged): the Bleed
// status (`away:GAMBIT_STATUSES:bleed`) and its bay row (`away:GROUND_CONDITIONS:bleed`), now that Strikers inflict it.
// MOVED BY CP-8 (graduate, notable cap, manifest; OC-11 pause while out), each on purpose:
//   registry       1181 -> 1182: the pending `crew:audit:notables` row becomes live with its own check, and
//                  `crew:audit:notableIdentityOnly` is added (one row out, two entries in).
//   fleet          hours 1 to 6: OC-11 holds the transport crew for a ship that is out (the freighter on Repeat, the
//                  destroyer on patrol, the Orion on expedition), so those crew wait in the pool. FLEET_BEFORE_OC11
//                  keeps the old record and golden 1 reproduces it with withOc11Off: the pause is the only cause.
//                  The views do not move.
// MOVED BY WR-6 (captain primary, spec, race, Homeworld placeholders): `registry` 93d27465 -> c748495a, the count
// unchanged: nine placeholder entries flip pending -> live (WR6_WIRED_IDS); golden 5 reproduces the old hash with
// those nine read as pending.
// ADDED BY ML-1 (Material Lines items and recipes): 14 registry entries, held apart like G1's (ML1_ADDED_ENTRY_IDS,
// pinned as `registry:ml1`): the seven new Refinery recipes (pending while the Refinery hides them, refineRecipeOffered;
// each reads live by itself once ML-2 gives its output a use) and the seven typed reserves (pending, owned by ML-2 or
// EM-8). No existing entry moved: ML1_SLICE rides in every registryPin call (beside R2-1 and EM-1 since their merge),
// so the base pin and every cause pin are unchanged.
// MOVED BY FKR-5 (grenade charges), its review rulings (user 2026-10-20) and G2-3 (the voyage engine), re-captured
// once at their integration (0.14.0):
//   registry       1182 c748495a -> 1201 e6523a6f: FKR-5 adds 19 entries and flips Explosives pending -> live; the
//                  rulings hide three of the 19 until FKR-7 (FIELD_KITS_PLAYER_LIVE false: the Impact Grenade
//                  blueprint and the Stun and Toxin carry lines) and add one audit row naming them; G2-3 adds two
//                  audit rows. Every registry check goes through registryPin, the one exclusion helper: with those
//                  slices held apart and the flip read back as pending it reproduces c748495a, and with WR-6 read back
//                  too it reproduces the pin from before WR-6. The registry moves before this one: FKR-4, the
//                  2026-10-19 review rulings (the Bleed flips), CP-8 and WR-6 (above).
// MOVED BY E-MOD EM-1 (the power budget engine): `registry` 1201 e6523a6f -> 1212 887dfdf8: EM-1 adds eleven entries
//                  (every hull's basePowerOutput, the drive class draw seam) and flips seven pending -> live (Reactor
//                  Overdrive, Power Discipline, the Martian racial, the powerOutput and powerDrawReduction lines, the
//                  slot and weapon draw rows). With EM1_SLICE held apart registryPin reproduces e6523a6f, and every
//                  earlier proof chain passes it too.
// MOVED BY FKR-6 (kits in battle, rank conditions, the Boss reserve): registry 1212 887dfdf8 -> 1217 a4b86d24 (on the EM-1 pin):
//                  FKR-6 adds 5 entries (the "Ally downed" selector; the two rank conditions, the Boss reserve and the
//                  Field Kits default program under GAMBIT_PROGRAMS) and flips 8 pending -> live (the six kits, the First
//                  Aid and Advanced Medical category rules). Held apart through FKR6_SLICE, the registry hashes exactly
//                  as the pin before it; with EM1_SLICE too it reproduces e6523a6f.
// MOVED BY the inert racials (0.14.0): `registry` 1217 a4b86d24 -> 1218 942844f9 (on the FKR-6 pin): eight entries
//                  flip live (Deck Handling and Survey Aptitude, the Belter, Vael, Outer-Colony and Spacer racials, the
//                  Science and Flight Deck quarters wings) and one audit row joins (the Spacer long-haul ramp, deferred
//                  to 0.14.x). With RACIALS_SLICE and RACIALS_SPACER_SLICE read back registryPin reproduces a4b86d24,
//                  and every earlier proof chain passes them too.
// MOVED BY G1-4 (the cycle engine): `registry:g1` only. The six guest quarters sources and the 21 short-range template
//                  entries flip pending -> live (the cycle reads them at mission:shortRange), and one entry is added,
//                  `captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange` (Shrewd Negotiator at the drop-off's own load).
//                  The mission:shortRange sweep only adds contexts and outOfScope reasons, which the ids-and-statuses
//                  pins do not read, so the base `registry` pin and every cause pin are unchanged. Golden 7 (below)
//                  proves the engine leaves every other run byte-identical.
// MOVED BY FKR-7 (the Field Kits run plumbing): registry 1217 a4b86d24 -> 1219 422b9c70: FKR-7 adds 2 entries (the free
//                  basic set's crew curve, live; the runs switch's audit row, pending FKR-9 / FKR-10) and flips 8 pending
//                  -> live (the free basic set's base, the six Quartermaster kit prices, the Injury Kit's bay treatment
//                  row). Held apart through FKR7_SLICE, the registry hashes exactly as FKR-6's pin.
// MOVED AT the merge of FKR-7 into feat (after the inert racials and G1-4): `registry` 1218 942844f9 / 1219 422b9c70 ->
//                  1220 ee493e11, the two moves together and nothing else: reading back FKR7_SLICE alone reproduces the
//                  racials' 942844f9, the racial slices alone FKR-7's 422b9c70, and both a4b86d24. Every earlier proof
//                  chain holds the racial slices and FKR7_SLICE apart.
// MOVED BY safe first runs SF-3 (Weak placed by the difficulty curve): two entries flip pending -> live
//                  (expedition:ENEMY_RANKS:weak and :weak:hp). SF3_SLICE reads them back in every registryPin call (the
//                  ML-1 pattern), so the base pin and every cause pin are unchanged.
// MOVED BY FKR-9 / FKR-10 (the Field Kits switch-on): `registry` 1220 ee493e11 -> 1223 8ba89020: FIELD_KITS_PLAYER_LIVE
//                  brings back FKR-5's three hidden entries (the Impact Grenade blueprint, the Stun and Toxin carry
//                  lines; FKR5_HIDDEN_UNTIL_FKR7) and the two Field Kits audit rows (the hidden pieces, the runs switch)
//                  flip pending -> live with their own checks. Held apart through FKR9_SLICE, the registry hashes exactly
//                  as the pin before it; every earlier proof chain holds FKR9_SLICE apart too.
// ADDED BY Gas Giant Study GG-1 (content and items, data only): new entries only, held apart like ML-1's (GG1_SLICE,
//                  the ids from gasStudyGoldens.fixture.ts, pinned with their statuses in gasGiantContent.test.ts): the
//                  study uses, every giant class and nebula kind field, the canister sell values, the research data
//                  reserves and the Deuterium Canister recipe. No existing entry moved: GG1_SLICE rides in every
//                  registryPin call, so the base pin and every cause pin are unchanged.
// ADDED BY the timed grenades (user 2026-10-21): new entries only, held apart by FUSE_SLICE (the ids from
//                  fieldKitsFuse.fixture.ts, pinned with their statuses in fieldKitsFuse.test.ts): each grenade's fuse
//                  and moved-clear chance. No existing entry moved: registryPin always applies FUSE_SLICE (as it does
//                  RX_SLICE), so the base pin and every cause pin are unchanged.
// ADDED BY the reactor fuel ladder (0.14.0: the fuel rungs, the core variety tech tags, the hull reactor requirement
//                  seam and the Cometary Ice Harvest's per-field rows): new entries only, held apart by RX_SLICE (the ids
//                  from reactorFuelGoldens.fixture.ts, pinned with their statuses in reactorFuelGoldens.test.ts), which
//                  registryPin always applies, so the base pin and every cause pin are unchanged.
// MOVED BY the Quartermaster Standard-Issue member lines and the D26 line swap (0.14.0): the `si:` entries and three
//                  Science lines added, the nine retired combat lines removed; registryPin always reads them back
//                  (siReadBack, like RX_SLICE), so the base pin and every cause pin are unchanged; `registry:si` pins
//                  the added entries with their statuses and the retired ids.
// MOVED BY ML-2 (the Material Lines recipe rework + the recipe realism audit): `registry:ml1` only. The seven ML-1 recipe
//                  entries flip pending -> live (refineRecipeOffered offers them once their outputs have blueprint
//                  consumers) and the six ML-2 reserves are gone (each good has its consumer); only the Precursor
//                  Circuit's reserve (EM-8) stays. ML1_SLICE holds every ML-1 id apart in every registryPin call, and
//                  ML-2's two new entries (the Biofiber and Resin Distillate refines) are held apart by ML2_SLICE, which
//                  registryPin always applies, so the base pin and every cause pin are unchanged. The ML-1 pin is read
//                  back (ml2LinesBack) to its capture.
// MOVED BY ML-3 (material quality on delivery, OC-D2): nothing pinned here. The rig line's entry flips pending -> live;
//                  ML3_SLICE reads it back as pending in every registryPin call, so the base pin and every cause pin
//                  are unchanged.
// MOVED BY Field Kits FKR-11 (the close-out): nothing pinned here. Inspired's status row flips pending -> live (the
//                  Combat Stim inflicts it); FKR11_SLICE reads it back as pending in every registryPin call, so the base
//                  pin and every cause pin are unchanged. Its three re-owned audit rows stay pending (same lines).
// ADDED BY G1-1: `guests:<hull>` (guest quarters bare and with each quarters variety, the Guest Wing last) and
// `stats:<hull>:guestWing` (every other stat with a Guest Wing installed). The sheets hash through withoutGuests, so
// the stats pins keep proving no other stat moved (the transport hulls now carry base guest quarters).

import { describe, expect, it, vi } from "vitest";
import { gw5ReadBack } from "./gearWearStep5Registry.fixture"; // Gear wear step 5: its deleted and flipped rows read back, innermost
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { cp13OffForThisFile } from "./cp13Switch.fixture";
// Complement CP-13 (hull-family module bonuses) came after every pin here: the file runs with the bonus off, so its pins
// keep proving their own slice (cp13Goldens.test.ts pins what CP-13 moved).
cp13OffForThisFile();
import { cp13ReadBack } from "./cp13Registry.fixture"; // Complement CP-13: its added rows read back, innermost
import { cp14ReadBack } from "./cp14Registry.fixture"; // Complement CP-14: its added, flipped and moved rows read back, innermost
import { cp16ReadBack } from "./cp16Registry.fixture"; // Complement CP-16: its added Hall of Command rows read back, innermost
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { GW3_ADDED_IDS, gw3EntryBack } from "./gearWearRegistry.fixture";
// Gear wear step 4 came after every pin here: its flips are read back (gearWearCombatRegistry.fixture.ts).
import { GW4_ADDED_IDS, gw4EntryBack } from "./gearWearCombatRegistry.fixture";
import { WEAR_SOURCES } from "./gearWear";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about G1 (short-range missions);
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
gearWearOffInThisFile();
// E-MOD EM-1: sheets pinned before the power budget engine are hashed with it switched off (emodGoldens.test.ts pins
// the power numbers and proves the switch reproduces its own capture), so these pins keep proving nothing else moved.
import { withEm1Off } from "./emodEm1Switch.fixture";
import { writeFileSync } from "node:fs";
import Decimal from "break_infinity.js";
import { EQUIPMENT_SLOTS, FIELD_KITS_PLAYER_LIVE, MISSIONS, SHIP_TYPES, type EquipmentInstance, type EquipmentRarity, type GameState, type ShipDerivedStats, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { startShortRangeCycle } from "./shortRangeBoard";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, mintBuiltShip } from "./tick";
import { effectiveShipStats } from "./crewOverlay";
import { budgetAtMult, budgetShares, generateEquipment, rolledLineValue } from "./itemgen";
import { buildHomeDashboard } from "./homeDashboard";
import { buildShipRoster } from "./shipRoster";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { FKR8_ADDED_IDS, FKR8_FLIPPED_LIVE, WIRING_REGISTRY } from "./wiring/registry";
// Wiring WR-11 came after every registry pin here: its flips, added and removed rows are read back (wr11Registry.fixture.ts).
import { wr11ReadBack } from "./wr11Registry.fixture";
import { wr9ReadBack } from "./wr9Registry.fixture";
import { cp5ReadBack } from "./cp5Registry.fixture"; // CP-5: its registry move read back (cp5Registry.fixture.ts)
import { sf7ReadBack } from "./sf7Registry.fixture"; // Safe first runs SF-7: its registry move read back (sf7Registry.fixture.ts)
import { cp11ReadBack } from "./cp11Registry.fixture"; // Complement CP-11: its registry move read back (cp11Registry.fixture.ts)
// E-MOD EM-8 came after every registry pin here: its added rows, the Precursor Lens relic flip and the dropped Precursor
// Circuit reserve are read back (emodEm8Registry.fixture.ts).
import { em8ReadBack } from "./emodEm8Registry.fixture";
import { FAVORS_SPEC_ROW } from "./favoredSpecRegistry.fixture";
import { PATROL_LEGS_ADDED_IDS, PATROL_LEGS_FLIPPED_IDS } from "./patrolLegsRegistry.fixture";
import { PATROL_LEG_LIFTS_ADDED_IDS } from "./patrolLegLiftsRegistry.fixture";
import { CP3_ADDED_IDS, CP3_FLIPPED_IDS } from "./cp3Registry.fixture";
import { E5_2_ADDED_ENTRY_IDS, E5_4_ADDED_ENTRY_IDS } from "./refugeeRegistry.fixture";
import { EM7_ADDED_ENTRY_IDS, EM7_MODULE_SLOTS_IDS } from "./emodEm7Registry.fixture";
// WR-8: every registry pin here was taken before WR-8, so its added entries are left out and its flips read back.
import { wr8ReadBack } from "./combatDescriptorRegistry.fixture";
// E-MOD EM-3 came after these pins: its two added rows are left out (emodEm3Registry.fixture.ts).
import { em3ReadBack } from "./emodEm3Registry.fixture";
// E-MOD EM-4: its added row left out and its flipped row (ship:audit:reactorCoreNet) read back.
import { em4ReadBack } from "./emodEm4Registry.fixture";
import { bucketOf, withBuckets } from "./wiring/probes";
import { hash, onHull, withCrew, withV1Museum, withoutGuests } from "./firstRunsGoldens.fixture";
import { ML2_ADDED_ENTRY_IDS, ml2LinesBack } from "./ml2RecipeGoldens.fixture";
import { ML3_FLIPPED_LIVE } from "./materialQualityGoldens.fixture";
import { asPreG2NamesDispatch, dispatchPastPropulsion, asPrePatrolCurveDispatch } from "./awayTeamTestFixtures";
import { GG1_ADDED_ENTRY_IDS, GG_STUDY_ADDED_ENTRY_IDS, GG_STUDY_FLIPPED_BEFORE } from "./gasStudyGoldens.fixture";
import { FUSE_ADDED_ENTRY_IDS } from "./fieldKitsFuse.fixture";
import { RX_ADDED_ENTRY_IDS } from "./reactorFuelGoldens.fixture";
import { RR_ADDED_ENTRY_IDS } from "./rarityRegistry.fixture";
import { OC15_ADDED_ENTRY_IDS } from "./labFabricatorTiers.fixture";
import { isSiAdded, SI_RETIRED, siReadBack } from "./siMemberGearRegistry.fixture";
// E-MOD EM-5: its two module wear rows, held apart from the gear wear pin.
import { EM5_ADDED_ENTRY_IDS } from "./emodEm5Registry.fixture";
import { R2_2_ADDED_ENTRY_IDS } from "./relicBlanks.fixture";
import { R2_3_ADDED_ENTRY_IDS } from "./relicIdentify.fixture";
import { R2_10_ADDED_ENTRY_IDS } from "./relicMinigame.fixture";
import { R2_4_ADDED_ENTRY_IDS } from "./relicMuseumV2.fixture";
import { G2_4_ADDED_ENTRY_IDS, G2_4_FLIPPED_BEFORE } from "./propulsionRecallGoldens.fixture";
import { G2_6_ADDED_ENTRY_IDS, G2_6_FLIPPED_BEFORE } from "./expeditionConsoleRegistry.fixture";
// CP-8 / OC-11: the test switch that proves the auto-crew pause is the only thing that moved the fleet pin.
vi.mock("./crewLock", async (io) => (await import("./complementOc11Switch.fixture")).oc11CrewLockMock(io));
import { withOc11Off } from "./complementOc11Switch.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

// ===== shared helpers =====

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const RNG = (): number => 0.5;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The whole state WITHOUT the fields the G1 slices (and SF-1 / G2-1 before them) add on purpose: the run counters, the
// stored homeworld and the short-range board (G1-3). A no-op for the board today. Pure.
// Relics v2 R2-1: and with the Museum v2 record in its v1 form (withV1Museum), as these were captured.
function g1StateHash(state: GameState): string {
  const rest = { ...withV1Museum(state) } as Record<string, unknown>;
  delete rest.runCounts;
  delete rest.homeworld;
  delete rest.shortRangeBoard;
  return hash(rest);
}

// A ship's derived stats WITHOUT guest quarters (the optional `colonistCapacity` G1-1 makes live), so these pins prove
// every OTHER stat is unchanged; the guest quarters values have their own pins (`guests:<hull>`). Pure.
function statsHash(stats: ShipDerivedStats): string {
  return hash(withoutGuests(stats));
}

// The nine quarters varieties as they stood at G1-0, named literally so a variety added later never shifts which
// variety a seed rolls below.
const QUARTERS_VARIETIES_AT_G1_0 = [
  "quartersSecurityWing",
  "quartersEngineeringWing",
  "quartersScienceWing",
  "quartersMedicalWing",
  "quartersOperationsWing",
  "quartersFlightDeckWing",
  "quartersUtilitarian",
  "quartersEfficient",
  "quartersElite",
] as const;

// Install `piece` on `shipId` (the slot is a singleton: nothing else of its slot is on the ship in these fixtures).
function withPiece(state: GameState, piece: EquipmentInstance, shipId: string): GameState {
  return { ...state, equipment: [...state.equipment, { ...piece, fittedToShipId: shipId }] };
}

// A derelict quarters piece of `variety` (no affixes: only the implicit lines, which the affix pool cannot reach).
// Rarity readiness RR-7 made Derelict the Standard-Issue floor (Standard's budget). This golden only used Derelict as an
// implicit-only device, so the helper keeps the piece it was captured with: the same mint, its implicit lines at the
// pre-RR-7 Derelict budget (rarity multiplier 1), through the mint's own split and line conversion.
function derelictQuarters(variety: string, id: string): EquipmentInstance {
  const piece = derelictQuartersMint(variety, id);
  const keys = Object.keys(piece.implicitStats);
  const each = keys.length > 0 ? Math.round(budgetShares(budgetAtMult(10, 0, 1)).implicitShare / keys.length) : 0;
  return { ...piece, implicitStats: Object.fromEntries(keys.map((k) => [k, rolledLineValue(k, each)])) };
}
function derelictQuartersMint(variety: string, id: string): EquipmentInstance {
  return generateEquipment({
    slotType: "quarters",
    varietyKey: variety,
    blueprintKey: null,
    iLevel: 10,
    quality: 0,
    rarity: "derelict",
    ascension: "none",
    rng: RNG,
    allocateId: () => id,
  });
}

// ===== the mixed fleet =====

const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));

// ship-1 an Orion with a rank 3 crew (the expedition, captain 1), ship-2 a General Freighter (a captain mission on
// Repeat, captain 2), ship-3 a Destroyer (a patrol on Repeat, captain 3). Mission Control at the highest unlock and the
// stores full of credits, so nothing refuses on what this golden is not about.
function mixedFleet(): GameState {
  const crewed = withCrew(onHull("orion"), "rank3");
  const cap1 = crewed.captains[0];
  // The two extra hulls are minted the way the Shipyard mints a build (Standard Issue on every live slot).
  let acc = { ships: crewed.ships, nextShipId: crewed.nextShipId, equipment: crewed.equipment, nextEquipmentId: crewed.nextEquipmentId };
  const freighter = mintBuiltShip(acc, "generalFreighter");
  acc = freighter;
  const destroyer = mintBuiltShip(acc, "destroyer");
  const captainOf: Record<string, number> = { [freighter.shipId]: 2, [destroyer.shipId]: 3 };
  const fleet: GameState = installMissingCombatBaselines({
    ...crewed,
    credits: new Decimal(1_000_000_000),
    facilities: { ...crewed.facilities, missionControl: { ...crewed.facilities.missionControl, level: MAX_UNLOCK } },
    ships: destroyer.ships.map((sh) => (captainOf[sh.id] === undefined ? sh : { ...sh, assignedCaptainId: captainOf[sh.id] })),
    nextShipId: destroyer.nextShipId,
    equipment: destroyer.equipment,
    nextEquipmentId: destroyer.nextEquipmentId,
    captains: [
      { ...cap1, level: 10 },
      { ...cap1, id: 2, label: "Second", level: 10 },
      { ...cap1, id: 3, label: "Third", level: 10 },
    ],
  });
  // G2-2: the dispatch as it was before G2-2 (the console names and region fields stripped), so the pins hold.
  const exp = asPreG2NamesDispatch(dispatchPastPropulsion(fleet, "ship-1", 1, "cand-0"));
  if (!exp.success) throw new Error(`expedition refused: ${exp.reason}`);
  const mission = dispatchCaptainOnMission(exp.next, 2, "shortOreRun");
  if (!mission.success) throw new Error(`mission refused: ${mission.reason}`);
  const patrol = asPrePatrolCurveDispatch(dispatchCaptainOnPatrol(mission.next, 3, "crimsonReaverSweep", "balanced", true));
  if (!patrol.success) throw new Error(`patrol refused: ${patrol.reason}`);
  return patrol.next;
}

const HOUR = 3600;
const ROSTER_OPTS = { sortKey: "attention", filterKey: "all", searchText: "", favorites: new Set<string>() } as const;

function views(s: GameState): string[] {
  return [hash(buildHomeDashboard(s)), hash(buildShipRoster(s, { ...ROSTER_OPTS, favorites: new Set<string>() }))];
}

// ===== the goldens =====

// Captured on a678241 (feat/crew-0.14.0), before any G1 engine edit. Line layouts: fleet = [start, hour 1 .. hour 6]
// state hashes; views = per checkpoint [home, roster]; stats:<hull> = [bare, then each QUARTERS_VARIETIES_AT_G1_0
// variety installed]; gen:quarters = one line per seed; registry = [count, hash] of the entries outside
// G1_ADDED_ENTRY_IDS; old = [state, then each ship's stats].
const GOLDEN: Record<string, unknown> = {
  "fleet": ["aa94ddcd", "56ea6bfc", "9e282be3", "41544d1e", "cccaec70", "f73efc26", "583cf72c"],
  "views": [["a78ec59d", "f4663cfa"], ["c4d89f65", "f4663cfa"], ["d17143e7", "f4663cfa"]],
  "stats:generalFreighter": ["4ec6953b", "9621706b", "3b508409", "9621706b", "9621706b", "236c0de3", "9621706b", "afbf05cd", "4a09ba9a", "4464e2fe"],
  "stats:prospectorHauler": ["dab172af", "78c579e4", "bcea9e50", "78c579e4", "78c579e4", "1e6e51bf", "78c579e4", "d61272e", "3f250c9b", "fa3a777d"],
  "stats:prospectorRunner": ["b800f591", "29163f38", "d0e53d2b", "29163f38", "29163f38", "25893a46", "29163f38", "f7fe20ff", "72c7bb66", "1d423ca4"],
  "stats:prospectorMiner": ["b8a60abf", "3755c126", "c17b3570", "3755c126", "3755c126", "69acdcee", "3755c126", "8dd3f22c", "e68c12bc", "8ec0eff9"],
  "stats:destroyer": ["3d40bb7a", "b91f0f91", "c66f33cd", "b91f0f91", "b91f0f91", "cc55789", "b91f0f91", "85782d2c", "d0afdfc1", "c32213b"],
  "stats:battleship": ["246f2c62", "bd5d4ab9", "eceed856", "bd5d4ab9", "bd5d4ab9", "e84055e2", "bd5d4ab9", "67e1e8f2", "a93787b5", "d5cfafe4"],
  "stats:carrier": ["67cd439e", "b3fa3c44", "194a823b", "b3fa3c44", "b3fa3c44", "91fc6850", "b3fa3c44", "b5c0637d", "a7d5faeb", "b0640374"],
  "stats:orion": ["859f2c75", "c256a7d0", "eb64ec7c", "c256a7d0", "c256a7d0", "3196d20a", "c256a7d0", "161b8900", "653da10e", "8c2c93b3"],
  "stats:aurora": ["59fc8c38", "b3317c4a", "396e138a", "b3317c4a", "b3317c4a", "2d27e45e", "b3317c4a", "b19122a2", "2a98c2fc", "bdb4d415"],
  "stats:eir": ["f48e6005", "a767cc26", "651f8b7d", "a767cc26", "a767cc26", "149fc15c", "a767cc26", "8a128cf6", "4db4ee6b", "e4802eb5"],
  "stats:generalFreighter:guestWing": "4ec6953b",
  "guests:generalFreighter": [20, 22, 22, 22, 22, 22, 22, 22, 22, 22, 66],
  "stats:prospectorHauler:guestWing": "dab172af",
  "guests:prospectorHauler": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:prospectorRunner:guestWing": "b800f591",
  "guests:prospectorRunner": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:prospectorMiner:guestWing": "b8a60abf",
  "guests:prospectorMiner": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:destroyer:guestWing": "3d40bb7a",
  "guests:destroyer": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:battleship:guestWing": "246f2c62",
  "guests:battleship": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:carrier:guestWing": "67cd439e",
  "guests:carrier": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
  "stats:orion:guestWing": "859f2c75",
  "guests:orion": [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 80],
  "stats:aurora:guestWing": "59fc8c38",
  "guests:aurora": [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 80],
  "stats:eir:guestWing": "f48e6005",
  "guests:eir": [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 120],
  "gen:quarters": [
    "1:quartersEngineeringWing:augmented:q1:iL8:{\"crewStations\":12}:{\"crewStations\":6}:m0:quartersEngineeringWing",
    "2:quartersScienceWing:stellar:q2:iL15:{\"crewStations\":28}:{\"colonistCapacity\":36,\"crewEfficiency\":9}:m0:quartersScienceWing",
    "3:quartersMedicalWing:radiant:q3:iL22:{\"crewStations\":51}:{\"colonistCapacity\":68,\"crewStations\":17}:m0:quartersMedicalWing",
    "4:quartersOperationsWing:standard:q4:iL29:{\"crewStations\":49}:{\"colonistCapacity\":100}:m0:quartersOperationsWing",
    "5:quartersFlightDeckWing:augmented:q5:iL36:{\"crewStations\":77}:{\"crewStations\":38,\"colonistCapacity\":152}:m0:quartersFlightDeckWing",
    "6:quartersUtilitarian:stellar:q0:iL3:{\"crewStations\":5}:{\"colonistCapacity\":8,\"crewStations\":2,\"crewEfficiency\":2}:m0:quartersUtilitarian",
    "7:quartersEfficient:radiant:q1:iL10:{\"crewStations\":19}:{\"colonistCapacity\":24,\"crewStations\":6,\"crewEfficiency\":6}:m0:quartersEfficient",
    "8:quartersElite:standard:q2:iL17:{\"crewStations\":24}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersElite",
    "9:quartersSecurityWing:augmented:q3:iL24:{\"crewStations\":42}:{\"crewStations\":21,\"colonistCapacity\":84}:m0:quartersSecurityWing",
    "10:quartersEngineeringWing:stellar:q4:iL31:{\"crewStations\":69}:{\"colonistCapacity\":92,\"crewStations\":23,\"crewEfficiency\":23}:m0:quartersEngineeringWing",
    "11:quartersScienceWing:radiant:q5:iL38:{\"crewStations\":107}:{\"colonistCapacity\":144,\"crewEfficiency\":36,\"crewStations\":36}:m0:quartersScienceWing",
    "12:quartersMedicalWing:standard:q0:iL5:{\"crewStations\":6}:{\"colonistCapacity\":12,\"crewEfficiency\":3}:m0:quartersMedicalWing",
    "13:quartersOperationsWing:augmented:q1:iL12:{\"crewStations\":18}:{\"colonistCapacity\":36,\"crewStations\":9}:m0:quartersOperationsWing",
    "14:quartersFlightDeckWing:stellar:q2:iL19:{\"crewStations\":35}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersFlightDeckWing",
    "15:quartersUtilitarian:radiant:q3:iL26:{\"crewStations\":61}:{\"colonistCapacity\":80,\"crewEfficiency\":20}:m0:quartersUtilitarian",
    "16:quartersEfficient:standard:q4:iL33:{\"crewStations\":56}:{\"colonistCapacity\":112,\"crewStations\":28}:m0:quartersEfficient",
    "17:quartersElite:augmented:q5:iL40:{\"crewStations\":85}:{\"crewStations\":43,\"crewEfficiency\":43}:m0:quartersElite",
    "18:quartersSecurityWing:stellar:q0:iL7:{\"crewStations\":11}:{\"colonistCapacity\":16,\"crewStations\":4}:m0:quartersSecurityWing",
    "19:quartersEngineeringWing:radiant:q1:iL14:{\"crewStations\":27}:{\"colonistCapacity\":36,\"crewStations\":9,\"crewEfficiency\":9}:m0:quartersEngineeringWing",
    "20:quartersScienceWing:standard:q2:iL21:{\"crewStations\":29}:{\"colonistCapacity\":60,\"crewStations\":15}:m0:quartersScienceWing",
    "21:quartersMedicalWing:augmented:q3:iL28:{\"crewStations\":50}:{\"crewEfficiency\":25,\"colonistCapacity\":100}:m0:quartersMedicalWing",
    "22:quartersOperationsWing:stellar:q4:iL35:{\"crewStations\":78}:{\"colonistCapacity\":104,\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersOperationsWing",
    "23:quartersFlightDeckWing:radiant:q5:iL2:{\"crewStations\":6}:{\"colonistCapacity\":8,\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersFlightDeckWing",
    "24:quartersUtilitarian:standard:q0:iL9:{\"crewStations\":11}:{\"colonistCapacity\":20,\"crewEfficiency\":5}:m0:quartersUtilitarian",
    "25:quartersEfficient:augmented:q1:iL16:{\"crewStations\":24}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersEfficient",
    "26:quartersElite:stellar:q2:iL23:{\"crewStations\":43}:{\"colonistCapacity\":56,\"crewStations\":14}:m0:quartersElite",
    "27:quartersSecurityWing:radiant:q3:iL30:{\"crewStations\":70}:{\"colonistCapacity\":92,\"crewStations\":23}:m0:quartersSecurityWing",
    "28:quartersEngineeringWing:standard:q4:iL37:{\"crewStations\":63}:{\"colonistCapacity\":124,\"crewStations\":31}:m0:quartersEngineeringWing",
    "29:quartersScienceWing:augmented:q5:iL4:{\"crewStations\":9}:{\"crewStations\":4,\"crewEfficiency\":4}:m0:quartersScienceWing",
    "30:quartersMedicalWing:stellar:q0:iL11:{\"crewStations\":17}:{\"colonistCapacity\":24,\"crewStations\":6,\"crewEfficiency\":6}:m0:quartersMedicalWing",
    "31:quartersOperationsWing:radiant:q1:iL18:{\"crewStations\":35}:{\"colonistCapacity\":48,\"crewStations\":12}:m0:quartersOperationsWing",
    "32:quartersFlightDeckWing:standard:q2:iL25:{\"crewStations\":35}:{\"colonistCapacity\":72,\"crewStations\":18}:m0:quartersFlightDeckWing",
    "33:quartersUtilitarian:augmented:q3:iL32:{\"crewStations\":57}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersUtilitarian",
    "34:quartersEfficient:stellar:q4:iL39:{\"crewStations\":87}:{\"colonistCapacity\":116,\"crewEfficiency\":29,\"crewStations\":29}:m0:quartersEfficient",
    "35:quartersElite:radiant:q5:iL6:{\"crewStations\":17}:{\"colonistCapacity\":24,\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersElite",
    "36:quartersSecurityWing:standard:q0:iL13:{\"crewStations\":15}:{\"colonistCapacity\":32}:m0:quartersSecurityWing",
    "37:quartersEngineeringWing:augmented:q1:iL20:{\"crewStations\":29}:{\"colonistCapacity\":60,\"crewEfficiency\":15}:m0:quartersEngineeringWing",
    "38:quartersScienceWing:stellar:q2:iL27:{\"crewStations\":50}:{\"colonistCapacity\":68,\"crewStations\":17,\"crewEfficiency\":17}:m0:quartersScienceWing",
    "39:quartersMedicalWing:radiant:q3:iL34:{\"crewStations\":79}:{\"colonistCapacity\":104,\"crewStations\":26,\"crewEfficiency\":26}:m0:quartersMedicalWing",
    "40:quartersOperationsWing:standard:q4:iL1:{\"crewStations\":2}:{\"colonistCapacity\":4,\"crewStations\":1}:m0:quartersOperationsWing",
    "41:quartersFlightDeckWing:augmented:q5:iL8:{\"crewStations\":17}:{\"crewStations\":9}:m0:quartersFlightDeckWing",
    "42:quartersUtilitarian:stellar:q0:iL15:{\"crewStations\":23}:{\"colonistCapacity\":32,\"crewStations\":8,\"crewEfficiency\":8}:m0:quartersUtilitarian",
    "43:quartersEfficient:radiant:q1:iL22:{\"crewStations\":43}:{\"colonistCapacity\":56,\"crewStations\":14}:m0:quartersEfficient",
    "44:quartersElite:standard:q2:iL29:{\"crewStations\":41}:{\"colonistCapacity\":80,\"crewEfficiency\":20}:m0:quartersElite",
    "45:quartersSecurityWing:augmented:q3:iL36:{\"crewStations\":64}:{\"crewStations\":32}:m0:quartersSecurityWing",
    "46:quartersEngineeringWing:stellar:q4:iL3:{\"crewStations\":7}:{\"colonistCapacity\":8,\"crewEfficiency\":2}:m0:quartersEngineeringWing",
    "47:quartersScienceWing:radiant:q5:iL10:{\"crewStations\":28}:{\"colonistCapacity\":36,\"crewStations\":9}:m0:quartersScienceWing",
    "48:quartersMedicalWing:standard:q0:iL17:{\"crewStations\":20}:{\"colonistCapacity\":40}:m0:quartersMedicalWing",
    "49:quartersOperationsWing:augmented:q1:iL24:{\"crewStations\":35}:{\"crewStations\":18,\"crewEfficiency\":18}:m0:quartersOperationsWing",
    "50:quartersFlightDeckWing:stellar:q2:iL31:{\"crewStations\":57}:{\"colonistCapacity\":76,\"crewStations\":19}:m0:quartersFlightDeckWing",
    "pool:[{\"stat\":\"crewStations\",\"weight\":5},{\"stat\":\"crewEfficiency\",\"weight\":2},{\"stat\":\"massReduction\",\"weight\":1},{\"stat\":\"colonistCapacity\",\"weight\":2}]",
  ],
  "registry": [1213, "2c74b0d9"],
  // Gear wear steps 1 and 2: the 41 pending `wear` entries (held apart from every other registry pin by GW_SLICE).
  "registry:gearWear": [41, "b8143ac4"],
  // Gear wear step 3 (2026-10-21): the 41 `wear` entries with their statuses and live contexts (every use source,
  // repair context and bonus live, eleven efficiency consumers live; the battle sources, the combat consumers, the
  // reactor's output and the drive's engine efficiency pending), plus ship:audit:slotDurability (live) and
  // ship:audit:slotDurabilityDefense (added, pending step 4). Re-pinned at the merge with feat (EM-5): its two module
  // rows joined (the use source wired live by step 3, the combat consumer pending step 4): 43 -> 45 rows.
  "registry:gearWear:step3": [45, "d4db10f5"],
  // The Quartermaster Standard-Issue member lines and the D26 line swap (0.14.0): read back in every registry pin
  // (siReadBack); the added entries with their statuses, then the retired ids.
  "registry:si": [
    "gear:science:fieldSuit:groundHazardResist|live",
    "gear:science:sidearm:groundFieldwork|live",
    "gear:science:sidearm:groundRelicFind|live",
    "si:security:ballisticWeave:groundArmor|live",
    "si:security:ballisticWeave:groundHp|live",
    "si:science:fieldSuit:groundFieldwork|live",
    "si:science:fieldSuit:groundHazardResist|live",
    "si:prospecting:excavatorSuit:groundHazardResist|deferred",
    "si:prospecting:excavatorSuit:groundFieldwork|deferred",
    "si:security:pulseRifle:groundPower|live",
    "si:security:pulseRifle:groundAccuracy|live",
    "si:science:sidearm:groundRelicFind|live",
    "si:science:sidearm:groundFieldwork|live",
    "si:prospecting:plasmaCutter:groundOreYield|deferred",
    "si:prospecting:plasmaCutter:groundFieldwork|deferred",
    "si:security:medKit:groundHp|live",
    "si:science:floraScanner:groundOrganicsYield|live",
    "si:science:floraScanner:groundFieldwork|live",
    "si:prospecting:assayScanner:groundOreGrade|deferred",
    "si:prospecting:assayScanner:groundFieldwork|deferred",
    "retired:gear:science:fieldSuit:groundHp",
    "retired:gear:science:fieldSuit:groundArmor",
    "retired:gear:science:hazardSuit:groundHp",
    "retired:gear:science:hazardSuit:groundArmor",
    "retired:gear:prospecting:hazardSuit:groundHp",
    "retired:gear:prospecting:hazardSuit:groundArmor",
    "retired:gear:science:sidearm:groundPower",
    "retired:gear:science:sidearm:groundAccuracy",
    "retired:gear:science:sidearm:groundStatusChance",
  ],
  // Re-pinned by ML-2: the seven recipes live, the six ML-2 reserves gone (ML1_PIN_BEFORE_ML2 is the ML-1 capture).
  "registry:ml1": [
    "facility:REFINE_RECIPES:refineFerriteIngot|live",
    "facility:REFINE_RECIPES:refineReclaimedCircuit|live",
    "facility:REFINE_RECIPES:refineIridiumCatalyst|live",
    "facility:REFINE_RECIPES:synthCobaltCoil|live",
    "facility:REFINE_RECIPES:synthOsmiumPlate|live",
    "facility:REFINE_RECIPES:synthPhotonicGel|live",
    "facility:REFINE_RECIPES:synthBiocatalyst|live",
    "facility:ITEMS:precursorCircuit:reserved|pending",
  ],
  "registry:g1": ["captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange|live", "ship:gearLine:colonistCapacity|live", "ship:SHIP_TYPES:generalFreighter:colonistCapacity|live", "ship:SHIP_TYPES:orion:colonistCapacity|live", "ship:SHIP_TYPES:aurora:colonistCapacity|live", "ship:SHIP_TYPES:eir:colonistCapacity|live", "ship:SHIP_SEAMS:generalQuartersGuestPerk|live", "ship:QUARTERS_MODULES:quartersGuestWing|live", "ship:QUARTERS_MODULES:quartersGuestWing:capacity|live",
    // G1-2: the short-range template catalog; G1-4 flipped every one live (the cycle engine reads it).
    "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:rolls|live", "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:work|live", "mission:SHORT_RANGE_TEMPLATES:refugeeRelocation:reward|live", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:rolls|live", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:work|live", "mission:SHORT_RANGE_TEMPLATES:supplyDropOff:reward|live", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:rolls|live", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:work|live", "mission:SHORT_RANGE_TEMPLATES:supplyPickup:reward|live", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:rolls|live", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:work|live", "mission:SHORT_RANGE_TEMPLATES:phenomenonSurvey:reward|live", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:rolls|live", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:work|live", "mission:SHORT_RANGE_TEMPLATES:telescopeRepair:reward|live", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:rolls|live", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:work|live", "mission:SHORT_RANGE_TEMPLATES:commBoosterBuild:reward|live", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:rolls|live", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:work|live", "mission:SHORT_RANGE_TEMPLATES:prisonerTransport:reward|live"],
  "old": ["aa94ddcd", "817862c7", "4ac62731", "d9a483c6"],
  // G1-4 golden 7, captured on 047b133 (the short-range run held still there): the OTHER runs beside it.
  "fleet:shortRange:others": ["5329673d", "29572349", "388259d2", "c32245d1", "3c38a24b", "f9fe2b3a", "4bcd2925"],
};

// The G1-0 record of golden 4 (captured on a678241), with the pool it was drawn from, kept for golden 4b.
const GEN_QUARTERS_AT_G1_0: readonly string[] = [
  "1:quartersEngineeringWing:augmented:q1:iL8:{\"crewStations\":12}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersEngineeringWing",
  "2:quartersScienceWing:stellar:q2:iL15:{\"crewStations\":28}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersScienceWing",
  "3:quartersMedicalWing:radiant:q3:iL22:{\"crewStations\":51}:{\"crewEfficiency\":17,\"crewStations\":17}:m0:quartersMedicalWing",
  "4:quartersOperationsWing:standard:q4:iL29:{\"crewStations\":49}:{\"crewEfficiency\":25}:m0:quartersOperationsWing",
  "5:quartersFlightDeckWing:augmented:q5:iL36:{\"crewStations\":77}:{\"crewStations\":38}:m0:quartersFlightDeckWing",
  "6:quartersUtilitarian:stellar:q0:iL3:{\"crewStations\":5}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersUtilitarian",
  "7:quartersEfficient:radiant:q1:iL10:{\"crewStations\":19}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersEfficient",
  "8:quartersElite:standard:q2:iL17:{\"crewStations\":24}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersElite",
  "9:quartersSecurityWing:augmented:q3:iL24:{\"crewStations\":42}:{\"crewStations\":21,\"crewEfficiency\":21}:m0:quartersSecurityWing",
  "10:quartersEngineeringWing:stellar:q4:iL31:{\"crewStations\":69}:{\"crewEfficiency\":23,\"crewStations\":23}:m0:quartersEngineeringWing",
  "11:quartersScienceWing:radiant:q5:iL38:{\"crewStations\":107}:{\"crewEfficiency\":36,\"crewStations\":36}:m0:quartersScienceWing",
  "12:quartersMedicalWing:standard:q0:iL5:{\"crewStations\":6}:{\"crewEfficiency\":3,\"crewStations\":3}:m0:quartersMedicalWing",
  "13:quartersOperationsWing:augmented:q1:iL12:{\"crewStations\":18}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersOperationsWing",
  "14:quartersFlightDeckWing:stellar:q2:iL19:{\"crewStations\":35}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersFlightDeckWing",
  "15:quartersUtilitarian:radiant:q3:iL26:{\"crewStations\":61}:{\"crewEfficiency\":20,\"crewStations\":20}:m0:quartersUtilitarian",
  "16:quartersEfficient:standard:q4:iL33:{\"crewStations\":56}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersEfficient",
  "17:quartersElite:augmented:q5:iL40:{\"crewStations\":85}:{\"crewStations\":43,\"crewEfficiency\":43}:m0:quartersElite",
  "18:quartersSecurityWing:stellar:q0:iL7:{\"crewStations\":11}:{\"crewEfficiency\":4,\"crewStations\":4}:m0:quartersSecurityWing",
  "19:quartersEngineeringWing:radiant:q1:iL14:{\"crewStations\":27}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersEngineeringWing",
  "20:quartersScienceWing:standard:q2:iL21:{\"crewStations\":29}:{\"crewEfficiency\":15,\"crewStations\":15}:m0:quartersScienceWing",
  "21:quartersMedicalWing:augmented:q3:iL28:{\"crewStations\":50}:{\"crewStations\":25}:m0:quartersMedicalWing",
  "22:quartersOperationsWing:stellar:q4:iL35:{\"crewStations\":78}:{\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersOperationsWing",
  "23:quartersFlightDeckWing:radiant:q5:iL2:{\"crewStations\":6}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersFlightDeckWing",
  "24:quartersUtilitarian:standard:q0:iL9:{\"crewStations\":11}:{\"crewEfficiency\":5,\"crewStations\":5}:m0:quartersUtilitarian",
  "25:quartersEfficient:augmented:q1:iL16:{\"crewStations\":24}:{\"crewStations\":12}:m0:quartersEfficient",
  "26:quartersElite:stellar:q2:iL23:{\"crewStations\":43}:{\"crewEfficiency\":14,\"crewStations\":14}:m0:quartersElite",
  "27:quartersSecurityWing:radiant:q3:iL30:{\"crewStations\":70}:{\"crewEfficiency\":23,\"crewStations\":23}:m0:quartersSecurityWing",
  "28:quartersEngineeringWing:standard:q4:iL37:{\"crewStations\":63}:{\"crewEfficiency\":31,\"crewStations\":31}:m0:quartersEngineeringWing",
  "29:quartersScienceWing:augmented:q5:iL4:{\"crewStations\":9}:{\"crewStations\":4,\"crewEfficiency\":4}:m0:quartersScienceWing",
  "30:quartersMedicalWing:stellar:q0:iL11:{\"crewStations\":17}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersMedicalWing",
  "31:quartersOperationsWing:radiant:q1:iL18:{\"crewStations\":35}:{\"crewEfficiency\":12,\"crewStations\":12}:m0:quartersOperationsWing",
  "32:quartersFlightDeckWing:standard:q2:iL25:{\"crewStations\":35}:{\"crewEfficiency\":18,\"crewStations\":18}:m0:quartersFlightDeckWing",
  "33:quartersUtilitarian:augmented:q3:iL32:{\"crewStations\":57}:{\"crewEfficiency\":28,\"crewStations\":28}:m0:quartersUtilitarian",
  "34:quartersEfficient:stellar:q4:iL39:{\"crewStations\":87}:{\"crewEfficiency\":29,\"crewStations\":29}:m0:quartersEfficient",
  "35:quartersElite:radiant:q5:iL6:{\"crewStations\":17}:{\"crewEfficiency\":6,\"crewStations\":6}:m0:quartersElite",
  "36:quartersSecurityWing:standard:q0:iL13:{\"crewStations\":15}:{\"crewEfficiency\":8}:m0:quartersSecurityWing",
  "37:quartersEngineeringWing:augmented:q1:iL20:{\"crewStations\":29}:{\"crewEfficiency\":15}:m0:quartersEngineeringWing",
  "38:quartersScienceWing:stellar:q2:iL27:{\"crewStations\":50}:{\"crewEfficiency\":17,\"crewStations\":17}:m0:quartersScienceWing",
  "39:quartersMedicalWing:radiant:q3:iL34:{\"crewStations\":79}:{\"crewEfficiency\":26,\"crewStations\":26}:m0:quartersMedicalWing",
  "40:quartersOperationsWing:standard:q4:iL1:{\"crewStations\":2}:{\"crewStations\":1}:m0:quartersOperationsWing",
  "41:quartersFlightDeckWing:augmented:q5:iL8:{\"crewStations\":17}:{\"crewStations\":9,\"crewEfficiency\":9}:m0:quartersFlightDeckWing",
  "42:quartersUtilitarian:stellar:q0:iL15:{\"crewStations\":23}:{\"crewStations\":8,\"crewEfficiency\":8}:m0:quartersUtilitarian",
  "43:quartersEfficient:radiant:q1:iL22:{\"crewStations\":43}:{\"crewStations\":14,\"crewEfficiency\":14}:m0:quartersEfficient",
  "44:quartersElite:standard:q2:iL29:{\"crewStations\":41}:{\"crewStations\":20}:m0:quartersElite",
  "45:quartersSecurityWing:augmented:q3:iL36:{\"crewStations\":64}:{\"crewEfficiency\":32,\"crewStations\":32}:m0:quartersSecurityWing",
  "46:quartersEngineeringWing:stellar:q4:iL3:{\"crewStations\":7}:{\"crewEfficiency\":2,\"crewStations\":2}:m0:quartersEngineeringWing",
  "47:quartersScienceWing:radiant:q5:iL10:{\"crewStations\":28}:{\"crewEfficiency\":9,\"crewStations\":9}:m0:quartersScienceWing",
  "48:quartersMedicalWing:standard:q0:iL17:{\"crewStations\":20}:{\"crewEfficiency\":10}:m0:quartersMedicalWing",
  "49:quartersOperationsWing:augmented:q1:iL24:{\"crewStations\":35}:{\"crewStations\":18,\"crewEfficiency\":18}:m0:quartersOperationsWing",
  "50:quartersFlightDeckWing:stellar:q2:iL31:{\"crewStations\":57}:{\"crewStations\":19,\"crewEfficiency\":19}:m0:quartersFlightDeckWing",
  "pool:[{\"stat\":\"crewStations\",\"weight\":5},{\"stat\":\"crewEfficiency\",\"weight\":2},{\"stat\":\"massReduction\",\"weight\":1}]",
];

const QUARTERS_POOL_AT_G1_0 = [
  { stat: "crewStations", weight: 5 },
  { stat: "crewEfficiency", weight: 2 },
  { stat: "massReduction", weight: 1 },
];
// The registry entries a G1 slice adds (new ids only; an existing entry never changes here). G1-1: the guest quarters
// sources (the gear line, the four transport hulls' bases, the General quarters perk) and the Guest Wing module. G1-2:
// the short-range template catalog's 21 effect fields.
const G1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "ship:gearLine:colonistCapacity",
  "ship:SHIP_TYPES:generalFreighter:colonistCapacity",
  "ship:SHIP_TYPES:orion:colonistCapacity",
  "ship:SHIP_TYPES:aurora:colonistCapacity",
  "ship:SHIP_TYPES:eir:colonistCapacity",
  "ship:SHIP_SEAMS:generalQuartersGuestPerk",
  "ship:QUARTERS_MODULES:quartersGuestWing",
  "ship:QUARTERS_MODULES:quartersGuestWing:capacity",
  // G1-2: every effect field of every short-range template (rolls, work, reward), pending the cycle engine (G1-4).
  ...["refugeeRelocation", "supplyDropOff", "supplyPickup", "phenomenonSurvey", "telescopeRepair", "commBoosterBuild", "prisonerTransport"].flatMap((k) =>
    ["rolls", "work", "reward"].map((f) => `mission:SHORT_RANGE_TEMPLATES:${k}:${f}`),
  ),
  // G1-4: Shrewd Negotiator on a short-range drop-off (its own load, so its own entry beside the supply-run one).
  "captain:SECONDARY_CAPTAIN_TALENTS:trade2:shortRange",
]);
// The ML-1 entries as ML-1 pinned them (before ML-2 offered the recipes and dropped six reserves).
const ML1_PIN_BEFORE_ML2: readonly string[] = [
  ...["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map(
    (k) => `facility:REFINE_RECIPES:${k}|pending`,
  ),
  ...["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst", "precursorCircuit"].map((id) => `facility:ITEMS:${id}:reserved|pending`),
];
// The registry entries ML-1 adds (new ids only): its seven Refinery recipes and its seven typed reserves.
const ML1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...["refineFerriteIngot", "refineReclaimedCircuit", "refineIridiumCatalyst", "synthCobaltCoil", "synthOsmiumPlate", "synthPhotonicGel", "synthBiocatalyst"].map(
    (k) => `facility:REFINE_RECIPES:${k}`,
  ),
  ...["reclaimedCircuit", "iridiumCatalyst", "cobaltCoil", "osmiumPlate", "photonicGel", "biocatalyst", "precursorCircuit"].map((id) => `facility:ITEMS:${id}:reserved`),
]);

// Field Kits FKR-5 (tool charges and the grenade family), held apart by the cause checks: the 19 entries it ADDS (the
// Impact Grenade's three lines and the carry line on the two older grenades, each grenade's four GRENADES rows, the
// throwGrenade action, the Impact Grenade blueprint's research) and the ONE entry it FLIPS pending -> live (Explosives:
// Saboteur on the Saboteur's own throws), read back as pending there.
const FKR5_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "gear:security:stunGrenade:groundCarryCapacity",
  "gear:security:toxinGrenade:groundCarryCapacity",
  "gear:security:impactGrenade:groundPower",
  "gear:security:impactGrenade:groundAccuracy",
  "gear:security:impactGrenade:groundCarryCapacity",
  ...["stunGrenade", "toxinGrenade", "impactGrenade"].flatMap((k) => ["charges", "perBattle", "blast", "status"].map((f) => `away:GRENADES:${k}:${f}`)),
  "away:GAMBIT_ACTIONS:throwGrenade",
  "facility:BLUEPRINTS:impactGrenadeBp",
]);
const FKR5_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["away:KIT_CATEGORY_RULES:explosives"]);
// The review rulings (user 2026-10-20 "Hide until kits are live"): while FIELD_KITS_PLAYER_LIVE is false three of
// FKR-5's entries are not in the registry (the Impact Grenade blueprint waits outside BLUEPRINTS; the Stun and Toxin
// carry lines are not rollable), and one audit row naming them is added (pending FKR-7). Held apart with FKR-5.
const FKR5_HIDDEN_UNTIL_FKR7: ReadonlySet<string> = new Set<string>([
  "gear:security:stunGrenade:groundCarryCapacity",
  "gear:security:toxinGrenade:groundCarryCapacity",
  "facility:BLUEPRINTS:impactGrenadeBp",
]);
const FKR5_RULINGS_ADDED: ReadonlySet<string> = new Set<string>(["away:audit:fieldKitsHiddenPieces"]);
// Expedition Tiers G2-3 (the voyage engine) ADDS two audit rows (the voyage ladder above Tier I, owner G2-6; the drive
// class halving, owner G2-4). Its ship speed rows went live at Ground Ops but stay partial (pending for the patrol), so
// their status kind hashes the same.
const G23_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["expedition:audit:voyageDeepTiers", "expedition:audit:voyageDriveClass"]);
// The `registry` pin on the feat base before FKR-5 and G2-3 merged (after WR-6, CP-8 and G1-2).
const REGISTRY_BEFORE_FKR5_G23 = [1172, "be5b185"];
// Field Kits FKR-6 (kits in battle), held apart by the cause checks: the 5 entries it ADDS and the 8 it FLIPS pending
// -> live (read back as pending there). The registry pin before it is REGISTRY_BEFORE_FKR6.
const FKR6_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "away:GAMBIT_SELECTORS:allyDowned",
  "away:GAMBIT_PROGRAMS:minRank:elite",
  "away:GAMBIT_PROGRAMS:minRank:boss",
  "away:GAMBIT_PROGRAMS:reserveForBoss",
  "away:GAMBIT_PROGRAMS:fieldKitsDefault",
]);
const FKR6_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>([
  ...["firstAidKit", "antitoxin", "combatStim", "splint", "traumaKit", "injuryKit"].map((k) => `away:FIELD_KITS:${k}`),
  "away:KIT_CATEGORY_RULES:firstAid",
  "away:KIT_CATEGORY_RULES:advancedMedical",
]);
const REGISTRY_BEFORE_FKR6 = [1191, "3c7c531a"];
// Field Kits FKR-7 (the run plumbing), held apart by the cause checks: the 2 entries it ADDS (the free basic set's crew
// curve, the runs switch's audit row, pending FKR-9 / FKR-10) and the 8 it FLIPS pending -> live (the free basic set's
// base, the six Quartermaster kit prices, the Injury Kit's bay treatment row). The pin before it is REGISTRY_BEFORE_FKR7
// (FKR-6's). The hidden pieces row only changed its owner (FKR-9 / FKR-10), so its status kind hashes the same.
const FKR7_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["away:FREE_BASIC_SET:firstAidKit:crew", "away:audit:fieldKitsRunsSwitch"]);
const FKR7_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>([
  "away:FREE_BASIC_SET:firstAidKit",
  ...["firstAidKit", "antitoxin", "combatStim", "splint", "traumaKit", "injuryKit"].map((k) => `facility:FIELD_KIT_PRICES:${k}`),
  "away:audit:treatmentShare",
]);
const REGISTRY_BEFORE_FKR7 = [1207, "a1dfe1d1"];
// The pins the inert racials (on feat) and FKR-7 (on its branch) each left, both from REGISTRY_BEFORE_FKR7. Merged,
// reading back only the OTHER slice reproduces each one.
const REGISTRY_RACIALS_PIN = [1208, "eb0323ca"];
const REGISTRY_FKR7_PIN = [1209, "c556ecad"];
// Field Kits FKR-9 / FKR-10 (the switch-on), held apart by the cause checks: the three FKR-5 entries the switch shows
// again (stripped) and the two audit rows it flips pending -> live. The pin before it is REGISTRY_BEFORE_FKR9.
const FKR9_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["away:audit:fieldKitsHiddenPieces", "away:audit:fieldKitsRunsSwitch"]);
const REGISTRY_BEFORE_FKR9 = [1210, "40beebae"];

// The ONE exclusion helper every registry pin goes through. Each slice names the entries it ADDED (stripped) and the
// entries it FLIPPED (read back as their earlier status), so a pin taken before that slice is reproduced exactly and
// proves no other entry moved. Lines are `${id}|${status kind}` in registry order; the pin is [count, hash].
type RegistrySlice = { readonly added?: ReadonlySet<string>; readonly flipped?: ReadonlySet<string>; readonly was?: string };
const G1_SLICE: RegistrySlice = { added: G1_ADDED_ENTRY_IDS };
const ML1_SLICE: RegistrySlice = { added: ML1_ADDED_ENTRY_IDS };
const GG1_SLICE: RegistrySlice = { added: GG1_ADDED_ENTRY_IDS };
// Timed grenades (user 2026-10-21): the fuse's added entries (fieldKitsFuse.fixture.ts), held apart like GG-1's.
const FUSE_SLICE: RegistrySlice = { added: FUSE_ADDED_ENTRY_IDS };
const FKR5_SLICE: RegistrySlice = { added: new Set([...FKR5_ADDED_ENTRY_IDS, ...FKR5_RULINGS_ADDED]), flipped: FKR5_FLIPPED_LIVE, was: "pending" };
const G23_SLICE: RegistrySlice = { added: G23_ADDED_ENTRY_IDS };
const FKR6_SLICE: RegistrySlice = { added: FKR6_ADDED_ENTRY_IDS, flipped: FKR6_FLIPPED_LIVE, was: "pending" };
const FKR7_SLICE: RegistrySlice = { added: FKR7_ADDED_ENTRY_IDS, flipped: FKR7_FLIPPED_LIVE, was: "pending" };
const FKR9_SLICE: RegistrySlice = { added: FKR5_HIDDEN_UNTIL_FKR7, flipped: FKR9_FLIPPED_LIVE, was: "pending" };
// Gear wear steps 1 and 2 (0.14.0): the `wear` system's entries are additions only (every wear source, repair
// context, repair bonus and efficiency consumer, and two step 5 audit rows, all pending); its four re-owned OC-D14
// audit rows stay pending, so their lines hash the same. GW_SLICE rides in every registryPin call (the ML1_SLICE
// precedent), so the base pin and every cause pin are unchanged; `registry:gearWear` pins the additions.
// Gear wear step 3 rides in the same slice: its added audit row (the defense pieces' toughness, step 4) is held apart
// and its toughness audit row (ship:audit:slotDurability, flipped live) read back as pending (gearWearRegistry.fixture.ts);
// every `wear:` entry is held apart already, whatever its status.
const GW_SLICE: RegistrySlice = {
  added: new Set([...WIRING_REGISTRY.filter((e) => e.id.startsWith("wear:")).map((e) => e.id), ...GW3_ADDED_IDS]),
  flipped: new Set(["ship:audit:slotDurability"]),
  was: "pending",
};
// Safe first runs SF-3 (the difficulty curve places Weak enemies): the two Weak rank entries it FLIPPED pending -> live.
// Like ML1_SLICE it rides in every registryPin call (read back as pending), so the base pin and every cause pin are
// unchanged; the test "SF-3 is the only cause" proves the flips are the whole move.
const SF3_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["expedition:ENEMY_RANKS:weak", "expedition:ENEMY_RANKS:weak:hp"]);
const SF3_SLICE: RegistrySlice = { flipped: SF3_FLIPPED_LIVE, was: "pending" };
// The reactor fuel ladder's additions (0.14.0), held apart in EVERY pin (all of them were taken before it).
const RX_SLICE: RegistrySlice = { added: RX_ADDED_ENTRY_IDS };
// Rarity readiness RR-3 and up: the added rarity entries (RARITY_PROFILES rows), held apart in EVERY pin the same way
// (rarityProfiles.test.ts pins them).
const RR_SLICE: RegistrySlice = { added: RR_ADDED_ENTRY_IDS };
// Expedition Tiers G2-4 / G2-5 (after every pin here): their added entries and their flips, held apart the same way.
const G2_4_PENDING_FLIPS: RegistrySlice = { flipped: new Set(Object.keys(G2_4_FLIPPED_BEFORE).filter((id) => G2_4_FLIPPED_BEFORE[id].kind === "pending")), was: "pending" };
const G2_4_SEAM_FLIPS: RegistrySlice = { flipped: new Set(Object.keys(G2_4_FLIPPED_BEFORE).filter((id) => G2_4_FLIPPED_BEFORE[id].kind === "seam")), was: "seam" };
const G2_4_SLICES: readonly RegistrySlice[] = [{ added: G2_4_ADDED_ENTRY_IDS }, G2_4_PENDING_FLIPS, G2_4_SEAM_FLIPS];
// Expedition Tiers G2-6 (the console's region picker and recall), after every pin here: the three rows it ADDS and the
// rows it FLIPS pending -> live (expeditionConsoleRegistry.fixture.ts), held apart the same way in EVERY pin.
const G2_6_SLICES: readonly RegistrySlice[] = [{ added: G2_6_ADDED_ENTRY_IDS }, { flipped: new Set(Object.keys(G2_6_FLIPPED_BEFORE)), was: "pending" }];
// G1-6 (SHORT_RANGE_BOARD_LIVE, the board UI), after every pin here too: the two Mission Control board rungs it put in
// FACILITIES (each a facility rung entry) and G1-3's audit row, flipped pending -> live with its gate check. Held apart
// in EVERY pin (the RX_SLICE pattern); "G1-6 is the only cause" below proves that is the whole move.
const G16_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(["facility:FACILITIES:missionControl:1", "facility:FACILITIES:missionControl:2"]);
const G16_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["facility:audit:missionControlUnlock"]);
const G16_SLICE: RegistrySlice = { added: G16_ADDED_ENTRY_IDS, flipped: G16_FLIPPED_LIVE, was: "pending" };
// Relics v2 R2-2's five audit rows, held apart in EVERY pin the same way (relicBlanks.test.ts pins them).
const R2_2_SLICE: RegistrySlice = { added: R2_2_ADDED_ENTRY_IDS };
// Relics v2 R2-3's three audit rows, the same (relicIdentify.test.ts pins them).
const R2_3_SLICE: RegistrySlice = { added: R2_3_ADDED_ENTRY_IDS };
// Relics v2 R2-4's additions (one per-copy entry per tier above I, the soft cap row), the same (relicsV2Museum.test.ts
// pins them). Its RELIC_TYPES / EXCEPTIONAL_SETS flips need no read-back here: R2_1_SLICE holds those entries apart.
const R2_4_SLICE: RegistrySlice = { added: R2_4_ADDED_ENTRY_IDS };
// Relics v2 R2-10's 17 minigame relic boost audit rows, the same (relicBoosts.test.ts pins them).
const R2_10_SLICE: RegistrySlice = { added: R2_10_ADDED_ENTRY_IDS };
// ML-2's two new entries (the Biofiber and Resin Distillate refines), held apart in EVERY pin (all were taken before it).
const ML2_SLICE: RegistrySlice = { added: ML2_ADDED_ENTRY_IDS };
// The OC-15 Lab and Fabricator tier rungs (0.14.0): one added entry per new rung, held apart in EVERY pin the same way
// (labFabricatorTiers.test.ts pins them live).
const OC15_SLICE: RegistrySlice = { added: OC15_ADDED_ENTRY_IDS };
// ML-3 (material quality on delivery, OC-D2): the rig line's entry it FLIPPED pending -> live, read back as pending in
// EVERY pin (all were taken before it); the test "ML-3 is the only cause" proves the flip is the whole move.
const ML3_SLICE: RegistrySlice = { flipped: ML3_FLIPPED_LIVE, was: "pending" };
// The Quartermaster Standard-Issue member lines and the D26 line swap (0.14.0): read back in EVERY pin (all of them were
// taken before it) through siReadBack (siMemberGearRegistry.fixture.ts: the `si:` entries and the three new Science
// lines left out, the nine retired combat lines restored in place); `registry:si` pins the added and retired ids.
// Gas Giant Study GG-2 / GG-3 (the engine slices): entries they FLIPPED pending -> live (the gas giant's orbitalOnly row
// and the GG-1 study entries they wired; gasStudyGoldens.fixture.ts), read back as pending in EVERY pin (all of them were
// taken before GG-2), so the base pin and every cause pin are unchanged.
// GG-3 also ADDS one entry (the probe dive seam), left out the same way.
const GG_STUDY_SLICE: RegistrySlice = { added: GG_STUDY_ADDED_ENTRY_IDS, flipped: new Set(GG_STUDY_FLIPPED_BEFORE.keys()), was: "pending" };
// E-MOD EM-7 (the v1 module roster), after every pin here: its added rows (one per module and the Survey Pair tier) and
// the hulls' moduleSlots rows it FLIPPED pending -> live (emodEm7Registry.fixture.ts), held apart in EVERY pin.
const EM7_SLICE: RegistrySlice = { added: EM7_ADDED_ENTRY_IDS, flipped: EM7_MODULE_SLOTS_IDS, was: "pending" };
// Gear wear step 4: outside the `wear:` entries (GW_SLICE holds them apart) it flipped ship:audit:podDurability live
// (its defense toughness row is GW3_ADDED_IDS, held apart too). Rides in every pin like EM7_SLICE.
const GW4_SLICE: RegistrySlice = { added: GW4_ADDED_IDS, flipped: new Set(["ship:audit:podDurability"]), was: "pending" };
// Field Kits FKR-11 (the close-out), after every pin here: Inspired's status row flipped pending -> live (the Combat
// Stim inflicts it). Its three re-owned audit rows stay pending, so their lines hash the same. Read back in EVERY pin
// (the ML3_SLICE pattern); "FKR-11 is the only cause" below proves the flip is the whole move.
const FKR11_FLIPPED_LIVE: ReadonlySet<string> = new Set<string>(["away:GAMBIT_STATUSES:inspired"]);
const FKR11_SLICE: RegistrySlice = { flipped: FKR11_FLIPPED_LIVE, was: "pending" };
// Field Kits FKR-8 (the field devices roll per use, on the ground), after every pin here: the Field Devices kit category
// and its two audit rows flipped pending -> live, and OC-F1's two added audit rows (reinforcement, salvage). Held apart in
// EVERY pin (the ML3_SLICE pattern); "FKR-8 is the only cause" below proves the flips and additions are the whole move.
const FKR8_SLICE: RegistrySlice = { added: FKR8_ADDED_IDS, flipped: new Set(Object.keys(FKR8_FLIPPED_LIVE)), was: "pending" };
// WR-7 follow-up OC-D5 (favorsSpec, "+10% on its ship type"), after every pin here: its one audit row flipped pending ->
// live (favoredSpecRegistry.fixture.ts). Read back in EVERY pin (the ML3_SLICE pattern).
const OC_D5_SLICE: RegistrySlice = { flipped: new Set([FAVORS_SPEC_ROW]), was: "pending" };
// WR-7 follow-up OC-D8 (patrol legs), after every pin here: the transit sources' patrol context flipped pending -> live
// and ship:audit:patrolLegs added (patrolLegsRegistry.fixture.ts). Read back in EVERY pin (the ML3_SLICE pattern).
const OC_D8_SLICE: RegistrySlice = { added: PATROL_LEGS_ADDED_IDS, flipped: PATROL_LEGS_FLIPPED_IDS, was: "pending" };
// The OC-D8 follow-up (Fast Departure / Fast Return on patrols), after every pin here: its two audit rows added
// (patrolLegLiftsRegistry.fixture.ts). Read back in EVERY pin.
const OC_D8_LIFTS_SLICE: RegistrySlice = { added: PATROL_LEG_LIFTS_ADDED_IDS };
// Complement plan CP-3 (the Ground Ops complement consumers), after every pin here: four crew keys and the Security and
// Medical quarters wings flipped pending -> live, and one audit row added (cp3Registry.fixture.ts). Read back in EVERY pin.
const CP3_SLICE: RegistrySlice = { added: CP3_ADDED_IDS, flipped: CP3_FLIPPED_IDS, was: "pending" };
// E5-2 (Refugee Posts), after every pin here: the Evacuation template's three rows added, all live
// (refugeeRegistry.fixture.ts). Read back in EVERY pin.
const E5_2_SLICE: RegistrySlice = { added: E5_2_ADDED_ENTRY_IDS };
// E5-4 (Refugee Posts), after every pin here: the sixteen refugee post rows added, all live. Read back in EVERY pin.
const E5_4_SLICE: RegistrySlice = { added: E5_4_ADDED_ENTRY_IDS };
function registryPin(...given: readonly RegistrySlice[]): [number, string] {
  const slices = [RX_SLICE, RR_SLICE, FUSE_SLICE, ML2_SLICE, OC15_SLICE, R2_2_SLICE, R2_3_SLICE, R2_4_SLICE, R2_10_SLICE, G16_SLICE, ...G2_4_SLICES, ...G2_6_SLICES, ML3_SLICE, GG_STUDY_SLICE, EM7_SLICE, FKR11_SLICE, FKR8_SLICE, GW4_SLICE, OC_D5_SLICE, OC_D8_SLICE, OC_D8_LIFTS_SLICE, CP3_SLICE, E5_2_SLICE, E5_4_SLICE, ...given];
  const rows = siReadBack(em4ReadBack(em3ReadBack(wr8ReadBack(wr11ReadBack(wr9ReadBack(em8ReadBack(cp5ReadBack(sf7ReadBack(cp11ReadBack(cp13ReadBack(cp14ReadBack(cp16ReadBack(WIRING_REGISTRY)))))))))))).map((e) => ({ id: e.id, kind: e.status.kind as string })), (r) => r.id, (row) => ({ id: row[0], kind: row[1].kind as string }));
  const lines = rows.filter((e) => !slices.some((sl) => sl.added?.has(e.id))).map((e) => {
    const flip = slices.find((sl) => sl.flipped?.has(e.id));
    return `${e.id}|${flip ? (flip.was ?? "pending") : e.kind}`;
  });
  return [lines.length, hash(lines)];
}

const CAPTURE = Boolean(import.meta.env.G1_CAPTURE);
const captured: Record<string, unknown> = {};
function pin(key: string, value: unknown): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN[key]);
}

function fleetRun(): { hours: string[]; seen: string[][]; s: GameState } {
  let s = mixedFleet();
  const hours: string[] = [g1StateHash(s)];
  const seen: string[][] = [views(s)];
  for (let h = 1; h <= 6; h++) {
    s = economyTick(s, HOUR, RNG);
    hours.push(g1StateHash(s));
    if (h === 3 || h === 6) seen.push(views(s));
  }
  return { hours, seen, s };
}

// The `registry` pin before WR-6 (after CP-8), and the nine entries WR-6 flips pending -> live.
const REGISTRY_BEFORE_WR6 = [1172, "cd6876f8"];
const WR6_WIRED_IDS: ReadonlySet<string> = new Set<string>([
  "captain:CAPTAIN_TALENTS:tacticianHub",
  "captain:CAPTAIN_TALENTS:explorerHub",
  "captain:CAPTAIN_SPEC_BONUS:tactical",
  "captain:CAPTAIN_SPEC_BONUS:science",
  "captain:progression:race",
  "fleetAdmiral:HOMEWORLD_TALENTS:fleetLogisticsSalvage",
  "fleetAdmiral:HOMEWORLD_TALENTS:industryHub",
  "fleetAdmiral:HOMEWORLD_TALENTS:homelandDefenseHub",
  "fleetAdmiral:HOMEWORLD_TALENTS:citizenryHub",
]);
const WR6_SLICE: RegistrySlice = { flipped: WR6_WIRED_IDS, was: "pending" };

// E-MOD EM-1: the `registry` pin before EM-1 (the feat base after FKR-5, G2-3 and R2-1), the seven entries EM-1 flips
// pending -> live and the eleven it adds (every hull's basePowerOutput and the drive class draw seam).
const REGISTRY_BEFORE_EM1 = [1191, "3c7c531a"];
const EM1_WIRED_IDS: ReadonlySet<string> = new Set<string>([
  "officer:officer.powerEfficiencyMult",
  "crew:crew.powerEfficiency",
  "racial:martian",
  "ship:gearLine:powerOutput",
  "ship:gearLine:powerDrawReduction",
  "ship:audit:slotPowerDraw",
  "ship:audit:weaponPowerDraw",
]);
const EM1_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...HULLS.map((h) => `ship:SHIP_TYPES:${h}:basePowerOutput`),
  "ship:SHIP_SEAMS:driveClassPowerDraw",
]);
const EM1_SLICE: RegistrySlice = { added: EM1_ADDED_ENTRY_IDS, flipped: EM1_WIRED_IDS, was: "pending" };

// The inert racials (0.14.0, user "everything wired" 2026-10-20): the `registry` pin before them (after EM-1) and the
// entries they flip live. Seven were pending (Deck Handling and Survey Aptitude, the Belter, Vael and Outer-Colony
// racials, the Science and Flight Deck quarters wings); the Spacer was deferred (its old long-haul ramp). One audit row
// is added: the Spacer long-haul ramp itself, still the user's 0.14.x deferral (crew:audit:spacerLongHaulRamp).
const REGISTRY_BEFORE_RACIALS = [1207, "a1dfe1d1"];
const RACIALS_WIRED_IDS: ReadonlySet<string> = new Set<string>([
  "crew:crew.droneHandling",
  "crew:crew.surveyAptitude",
  "racial:belter",
  "racial:outerColony",
  "racial:vael",
  "ship:QUARTERS_MODULES:quartersScienceWing",
  "ship:QUARTERS_MODULES:quartersFlightDeckWing",
]);
const RACIALS_SLICE: RegistrySlice = { added: new Set<string>(["crew:audit:spacerLongHaulRamp"]), flipped: RACIALS_WIRED_IDS, was: "pending" };
const RACIALS_SPACER_SLICE: RegistrySlice = { flipped: new Set<string>(["racial:spacer"]), was: "deferred" };

// The `fleet` record before OC-11 (captured on a678241); reproduced with the pause off.
const FLEET_BEFORE_OC11 = ["aa94ddcd", "1a72036c", "5008dacf", "cbf18a80", "6c8ebe80", "33d00a42", "19f8bdb2"];

describe("G1-0 golden 1 + 2: a mixed fleet over six hours, and the Home and Ships views on it", () => {
  it("the whole state every hour, and the views at 0, 3 and 6 hours", () => {
    const { hours, seen, s } = fleetRun();
    // Still out: the mission and the patrol repeat, the expedition is on its way.
    expect(s.captains[1].mission).not.toBeNull();
    expect(s.captains[2].mission).not.toBeNull();
    expect(s.expeditions.length).toBe(1);
    pin("fleet", hours);
    pin("views", seen);
  });
  // CP-8 / OC-11: with the pause off the run reproduces the record from before OC-11, views included.
  it("OC-11 is the only cause of the fleet move", () => {
    const before = withOc11Off(() => fleetRun());
    expect(before.hours).toEqual(FLEET_BEFORE_OC11);
    expect(before.seen).toEqual(GOLDEN.views);
  });
});

describe("G1-0 golden 3: effectiveShipStats for every hull, bare and with each quarters variety", () => {
  for (const hull of HULLS) {
    it(`${hull}`, () => {
      const s0 = withBuckets(onHull(hull), [bucketOf("operations", "ops.unloadSpeed"), bucketOf("engineering", "eng.range"), bucketOf("operations", "ops.effectiveCargo")]);
      const ship = s0.ships[0];
      const out = [statsHash(withEm1Off(() => effectiveShipStats(s0, ship)))];
      // G1-1: guest quarters, bare then each variety (the G1-0 nine, then the Guest Wing).
      const guests = [effectiveShipStats(s0, ship).colonistCapacity ?? 0];
      for (const v of QUARTERS_VARIETIES_AT_G1_0) {
        const s = withPiece(s0, derelictQuarters(v, `equip-q-${v}`), ship.id);
        out.push(statsHash(withEm1Off(() => effectiveShipStats(s, ship))));
        guests.push(effectiveShipStats(s, ship).colonistCapacity ?? 0);
      }
      pin(`stats:${hull}`, out);
      const wing = withPiece(s0, derelictQuarters("quartersGuestWing", "equip-q-wing"), ship.id);
      guests.push(effectiveShipStats(wing, ship).colonistCapacity ?? 0);
      pin(`stats:${hull}:guestWing`, statsHash(withEm1Off(() => effectiveShipStats(wing, ship))));
      pin(`guests:${hull}`, guests);
    });
  }
});

// Golden 4's lines: one per seed (variety, rarity, quality, iLevel, the implicit and rolled lines, mass, the stamp),
// then the pool the seeds draw from, so a move names its cause.
function genQuartersLines(): string[] {
    const rarities: EquipmentRarity[] = ["standard", "augmented", "stellar", "radiant"];
    const out: string[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const variety = QUARTERS_VARIETIES_AT_G1_0[seed % QUARTERS_VARIETIES_AT_G1_0.length];
      const rarity = rarities[seed % rarities.length];
      const quality = seed % 6;
      const iLevel = 1 + ((seed * 7) % 40);
      const p = generateEquipment({
        slotType: "quarters",
        varietyKey: variety,
        blueprintKey: null,
        iLevel,
        quality,
        rarity,
        ascension: "none",
        rng: lcg(0x6100 + seed),
        allocateId: () => `equip-${seed}`,
      });
      out.push(`${seed}:${variety}:${rarity}:q${quality}:iL${iLevel}:${JSON.stringify(p.implicitStats)}:${JSON.stringify(p.rolledStats)}:m${p.mass}:${p.moduleVariant}`);
    }
    out.push(`pool:${JSON.stringify(EQUIPMENT_SLOTS.quarters.affixPool)}`);
    return out;
}

describe("G1-0 golden 4: generateEquipment for the quarters slot at 50 fixed seeds", () => {
  it("one line per seed: variety, rarity, quality, iLevel, the implicit and rolled lines, mass", () => {
    pin("gen:quarters", genQuartersLines());
  });

  // G1-1: the move's cause, proven. With the pool put back to its G1-0 table the generator reproduces the G1-0 record
  // line for line, so the appended guest quarters affix is the ONLY thing that moved these rolls (the berth
  // conversion touches only guest lines, which the G1-0 pool cannot roll).
  it("4b: with the G1-0 pool the generator reproduces the G1-0 record exactly", () => {
    const slot = EQUIPMENT_SLOTS.quarters;
    const live = slot.affixPool;
    slot.affixPool = QUARTERS_POOL_AT_G1_0.map((e) => ({ ...e }));
    try {
      expect(genQuartersLines()).toEqual(GEN_QUARTERS_AT_G1_0);
    } finally {
      slot.affixPool = live;
    }
    expect(slot.affixPool.map((e) => e.stat)).toEqual([...QUARTERS_POOL_AT_G1_0.map((e) => e.stat), "colonistCapacity"]);
  });
});

// Relics v2 R2-1: the dormant v2 catalog's entries (RELIC_TYPES, EXCEPTIONAL_SETS) are additions too, appended after
// the relic entries; leaving them out keeps proving that no existing entry moved.
const isRelicsV2Entry = (id: string): boolean => id.startsWith("relic:RELIC_TYPES:") || id.startsWith("relic:EXCEPTIONAL_SETS:");
const R2_1_SLICE: RegistrySlice = { added: new Set(WIRING_REGISTRY.filter((e) => isRelicsV2Entry(e.id)).map((e) => e.id)) };

describe("G1-0 golden 5: the wiring registry's ids and statuses", () => {
  it("the entries outside the G1 additions, hashed in registry order", () => {
    pin("registry", registryPin(GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE));
  });
  it("Field Kits FKR-11 is the only cause of its registry move (Inspired's status row flips live)", () => {
    expect(WIRING_REGISTRY.filter((e) => FKR11_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(["live"]);
  });
  it("Field Kits FKR-8 is the only cause of its registry move (three flips live, two audit rows added, all live)", () => {
    expect(WIRING_REGISTRY.filter((e) => e.id in FKR8_FLIPPED_LIVE).map((e) => e.status.kind)).toEqual(["live", "live", "live"]);
    expect(WIRING_REGISTRY.filter((e) => FKR8_ADDED_IDS.has(e.id)).map((e) => e.status.kind)).toEqual(["live", "live"]);
  });
  it("ML-3 is the only cause of its registry move (the rig line's entry flips live)", () => {
    expect(WIRING_REGISTRY.filter((e) => ML3_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(["live"]);
  });
  it("safe first runs SF-3 is the only cause of its registry move (Weak's two entries flip live)", () => {
    expect(WIRING_REGISTRY.filter((e) => SF3_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(["live", "live"]);
    expect(registryPin(GW_SLICE, G1_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE)).not.toEqual(registryPin(GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE));
  });
  // FKR-9 / FKR-10: the switch-on's three re-shown entries held apart and its two audit flips read back as pending, the
  // lines hash to the pin from before it, so those are the only move.
  it("FKR-9 / FKR-10 (the Field Kits switch-on) is the only cause of its registry move", () => {
    expect(FIELD_KITS_PLAYER_LIVE).toBe(true);
    expect(WIRING_REGISTRY.filter((e) => FKR9_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(["live", "live"]);
    expect(WIRING_REGISTRY.filter((e) => FKR5_HIDDEN_UNTIL_FKR7.has(e.id))).toHaveLength(FKR5_HIDDEN_UNTIL_FKR7.size);
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE)).toEqual(REGISTRY_BEFORE_FKR9);
  });
  // The inert racials: their eight flips read back (seven pending, the Spacer deferred) and their one audit row left
  // out, the lines hash to the pin from before them, so those are the only move.
  it("the inert racials are the only cause of their registry move", () => {
    expect(WIRING_REGISTRY.filter((e) => RACIALS_WIRED_IDS.has(e.id) || e.id === "racial:spacer").map((e) => e.status.kind)).toEqual(Array(RACIALS_WIRED_IDS.size + 1).fill("live"));
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_FKR7_PIN);
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE, FKR7_SLICE)).toEqual(REGISTRY_BEFORE_RACIALS);
  });
  // FKR-5 and G2-3 moved the pin (see the header); with their entries held apart and the Explosives flip read back as
  // pending, the registry hashes exactly as the feat base before them.
  it("FKR-7 is the only cause of its registry move", () => {
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE, FKR7_SLICE)).toEqual(REGISTRY_RACIALS_PIN);
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE, FKR7_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_BEFORE_FKR7);
    expect(WIRING_REGISTRY.filter((e) => FKR7_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(Array(FKR7_FLIPPED_LIVE.size).fill("live"));
    expect(WIRING_REGISTRY.filter((e) => FKR7_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`)).toEqual([
      "away:FREE_BASIC_SET:firstAidKit:crew|live",
      // FKR-9 / FKR-10 flipped the runs switch's row live (FKR9_SLICE reads it back as pending for the pins).
      "away:audit:fieldKitsRunsSwitch|live",
    ]);
  });
  it("FKR-6 is the only cause of its registry move", () => {
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, R2_1_SLICE, EM1_SLICE, ML1_SLICE, FKR6_SLICE, FKR7_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_BEFORE_FKR6);
    expect(WIRING_REGISTRY.filter((e) => FKR6_ADDED_ENTRY_IDS.has(e.id) || FKR6_FLIPPED_LIVE.has(e.id)).map((e) => e.status.kind)).toEqual(
      Array(FKR6_ADDED_ENTRY_IDS.size + FKR6_FLIPPED_LIVE.size).fill("live"),
    );
  });
  it("FKR-5 and G2-3 are the only causes of the registry move", () => {
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, FKR5_SLICE, G23_SLICE, R2_1_SLICE, EM1_SLICE, FKR6_SLICE, FKR7_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_BEFORE_FKR5_G23);
  });
  // E-MOD EM-1: the seven power entries it wires flip pending -> live (the count and the order hold). With those seven
  // read as pending again the lines hash to the pin from before EM-1, so the flips are the only move.
  it("EM-1 is the only cause of its registry move", () => {
    expect(WIRING_REGISTRY.filter((e) => EM1_WIRED_IDS.has(e.id)).map((e) => e.status.kind)).toEqual(Array(EM1_WIRED_IDS.size).fill("live"));
    expect(WIRING_REGISTRY.filter((e) => EM1_ADDED_ENTRY_IDS.has(e.id))).toHaveLength(EM1_ADDED_ENTRY_IDS.size);
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, R2_1_SLICE, EM1_SLICE, FKR6_SLICE, FKR7_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_BEFORE_EM1);
  });
  // WR-6: the nine placeholder entries it wires flip pending -> live (the count and the order hold). With those nine
  // read as pending again (and the later slices held apart) the lines hash to the pin from before WR-6, so the flips
  // are the only move.
  it("WR-6 is the only cause of the registry move", () => {
    expect(WIRING_REGISTRY.filter((e) => WR6_WIRED_IDS.has(e.id)).map((e) => e.status.kind)).toEqual(Array(WR6_WIRED_IDS.size).fill("live"));
    expect(registryPin(FKR9_SLICE, GW_SLICE, G1_SLICE, SF3_SLICE, GG1_SLICE, ML1_SLICE, FKR5_SLICE, G23_SLICE, WR6_SLICE, R2_1_SLICE, EM1_SLICE, FKR6_SLICE, FKR7_SLICE, RACIALS_SLICE, RACIALS_SPACER_SLICE)).toEqual(REGISTRY_BEFORE_WR6);
  });
  it("Field Kits FKR-5: the added entries and the one flipped, each with its status", () => {
    const added = WIRING_REGISTRY.filter((e) => FKR5_ADDED_ENTRY_IDS.has(e.id));
    const shown = [...FKR5_ADDED_ENTRY_IDS].filter((id) => FIELD_KITS_PLAYER_LIVE || !FKR5_HIDDEN_UNTIL_FKR7.has(id));
    expect(added.map((e) => e.id).sort()).toEqual(shown.sort());
    expect(added.every((e) => e.status.kind === "live")).toBe(true);
    if (!FIELD_KITS_PLAYER_LIVE) for (const id of FKR5_RULINGS_ADDED) expect(WIRING_REGISTRY.find((e) => e.id === id)?.status.kind, id).toBe("pending");
    for (const id of FKR5_FLIPPED_LIVE) expect(WIRING_REGISTRY.find((e) => e.id === id)?.status.kind, id).toBe("live");
  });
  it("G1-6 (the board goes live) is the only cause of its registry move: two rung entries in, one audit row live", () => {
    const lines = WIRING_REGISTRY.filter((e) => G16_ADDED_ENTRY_IDS.has(e.id) || G16_FLIPPED_LIVE.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    expect(lines).toEqual(["facility:FACILITIES:missionControl:1|live", "facility:FACILITIES:missionControl:2|live", "facility:audit:missionControlUnlock|live"]);
    // registryPin holds these apart in every pin, and every pin above still reproduces its capture, so nothing else moved.
  });
  it("G1-1: the added entries, each with its status", () => {
    const added = WIRING_REGISTRY.filter((e) => G1_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    expect(added.length).toBe(G1_ADDED_ENTRY_IDS.size);
    pin("registry:g1", added);
  });
  it("gear wear steps 1 and 2: the added entries, each with its status (all pending; step 3 read back)", () => {
    // Step 3's flips read back (gearWearRegistry.fixture.ts), the step 2 pin reproduces: step 3 moved only its own rows.
    // E-MOD EM-5's two module wear rows (emodEm5Registry.fixture.ts) are held apart: they came after this pin.
    const added = gw5ReadBack(WIRING_REGISTRY).filter((e) => e.id.startsWith("wear:") && !EM5_ADDED_ENTRY_IDS.has(e.id))
      .map((e) => gw3EntryBack(gw4EntryBack(e))!)
      .map((e) => `${e.id}|${e.status.kind}`);
    expect(added.length).toBeGreaterThan(30);
    expect(added.every((l) => l.endsWith("|pending"))).toBe(true);
    pin("registry:gearWear", [added.length, hash(added)]);
  });
  it("gear wear step 3: the wear entries and its two audit rows, each with its status", () => {
    // Gear wear step 4's flips read back (gearWearCombatRegistry.fixture.ts): the step 3 pin reproduces.
    const rows = gw5ReadBack(WIRING_REGISTRY).filter((e) => e.id.startsWith("wear:") || e.id === "ship:audit:slotDurability" || GW3_ADDED_IDS.has(e.id)).map(gw4EntryBack).map(
      (e) => `${e.id}|${e.status.kind}|${e.contexts.join(",")}`,
    );
    // Every use source, repair context and bonus is live; the battle sources and the combat consumers wait for step 4.
    expect(rows.filter((l) => l.startsWith("wear:WEAR_SOURCES:") && l.includes("|live|")).length).toBe(WEAR_SOURCES.filter((w) => w.mode === "use").length);
    pin("registry:gearWear:step3", [rows.length, hash(rows)]);
  });
  it("Quartermaster Standard-Issue member lines and the D26 swap: the added entries with their statuses, and the retired ids", () => {
    const added = WIRING_REGISTRY.filter((e) => isSiAdded(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    expect(added.every((l) => (l.startsWith("si:prospecting:") ? l.endsWith("|deferred") : l.endsWith("|live")))).toBe(true);
    for (const { row } of SI_RETIRED) expect(WIRING_REGISTRY.some((e) => e.id === row[0]), row[0]).toBe(false);
    pin("registry:si", [...added, ...SI_RETIRED.map(({ row }) => `retired:${row[0]}`)]);
  });
  it("ML-1: the added entries, each with its status", () => {
    // E-MOD EM-8 dropped the last ML-1 reserve (the Precursor Circuit has its consumer): read back here (em8ReadBack),
    // so this pin keeps proving ML-1 and ML-2; the live registry has no reserve row left.
    expect(WIRING_REGISTRY.filter((e) => ML1_ADDED_ENTRY_IDS.has(e.id) && e.id.endsWith(":reserved"))).toEqual([]);
    const added = em8ReadBack(WIRING_REGISTRY).filter((e) => ML1_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}`);
    // ML-2 dropped six of ML-1's reserves (their goods have consumers now), so 8 of the 14 ids remain.
    expect(added.length).toBe(ML1_ADDED_ENTRY_IDS.size - 6);
    pin("registry:ml1", added);
    // Read back: ML-2's lifts pending again and its dropped reserves restored, the ML-1 capture.
    expect(ml2LinesBack(added)).toEqual(ML1_PIN_BEFORE_ML2);
  });
});

describe("G1-0 golden 6: an old save (v69) of the mixed fleet through migrate", () => {
  it("the migrated state and every ship's stats", () => {
    const held = mixedFleet();
    const save = deserialize(serialize(held, 0)) as SaveFile;
    const state = migrate({ ...save, version: 69 });
    pin("old", [g1StateHash(state), ...state.ships.map((sh) => statsHash(withEm1Off(() => effectiveShipStats(state, sh))))]);
  });
});

// ===== G1-4 golden 7: a short-range run beside the mixed fleet =====

// The mixed fleet plus a fourth captain (id 4) flying a General Freighter on short-range slot 0, its first cycle started
// through the board's own cycle-start seam (startShortRangeCycle; the sheet gate is the dispatch's, not the cycle's).
const SR_CAPTAIN_ID = 4;
function fleetWithShortRange(): { s: GameState; shipId: string } {
  const base = mixedFleet();
  const minted = mintBuiltShip(base, "generalFreighter");
  const captain = { ...base.captains[0], id: SR_CAPTAIN_ID, label: "Fourth", level: 10, mission: null };
  const s: GameState = {
    ...base,
    ships: minted.ships.map((sh) => (sh.id === minted.shipId ? { ...sh, assignedCaptainId: SR_CAPTAIN_ID } : sh)),
    nextShipId: minted.nextShipId,
    equipment: minted.equipment,
    nextEquipmentId: minted.nextEquipmentId,
    captains: [...base.captains, captain],
  };
  const ship = s.ships.find((sh) => sh.id === minted.shipId)!;
  const start = startShortRangeCycle(s, ship, { id: 0, tier: 1 }, 0, undefined, true);
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId: 0, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false };
  return { s: { ...s, captains: s.captains.map((c) => (c.id === SR_CAPTAIN_ID ? { ...c, mission } : c)), runCounts: start.runCounts }, shipId: minted.shipId };
}

// Everything the OTHER runs own: their captains, the expedition, their ships, the timed processes and the officers on
// their ships. A short-range run's own rewards (credits, the Warehouse, XP, lifetime totals, counters) are left out.
function othersHash(s: GameState, shipId: string): string {
  return hash({
    captains: s.captains.filter((c) => c.id !== SR_CAPTAIN_ID),
    expeditions: s.expeditions,
    ships: s.ships.filter((sh) => sh.id !== shipId),
    activeProcesses: s.activeProcesses,
    officers: s.officers.filter((o) => o.assignedShipId !== shipId),
  });
}

describe("G1-4 golden 7: a short-range run beside the mixed fleet leaves every other run byte-identical", () => {
  it("the other runs' state every hour for six hours", () => {
    let { s, shipId } = fleetWithShortRange();
    const hours = [othersHash(s, shipId)];
    for (let h = 1; h <= 6; h++) {
      s = economyTick(s, HOUR, RNG);
      hours.push(othersHash(s, shipId));
    }
    expect(s.captains[1].mission).not.toBeNull();
    expect(s.captains[2].mission).not.toBeNull();
    expect(s.expeditions.length).toBe(1);
    pin("fleet:shortRange:others", hours);
  });
});

describe.runIf(CAPTURE)("G1-0 capture (G1_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.G1_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
