// Wiring WR-9 fix round (user 2026-10-31, "Yes, grant on load"): crew already at a rank that carries three buffs
// (Lieutenant, Lieutenant Commander) but rolled before WR-9 (no buff3Id) roll their third buff ONCE, the first time
// the save loads (save.ts migrate, an every-load idempotent pass like the other V70 passes, no SAVE_VERSION bump).
//
// The roll is the generator's rule (crewGeneration.ts: a profession buff the crewmember does not already hold), drawn
// from a PRIVATE stream seeded from the crewmember's own identity, never a shared stream and never Math.random:
//   a notable           its stable id
//   a bucket member     the seed its manifest name comes from (crewGraduation.ts manifestSeed of its ship, or "pool"
//                       for the unassigned pool, and its bucket key) and its index in the bucket
// Idempotent: a crewmember holding a third buff is never touched, so a second load rerolls nothing. Members of one
// bucket whose rolls differ split into one bucket per third buff (merged into any bucket already of that signature).

import { WR9_SWITCH, type CrewBucket, type CrewBuffId, type CrewSignature, type GameState, type NotableCrewMember } from "./model";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { buffCountForRank } from "./crewRank";
import { signatureKey } from "./crew";
import { manifestSeed } from "./crewGraduation";
import { makeRng } from "./combat/rng";

// The salt of the grant's seeds (unique in the repo; odd).
export const THIRD_BUFF_GRANT_SALT = 0x6b2d9e47;
// The location a pool member's seed names (a ship id never reads this).
export const THIRD_BUFF_POOL_LOCATION = "pool";

function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Mix a base seed and a member index into one stream seed (crewGeneration.ts crewSeed's shape). Pure.
function memberSeed(seed: number, index: number): number {
  let h = ((seed ^ THIRD_BUFF_GRANT_SALT) >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ ((index + 1) >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// Does this crewmember lack the third buff its rank carries? Pure.
export function needsThirdBuff(sig: CrewSignature): boolean {
  return sig.buff3Id === undefined && buffCountForRank(sig.rank) >= 3;
}

// The third buff a crewmember of `sig` rolls on the stream `seed`: one draw from its profession pool without the buffs
// it holds; undefined when that pool has nothing left (no pool is that small). Pure.
export function grantedThirdBuff(sig: CrewSignature, seed: number): CrewBuffId | undefined {
  const left = (CREW_PROFESSION_BUFFS[sig.profession] ?? []).filter((b) => b.id !== sig.buff1Id && b.id !== sig.buff2Id);
  if (left.length === 0) return undefined;
  return left[makeRng(seed).nextInt(left.length)].id;
}

// A notable's grant seed (its stable id). Pure.
export function notableThirdBuffSeed(id: string): number {
  return memberSeed(fnv1a(id), 0);
}

// A bucket member's grant seed: its manifest name seed at `location` and its index in the bucket. Pure.
export function bucketMemberThirdBuffSeed(location: string, sig: CrewSignature, index: number): number {
  return memberSeed(manifestSeed(location, signatureKey(sig)), index);
}

// One bucket list with the grant applied: the SAME list when no member needs it. Pure.
export function withThirdBuffBuckets(list: CrewBucket[], location: string): CrewBucket[] {
  if (!list.some((b) => b && b.count > 0 && needsThirdBuff(b))) return list;
  const out: CrewBucket[] = [];
  const put = (b: CrewBucket): void => {
    const at = out.findIndex((o) => signatureKey(o) === signatureKey(b));
    if (at === -1) out.push(b);
    else out[at] = { ...out[at], count: out[at].count + b.count };
  };
  for (const b of list) {
    if (!(b && b.count > 0 && needsThirdBuff(b))) {
      out.push(b);
      continue;
    }
    // Each member rolls on its own seed; the counts per third buff keep the order the members first rolled them.
    const counts = new Map<string, number>();
    let none = 0;
    for (let i = 0; i < b.count; i++) {
      const id = grantedThirdBuff(b, bucketMemberThirdBuffSeed(location, b, i));
      if (id === undefined) none += 1;
      else counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [buff3Id, count] of counts) put({ ...b, buff3Id, count });
    if (none > 0) put({ ...b, count: none });
  }
  return out;
}

// One notable with the grant applied (the SAME object when it needs none). Pure.
export function withThirdBuffNotable(n: NotableCrewMember): NotableCrewMember {
  if (!n || !needsThirdBuff(n)) return n;
  const buff3Id = grantedThirdBuff(n, notableThirdBuffSeed(n.id));
  return buff3Id === undefined ? n : { ...n, buff3Id };
}

// THE load pass: every ship's complement, the unassigned pool and the notable roster. The SAME state when nothing needs
// the grant (every save after its first WR-9 load, and every save without such crew), or with WR-9 off (test switch).
export function withThirdBuffGrantedV70(state: GameState): GameState {
  if (!WR9_SWITCH.live || !state || typeof state !== "object") return state;
  let changed = false;
  const ships = Array.isArray(state.ships)
    ? state.ships.map((sh) => {
        const buckets = sh?.complement?.buckets;
        if (!Array.isArray(buckets)) return sh;
        const next = withThirdBuffBuckets(buckets, sh.id);
        if (next === buckets) return sh;
        changed = true;
        return { ...sh, complement: { ...sh.complement!, buckets: next } };
      })
    : state.ships;
  const pool = Array.isArray(state.crewPool) ? withThirdBuffBuckets(state.crewPool, THIRD_BUFF_POOL_LOCATION) : state.crewPool;
  if (pool !== state.crewPool) changed = true;
  const notables = Array.isArray(state.notableCrew) ? state.notableCrew.map(withThirdBuffNotable) : state.notableCrew;
  if (Array.isArray(state.notableCrew) && notables.some((n, i) => n !== state.notableCrew[i])) changed = true;
  return changed ? { ...state, ships, crewPool: pool, notableCrew: notables } : state;
}
