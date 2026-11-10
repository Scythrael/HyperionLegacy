// Expedition Tiers G2-7 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md, USER ANSWERS 2026-11-02, the Wolf 359 nod:
// "Quiet derelict field (Recommended)": "a one-time Survey Log entry. Many old, unmarked hulls drift in loose
// formation; the crew holds a moment of silence. ... Triggers once."). The claim of the first run that reached Wolf 359
// writes the entry; a run recalled in transit never arrived; a second Wolf 359 run writes nothing; every other claim is
// byte-identical; the list on screen and the upcoming draws never move (a claim draws nothing).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import {
  WOLF_359_LIST_AFTER_DISPATCHES,
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  recallExpedition,
  startExpedition,
  tierCandidateSystems,
  wolf359DerelictEntry,
} from "./expedition";
import { WOLF_359_ID } from "./starCatalog";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, plainAwayMember, withoutWolf359Derelict } from "./awayTeamTestFixtures";
import { DERELICT_FIELD_KV, DERELICT_FIELD_NAME, DERELICT_FIELD_NOTE, SURVEY_LOG_LIVE, derelictClaimLine, surveyEntryView, surveyLogGroups } from "../gasGiantStudyDisplay";
import { deserialize, migrate, serialize, type SaveFile } from "./save";

const T0 = 100_000;
const FINAL = T0 + 3_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 (an Orion) with two full Ground teams; the save has dispatched WOLF_359_LIST_AFTER_DISPATCHES expeditions, so
// its Tier I list holds Wolf 359 on slot 0 (user G10).
function crewed(nextExpeditionId = WOLF_359_LIST_AFTER_DISPATCHES + 1, seed?: number): GameState {
  const base = freshState(seed);
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: "orion", groundTeams: teams })),
  };
  return asExpeditionVeteran(installMissingCombatBaselines(s));
}

function launch(s: GameState, cand: string): { state: GameState; exp: Expedition } {
  const res = startExpedition(s, "ship-1", 1, cand);
  expect(res.success, res.reason).toBe(true);
  return { state: res.next, exp: res.expedition! };
}

// The run advanced to its end and the state at that moment.
function finished(state: GameState, exp: Expedition): GameState {
  const done = advanceExpedition(exp, FINAL);
  expect(done.phase).toBe("complete");
  return { ...state, gameTimeSeconds: FINAL, expeditions: state.expeditions.map((e) => (e.id === exp.id ? done : e)) };
}

const wolfCandidate = (s: GameState): string => {
  const wolf = expeditionCandidates(s, "ship-1", 1).find((c) => c.systemId === WOLF_359_ID);
  expect(wolf).toBeDefined();
  return wolf!.id;
};

