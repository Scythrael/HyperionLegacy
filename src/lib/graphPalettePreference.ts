// ============================================================================
// graphPalettePreference.ts: the GRAPH COLOR option, device-side (0.14.0 Complement CP-20, user pick
// 2026-11-02 OC-24 "Default, Colorblind, Mono (Recommended)").
//
// A per-viewer convenience ONLY. It lives in localStorage (through safeStorage), never in the save, and
// the engine reads none of it: it changes how a graph is drawn, not what the game does. Same sorting
// rule as accessibilityPreference.ts and the other *Preference.ts stores.
//
// ONE KEY PER GRAPH. The complement graph (the ship's Complement tab division charts) is the first; a
// later graph adds its id to GRAPH_IDS and gets its own key, so one graph's choice never moves another.
//
// A blocked store, a throwing store, or a junk value all fall back to "default" (today's colors).
//
// THE PRESETS. Each one paints the two layers of the division chart: the CAP layer (the rank's ceiling,
// drawn behind) and the UTILIZATION layer (current / cap, drawn in front, colored by how full it is).
// Color is never the only cue: the utilization bar's HEIGHT against its cap shows the same fraction,
// and the tooltip and aria-label state it as a number.
//   - default:    gray cap; red (0%) -> yellow (50%) -> green (100%) by hue. ⚠️ The strings below are
//                 BYTE-IDENTICAL to what ComplementPanel.svelte drew before CP-20; do not tidy them.
//   - colorblind: FIXED STEPS of the exact Okabe-Ito colors (user 2026-11-09 "Fixed steps"), never a
//                 blend, on the same gray cap: orange #d55e00 below a third, amber #e69f00 from a third
//                 up to and including two thirds, bluish green #009e73 above two thirds. Every bar is
//                 one of three distinct safe colors. See colorblindStep for the exact boundaries.
//   - mono:       no hue at all. The fill is a continuous lightness ramp of gray shades (dim gray at 0%
//                 -> near white at 100%) and the cap is a diagonal HATCH, so cap and fill differ by
//                 pattern as well as lightness.
//
// THE GLOBAL TOGGLE (user 2026-11-09 "Follow the toggle"). When the Settings "Color-blind palette" toggle
// is on, a graph set to Default draws as Color-blind safe. Monochrome still wins over it. The rule is the
// pure resolveGraphPalette; effectiveGraphPaletteStore applies it live to both settings.
//
// No em dashes / no "--" as punctuation (project rule).
// ============================================================================

import { derived, writable, type Readable } from "svelte/store";
import { safeGetItem, safeSetItem } from "./safeStorage";
import { colorBlindPaletteStore, type ColorBlindPalette } from "./accessibilityPreference";

export const GRAPH_IDS = ["complement"] as const;
export type GraphId = (typeof GRAPH_IDS)[number];

export const GRAPH_PALETTE_IDS = ["default", "colorblind", "mono"] as const;
export type GraphPaletteId = (typeof GRAPH_PALETTE_IDS)[number];
export const GRAPH_PALETTE_DEFAULT: GraphPaletteId = "default";

export const GRAPH_PALETTE_LABELS: Record<GraphPaletteId, string> = {
  default: "Default",
  colorblind: "Color-blind safe",
  mono: "Monochrome",
};

const GRAPH_PALETTE_KEYS: Record<GraphId, string> = {
  complement: "fleet_admiral_graph_palette_complement",
};

export function isGraphPaletteId(raw: string | null): raw is GraphPaletteId {
  return (GRAPH_PALETTE_IDS as readonly string[]).includes(raw ?? "");
}

export function loadGraphPalette(graph: GraphId): GraphPaletteId {
  const raw = safeGetItem(GRAPH_PALETTE_KEYS[graph]);
  return isGraphPaletteId(raw) ? raw : GRAPH_PALETTE_DEFAULT;
}

export function saveGraphPalette(graph: GraphId, id: GraphPaletteId): void {
  safeSetItem(GRAPH_PALETTE_KEYS[graph], id);
}

