// Expedition Tiers G2-1: SAVE v70 step 3, the per-save homeworld (save.ts withHomeworldV70; user G2 "Random for
// everyone"). A v69 save gets its own homeworld seed from the entropy migrate is given; everything else loads
// byte-identically, an in-flight run resolves unchanged through its claim, and the game's load path passes a real
// entropy draw.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import LZString from "lz-string";
import { freshState, type AwayMember, type GameState, type ShipGroundTeam } from "./model";
import { SAVE_KEY, SAVE_VERSION, deserialize, loadFromLocalStorage, migrate, serialize, withHomeworldV70, type SaveFile } from "./save";
import { advanceExpedition, claimExpedition } from "./expedition";
import { asPreRanksDispatch, plainAwayMember, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { homeworldPlacement, stateHomeworld } from "./galaxy";

const E1 = 0x0badf00d;
const E2 = 0x7e57ab1e;

// A v69 save of `state`: serialized, the homeworld removed (no v69 save holds one), the version set back.
function v69(state: GameState, createdAt = 0): SaveFile {
  const raw = JSON.parse(JSON.stringify(deserialize(serialize(state, createdAt)))) as SaveFile;
  delete (raw.state as unknown as Record<string, unknown>).homeworld;
  return { ...raw, version: 69 };
}
const withoutHomeworld = (s: GameState): Record<string, unknown> => {
  const rest = { ...s } as Record<string, unknown>;
  delete rest.homeworld;
  return rest;
};

// ship-1 with two Ground teams of six rank 10 members (the G2-0 golden crew, which reaches claim), one run in flight.
function crewedInFlight(): GameState {
  const base = freshState();
  const sec = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
  const sci = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: sec.slice(0, 3), science: sci.slice(0, 3), helpOthers: false },
    { kind: "ground", security: sec.slice(3), science: sci.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    gameTimeSeconds: 100_000,
    nextExpeditionId: 2,
    awayMembers: [...sec.map((id) => m(id, "security")), ...sci.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
  const res = asPreRanksDispatch(dispatchPastPropulsion(s, "ship-1", 1, "cand-0")); // the G2-0 golden 2 run (FKR-1 flag off)
  if (!res.success) throw new Error(`dispatch refused: ${res.reason}`);
  return res.next;
}
describe("G2-1: SAVE v70 step 3 seeds the homeworld", () => {
  // The load path reads localStorage: a minimal in-memory stand-in (save.test.ts precedent).
  const store = new Map<string, string>();
  const previous = (globalThis as Record<string, unknown>).localStorage;
  beforeAll(() => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string): void => void store.set(k, String(v)),
      removeItem: (k: string): void => void store.delete(k),
      clear: (): void => store.clear(),
    };
  });
  afterAll(() => {
    (globalThis as Record<string, unknown>).localStorage = previous;
  });

  it("v70 stays the shared bump (no v71)", () => {
    expect(SAVE_VERSION).toBe(71); // E5-1 took v71 (the board evacuation stamp); this feature added no bump
  });

  it("a v69 save gets { version: 1, seed: entropy }; everything else is byte-identical", () => {
    const raw = v69(freshState());
    const out = migrate(raw, E1);
    expect(out.homeworld).toEqual({ version: 1, seed: E1 });
    // The same save stamped v70 (no steps run) is the reference for every other field.
    const reference = migrate({ ...raw, version: 70 }, E2);
    expect(withoutHomeworld(out)).toEqual(withoutHomeworld(reference));
  });

  it("a save ALREADY at v70 with no homeworld (an earlier v70 build) gets one on load; one that has it keeps it", () => {
    // Dev and QA saves migrated by a v70 build from before G2-1 never run MIGRATIONS[69] again: migrate backfills
    // them after the loop (user G2: "Random for everyone", never the shared near-Sol spot).
    const bare = { ...v69(freshState()), version: 70 };
    expect(migrate(bare, E1).homeworld).toEqual({ version: 1, seed: E1 });
    const held = { ...bare, state: { ...bare.state, homeworld: { version: 1 as const, seed: 42 } } };
    const kept = migrate(held, E1);
    expect(kept.homeworld).toEqual({ version: 1, seed: 42 });
    expect(kept.homeworld).toBe(held.state.homeworld); // the same reference: the backfill is a no-op
    // The game's load path: a real draw, never the provisional spot.
    expect(stateHomeworld(migrate(bare, E2))).toEqual(homeworldPlacement(E2));
  });

  it("each existing save gets its own homeworld: different entropy, different placement", () => {
    const a = migrate(v69(freshState()), E1);
    const b = migrate(v69(freshState()), E2);
    expect(a.homeworld!.seed).not.toBe(b.homeworld!.seed);
    expect(stateHomeworld(a)).toEqual(homeworldPlacement(E1));
    expect(stateHomeworld(a).galactic).not.toEqual(stateHomeworld(b).galactic);
  });

  it("an in-flight run is unchanged by the migration and resolves identically through its claim", () => {
    const held = crewedInFlight();
    const restored = migrate(v69(held), E1);
    expect(restored.expeditions).toEqual(held.expeditions);
    const far = 3_000_000;
    const doneHeld = advanceExpedition(held.expeditions[0], far);
    const doneRestored = advanceExpedition(restored.expeditions[0], far);
    expect(doneRestored).toEqual(doneHeld);
    expect(doneRestored.phase).toBe("complete");
    const claimHeld = claimExpedition({ ...held, expeditions: [doneHeld] }, doneHeld.id);
    const claimRestored = claimExpedition({ ...restored, expeditions: [doneRestored] }, doneRestored.id);
    expect(claimRestored.success).toBe(true);
    // Everything the claim wrote matches, apart from the homeworld, SF-1's derived run counters (step 2's business) and
    // the board E5-1's v70 -> v71 step stamps (save.test.ts's business).
    const norm = (s: GameState): Record<string, unknown> => {
      const out = withoutHomeworld(migrate(deserialize(serialize(s, 0))!));
      delete out.runCounts;
      delete out.shortRangeBoard;
      return out;
    };
    expect(norm(claimRestored.next)).toEqual(norm(claimHeld.next));
  });

  it("is idempotent and keeps a well-formed homeworld (the same reference); a migrated save round-trips", () => {
    const once = migrate(v69(freshState()), E1);
    const again = deserialize(serialize(once, 0))!;
    expect(migrate({ ...again, version: 69 }, E2).homeworld).toEqual({ version: 1, seed: E1 });
    const kept = { homeworld: { version: 1, seed: 7 }, other: 1 };
    expect(withHomeworldV70(kept, E2)).toBe(kept);
    expect(migrate(again).homeworld).toEqual({ version: 1, seed: E1 });
  });

  it("is hardened: a malformed homeworld is replaced, a non-object state passes through, junk entropy reads 0", () => {
    for (const bad of [null, "x", 5, { version: 2, seed: 1 }, { version: 1, seed: 1.5 }, { version: 1, seed: -3 }, { version: 1, seed: 2 ** 32 }]) {
      expect(withHomeworldV70({ homeworld: bad }, E1)).toEqual({ homeworld: { version: 1, seed: E1 } });
    }
    expect(withHomeworldV70(null, E1)).toBeNull();
    expect(withHomeworldV70("junk", E1)).toBe("junk");
    expect(withHomeworldV70({}, Number.NaN)).toEqual({ homeworld: { version: 1, seed: 0 } });
    expect(withHomeworldV70({}, -1)).toEqual({ homeworld: { version: 1, seed: 0xffffffff } });
    expect(withHomeworldV70({}, 2 ** 32 + 9)).toEqual({ homeworld: { version: 1, seed: 9 } });
  });

  it("without entropy, migrate mixes the save's creation time: reproducible, and two saves differ", () => {
    const a1 = migrate(v69(freshState(), 1_700_000_000_000));
    const a2 = migrate(v69(freshState(), 1_700_000_000_000));
    const b = migrate(v69(freshState(), 1_700_000_000_001));
    expect(a1.homeworld).toEqual(a2.homeworld);
    expect(a1.homeworld!.seed).not.toBe(b.homeworld!.seed);
  });

  it("the game's load path passes a real entropy draw: two loads of one v69 save get different homeworlds", () => {
    // The stored blob is the v69 save itself (serialize would stamp the current version).
    const blob = LZString.compressToBase64(JSON.stringify(v69(freshState(), 5)));
    const seeds: number[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        localStorage.setItem(SAVE_KEY, blob);
        const loaded = loadFromLocalStorage();
        expect(loaded).not.toBeNull();
        seeds.push(loaded!.state.homeworld!.seed);
      }
    } finally {
      localStorage.removeItem(SAVE_KEY);
    }
    expect(seeds[0]).not.toBe(seeds[1]);
  });
});