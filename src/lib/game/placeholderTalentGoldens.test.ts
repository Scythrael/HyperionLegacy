// WR-6 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-6): golden hashes captured
// on the code BEFORE any WR-6 engine edit (the CP-0 / FK-3 / G2-0 / SF-0 / WR-4 / WR-5 pattern). Each variant owns
// ONE WR-6 source on otherwise identical saves (or none), and reads every column:
//
//   sheet    : the crew-boosted ship stat sheet (effectiveShipStats) of an explorer-ready save.
//   dispatch : the Ground Ops run record a dispatch of that save's first candidate freezes.
//   done     : that run advanced to its end (advanceExpedition), the record.
//   claim    : the state after the claim.
//   mission  : a Short Ore Run flown 900 economyTick seconds.
//   patrol   : a destroyer's Repeat patrol: the dispatch record, then the state after 900 seconds.
//   event    : the Ground Ops ship-event profile frozen at dispatch, and one battle of it against the Cloaked Vessel.
//   teardown : a second General Freighter torn down at the Salvage Bay (salvageShip, band draw 0.5).
//   craft    : 40 Fabricator jobs started through startProcess (20 blanks, 20 Frame Segments), then resolved.
//   crew     : three crew transport windows delivered (resolveCrew).
//
// Every state hash normalizes the variant's own input away (the captain's talents, spec and race, the Homeworld
// talents), so before WR-6 wires anything every variant reads EXACTLY the baseline (the sources are inert): that is
// the capture. The WR-6 commit re-pins ONLY the parts a source moves, each with its reason beside it, and the
// baseline ("none") never moves.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, blueprintMintsEquipmentInstance, type GameState, type HomeworldTalentKey, type PatrolMissionState } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, resolveProcesses, startProcess } from "./tick";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { effectiveShipStats, resolveCrew } from "./crewOverlay";
import { salvageShip } from "./salvage";
import { resolveBattle } from "./combat/resolveBattle";
import { shipToCombatant } from "./combat/bridge";
import { makeWeaponInstance } from "./combat/weapons";
import { CLOAKED_VESSEL_HULL, buildShipCombatant, snapshotShipEventProfile } from "./shipScanEvents";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { WIRING_BUCKET_COUNT, bucketOf, editCaptain, installPiece, seatOfficer, withAwayTeam, withBuckets, withFacilityLevel, withHomeworld, wiringBase } from "./wiring/probes";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(JSON.stringify(v));
// A state without the variant's own input, so an inert source reads the baseline.
const hashState = (s: GameState): string =>
  hash({
    ...s,
    unlockedHomeworldTalents: [],
    captains: s.captains.map((c) => ({ ...c, unlockedCaptainTalents: [], spec: null, race: undefined })),
  });

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

export type Wr6Variant =
  | "none"
  | "tacticianHub"
  | "explorerHub"
  | "tacticalSpec"
  | "scienceSpec"
  | "captainRace"
  | "fleetLogisticsSalvage"
  | "industryHub"
  | "homelandDefenseHub"
  | "citizenryHub";

export const WR6_VARIANTS: readonly Wr6Variant[] = [
  "tacticianHub",
  "explorerHub",
  "tacticalSpec",
  "scienceSpec",
  "captainRace",
  "fleetLogisticsSalvage",
  "industryHub",
  "homelandDefenseHub",
  "citizenryHub",
];

// The variant's one source on `s` (captain 1, or the fleet's Homeworld talents).
function own(s: GameState, v: Wr6Variant): GameState {
  switch (v) {
    case "none":
      return s;
    case "tacticianHub":
    case "explorerHub":
      return editCaptain(s, { unlockedCaptainTalents: [v] });
    case "tacticalSpec":
      return editCaptain(s, { spec: "tactical" });
    case "scienceSpec":
      return editCaptain(s, { spec: "science" });
    case "captainRace":
      // Station-born: crew.unloadSpeed, a live racial key (the sheet and the mission unload read it).
      return editCaptain(s, { race: "stationBorn" });
    default:
      return withHomeworld(s, [v as HomeworldTalentKey]);
  }
}

