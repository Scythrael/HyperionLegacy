// expeditionConsoleDisplay.ts: the display decisions behind the Expedition Console's REGION PICKER, its candidate and
// resume cards, its launch bar and the RECALL confirm (0.14.0, Expedition Tiers G2-6).
//
// Built to the signed-off dispatch console mockup (https://claude.ai/artifact/AnWvt9kfqAUJo1sCMkTpMC, user 2026-10-21:
// "I approve all 4 mockups as is", every open question resolved as drawn; docs/plans/2026-10-19-merge-batch-answers.md
// "Mockup sign-off"):
//   - Tier I to VII tabs (Roman numerals), each with its state: Ready, or the FIRST unmet gate in plain words (explorer
//     hull, drive class, then frontier sensors); the small galaxy map is the alternative picker.
//   - A locked tier lists every gate, met or not, and a dimmed preview of its three nearest systems.
//   - Resumable systems sit at the top of their own region with a count on its tab; a recall BEFORE anything was
//     charted returns the system to the ordinary candidates (the engine appends it to its tier's list; the console sorts
//     it nearest first among them, an ordinary candidate again).
//   - Launch sits in a bar under the candidates; the Field Kits pack panel is unchanged (the bar links to it).
//   - The recall is ONE confirm (user G13): the return time, what stops, whether the system stays open; its safe
//     answer, Keep going, has the focus. No Overtime on expeditions: the confirm never offers a paid speed-up.
//
// WHY a .ts beside ExpeditionPanel.svelte: this repo has no Svelte component test harness, so every decision worth
// gating is a pure function here over the tested engine (expedition.ts, propulsion.ts, voyage.ts), and the component
// only draws it. No game rule lives here: every gate, time, reach and outcome is read from the engine.

import { SHIP_TYPES, type Expedition, type GameState, type RegionTier, type ShipInstance } from "./game/model";
import {
  TIER_BODY_COUNT,
  candidateReach,
  candidateVoyage,
  expeditionActivitiesDone,
  expeditionSystemGate,
  heldSystems,
  recallPreview,
  resumableSystems,
  tierCandidateSystems,
  type ExpeditionCandidate,
  type ResumableSystemView,
} from "./game/expedition";
import { DRIVE_CLASS_MAX, expeditionGateText, expeditionTierGates, shipDriveClass, type ExpeditionGateDetail, type ExpeditionTierGates } from "./game/propulsion";
import { REGION_TIERS, REGION_TIER_NAMES, regionTierNumeral, stateHomeworld, type HomeworldPlacement } from "./game/galaxy";
import { TELESCOPE_DETAIL_NAMES, telescopeLevel, telescopeReading } from "./game/telescope";
import { TRAINING_EXPEDITION_LINE } from "./trainingRunDisplay";
import { VOYAGE_BAND_SCALE_PERMILLE, tierNominalSeconds } from "./game/voyage";
import { TIER_HAUL_MULT } from "./game/riskFactors";
import { runDifficultyAt } from "./game/runDifficulty";
import { famousSystem, bodyLetter } from "./game/starCatalog";
import { formatCountdown } from "./game/format";
import { telescopeMapRingRadius, telescopeMapView } from "./telescopeCardDisplay";
import { RISK_FACTOR_GLYPHS, RISK_FACTOR_ORDER, telescopeBlockView } from "./expeditionDispatchDisplay";
import type { IconName } from "./ui/icons";

const lyNum = (n: number): string => Math.round(n).toLocaleString("en-US");
const classText = (n: number): string => `Class ${regionTierNumeral(Math.max(1, Math.min(DRIVE_CLASS_MAX, Math.floor(n))) as RegionTier)}`;
const tierLabel = (tier: RegionTier): string => `Tier ${regionTierNumeral(tier)} · ${REGION_TIER_NAMES[tier]}`;

// A voyage span for the console ("1h 52m", "12h", "7d" for whole days past two days): formatCountdown, with the
// multi-day legs of Tiers VI and VII in days so "168h" reads as the week it is. Pure.
export function voyageSpanText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 48 * 3_600) {
    const days = Math.floor(s / 86_400);
    const hours = Math.round((s - days * 86_400) / 3_600);
    return hours === 0 ? `${days}d` : hours === 24 ? `${days + 1}d` : `${days}d ${hours}h`;
  }
  return formatCountdown(s);
}

