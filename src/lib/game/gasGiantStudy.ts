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
// GG-3 (the second block): THE STUDY. When an orbital body's scan completes the ship holds orbit and studies it
// (groundOps.ts scheduleStudyLeg, GroundOpsState.studyLegs): the scan clock pauses for it like a field repair, the
// teams keep working, an ordinary pickup waits until it ends, and the window does not close before it does. Its
// length is STUDY_BASE_SECONDS (user call 12: 30 min) divided by the deployed Science party's fieldwork pace on the
// body (fieldwork.ts fieldworkSpeedMult: the crew layer and every Science member's lines, a Galileo-Class Probe's
// fieldwork line on a gas giant included; D23, never capped), floored at STUDY_MIN_SECONDS. At its end the reward lands
// (rollStudyReward, user calls 1b.3 and 6): canisters ALWAYS (a count in a range, x the probe's dive, x the region's
// tier haul; each canister's band by the giant class's odds, then its gas by the class's weights), research data at
// 40%, a Survey Log readout at 15%, and an Ancient Data Fragment at odds the probe's relic find line and the tier lift.
// The Galileo's three lines on a giant (user call 6 "Reuse lines"): fieldwork = study speed, hazard resist = its crush
// rating (how deep it dives: x the giant's depth factor, gravity^0.4, through diminishing(), D23), relic find = the
// ancient data odds. The best Galileo among the deployed Science members dives (studyProbe, one probe per dive).
//
// PURE + DETERMINISTIC: every roll is keyed (seed, salt, body index) on its own stream (salts.test.ts registers the
// salts), integer draws only; nothing here reads live state. IMPORT DIRECTION: this module imports model types and
// readers, the content modules, fieldwork.ts, riskFactors.ts and combat/rng only, never expedition.ts or groundOps.ts
// (both import this one).
// ============================================================================

import { memberVariety, type Expedition, type ExpeditionBody, type ExpeditionFinding, type ExpeditionPlanetType, type SurveyLogEntry } from "./model";
import { PLANET_TYPES } from "./expeditionContent";
import {
  ANCIENT_DATA_FRAGMENT_ID,
  GAS_CANISTER_IDS,
  GIANT_CLASSES,
  ITEM_BANDS,
  RESEARCH_DATA_ITEM,
  RESEARCH_FAMILIES,
  canistersInBand,
  giantClassById,
  giantPhysics,
  type BandOdds,
  type CanisterWeights,
  type GasCanisterId,
  type GiantClassDef,
  type GiantClassId,
} from "./gasGiantContent";
import { fieldworkSpeedMult } from "./fieldwork";
import { tierHaulMult } from "./riskFactors";
import { diminishing } from "./diminishing";
import { bodyLetter } from "./starCatalog";
import { makeRng, type Rng } from "./combat/rng";

// ============================================================================
// Salts (odd, distinct; salts.test.ts)
// ============================================================================

// An orbital body's giant profile: draw 1 the class, draw 2 the mass (plan section 3.4).
export const GIANT_PROFILE_SALT = 0x4d2a6b37;
// A study's reward, keyed by the body index (plan section 3.4: the fixed draw order in rollStudyReward).
export const GAS_STUDY_SALT = 0x63e91c55;

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

// The giant profile of body `bodyIndex` of `exp`: the one frozen at dispatch, else (defensive: an orbital body of a
// study run always carries one) the same roll. Pure.
export function bodyGiantProfile(exp: Pick<Expedition, "seed" | "bodies">, bodyIndex: number): GiantProfile {
  return exp.bodies[bodyIndex]?.giant ?? rollGiantProfile(exp.seed, bodyIndex, exp.bodies.length);
}

// ============================================================================
// GG-3: the study (its length, the probe, the reward)
// ============================================================================

// User call 12 (2026-10-19, "Proposed"): a giant study takes 30 minutes at the base pace (the probe and the Science
// crew make it faster).
export const STUDY_BASE_SECONDS = 1800;
// [PROPOSAL] the shortest a study can get however fast the party works (D23: the pace itself is never capped).
export const STUDY_MIN_SECONDS = 60;

