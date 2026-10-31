// Wiring WR-11 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-11): the shared fixtures of
// wr11Goldens.test.ts and wr11.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Expedition fixtures: real Ground Ops runs (dispatch, 2,000,000 s, claim) on an ordinary save with a Security pair and
// a Science member, the anomaly opt-in on, over a spread of seeds, so the set holds Ocean bodies with surface work, the
// PoIs whose flavor names a reward (Buried Vault, Subterranean Civilization, Xeno-Flora Bloom, Geothermal Chamber,
// Derelict Outpost, Crashed Ship), a charted anomaly, and (the `museum` variants) a Museum holding Science team power.
// Salvage fixture: a Fleet Admiral 40 save with the salvage talent (one tier of reach past the top of the pool) running
// a string of Damaged Weapon System salvage jobs through resolveProcesses on a seeded stream.

import Decimal from "break_infinity.js";
import { freshState, withGeneralMuseumRecord, type AwayMember, type Expedition, type GameState, type HomeworldTalentKey } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { goldenJson, withoutRunCounts } from "./firstRunsGoldens.fixture";
import { RELIC_SETS, MUSEUM_COPY_LADDER } from "./relics";
import { resolveProcesses, startSalvageJob } from "./tick";
import { makeRng } from "./combat/rng";
import { installPiece } from "./wiring/probes";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
export const wr11Hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

const SQUAD: AwayMember[] = [
  { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
  { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
  plainAwayMember("member-11", "science", "ship-1"),
];

// The Xenobiology set's first three relics at the first copy rung: its 3-piece tier is Science team power.
export function scienceMuseumRecord(): Record<string, number> {
  const set = RELIC_SETS.find((s) => s.id === "xenobiology")!;
  const rec: Record<string, number> = {};
  for (const id of set.relicIds.slice(0, 3)) rec[id] = MUSEUM_COPY_LADDER[0];
  return rec;
}

// A variant: `museum` holds Science team power; `sensors` installs a Balanced sensor array (sensors 20).
export type Wr11Variant = "plain" | "museum" | "sensors";

export function wr11State(seed: number, variant: Wr11Variant = "plain"): GameState {
  const s0 = withSlottedAwayTeams({ ...freshState(), awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
  if (variant === "museum") return withGeneralMuseumRecord(s0, scienceMuseumRecord());
  if (variant === "sensors") return installPiece(s0, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  return s0;
}

// Ocean surface work (0x1234, 0x1244, 0x8b8b); Buried Vault (0x1234, 0x5e5e, 0xbebe); Subterranean Civilization
// (0x2a2a, 0x3c3c, 0xcfcf); the material PoIs on most; a charted anomaly (0x8b8b, 0xbebe, 0xcfcf); a gas giant (0x2a2a).
export const WR11_SEEDS = [0x1234, 0x1244, 0x2a2a, 0x3c3c, 0x5e5e, 0x8b8b, 0xbebe, 0xcfcf] as const;
export const WR11_VARIANT_SEEDS = [0x1234, 0x3c3c] as const;

export function wr11Dispatch(seed: number, variant: Wr11Variant = "plain"): { next: GameState; exp: Expedition } {
  const s = wr11State(seed, variant);
  const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

export function wr11Run(seed: number, variant: Wr11Variant = "plain"): { exp: Expedition; done: Expedition; claimed: GameState; out: string[] } {
  const { next, exp } = wr11Dispatch(seed, variant);
  const done = advanceExpedition(exp, 2_000_000);
  if (done.phase !== "complete") throw new Error(`run did not complete: ${done.phase}`);
  const claim = claimExpedition({ ...next, expeditions: [done] }, done.id);
  if (!claim.success) throw new Error("claim refused");
  return { exp, done, claimed: claim.next, out: [wr11Hash(exp), wr11Hash(done), wr11Hash(claim.next)] };
}

// The candidate list the console shows (its foreknowledge included) on a fresh save.
export function wr11Candidates(seed: number): string {
  const s = wr11State(seed);
  return wr11Hash(expeditionCandidates(s, "ship-1"));
}

// ===== Salvage =====

export const WR11_SALVAGE_ITEM = "damagedWeaponSystem";
export const WR11_SALVAGE_JOBS = 40;
const QUEUE_CHAIN: HomeworldTalentKey[] = ["fleetLogisticsQueue1", "fleetLogisticsQueue2", "fleetLogisticsQueue3"];

export function wr11SalvageState(talent = true): GameState {
  const base = freshState();
  return {
    ...base,
    fleetAdminLevel: 40,
    unlockedHomeworldTalents: [...QUEUE_CHAIN, ...(talent ? (["fleetLogisticsSalvage"] as HomeworldTalentKey[]) : [])],
    inventory: { ...base.inventory, [WR11_SALVAGE_ITEM]: [new Decimal(WR11_SALVAGE_JOBS)] },
  };
}

// WR11_SALVAGE_JOBS material salvages, one at a time, each resolved on the same seeded stream at a fixed clock.
export function wr11SalvageRun(talent = true, seed = 0x5a1e): GameState {
  const r = makeRng(seed);
  const rng = () => r.next();
  let s = wr11SalvageState(talent);
  for (let i = 0; i < WR11_SALVAGE_JOBS; i += 1) {
    const started = startSalvageJob(s, { type: "salvage", target: { kind: "material", itemId: WR11_SALVAGE_ITEM }, mode: { kind: "batch", remaining: 1 } });
    if (!started.started) throw new Error(`salvage ${i} did not start`);
    s = started.next;
    for (let guard = 0; guard < 10_000 && s.activeProcesses.some((p) => p.kind === "salvageJob"); guard += 1) {
      s = resolveProcesses(s, 1, rng, 1_000_000 + i).next;
    }
  }
  return s;
}