// ============================================================================
// The ship line (the console header): drive class and deep-space reach
// ============================================================================

// The reach the console names for a tier (the header, the locked panel and the map ring): the ship's reach on the
// voyage to the MIDDLE of the tier's band. The gate checks each system's own voyage (candidateReach); the Engineering
// long-haul ramp moves it only slightly inside a band. Pure.
export function tierReachLy(state: GameState, ship: ShipInstance, tier: RegionTier, homeworld: HomeworldPlacement = stateHomeworld(state)): number {
  const band = homeworld.regionBandsLy[tier] ?? homeworld.regionBandsLy[1];
  return candidateReach(state, ship, { tier, distanceLy: Math.round((band.near + band.far) / 2) }, homeworld).reachLy;
}

export interface ShipPropulsionView {
  driveClass: number;
  driveText: string; // "Class II drive"
  reachLy: number;
  reachText: string; // "Reach 5,280 ly round trip"
  homeworldText: string; // "Homeworld: 62 ly from Sol, in the Local Bubble"
}

// The header's propulsion line for `ship` at the picked tier. Pure.
export function shipPropulsionView(state: GameState, ship: ShipInstance, tier: RegionTier): ShipPropulsionView {
  const home = stateHomeworld(state);
  const driveClass = shipDriveClass(state, ship);
  const reachLy = tierReachLy(state, ship, tier, home);
  const fromSol = Math.round(home.distanceFromSolLy);
  return {
    driveClass,
    driveText: `${classText(driveClass)} drive`,
    reachLy,
    reachText: `Reach ${lyNum(reachLy)} ly round trip`,
    homeworldText: fromSol > 0 ? `Homeworld: ${lyNum(fromSol)} ly from Sol, in the ${REGION_TIER_NAMES[1]}` : `Homeworld: Sol, in the ${REGION_TIER_NAMES[1]}`,
  };
}

// ============================================================================
// The region tabs
// ============================================================================

// A tab's short state when a gate is unmet (the full line, expeditionGateText, is on the opened tab). EXHAUSTIVE. The
// mockup drew the drive, "No Class V drive yet" and sensors forms; the explorer and reach forms are [PROPOSAL] wording.
export function tierGateShortText(d: ExpeditionGateDetail): string {
  switch (d.reason) {
    case "notExplorer":
      return "Needs an explorer hull";
    case "driveClassUnavailable":
      return `No ${classText(d.driveClassNeeded)} drive yet`;
    case "driveClassTooLow":
      return `Needs a ${classText(d.driveClassNeeded)} drive`;
    case "frontierSensors":
      return `Needs sensors ${d.sensorsNeeded}`;
    case "outOfReach":
      return "Beyond this ship's reach";
  }
}

export interface RegionTabView {
  tier: RegionTier;
  numeral: string; // "II"
  name: string; // "Orion Arm"
  label: string; // "Tier II · Orion Arm"
  ready: boolean;
  stateText: string; // "Ready" / "Needs a Class III drive"
  resumeCount: number; // resumable systems held in this region
  gates: ExpeditionTierGates;
  ariaLabel: string; // "Tier II, Orion Arm: Ready, 1 to resume"
}

// The seven tabs for `ship`, Tier I to VII. Pure.
export function regionTabsView(state: GameState, ship: ShipInstance): RegionTabView[] {
  return REGION_TIERS.map((tier) => {
    const gates = expeditionTierGates(state, ship, tier);
    const ready = gates.first === null;
    const stateText = ready ? "Ready" : tierGateShortText(gates.first!);
    const resumeCount = resumableSystems(state, tier).length;
    const numeral = regionTierNumeral(tier);
    const name = REGION_TIER_NAMES[tier];
    return {
      tier,
      numeral,
      name,
      label: tierLabel(tier),
      ready,
      stateText,
      resumeCount,
      gates,
      ariaLabel: `Tier ${numeral}, ${name}: ${stateText}${resumeCount > 0 ? `, ${resumeCount} to resume` : ""}`,
    };
  });
}

