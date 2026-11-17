// Staging freeze (2026-11-14): the WELCOME BATCH through the real load path (save.ts migrate, then crewOverlay.ts
// resolveCrew). User 2026-11-13, "A welcome batch to fill the fleet (Recommended)": a production save gets enough
// transports to fill every open berth once, then normal transports from the update on. The speed half lives in
// oldSaveFirstLoad.perf.test.ts.
import { describe, expect, it } from "vitest";
// FR-C A1-2 (the welcome batch seats one crewmember per open seat) came after every pin here. The three cases that pin
// the transport-count welcome's TOTALS (whole transports) run with it off (withWelcomeSeatOff,
// welcomeSeatSwitch.fixture.ts); every other case runs live. transportWelcomeSeat.test.ts pins the seat-by-seat welcome,
// with live versions of the eligibility cases (a young pre-crew save, a far marker, a marker within the cap).
import { withWelcomeSeatOff } from "./welcomeSeatSwitch.fixture";
import { freshState, type GameState, type ShipTypeKey } from "./model";
import { migrate, type SaveFile } from "./save";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { homeworldReserveCount } from "./homeworldReserve";
import { complementTotalCap } from "./commandStructure";
import {
  TRANSPORT_BATCH_SIZE,
  TRANSPORT_WELCOME_AFTER_WINDOWS,
  TRANSPORT_WELCOME_PENDING,
  TRANSPORT_WELCOME_SWITCH,
  TRANSPORT_WINDOW_SECONDS,
  transportWindowIndex,
} from "./transports";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const DAY = 86400;
const TYPES: readonly ShipTypeKey[] = ["carrier", "eir", "orion", "destroyer"];

function fleet(gameTimeSeconds: number, lastTransportWindow: number): GameState {
  const base = freshState();
  const extra = TYPES.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  return { ...base, ships: [...base.ships, ...extra], nextShipId: base.ships.length + extra.length + 1, gameTimeSeconds, lastTransportWindow };
}

const crewOf = (s: GameState): number =>
  totalCrew(s.crewPool) + homeworldReserveCount(s) + s.ships.reduce((a, sh) => a + totalCrew(sh.complement?.buckets ?? []), 0);
const berthsOf = (s: GameState): number => s.ships.reduce((a, sh) => a + complementTotalCap(sh.typeKey), 0);

describe("welcome batch on the first 0.14.0 tick", () => {
  it("a v54 save a year old fills every open berth once (whole transports), and its marker lands at now", () => withWelcomeSeatOff(() => {
    const cur = fleet(365 * DAY + 7, 0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { officers, nextOfficerId, crewPool, notableCrew, nextNotableId, lastTransportWindow, ...pre } = cur as any;
    const save: SaveFile = {
      version: 54, created_at: 0, last_saved_at: 0, game_time_seconds: cur.gameTimeSeconds,
      state: { ...pre, ships: cur.ships.map(({ complement, ...rest }: any) => rest) } as any,
    };
    const migrated = migrate(save);
    expect(migrated.lastTransportWindow).toBe(TRANSPORT_WELCOME_PENDING);
    const out = resolveCrew(migrated);
    const berths = berthsOf(migrated);
    expect(crewOf(out)).toBe(Math.ceil(berths / TRANSPORT_BATCH_SIZE) * TRANSPORT_BATCH_SIZE);
    expect(out.lastTransportWindow).toBe(transportWindowIndex(migrated.gameTimeSeconds));
    // The next window brings one ordinary transport.
    const next = resolveCrew({ ...out, gameTimeSeconds: out.gameTimeSeconds + TRANSPORT_WINDOW_SECONDS });
    expect(crewOf(next)).toBe(crewOf(out) + TRANSPORT_BATCH_SIZE);
  }));

  it("a young pre-crew save takes the welcome too (no window yet, still a fleet's worth)", () => withWelcomeSeatOff(() => {
    const s = { ...fleet(600, 0), lastTransportWindow: TRANSPORT_WELCOME_PENDING };
    const out = resolveCrew(s);
    expect(crewOf(out)).toBe(Math.ceil(berthsOf(s) / TRANSPORT_BATCH_SIZE) * TRANSPORT_BATCH_SIZE);
    expect(out.lastTransportWindow).toBe(0);
  }));

  it("a marker further behind than any catch-up takes the welcome; one within the offline cap keeps its backlog", () => withWelcomeSeatOff(() => {
    const far = fleet((TRANSPORT_WELCOME_AFTER_WINDOWS + 1) * TRANSPORT_WINDOW_SECONDS, 0);
    expect(crewOf(resolveCrew(far))).toBe(Math.ceil(berthsOf(far) / TRANSPORT_BATCH_SIZE) * TRANSPORT_BATCH_SIZE);
    const within = fleet(TRANSPORT_WELCOME_AFTER_WINDOWS * TRANSPORT_WINDOW_SECONDS, 0);
    expect(crewOf(resolveCrew(within))).toBe(TRANSPORT_WELCOME_AFTER_WINDOWS * TRANSPORT_BATCH_SIZE);
  }));

  it("crew already on hand count toward the fill", () => {
    const base = fleet(365 * DAY, TRANSPORT_WELCOME_PENDING);
    const filled = resolveCrew(base);
    // Send every crewmember back to the pool: the fleet's berths are open again but the crew to fill them are waiting.
    const waiting: GameState = {
      ...filled,
      crewPool: [...filled.crewPool, ...filled.ships.flatMap((sh) => sh.complement?.buckets ?? [])],
      ships: filled.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: sh.complement?.mode ?? "passive" } })),
      lastTransportWindow: TRANSPORT_WELCOME_PENDING,
    };
    expect(crewOf(resolveCrew(waiting))).toBe(crewOf(filled));
  });

  it("with the switch off (test only) the whole backlog arrives, as before the fix", () => {
    const was = TRANSPORT_WELCOME_SWITCH.live;
    TRANSPORT_WELCOME_SWITCH.live = false;
    try {
      const s = fleet(30 * DAY + 7, 0);
      expect(crewOf(resolveCrew(s))).toBe(transportWindowIndex(s.gameTimeSeconds) * TRANSPORT_BATCH_SIZE);
    } finally {
      TRANSPORT_WELCOME_SWITCH.live = was;
    }
  });
});
