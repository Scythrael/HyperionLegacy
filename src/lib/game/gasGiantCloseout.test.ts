// Gas Giant Study close-out (GG-8, plan docs/plans/2026-10-17-gas-giant-study-plan.md section GG-8): every gas giant
// stat or source row in the wiring registry is LIVE with a probe and a context (so wiring.sensitivity.test.ts measures
// it move by its configured amount), or a SEAM carrying the user's own words, and releaseBlockers() (the 0.14.0 release
// gate, RELEASE_GATE=1) holds NO gas giant entry. The Field Kits close-out (no-dead-stats.test.ts, FKR-11) is the
// precedent.
import { describe, expect, it } from "vitest";
import { WIRING_REGISTRY, releaseBlockers, wiringEntry, type WiringEntry } from "./wiring/registry";
import { GAS_CANISTER_IDS, GAS_STUDY_USES, GIANT_CLASSES, NEBULA_KINDS, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES, ANCIENT_DATA_FRAGMENT_ID } from "./gasGiantContent";
import { RAMSCOOP_COLLECTOR_MODULE, SPECIAL_BLUEPRINT_KEYS } from "./specialBlueprints";

// The catalogs the study owns outright.
const GG_CATALOGS = ["GAS_STUDY_USES", "GIANT_CLASSES", "NEBULA_KINDS", "GAS_STUDY_SEAM", "DATA_STUDY", "DATA_STUDY_SEAM"];
// The study's rows that live in shared catalogs.
const GG_NAMED_IDS: readonly string[] = [
  "expedition:PLANET_TYPES:gasGiant:orbitalOnly",
  "ship:SENSOR_ARRAYS:sensorResonance:canisterBandLift",
  ...SPECIAL_BLUEPRINT_KEYS.map((k) => (k === "pressureForgedPlatingBp" ? `ship:BLUEPRINTS:${k}:effect` : `expedition:BLUEPRINTS:${k}:effect`)),
  ...[...RESEARCH_FAMILIES.map((f) => RESEARCH_DATA_ITEM[f]), ANCIENT_DATA_FRAGMENT_ID].map((id) => `facility:ITEMS:${id}:reserved`),
];
// Pending owners that would name the study (a slice, the feature or one of its parts).
const GG_OWNER = /\bGG-\d|gas giant|nebula|Survey Log|Galileo|canister|ancient (data|entr)/i;

const isGg = (e: WiringEntry): boolean =>
  GG_CATALOGS.includes(e.source.catalog) || GG_NAMED_IDS.includes(e.id) || e.source.key === RAMSCOOP_COLLECTOR_MODULE || e.source.key.startsWith(`${RAMSCOOP_COLLECTOR_MODULE}:`);

describe("Gas giant study close-out (GG-8): every gas giant row is live or a seam in the user's words", () => {
  const rows = WIRING_REGISTRY.filter(isGg);

  it("covers every use, class field, nebula kind field, canister recipe, special blueprint and the named rows", () => {
    for (const id of GG_NAMED_IDS) expect(wiringEntry(id), id).toBeDefined();
    const ids = rows.map((e) => e.id);
    for (const use of Object.keys(GAS_STUDY_USES)) expect(ids.some((id) => id.endsWith(`:GAS_STUDY_USES:${use}`)), use).toBe(true);
    for (const c of GIANT_CLASSES) expect(ids.some((id) => id.startsWith(`expedition:GIANT_CLASSES:${c.id}:`)), c.id).toBe(true);
    for (const k of NEBULA_KINDS) for (const f of ["bandOdds", "itemWeights"]) expect(ids, `${k.id}:${f}`).toContain(`expedition:NEBULA_KINDS:${k.id}:${f}`);
    for (const id of GAS_CANISTER_IDS) expect(ids, id).toContain(`facility:GAS_STUDY_USES:canisterRecipes:${id}`);
    for (const f of RESEARCH_FAMILIES) expect(ids, f).toContain(`facility:DATA_STUDY:boost:${f}`);
    expect(rows.some((e) => e.source.key === RAMSCOOP_COLLECTOR_MODULE || e.source.key.startsWith(`${RAMSCOOP_COLLECTOR_MODULE}:`)), "the Ramscoop module row").toBe(true);
  });

  it("each is live with a probe and a context, not applicable with a reason, or a seam carrying the user's words", () => {
    const dead: string[] = [];
    for (const e of rows) {
      if (e.status.kind === "seam") {
        if (!e.status.userRef) dead.push(`${e.id} (seam without the user's words)`);
        continue;
      }
      if (e.status.kind !== "live") dead.push(`${e.id} (${e.status.kind}${"owner" in e.status ? `: ${e.status.owner}` : ""})`);
      else if (!e.notApplicable && (e.contexts.length === 0 || !e.probe)) dead.push(`${e.id} (live with no probe or context)`);
    }
    expect(dead, "gas giant rows that are not live: wire them or get the user's words for a seam").toEqual([]);
    // MOVED by Relics v2 R2-6: the one seam (the fragment's culture study point) went live with culture naming (probe
    // content:dataStudy:cultureReveal); no gas giant seam is left (was ["facility:DATA_STUDY_SEAM:cultureStudyPoint"]).
    expect(rows.filter((e) => e.status.kind === "seam").map((e) => e.id)).toEqual([]);
  });

  it("releaseBlockers() holds NO gas giant entry (the release gate list)", () => {
    const blockers = releaseBlockers();
    expect(blockers.filter(isGg).map((e) => e.id)).toEqual([]);
    const named = blockers.filter((e) => e.status.kind === "pending" && GG_OWNER.test(`${e.status.owner} ${e.claim}`));
    expect(named.map((e) => e.id), "pending entries naming the gas giant study: wire them, or name their real owner").toEqual([]);
  });
});
