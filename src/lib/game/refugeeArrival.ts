// E5-2 (Refugee Posts, design docs/plans/2026-11-02-refugee-posts-e5-design.md section 7, plan
// docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-2): who an Evacuation brings home.
//
// What the user decided (design section 7, "Yes, build it that way (Recommended)"):
// - Each delivered Evacuation may bring home ONE named refugee, with a background and a skill (a harder tier rolls a
//   stronger skill, REFUGEE_SKILL_SPANS).
// - Arrivals TAPER against open posts: while the waiting list fits the empty posts an Evacuation always brings someone;
//   past that the chance falls smoothly and never reaches zero (refugeeArrivalChance). A miss is a calm line ("settled
//   safely elsewhere"), never a loss.
// - Safe first runs: the training run (the template's first cycle) always brings someone home.
//
// Determinism: every draw comes from the delivering roll's own stream, makeRng(roll.seed ^ REFUGEE_SALT), with a FIXED
// layout of six draws (arrival, background, skill, name, hair, palette), all six always taken; the name itself comes
// from the seeded crew name generator on its own stream. Never the shared economy rng, never the clock. economyTick
// (tick.ts) collects the call's deliveries, sorts them by (atTick, slotId) and threads the refugee state through them
// here with `openPosts` read from the INCOMING state (a constant of the call, the board-slot precedent), so one call ==
// chunked == 1 s steps.
//
// Relocation deliveries are carried through but do nothing yet (E5-3 adds the farewell).
//
// Every number here is a [PROPOSAL] or [PROVISIONAL] in one named constant.

import { makeRng } from "./combat/rng";
import { generateCrewIdentity } from "./crew";
import {
  REFUGEE_BACKGROUND_KEYS,
  REFUGEE_PORTRAIT_HAIRS,
  REFUGEE_PORTRAIT_PALETTES,
  REFUGEE_SKILL_SPANS,
  type RefugeeBackground,
  type RefugeeRecord,
  type RefugeeState,
} from "./refugees";
import type { ShortRangeRoll, ShortRangeTier } from "./shortRange";

// The refugee stream's salt (off the delivering roll's seed).
export const REFUGEE_SALT = 0x1e5f00d5;

// The taper's softness: chance = 1 / (1 + max(0, waiting - openPosts) / K). With K 4, four people waiting past the empty
// posts halve the chance, twelve quarter it, and it never reaches zero. [PROPOSAL]
export const REFUGEE_TAPER_K = 4;

// The name pool: the diverse human pool (no race is stored and no racial bonus applies; the gender is discarded).
// [PROPOSAL]
export const REFUGEE_NAME_POOL = "earthBorn" as const;

// The chance an Evacuation brings someone home, given the people waiting and the open posts: 1 while the waiting list
// fits the empty posts, then falling smoothly, never 0. Non-finite or negative inputs read as 0. Pure.
export function refugeeArrivalChance(waiting: number, openPosts: number): number {
  const w = Number.isFinite(waiting) && waiting > 0 ? waiting : 0;
  const o = Number.isFinite(openPosts) && openPosts > 0 ? openPosts : 0;
  return 1 / (1 + Math.max(0, w - o) / REFUGEE_TAPER_K);
}

// One delivered cycle that moves people: an Evacuation (someone may come home) or a Refugee Relocation (E5-3). `atTick`
// is the call's whole tick it was delivered on (1 = the call's first tick).
export interface RefugeeDelivery {
  kind: "evacuation" | "relocation";
  atTick: number;
  slotId: number;
  roll: ShortRangeRoll;
}

// What a delivery did, for the completion log: someone arrived, nobody came home this time, or (E5-3) a farewell.
export interface RefugeeEvent {
  kind: "arrival" | "noArrival" | "farewell";
  atTick: number;
  slotId: number;
  refugeeId?: number;
  name?: string;
  background?: RefugeeBackground;
  destinationIndex: number;
  tier: ShortRangeTier;
}

interface RefugeeDraws {
  arrival: number; // [0, 1), against refugeeArrivalChance
  background: RefugeeBackground;
  skill: number;
  hair: 0 | 1 | 2 | 3;
  palette: number;
}

