// TEST-ONLY fixtures (imported by *.test.ts files, never by app code).
//
// D18 MINIMUM AWAY TEAM (user, 2026-10-06): startExpedition refuses a ship without at least 1 ready
// Security AND 1 ready Science member. Every test that dispatches an expedition from a fresh state goes
// through withMinimumAwayTeam so it keeps testing what it tested before (sensors, museum, relics, phases)
// rather than the gate. The members are plain: rank 1, no traits, no gear, no own program.

import { SHIP_TYPES, type AwayMember, type AwayTeamType, type Expedition, type GameState, type ShipGroundTeam, type ShipTypeDef, type ShipTypeKey } from "./model";
import { expeditionAwayTeamCheck } from "./expedition";
import { V67_GROUND_TEAM_COUNT, emptyGroundTeams, shipsWithMemberAutoSlotted } from "./groundTeams";
import { byIdNumber } from "./awayTeam";
import { NEUTRAL_SHIP_EVENT_PROFILE } from "./groundOps";

// Ground Operations (GO-1, and the GO-7c multi-team tests): register a SYNTHETIC hull under `key` in the
// shared SHIP_TYPES table, cloned from the General Freighter with the given `awayTeams` (undefined = a hull
// with no away-team data). Returns the cleanup that removes the entry again; call it in afterEach so no other
// test sees it. Squads SQ-1: the team count is `groundSquads` / 2 now (every real hull fields 2 teams), so
// `groundSquads` defaults to 2 x the Security entry's fixture `count` (0 without one): a pre-SQ-1 fixture written
// as "count 3" still fields 3 teams, and its v67 shape (the count) matches its v68 shape. WR-4 retired the live
// awayTeams[].count field, so `count` is a FIXTURE-ONLY shorthand here and never reaches the registered def.
export type SyntheticAwayTeam = NonNullable<ShipTypeDef["awayTeams"]>[number] & { count?: number };
export function registerSyntheticHull(
  key: ShipTypeKey,
  awayTeams: readonly SyntheticAwayTeam[] | undefined,
  groundSquads?: number,
): () => void {
  const table = SHIP_TYPES as Record<string, ShipTypeDef>;
  const def: ShipTypeDef = { ...SHIP_TYPES.generalFreighter };
  if (awayTeams === undefined) delete def.awayTeams;
  else def.awayTeams = awayTeams.map(({ teamType, size }) => ({ teamType, size }));
  def.groundSquads = groundSquads ?? 2 * (awayTeams?.find((t) => t.teamType === "security")?.count ?? 0);
  table[key] = def;
  return () => {
    delete table[key];
  };
}

// The state with every ship's `groundTeams` (Ground Ops GO-1, SAVE v67; team kinds since Squads SQ-1, v68)
// and the founding Subspace Telescope facility (`facilities.subspaceTelescope`, SQ-1, v68) removed. Golden
// hashes of a WHOLE state captured before GO-1 hash through this, so they keep proving that nothing else
// changed: the slot state and the telescope seed are inert data to those runs, and stripping them leaves
// every other key in its original order. Pure.
export function withoutGroundSquadState(state: GameState): GameState {
  const facilities = { ...state.facilities };
  delete facilities.subspaceTelescope;
  return {
    ...state,
    facilities,
    ships: state.ships.map((ship) => {
      const rest = { ...ship };
      delete rest.groundTeams;
      return rest;
    }),
  };
}

// Ground Ops (GO-7b): the run WITHOUT its `groundOps` record, i.e. the LEGACY run the same dispatch would have
// produced before the switch (the record's presence is the feature flag; nothing else in the dispatch record
// differs for a ship whose one ground team is slotted in hire order). Tests that pin legacy behavior dispatch,
// then strip the flag with this. Pure: a shallow copy (the input is never touched).
// Squads SQ-4: the risk profile is written only alongside groundOps, so a legacy run never had one; it comes off
// too (withoutRisk).
export function withoutGroundOps(exp: Expedition): Expedition {
  const rest = { ...withoutRisk(exp) } as Expedition & { groundOps?: unknown };
  delete rest.groundOps;
  return rest;
}

