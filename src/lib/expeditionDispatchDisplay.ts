// expeditionDispatchDisplay.ts: the display decisions behind the Expedition Console's dispatch view (0.14.0,
// Ground Operations GO-12 + Squads SQ-7 section 7.2).
//
// WHY a .ts beside ExpeditionPanel.svelte: this repo has no Svelte component test harness, so the choices worth
// gating live here as pure functions over the tested engine, and the component only draws them:
//   - GO-12, the dispatch strip: which ground teams WILL deploy (name, kind, Security / Science ready counts) and
//     which will NOT, with why and the time remaining (no stand-ins, user 2026-10-12), plus the ship-level reason
//     the ship cannot launch (groundTeams.ts groundDeployBlockText).
//   - SQ-7 section 7.2, the Subspace Telescope block of a candidate: the detail chip, the four risk factor rows
//     (a 5-step meter, the grade, a flavor line), the per-body strip (Per body), the recommendation box with "Set
//     composition" and who it moves (Recommendation), the forecast line (Forecast), and the blind candidate.
//   - The LAZY launch view: the recommendation and the forecast simulate launches (expedition.ts
//     expeditionLaunchView, about 140 ms on a first read), so the panel asks for them only for the expanded
//     candidate, and only again when an input that shapes them changes (launchViewInputs below), never per tick.
// No game rule lives here: every gate, grade and outcome is read from the engine.

import type { GameState, GroundTeamKind, ShipInstance } from "./game/model";
import type { ExpeditionCandidate } from "./game/expedition";
import { squadsOfType, teamKindLabel, teamKindName } from "./game/groundComposition";
import { getPlanetTypeById } from "./game/expeditionContent";
import {
  applyComposition,
  groundDeployBlockText,
  groundSlotBlockText,
  groundTeamName,
  groundTeamWaitText,
  planComposition,
  type GroundDeployCheck,
  type GroundTeamReadiness,
} from "./game/groundTeams";
import { isMemberReady, shipCrewRoom } from "./game/awayTeam";
import { RISK_FACTOR_NAMES, RISK_GRADE_NAMES, hazardGrade, riskFlavor, type RiskFactorId, type RiskGrade } from "./game/riskFactors";
import { REGION_TIER_NAMES, TELESCOPE_DETAIL, regionTierNumeral } from "./game/telescope";
import {
  forecastTasksText,
  taskDemandText,
  type LaunchForecast,
  type LaunchRecommendation,
  type LaunchView,
} from "./game/launchRecommendation";
import type { ThreatAssessment } from "./game/combat/threatAssessment";
import type { IconName } from "./ui/icons";
import { nameList } from "./groundTeamDisplay";
import { forecastAffixPills, type AffixPillView } from "./objectiveAffixDisplay";

// ============================================================================
// GO-12: the dispatch strip (which ground teams deploy)
// ============================================================================

export type DispatchTeamStatus = "deploys" | "waits" | "empty";

export interface DispatchTeamRow {
  index: number;
  name: string; // groundTeamName
  kind: GroundTeamKind;
  kindLabel: string; // "Strike team"
  status: DispatchTeamStatus;
  statusText: string; // "Will deploy" / "Will not deploy" / "Stays aboard: nobody is slotted."
  countsText: string | null; // "3 Security, 3 Science ready" / "Ready: 2 of 3 Security, 3 of 3 Science"
  waits: string[]; // groundTeamWaitText per wait, in the engine's order (injuries first, then empty squads)
}

export interface DispatchTeamsView {
  rows: DispatchTeamRow[];
  deploying: number;
  summary: string; // "2 of 2 teams will deploy"
  ok: boolean; // the ship's ground teams meet D18 (the engine's own gate)
  blockText: string | null; // the ship-level reason, when it cannot launch ("No ground team is ready: ...")
  blockHint: string | null; // where to fix it
}

