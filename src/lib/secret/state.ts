// state.ts: the secret game's state and its OWN save (0.13.11).
//
// ⚠️ NEVER PART OF THE MAIN SAVE. Separate localStorage key, separate version number, no entry in
// save.ts, SAVE_VERSION or MIGRATIONS. It is read and written only through the guarded
// safeStorage helpers, so blocked or full storage means the game runs for the session and simply
// does not persist. A corrupt or foreign value loads a fresh game instead of throwing.
// Delete Save and Debug "Reset save" wipe it too (App.svelte resetSave -> wipeSecretGame).

import Decimal from "break_infinity.js";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../safeStorage";
import {
  TIER_COUNT,
  BASE_TIERS_OPEN,
  START_ORE,
  AUTO_TARGET_DEFAULT,
  type SkillId,
  type MilestoneId,
} from "./config";

export const SECRET_SAVE_KEY = "hl_secret_v0";
export const SECRET_SAVE_VERSION = 0;

export type AutoLayer = "captain" | "fleet" | "pc";

export interface SecretState {
  v: 0;
  ore: Decimal; // RAW Ore; the player sees the effective value (engine.displayOre)
  bought: number[]; // per tier, units bought (drives prices and the ten bonus)
  owned: Decimal[]; // per tier, bought plus produced
  overclock: number; // Overclock level
  lastIncome: Decimal; // Ore per second over the last step (prices Overclock, shown as Ore/s)
  runPeak: Decimal; // best Ore since the last reset of any kind (Captain gains)
  fleetPeak: Decimal; // best Ore since the last Fleet Prestige or Prestigeception (Fleet gains)
  pcPeak: Decimal; // best Ore since the last Prestigeception (Dream Point gains)
  bestOre: Decimal; // best Ore ever (milestones, the goal bar)
  runSeconds: number;
  captainPoints: Decimal;
  augmentPoints: Decimal;
  dreamPoints: Decimal;
  captainCount: number; // lifetime
  fleetCount: number; // since the last Prestigeception
  fleetTotal: number; // lifetime (tier unlocks stay once earned)
  pcCount: number; // lifetime
  tiersUnlocked: number; // 4 to 8, permanent
  skillPoints: number; // unspent
  skills: Partial<Record<SkillId, true>>;
  autoOn: Partial<Record<SkillId, boolean>>; // switch per auto skill; missing means on
  autoTarget: Record<AutoLayer, number>; // percent of current points a gain must reach
  milestones: Partial<Record<MilestoneId, number>>; // reached at (ms since epoch)
  finaleSeen: boolean;
  longSeen: boolean;
  lastTickAt: number; // wall clock (ms) the state has been advanced to
}

export function freshSecretState(nowMs: number): SecretState {
  const ore = new Decimal(START_ORE);
  return {
    v: 0,
    ore,
    bought: new Array(TIER_COUNT).fill(0),
    owned: Array.from({ length: TIER_COUNT }, () => new Decimal(0)),
    overclock: 0,
    lastIncome: new Decimal(0),
    runPeak: ore,
    fleetPeak: ore,
    pcPeak: ore,
    bestOre: ore,
    runSeconds: 0,
    captainPoints: new Decimal(0),
    augmentPoints: new Decimal(0),
    dreamPoints: new Decimal(0),
    captainCount: 0,
    fleetCount: 0,
    fleetTotal: 0,
    pcCount: 0,
    tiersUnlocked: BASE_TIERS_OPEN,
    skillPoints: 0,
    skills: {},
    autoOn: {},
    autoTarget: { captain: AUTO_TARGET_DEFAULT, fleet: AUTO_TARGET_DEFAULT, pc: AUTO_TARGET_DEFAULT },
    milestones: {},
    finaleSeen: false,
    longSeen: false,
    lastTickAt: nowMs,
  };
}

// Decimals are immutable, so a shallow copy of each container is a full, independent copy.
export function cloneSecret(s: SecretState): SecretState {
  return {
    ...s,
    bought: s.bought.slice(),
    owned: s.owned.slice(),
    skills: { ...s.skills },
    autoOn: { ...s.autoOn },
    autoTarget: { ...s.autoTarget },
    milestones: { ...s.milestones },
  };
}

const DECIMAL_FIELDS = [
  "ore",
  "lastIncome",
  "runPeak",
  "fleetPeak",
  "pcPeak",
  "bestOre",
  "captainPoints",
  "augmentPoints",
  "dreamPoints",
] as const;

const NUMBER_FIELDS = [
  "overclock",
  "runSeconds",
  "captainCount",
  "fleetCount",
  "fleetTotal",
  "pcCount",
  "tiersUnlocked",
  "skillPoints",
  "lastTickAt",
] as const;

export function serializeSecret(s: SecretState): string {
  const out: Record<string, unknown> = { ...s, owned: s.owned.map((d) => d.toString()) };
  for (const k of DECIMAL_FIELDS) out[k] = s[k].toString();
  return JSON.stringify(out);
}

function readDecimal(v: unknown): Decimal | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Decimal(v);
  if (!Number.isFinite(d.mantissa) || !Number.isFinite(d.exponent) || d.lt(0)) return null;
  return d;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Returns null for anything that is not a valid version-0 secret save.
export function deserializeSecret(raw: string | null, nowMs: number): SecretState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.v !== SECRET_SAVE_VERSION) return null;
  const s = freshSecretState(nowMs);
  for (const k of DECIMAL_FIELDS) {
    const d = readDecimal(parsed[k]);
    if (d === null) return null;
    s[k] = d;
  }
  for (const k of NUMBER_FIELDS) {
    const n = parsed[k];
    if (!isFiniteNumber(n)) return null;
    s[k] = n;
  }
  const bought = parsed.bought;
  const owned = parsed.owned;
  if (!Array.isArray(bought) || bought.length !== TIER_COUNT || !bought.every((n) => isFiniteNumber(n) && n >= 0)) return null;
  if (!Array.isArray(owned) || owned.length !== TIER_COUNT) return null;
  s.bought = bought.map((n) => Math.floor(n as number));
  const ownedDecimals = owned.map(readDecimal);
  if (ownedDecimals.some((d) => d === null)) return null;
  s.owned = ownedDecimals as Decimal[];
  if (s.tiersUnlocked < BASE_TIERS_OPEN || s.tiersUnlocked > TIER_COUNT) return null;
  for (const key of ["skills", "autoOn", "milestones"] as const) {
    if (!isPlainObject(parsed[key])) return null;
  }
  s.skills = { ...(parsed.skills as SecretState["skills"]) };
  s.autoOn = { ...(parsed.autoOn as SecretState["autoOn"]) };
  s.milestones = { ...(parsed.milestones as SecretState["milestones"]) };
  const t = parsed.autoTarget;
  if (!isPlainObject(t) || !isFiniteNumber(t.captain) || !isFiniteNumber(t.fleet) || !isFiniteNumber(t.pc)) return null;
  s.autoTarget = { captain: t.captain, fleet: t.fleet, pc: t.pc };
  s.finaleSeen = parsed.finaleSeen === true;
  s.longSeen = parsed.longSeen === true;
  return s;
}

export function loadSecret(nowMs: number): SecretState {
  return deserializeSecret(safeGetItem(SECRET_SAVE_KEY), nowMs) ?? freshSecretState(nowMs);
}

export function saveSecret(s: SecretState): boolean {
  return safeSetItem(SECRET_SAVE_KEY, serializeSecret(s));
}

export function clearSecretSave(): void {
  safeRemoveItem(SECRET_SAVE_KEY);
}
