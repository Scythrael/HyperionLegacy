// WR-1 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 3.4): THE COMPLETENESS LEVEL.
//
//   1. Every effect source the catalogs configure (wiring/catalogs.ts enumerates them programmatically, never by
//      hand) has a registry entry; no entry names a source that no longer exists; no two entries share an id.
//   2. Every field of every catalog def type is classified (wiring/fieldRoles.ts): a NEW field fails until it is.
//   3. The claim-text check: a display field whose text promises a number ("+5%", "8%") belongs to a def the
//      registry tracks.
//   4. Unread constants: an exported UPPER_CASE constant in src/lib/game that nothing outside its declaration reads
//      fails unless it is listed (with its role or owner) in fieldRoles.ts UNREAD_CONSTANTS.
//   5. Every entry is well formed: a live entry has a probe and contexts (or says why the field does not apply), a
//      pending entry names its owning slice, a deferred entry carries the user's words.
//   6. B18 (vocabulary drift): every line a ship or member piece can roll is registered, including the ones the
//      stat vocabulary lists as RESERVED.
//   7. THE RELEASE GATE: with RELEASE_GATE set, the suite fails while any entry is pending (the user's "no
//      placeholders" rule for 0.14.0: T1, capture 2026-10-15 section 2). Expected to fail until WR-12.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { MEMBER_GROUND_STAT_KEYS, RESERVED_STAT_KEYS } from "./model";
import { CATALOGS, WIRING_REGISTRY, releaseBlockers, type WiringEntry } from "./wiring/registry";
import { CONTEXT_IDS } from "./wiring/probes";
import { classifiedCatalogDefs, enumerateEffectSources, shipLineKeys } from "./wiring/catalogs";
import { FIELD_ROLES, UNREAD_CONSTANTS } from "./wiring/fieldRoles";

// Registry catalogs that are not catalog walks: the plan's audit rows, derived seams and missing fields.
// Gas Giant Study GG-3: GAS_STUDY_SEAM (the probe dive seam).
const SUPPLEMENTARY_CATALOGS = new Set(["AUDIT", "AWAY_TEAM_STRENGTH", "CAPTAIN_PROGRESSION", "MEMBER_PERKS", "SHIP_SEAMS", "SHIP_TYPES.missing", "GAMBIT_PROGRAMS", "SPEED_SEAM", "GAS_STUDY_SEAM", "DATA_STUDY_SEAM"]);

const sources = enumerateEffectSources();
// The display texts that promise a number today (the five Fleet Logistics queue labels, "+1 ..."): the scan must see them.
const PROMISING_TEXTS_FLOOR = 4;
const sourceKeys = new Set(sources.map((s) => `${s.catalog}|${s.key}`));

// An entry belongs to an enumerated source when it names it, or a sub-part of it ("<key>:<part>").
function belongsToASource(e: WiringEntry): boolean {
  if (sourceKeys.has(`${e.source.catalog}|${e.source.key}`)) return true;
  const parts = e.source.key.split(":");
  for (let i = parts.length - 1; i > 0; i -= 1) if (sourceKeys.has(`${e.source.catalog}|${parts.slice(0, i).join(":")}`)) return true;
  return false;
}

describe("wiring completeness: every configured effect source is in the registry", () => {
  it("enumerates a real catalog (vacuity guard)", () => {
    expect(sources.length).toBeGreaterThan(500);
  });

  it("every enumerated source has a registry entry", () => {
    const have = new Set(WIRING_REGISTRY.map((e) => `${e.source.catalog}|${e.source.key}`));
    const missing = sources.filter((s) => !have.has(`${s.catalog}|${s.key}`)).map((s) => `${s.catalog}:${s.key}`);
    expect(missing, "configured effect sources with no wiring registry entry: register each (live with a probe, or pending with an owner)").toEqual([]);
  });

  it("no registry entry names a source that no longer exists", () => {
    const stale = WIRING_REGISTRY.filter((e) => !SUPPLEMENTARY_CATALOGS.has(e.source.catalog) && !belongsToASource(e)).map((e) => e.id);
    expect(stale, "registry entries whose catalog source is gone").toEqual([]);
  });

  it("no two entries share an id", () => {
    const ids = WIRING_REGISTRY.map((e) => e.id);
    expect(ids.length - new Set(ids).size).toBe(0);
  });
});