// The team's ready count per squad type it holds, slot order (a Strike team holds no Science squad, so it shows
// Security only). Pure.
function readyCounts(team: GroundTeamReadiness, now: number): { type: "Security" | "Science"; ready: number; slotted: number }[] {
  const out: { type: "Security" | "Science"; ready: number; slotted: number }[] = [];
  if (squadsOfType(team.kind, "security") > 0) {
    out.push({ type: "Security", ready: team.security.filter((m) => isMemberReady(m, now)).length, slotted: team.security.length });
  }
  if (squadsOfType(team.kind, "science") > 0) {
    out.push({ type: "Science", ready: team.science.filter((m) => isMemberReady(m, now)).length, slotted: team.science.length });
  }
  return out;
}

// One row per ground team of the ship, in team order, from the engine's deploy check read at `now` (the same
// clock). A team deploys only when every slotted member is ready and every squad holds a member; a team that does
// not lists what it waits on with the time left (the player swaps members by hand; nobody stands in). Pure.
export function dispatchTeamsView(check: GroundDeployCheck, now: number): DispatchTeamsView {
  const rows: DispatchTeamRow[] = check.teams.map((t) => {
    const counts = readyCounts(t, now);
    const base = { index: t.index, name: t.name, kind: t.kind, kindLabel: teamKindLabel(t.kind) };
    if (!t.staffed) {
      return { ...base, status: "empty", statusText: "Stays aboard: nobody is slotted.", countsText: null, waits: [] };
    }
    if (t.deploys) {
      return {
        ...base,
        status: "deploys",
        statusText: "Will deploy",
        countsText: `${counts.map((c) => `${c.ready} ${c.type}`).join(", ")} ready`,
        waits: [],
      };
    }
    return {
      ...base,
      status: "waits",
      statusText: "Will not deploy",
      countsText: `Ready: ${counts.map((c) => `${c.ready} of ${c.slotted} ${c.type}`).join(", ")}`,
      waits: t.waits.map(groundTeamWaitText),
    };
  });
  const deploying = rows.filter((r) => r.status === "deploys").length;
  const block = groundDeployBlockText(check, now);
  return {
    rows,
    deploying,
    summary: `${deploying} of ${rows.length} ${rows.length === 1 ? "team" : "teams"} will deploy`,
    ok: check.ok,
    blockText: block === null ? null : `${block}.`,
    blockHint: block === null ? null : "Slot or swap members on the ship's Away Team tab.",
  };
}

// ============================================================================
// SQ-7 section 7.2: the Subspace Telescope block
// ============================================================================

export const RISK_FACTOR_ORDER: readonly RiskFactorId[] = ["combat", "fauna", "flora", "hazard"];

// The SVG glyph of each factor (icons.ts, GO-10 / SQ-7).
export const RISK_FACTOR_GLYPHS: Readonly<Record<RiskFactorId, IconName>> = {
  combat: "riskCombat",
  fauna: "riskFauna",
  flora: "riskFlora",
  hazard: "riskHazard",
};

// The meter's color per grade None..Extreme: the approved mockup's ramp (literal hex, like the threat ramp, the
// same in every theme), green through red.
export const RISK_GRADE_COLORS: readonly string[] = ["#46c98b", "#8fd06a", "#d6c45a", "#e0a23a", "#e8566d"];

// The steps of the meter (design 5.1: one five-step scale, None to Extreme).
export const RISK_METER_STEPS = 5;

// The lines the engine leaves null (riskFactors.ts riskFlavor: None, and every Hazard step), from the approved
// mockup's section 3 [PROPOSAL wording, display only].
const NONE_FLAVOR: Readonly<Record<RiskFactorId, string>> = {
  combat: "No hostile signs",
  fauna: "No life signs",
  flora: "No growth",
  hazard: "Calm",
};
const HAZARD_FLAVOR: readonly string[] = ["Calm", "Mild", "Harsh", "Severe", "Lethal"];

// A factor grade's flavor line: the engine's line, else the mockup's for None and Hazard. Pure.
export function factorFlavor(factor: RiskFactorId, grade: RiskGrade): string {
  if (factor === "hazard") return HAZARD_FLAVOR[grade] ?? NONE_FLAVOR.hazard;
  return riskFlavor(factor, grade) ?? NONE_FLAVOR[factor];
}

