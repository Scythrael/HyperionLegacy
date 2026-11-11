// Field Kits FKR-7 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-7; USER ANSWERS FK3, FK4, FK11, group 7,
// N12, N16, calls 16 and 17; the credit sinks pass "Quartermaster sells + top-up"): THE RUN PLUMBING, pure.
//
//   - DISPATCH (expedition.ts startExpedition, behind fieldKits.ts FIELD_KITS_RUNS_LIVE): the run is stamped with flag 2
//     and the FREE BASIC SET frozen on the ship's Medical and Operations headcount (fieldKitsStamp). Each deploying
//     Security member packs their EXTRAS (planDispatchPacks): their pack preference (ShipGroundTeam.packs), else the
//     default (N16 "1 of each usable kit"), only kits that member can use, taken from stock in team then slot order
//     (stock leaves the warehouse lowest quality first; kits ignore quality, call 16). A team with "Top up from the
//     Quartermaster at launch" on then BUYS its members' shortfall at FIELD_KIT_PRICES, as credits allow, member by
//     member; a dispatch is never refused for kits (packing only ever lowers to what stock and credits cover).
//     Science never fights, so it packs nothing (a Survey team packs nothing).
//   - EACH OBJECTIVE (groundOps.ts, as the crew lands: every objective start and every trip, user N12 and group 7
//     "Free, every objective"): every Security member's free basics are refilled to the frozen set and their grenade
//     charges reset to full (refreshObjectiveSupplies). The extras are never refilled.
//   - EACH FIGHT (groundOps.ts finishFight): the fight record's spends come off the team's run (fieldKitsBattle.ts
//     fightSuppliesAfter: charges, basics, extras), and the Injury Kit shares (`treated`) add up on the member's trip
//     treatment, which the medical bay divides by (medicalBay.ts treatmentShare); a healed team's treatment clears.
//   - CLAIM (expedition.ts claimExpedition): every extra still carried comes home, even over the warehouse cap (call 17,
//     "allow over cap"); spent ones never do; basics never come home (they refresh).
//
// DETERMINISM: no draw anywhere; every count is a stored value or arithmetic on one. A run without flag 2 never calls
// any of this (fieldKits.ts fieldKitsLive), so it dispatches, fights and claims byte-identically.
//
// Module graph: model (types), fieldKits (the catalog, the prices, the flag), fieldKitsBattle (the fight supplies),
// inventory, groundTeamSlots (the ship's teams), gambit (the support headcount). Never groundOps.ts or expedition.ts
// (both import this module).

import Decimal from "break_infinity.js";
import type { Expedition, GameState, GroundFightRecord, GroundTeamRun, ShipGroundTeam, ShipInstance, SnapshotMember } from "./model";
import { FIELD_KITS_CATALOG_VERSION, FIELD_KIT_IDS, FIELD_KIT_PRICES, canUseKit, fieldKitsLive, freeBasicSet, type FieldKitId } from "./fieldKits";
import { fightSuppliesAfter } from "./fieldKitsBattle";
import { addItemQuality, itemTotal, removeItemLowestFirst } from "./inventory";
import { shipGroundTeams } from "./groundTeamSlots";
import { shipSupportHeads } from "./gambit";
import { withDiscovered } from "./canonicalOrder";

