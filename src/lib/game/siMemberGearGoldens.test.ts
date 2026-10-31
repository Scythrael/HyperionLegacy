// Quartermaster Standard-Issue MEMBER gear gets real stats (0.14.0; safe first runs plan USER ANSWERS 2026-10-16
// "Tier I after training expects a full team + Quartermaster Standard-Issue set", "Standard-Issue stats" by slot role,
// "Implants X1/X2 depending on racial. Keep this as is."; USER ANSWERS 2026-10-21 "Fade Weak + build SI gear"): golden
// hashes captured on the code BEFORE the engine edit. Each fixture is an ordinary save:
//
//   mint        : every member requisition row's freshly issued piece (Prospecting's rows on an unlocked save).
//   snapshot    : the roster a full rank 1 Orion crew in the Standard-Issue set freezes at dispatch.
//   run:*       : that crew's nominal Tier I run (a veteran save) and its training run, advanced to the SF-0 horizon.
//   inflight    : that crew dispatched, saved and loaded mid-run, then advanced (an in-flight run must not move).
//   crafted:*   : a crafted Pulse Rifle, Ballistic Weave, Sidearm and Field Suit inspected at crafting level 1 and 10,
//                 and the Fabricator's preview of each at those levels.
//   bare        : the same rank 1 crew wearing nothing (the control: no Standard-Issue piece, nothing may move).
//   ship        : every SHIP requisition row's issued piece (the control: ship Standard-Issue is untouched).
//
// The engine commits re-pin ONLY what the Standard-Issue stats, the crafted budget floor and the D26 line swap move
// (GOLDEN), each with its reason beside it, and prove the move with all three switched off (siMemberGearSwitch.fixture.ts):
// every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import Decimal from "break_infinity.js";
import { BLUEPRINTS, freshState, type GameState } from "./model";
import { advanceExpedition, makeExpeditionSeed, startExpedition } from "./expedition";
import { snapshotMembers } from "./awayTeam";
import { inspectBlank } from "./tick";
import { previewCraftOutcome } from "./itemgen";
import { REQUISITION_ENTRIES, requisitionEntriesFor, requisitionStandardIssue } from "./quartermaster";
import { deserialize, migrate, serialize } from "./save";
import { asExpeditionVeteran, asPreRelicBlanksRun, asPreStudyDispatch } from "./awayTeamTestFixtures";
import { goldenJson, onHull, runOutcome, SWEEP_END, withCrew, withoutRunCounts, fnv } from "./firstRunsGoldens.fixture";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

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
// Gas Giant Study GG-2 (merged after this capture): the fourth seed's system holds a gas giant, so each run is
// dispatched as before GG-2 (asPreStudyDispatch: no study stamp, the giant keeps its ground objectives), which keeps
// these pins about the Standard-Issue gear alone; the gas giant study goldens pin the new shape.
function runsOf(build: (seed: number) => GameState): string {
  const done = SEEDS.map((seed) => {
    const res = asPreStudyDispatch(startExpedition(build(seed), "ship-1", 1, "cand-0"));
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    return advanceExpedition(res.expedition, SWEEP_END);
  });
  const lines = done.map(runOutcome).map((o) => `${o.objectives}:${o.lostFights}`);
  // Relics v2 R2-2 (merged after this capture): the runs hash as the pre-R2-2 engine stored them (asPreRelicBlanksRun:
  // no relic blanks flag, no blank stamps; Tier I rarity is unchanged), so the pins keep proving only the SI change.
  return `${hash(done.map(asPreRelicBlanksRun))} ${lines.join(" ")}`;
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
  return { exp: hash(asPreRelicBlanksRun(advanceExpedition(exp, SWEEP_END))), equipment: loaded.equipment };
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
  // The D26 review's two Science pieces (their lines swapped), captured on feat d553614 before the review's edit.
  ["sidearmBp", 1],
  ["sidearmBp", 10],
  ["fieldSuitBp", 1],
  ["fieldSuitBp", 10],
];

// Captured on 0dca5f2, before the engine edit. Re-pinned at the merge of feat (SF-3 ramp, FKR-9 / FKR-10 kits on):
// the four run fixtures (run:*, inflight, bare) read the merged base (an ordinary run now carries the ramp stamp and
// kits). Every value here, the Sidearm and Field Suit rows included, re-captured on feat d553614 itself (the code
// before the review's edit) and identical to the switched-off reading.
// Re-pinned at the merge of feat d0ebb36 (the timed Stun and Toxin Grenades): the four run fixtures' hashes only (the
// runs carry kits; every outcome line is unchanged), re-captured on d0ebb36 itself.
export const BEFORE: Readonly<Record<string, string>> = {
  mint: "84619c25",
  snapshot: "afbc5b2f",
  "run:nominal": "9dadd721 9/10:40 7/7:9 5/5:6 15/15:39 10/13:40",
  "run:training": "10f5c5d8 12/12:0 7/7:0 5/5:0 15/15:0 13/13:0",
  inflight: "3c587fcb",
  "crafted:pulseRifleBp:1": "512c1b55",
  "crafted:pulseRifleBp:10": "e1fdde45",
  "crafted:ballisticWeaveBp:1": "b7a8c81c",
  "crafted:ballisticWeaveBp:10": "8f4edbfa",
  "preview:pulseRifleBp:1": "ad2f9df4",
  "preview:pulseRifleBp:10": "c0ff6430",
  "preview:ballisticWeaveBp:1": "9f928a43",
  "preview:ballisticWeaveBp:10": "480fabfc",
  "crafted:sidearmBp:1": "efb0ac5e",
  "crafted:sidearmBp:10": "667661db",
  "crafted:fieldSuitBp:1": "d99c3b55",
  "crafted:fieldSuitBp:10": "91184ad5",
  "preview:sidearmBp:1": "97846806",
  "preview:sidearmBp:10": "51bcd20b",
  "preview:fieldSuitBp:1": "332d6b81",
  "preview:fieldSuitBp:10": "2236015c",
  bare: "342dfbcf 9/10:40 7/7:9 5/5:6 15/15:39 10/13:40",
  ship: "f0246bf0",
};