export interface TelescopeFactorRow {
  id: RiskFactorId;
  label: string; // "Combat risk"
  glyph: IconName;
  present: boolean;
  grade: RiskGrade | null; // null at Contact (presence only)
  gradeName: string; // "Moderate", or "Present" / "Not detected" at Contact
  flavor: string | null; // null at Contact
  lit: number; // meter steps lit (grade + 1), 0 at Contact
  color: string | null; // the meter color of the grade
  ariaLabel: string; // "Combat risk: Moderate, Hostile activity"
}

export interface TelescopeBodyRow {
  label: string; // "Body 2 · Terrestrial"
  grades: { id: RiskFactorId; label: string; gradeName: string; grade: RiskGrade }[];
}

export interface TelescopeBlockView {
  blind: boolean;
  regionText: string; // "Tier I · Local Bubble · 92 ly from your homeworld"
  detail: number;
  detailName: string;
  chipText: string; // "Detail 2 · Graded" / "Blind launch"
  liftText: string | null; // the ship's sensors raised the reading
  rangeText: string | null; // blind only: the range gap
  enemyTerritory: boolean;
  factors: TelescopeFactorRow[]; // empty when blind
  bodies: TelescopeBodyRow[] | null; // Per body and up
  demandText: string | null; // Per body and up: "Security work on 3 of 5 bodies; ..."
  nextNote: string | null; // what the next detail level adds
  wantsLaunchView: boolean; // Recommendation and up: the panel asks for the lazy launch view
}

const ly = (n: number): string => `${Math.round(n).toLocaleString("en-US")} ly`;

// A candidate's region and distance, always known, blind or not (design 6.3 Blind: "Name, region, distance"):
// "Tier I · Local Bubble · 92 ly". Pure.
export function candidateRegionText(t: Pick<ExpeditionCandidate["telescope"], "regionTier" | "distanceLy">): string {
  return `Tier ${regionTierNumeral(t.regionTier)} · ${REGION_TIER_NAMES[t.regionTier]} · ${ly(t.distanceLy)}`;
}

// GO-12 review minor: the hint beside "Beyond sensor range" / "Contents hidden" when the telescope still reads the
// system (any detail above Blind), so the two readings never look contradictory. Null when the ship's sensors
// reach it, or when the telescope is blind there too. Pure.
export const SENSOR_SPLIT_HINT = "The telescope reads risk; ship sensors read what is there.";
export function sensorSplitHint(
  t: Pick<ExpeditionCandidate["telescope"], "blind" | "detail">,
  fk: Pick<ExpeditionCandidate["foreknowledge"], "inRange">,
): string | null {
  return !fk.inRange && !t.blind && t.detail > TELESCOPE_DETAIL.blind ? SENSOR_SPLIT_HINT : null;
}