export type KitCounts = Partial<Record<FieldKitId, number>>;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// A whole, non-negative count (a bad value reads 0). Pure.
function whole(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// ===== Who can use what =====

// Does this snapshot member have Medical Training (the medic effect, gambit.ts buildRosterCombatants reads the same)?
// Pure.
export function memberHasMedicalTraining(m: Pick<SnapshotMember, "effects">): boolean {
  return m.effects.some((e) => e.kind === "medic");
}

// N16 (user 2026-10-17 "1 of each usable kit"): the pack a member carries when they have no preference of their own:
// one of every kit they can use (Advanced Medical needs Medical Training, D20). Pure.
export function defaultMemberPack(medic: boolean): KitCounts {
  const out: KitCounts = {};
  for (const id of FIELD_KIT_IDS) if (canUseKit({ medic }, id)) out[id] = 1;
  return out;
}

// The pack a member WANTS for the next dispatch: their stored preference (ShipGroundTeam.packs; an empty one packs
// nothing), else the default, either way only the kits they can use (approved 2026-10-20: a kit the member cannot use is never
// packed or bought, so stock and credits never go on a kit that cannot fire). Pure.
export function memberPackPreference(team: Pick<ShipGroundTeam, "packs"> | undefined, memberId: string, medic: boolean): KitCounts {
  const stored = team?.packs && hasOwn(team.packs, memberId) ? team.packs[memberId] : undefined;
  if (!stored) return defaultMemberPack(medic);
  const out: KitCounts = {};
  for (const id of FIELD_KIT_IDS) {
    const n = hasOwn(stored, id) ? whole(stored[id]) : 0;
    if (n > 0 && canUseKit({ medic }, id)) out[id] = n;
  }
  return out;
}

// ===== Dispatch =====

// Flag 2 as a new dispatch stamps it: the kit catalog's version and the free basic set every Security member starts
// each objective with, frozen on the ship's support headcount now (D24's "the launch is what you saw"). Pure.
export function fieldKitsStamp(state: GameState, ship: ShipInstance): NonNullable<Expedition["fieldKits"]> {
  return { catalog: FIELD_KITS_CATALOG_VERSION, freeBasics: freeBasicSet(shipSupportHeads(state, ship)) };
}

// One deploying team as the planner reads it: its ship team index and its Security members in slot order.
export interface PackTeam {
  readonly index: number;
  readonly securityIds: readonly string[];
}

export interface DispatchPackPlan {
  // ship team index -> memberId -> the extras that member packs (members packing nothing are left out).
  readonly packs: Readonly<Record<number, Readonly<Record<string, KitCounts>>>>;
  readonly fromStock: KitCounts; // taken from the warehouse (lowest quality first)
  readonly bought: KitCounts; // bought at the Quartermaster by a team's top-up
  readonly cost: number; // credits the top-up spends
}

// What a dispatch of `teams` packs (see the module header): stock first, across every team in team then slot order;
// then each top-up team buys its members' shortfall in the same order, whole kits, as the credits allow. Members are
// read from `security` (the run's Security snapshots: who has Medical Training). Never refuses. Pure.
export function planDispatchPacks(
  state: Pick<GameState, "inventory" | "credits">,
  ship: Pick<ShipInstance, "typeKey" | "groundTeams">,
  teams: readonly PackTeam[],
  security: readonly SnapshotMember[],
): DispatchPackPlan {
  const shipTeams = shipGroundTeams(ship);
  const stock: Record<string, number> = {};
  for (const id of FIELD_KIT_IDS) stock[id] = whole(itemTotal(state.inventory, id).floor().toNumber());
  const packs: Record<number, Record<string, KitCounts>> = {};
  const short: { team: number; memberId: string; want: KitCounts }[] = [];
  const fromStock: KitCounts = {};
  for (const team of teams) {
    for (const memberId of team.securityIds) {
      const m = security.find((s) => s.memberId === memberId);
      if (!m) continue;
      const want = memberPackPreference(shipTeams[team.index], memberId, memberHasMedicalTraining(m));
      const packed: KitCounts = {};
      const missing: KitCounts = {};
      for (const id of FIELD_KIT_IDS) {
        const n = want[id] ?? 0;
        if (n <= 0) continue;
        const take = Math.min(n, stock[id]);
        stock[id] -= take;
        if (take > 0) {
          packed[id] = take;
          fromStock[id] = (fromStock[id] ?? 0) + take;
        }
        if (n > take) missing[id] = n - take;
      }
      if (Object.keys(packed).length > 0) (packs[team.index] ??= {})[memberId] = packed;
      if (shipTeams[team.index]?.topUp === true && Object.keys(missing).length > 0) short.push({ team: team.index, memberId, want: missing });
    }
  }
  let budget = Math.max(0, state.credits.toNumber());
  let cost = 0;
  const bought: KitCounts = {};
  for (const s of short) {
    for (const id of FIELD_KIT_IDS) {
      const n = s.want[id] ?? 0;
      const price = FIELD_KIT_PRICES[id];
      if (n <= 0 || !(price > 0)) continue;
      const buy = Math.min(n, Math.floor(budget / price));
      if (buy <= 0) continue;
      budget -= buy * price;
      cost += buy * price;
      bought[id] = (bought[id] ?? 0) + buy;
      const pack = ((packs[s.team] ??= {})[s.memberId] ??= {});
      pack[id] = (pack[id] ?? 0) + buy;
    }
  }
  return { packs, fromStock, bought, cost };
}

// The deploying teams' runs with their packs written (GroundTeamRun.kits, a team with no packed member left as it is),
// plus FKR-9's display record of the same packs (GroundTeamRun.packed, never spent). Mutates the fresh snapshot teams it
// is handed and returns them.
export function withDispatchPacks(teams: GroundTeamRun[], plan: DispatchPackPlan): GroundTeamRun[] {
  for (const team of teams) {
    const packs = plan.packs[team.index];
    if (packs && Object.keys(packs).length > 0) {
      team.kits = structuredClone(packs) as Record<string, KitCounts>;
      team.packed = structuredClone(packs) as Record<string, KitCounts>;
    }
  }
  return teams;
}

// What the run SPENT of its packed extras (packed minus what is still carried), summed per kit; nothing for a run that
// packed nothing. Basics never count (they are free and refill). Pure.
export function usedExtras(exp: Pick<Expedition, "groundOps">): KitCounts {
  const out: KitCounts = {};
  for (const team of exp.groundOps?.teams ?? []) {
    for (const [memberId, pack] of Object.entries(team.packed ?? {})) {
      for (const id of FIELD_KIT_IDS) {
        const used = whole(pack[id]) - whole(team.kits?.[memberId]?.[id]);
        if (used > 0) out[id] = (out[id] ?? 0) + used;
      }
    }
  }
  return out;
}

// The state after the dispatch settles its packs: the stock leaves the warehouse (lowest quality first) and the
// top-up's credits are spent. The SAME state when nothing was packed. Pure.
export function settleDispatchPacks(state: GameState, plan: DispatchPackPlan): GameState {
  let inventory = state.inventory;
  let moved = false;
  for (const id of FIELD_KIT_IDS) {
    const n = plan.fromStock[id] ?? 0;
    if (n <= 0) continue;
    inventory = removeItemLowestFirst(inventory, id, new Decimal(n));
    moved = true;
  }
  if (!moved && plan.cost <= 0) return state;
  return { ...state, inventory, ...(plan.cost > 0 ? { credits: state.credits.minus(plan.cost) } : {}) };
}

// ===== Each objective =====

// The free basic set of one member as a fresh record (Expedition.fieldKits.freeBasics; absent = none). Pure.
export function freeBasicsOf(exp: Pick<Expedition, "fieldKits">): KitCounts {
  const out: KitCounts = {};
  const set = exp.fieldKits?.freeBasics;
  if (!set) return out;
  for (const id of FIELD_KIT_IDS) {
    const n = hasOwn(set, id) ? whole(set[id]) : 0;
    if (n > 0) out[id] = n;
  }
  return out;
}

// Every Security member of `securityIds` holding a fresh free basic set, or undefined when the set is empty. Pure.
export function freshBasicsFor(exp: Pick<Expedition, "fieldKits">, securityIds: readonly string[]): Record<string, KitCounts> | undefined {
  const set = freeBasicsOf(exp);
  if (Object.keys(set).length === 0 || securityIds.length === 0) return undefined;
  const out: Record<string, KitCounts> = {};
  for (const id of securityIds) out[id] = { ...set };
  return out;
}

// The crew lands on an objective (see the module header): every Security member's free basics refill, every grenade
// charge resets to full. A run without flag 2 is left untouched. Mutates the crew's teams.
export function refreshObjectiveSupplies(exp: Pick<Expedition, "fieldKits">, crew: readonly GroundTeamRun[]): void {
  if (!fieldKitsLive(exp)) return;
  for (const team of crew) {
    const basics = freshBasicsFor(exp, team.securityIds);
    if (basics) team.basics = basics;
    else delete team.basics;
    delete team.charges;
  }
}

// ===== Each fight =====

// A fight ended (see the module header): its spends come off each crew team's run and its Injury Kit shares go on the
// treated member's trip treatment. `ownerOf` = the crew team a member belongs to. A run without flag 2 is left
// untouched. Mutates the crew's teams.
export function spendFightSupplies(
  exp: Pick<Expedition, "fieldKits" | "roster">,
  crew: readonly GroundTeamRun[],
  record: Pick<GroundFightRecord, "chargesUsed" | "basicsUsed" | "kitsUsed" | "treated">,
  ownerOf: (memberId: string) => GroundTeamRun,
): void {
  if (!fieldKitsLive(exp)) return;
  for (const team of crew) {
    const held = { securityIds: team.securityIds, charges: team.charges, basics: team.basics, kits: team.kits };
    const left = fightSuppliesAfter(held, record, exp.roster?.security);
    if (left === held) continue;
    if (left.charges) team.charges = { ...left.charges };
    if (left.basics) team.basics = structuredClone(left.basics) as Record<string, KitCounts>;
    if (left.kits) team.kits = structuredClone(left.kits) as Record<string, KitCounts>;
  }
  for (const [memberId, share] of Object.entries(record.treated ?? {})) {
    if (!(typeof share === "number" && Number.isFinite(share) && share > 0)) continue;
    const owner = ownerOf(memberId);
    owner.treatment = { ...(owner.treatment ?? {}), [memberId]: (owner.treatment?.[memberId] ?? 0) + share };
  }
}

// ===== Claim =====

// The extras every team of the run still carries, summed per kit (spent ones are gone; basics never count). Pure.
export function carriedExtras(exp: Pick<Expedition, "groundOps">): KitCounts {
  const out: KitCounts = {};
  for (const team of exp.groundOps?.teams ?? []) {
    for (const pack of Object.values(team.kits ?? {})) {
      for (const id of FIELD_KIT_IDS) {
        const n = whole(pack[id]);
        if (n > 0) out[id] = (out[id] ?? 0) + n;
      }
    }
  }
  return out;
}

// The claim brings the carried extras home (call 17: even over the warehouse cap, no loss; call 16: kits ignore
// quality, so they land in the base bucket). The SAME state when the run carries none (every run without flag 2). Pure.
export function returnCarriedExtras(state: GameState, exp: Pick<Expedition, "groundOps">): GameState {
  const back = carriedExtras(exp);
  const ids = FIELD_KIT_IDS.filter((id) => (back[id] ?? 0) > 0);
  if (ids.length === 0) return state;
  let inventory = state.inventory;
  let discovered = state.discovered;
  for (const id of ids) {
    inventory = addItemQuality(inventory, id, new Decimal(back[id] ?? 0), 0);
    discovered = withDiscovered(discovered, id); // canonical order (canonicalOrder.ts)
  }
  return { ...state, inventory, discovered };
}