// The six draws of a roll's refugee stream, in the fixed layout. Pure.
function refugeeDraws(roll: Pick<ShortRangeRoll, "seed" | "tier">): RefugeeDraws {
  const rng = makeRng((roll.seed ^ REFUGEE_SALT) >>> 0);
  const arrival = rng.next();
  const background = REFUGEE_BACKGROUND_KEYS[rng.nextInt(REFUGEE_BACKGROUND_KEYS.length)];
  const [lo, hi] = REFUGEE_SKILL_SPANS[roll.tier] ?? REFUGEE_SKILL_SPANS[1];
  const skill = rng.nextRange(lo, hi);
  rng.next(); // the name's draw: spent, the name comes from the crew name generator on its own stream
  const hair = rng.nextInt(REFUGEE_PORTRAIT_HAIRS) as 0 | 1 | 2 | 3;
  const palette = rng.nextInt(REFUGEE_PORTRAIT_PALETTES);
  return { arrival, background, skill, hair, palette };
}

// The refugee a roll brings home as id `id`: a pure function of (roll.seed, roll.tier, id) and the arrival instant.
// The origin is the roll's tier and destination. Pure.
export function rollRefugee(roll: ShortRangeRoll, id: number, arrivedAtSeconds: number): RefugeeRecord {
  const d = refugeeDraws(roll);
  return {
    id,
    name: generateCrewIdentity(REFUGEE_NAME_POOL, (roll.seed ^ REFUGEE_SALT) >>> 0, id).name,
    background: d.background,
    skill: d.skill,
    origin: { tier: roll.tier, destinationIndex: roll.destinationIndex },
    portrait: { hair: d.hair, palette: d.palette },
    arrivedAtSeconds,
    posting: null,
  };
}

// Whether an Evacuation roll brings someone home, given the people waiting and the open posts at its delivery: always
// on the training run (its arrival draw is still taken), else its arrival draw against the taper. Pure.
export function refugeeArrives(roll: ShortRangeRoll, waiting: number, openPosts: number): boolean {
  const { arrival } = refugeeDraws(roll);
  return roll.difficulty.firstRun || arrival < refugeeArrivalChance(waiting, openPosts);
}

// The refugee state after this call's deliveries, and what each did. The deliveries are taken in (atTick, slotId) order
// (sorted here, stable); each Evacuation reads the waiting list as the earlier ones left it, against `openPosts` (the
// incoming state's, a constant of the call). An arrival joins the waiting list (posting null) with the next id, counts
// in `arrivedTotal` and is queued for its arrival card (`greet`). A miss mints no id. Relocations do nothing yet (E5-3).
// No arrival: the same `refugees` reference. Pure.
export function applyRefugeeDeliveries(
  refugees: RefugeeState,
  openPosts: number,
  deliveries: readonly RefugeeDelivery[],
  call: { gameTimeSeconds: number; tickDurationSeconds: number },
): { refugees: RefugeeState; events: RefugeeEvent[] } {
  const events: RefugeeEvent[] = [];
  if (deliveries.length === 0) return { refugees, events };
  const ordered = [...deliveries].sort((a, b) => a.atTick - b.atTick || a.slotId - b.slotId);
  let out = refugees;
  let waiting = refugees.list.reduce((n, r) => n + (r.posting === null ? 1 : 0), 0);
  for (const d of ordered) {
    if (d.kind !== "evacuation") continue;
    const base = { atTick: d.atTick, slotId: d.slotId, destinationIndex: d.roll.destinationIndex, tier: d.roll.tier };
    if (!refugeeArrives(d.roll, waiting, openPosts)) {
      events.push({ kind: "noArrival", ...base });
      continue;
    }
    const id = out.nextId;
    const record = rollRefugee(d.roll, id, call.gameTimeSeconds + d.atTick * call.tickDurationSeconds);
    out = { ...out, list: [...out.list, record], nextId: id + 1, arrivedTotal: out.arrivedTotal + 1, greet: [...out.greet, id] };
    waiting += 1;
    events.push({ kind: "arrival", ...base, refugeeId: id, name: record.name, background: record.background });
  }
  return { refugees: out, events };
}