// The telescope block of `candidate` (its telescope reading and the ship's foreknowledge, which names the planet
// types when the ship's sensors read them), for a telescope at `level`. Hazard reads the higher of the telescope's
// grade and the ship's own hazard read (design 6.4: "whichever is higher wins"). Pure.
export function telescopeBlockView(candidate: Pick<ExpeditionCandidate, "telescope" | "foreknowledge">, level: number): TelescopeBlockView {
  const t = candidate.telescope;
  const regionText = `${candidateRegionText(t)} from your homeworld`;
  if (t.blind || t.risk === null) {
    return {
      blind: true,
      regionText,
      detail: 0,
      detailName: t.detailName,
      chipText: "Blind launch",
      liftText: null,
      rangeText:
        level > 0
          ? `Beyond the Subspace Telescope's range: Level ${level} reads ${ly(t.rangeLy)}; this system is ${ly(t.distanceLy)}.`
          : `The Subspace Telescope reads nothing yet; this system is ${ly(t.distanceLy)}.`,
      enemyTerritory: false,
      factors: [],
      bodies: null,
      demandText: null,
      nextNote: null,
      wantsLaunchView: false,
    };
  }
  const fkBodies = candidate.foreknowledge.bodies ?? [];
  const shipHazard = fkBodies.reduce<number | null>((m, b) => (b.hazard === null ? m : Math.max(m ?? 0, hazardGrade(b.hazard))), null);
  const contact = t.detail < TELESCOPE_DETAIL.graded;
  const factors: TelescopeFactorRow[] = RISK_FACTOR_ORDER.map((id) => {
    const f = t.risk!.factors[id];
    let grade = f.grade;
    if (id === "hazard" && shipHazard !== null) grade = Math.max(grade ?? 0, shipHazard) as RiskGrade;
    const label = RISK_FACTOR_NAMES[id];
    const present = f.present || (grade !== null && grade > 0);
    if (grade === null || (contact && id !== "hazard")) {
      const gradeName = present ? "Present" : "Not detected";
      return { id, label, glyph: RISK_FACTOR_GLYPHS[id], present, grade: null, gradeName, flavor: null, lit: 0, color: null, ariaLabel: `${label}: ${gradeName}` };
    }
    const gradeName = RISK_GRADE_NAMES[grade];
    const flavor = factorFlavor(id, grade);
    return {
      id,
      label,
      glyph: RISK_FACTOR_GLYPHS[id],
      present,
      grade,
      gradeName,
      flavor,
      lit: grade + 1,
      color: RISK_GRADE_COLORS[grade],
      ariaLabel: `${label}: ${gradeName}, ${flavor}`,
    };
  });
  const bodies =
    t.risk.bodies === null
      ? null
      : t.risk.bodies.map((b, i) => {
          const type = fkBodies[i]?.planetType ?? null;
          return {
            label: type ? `Body ${i + 1} · ${planetWord(type)}` : `Body ${i + 1}`,
            grades: RISK_FACTOR_ORDER.map((id) => ({ id, label: id === "combat" ? "Combat" : RISK_FACTOR_NAMES[id], gradeName: RISK_GRADE_NAMES[b[id]], grade: b[id] })),
          };
        });
  const nextNote =
    t.detail < TELESCOPE_DETAIL.graded
      ? "Each factor's grade appears at detail 2 (Graded)."
      : t.detail < TELESCOPE_DETAIL.perBody
        ? "Each body's grades and the objective demand appear at detail 3 (Per body)."
        : t.detail < TELESCOPE_DETAIL.recommendation
          ? "The squad recommendation appears at detail 4 (Recommendation)."
          : null;
  return {
    blind: false,
    regionText,
    detail: t.detail,
    detailName: t.detailName,
    chipText: `Detail ${t.detail} · ${t.detailName}`,
    liftText: t.shipLift ? "This ship's sensors lift the reading one level." : null,
    rangeText: null,
    enemyTerritory: t.risk.enemyTerritory === true,
    factors,
    bodies,
    demandText: t.demand ? `${taskDemandText(t.demand)}.` : null,
    nextNote,
    wantsLaunchView: t.detail >= TELESCOPE_DETAIL.recommendation,
  };
}

// A planet type's display label (the content catalog's), else its id. Pure.
function planetWord(id: string): string {
  return getPlanetTypeById(id)?.label ?? id;
}

// ===== The recommendation box (detail 4) and the forecast line (detail 5) =====

export interface CompositionActionView {
  label: string; // "Set composition: Strike + Ground"
  kinds: GroundTeamKind[];
  moves: string[]; // "Bravo changes from Ground to Strike.", "Sho moves to the reserve.", ...
  overCapacity: string | null; // the reserve would end up past its berths (allowed, said plainly)
}

export interface RecommendationView {
  headline: string;
  reason: string;
  currentText: string; // "Your ship: Ground + Ground"
  unfinishedText: string | null; // what the current mix would leave unfinished
  stillUnfinishedText: string | null;
  riskyFightsText: string | null;
  action: CompositionActionView | null; // null when nothing would change
  actionBlocked: string | null; // why the composition cannot be set now (e.g. the crew lock)
}

