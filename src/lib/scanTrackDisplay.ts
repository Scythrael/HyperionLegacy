// scanTrackDisplay.ts: the display decisions of the per-body SCAN TRACK (0.14.0, Ground Operations GO-15, the EC-M
// section 5 layout): a rail filled to the body's scanned share, one PIP per recorded scan event at its step boundary
// (step / encounterSteps of the scan), each with its outcome and the pause it cost, a log line in plain words per
// event, and the key row of the kinds a run shows.
//
// WHAT A PIP CAN BE:
//   - a flagged run with ship events (GO-8, user 9b.6): debris field, hostile probe, sensor ghost, cloaked vessel,
//     radiation storm; a probe or cloaked vessel whose boarders got aboard (GO-9) takes the `boarding` glyph;
//   - any run with scan steps: a supply cache (the step roll's small find);
//   - a LEGACY run (no groundOps; Wiring OC-G1 finishes one at load, so only an old save's run awaiting its claim): its
//     stored ground battles (Task 14), in words (their re-derived round log went with the legacy resolver).
//
// WHY a .ts beside the panel: this repo has no Svelte component test harness, so every choice worth gating (which
// glyph, which outcome words, which tone, what the log line says) lives here as pure functions over the stored run,
// and the component only draws them. Color is never the only signal: the outcome is in the pip's accessible name and
// title, a costly outcome also draws a dashed ring, and the log lines say everything in words.
//
// DISPLAY ONLY. Reads Expedition.scanEvents and the findings they point at; nothing here changes a rule.

import type { Expedition, ExpeditionFinding, ExpeditionScanEvent, ShipScanEventKind } from "./game/model";
import { ITEMS } from "./game/model";
import { BOARDING_PAUSE_SECONDS } from "./game/shipScanEvents";
import { groundSiteLabel, poisForPlanetType } from "./game/expeditionContent";
import { spanText } from "./groundOpsTimelineDisplay";
import { isStudyBody } from "./game/gasGiantStudy";
import type { IconName } from "./ui/icons";

// The parts of a run the track reads.
// GG-6: `study` too (a study run's orbital body takes no ground find, so a sensor ghost read true there adds none).
export type ScanTrackRun = Pick<Expedition, "encounterSteps" | "scanEvents" | "findings" | "bodies" | "groundOps"> & Partial<Pick<Expedition, "study">>;

// good: nothing lost (a pass, a win, a find); bad: it cost scan time, hull or credits.
export type ScanPipTone = "good" | "bad";

export interface ScanPipView {
  key: string;
  step: number;
  posPct: number; // where on the rail (step / encounterSteps)
  atText: string; // "30%": the log line's position column
  glyph: IconName;
  tone: ScanPipTone;
  name: string; // "Hostile probe"
  outcome: string; // "Won", "Steered clear", "Lost, boarded"
  pauseText: string | null; // "Scan paused 5m"
  sentence: string; // the log line
  ariaLabel: string; // "At 30% of the scan: Debris field, Hit. <sentence>"
  title: string; // the pip's tooltip: "30%: Debris field, Hit. Scan paused 2m" (outcome and pause)
}

export interface ScanTrackView {
  scannedPct: number;
  pips: ScanPipView[];
  ariaLabel: string;
  emptyText: string | null;
}

// ===== Words =====

