// ============================================================================
// gasGiantStudy.ts: Gas Giant Study (0.14.0, E-CREW Task 15b), the ENGINE of the ship's study of an orbital body.
// Plan: docs/plans/2026-10-17-gas-giant-study-plan.md sections 3.2 to 3.4, slices GG-2 (orbital bodies lose ground
// objectives) and GG-3 (the study leg and its reward). The content (classes, physics, item ids) is gasGiantContent.ts.
//
// The user's words (verbatim, plan section 1): D22 "Gas Giants are a bad idea for local landing. It should only be from
// the ship. Probably something like studying the gas giant, and analyzing it." OC-G2 "Ship-only study (Recommended)".
// Call 3 "The ship, always (Recommended)": the ship always runs the study, no squad needed; Science crew and a
// Galileo-Class Probe speed and enrich it.
//
// GG-2 (this block): a run whose system holds an ORBITAL-ONLY body (expeditionContent.ts PLANET_TYPES orbitalOnly: the
// gas giant) is stamped `Expedition.study` at dispatch (studyStampFor). On such a run an orbital body gets no ground
// objectives (no PoI, no hostile site, no clearing objective) and no supply cache at its scan boundaries (user call 4
// "Stop on gas giants": the draw is kept); each orbital body carries its GIANT PROFILE (rollGiantProfile: the class by
// real science and the mass, frozen on ExpeditionBody.giant at dispatch). A run without the stamp (every run
// dispatched before GG-2) resolves exactly as stored.
//
// PURE + DETERMINISTIC: every roll is keyed (seed, salt, body index) on its own stream (salts.test.ts registers the
// salts), integer draws only; nothing here reads live state. IMPORT DIRECTION: this module imports model types, the
// content modules and combat/rng only, never expedition.ts or groundOps.ts (both import this one).
// ============================================================================

import type { Expedition, ExpeditionBody, ExpeditionPlanetType } from "./model";
import { PLANET_TYPES } from "./expeditionContent";
import { GIANT_CLASSES, type GiantClassDef, type GiantClassId } from "./gasGiantContent";
import { makeRng } from "./combat/rng";

// ============================================================================
// Salts (odd, distinct; salts.test.ts)
// ============================================================================

// An orbital body's giant profile: draw 1 the class, draw 2 the mass (plan section 3.4).
export const GIANT_PROFILE_SALT = 0x4d2a6b37;

// ============================================================================
// Orbital bodies and the study stamp
// ============================================================================

const ORBITAL_TYPES: ReadonlySet<ExpeditionPlanetType> = new Set(PLANET_TYPES.filter((p) => p.orbitalOnly).map((p) => p.id));

// Is `planetType` an orbital-only body (no surface to land on)? Read off PLANET_TYPES orbitalOnly. Pure.
export function isOrbitalPlanetType(planetType: ExpeditionPlanetType): boolean {
  return ORBITAL_TYPES.has(planetType);
}

// The study flag a dispatch freezes (Expedition.study): 1 when the system holds an orbital body, else undefined (no
// key: a system without one stores exactly the record it stored before GG-2). Pure.
export function studyStampFor(bodies: readonly Pick<ExpeditionBody, "planetType">[]): 1 | undefined {
  return bodies.some((b) => isOrbitalPlanetType(b.planetType)) ? 1 : undefined;
}

// Is body `body` a STUDY body of `exp`: an orbital body of a run stamped `study`? False on every run without the
// stamp, so those resolve exactly as dispatched. Pure.
export function isStudyBody(exp: Pick<Expedition, "study">, body: Pick<ExpeditionBody, "planetType">): boolean {
  return exp.study === 1 && isOrbitalPlanetType(body.planetType);
}

// ============================================================================
// The giant profile (GG-2: the class roll and the mass)
// ============================================================================

// Where a body sits in its system, inner to outer, read off its index (never a draw): the first third of the bodies
// is inner, the last third outer, the rest (and a lone body) middle. Pure.
export type SystemZone = "inner" | "middle" | "outer";
export function systemZone(bodyIndex: number, bodyCount: number): SystemZone {
  const last = bodyCount - 1;
  if (last <= 0) return "middle";
  if (3 * bodyIndex < last) return "inner";
  if (3 * bodyIndex > 2 * last) return "outer";
  return "middle";
}