// The recommendation box for `shipId`. "Set composition" is offered when applyComposition would change something
// (a different mix, or confirming an open "Pick a type" prompt on a matching team), with who moves, from
// planComposition (groundTeams.ts). Pure.
export function recommendationView(state: GameState, shipId: string, rec: LaunchRecommendation): RecommendationView {
  const ship = state.ships.find((s) => s.id === shipId);
  const view: RecommendationView = {
    headline: rec.headline,
    reason: rec.reason,
    currentText: `Your ship: ${rec.currentLabel}`,
    unfinishedText: rec.unfinishedText,
    stillUnfinishedText: rec.stillUnfinishedText,
    riskyFightsText: rec.riskyFightsText,
    action: null,
    actionBlocked: null,
  };
  if (!ship) return view;
  const plan = planComposition(state, shipId, rec.kinds);
  if (!plan.ok) {
    // sameKind: the ship already fields it with no prompt open (nothing to do). Anything else is said plainly.
    if (plan.reason !== "sameKind" && !rec.isCurrent) view.actionBlocked = `${groundSlotBlockText(plan.reason)}.`;
    return view;
  }
  if (plan.changes.length === 0) return view;
  const nameOf = (id: string) => state.awayMembers.find((m) => m.id === id)?.name ?? id;
  const moves: string[] = [];
  for (const c of plan.changes) {
    const team = groundTeamName(ship, c.teamIndex);
    if (c.from === c.to) {
      moves.push(`${team} keeps ${teamKindName(c.to)} (confirms its type).`);
      continue;
    }
    moves.push(`${team} changes from ${teamKindName(c.from)} to ${teamKindName(c.to)}.`);
    const out = c.toReserve.map(nameOf);
    const into = c.fromReserve.map(nameOf);
    if (out.length > 0) moves.push(`${nameList(out)} ${out.length === 1 ? "moves" : "move"} to the reserve.`);
    if (into.length > 0) moves.push(`${nameList(into)} ${into.length === 1 ? "joins" : "join"} from the reserve.`);
  }
  const next = applyComposition(state, shipId, rec.kinds);
  const after = next.ships.find((s) => s.id === shipId);
  const room = after ? shipCrewRoom(next, after) : null;
  view.action = {
    label: rec.isCurrent ? `Confirm ${rec.label}` : `Set composition: ${rec.label}`,
    kinds: [...rec.kinds],
    moves,
    overCapacity:
      room !== null && room.berthsUsed > room.capacity.reserveBerths
        ? `The reserve will be over capacity: ${room.berthsUsed} members for ${room.capacity.reserveBerths} berths. Nobody has to leave; hiring pauses until it fits again.`
        : null,
  };
  return view;
}

export interface ForecastView {
  lead: string; // "Forecast with Strike + Ground"
  tasksText: string; // "11 objectives: 2 Simple, 6 Standard, 3 Challenging"
  unfinishedText: string | null; // "Leaves 2 objectives unfinished."
  hardestText: string | null; // "Hardest fight: Geothermal Chamber (Challenging, 3 fights), crew Alpha (Ground)"
  threat: ThreatAssessment | null;
  affixPills: AffixPillView[]; // the hardest fight's known affix (a Deadly combat objective: Reinforcing), else none
  note: string | null; // why there is no threat read
}

// The forecast line of `ship` for the recommended composition. The hardest task's crew is named by the ship's
// team names and the FORECAST composition's kinds (the plan sends by team index). Pure.
export function forecastView(ship: ShipInstance, f: LaunchForecast): ForecastView {
  const crew = f.hardest ? f.hardest.crew.map((i) => `${groundTeamName(ship, i)} (${teamKindName(f.kinds[i] ?? "ground")})`).join(" + ") : "";
  const fights = f.hardest ? `${f.hardest.fightPoints} ${f.hardest.fightPoints === 1 ? "fight" : "fights"}` : "";
  return {
    lead: `Forecast with ${f.label}`,
    tasksText: forecastTasksText(f),
    unfinishedText: f.unfinished > 0 ? `Leaves ${f.unfinished} ${f.unfinished === 1 ? "objective" : "objectives"} unfinished.` : null,
    hardestText: f.hardest ? `Hardest fight: ${f.hardest.label} (${f.hardest.difficultyName}, ${fights})${crew ? `, crew ${crew}` : ""}` : null,
    threat: f.threat,
    affixPills: forecastAffixPills(f.hardest),
    note: f.note,
  };
}

