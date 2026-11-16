// FR-C A1-2 (QA 2026-11-14): the WELCOME BATCH filled the fleet's TOTAL berths but not its ships. Transports roll random
// divisions and ranks, and each ship's division and rank caps (commandStructure.ts remainingCapacityForSignature) refused
// the mismatch, so explorers sat half empty while thousands of crew were swept to the Homeworld reserve. The welcome now
// sends crew for the seats that are open: one crewmember per open seat, of that seat's division and rank (after the crew
// already waiting take their share), so every passive ship is full and nothing spills over.
import { describe, expect, it } from "vitest";
import { freshState, type GameState, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { homeworldReserveCount } from "./homeworldReserve";
import { CREW_PROFESSIONS, complementTotalCap, remainingCapacityForSignature } from "./commandStructure";
import { TRANSPORT_BATCH_SIZE, TRANSPORT_WELCOME_PENDING, TRANSPORT_WINDOW_SECONDS, transportWindowIndex } from "./transports";
import { migrate, type SaveFile } from "./save";
import { withWelcomeSeatOff } from "./welcomeSeatSwitch.fixture";

const DAY = 86400;
const TYPES: readonly ShipTypeKey[] = ["eir", "aurora", "orion", "carrier", "destroyer", "generalFreighter", "prospectorMiner"];

function fleet(): GameState {
  const base = freshState();
  const extra = TYPES.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  return {
    ...base,
    ships: [...base.ships, ...extra],
    nextShipId: base.ships.length + extra.length + 1,
    gameTimeSeconds: 365 * DAY + 7,
    lastTransportWindow: TRANSPORT_WELCOME_PENDING,
  } as GameState;
}

const seated = (s: GameState) => s.ships.reduce((a, sh) => a + totalCrew(sh.complement?.buckets ?? []), 0);
const berths = (s: GameState) => s.ships.reduce((a, sh) => a + complementTotalCap(sh.typeKey), 0);

describe("the welcome batch fills every ship, seat by seat", () => {
  it("every passive ship is full after the welcome, with nothing swept to the reserve", () => {
    const s = fleet();
    const out = resolveCrew(s);
    for (const ship of out.ships) {
      const total = totalCrew(ship.complement?.buckets ?? []);
      expect(total, ship.typeKey).toBe(complementTotalCap(ship.typeKey));
      // No seat of any division or rank is left open.
      for (const profession of CREW_PROFESSIONS) {
        for (const rank of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
          const sig = { profession, rank, rarity: "standard", race: "earthBorn", buff1Id: "", buff2Id: null } as never;
          expect(remainingCapacityForSignature(ship.complement!, ship.typeKey, sig), `${ship.typeKey} ${profession} ${rank}`).toBe(0);
        }
      }
    }
    expect(seated(out)).toBe(berths(out));
    expect(homeworldReserveCount(out)).toBe(0);
    expect(totalCrew(out.crewPool)).toBe(0);
  });

  it("is deterministic (the same save welcomes the same crew)", () => {
    expect(resolveCrew(fleet()).ships).toEqual(resolveCrew(fleet()).ships);
  });

  it("a v54 save a year old: every berth filled once (no whole-transport rounding), marker at now, then ordinary transports", () => {
    const cur = fleet();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { officers, nextOfficerId, crewPool, notableCrew, nextNotableId, lastTransportWindow, ...pre } = cur as any;
    const save: SaveFile = {
      version: 54, created_at: 0, last_saved_at: 0, game_time_seconds: cur.gameTimeSeconds,
      state: { ...pre, ships: cur.ships.map(({ complement, ...rest }: any) => rest) } as any,
    };
    const migrated = migrate(save);
    expect(migrated.lastTransportWindow).toBe(TRANSPORT_WELCOME_PENDING);
    const out = resolveCrew(migrated);
    expect(seated(out)).toBe(berths(out));
    expect(totalCrew(out.crewPool) + homeworldReserveCount(out)).toBe(0);
    expect(out.lastTransportWindow).toBe(transportWindowIndex(migrated.gameTimeSeconds));
    const next = resolveCrew({ ...out, gameTimeSeconds: out.gameTimeSeconds + TRANSPORT_WINDOW_SECONDS });
    const all = (s: GameState) => seated(s) + totalCrew(s.crewPool) + homeworldReserveCount(s);
    expect(all(next)).toBe(all(out) + TRANSPORT_BATCH_SIZE);
  });

  it("crew already on hand take their seats first; the welcome sends only what the open seats still need", () => {
    const filled = resolveCrew(fleet());
    // Half the fleet's crew sent back to the pool: their seats are open again and the crew to fill them are waiting.
    const half = filled.ships.slice(0, 4);
    const waiting: GameState = {
      ...filled,
      crewPool: half.flatMap((sh) => sh.complement?.buckets ?? []),
      ships: filled.ships.map((sh, i) => (i < 4 ? { ...sh, complement: { buckets: [], mode: sh.complement?.mode ?? "passive" } } : sh)),
      lastTransportWindow: TRANSPORT_WELCOME_PENDING,
    };
    const onHand = totalCrew(waiting.crewPool);
    const out = resolveCrew(waiting);
    expect(seated(out)).toBe(berths(out));
    // Fewer welcome crew than the seats that were open: the waiting crew took theirs.
    const open = berths(waiting) - seated(waiting);
    const sent = seated(out) + totalCrew(out.crewPool) + homeworldReserveCount(out) - seated(waiting) - onHand;
    expect(sent).toBeLessThan(open);
  });

  // FR-C fix pass (the reviewer's probe): every crewmember sent back to the pool, welcome pending. The crew on hand fill
  // every seat exactly, so a rank- and division-aware seating strands nobody and the welcome mints nobody.
  it("all crew back in the pool: every one is seated, nobody is stranded and nobody new is minted", () => {
    const filled = resolveCrew(fleet());
    const waiting: GameState = {
      ...filled,
      crewPool: filled.ships.flatMap((sh) => sh.complement?.buckets ?? []),
      ships: filled.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: sh.complement?.mode ?? "passive" } })),
      lastTransportWindow: TRANSPORT_WELCOME_PENDING,
    };
    const onHand = totalCrew(waiting.crewPool);
    expect(onHand).toBe(berths(waiting));
    const out = resolveCrew(waiting);
    expect(seated(out)).toBe(berths(out));
    expect(totalCrew(out.crewPool) + homeworldReserveCount(out)).toBe(0); // 0 stranded
    expect(seated(out)).toBe(onHand); // 0 minted
    // Deterministic too.
    expect(resolveCrew(waiting).ships).toEqual(out.ships);
  });

  it("crew on hand in the reserve are seated too, and the welcome mints only for the seats left", () => {
    const filled = resolveCrew(fleet());
    const crew = filled.ships.flatMap((sh) => sh.complement?.buckets ?? []);
    const waiting: GameState = {
      ...filled,
      crewPool: crew.slice(0, Math.floor(crew.length / 2)),
      homeworldReserve: crew.slice(Math.floor(crew.length / 2)),
      ships: filled.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: sh.complement?.mode ?? "passive" } })),
      lastTransportWindow: TRANSPORT_WELCOME_PENDING,
    } as GameState;
    const onHand = totalCrew(waiting.crewPool) + homeworldReserveCount(waiting);
    expect(onHand).toBe(berths(waiting));
    const out = resolveCrew(waiting);
    expect(seated(out)).toBe(berths(out));
    expect(totalCrew(out.crewPool) + homeworldReserveCount(out)).toBe(0);
    expect(seated(out)).toBe(onHand);
  });

  it("before the fix (switch off) the same fleet was left with open seats and a spill", () => {
    const out = withWelcomeSeatOff(() => resolveCrew(fleet()));
    expect(seated(out)).toBeLessThan(berths(out));
  });
});