// The study's length on `body` for run `exp`: STUDY_BASE_SECONDS / the deployed Science party's fieldwork pace on the
// body's planet type (the crew layer, every Science member's lines, a Galileo's fieldwork line on a gas giant), whole
// seconds, floored at STUDY_MIN_SECONDS. Exactly STUDY_BASE_SECONDS without a Science member (the ship studies alone:
// user call 3, "no squad needed"). Pure.
export function studySeconds(exp: Pick<Expedition, "roster" | "scienceStrength">, body: Pick<ExpeditionBody, "planetType">): number {
  const pace = fieldworkSpeedMult(exp, body.planetType);
  return pace === 1 ? STUDY_BASE_SECONDS : Math.max(STUDY_MIN_SECONDS, Math.round(STUDY_BASE_SECONDS / pace));
}

// [PROVISIONAL] the reference Galileo-Class Probe its two dive lines are read against: an iLevel 10 Standard quality 0
// probe (a 20 point budget at the variety's ratios, hazard 0.3 and relic 0.1, converted at awayTeam.ts GEAR_POINT_BUMP
// 0.01 a point). A probe with these lines rates 1 on each; a better one rates higher, on the D23 curves below.
export const GALILEO_REFERENCE_LINES = { hazardResist: 0.06, relicFind: 0.02 } as const;

// The probe that dives on a study: the deployed Science member's Galileo-Class Probe (memberTool variety `atmoProbe`)
// with the highest hazard resist line (its crush rating), ties to the higher relic find line, then roster order; null
// when nobody aboard wears one (the study still runs, from orbit only). Read off the roster frozen at dispatch, so the
// dive is fixed at launch. [PROPOSAL] one probe per dive (plan GG-3).
export interface StudyProbe {
  memberId: string;
  pieceId: string;
  hazardResist: number;
  relicFind: number;
  diveRating: number; // hazardResist / the reference probe's
  relicRating: number; // relicFind / the reference probe's
}
export const GALILEO_VARIETY = "atmoProbe";
export function studyProbe(exp: Pick<Expedition, "roster">): StudyProbe | null {
  let best: StudyProbe | null = null;
  for (const m of exp.roster?.science ?? []) {
    if (!m.fieldwork) continue;
    // The snapshot keeps one fieldwork source per PLANET-TUNED piece after the untuned one, in the gear's mint order
    // (awayTeam.ts snapshotMember), so the k-th tuned piece of `gear` owns source k + 1.
    let tuned = 0;
    for (const piece of m.gear) {
      const planetTypes = memberVariety(piece.slotType, piece.varietyKey)?.member.planetTypes;
      if (!planetTypes || planetTypes.length === 0) continue;
      tuned += 1;
      if (piece.varietyKey !== GALILEO_VARIETY) continue;
      const src = m.fieldwork[tuned];
      if (!src) continue;
      const hazardResist = Math.max(0, src.hazardResist);
      const relicFind = Math.max(0, src.relicFind);
      if (best && (hazardResist < best.hazardResist || (hazardResist === best.hazardResist && relicFind <= best.relicFind))) continue;
      best = {
        memberId: m.memberId,
        pieceId: piece.pieceId,
        hazardResist,
        relicFind,
        diveRating: hazardResist / GALILEO_REFERENCE_LINES.hazardResist,
        relicRating: relicFind / GALILEO_REFERENCE_LINES.relicFind,
      };
    }
  }
  return best;
}

// The giant's DEPTH FACTOR (gasGiantContent.ts giantPhysics: cloud-top gravity^0.4): a heavier, denser giant takes the
// probe deeper for the same crush rating. Pure.
export function giantDepthFactor(profile: GiantProfile, classes: readonly GiantClassDef[] = GIANT_CLASSES): number {
  const def = classes.find((c) => c.id === profile.classId) ?? giantClassById(profile.classId);
  return def ? giantPhysics(def, profile.massMilliJ).depthFactor : 1;
}

// [PROPOSAL] the dive's haul bonus (plan GG-3): diminishing(STUDY_DIVE_PER_RATING x depth factor x the probe's dive
// rating, STUDY_DIVE_KNEE). 0 without a probe; unbounded, every better probe or denser giant adds a little more (D23).
export const STUDY_DIVE_PER_RATING = 0.5;
export const STUDY_DIVE_KNEE = 2;
export function studyDiveBonus(depthFactor: number, diveRating: number): number {
  return diminishing(STUDY_DIVE_PER_RATING * Math.max(0, depthFactor) * Math.max(0, diveRating), STUDY_DIVE_KNEE);
}

