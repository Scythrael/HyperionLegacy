// CP-8 (0.14.0, docs/plans/2026-10-14-complement-and-acquisition-plan.md, E-CREW Task 26 engine): GRADUATE, SEND BACK,
// RETIRE (CP-9) and the MANIFEST.
//
// Crew spec 255 to 258: names are "generated lazily and deterministically (seed = bucket signature + index) only when
// a manifest view is opened. Never persisted." "Standouts graduate into notableCrew (bounded list) with a persisted
// name; their bucket count drops by one." The user's rulings (2026-10-16):
//   - Notables are IDENTITY ONLY ("Let's keep it identity only"): a graduate gets a name and a record, no stat edge.
//     It stays ASSIGNED to the ship it came from, so the ship's caps and stats do not change: aboard, a notable counts
//     exactly like one crew of its signature (GL-1, crewOverlay.ts rawShipCrewContribution).
//   - OC-8 "50 fleet-wide (Recommended)": model.ts NOTABLE_CREW_CAP bounds the roster, assigned or not.
//   - OC-9 "Stays named (Recommended)": the name is seeded from the bucket and the notable id, and SEND BACK unassigns
//     the notable (it stays a named record; it never dissolves back into a bucket).
// Graduation and send back are crew changes, so both refuse while the ship involved is crew-locked (CP-6
// crewLock.ts shipCrewLocked). The manifest is a pure paged generator over a ship's bulk: never stored, stable across
// calls.
//
// WHY ITS OWN MODULE (the plan named crew.ts): the lock lives in crewLock.ts, which imports equipment.ts; crew.ts stays
// the dependency-free bucket primitives every crew module builds on. Nothing imports this module back.
//
// Determinism: no shared stream. Each name is generateCrewIdentity (crew.ts) on a private seed hashed from the
// bucket's signature (and the ship, for the manifest) with this module's own salt. Pure: reads state, returns new
// values, never mutates an input. No clock.

import { NOTABLE_CREW_CAP, type CrewBucket, type CrewSignature, type GameState, type NotableCrewMember } from "./model";
import { generateCrewIdentity, removeFromBucketList, signatureKey } from "./crew";
import { crewLockText, shipCrewLocked } from "./crewLock";

// The private name streams (salts.test.ts checks they are odd and distinct from every other salt).
export const NOTABLE_NAME_SALT = 0x51ed2705;
export const MANIFEST_NAME_SALT = 0x0dd5c3a9;

// FNV-1a over a string: the stable 32-bit hash the name seeds start from. Pure.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// The seed of a graduate's name: the bucket's signature key with the notable salt. The notable id's number is the
// identity index, so two graduates from one bucket get different names. Pure.
export function graduateSeed(key: string): number {
  return (fnv1a(key) ^ NOTABLE_NAME_SALT) >>> 0;
}

// The seed of one bucket's manifest rows on one ship. Pure.
export function manifestSeed(shipId: string, key: string): number {
  return (fnv1a(`${shipId}|${key}`) ^ MANIFEST_NAME_SALT) >>> 0;
}

function bucketOn(state: GameState, shipId: string, key: string): CrewBucket | undefined {
  const ship = state.ships.find((s) => s.id === shipId);
  return ship?.complement?.buckets.find((b) => b.count > 0 && signatureKey(b) === key);
}

// ============================================================================
// Graduate
// ============================================================================

// Why a graduation is refused:
//   noShip:     the ship is no longer in the fleet
//   onMission:  the ship is crew-locked (crewLockText gives the accurate mission / expedition words)
//   noBucket:   the ship holds no crew of that group
//   notableCap: the fleet already has NOTABLE_CREW_CAP notables
export type GraduateBlockReason = "noShip" | "onMission" | "noBucket" | "notableCap";
export type GraduateGate = { ok: true } | { ok: false; reason: GraduateBlockReason };

// The player-facing words for a refusal (US English). EXHAUSTIVE with no default. Pure.
export function graduateBlockText(reason: GraduateBlockReason): string {
  switch (reason) {
    case "noShip":
      return "That ship is no longer in the fleet";
    case "onMission":
      return "Ship is out on a mission";
    case "noBucket":
      return "No crew of that group are aboard";
    case "notableCap":
      return `The fleet already has ${NOTABLE_CREW_CAP} notable crew. Retire one to make room`;
  }
}

// The player text for a gate, naming the real lock (mission vs expedition); undefined when it is open. Pure.
export function graduateGateText(state: GameState, shipId: string, gate: GraduateGate): string | undefined {
  if (gate.ok) return undefined;
  if (gate.reason === "onMission") return crewLockText(state, shipId) ?? graduateBlockText(gate.reason);
  return graduateBlockText(gate.reason);
}