// ===== The blind launch confirm (user #7, verbatim intent) =====

export const BLIND_LAUNCH_TITLE = "Blind launch";
export const BLIND_LAUNCH_WARNING = "This is truly unknown territory. Are you sure you wish to go?";
export const BLIND_LAUNCH_DETAIL =
  "The system lies beyond the Subspace Telescope's range: no risk factors, no recommendation, and the ship's own sensors see nothing until it arrives.";

// ============================================================================
// The LAZY launch view: ask the engine again only when an input that shapes it changes
// ============================================================================

// The inputs the expanded card's launch view depends on, as a list compared entry by entry (Object.is). The big
// collections are compared BY REFERENCE: a tick replaces only what it changes (credits, inventory, captains), so
// the ship, its members, the gear, the officers, the notable crew, the museum and the facilities keep their
// identity from one tick to the next. The captain record is replaced every tick (its timers), so it enters as
// the fields the engine memo keys on (id, spec, secondary talents); which teams would deploy NOW enters as a
// string, since an injury running out changes it with no record changing. The engine memo
// (expedition.ts launchViewKey) still guards everything else; a stale view is display only. Pure.
export function launchViewInputs(
  state: GameState,
  shipId: string,
  candidate: Pick<ExpeditionCandidate, "seed" | "telescope">,
  deploys: readonly boolean[],
): unknown[] {
  const ship = state.ships.find((s) => s.id === shipId);
  const captain = ship && ship.assignedCaptainId !== null ? state.captains.find((c) => c.id === ship.assignedCaptainId) : undefined;
  return [
    shipId,
    candidate.seed,
    candidate.telescope.detail,
    ship,
    state.awayMembers,
    state.equipment,
    state.officers,
    state.notableCrew,
    state.relicMuseum,
    state.facilities,
    // GO-12 review minor: the fleet's talent unlocks BY REFERENCE (the review named `unlockedSkillNodes`, the retired
    // skill tree's field; GameState's live talent list is unlockedHomeworldTalents, replaced only on a purchase).
    state.unlockedHomeworldTalents,
    captain ? JSON.stringify([captain.id, captain.spec, captain.unlockedSecondaryTalents, captain.unlockedCaptainTalents]) : null,
    deploys.join(","),
  ];
}

// A one-entry cache: `get(inputs, compute)` returns the last value while every input is the same (Object.is),
// else computes, stores and returns a new one. `computes` counts the computations (the tests, and the dev
// preview's "opening a card computes the view once" check). Pure apart from its own slot.
export interface InputCache<T> {
  get(inputs: readonly unknown[], compute: () => T): T;
  computes(): number;
  clear(): void;
}

export function createInputCache<T>(): InputCache<T> {
  let last: { inputs: readonly unknown[]; value: T } | null = null;
  let count = 0;
  return {
    get(inputs, compute) {
      if (last && last.inputs.length === inputs.length && last.inputs.every((v, i) => Object.is(v, inputs[i]))) return last.value;
      count += 1;
      const value = compute();
      last = { inputs: [...inputs], value };
      return value;
    },
    computes: () => count,
    clear() {
      last = null;
    },
  };
}

// The expanded card's launch pieces, built from one engine launch view (the panel caches this whole object).
export interface ExpandedLaunchView {
  view: LaunchView;
  recommendation: RecommendationView | null;
  forecast: ForecastView | null;
}

// Build the expanded card's pieces from `read` (expedition.ts expeditionLaunchView, injected so the tests can
// count calls). Pure given a pure reader.
export function expandedLaunchView(
  state: GameState,
  shipId: string,
  candidate: Pick<ExpeditionCandidate, "seed" | "telescope">,
  read: (state: GameState, shipId: string, candidate: Pick<ExpeditionCandidate, "seed" | "telescope">) => LaunchView,
): ExpandedLaunchView {
  const view = read(state, shipId, candidate);
  const ship = state.ships.find((s) => s.id === shipId);
  return {
    view,
    recommendation: view.recommendation ? recommendationView(state, shipId, view.recommendation) : null,
    forecast: view.forecast && ship ? forecastView(ship, view.forecast) : null,
  };
}