// Squads SQ-4: the run WITHOUT its risk profile (Expedition.risk and every body's `risk`), i.e. the FLAGGED run the
// same dispatch produced before SQ-4 (the profile's presence is the risk-aware flag; nothing else in the dispatch
// record differs). Tests that pin pre-SQ-4 flagged behavior dispatch, then strip it with this. Every other key
// keeps its order. Pure: shallow copies (the input is never touched).
// Ground Ops GO-8: a run dispatched before SQ-4 never had ship events either, so they come off too
// (withoutShipEvents).
export function withoutRisk(exp: Expedition): Expedition {
  const rest = { ...withoutShipEvents(exp) };
  delete rest.risk;
  rest.bodies = exp.bodies.map((b) => {
    const body = { ...b };
    delete body.risk;
    return body;
  });
  return rest;
}

// Ground Ops GO-8: the run WITHOUT its ship-side scan events, i.e. the FLAGGED run the same dispatch produced before
// GO-8: its ship-event profile back to the NEUTRAL one every earlier flagged run carried (no `battle` inputs, the
// ship-event flag; the frozen values were all 0 then). Its timeline then rolls no ship event. A legacy run is
// returned as it is. Every other key keeps its order. Pure: shallow copies.
export function withoutShipEvents(exp: Expedition): Expedition {
  if (!exp.groundOps) return exp;
  return { ...exp, groundOps: { ...exp.groundOps, shipEventProfile: { ...NEUTRAL_SHIP_EVENT_PROFILE } } };
}

// Objective affixes (AF-1): the run WITHOUT its affix flag, i.e. the risk-aware run the same dispatch produced
// before AF-1. The flag is the risk profile's `difficultyTier` (its presence makes a run affix-aware); a task
// stamped on an affix-aware run also carries `affixes`, `difficultyScore`, `alert` and `visits`, which come off
// too. Every other key keeps its order. A run without a profile is returned as it is. Pure: shallow copies.
export function withoutAffixes(exp: Expedition): Expedition {
  if (!exp.risk) return exp;
  const risk = { ...exp.risk } as Record<string, unknown>;
  delete risk.difficultyTier;
  delete risk.affixCatalog; // AF-2: a run before AF-1 never carried the catalog version either
  return {
    ...exp,
    risk: risk as unknown as Expedition["risk"],
    bodies: exp.bodies.map((b) => ({
      ...b,
      activities: b.activities.map((a) => {
        const task = { ...a } as Record<string, unknown>;
        for (const k of ["affixes", "difficultyScore", "alert", "visits"]) delete task[k];
        return task as unknown as typeof a;
      }),
    })),
  };
}

// Field Kits (FK-3, docs/plans/2026-10-14-field-kits-plan.md section 3): the run WITHOUT its Field Kits fields, i.e.
// the run the same dispatch produced before FK-6 stamps the flag: `Expedition.fieldKits` (the flag), each ground
// team's `kits` (packed kits remaining) and `treatment` (Injury Kit shares), and its pending fight record's
// `kitsUsed` / `treated`. None of these exist at FK-3, so today the result deep-equals its input; it is typed
// loosely (structural deletes of optional keys) so it compiles before and after the fields land. Every other key
// keeps its order. Pure: shallow copies (the input is never touched).
// Field Kits FKR-0 (REVISED SLICES R2, 2026-10-16): it also strips the revised fields, so every golden fixture is
// the run WITHOUT both flags: `Expedition.enemyRanks` (flag 1, FKR-1), each team's `basics` (the objective's free
// set left) and `charges` (tool charges left), and the pending fight's `basicsUsed` / `chargesUsed` / `ranks`.
// Still identity today (asserted by the goldens).
export function withoutFieldKits(exp: Expedition): Expedition {
  const rest = { ...exp } as Record<string, unknown>;
  delete rest.fieldKits;
  delete rest.enemyRanks;
  const ops = exp.groundOps;
  if (ops) {
    rest.groundOps = {
      ...ops,
      teams: ops.teams.map((t) => {
        const team = { ...t } as Record<string, unknown>;
        for (const k of ["kits", "treatment", "basics", "charges"]) delete team[k];
        if (t.pendingFight) {
          const fight = { ...t.pendingFight } as Record<string, unknown>;
          for (const k of ["kitsUsed", "treated", "basicsUsed", "chargesUsed", "ranks"]) delete fight[k];
          team.pendingFight = fight;
        }
        return team as unknown as typeof t;
      }),
    };
  }
  return rest as unknown as Expedition;
}