const SHIP_EVENT_NAMES: Record<ShipScanEventKind, string> = {
  debris: "Debris field",
  probe: "Hostile probe",
  ghost: "Sensor ghost",
  cloaked: "Cloaked vessel",
  storm: "Radiation storm",
};
const SHIP_EVENT_GLYPHS: Record<ShipScanEventKind, IconName> = {
  debris: "shipDebris",
  probe: "shipProbe",
  ghost: "sensorGhost",
  cloaked: "cloakedVessel",
  storm: "radiationStorm",
};
const CACHE_NAME = "Supply cache";
const BATTLE_NAME = "Ground battle";
const BOARDING_NAME = "Boarding";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// What a finding held, in words ("Titanium Ore x3, 20 credits"); null when it holds nothing or is gone. Pure.
export function findingContentsText(finding: ExpeditionFinding | undefined): string | null {
  if (!finding) return null;
  const parts = Object.entries(finding.materials ?? {})
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${ITEMS[id]?.label ?? id} x${qty}`);
  if ((finding.credits ?? 0) > 0) parts.push(`${finding.credits} credits`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function findingOf(run: ScanTrackRun, event: ExpeditionScanEvent): ExpeditionFinding | undefined {
  return event.findingId === undefined ? undefined : run.findings.find((f) => f.id === event.findingId);
}

// GO-15 review: boarders who got aboard take their credits from the run's finds IN PLACE, newest first, their own
// salvage included, and stop once the take is covered (shipScanEvents.ts takeBoardingLoss), so a find they reached now
// reads as they left it. The original cannot be rebuilt with certainty, so the words say "after boarders" instead of
// guessing, but ONLY for a find the take could have reached: credits only go down, so boarding B reached find F only
// if every find newer than F that existed when B struck (up to and including B's own salvage, or, with no salvage, up
// to the newest find of an event at or before B) holds 0 credits now. A find with no credits field never held any
// (boarders take credits only), so it is never labeled. Ambiguous zero cases stay labeled. Pure.
function boardersMayHaveReached(run: ScanTrackRun, event: ExpeditionScanEvent): boolean {
  const findings = run.findings;
  const at = event.findingId === undefined ? -1 : findings.findIndex((f) => f.id === event.findingId);
  if (at < 0 || findings[at].credits === undefined) return false;
  const events = run.scanEvents ?? [];
  const indexOf = (ev: ExpeditionScanEvent): number => (ev.findingId === undefined ? -1 : findings.findIndex((f) => f.id === ev.findingId));
  const atOrBefore = (x: ExpeditionScanEvent, y: ExpeditionScanEvent): boolean => x.bodyIndex < y.bodyIndex || (x.bodyIndex === y.bodyIndex && x.step <= y.step);
  return events.some((boarding) => {
    if (!((boarding.boarding?.creditsLost ?? 0) > 0) || !atOrBefore(event, boarding)) return false;
    const own = indexOf(boarding);
    const bound = own >= 0 ? own : Math.max(-1, ...events.filter((ev) => atOrBefore(ev, boarding)).map(indexOf));
    if (bound < at) return false;
    for (let i = at + 1; i <= bound; i++) if ((findings[i].credits ?? 0) > 0) return false;
    return true;
  });
}

// A find's contents with its label ("Salvage: ..." / "Salvage (after boarders): ..."); `emptied` when boarders took
// everything it held; null when there is nothing to say. Pure.
function findWords(run: ScanTrackRun, event: ExpeditionScanEvent, label: string): { text: string } | { emptied: true } | null {
  const finding = findingOf(run, event);
  if (!finding) return null;
  const after = boardersMayHaveReached(run, event);
  const held = findingContentsText(finding);
  if (held === null) return after ? { emptied: true } : null;
  return { text: `${label}${after ? " (after boarders)" : ""}: ${held}` };
}

// The bonus discovery a ghost read true earned on a SCANNED body: the engine appends one per true ghost, LAST, in
// event order, from the body's planet pools (expedition.ts assignDiscoveriesAndActivities), and adds none only when
// both pools are empty. Null when it cannot be named with certainty (then the line says nothing extra). Pure.
function ghostDiscoveryLabel(run: ScanTrackRun, event: ExpeditionScanEvent): string | null {
  const body = run.bodies[event.bodyIndex];
  if (!body || !body.scanned) return null;
  const pools = poisForPlanetType(body.planetType);
  if (pools.surface.length === 0 && pools.underground.length === 0) return null;
  const ghosts = (run.scanEvents ?? []).filter((ev) => ev.kind === "shipEvent" && ev.bonusDiscovery === true && ev.bodyIndex === event.bodyIndex);
  const k = ghosts.indexOf(event);
  const at = body.discoveries.length - ghosts.length + k;
  if (k < 0 || at < 0 || at >= body.discoveries.length) return null;
  const poiId = body.discoveries[at].poiId;
  return groundSiteLabel(poiId) ?? poiId;
}

function pauseWords(seconds: number | undefined): string | null {
  return seconds !== undefined && seconds > 0 ? `Scan paused ${spanText(seconds)}` : null;
}

interface PipWords {
  glyph: IconName;
  tone: ScanPipTone;
  name: string;
  outcome: string;
  sentence: string;
}

// A ship event in words (GO-8 / GO-9). Pure.
function shipEventWords(run: ScanTrackRun, event: ExpeditionScanEvent, kind: ShipScanEventKind): PipWords {
  const name = SHIP_EVENT_NAMES[kind];
  const passed = event.outcome === "pass" || event.outcome === "win";
  const pause = Math.max(0, event.pauseSeconds ?? 0);
  const boarded = event.boarding !== undefined && !event.boarding.repelled;
  // The event's own pause (a boarding adds its own on top, shipScanEvents.ts).
  const own = Math.max(0, pause - (boarded ? BOARDING_PAUSE_SECONDS : 0));
  const hull = event.hullWear && event.hullWear > 0 ? Math.round(event.hullWear) : null;
  let outcome: string;
  let line: string;
  switch (kind) {
    case "debris":
      outcome = passed ? "Steered clear" : "Hit";
      line = passed
        ? "the pilot steered clear."
        : `a detour around the debris paused the scan ${spanText(own)}${hull ? ` and left light hull damage (${hull} points)` : ""}.`;
      break;
    case "storm":
      outcome = passed ? "Shields held" : "Slowed";
      line = passed ? "the shields held." : `the ship rode out the storm, pausing the scan ${spanText(own)}.`;
      break;
    case "ghost":
      outcome = passed ? "Read true" : "False reading";
      if (passed && run.bodies[event.bodyIndex] && isStudyBody(run, run.bodies[event.bodyIndex])) {
        // GG-6: a study run's orbital body has no surface, so the true reading adds no ground find (GG-2).
        line = "the sensors read it true; an orbital body has no ground finds to add.";
      } else if (passed) {
        const body = run.bodies[event.bodyIndex];
        const found = event.bonusDiscovery ? ghostDiscoveryLabel(run, event) : null;
        line =
          event.bonusDiscovery && body && !body.scanned
            ? "the sensors read it true; this body gains one bonus discovery when its scan completes."
            : found
              ? `the sensors read it true and earned a bonus discovery, ${found}.`
              : "the sensors read it true.";
      } else {
        line = `a false reading; re-scanning paused the scan ${spanText(own)}.`;
      }
      break;
    case "probe":
    case "cloaked": {
      outcome = passed ? "Won" : "Lost";
      if (passed) {
        const salvage = findWords(run, event, "Salvage");
        line =
          salvage === null
            ? "the ship won the fight."
            : "text" in salvage
              ? `the ship won the fight. ${salvage.text}.`
              : "the ship won the fight; boarders later took its salvage.";
      } else {
        line = `the ship lost the fight. Repairs paused the scan ${spanText(own)}${hull ? `; the hull took ${hull} damage` : ""}.`;
      }
      break;
    }
  }
  if (event.boarding) {
    if (event.boarding.repelled) {
      outcome += ", boarders repelled";
      line += " Boarders tried to come aboard; the crew repelled them.";
    } else {
      outcome += ", boarded";
      const lost = event.boarding.creditsLost ?? 0;
      line += ` Boarders got aboard: the scan paused ${spanText(BOARDING_PAUSE_SECONDS)} more${lost > 0 ? ` and they took ${lost} credits from the run's finds` : ""}.`;
    }
  }
  const tone: ScanPipTone = passed && !boarded && pause === 0 ? "good" : "bad";
  return { glyph: boarded ? "boarding" : SHIP_EVENT_GLYPHS[kind], tone, name, outcome, sentence: `${name}: ${line}` };
}

// A legacy ground battle in words (Task 14). Pure.
function battleWords(run: ScanTrackRun, event: ExpeditionScanEvent): PipWords {
  const won = event.outcome === "win";
  const downed = event.downedMemberIds?.length ?? 0;
  const downText = downed > 0 ? ` ${plural(downed, "member", "members")} downed (they come home injured, never lost).` : "";
  let line: string;
  if (won) {
    const drops = findingContentsText(findingOf(run, event));
    line = `Security won.${drops ? ` Drops: ${drops}.` : ""}${downText}`;
  } else {
    const pause = event.pauseSeconds && event.pauseSeconds > 0 ? `, pausing the scan ${spanText(event.pauseSeconds)}` : "";
    line = `Security lost and pulled back to orbit${pause}.${downText}`;
  }
  return { glyph: "fightPoint", tone: won && downed === 0 ? "good" : "bad", name: BATTLE_NAME, outcome: won ? "Won" : "Lost", sentence: `${BATTLE_NAME}: ${line}` };
}

function pipWords(run: ScanTrackRun, event: ExpeditionScanEvent): PipWords {
  if (event.kind === "shipEvent" && event.event && SHIP_EVENT_NAMES[event.event]) return shipEventWords(run, event, event.event);
  if (event.kind === "encounter") return battleWords(run, event);
  if (event.kind === "shipEvent") {
    // A ship event this build does not name (never written today): say so plainly rather than guess.
    const bad = (event.pauseSeconds ?? 0) > 0 || event.outcome === "fail" || event.outcome === "loss";
    return { glyph: "warning", tone: bad ? "bad" : "good", name: "Scan event", outcome: bad ? "Cost time" : "No effect", sentence: `Scan event: ${bad ? "the scan waited" : "no effect"}.` };
  }
  const held = findWords(run, event, CACHE_NAME);
  const sentence = held === null ? `${CACHE_NAME}: a small find.` : "text" in held ? `${held.text}.` : `${CACHE_NAME}: boarders later took what it held.`;
  return { glyph: "supplyCache", tone: "good", name: CACHE_NAME, outcome: "Found", sentence };
}

// ===== The track =====

function pctOf(frac: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * 100);
}

// The scan track of body `bodyIndex`: null on a run dispatched before scan steps existed (no encounterSteps). Pure.
export function scanTrackView(run: ScanTrackRun, bodyIndex: number): ScanTrackView | null {
  const steps = run.encounterSteps;
  const body = run.bodies[bodyIndex];
  if (!steps || steps < 1 || !body) return null;
  const scannedPct = body.scanned ? 100 : pctOf(body.scanTotal > 0 ? body.scanProgress / body.scanTotal : 0);
  const pips = (run.scanEvents ?? [])
    .filter((ev) => ev.bodyIndex === bodyIndex)
    .sort((a, b) => a.step - b.step)
    .map((ev): ScanPipView => {
      const w = pipWords(run, ev);
      const posPct = pctOf(ev.step / steps);
      const atText = `${posPct}%`;
      const pauseText = pauseWords(ev.pauseSeconds);
      return {
        key: `${ev.bodyIndex}-${ev.step}`,
        step: ev.step,
        posPct,
        atText,
        ...w,
        pauseText,
        ariaLabel: `At ${atText} of the scan: ${w.name}, ${w.outcome}. ${w.sentence}`,
        title: `${atText}: ${w.name}, ${w.outcome}${pauseText ? `. ${pauseText}` : ""}`,
      };
    });
  const emptyText = pips.length > 0 ? null : body.scanned ? "No scan events: a calm scan." : "No scan events yet.";
  return { scannedPct, pips, ariaLabel: `Scan track: ${scannedPct}% scanned, ${plural(pips.length, "event", "events")}.`, emptyText };
}

// ===== The key row =====

export interface ScanTrackKeyEntry {
  glyph: IconName;
  text: string;
}
export interface ScanTrackKeyView {
  entries: ScanTrackKeyEntry[];
  costNote: string | null; // shown when some pip draws the dashed ring
}

const KEY_ORDER: readonly ScanTrackKeyEntry[] = [
  { glyph: "shipDebris", text: SHIP_EVENT_NAMES.debris },
  { glyph: "shipProbe", text: SHIP_EVENT_NAMES.probe },
  { glyph: "sensorGhost", text: SHIP_EVENT_NAMES.ghost },
  { glyph: "cloakedVessel", text: SHIP_EVENT_NAMES.cloaked },
  { glyph: "radiationStorm", text: SHIP_EVENT_NAMES.storm },
  { glyph: "fightPoint", text: BATTLE_NAME },
  { glyph: "supplyCache", text: CACHE_NAME },
  { glyph: "boarding", text: BOARDING_NAME },
];
export const SCAN_TRACK_COST_NOTE = "A dashed ring marks an event that cost something: scan time, hull, credits or injuries.";

// The key row: only the kinds this run's pips show, in a fixed order. Pure.
export function scanTrackKey(run: ScanTrackRun): ScanTrackKeyView {
  const shown = new Set<IconName>();
  let cost = false;
  run.bodies.forEach((_, i) => {
    for (const pip of scanTrackView(run, i)?.pips ?? []) {
      shown.add(pip.glyph);
      if (pip.tone === "bad") cost = true;
    }
  });
  return { entries: KEY_ORDER.filter((e) => shown.has(e.glyph)), costNote: cost ? SCAN_TRACK_COST_NOTE : null };
}