// Can one crew member of the bucket `key` (crew.ts signatureKey) on `shipId` graduate? Checked in order: noShip,
// onMission, noBucket, notableCap. Either complement mode may graduate (the person stays aboard). Pure.
export function canGraduate(state: GameState, shipId: string, key: string): GraduateGate {
  if (!state.ships.some((s) => s.id === shipId)) return { ok: false, reason: "noShip" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  if (!bucketOn(state, shipId, key)) return { ok: false, reason: "noBucket" };
  if (state.notableCrew.length >= NOTABLE_CREW_CAP) return { ok: false, reason: "notableCap" };
  return { ok: true };
}

// The name and gender the NEXT graduate of bucket `key` would carry (the confirm shows it before the player
// commits): seeded from the bucket, indexed by the next notable id. Pure.
export function nextGraduateIdentity(state: GameState, sig: CrewSignature): { name: string; gender: string } {
  return generateCrewIdentity(sig.race, graduateSeed(signatureKey(sig)), state.nextNotableId);
}

export interface GraduateResult {
  next: GameState; // the SAME reference as the input when refused
  gate: GraduateGate;
  notable: NotableCrewMember | null; // the new record, null when refused
}

// Graduate one crew member of bucket `key` on `shipId`: the bucket drops by one (pruned at zero) and a notable with
// the same signature, a generated name and the next id joins state.notableCrew ASSIGNED to the same ship, so the
// ship's headcount, caps and stats are unchanged by the move. nextNotableId advances; it is never reused. Pure.
export function graduateStandout(state: GameState, shipId: string, key: string): GraduateResult {
  const gate = canGraduate(state, shipId, key);
  if (!gate.ok) return { next: state, gate, notable: null };
  const bucket = bucketOn(state, shipId, key)!;
  const identity = nextGraduateIdentity(state, bucket);
  const notable: NotableCrewMember = {
    id: `notable-${state.nextNotableId}`,
    profession: bucket.profession,
    rarity: bucket.rarity,
    rank: bucket.rank,
    race: bucket.race,
    buff1Id: bucket.buff1Id,
    buff2Id: bucket.buff2Id,
    ...(bucket.buff3Id !== undefined ? { buff3Id: bucket.buff3Id } : {}),
    name: identity.name,
    gender: identity.gender,
    assignedShipId: shipId,
  };
  const next: GameState = {
    ...state,
    notableCrew: [...state.notableCrew, notable],
    nextNotableId: state.nextNotableId + 1,
    ships: state.ships.map((s) =>
      s.id === shipId && s.complement
        ? { ...s, complement: { ...s.complement, buckets: removeFromBucketList(s.complement.buckets, bucket, 1) } }
        : s,
    ),
  };
  return { next, gate, notable };
}

// ============================================================================
// Send back (OC-9: unassign, the notable stays named)
// ============================================================================

//   noNotable: no notable with that id
//   notAboard: the notable is not assigned to a ship
//   onMission: its ship is crew-locked
export type SendBackBlockReason = "noNotable" | "notAboard" | "onMission";
export type SendBackGate = { ok: true } | { ok: false; reason: SendBackBlockReason };

export function sendBackBlockText(reason: SendBackBlockReason): string {
  switch (reason) {
    case "noNotable":
      return "That crew member is no longer on the roster";
    case "notAboard":
      return "Not aboard a ship";
    case "onMission":
      return "Ship is out on a mission";
  }
}

// The player text for a gate, naming the real lock; undefined when it is open. Pure.
export function sendBackGateText(state: GameState, notableId: string, gate: SendBackGate): string | undefined {
  if (gate.ok) return undefined;
  if (gate.reason === "onMission") {
    const shipId = state.notableCrew.find((n) => n.id === notableId)?.assignedShipId ?? null;
    return (shipId === null ? null : crewLockText(state, shipId)) ?? sendBackBlockText(gate.reason);
  }
  return sendBackBlockText(gate.reason);
}

export function canSendBackNotable(state: GameState, notableId: string): SendBackGate {
  const notable = state.notableCrew.find((n) => n.id === notableId);
  if (!notable) return { ok: false, reason: "noNotable" };
  const shipId = notable.assignedShipId ?? null;
  if (shipId === null) return { ok: false, reason: "notAboard" };
  if (shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  return { ok: true };
}

// Send a notable back to the pool of notables: it leaves its ship (assignedShipId null) and keeps its name, buffs and
// favorite; roster pins are untouched. Its slot frees, so a passive ship refills it from the crew pool on the next
// tick. The SAME state when refused. Pure.
export function sendBackNotable(state: GameState, notableId: string): GameState {
  if (!canSendBackNotable(state, notableId).ok) return state;
  return {
    ...state,
    notableCrew: state.notableCrew.map((n) => (n.id === notableId ? { ...n, assignedShipId: null } : n)),
  };
}

// ============================================================================
// Retire (CP-9 user call 2026-11-02 "Allow Retire (Recommended)")
// ============================================================================
// A notable leaves the fleet with a farewell line, no penalty, and frees one slot under NOTABLE_CREW_CAP. It works
// aboard a ship or not; aboard, the ship's crew count drops by that one (a passive ship refills the berth from the pool
// on a later tick, the same as after Send back). Refused while its ship is crew-locked, the same as Send back. Only a
// player action calls it (never the tick), so no golden and no offline path moves, and no save field is added.

//   noNotable: no notable with that id
//   onMission: it is aboard a crew-locked ship
export type RetireBlockReason = "noNotable" | "onMission";
export type RetireGate = { ok: true } | { ok: false; reason: RetireBlockReason };

export function retireBlockText(reason: RetireBlockReason): string {
  switch (reason) {
    case "noNotable":
      return "That crew member is no longer on the roster";
    case "onMission":
      return "Ship is out on a mission";
  }
}

export function canRetireNotable(state: GameState, notableId: string): RetireGate {
  const notable = state.notableCrew.find((n) => n.id === notableId);
  if (!notable) return { ok: false, reason: "noNotable" };
  const shipId = notable.assignedShipId ?? null;
  if (shipId !== null && shipCrewLocked(state, shipId)) return { ok: false, reason: "onMission" };
  return { ok: true };
}

// The player text for a gate, naming the real lock; undefined when it is open. Pure.
export function retireGateText(state: GameState, notableId: string, gate: RetireGate): string | undefined {
  if (gate.ok) return undefined;
  if (gate.reason === "onMission") {
    const shipId = state.notableCrew.find((n) => n.id === notableId)?.assignedShipId ?? null;
    return (shipId === null ? null : crewLockText(state, shipId)) ?? retireBlockText(gate.reason);
  }
  return retireBlockText(gate.reason);
}

// Retire a notable: its record leaves state.notableCrew and its id leaves every Personnel roster's pins (a roster
// skips an unknown id anyway; dropping it keeps the pin lists truthful). nextNotableId does not move, so an id is
// never reused. The SAME state when refused. Pure.
export function retireNotable(state: GameState, notableId: string): GameState {
  if (!canRetireNotable(state, notableId).ok) return state;
  const pinned = state.personnelRosters.some((r) => r.pinnedNotableCrew.includes(notableId));
  return {
    ...state,
    notableCrew: state.notableCrew.filter((n) => n.id !== notableId),
    ...(pinned
      ? {
          personnelRosters: state.personnelRosters.map((r) =>
            r.pinnedNotableCrew.includes(notableId) ? { ...r, pinnedNotableCrew: r.pinnedNotableCrew.filter((id) => id !== notableId) } : r,
          ),
        }
      : {}),
  };
}

// ============================================================================
// The manifest (a pure paged generator, never stored)
// ============================================================================

export interface ManifestRow {
  index: number; // the row's place in the whole manifest (0-based)
  signatureKey: string; // the bucket the person belongs to
  rowInBucket: number; // 0-based within that bucket
  profession: CrewSignature["profession"];
  rarity: CrewSignature["rarity"];
  rank: CrewSignature["rank"];
  race: CrewSignature["race"];
  buff1Id: CrewSignature["buff1Id"];
  buff2Id: CrewSignature["buff2Id"];
  buff3Id?: CrewSignature["buff3Id"];
  name: string;
  gender: string;
}

export interface ManifestPage {
  rows: ManifestRow[];
  total: number; // the ship's bulk headcount (every row the manifest could show)
}

// Rows [offset, offset + limit) of a ship's manifest: every head of its bulk complement, bucket by bucket in the
// complement's own order, row i of a bucket named generateCrewIdentity(race, manifestSeed(shipId, key), i). Pure and
// stable: the same state gives the same rows on every call, and a row keeps its name while its bucket holds it.
// Notables are not rows (they carry their own persisted names). Cost is O(buckets + limit). An unknown ship, a
// negative offset (read as 0) or a limit below 1 give what they can (possibly no rows).
// CP-9: an optional `profession` narrows the manifest to one division (the Manifest's division chips). Indexes and the
// total then count that division only; every name is unchanged, since a name hangs on the ship, the bucket and the row
// within the bucket, never on the row's place in the list. Omitted, the manifest is exactly the CP-8 one.
export function manifestRows(
  state: GameState,
  shipId: string,
  offset: number,
  limit: number,
  profession?: CrewSignature["profession"] | null,
): ManifestPage {
  const all = state.ships.find((s) => s.id === shipId)?.complement?.buckets ?? [];
  const buckets = profession === undefined || profession === null ? all : all.filter((b) => b.profession === profession);
  const total = buckets.reduce((n, b) => n + Math.max(0, b.count), 0);
  const rows: ManifestRow[] = [];
  const start = Math.max(0, Math.floor(offset));
  const want = Math.max(0, Math.floor(limit));
  let skipped = 0;
  for (const b of buckets) {
    if (rows.length >= want) break;
    const count = Math.max(0, b.count);
    if (skipped + count <= start) {
      skipped += count;
      continue;
    }
    const key = signatureKey(b);
    const seed = manifestSeed(shipId, key);
    for (let i = Math.max(0, start - skipped); i < count && rows.length < want; i += 1) {
      const identity = generateCrewIdentity(b.race, seed, i);
      rows.push({
        index: skipped + i,
        signatureKey: key,
        rowInBucket: i,
        profession: b.profession,
        rarity: b.rarity,
        rank: b.rank,
        race: b.race,
        buff1Id: b.buff1Id,
        buff2Id: b.buff2Id,
        ...(b.buff3Id !== undefined ? { buff3Id: b.buff3Id } : {}),
        name: identity.name,
        gender: identity.gender,
      });
    }
    skipped += count;
  }
  return { rows, total };
}