// After the engine edit. Every move, and why (nothing else may move):
const GOLDEN: Readonly<Record<string, string>> = {
  ...BEFORE,
  // The issued member pieces carry their Standard-Issue lines (model.ts STANDARD_ISSUE_MEMBER_POINTS); the Sidearm and
  // Field Suit their D26 Science lines (relic find + fieldwork, fieldwork + hazard resist).
  mint: "bd9efd59",
  // The frozen roster converts those lines (power, accuracy, armor, HP, fieldwork, relic find, hazard, organics).
  snapshot: "bb8c0c87",
  // The same crew, stronger: more objectives done and fewer lost fights on every seed (nominal Tier I at full strength).
  "run:nominal": "6e6e14d7 10/10:39 7/7:2 5/5:0 15/15:29 13/13:37",
  // The training run already clears everything; only the frozen roster's lines (and the fights they shape) move.
  "run:training": "2cf38766 12/12:0 7/7:0 5/5:0 15/15:0 13/13:0",
  // This fixture dispatches on the current code (the kit carries its lines). The pre-change in-flight run is proved
  // unmoved below, with the dispatch made on the switched-off kit and the load on the live code.
  inflight: "718d5532",
  // The crafted budget floor (model.ts craftedMemberFloorImplicits): a crafting level 1 roll is lifted to the free
  // set's total and the free piece's signature values (item level unchanged); the previews show the same floor.
  "crafted:pulseRifleBp:1": "4bfd75d3",
  "crafted:ballisticWeaveBp:1": "58e491ae",
  "preview:pulseRifleBp:1": "a29db5e8",
  "preview:ballisticWeaveBp:1": "75c0d841",
  // The D26 line swap (and at level 1 the floor): the Sidearm and Field Suit roll their Science lines.
  "crafted:sidearmBp:1": "e8505f9e",
  "crafted:sidearmBp:10": "69db3e6e",
  "crafted:fieldSuitBp:1": "dfbab3d2",
  "crafted:fieldSuitBp:10": "f22af574",
  "preview:sidearmBp:1": "b361c263",
  "preview:sidearmBp:10": "ea261ad9",
  "preview:fieldSuitBp:1": "381be8ee",
  "preview:fieldSuitBp:10": "729d3cbe",
  // Unmoved: the level 10 rifle and weave (above the floor), the bare crew and the ship rows.
};

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

// ===== the "turn it off" proof =====
// With the Standard-Issue share table emptied and the pre-D26 Science lines restored (siMemberGearSwitch.fixture.ts)
// every fixture reproduces its capture from before the change, so the stats, the crafted floor (its total is 0 with no
// rows) and the line swap are the ONLY things the change moved.
describe("Standard-Issue member gear: switched off, every fixture reproduces its pre-change capture", () => {
  it("every fixture", () => {
    withSiMemberGearOff(() => {
      expect(siMint()).toBe(BEFORE.mint);
      expect(siSnapshot()).toBe(BEFORE.snapshot);
      expect(siRunNominal()).toBe(BEFORE["run:nominal"]);
      expect(siRunTraining()).toBe(BEFORE["run:training"]);
      expect(siInflight().exp).toBe(BEFORE.inflight);
      for (const [bp, level] of CRAFTED_CASES) {
        expect(siCrafted(bp, level), `${bp}:${level}`).toBe(BEFORE[`crafted:${bp}:${level}`]);
        expect(siPreview(bp, level), `${bp}:${level}`).toBe(BEFORE[`preview:${bp}:${level}`]);
      }
      expect(bareRunNominal()).toBe(BEFORE.bare);
      expect(shipMint()).toBe(BEFORE.ship);
    });
  });

  it("an in-flight run from before the change plays out byte-identically, and its held kit gains the lines on load", () => {
    // Kitted and dispatched as a pre-change build did (every Standard-Issue line 0), then saved, loaded and advanced
    // on the live code: the run is the pre-change capture, while the loaded save's pieces now carry their lines.
    const { exp, equipment } = siInflight(() => withSiMemberGearOff(() => asExpeditionVeteran(kitted())));
    expect(exp).toBe(BEFORE.inflight);
    const rifles = equipment.filter((p) => p.moduleVariant === "pulseRifle");
    expect(rifles.length).toBeGreaterThan(0);
    for (const p of rifles) expect(p.implicitStats).toEqual({ groundPower: 6, groundAccuracy: 6 });
  });
});