// Field Kits FKR-0 (the FK-3 carry note's STATE TWIN): the whole state WITHOUT the revised Field Kits fields, so a
// whole-state golden (a claim hash) keeps proving nothing else moved once FKR-7 writes state-side: every ship's
// ground teams lose `packs` (the per-member pack preference) and `topUp` (the Quartermaster top-up toggle), and
// every expedition goes through withoutFieldKits. Credits spent and kit stock are NOT stripped here: a fixture
// that packs or buys must strip them in its own comparison (FKR-7). A ship without groundTeams is left as it is.
// Identity today (asserted by the goldens). Pure: shallow copies.
export function withoutFieldKitsState(state: GameState): GameState {
  return {
    ...state,
    ships: state.ships.map((ship) => {
      if (!Array.isArray(ship.groundTeams)) return ship;
      return {
        ...ship,
        groundTeams: ship.groundTeams.map((t) => {
          const team = { ...t } as Record<string, unknown>;
          delete team.packs;
          delete team.topUp;
          return team as unknown as ShipGroundTeam;
        }),
      };
    }),
    expeditions: state.expeditions.map(withoutFieldKits),
  };
}

// Objective affixes (AF-2): the run WITHOUT its affix CATALOG version, i.e. the affix-aware run the same dispatch
// produced between AF-1 and AF-2 (its objectives stamp from AF-1's catalog, Reinforcing only, on AF-1's draw
// layout). Every other key keeps its order. A run without a profile is returned as it is. Pure: shallow copies.
export function withoutAffixCatalog(exp: Expedition): Expedition {
  if (!exp.risk) return exp;
  const risk = { ...exp.risk } as Record<string, unknown>;
  delete risk.affixCatalog;
  return { ...exp, risk: risk as unknown as Expedition["risk"] };
}

// A dispatch result whose expedition (and every expedition in `next`) lost its risk profile: the pre-SQ-4 flagged
// dispatch. A refusal is returned unchanged. Pure.
export function asPreRiskDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return {
    ...res,
    expedition: withoutRisk(res.expedition),
    next: { ...res.next, expeditions: res.next.expeditions.map(withoutRisk) },
  };
}

// Ground Ops (GO-7b): a dispatch result turned into the LEGACY run it would have been before the switch: the
// returned expedition and every expedition in `next` lose their groundOps flag. Tests that pin legacy behavior
// (the activities-phase battles, retries, evacuation, Task 16 injuries) dispatch through this. A refusal is
// returned unchanged. Pure.
export function asLegacyDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return {
    ...res,
    expedition: withoutGroundOps(res.expedition),
    next: { ...res.next, expeditions: res.next.expeditions.map(withoutGroundOps) },
  };
}