// [PROPOSAL] the canisters a study fills before the dive and the tier haul (plan GG-3: 4 to 8, user call 1b.3 "100% gas
// canisters (in a range)").
export const STUDY_CANISTERS_MIN = 4;
export const STUDY_CANISTERS_MAX = 8;
// The user's odds (2026-10-09, 1b.3): "you have the 40% chance of research data and the 15% survey readout".
export const STUDY_RESEARCH_DATA_PERMILLE = 400;
export const STUDY_SURVEY_READOUT_PERMILLE = 150;
// [PROVISIONAL] the Ancient Data Fragment's odds (user call 10, "One lane"; relics capture 3: the odds rise with the
// tier): ANCIENT_FRAGMENT_BASE_PERMILLE x the region's tier haul multiplier x (1 + diminishing(ANCIENT_PROBE_LIFT x the
// probe's relic rating, ANCIENT_PROBE_KNEE)). About 1.5% from orbit at Tier II and 4% with the reference probe there
// (the v3 mockup's sample line), unbounded with a better probe.
export const ANCIENT_FRAGMENT_BASE_PERMILLE = 12;
export const ANCIENT_PROBE_LIFT = 2.5;
export const ANCIENT_PROBE_KNEE = 2;

export function ancientFragmentPermille(exp: Pick<Expedition, "region">, relicRating: number): number {
  const lift = 1 + diminishing(ANCIENT_PROBE_LIFT * Math.max(0, relicRating), ANCIENT_PROBE_KNEE);
  return Math.max(0, Math.min(1000, Math.round(ANCIENT_FRAGMENT_BASE_PERMILLE * tierHaulMult(exp.region) * lift)));
}

// The canister count's expected size before its chance rounding: the base draw x (1 + the dive) x the tier haul. Pure.
export function studyCanisterScale(exp: Pick<Expedition, "region" | "roster" | "seed" | "bodies">, bodyIndex: number, classes: readonly GiantClassDef[] = GIANT_CLASSES): number {
  const probe = studyProbe(exp);
  const dive = probe ? studyDiveBonus(giantDepthFactor(bodyGiantProfile(exp, bodyIndex), classes), probe.diveRating) : 0;
  return (1 + dive) * tierHaulMult(exp.region);
}

// The canisters a study of body `bodyIndex` can return, low to high (the forecast line, mockup v3 "8 to 17
// canisters"): the base range x studyCanisterScale, the low end rounded down and the high end up (the chance rounding
// can add one). Pure.
export function studyCanisterRange(exp: Pick<Expedition, "region" | "roster" | "seed" | "bodies">, bodyIndex: number): [number, number] {
  const scale = studyCanisterScale(exp, bodyIndex);
  return [Math.floor(STUDY_CANISTERS_MIN * scale), Math.ceil(STUDY_CANISTERS_MAX * scale)];
}

// One canister's band (draw 6: its percent odds walked low to high) and its gas within the band (draw 7: the integer
// weights). Both draws are always taken. Pure on the stream.
export function rollCanister(rng: Rng, odds: BandOdds, weights: CanisterWeights): GasCanisterId {
  const total = ITEM_BANDS.reduce((a, b) => a + Math.max(0, odds[b]), 0);
  let roll = rng.nextInt(Math.max(1, total));
  let band = ITEM_BANDS[0];
  for (const b of ITEM_BANDS) {
    roll -= Math.max(0, odds[b]);
    if (roll < 0) {
      band = b;
      break;
    }
  }
  const inBand = canistersInBand(band);
  const sum = inBand.reduce((a, id) => a + Math.max(0, weights[id]), 0);
  let pick = rng.nextInt(Math.max(1, sum));
  for (const id of inBand) {
    pick -= Math.max(0, weights[id]);
    if (pick < 0) return id;
  }
  return inBand[inBand.length - 1] ?? GAS_CANISTER_IDS[0];
}