describe("wiring completeness: every catalog field is classified", () => {
  const defs = classifiedCatalogDefs();

  it("every field of every def has a role, and no role names a field no def has", () => {
    const problems: string[] = [];
    for (const [catalog, byKey] of Object.entries(defs)) {
      const roles = FIELD_ROLES[catalog];
      const present = new Set(Object.values(byKey).flatMap((d) => Object.keys(d)));
      for (const f of present) if (!(f in roles)) problems.push(`${catalog}.${f} is unclassified (fieldRoles.ts)`);
      for (const f of Object.keys(roles)) if (!present.has(f)) problems.push(`${catalog}.${f} is classified but no def has it`);
    }
    expect(problems).toEqual([]);
  });

  it("the claim-text check: a display text that promises a number belongs to a tracked def", () => {
    const promises = /(\d+(\.\d+)?\s*%)|((^|[\s(])\+\d)/;
    // The registry catalogs each classified catalog's defs are registered under.
    const registeredUnder: Readonly<Record<string, readonly string[]>> = {
      CREW_BUFFS: ["CREW_PROFESSION_BUFFS", "SECOND_LEVEL_EXCLUSIVE"],
      FACILITY_UPGRADES: ["FACILITIES"],
      EQUIPMENT_SLOTS: ["SHIP_GEAR_LINES", "EQUIPMENT_SLOTS.member"],
      EQUIPMENT_VARIETIES: ["EQUIPMENT_SLOTS.member", "SHIP_GEAR_LINES"],
    };
    // A def is tracked when an entry of ITS catalog names it (its key, or a sub-part "<key>:<part>") and the entry's
    // claim carries the def's own label: the promise is registered on the def that makes it, not on any key that
    // happens to share the spelling.
    const labelOf = (def: object): string | undefined => {
      for (const f of ["label", "name", "title", "displayName"]) {
        const v = (def as Record<string, unknown>)[f];
        if (typeof v === "string" && v.length > 0) return v;
      }
      return undefined;
    };
    const tracked = (catalog: string, key: string, def: object) => {
      const catalogs = registeredUnder[catalog] ?? [catalog];
      const label = labelOf(def);
      return WIRING_REGISTRY.some(
        (e) =>
          catalogs.includes(e.source.catalog) &&
          (e.source.key === key || e.source.key.startsWith(`${key}:`)) &&
          (label === undefined || e.claim.includes(label)),
      );
    };
    const hits: string[] = [];
    let promising = 0;
    for (const [catalog, byKey] of Object.entries(defs)) {
      const roles = FIELD_ROLES[catalog];
      for (const [key, def] of Object.entries(byKey)) {
        for (const [f, role] of Object.entries(roles)) {
          if (role !== "display") continue;
          const v = (def as Record<string, unknown>)[f];
          if (typeof v !== "string" || !promises.test(v)) continue;
          promising += 1;
          if (!tracked(catalog, key, def)) hits.push(`${catalog}.${key}.${f}: "${v}"`);
        }
      }
    }
    expect(promising, "the scan must see the texts that promise a number").toBeGreaterThan(PROMISING_TEXTS_FLOOR);
    expect(hits, "display text that promises an effect, on a def the registry does not track (under its own catalog and label)").toEqual([]);
  });
});

// The source scan (the spare-predicate.test.ts pattern): every exported UPPER_CASE constant in src/lib/game
// (non-test), and every reference to it in src (non-test, comments stripped, the wiring registry itself excluded).
function walk(dir: string, out: string[]): void {
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) {
      if (p.endsWith("/wiring")) continue;
      walk(p, out);
    } else if (/\.(ts|svelte)$/.test(f) && !/\.(test|testkit)\.ts$|\.d\.ts$|\.fixture\.ts$|TestFixtures\.ts$/.test(f)) out.push(p);
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("wiring completeness: no exported constant is left unread", () => {
  it("every exported UPPER_CASE constant in src/lib/game is read, or listed with its role", () => {
    const files: string[] = [];
    walk("src", files);
    const texts = files.map((p) => ({ p, t: stripComments(readFileSync(p, "utf8")) }));
    const decl = /^export const ([A-Z][A-Z0-9_]+)[\s:=]/gm;
    const names: string[] = [];
    for (const { p, t } of texts) {
      if (!p.startsWith("src/lib/game/")) continue;
      for (const m of t.matchAll(decl)) names.push(m[1]);
    }
    expect(names.length, "the scan must see the engine's constants").toBeGreaterThan(300);
    const all = texts.map((x) => x.t).join("\n");
    const unread = names.filter((n) => (all.match(new RegExp(`\\b${n}\\b`, "g")) ?? []).length <= 1);
    const unlisted = unread.filter((n) => !(n in UNREAD_CONSTANTS));
    expect(unlisted, "exported constants nothing reads: wire them, delete them, or list them in UNREAD_CONSTANTS with an owner").toEqual([]);
    const stale = Object.keys(UNREAD_CONSTANTS).filter((n) => !unread.includes(n));
    expect(stale, "UNREAD_CONSTANTS lists a constant that is now read (or gone): remove it").toEqual([]);
  });
});

describe("wiring completeness: every entry is well formed", () => {
  const contexts = new Set<string>(CONTEXT_IDS);
  it("a live entry has a probe and contexts, or says why its field does not apply", () => {
    const bad = WIRING_REGISTRY.filter((e) => e.status.kind === "live" && !e.notApplicable && (e.probe === undefined || e.contexts.length === 0)).map((e) => e.id);
    expect(bad).toEqual([]);
  });
  it("a pending, deferred or seam entry names its owner; a deferred, held or seam entry carries the user's words", () => {
    for (const e of WIRING_REGISTRY) {
      if (e.status.kind === "pending") expect(e.status.owner.length, e.id).toBeGreaterThan(0);
      if (e.status.kind === "deferred") expect(e.status.userRef.length, e.id).toBeGreaterThan(0);
      if (e.status.kind === "held") expect(e.status.userRef.length, e.id).toBeGreaterThan(0);
      if (e.status.kind === "seam") {
        expect(e.status.owner.length, e.id).toBeGreaterThan(0);
        expect(e.status.userRef.length, e.id).toBeGreaterThan(0);
      }
    }
  });
  it("every context is a known context, and a PARTIAL entry's missing contexts are not also live", () => {
    for (const e of WIRING_REGISTRY) {
      for (const c of e.contexts) expect(contexts.has(c), `${e.id}: ${c}`).toBe(true);
      const missing = e.status.kind === "pending" || e.status.kind === "deferred" ? e.status.contexts ?? [] : [];
      for (const c of missing) {
        expect(contexts.has(c), `${e.id}: ${c}`).toBe(true);
        expect(e.contexts.includes(c), `${e.id}: ${c} is both live and missing`).toBe(false);
      }
    }
  });
  it("a non-live entry with a probe names the claimed contexts its flat check reads (never a catch-all context)", () => {
    for (const e of WIRING_REGISTRY) {
      if (e.status.kind !== "pending" && e.status.kind !== "deferred") continue;
      const claimed = e.status.contexts ?? [];
      if (e.probe !== undefined) expect(claimed.length, `${e.id}: a probe but no claimed context to check it flat at`).toBeGreaterThan(0);
      for (const c of Object.keys(e.flatChecks ?? {})) expect(claimed.includes(c as never), `${e.id}: a flat check at ${c}, which it does not claim`).toBe(true);
    }
  });
  // G1-4 (plan 4 G1-4): every entry whose claim covers missions also covers the short-range cycle, live there or with
  // an explicit outOfScope reason. The per-def MISSIONS content (one captain-mission def's own fields) is its own
  // catalog's, as the short-range templates' content is SHORT_RANGE_TEMPLATES'.
  it("every mission-claim entry covers mission:shortRange (live, still pending there, or out of scope with a reason)", () => {
    const MISSION_CONTEXTS = new Set<string>(["mission:extraction", "mission:survey", "mission:transport"]);
    const claimed = (e: WiringEntry): string[] => [
      ...e.contexts,
      ...(e.status.kind === "pending" || e.status.kind === "deferred" ? e.status.contexts ?? [] : []),
      ...(e.outOfScope ?? []).map((o) => o.context),
    ];
    const missionClaims = WIRING_REGISTRY.filter((e) => e.source.catalog !== "MISSIONS" && claimed(e).some((c) => MISSION_CONTEXTS.has(c)));
    expect(missionClaims.length, "the sweep sees the mission-claim entries").toBeGreaterThan(30);
    const uncovered = missionClaims.filter((e) => !claimed(e).includes("mission:shortRange")).map((e) => e.id);
    expect(uncovered, "add mission:shortRange to these entries' contexts, or an outOfScope reason (registry.ts SHORT_RANGE_SWEEP)").toEqual([]);
    for (const e of WIRING_REGISTRY) for (const o of e.outOfScope ?? []) expect(o.reason.length, `${e.id} @ ${o.context}`).toBeGreaterThan(10);
  });
  it("every magnitude reads a finite number from the catalogs", () => {
    for (const e of WIRING_REGISTRY) expect(Number.isFinite(e.magnitude(CATALOGS)), e.id).toBe(true);
  });
  // 0.14.0 release gate for the captain secondary trees (WR-5a prospector, WR-5b tactician, WR-5c explorer): every
  // node has a live entry, none is left pending.
  it("every captain secondary talent node is live, none pending", () => {
    const secondary = WIRING_REGISTRY.filter((e) => e.source.catalog === "SECONDARY_CAPTAIN_TALENTS");
    const keys = new Set(secondary.map((e) => e.source.key.split(":")[0]));
    expect(keys.size).toBe(Object.keys(CATALOGS.SECONDARY_CAPTAIN_TALENTS).length);
    for (const e of secondary) expect(e.status.kind, e.id).toBe("live");
  });
});

describe("wiring completeness: B18, every rollable line is registered", () => {
  it("every line a ship piece can roll has an entry, the RESERVED ones that roll included", () => {
    const lines = shipLineKeys();
    const registered = new Set(WIRING_REGISTRY.filter((e) => e.source.catalog === "SHIP_GEAR_LINES").map((e) => e.source.key));
    expect(lines.filter((k) => !registered.has(k))).toEqual([]);
    // The drift the old guard could not see: these roll and are read, though the vocabulary calls them RESERVED.
    const reservedButRolled = (RESERVED_STAT_KEYS as readonly string[]).filter((k) => lines.includes(k));
    for (const k of reservedButRolled) expect(registered.has(k), k).toBe(true);
  });
  it("every member ground line some variety rolls has an entry", () => {
    const rolled = new Set(WIRING_REGISTRY.filter((e) => e.source.catalog === "EQUIPMENT_SLOTS.member").map((e) => e.source.key.split(":")[3]));
    for (const k of MEMBER_GROUND_STAT_KEYS) expect(rolled.has(k), k).toBe(true);
  });
});

// The 0.14.0 close-out (plan WR-12): `RELEASE_GATE=1 npx vitest run src/lib/game/wiring.completeness.test.ts`.
const RELEASE_GATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RELEASE_GATE;

describe.runIf(Boolean(RELEASE_GATE))("release gate: 0.14.0 ships with everything wired", () => {
  it("no registry entry is pending (deferred entries carry the user's words)", () => {
    expect(releaseBlockers().map((e) => `${e.id} (${e.status.kind === "pending" ? e.status.owner : ""})`)).toEqual([]);
  });
});
