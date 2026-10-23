// state.ts: the secret game's state and its OWN save (0.13.11).
//
// NOTE: NEVER PART OF THE MAIN SAVE. Separate localStorage key, separate version number, no entry in
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
  SKILLS,
  MILESTONES,
  type SkillId,
  type MilestoneId,
} from "./config";

const SKILL_IDS: readonly SkillId[] = SKILLS.map((d) => d.id);
const MILESTONE_IDS: readonly MilestoneId[] = MILESTONES.map((m) => m.id);

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
  // break_infinity parses "Infinity" to its exponent ceiling (9e15): treat that as not finite too.
  if (!Number.isFinite(d.mantissa) || !Number.isFinite(d.exponent) || d.exponent >= 9e15 || d.lt(0)) return null;
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
    if (k !== "lastTickAt" && n < 0) return null; // counts and levels are never negative
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
  // Entry-level clean-up: unknown skills and switches are dropped, a milestone date must be a
  // finite number, an auto target must be a positive percent (else the default).
  const skills = parsed.skills as Record<string, unknown>;
  const autoOn = parsed.autoOn as Record<string, unknown>;
  const milestones = parsed.milestones as Record<string, unknown>;
  for (const id of SKILL_IDS) {
    if (skills[id] === true) s.skills[id] = true;
    if (typeof autoOn[id] === "boolean") s.autoOn[id] = autoOn[id] as boolean;
  }
  for (const id of MILESTONE_IDS) {
    const at = milestones[id];
    if (isFiniteNumber(at)) s.milestones[id] = at;
  }
  const t = parsed.autoTarget;
  if (!isPlainObject(t)) return null;
  for (const layer of ["captain", "fleet", "pc"] as const) {
    const pct = t[layer];
    s.autoTarget[layer] = isFiniteNumber(pct) && pct > 0 ? pct : AUTO_TARGET_DEFAULT;
  }
  s.finaleSeen = parsed.finaleSeen === true;
  s.longSeen = parsed.longSeen === true;
  return s;
}

// Where an unreadable secret save is kept before anything overwrites it.
export const SECRET_BACKUP_KEY = "hl_secret_v0_backup";

export type SecretLoadStatus = "ok" | "empty" | "corrupt" | "future";

// A save from a newer version of the game (a higher "v"): never overwritten by this build.
export function isFutureSecretSave(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) && typeof parsed.v === "number" && parsed.v > SECRET_SAVE_VERSION;
  } catch {
    return false;
  }
}

// Loads the secret save. An unreadable one (corrupt or from a newer version) is copied to
// SECRET_BACKUP_KEY first, so the fresh game that replaces it can never destroy it.
export function inspectSecretSave(nowMs: number): { state: SecretState; status: SecretLoadStatus } {
  const raw = safeGetItem(SECRET_SAVE_KEY);
  if (raw === null) return { state: freshSecretState(nowMs), status: "empty" };
  const state = deserializeSecret(raw, nowMs);
  if (state) return { state, status: "ok" };
  safeSetItem(SECRET_BACKUP_KEY, raw);
  return { state: freshSecretState(nowMs), status: isFutureSecretSave(raw) ? "future" : "corrupt" };
}

export function loadSecret(nowMs: number): SecretState {
  return inspectSecretSave(nowMs).state;
}

export function saveSecret(s: SecretState): boolean {
  return safeSetItem(SECRET_SAVE_KEY, serializeSecret(s));
}

export function clearSecretSave(): void {
  safeRemoveItem(SECRET_SAVE_KEY);
}