// The explorer-ready save (the WR-5c golden's shape, on the current branch defaults).
function explorerFixture(): GameState {
  let s = installMissingCombatBaselines(wiringBase());
  s = installPiece(s, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  s = withBuckets(s, [
    bucketOf("security", "sec.boarding", WIRING_BUCKET_COUNT),
    bucketOf("science", "sci.rareFind", WIRING_BUCKET_COUNT),
    bucketOf("operations", "ops.unloadSpeed", WIRING_BUCKET_COUNT),
  ]);
  s = seatOfficer(s, "science", ["sci.discovery", "sci.yieldSurge"]);
  s = withAwayTeam(s);
  s = withFacilityLevel(s, "research", 1);
  return { ...s, expeditionSeed: 0x6c0e1, gameTimeSeconds: 100_000 };
}

function patrolFixture(): GameState {
  const s = seatOfficer(installMissingCombatBaselines(wiringBase("destroyer")), "tactical", ["tac.weaponCommand"]);
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

// Two General Freighters (the Salvage Bay refuses the fleet's last hull).
function teardownFixture(): GameState {
  const s = wiringBase();
  const spare = { ...s.ships[0], id: "ship-2", assignedCaptainId: null };
  return { ...s, ships: [...s.ships, spare] };
}

const BLANK_KEY = Object.keys(BLUEPRINTS).find((k) => blueprintMintsEquipmentInstance(BLUEPRINTS[k]))!;

function craftColumn(s0: GameState): string {
  let s: GameState = { ...s0, inventory: {} };
  for (let i = 0; i < 40; i++) {
    const effect = i % 2 === 0
      ? { type: "addBlank" as const, blueprintKey: BLANK_KEY }
      : { type: "addItem" as const, itemId: "frameSegment", amount: new Decimal(1) };
    const r = startProcess(s, "fabricateJob", {}, 10 + i, effect);
    if (!r.started) throw new Error("the golden craft did not start");
    s = r.next;
  }
  const done = resolveProcesses(s, 1_000, lcg(0x6c3)).next;
  return hash({ blanks: done.blanks, inventory: done.inventory, active: done.activeProcesses.length });
}

function eventColumn(s0: GameState): string {
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
  const fight = resolveBattle({ combatants: [ship, enemy] }, 0x6b6b);
  return hash({ profile, outcome: fight.outcome, final: fight.finalCombatants });
}

export function readWr6Variant(v: Wr6Variant): Record<string, string> {
  const s0 = own(explorerFixture(), v);
  const sheet = hash(effectiveShipStats(s0, s0.ships.find((sh) => sh.id === "ship-1")!));
  const candidates = expeditionCandidates(s0, "ship-1");
  const res = startExpedition(s0, "ship-1", 1, candidates[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const end = 3_000_000;
  const done = advanceExpedition(res.next.expeditions[0], end);
  if (done.phase !== "complete") throw new Error(`the golden run did not finish (phase ${done.phase})`);
  const claimed = claimExpedition({ ...res.next, expeditions: [done], gameTimeSeconds: end }, done.id);
  if (!claimed.success) throw new Error("the golden claim was refused");

  const m = dispatchCaptainOnMission(own(explorerFixture(), v), 1, "shortOreRun");
  if (!m.success) throw new Error("the golden mission was refused");
  const mission = hashState(runTicks(m.next, 900, lcg(0x6c1)));

  const p = dispatchCaptainOnPatrol(own(patrolFixture(), v), 1, "crimsonReaverWarband", "balanced", true);
  if (!p.success) throw new Error(`the golden patrol was refused: ${p.reason}`);
  const patrolDispatch = hash(p.next.captains[0].mission as PatrolMissionState);
  const patrol = hashState(runTicks(p.next, 900, lcg(0x6c2)));

  const event = eventColumn(own(patrolFixture(), v));

  const t = salvageShip(own(teardownFixture(), v), "ship-2", () => 0.5);
  if (!t.ok) throw new Error("the golden teardown was refused");
  const teardown = hash({ recovered: t.recovered, credits: t.creditsRecovered });

  const craft = craftColumn(own(wiringBase(), v));

  const crewSave = own({ ...wiringBase(), lastTransportWindow: 0, gameTimeSeconds: 3 * TRANSPORT_WINDOW_SECONDS + 1 }, v);
  const crewDone = resolveCrew(crewSave);
  const crew = hash({ pool: crewDone.crewPool, ships: crewDone.ships.map((sh) => sh.complement ?? null) });

  return {
    sheet,
    dispatch: hash(res.expedition),
    done: hash(done),
    claim: hashState(claimed.next),
    mission,
    patrolDispatch,
    patrol,
    event,
    teardown,
    craft,
    crew,
  };
}

// ===== the goldens (captured before WR-6) =====

const BASELINE: Record<string, string> = {
  sheet: "5911e6ad",
  dispatch: "1dca7911",
  done: "fb09df71",
  claim: "d1798da9",
  mission: "20bc9fbc",
  patrolDispatch: "3c9583a",
  patrol: "f743f565",
  event: "b32ff238",
  teardown: "a3cdf544",
  craft: "90e4d0d8",
  crew: "a2844c72",
};

// Per source: the parts it moves since WR-6 wired it (anything not listed equals BASELINE, byte for byte), and why.
const MOVES: Partial<Record<Wr6Variant, Record<string, string>>> = {};

describe("WR-6 goldens: the captain primary hubs, specs and race, and the Homeworld placeholders (captured before wiring)", () => {
  it("the baseline (no source) is pinned", () => {
    expect(readWr6Variant("none")).toEqual(BASELINE);
  });
  for (const v of WR6_VARIANTS) {
    it(`${v}: only its own parts move`, () => {
      expect(readWr6Variant(v)).toEqual({ ...BASELINE, ...(MOVES[v] ?? {}) });
    });
  }
});