// The next tab for an arrow key (the tab row wraps, like the mockup). Pure.
export function nextTier(tier: RegionTier, key: string): RegionTier | null {
  const i = REGION_TIERS.indexOf(tier);
  if (key === "ArrowRight" || key === "ArrowDown") return REGION_TIERS[(i + 1) % REGION_TIERS.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return REGION_TIERS[(i + REGION_TIERS.length - 1) % REGION_TIERS.length];
  if (key === "Home") return REGION_TIERS[0];
  if (key === "End") return REGION_TIERS[REGION_TIERS.length - 1];
  return null;
}

// The zero-click path (signed-off mockup: "the console opens on the region you last launched to"): the remembered tier
// when this ship can attempt it, else the deepest Ready tier below it, else Tier I [PROPOSAL fallback; the remembered
// tier is a per-viewer preference, expeditionConsolePreference.ts]. Pure.
export function consoleDefaultTier(tabs: readonly Pick<RegionTabView, "tier" | "ready">[], remembered: RegionTier | null): RegionTier {
  const want = remembered ?? 1;
  const ready = tabs.filter((t) => t.ready && t.tier <= want).map((t) => t.tier);
  return ready.length > 0 ? ready[ready.length - 1] : 1;
}

// ============================================================================
// The tier facts (the chips under the tabs)
// ============================================================================

export interface TierFactsView {
  bandText: string; // "212 to 3,062 ly from your homeworld"
  timeText: string; // "About 4h one way at Class II, 3h 12m to 4h 48m by distance"
  bodiesText: string; // "1 to 3 bodies"
  haulText: string; // "Haul x1.25"
  telescopeText: string; // "Telescope: Graded" / "Telescope: beyond range"
  telescopeReads: boolean;
}

// The chips of `tier`, measured from the save's homeworld. Pure.
export function tierFactsView(state: GameState, tier: RegionTier): TierFactsView {
  const home = stateHomeworld(state);
  const band = home.regionBandsLy[tier];
  const shared = REGION_TIERS.filter((t) => t !== tier && home.regionBandsLy[t].near === band.near && home.regionBandsLy[t].far === band.far);
  const sharedText = shared.length > 0 ? ` (shared with ${shared.map((t) => regionTierNumeral(t)).join(", ")})` : "";
  const nominal = tierNominalSeconds(tier);
  const near = (nominal * VOYAGE_BAND_SCALE_PERMILLE.near) / 1_000;
  const far = (nominal * VOYAGE_BAND_SCALE_PERMILLE.far) / 1_000;
  const [bMin, bMax] = TIER_BODY_COUNT[tier];
  const reading = telescopeReading(state, home);
  const reads = reading.reachTier > 0 && band.far <= reading.rangeLy;
  return {
    bandText: `${lyNum(band.near)} to ${lyNum(band.far)} ly from your homeworld${sharedText}`,
    timeText: `About ${voyageSpanText(nominal)} one way at ${classText(tier)}, ${voyageSpanText(near)} to ${voyageSpanText(far)} by distance`,
    bodiesText: bMin === bMax ? `${bMin} ${bMin === 1 ? "body" : "bodies"}` : `${bMin} to ${bMax} bodies`,
    haulText: `Haul x${TIER_HAUL_MULT[tier]}`,
    telescopeText: reads ? `Telescope: ${TELESCOPE_DETAIL_NAMES[reading.detail]}` : "Telescope: beyond range",
    telescopeReads: reads,
  };
}

// ============================================================================
// A locked tier: every gate, met or not, and the dimmed preview
// ============================================================================

export interface LockedGateRow {
  key: "explorer" | "drive" | "sensors" | "reach" | "telescope";
  status: "met" | "unmet" | "info";
  glyph: IconName;
  title: string;
  detail: string;
}

export interface LockedTierView {
  heading: string; // "What Tier III needs"
  reasonText: string; // the first unmet gate's full line (propulsion.ts expeditionGateText)
  rows: LockedGateRow[];
  peekHeading: string;
  peek: { name: string; distanceText: string }[]; // the three nearest systems, nearest first (not selectable)
  peekNote: string;
}

// What `ship` needs for a locked `tier` (the mockup's locked panel). Pure.
export function lockedTierView(state: GameState, ship: ShipInstance, tier: RegionTier, gates: ExpeditionTierGates): LockedTierView {
  const home = stateHomeworld(state);
  const numeral = regionTierNumeral(tier);
  const region = REGION_TIER_NAMES[tier];
  const rows: LockedGateRow[] = [];
  if (!gates.explorer) {
    rows.push({
      key: "explorer",
      status: "unmet",
      glyph: "ship",
      title: "An explorer hull",
      detail: `This hull (${SHIP_TYPES[ship.typeKey]?.label ?? ship.typeKey}) cannot reach any expedition system.`,
    });
  }
  rows.push({
    key: "drive",
    status: gates.driveMet ? "met" : "unmet",
    glyph: gates.driveMet ? "check" : "lock",
    title: `${classText(gates.driveClassNeeded)} drive or better`,
    detail: gates.driveBuildable
      ? `This ship has ${classText(gates.driveClass)}. A higher tier hull or a better FTL drive raises the class: install it in the ship's FTL Drive slot.`
      : `This ship has ${classText(gates.driveClass)}. None can be built yet.`,
  });
  rows.push({
    key: "sensors",
    status: gates.sensorsMet ? "met" : "unmet",
    glyph: gates.sensorsMet ? "check" : "lock",
    title: gates.sensorsNeeded > 0 ? `Sensors ${gates.sensorsNeeded} to chart the ${region}` : "No sensor minimum",
    detail: `This ship reads ${Math.floor(gates.sensors)}. Its hull and Sensor Suite set it, and Science crew and a Science officer raise it.`,
  });
  rows.push({
    key: "reach",
    status: "info",
    glyph: "reach",
    title: "Reach, checked per system",
    detail: `Now ${lyNum(tierReachLy(state, ship, tier, home))} ly round trip. A higher drive class multiplies it; Engineering lifts it on long voyages.`,
  });
  const facts = tierFactsView(state, tier);
  rows.push(
    facts.telescopeReads
      ? { key: "telescope", status: "info", glyph: "telescope", title: "Your telescope reads this region", detail: `${facts.telescopeText}.` }
      : { key: "telescope", status: "info", glyph: "telescope", title: "Beyond your telescope today", detail: "A launch here goes blind and asks you to confirm first." },
  );
  const peek = [...tierCandidateSystems(state, tier, home)]
    .sort((a, b) => a.distanceLy - b.distanceLy || a.slot - b.slot)
    .map((c) => ({ name: c.systemName, distanceText: `${lyNum(c.distanceLy)} ly` }));
  return {
    heading: `What Tier ${numeral} needs`,
    reasonText: gates.first ? expeditionGateText(gates.first) : "",
    rows,
    peekHeading: `${peek.length === 3 ? "Three nearest" : "Nearest"} systems waiting here`,
    peek,
    peekNote: "A preview only. They become candidates once this ship meets the gates.",
  };
}

// ============================================================================
// A candidate card (a Ready tier)
// ============================================================================

export interface ReachBarView {
  roundTripLy: number;
  reachLy: number;
  met: boolean;
  fillPercent: number; // the round trip's share of the reach (100 when over)
  markPercent: number | null; // over: where the reach ends on the bar
  text: string; // "194 ly round trip of 5,280 ly reach"
}

export interface CandidateCardView {
  id: string;
  realStar: boolean;
  enemyTerritory: boolean; // only when the telescope reads it (a blind card says nothing)
  trainingRun: boolean;
  outboundSeconds: number;
  transitText: string; // "Out 1h 52m · back 1h 42m"
  reach: ReachBarView;
  gatesText: { drive: string; sensors: string; driveMet: boolean; sensorsMet: boolean };
  // The telescope's graded factors; `gradeText` adds the mockup's "(+1)" to Combat in known enemy territory.
  risk: { id: string; glyph: IconName; label: string; gradeName: string; gradeText: string; high: boolean }[] | null;
  gate: ExpeditionGateDetail | null; // the first propulsion refusal (Launch is off on it)
  reasonText: string | null; // its full line
  launchable: boolean;
}

// Is this ship's next expedition its training run (Safe first runs SF-2: the first run of the hull type at Tier I)? The
// same stamp startExpedition freezes (runDifficulty.ts runDifficultyAt). Pure.
export function isTrainingDispatch(state: GameState, ship: ShipInstance, tier: RegionTier): boolean {
  return runDifficultyAt(state, "expedition", tier, ship.typeKey).firstRun;
}

function reachBar(roundTripLy: number, reachLy: number): ReachBarView {
  const met = reachLy >= roundTripLy;
  const share = reachLy > 0 ? roundTripLy / reachLy : 1;
  return {
    roundTripLy,
    reachLy,
    met,
    fillPercent: met ? Math.max(0, Math.min(100, Math.round(share * 100))) : 100,
    markPercent: met ? null : Math.max(0, Math.min(100, Math.round((reachLy / Math.max(1, roundTripLy)) * 100))),
    text: `${lyNum(roundTripLy)} ly round trip of ${lyNum(reachLy)} ly reach`,
  };
}

// The card rows of one offered candidate for `ship`: its transit at this ship's drive (exactly what a launch would
// fly, expedition.ts candidateVoyage), the reach check (candidateReach, the gate's own reader), the tier's gates and the
// telescope's graded risk. `level` is the telescope level (the block view's blind range line). Pure.
export function candidateCardView(state: GameState, ship: ShipInstance, cand: ExpeditionCandidate, level: number = telescopeLevel(state)): CandidateCardView {
  const home = stateHomeworld(state);
  const sys = { tier: cand.region.tier, distanceLy: cand.telescope.distanceLy };
  const training = isTrainingDispatch(state, ship, sys.tier);
  const voyage = candidateVoyage(state, ship, sys, training, home);
  const reach = candidateReach(state, ship, sys, home);
  const gates = expeditionTierGates(state, ship, sys.tier);
  const gate = expeditionSystemGate(state, ship, sys, home);
  const block = telescopeBlockView(cand, level);
  const risk = block.blind
    ? null
    : RISK_FACTOR_ORDER.map((id) => {
        const f = block.factors.find((x) => x.id === id)!;
        const plusOne = id === "combat" && block.enemyTerritory && f.grade !== null;
        return { id, glyph: RISK_FACTOR_GLYPHS[id], label: f.label, gradeName: f.gradeName, gradeText: plusOne ? `${f.gradeName} (+1)` : f.gradeName, high: f.grade !== null && f.grade >= 3 };
      });
  return {
    id: cand.id,
    realStar: famousSystem(cand.systemId) !== undefined,
    enemyTerritory: !block.blind && block.enemyTerritory,
    trainingRun: training,
    outboundSeconds: voyage.outboundSeconds,
    transitText: `Out ${voyageSpanText(voyage.outboundSeconds)} · back ${voyageSpanText(voyage.returnSeconds)}`,
    reach: reachBar(reach.roundTripLy, reach.reachLy),
    gatesText: {
      drive: `${classText(gates.driveClass)} drive${gates.driveMet ? "" : `, needs ${classText(gates.driveClassNeeded)}`}`,
      sensors: gates.sensorsNeeded > 0 ? `Sensors ${Math.floor(gates.sensors)} of ${gates.sensorsNeeded}` : "No sensor minimum",
      driveMet: gates.driveMet,
      sensorsMet: gates.sensorsMet,
    },
    risk,
    gate,
    reasonText: gate ? expeditionGateText(gate) : null,
    launchable: gate === null,
  };
}

// The candidate the console preselects (the zero-click path): the nearest this ship can launch to, else the nearest.
// `cards` in screen order (nearest first). Pure.
export function preselectCandidateId(cards: readonly Pick<CandidateCardView, "id" | "launchable">[]): string | null {
  return (cards.find((c) => c.launchable) ?? cards[0])?.id ?? null;
}

// The heading over the ordinary candidates ("Three nearest systems"; with a system a recall returned among them, sorted
// by distance like the rest, "Nearest systems").
export function candidatesHeading(count: number): string {
  return count === 3 ? "Three nearest systems" : "Nearest systems";
}

// ============================================================================
// A resume card (user G12)
// ============================================================================

export interface ResumeCardView {
  id: string; // "held-<expeditionId>": the id a launch passes to startExpedition
  name: string;
  realStar: boolean;
  whereText: string; // "Tier II · Orion Arm · 400 ly from your homeworld"
  percent: number; // charted, whole percent
  chartedText: string; // "62% · 2 of 3 bodies scanned, the next scan picks up at body d"
  objectivesText: string; // "3 keep their progress"
  transitText: string;
  outboundSeconds: number;
  gate: ExpeditionGateDetail | null;
  reasonText: string | null;
  launchable: boolean;
  abandonLabel: string; // "Abandon Polaris"
  abandonConfirm: string;
}

// The resume cards of `tier` for `ship` (oldest first). Pure.
export function resumeCardsView(state: GameState, ship: ShipInstance, tier: RegionTier): ResumeCardView[] {
  const home = stateHomeworld(state);
  return resumableSystems(state, tier).map((r: ResumableSystemView) => {
    const held = heldSystems(state).find((h) => h.id === r.id);
    const sys = { tier: r.tier, distanceLy: r.distanceLy };
    const voyage = candidateVoyage(state, ship, sys, false, home);
    const gate = expeditionSystemGate(state, ship, sys, home);
    const percent = Math.round(Math.max(0, Math.min(1, r.progress)) * 100);
    const next = r.bodiesScanned < r.bodies ? `, the next scan picks up at body ${bodyLetter(r.bodiesScanned)}` : ", every body is scanned";
    return {
      id: r.id,
      name: r.systemName,
      realStar: held?.famousId != null,
      whereText: `${tierLabel(r.tier)} · ${lyNum(r.distanceLy)} ly from your homeworld`,
      percent,
      chartedText: `${percent}% · ${r.bodiesScanned} of ${r.bodies} ${r.bodies === 1 ? "body" : "bodies"} scanned${next}`,
      objectivesText: r.objectivesInProgress === 0 ? "None under way" : `${r.objectivesInProgress} keep${r.objectivesInProgress === 1 ? "s" : ""} their progress`,
      transitText: `Out ${voyageSpanText(voyage.outboundSeconds)} · back ${voyageSpanText(voyage.returnSeconds)}`,
      outboundSeconds: voyage.outboundSeconds,
      gate,
      reasonText: gate ? expeditionGateText(gate) : null,
      launchable: gate === null,
      abandonLabel: `Abandon ${r.systemName}`,
      abandonConfirm: `Abandon ${r.systemName}? Its saved progress is let go; findings you claimed stay yours.`,
    };
  });
}

// ============================================================================
// The launch bar
// ============================================================================

export interface LaunchBarView {
  resume: boolean;
  selectedText: string; // "Selected: LB-0472 · out 1h 52m" / "Resume: Polaris · out 3h 10m"
  buttonText: string; // "Launch" / "Resume"
}

export function launchBarView(selected: { name: string; outboundSeconds: number; resume: boolean } | null): LaunchBarView {
  if (!selected) return { resume: false, selectedText: "Select a target system", buttonText: "Launch" };
  return {
    resume: selected.resume,
    selectedText: `${selected.resume ? "Resume" : "Selected"}: ${selected.name} · out ${voyageSpanText(selected.outboundSeconds)}`,
    buttonText: selected.resume ? "Resume" : "Launch",
  };
}

// The training run note on Tier I (the mockup's first explorer expedition). Safe first runs SF-6: it leads with the
// chip's approved line (user 2026-10-27, call 12), then what the run flies. Pure.
export function trainingRunNote(state: Pick<GameState, "nextExpeditionId">, shipName: string): string {
  const first = Math.floor(state.nextExpeditionId ?? 1) <= 1;
  return `${TRAINING_EXPEDITION_LINE} ${shipName}'s training run flies the same trip an ordinary run to that system would.${first ? " Wolf 359 appears in the first Tier I list after this run." : ""}`;
}

// ============================================================================
// The region map (the alternative picker)
// ============================================================================

export interface RegionMapBadge {
  tier: RegionTier;
  numeral: string;
  x: number;
  y: number;
  locked: boolean;
  selected: boolean;
  ariaLabel: string;
}

export interface RegionMapView {
  viewBox: string;
  home: { x: number; y: number };
  core: { x: number; y: number };
  diskPath: string;
  armPaths: string[];
  bulgePath: string;
  reachR: number; // this ship's reach (one way: half the round trip), on the map's scale
  badgeR: number;
  badges: RegionMapBadge[];
  homeLabel: { x: number; y: number; text: string };
  coreLabel: { x: number; y: number; text: string };
  ariaLabel: string;
  legend: string;
}

// The small galaxy map (the approved Subspace Telescope map look, telescopeCardDisplay.ts telescopeMapView): the
// region badges as buttons (locked ones dashed), the picked one ringed, and a solid ring for this ship's reach at the
// picked tier. Pure.
export function regionMapView(state: GameState, ship: ShipInstance, tabs: readonly RegionTabView[], selected: RegionTier): RegionMapView {
  const home = stateHomeworld(state);
  const map = telescopeMapView(telescopeLevel(state), home);
  const reachLy = tierReachLy(state, ship, selected, home);
  const byTier = new Map(tabs.map((t) => [t.tier, t]));
  return {
    viewBox: map.viewBox,
    home: map.home,
    core: map.core,
    diskPath: map.diskPath,
    armPaths: map.armPaths,
    bulgePath: map.bulgePath,
    reachR: telescopeMapRingRadius(home, reachLy / 2),
    badgeR: map.badgeR,
    badges: map.badges.map((b) => {
      const tab = byTier.get(b.tier);
      const locked = tab ? !tab.ready : true;
      return {
        tier: b.tier,
        numeral: b.numeral,
        x: b.x,
        y: b.y,
        locked,
        selected: b.tier === selected,
        ariaLabel: tab?.ariaLabel ?? `Tier ${b.numeral}, ${b.name}`,
      };
    }),
    homeLabel: { x: map.homeLabel.x, y: map.homeLabel.y, text: "Your homeworld" },
    coreLabel: { x: map.coreLabel.x, y: map.coreLabel.y, text: map.coreLabel.text },
    ariaLabel: `Galaxy map centered on your homeworld: regions I to VII as buttons, this ship's reach as a ring. Not to scale.`,
    legend: "Solid ring: this ship's reach. Dashed badges: locked tiers. Pick a badge to open its region.",
  };
}

// ============================================================================
// Recall (user #7 "1:1", G13 one confirm, G14 the detour is not distance flown)
// ============================================================================

export interface RecallConfirmView {
  title: string; // "Recall Aurora?"
  line: string;
  stops: string[];
  keepText: string;
  recallText: string;
}

// The one confirm for recalling `exp` now (the engine's recallPreview: exactly what the recall would freeze), or null
// when it cannot be recalled. The mockup drew the transit and surface lines; the pre-arrival "back to the candidates"
// line (the sign-off's ruling) and the "does not stay open" line are [PROPOSAL] wording. Pure.
export function recallConfirmView(state: GameState, exp: Expedition, shipName: string): RecallConfirmView | null {
  const r = recallPreview(state, exp.id);
  if (!r.ok) return null;
  const p = r.preview;
  const sys = exp.systemName;
  const tier = exp.region?.tier;
  const stops: string[] = [];
  let line: string;
  if (p.phase === "transit") {
    line = `It flies home in ${voyageSpanText(p.returnSeconds)}, the distance it has covered so far.`;
    stops.push("Nothing has been charted yet.");
    if (p.held === "candidate" && tier !== undefined) stops.push(`${sys} goes back to the Tier ${regionTierNumeral(tier)} candidates: launch to it again any time.`);
    else stops.push(`${sys} does not stay open to resume.`);
  } else {
    const leg = Math.max(0, p.returnSeconds - p.pickupSeconds);
    line =
      p.pickupSeconds > 0
        ? `Teams come up first (${voyageSpanText(p.pickupSeconds)} pickup), then it flies home in ${voyageSpanText(leg)}, the full trip out.`
        : `It flies home in ${voyageSpanText(p.returnSeconds)}, the full trip out.`;
    // Arrived but nothing charted yet (the first scan under way): no objective is in progress to stop.
    const charted = p.held === "resume" || exp.bodies.some((b) => b.scanned);
    if (charted) {
      stops.push("Objectives in progress stop and keep their progress; finished work comes home.");
      if (exp.groundOps) stops.push("The medical bay treats the injured on the way.");
    } else stops.push("Nothing has been charted yet.");
    if (p.held === "resume") stops.push(`${sys} stays open: any explorer can resume it and pick up where you left off (finished scans stay done, the trip is flown again).`);
    else if (p.held === "candidate" && tier !== undefined) stops.push(`${sys} goes back to the Tier ${regionTierNumeral(tier)} candidates.`);
    else stops.push(`${sys} does not stay open to resume.`);
  }
  return { title: `Recall ${shipName}?`, line, stops, keepText: "Keep going", recallText: "Recall home" };
}

export type RecalledStepState = "done" | "cut" | "recalled";

// The phase stepper of a RECALLED run (the mockup's frame C): the phases flown before the recall are done, the phase
// it turned in and the ones it skipped are cut, and the Return step reads "Recalled". Null for a run never recalled.
// Pure.
export function recalledStepperView(exp: Pick<Expedition, "recall" | "phase" | "phaseAnchorSeconds">, now: number): { steps: RecalledStepState[]; returnText: string } | null {
  const rc = exp.recall;
  if (!rc) return null;
  const order = ["transit", "scanning", "activities"] as const;
  const at = order.indexOf(rc.phaseAtRecall);
  const steps: RecalledStepState[] = order.map((_, i) => (rc.phaseAtRecall === "transit" ? "cut" : i < at ? "done" : "cut"));
  steps.push("recalled");
  const left = exp.phaseAnchorSeconds + rc.returnSeconds - now;
  const returnText = exp.phase === "complete" ? "Recalled · home" : `Recalled · home in ${voyageSpanText(Math.max(0, left))}`;
  return { steps, returnText };
}

export interface RecallClaimView {
  heading: string; // "Home from Polaris (recalled)"
  text: string;
  resumeChip: string | null; // "In Resume: Tier II"
}

// The claim card's recall lines for a recalled run home (null otherwise): the mockup's "Haul from 4 finished objectives
// and the scan finds so far. Polaris saved to Resume at 62%." Pure.
export function recallClaimView(state: Pick<GameState, "heldSystems">, exp: Expedition): RecallClaimView | null {
  const rc = exp.recall;
  if (!rc || exp.phase !== "complete") return null;
  const done = expeditionActivitiesDone(exp);
  const found =
    done > 0
      ? `Haul from ${done} finished ${done === 1 ? "objective" : "objectives"} and the scan finds so far.`
      : exp.findings.length > 0
        ? "The scan finds so far."
        : "No findings yet.";
  const held = rc.held ? heldSystems(state).find((h) => h.id === rc.held) : undefined;
  const tierText = held ? `Tier ${regionTierNumeral(held.region.tier)}` : "";
  if (held?.kind === "resume") {
    const view = resumableSystems(state).find((r) => r.id === held.id);
    const pct = Math.round(Math.max(0, Math.min(1, view?.progress ?? 0)) * 100);
    return { heading: `Home from ${exp.systemName} (recalled)`, text: `${found} ${exp.systemName} saved to Resume at ${pct}%.`, resumeChip: `In Resume: ${tierText}` };
  }
  if (held?.kind === "candidate") return { heading: `Home from ${exp.systemName} (recalled)`, text: `${found} ${exp.systemName} is a ${tierText} candidate again.`, resumeChip: null };
  return { heading: `Home from ${exp.systemName} (recalled)`, text: found, resumeChip: null };
}