// THE REWARD of the study of body `bodyIndex`, ending at `at` (the window's event): one finding, keyed on
// GAS_STUDY_SALT by the body index, in a FIXED draw order so a count change never shifts a bonus roll (plan 3.4):
//   (1) research data at STUDY_RESEARCH_DATA_PERMILLE, (2) its family (uniform over the eight [PROPOSAL]), (3) the
//   Survey Log readout at STUDY_SURVEY_READOUT_PERMILLE, (4) the Ancient Data Fragment at ancientFragmentPermille,
//   (5) the canister base count (STUDY_CANISTERS_MIN to MAX), (6) its chance rounding (x studyCanisterScale: floor plus
//   one more at the fraction's per-mille, the salvage.ts chanceRound rule on an integer draw), then per canister
//   (7) its band and (8) its gas (rollCanister).
// Materials list the canisters in GAS_CANISTER_IDS order, then the data, then the fragment. `classes` defaults to the
// content table (the wiring probes pass an edited copy). Pure.
export function rollStudyReward(
  exp: Pick<Expedition, "id" | "seed" | "bodies" | "region" | "roster" | "systemName">,
  bodyIndex: number,
  at: number,
  classes: readonly GiantClassDef[] = GIANT_CLASSES,
): ExpeditionFinding {
  const rng = makeRng((exp.seed ^ GAS_STUDY_SALT ^ Math.imul(bodyIndex + 1, 0x9e3779b9)) >>> 0);
  const profile = bodyGiantProfile(exp, bodyIndex);
  const def = classes.find((c) => c.id === profile.classId) ?? giantClassById(profile.classId) ?? GIANT_CLASSES[0];
  const probe = studyProbe(exp);
  const data = rng.chance(STUDY_RESEARCH_DATA_PERMILLE, 1000);
  const family = RESEARCH_FAMILIES[rng.nextInt(RESEARCH_FAMILIES.length)];
  const survey = rng.chance(STUDY_SURVEY_READOUT_PERMILLE, 1000);
  const ancient = rng.chance(ancientFragmentPermille(exp, probe?.relicRating ?? 0), 1000);
  const base = rng.nextRange(STUDY_CANISTERS_MIN, STUDY_CANISTERS_MAX);
  const raw = base * studyCanisterScale(exp, bodyIndex, classes);
  const whole = Math.floor(raw);
  const count = whole + (rng.nextInt(1000) < Math.round((raw - whole) * 1000) ? 1 : 0);
  const filled: Partial<Record<GasCanisterId, number>> = {};
  for (let i = 0; i < count; i += 1) {
    const id = rollCanister(rng, def.bandOdds, def.itemWeights);
    filled[id] = (filled[id] ?? 0) + 1;
  }
  const materials: Record<string, number> = {};
  for (const id of GAS_CANISTER_IDS) if ((filled[id] ?? 0) > 0) materials[id] = filled[id] as number;
  if (data) materials[RESEARCH_DATA_ITEM[family]] = 1;
  if (ancient) materials[ANCIENT_DATA_FRAGMENT_ID] = 1;
  const finding: ExpeditionFinding = { id: `${exp.id}-find-study-${bodyIndex}`, source: "study", materials };
  if (survey) finding.survey = surveyLogEntry(exp, bodyIndex, profile, at);
  return finding;
}

// The Survey Log entry a study's readout writes (GameState.surveyLog at claim). Pure.
export function surveyLogEntry(
  exp: Pick<Expedition, "id" | "region" | "systemName">,
  bodyIndex: number,
  profile: GiantProfile,
  at: number,
): SurveyLogEntry {
  return {
    id: `${exp.id}-survey-${bodyIndex}`,
    at,
    systemName: exp.systemName,
    bodyName: `${exp.systemName} ${bodyLetter(bodyIndex)}`,
    kind: "giant",
    classId: profile.classId,
    massMilliJ: profile.massMilliJ,
    tier: exp.region?.tier ?? 1,
  };
}

// THE PROBE DIVE seam (plan GG-3; gear wear design 3.1: "tools by fieldwork"): one event per FINISHED study whose run
// carried a Galileo, at the study's end, naming the member and the piece that dove. Gear wear step 3 reads it (the
// probe's use wear); nothing else does. Pure.
export interface StudyDiveEvent {
  bodyIndex: number;
  at: number;
  memberId: string;
  pieceId: string;
}
export function studyDiveEvents(exp: Pick<Expedition, "roster" | "groundOps">): StudyDiveEvent[] {
  const probe = studyProbe(exp);
  if (!probe) return [];
  return (exp.groundOps?.studyLegs ?? []).filter((l) => l.done).map((l) => ({ bodyIndex: l.bodyIndex, at: l.endsAt, memberId: probe.memberId, pieceId: probe.pieceId }));
}