describe("G2-7 the Wolf 359 derelict field (user 2026-11-02)", () => {
  it("the first claim from Wolf 359 writes one derelict entry, after the run's own readouts, and nothing else moves", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    expect(exp.targetSystemId).toBe(WOLF_359_ID);
    const before = finished(state, exp);
    const claim = claimExpedition(before, exp.id);
    expect(claim.success).toBe(true);
    const log = claim.next.surveyLog ?? [];
    const derelicts = log.filter((e) => e.kind === "derelict");
    expect(derelicts).toEqual([{ id: `${exp.id}-survey-derelict`, at: FINAL, systemName: "Wolf 359", kind: "derelict", tier: 1 }]);
    expect(log[log.length - 1].kind).toBe("derelict");
    // Without the entry, the claim is exactly what it was before G2-7 (the switch: strip the one key change).
    const readouts = log.filter((e) => e.kind !== "derelict");
    const { surveyLog: _a, ...rest } = claim.next;
    const plain = claimExpedition({ ...before, surveyLog: [{ id: "x", at: 0, systemName: "Wolf 359", kind: "derelict", tier: 1 }] }, exp.id).next;
    const { surveyLog: _b, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
    expect((plain.surveyLog ?? []).filter((e) => e.kind !== "derelict")).toEqual(readouts);
  });

  it("triggers once: a later run to Wolf 359 (a rolled find or a resume) writes nothing more", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    const first = claimExpedition(finished(state, exp), exp.id).next;
    expect((first.surveyLog ?? []).filter((e) => e.kind === "derelict")).toHaveLength(1);
    // A second Wolf 359 run (built from the first's record: same system, a new id) claims with no new entry.
    const again: Expedition = { ...advanceExpedition(exp, FINAL), id: "exp-99" };
    const second = claimExpedition({ ...first, expeditions: [again] }, "exp-99").next;
    expect(second.surveyLog).toEqual(first.surveyLog);
    expect(wolf359DerelictEntry(first, again, FINAL)).toBeNull();
  });

  it("a run recalled in transit never reached Wolf 359: no entry; recalled after arrival it did", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    // In transit (a minute out).
    const early = recallExpedition({ ...state, gameTimeSeconds: T0 + 60 }, exp.id);
    const turned = early.expeditions.find((e) => e.id === exp.id)!;
    expect(turned.recall?.phaseAtRecall).toBe("transit");
    const home = claimExpedition(finished(early, turned), exp.id);
    expect(home.success).toBe(true);
    expect((home.next.surveyLog ?? []).some((e) => e.kind === "derelict")).toBe(false);
    expect(home.next.surveyLog).toEqual(early.surveyLog);
    // After arrival: the outbound leg is behind it.
    let t = T0;
    while (advanceExpedition(exp, t).phase === "transit" && t < FINAL) t += 60;
    const arrived = advanceExpedition(exp, t);
    expect(arrived.phase).toBe("scanning");
    const late = recallExpedition({ ...state, gameTimeSeconds: t, expeditions: [arrived] }, exp.id);
    const turnedLate = late.expeditions.find((e) => e.id === exp.id)!;
    expect(turnedLate.recall?.phaseAtRecall).not.toBe("transit");
    const homeLate = claimExpedition(finished(late, turnedLate), exp.id).next;
    expect((homeLate.surveyLog ?? []).filter((e) => e.kind === "derelict")).toHaveLength(1);
  });

  it("every other system's claim is untouched, and the list on screen and the upcoming draws never move", () => {
    const start = crewed();
    const other = expeditionCandidates(start, "ship-1", 1).find((c) => c.systemId !== WOLF_359_ID)!;
    const { state, exp } = launch(start, other.id);
    const done = finished(state, exp);
    const claim = claimExpedition(done, exp.id).next;
    expect((claim.surveyLog ?? []).some((e) => e.kind === "derelict")).toBe(false);
    // A claim never touches the candidate draws.
    expect(claim.expeditionSeed).toBe(done.expeditionSeed);
    expect(claim.nextExpeditionId).toBe(done.nextExpeditionId);
    expect(tierCandidateSystems(claim, 1)).toEqual(tierCandidateSystems(done, 1));
    // The Wolf 359 claim moves no draw either.
    const w = launch(start, wolfCandidate(start));
    const wDone = finished(w.state, w.exp);
    const wClaim = claimExpedition(wDone, w.exp.id).next;
    expect(wClaim.expeditionSeed).toBe(wDone.expeditionSeed);
    expect(tierCandidateSystems(wClaim, 1)).toEqual(tierCandidateSystems(wDone, 1));
  });

  it("is pure and deterministic: the same claim twice gives the same state; the input is never mutated", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    const before = finished(state, exp);
    const frozen = structuredClone(before);
    const a = claimExpedition(before, exp.id).next;
    const b = claimExpedition(before, exp.id).next;
    expect(a).toEqual(b);
    expect(before).toEqual(frozen);
  });

  it("the Survey Log shows it in its own group after the nebulae, with the user's words and the derelict portrait", () => {
    const entry = { id: "exp-2-survey-derelict", at: 500, systemName: "Wolf 359", kind: "derelict" as const, tier: 1 as const };
    const nebula = { id: "n", at: 400, systemName: "OR-2817", kind: "nebula" as const, kindId: "emissionNebula" as const, tier: 2 as const };
    const groups = surveyLogGroups([entry, nebula]);
    expect(groups.map((g) => g.key)).toEqual(["emissionNebula", "derelict"]);
    expect(groups[1]).toEqual({ key: "derelict", label: DERELICT_FIELD_NAME, count: 1, entries: [{ id: entry.id, label: "Wolf 359", first: false }] });
    const card = surveyEntryView(entry, [entry, nebula]);
    expect(card).toMatchObject({ title: "Wolf 359", subtitle: "Derelict field · Tier I", first: false, kind: "derelict", derelict: true, art: null, nebulaArt: null, star: null, stage: null });
    expect(card.kv.map((r) => `${r.label}: ${r.value}`)).toEqual(DERELICT_FIELD_KV.map((r) => `${r.label}: ${r.value}`));
    expect(card.note).toBe(DERELICT_FIELD_NOTE);
    expect(surveyEntryView(nebula, [entry, nebula]).derelict).toBe(false);
    // The words: the user's, unnamed and original (no ship, person or franchise), US English, no em dash or "fit".
    const words = [DERELICT_FIELD_NAME, DERELICT_FIELD_NOTE, ...DERELICT_FIELD_KV.flatMap((r) => [r.label, r.value]), derelictClaimLine([], [entry])!];
    for (const w of words) {
      expect(w).not.toMatch(/—|–|-{2}/);
      expect(w).not.toMatch(/\bfit/i);
    }
    expect(DERELICT_FIELD_KV.map((r) => r.value).join(" ")).toMatch(/old and unmarked/);
    expect(DERELICT_FIELD_KV.map((r) => r.value).join(" ")).toMatch(/loose formation/);
    expect(DERELICT_FIELD_NOTE).toMatch(/moment of silence/);
  });

  it("the claim line appears only on the claim that wrote the entry", () => {
    const entry = { id: "e", at: 1, systemName: "Wolf 359", kind: "derelict" as const, tier: 1 as const };
    expect(derelictClaimLine(undefined, [entry])).toBe("Wolf 359: many old, unmarked hulls drift in loose formation. The crew held a moment of silence. Logged in the Survey Log.");
    expect(derelictClaimLine([entry], [entry])).toBeNull();
    expect(derelictClaimLine([], [])).toBeNull();
    expect(derelictClaimLine(undefined, undefined)).toBeNull();
  });
  it("the entry survives a JSON round trip and a save round trip (serialize, deserialize, migrate) unchanged", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    const claimed = claimExpedition(finished(state, exp), exp.id).next;
    const entry = (claimed.surveyLog ?? []).find((e) => e.kind === "derelict")!;
    expect(entry).toBeDefined();
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    const loaded = migrate(deserialize(serialize(claimed, 0)) as SaveFile);
    expect(loaded.surveyLog).toEqual(claimed.surveyLog);
    // Once per save holds across a reload: the loaded save's next Wolf 359 run writes nothing more.
    const again: Expedition = { ...advanceExpedition(exp, FINAL), id: "exp-98" };
    expect(wolf359DerelictEntry(loaded, again, FINAL)).toBeNull();
  });

  it("the real claim's entry renders through the display helpers: the claim line once, the card's note and words", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    const before = finished(state, exp);
    const after = claimExpedition(before, exp.id).next;
    // The claim's log line (App.svelte reads derelictClaimLine(state.surveyLog, next.surveyLog) around the claim).
    expect(derelictClaimLine(before.surveyLog, after.surveyLog)).toBe(
      `Wolf 359: many old, unmarked hulls drift in loose formation. The crew held a moment of silence.${SURVEY_LOG_LIVE ? " Logged in the Survey Log." : ""}`,
    );
    // The Survey Log's group and card for the stored entry (SurveyLogPanel.svelte draws card.note under the rows).
    const log = after.surveyLog ?? [];
    const entry = log.find((e) => e.kind === "derelict")!;
    const group = surveyLogGroups(log).find((g) => g.key === "derelict")!;
    expect(group.entries).toEqual([{ id: entry.id, label: "Wolf 359", first: false }]);
    const card = surveyEntryView(entry, log);
    expect(card.derelict).toBe(true);
    expect(card.note).toBe(DERELICT_FIELD_NOTE);
    expect(card.subtitle).toBe(`${DERELICT_FIELD_NAME} · Tier I`);
    // A second claim after it (a later run home) prints no second line.
    const again: Expedition = { ...advanceExpedition(exp, FINAL), id: "exp-97" };
    const later = claimExpedition({ ...after, expeditions: [again] }, "exp-97").next;
    expect(derelictClaimLine(after.surveyLog, later.surveyLog)).toBeNull();
  });

  it("the golden switch strips only the entry this claim added, never one the pre-claim log already held", () => {
    const start = crewed();
    const { state, exp } = launch(start, wolfCandidate(start));
    const before = finished(state, exp);
    const after = claimExpedition(before, exp.id).next;
    const stripped = withoutWolf359Derelict(after, before);
    expect((stripped.surveyLog ?? []).some((e) => e.kind === "derelict")).toBe(false);
    // An earlier claim's entry, already in the pre-claim log, is kept (the claim added nothing, so nothing is dropped).
    const held = { id: "exp-1-survey-derelict", at: 1, systemName: "Wolf 359", kind: "derelict" as const, tier: 1 as const };
    const beforeHeld = { ...before, surveyLog: [held] };
    const afterHeld = claimExpedition(beforeHeld, exp.id).next;
    expect(withoutWolf359Derelict(afterHeld, beforeHeld)).toBe(afterHeld);
    expect(afterHeld.surveyLog?.[0]).toEqual(held);
  });
});