// The state as a v67 build held it (Squads SQ-1): every ship's groundTeams cut back to the v67 team count
// (groundTeams.ts V67_GROUND_TEAM_COUNT, 1) with each team's `kind` / `kindPending` removed, and the founding
// `facilities.subspaceTelescope` removed. Exactly the SQ-1 (v68) additions come off and every other key keeps
// its order, so a whole-state golden captured on v67 (groundOpsLegacy.test.ts claims) still proves nothing
// else moved. A ship without groundTeams is left as it is. Pure.
export function asV67GroundState(state: GameState): GameState {
  const facilities = { ...state.facilities };
  delete facilities.subspaceTelescope;
  return {
    ...state,
    facilities,
    ships: state.ships.map((ship) => {
      if (!Array.isArray(ship.groundTeams)) return ship;
      const teams = ship.groundTeams.slice(0, V67_GROUND_TEAM_COUNT).map((t) => {
        const rest: Partial<ShipGroundTeam> = { ...t };
        delete rest.kind;
        delete rest.kindPending;
        return rest as ShipGroundTeam;
      });
      return { ...ship, groundTeams: teams };
    }),
  };
}

// Ground Ops (GO-7b): every ship's ground-team slots refilled from its members in HIRE order, so a test that
// builds `awayMembers` by hand dispatches the same team the pre-switch "first N ready members in hire order"
// rule picked. Each ship gets its LIVE empty teams (model.ts emptyGroundTeams: Ground + Ground on every real
// hull, no pending flag), then the first `fillTeams` teams (default 1, the one team the pre-switch rule
// filled) take that ship's members of each type in hire order, team 0 first, up to each squad's size; the
// rest stay aboard unslotted (the reserve). Injury is ignored (as the v67 backfill did). Squads SQ-2: this is
// a test fixture and reads live hull data on purpose (the frozen migration fill, groundTeams.ts
// backfillV67ShipGroundTeams, knows only the hulls that existed at v67, never a synthetic test hull).
// The GO-7c multi-team tests pass the synthetic hull's team count. Pure.
export function withSlottedAwayTeams(state: GameState, fillTeams = 1): GameState {
  return {
    ...state,
    ships: state.ships.map((ship) => {
      const teams = emptyGroundTeams(ship.typeKey);
      const aboard = state.awayMembers.filter((m) => m.assignedShipId === ship.id);
      for (const teamType of ["security", "science"] as const) {
        const queue = aboard.filter((m) => m.teamType === teamType).sort(byIdNumber);
        let next = 0;
        for (const team of teams.slice(0, fillTeams)) {
          const slots = team[teamType];
          for (let i = 0; i < slots.length && next < queue.length; i += 1) {
            slots[i] = queue[next].id;
            next += 1;
          }
        }
      }
      return { ...ship, groundTeams: teams };
    }),
  };
}

// A plain away-team member assigned to `shipId`. Pure.
export function plainAwayMember(id: string, teamType: AwayTeamType, shipId: string): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: shipId,
  };
}

// The state with one plain Security and one plain Science member added to `shipId`'s squads (ids from
// nextAwayMemberId, which advances by two). Ground Ops (GO-7b): both are SLOTTED into the first empty slot
// of their squad (the hire auto-slot, groundTeamSlots.ts shipsWithMemberAutoSlotted), since dispatch now reads
// the slotted ground teams. Pure: returns a new state.
export function withMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const n = state.nextAwayMemberId;
  const security = plainAwayMember(`member-${n}`, "security", shipId);
  const science = plainAwayMember(`member-${n + 1}`, "science", shipId);
  const awayMembers = [...state.awayMembers, security, science];
  let ships = shipsWithMemberAutoSlotted(state.ships, shipId, security.id, "security", awayMembers);
  ships = shipsWithMemberAutoSlotted(ships, shipId, science.id, "science", awayMembers);
  return { ...state, ships, awayMembers, nextAwayMemberId: n + 2 };
}

// withMinimumAwayTeam only when `shipId` does not already field the D18 minimum (so a state that already
// carries its team, e.g. the `next` of an earlier dispatch, comes back as the SAME reference). A missing
// ship is returned unchanged (its refusal is the test's business). Pure.
export function ensureMinimumAwayTeam(state: GameState, shipId = "ship-1"): GameState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || expeditionAwayTeamCheck(state, ship).ok) return state;
  return withMinimumAwayTeam(state, shipId);
}
