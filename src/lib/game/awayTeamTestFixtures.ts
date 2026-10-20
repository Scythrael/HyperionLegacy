// TEST-ONLY fixtures (imported by *.test.ts files, never by app code).
//
// D18 MINIMUM AWAY TEAM (user, 2026-10-06): startExpedition refuses a ship without at least 1 ready
// Security AND 1 ready Science member. Every test that dispatches an expedition from a fresh state goes
// through withMinimumAwayTeam so it keeps testing what it tested before (sensors, museum, relics, phases)
// rather than the gate. The members are plain: rank 1, no traits, no gear, no own program.

import { SHIP_TYPES, type AwayMember, type AwayTeamType, type Expedition, type GameState, type ShipGroundTeam, type ShipTypeDef, type ShipTypeKey } from "./model";
import { BANKED_SYSTEMS, SYSTEM_SALT, expeditionAwayTeamCheck, type ExpeditionCandidate } from "./expedition";
import { PROVISIONAL_HOMEWORLD, type HomeworldPlacement } from "./galaxy";
import { systemDistanceLy } from "./telescope";
import { makeRng } from "./combat/rng";
import { V67_GROUND_TEAM_COUNT, emptyGroundTeams, shipsWithMemberAutoSlotted } from "./groundTeams";
import { byIdNumber } from "./awayTeam";
import { NEUTRAL_SHIP_EVENT_PROFILE } from "./groundOps";
import { N_FULL, runCountsOf } from "./runDifficulty";

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
// (withoutShipEvents). Field Kits FKR-1: nor enemy ranks (withoutEnemyRanks).
// Safe first runs SF-2: nor the training run (withoutSafeFirstRuns).
export function withoutRisk(exp: Expedition): Expedition {
  const rest = { ...withoutShipEvents(withoutEnemyRanks(withoutSafeFirstRuns(exp))) };
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
// Field Kits FKR-1: a run dispatched before AF-1 never had enemy ranks either, so the flag comes off too
// (withoutEnemyRanks), on every run. Safe first runs SF-2: nor the training run (withoutSafeFirstRuns).
export function withoutAffixes(raw: Expedition): Expedition {
  const exp = withoutEnemyRanks(withoutSafeFirstRuns(raw));
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

// Field Kits FKR-1 (enemy ranks): the run WITHOUT its enemy ranks flag (`Expedition.enemyRanks`), i.e. the run the
// same dispatch produced before FKR-1: every enemy Normal. Only the flag is stamped at dispatch (a fight's record
// `ranks` appears only once a ranked run fights), so a dispatch record loses just that key. A run without the flag is
// returned as it is; every other key keeps its order. Golden fixtures that dispatch (SF-0, G2-0, CP-0, WR-4 and the
// earlier gates) strip it with this, so they keep proving nothing else moved. Pure: a shallow copy.
export function withoutEnemyRanks(exp: Expedition): Expedition {
  if (!("enemyRanks" in exp)) return exp;
  const rest = { ...exp };
  delete rest.enemyRanks;
  return rest;
}

// A whole state with every expedition through withoutEnemyRanks (a fixture that dispatches through tick or holds the
// state between steps). Identity when no run carries the flag. Pure.
export function withoutEnemyRanksState(state: GameState): GameState {
  if (!state.expeditions.some((e) => "enemyRanks" in e)) return state;
  return { ...state, expeditions: state.expeditions.map(withoutEnemyRanks) };
}

// Field Kits FKR-1: a dispatch result turned into the run it was before FKR-1: the returned expedition and every
// expedition in `next` lose the enemy ranks flag (withoutEnemyRanks). Tests that pin a real dispatch's pre-rank
// trajectory (a seed picked for a wipe, a reinforcement, a stall) dispatch through this. A refusal is returned
// unchanged. Pure.
export function asPreRanksDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return { ...res, expedition: withoutEnemyRanks(res.expedition), next: withoutEnemyRanksState(res.next) };
}

// Safe first runs SF-2 (docs/plans/2026-10-15-safe-first-runs-plan.md): the run as the same dispatch made it BEFORE
// SF-2, i.e. a run in flight at the update: no training run stamp (`Expedition.difficulty`, written only on the
// training run) and the retired 30 minute shakedown back on the account's first run (`shakedown` true on
// "expedition-1", the pre-SF-2 rule nextExpeditionId === 1). Nothing else in a dispatch record differs, and every
// run below the stamp then resolves exactly as before SF-2 (the in-flight path). Every other key keeps its order. A
// record already in that shape is returned as it is. Golden fixtures that pin a dispatch from before SF-2 (FK-3,
// FKR-0, CP-0, WR-4, the G2-0 shakedowns and the earlier gates) strip it with this. Pure: a shallow copy.
// Expedition Tiers G2-3: a run from before SF-2 had no voyage either (withoutVoyage), so it flies the fixed legs.
export function withoutSafeFirstRuns(exp: Expedition): Expedition {
  const shakedown = exp.id === "expedition-1";
  if (!("difficulty" in exp) && !("voyage" in exp) && exp.shakedown === shakedown) return exp;
  const rest = { ...withoutVoyage(exp), shakedown };
  delete rest.difficulty;
  return rest;
}

// A whole state with every expedition through withoutSafeFirstRuns. Identity when nothing changes. Pure.
export function withoutSafeFirstRunsState(state: GameState): GameState {
  if (state.expeditions.every((e) => withoutSafeFirstRuns(e) === e)) return state;
  return { ...state, expeditions: state.expeditions.map(withoutSafeFirstRuns) };
}

// Safe first runs SF-2: a dispatch result turned into the run it was before SF-2 (withoutSafeFirstRuns on the
// returned expedition and every expedition in `next`). A refusal is returned unchanged. Pure.
export function asPreSafeFirstRunsDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return { ...res, expedition: withoutSafeFirstRuns(res.expedition), next: withoutSafeFirstRunsState(res.next) };
}

