// Quartermaster Standard-Issue MEMBER gear gets real stats (0.14.0; safe first runs plan USER ANSWERS 2026-10-16
// "Tier I after training expects a full team + Quartermaster Standard-Issue set", "Standard-Issue stats" by slot role,
// "Implants X1/X2 depending on racial. Keep this as is."; USER ANSWERS 2026-10-21 "Fade Weak + build SI gear"): golden
// hashes captured on the code BEFORE the engine edit. Each fixture is an ordinary save:
//
//   mint        : every member requisition row's freshly issued piece (Prospecting's rows on an unlocked save).
//   snapshot    : the roster a full rank 1 Orion crew in the Standard-Issue set freezes at dispatch.
//   run:*       : that crew's nominal Tier I run (a veteran save) and its training run, advanced to the SF-0 horizon.
//   inflight    : that crew dispatched, saved and loaded mid-run, then advanced (an in-flight run must not move).
//   crafted:*   : a crafted Pulse Rifle and Ballistic Weave inspected at crafting level 1 and 10, and the Fabricator's
//                 preview of each at those levels.
//   bare        : the same rank 1 crew wearing nothing (the control: no Standard-Issue piece, nothing may move).
//   ship        : every SHIP requisition row's issued piece (the control: ship Standard-Issue is untouched).
//
// The engine commit re-pins ONLY what the Standard-Issue stats move (GOLDEN), each with its reason beside it, and
// proves the move with the stats switched off (siMemberGearSwitch.fixture.ts): every fixture then reproduces its
// capture (BEFORE).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, freshState, type GameState } from "./model";
import { advanceExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { snapshotMembers } from "./awayTeam";
import { inspectBlank } from "./tick";
import { previewCraftOutcome } from "./itemgen";
import { REQUISITION_ENTRIES, requisitionEntriesFor, requisitionStandardIssue } from "./quartermaster";
import { deserialize, migrate, serialize } from "./save";
import { asExpeditionVeteran } from "./awayTeamTestFixtures";
import { goldenJson, onHull, runOutcome, SWEEP_END, withCrew, withoutRunCounts, fnv } from "./firstRunsGoldens.fixture";

const hash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));
// Five of the SF-3 sweep's seeds (makeExpeditionSeed(0x1234567, i), the section 2.5 B method), so the runs carry
// several objectives, Vault and Subterranean sites among them.
const SEEDS: readonly number[] = [0, 1, 2, 3, 4].map((i) => makeExpeditionSeed(0x1234567, i));
const SEED = SEEDS[0];
const ENTROPY = 0x2468ace;

// Every member row's issued piece, Prospecting's included (unlocked save), in catalogue order.
export function siMint(): string {
  const s: GameState = { ...freshState(), prospectingSquadsUnlocked: true };
  const pieces = requisitionEntriesFor(s)
    .filter((e) => e.teamType !== null)
    .map((e) => requisitionStandardIssue(s, e.slotType, e.teamType).minted);
  return hash(pieces);
}

function kitted(seed: number = SEED): GameState {
  return withCrew(onHull("orion", seed), "rank1si");
}

export function siSnapshot(): string {
  const s = kitted();
  const aboard = s.awayMembers.filter((m) => m.assignedShipId === "ship-1");
  return hash({
    security: snapshotMembers(s, aboard.filter((m) => m.teamType === "security")),
    science: snapshotMembers(s, aboard.filter((m) => m.teamType === "science")),
  });
}

// One run per seed: the finished runs' hash, then each run's "objectives done/total:lost fights".
function runsOf(build: (seed: number) => GameState): string {
  const done = SEEDS.map((seed) => {
    const res = startExpedition(build(seed), "ship-1", 1, "cand-0");
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    return advanceExpedition(res.expedition, SWEEP_END);
  });
  const lines = done.map(runOutcome).map((o) => `${o.objectives}:${o.lostFights}`);
  return `${hash(done)} ${lines.join(" ")}`;
}

export function siRunNominal(): string {
  return runsOf((seed) => asExpeditionVeteran(kitted(seed)));
}
export function siRunTraining(): string {
  return runsOf((seed) => kitted(seed));
}
export function bareRunNominal(): string {
  return runsOf((seed) => asExpeditionVeteran(withCrew(onHull("orion", seed), "rank1")));
}