// A class's heat as the science sorts it: the hot Jupiters (Sudarsky IV and V) sit on tight orbits, the cloudless
// Sudarsky III a little further out, and the cold giants (Sudarsky I and II, the ice giants) far out. A brown dwarf
// has its own heat and leans nowhere.
export type GiantHeat = "hot" | "warm" | "cold" | "none";
export const GIANT_CLASS_HEAT: Readonly<Record<GiantClassId, GiantHeat>> = {
  sudarskyI: "cold",
  sudarskyII: "cold",
  sudarskyIII: "warm",
  sudarskyIV: "hot",
  sudarskyV: "hot",
  iceGiant: "cold",
  brownDwarf: "none",
};

// [PROVISIONAL] the "inner bodies lean hot" class bias (plan section 3.1, the GG-1 carry note: GG-2's class roll owns
// it): the integer factor on each class's approved roll weight (gasGiantContent.ts GIANT_CLASSES weight) by the body's
// zone. Inner bodies lean hot (Sudarsky IV and V x3, III x2), outer bodies lean cold (Sudarsky I, II and the ice giant
// x2), the middle reads the approved weights as they are. A lean, never a rule: every class can appear anywhere.
export const GIANT_ZONE_LEAN: Readonly<Record<SystemZone, Readonly<Record<GiantHeat, number>>>> = {
  inner: { hot: 3, warm: 2, cold: 1, none: 1 },
  middle: { hot: 1, warm: 1, cold: 1, none: 1 },
  outer: { hot: 1, warm: 1, cold: 2, none: 1 },
};

// The mass draw's resolution: the mass is log-uniform over the class's band in this many integer steps (step 0 is
// the band's lightest mass, the last step its heaviest).
export const GIANT_MASS_STEPS = 1000;

// The mass at step `step` of `def`'s band: log-uniform, rounded to whole milli-Jupiter masses. Pure.
export function giantMassAt(def: Pick<GiantClassDef, "massMinMilliJ" | "massMaxMilliJ">, step: number): number {
  const lo = def.massMinMilliJ;
  const hi = def.massMaxMilliJ;
  if (!(hi > lo)) return lo;
  const f = Math.max(0, Math.min(1, step / (GIANT_MASS_STEPS - 1)));
  return Math.max(lo, Math.min(hi, Math.round(lo * Math.pow(hi / lo, f))));
}

// The class roll's integer weight of `def` for a body in `zone`. Pure.
export function giantClassWeight(def: Pick<GiantClassDef, "id" | "weight">, zone: SystemZone): number {
  return Math.max(0, Math.floor(def.weight)) * GIANT_ZONE_LEAN[zone][GIANT_CLASS_HEAT[def.id] ?? "none"];
}

export interface GiantProfile {
  classId: GiantClassId;
  massMilliJ: number;
}

// The giant profile of body `bodyIndex` of a `bodyCount`-body system at `seed`: draw 1 the class (the approved
// weights x the zone lean), draw 2 the mass (log-uniform in the class's band). Its own keyed stream per body, never a
// shared draw, so the rest of the system draws exactly as before. `classes` defaults to the content table (the wiring
// probes pass an edited copy). Pure.
export function rollGiantProfile(seed: number, bodyIndex: number, bodyCount: number, classes: readonly GiantClassDef[] = GIANT_CLASSES): GiantProfile {
  const rng = makeRng((seed ^ GIANT_PROFILE_SALT ^ Math.imul(bodyIndex + 1, 0x9e3779b9)) >>> 0);
  const zone = systemZone(bodyIndex, bodyCount);
  const weights = classes.map((c) => giantClassWeight(c, zone));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.nextInt(Math.max(1, total));
  let pick = classes[classes.length - 1];
  for (let i = 0; i < classes.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) {
      pick = classes[i];
      break;
    }
  }
  const step = rng.nextInt(GIANT_MASS_STEPS);
  return { classId: pick.id, massMilliJ: giantMassAt(pick, step) };
}

// The bodies a STUDY run freezes (buildExpedition): every orbital body carries its giant profile (ExpeditionBody.giant,
// after its other keys); every other body comes back as it is (the same reference). Pure.
export function withGiantProfiles<B extends ExpeditionBody>(seed: number, bodies: readonly B[]): B[] {
  return bodies.map((b, i) => (isOrbitalPlanetType(b.planetType) ? { ...b, giant: rollGiantProfile(seed, i, bodies.length) } : b));
}