// Expedition Tiers G2-2 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md G2-2): the run as the same dispatch made it
// BEFORE G2-2, i.e. a run in flight at the update: its BANKED name back (`targetSystemId` / `systemName`: the pick on
// the system stream's first draw, which G2-2 keeps and no longer reads) and no region stamp (`Expedition.region`).
// Nothing else in a Tier I dispatch record differs (bodies, risk and objectives draw as before; the tier haul is x1
// and reads the stamp), so a golden pinned before G2-2 compares through this. A Tier I candidate that G2-2 names
// after a real star (Wolf 359 in the list after the first run) gets its banked name back the same way. Every other
// key keeps its order. Pure: a shallow copy.
// Expedition Tiers G2-3: a run from before G2-2 had no voyage either, so this also drops `Expedition.voyage`
// (withoutVoyage): the run then flies the fixed pre-G2-3 legs it flew when the golden was pinned.
export function withoutG2Names(exp: Expedition): Expedition {
  const banked = BANKED_SYSTEMS[makeRng((exp.seed ^ SYSTEM_SALT) >>> 0).nextInt(BANKED_SYSTEMS.length)];
  if (!("region" in exp) && !("voyage" in exp) && exp.targetSystemId === banked.id && exp.systemName === banked.name) return exp;
  const rest = { ...withoutVoyage(exp), targetSystemId: banked.id, systemName: banked.name };
  delete rest.region;
  return rest;
}

// Expedition Tiers G2-3 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md G2-3): the run as the same dispatch made it
// BEFORE G2-3, i.e. a run in flight at the update: no voyage (`Expedition.voyage`), so it flies the fixed pre-G2-3
// legs (expedition.ts TRANSIT_SECONDS, the flat anomaly hour). Nothing else in a dispatch record differs. A record
// without one is returned as it is. Every other key keeps its order. Pure: a shallow copy.
export function withoutVoyage(exp: Expedition): Expedition {
  if (!("voyage" in exp)) return exp;
  const rest = { ...exp };
  delete rest.voyage;
  return rest;
}

// G2-3: a dispatch result turned into the run it was before G2-3 (withoutVoyage on the returned expedition and every
// expedition in `next`). A refusal is returned unchanged. Pure.
export function asPreVoyageDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return { ...res, expedition: withoutVoyage(res.expedition), next: { ...res.next, expeditions: res.next.expeditions.map(withoutVoyage) } };
}

// A whole state with every expedition through withoutG2Names. Identity when nothing changes. Pure.
export function withoutG2NamesState(state: GameState): GameState {
  if (state.expeditions.every((e) => withoutG2Names(e) === e)) return state;
  return { ...state, expeditions: state.expeditions.map(withoutG2Names) };
}

// G2-2: a Tier I console candidate as it was offered before G2-2: the id `cand-<slot>` (G2-2 reads `cand-1-<slot>`),
// the banked name, no `region` field, and the drawn distance from `home` (a FAMOUS system reads its real one since
// G2-2; the list after the first run holds Wolf 359). Every other key keeps its order. Goldens pinned before G2-2
// hash candidates through this (expeditionTiersGoldens.test.ts asserts nothing else moved). Pure: fresh objects.
export function asPreG2Candidate(c: ExpeditionCandidate, home: HomeworldPlacement = PROVISIONAL_HOMEWORLD): ExpeditionCandidate {
  const banked = BANKED_SYSTEMS[makeRng((c.seed ^ SYSTEM_SALT) >>> 0).nextInt(BANKED_SYSTEMS.length)];
  return {
    id: `cand-${c.index}`,
    index: c.index,
    seed: c.seed,
    systemId: banked.id,
    systemName: banked.name,
    foreknowledge: c.foreknowledge,
    telescope: { ...c.telescope, distanceLy: systemDistanceLy(c.seed, 1, home) },
  } as unknown as ExpeditionCandidate;
}

// G2-2: a dispatch result turned into the run it was before G2-2 (withoutG2Names on the returned expedition and every
// expedition in `next`). A refusal is returned unchanged. Pure.
export function asPreG2NamesDispatch<R extends { next: GameState; expedition?: Expedition }>(res: R): R {
  if (!res.expedition) return res;
  return { ...res, expedition: withoutG2Names(res.expedition), next: withoutG2NamesState(res.next) };
}

// Safe first runs SF-2: `state` as a save whose expedition training run is behind it and whose curve reads full
// strength (runDifficulty.ts: veteran, training done, N_FULL completed), so its next expedition from ANY hull is an
// ordinary run, exactly as before SF-2 (apart from the retired shakedown length). Tests that pin nominal play on an
// explorer from a fresh save go through this. Pure.
export function asExpeditionVeteran(state: GameState): GameState {
  const counts = runCountsOf(state);
  return { ...state, runCounts: { ...counts, expedition: { completed: N_FULL, trainingDone: true, veteran: true } } };
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
// Field Kits FKR-1: a run dispatched before AF-2 never had enemy ranks either (withoutEnemyRanks), on every run.
// Safe first runs SF-2: nor the training run (withoutSafeFirstRuns).
export function withoutAffixCatalog(raw: Expedition): Expedition {
  const exp = withoutEnemyRanks(withoutSafeFirstRuns(raw));
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