// The live choice per graph, so a graph already on screen repaints the moment Settings changes it.
// Seeded from storage on first import (a blocked store seeds "default").
const stores = Object.fromEntries(GRAPH_IDS.map((g) => [g, writable<GraphPaletteId>(loadGraphPalette(g))])) as Record<
  GraphId,
  ReturnType<typeof writable<GraphPaletteId>>
>;

export function graphPaletteStore(graph: GraphId): Readable<GraphPaletteId> {
  return { subscribe: stores[graph].subscribe };
}

// Persist AND publish (the Settings select calls this). An unknown id is ignored.
export function setGraphPalette(graph: GraphId, id: string): void {
  if (!isGraphPaletteId(id)) return;
  saveGraphPalette(graph, id);
  stores[graph].set(id);
}

// THE PALETTE A GRAPH ACTUALLY DRAWS WITH, from the viewer's preset and the global Color-blind palette
// toggle: Monochrome if chosen; else Color-blind safe if chosen OR the toggle is on; else Default.
// Pure, so the rule is pinned by tests rather than living in a component.
export function resolveGraphPalette(chosen: GraphPaletteId, colorBlind: ColorBlindPalette): GraphPaletteId {
  if (chosen === "mono") return "mono";
  if (chosen === "colorblind" || colorBlind === "cbsafe") return "colorblind";
  return "default";
}

// The resolved palette, live: it changes when EITHER the graph's preset or the global toggle changes, so
// a graph already on screen repaints at once. This is what a graph component reads.
export function effectiveGraphPaletteStore(graph: GraphId): Readable<GraphPaletteId> {
  return derived([stores[graph], colorBlindPaletteStore], ([chosen, colorBlind]) =>
    resolveGraphPalette(chosen, colorBlind),
  );
}

// ---------------------------------------------------------------------------
// THE PALETTES
// ---------------------------------------------------------------------------

export interface GraphPalette {
  cap: string; // CSS background of a finite rank's cap layer
  capUncapped: string; // CSS background of the uncapped Crewman cap layer (the striped "no ceiling" bar)
  keyCap: string; // the graph key's cap swatch
  keyUtil: string; // the graph key's utilization swatch (low to full, left to right)
}

// The Okabe-Ito steps (Okabe and Ito, "Color Universal Design", 2008). Their own names are vermillion,
// orange and bluish green; the Settings text calls the first two orange and amber, as the user did.
export const OKABE_ITO_LOW = "#d55e00";
export const OKABE_ITO_MID = "#e69f00";
export const OKABE_ITO_FULL = "#009e73";

// The Color-blind safe step boundaries, as fill fractions. Fill is current / cap, and IEEE division of
// two integers is correctly rounded, so 2 of 6 compares equal to 1 / 3 and 4 of 6 to 2 / 3 exactly.
//   step 0 (orange #d55e00):       fill <  1/3
//   step 1 (amber #e69f00):  1/3 <= fill <= 2/3   (exactly a third and exactly two thirds are amber)
//   step 2 (bluish green #009e73): fill >  2/3
export const COLORBLIND_STEP_LOW_BELOW = 1 / 3;
export const COLORBLIND_STEP_FULL_ABOVE = 2 / 3;
const COLORBLIND_STEP_COLORS = [OKABE_ITO_LOW, OKABE_ITO_MID, OKABE_ITO_FULL] as const;

// Which Color-blind safe step a fill fraction lands on (clamped to [0, 1] first, so below 0 is step 0 and
// above 1 is step 2).
export function colorblindStep(pct: number): 0 | 1 | 2 {
  const p = Math.max(0, Math.min(1, pct));
  if (p < COLORBLIND_STEP_LOW_BELOW) return 0;
  if (p <= COLORBLIND_STEP_FULL_ABOVE) return 1;
  return 2;
}