// The kitted crew dispatched on the CURRENT code (`dispatch` builds the state that launches), saved 20,000 s into the
// run, loaded through the real deserialize + migrate, and advanced to the horizon on the loaded save.
export function siInflight(dispatch: () => GameState = () => asExpeditionVeteran(kitted())): { exp: string; equipment: GameState["equipment"] } {
  const res = startExpedition(dispatch(), "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const mid = advanceExpedition(res.expedition, res.expedition.phaseAnchorSeconds + 20_000);
  const saved = { ...res.next, expeditions: res.next.expeditions.map((e) => (e.id === mid.id ? mid : e)) };
  const file = deserialize(serialize(saved, 1_000));
  if (!file) throw new Error("save did not round-trip");
  const loaded = migrate(file, ENTROPY);
  const exp = loaded.expeditions.find((e) => e.id === mid.id)!;
  return { exp: hash(advanceExpedition(exp, SWEEP_END)), equipment: loaded.equipment };
}

// A crafted piece of `bpKey` inspected from one blank at crafting level `level` (the real Fabricator mint).
export function siCrafted(bpKey: string, level: number): string {
  const base = freshState();
  const s: GameState = { ...base, craftingLevel: level, blanks: { ...base.blanks, [bpKey]: new Decimal(1) } };
  const next = inspectBlank(s, bpKey);
  if (next === s) throw new Error(`inspect refused for ${bpKey}`);
  return hash(next.equipment[next.equipment.length - 1]);
}
export function siPreview(bpKey: string, level: number): string {
  return hash(previewCraftOutcome(BLUEPRINTS[bpKey], { craftingLevel: level }));
}

export function shipMint(): string {
  const s = freshState();
  return hash(REQUISITION_ENTRIES.filter((e) => e.teamType === null).map((e) => requisitionStandardIssue(s, e.slotType, null).minted));
}

export const CRAFTED_CASES: readonly (readonly [string, number])[] = [
  ["pulseRifleBp", 1],
  ["pulseRifleBp", 10],
  ["ballisticWeaveBp", 1],
  ["ballisticWeaveBp", 10],
];

// Captured on 0dca5f2, before the engine edit.
export const BEFORE: Readonly<Record<string, string>> = {
  mint: "84619c25",
  snapshot: "afbc5b2f",
  "run:nominal": "2567d0ac 7/10:78 6/7:40 2/5:40 13/15:40 9/13:40",
  "run:training": "845fd3b7 12/12:0 7/7:0 5/5:0 15/15:0 13/13:0",
  inflight: "b01b88fe",
  "crafted:pulseRifleBp:1": "512c1b55",
  "crafted:pulseRifleBp:10": "e1fdde45",
  "crafted:ballisticWeaveBp:1": "b7a8c81c",
  "crafted:ballisticWeaveBp:10": "8f4edbfa",
  "preview:pulseRifleBp:1": "ad2f9df4",
  "preview:pulseRifleBp:10": "c0ff6430",
  "preview:ballisticWeaveBp:1": "9f928a43",
  "preview:ballisticWeaveBp:10": "480fabfc",
  bare: "f89fe36 7/10:78 6/7:40 2/5:40 13/15:40 9/13:40",
  ship: "f0246bf0",
};

const GOLDEN: Readonly<Record<string, string>> = { ...BEFORE };

describe("Standard-Issue member gear goldens", () => {
  it("mint and snapshot", () => {
    expect(siMint()).toBe(GOLDEN.mint);
    expect(siSnapshot()).toBe(GOLDEN.snapshot);
  });
  it("runs: nominal Tier I and the training run", () => {
    expect(siRunNominal()).toBe(GOLDEN["run:nominal"]);
    expect(siRunTraining()).toBe(GOLDEN["run:training"]);
  });
  it("an in-flight run, saved and loaded mid-run", () => {
    expect(siInflight().exp).toBe(GOLDEN.inflight);
  });
  it("crafted pieces and the Fabricator preview", () => {
    for (const [bp, level] of CRAFTED_CASES) {
      expect(siCrafted(bp, level), `${bp}:${level}`).toBe(GOLDEN[`crafted:${bp}:${level}`]);
      expect(siPreview(bp, level), `${bp}:${level}`).toBe(GOLDEN[`preview:${bp}:${level}`]);
    }
  });
  it("controls: a bare crew and the ship rows", () => {
    expect(bareRunNominal()).toBe(GOLDEN.bare);
    expect(shipMint()).toBe(GOLDEN.ship);
  });
});