// The key swatch for the steps: three hard bands, a third each, so the key shows exactly the three colors
// a bar can be and no blend between them.
const COLORBLIND_KEY_UTIL =
  `linear-gradient(90deg, ${OKABE_ITO_LOW} 0%, ${OKABE_ITO_LOW} 33.33%, ${OKABE_ITO_MID} 33.33%, ` +
  `${OKABE_ITO_MID} 66.67%, ${OKABE_ITO_FULL} 66.67%, ${OKABE_ITO_FULL} 100%)`;

// The monochrome lightness ramp ends and the cap hatch.
export const MONO_LOW = "#8c9198";
export const MONO_FULL = "#f2f4f7";
const MONO_CAP_LIGHT = "#5a5f66";
const MONO_CAP_DARK = "#24272c";

const DEFAULT_CAP = "linear-gradient(180deg, #4c5666, #333b48)";

const PALETTES: Record<GraphPaletteId, GraphPalette> = {
  default: {
    cap: DEFAULT_CAP,
    capUncapped: "repeating-linear-gradient(180deg, #4a5568, #4a5568 3px, transparent 3px, transparent 5px)",
    keyCap: DEFAULT_CAP,
    keyUtil: "linear-gradient(90deg, hsl(0, 80%, 55%), hsl(60, 80%, 55%), hsl(120, 60%, 45%))",
  },
  colorblind: {
    cap: DEFAULT_CAP,
    capUncapped: "repeating-linear-gradient(180deg, #4a5568, #4a5568 3px, transparent 3px, transparent 5px)",
    keyCap: DEFAULT_CAP,
    keyUtil: COLORBLIND_KEY_UTIL,
  },
  mono: {
    cap: `repeating-linear-gradient(135deg, ${MONO_CAP_LIGHT} 0px, ${MONO_CAP_LIGHT} 2px, ${MONO_CAP_DARK} 2px, ${MONO_CAP_DARK} 5px)`,
    capUncapped: `repeating-linear-gradient(180deg, ${MONO_CAP_LIGHT}, ${MONO_CAP_LIGHT} 3px, transparent 3px, transparent 5px)`,
    keyCap: `repeating-linear-gradient(135deg, ${MONO_CAP_LIGHT} 0px, ${MONO_CAP_LIGHT} 2px, ${MONO_CAP_DARK} 2px, ${MONO_CAP_DARK} 5px)`,
    keyUtil: `linear-gradient(90deg, ${MONO_LOW}, ${MONO_FULL})`,
  },
};

export function graphPalette(id: GraphPaletteId): GraphPalette {
  return PALETTES[id] ?? PALETTES[GRAPH_PALETTE_DEFAULT];
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a: string, b: string, t: number): [number, number, number] {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t)) as [number, number, number];
}

// The solid color the utilization layer starts from (its top) at a fill fraction, for the two
// non-Default presets: Color-blind safe is one of its three fixed steps (never a blend); Monochrome is
// the continuous gray-shade ramp. Exposed for the contrast tests.
export function utilBaseRgb(id: Exclude<GraphPaletteId, "default">, pct: number): [number, number, number] {
  if (id === "mono") return mixRgb(MONO_LOW, MONO_FULL, Math.max(0, Math.min(1, pct)));
  return hexRgb(COLORBLIND_STEP_COLORS[colorblindStep(pct)]);
}

// The utilization layer's CSS background at a fill fraction (clamped to [0, 1]), with the light to dark
// vertical fade. Default is the pre-CP-20 expression exactly.
export function graphUtilFill(id: GraphPaletteId, pct: number): string {
  if (id === "colorblind" || id === "mono") {
    const [r, g, b] = utilBaseRgb(id, pct);
    // Mono keeps more body at the bottom so the fill never thins into the hatched cap behind it.
    const bottomAlpha = id === "mono" ? 0.75 : 0.45;
    return `linear-gradient(180deg, rgb(${r}, ${g}, ${b}), rgba(${r}, ${g}, ${b}, ${bottomAlpha}))`;
  }
  const h = Math.max(0, Math.min(1, pct)) * 120;
  return `linear-gradient(180deg, hsl(${h}, 80%, 62%), hsla(${h}, 72%, 42%, 0.4))`;
}
