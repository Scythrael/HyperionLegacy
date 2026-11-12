// Homeworld reserve (docs/plans/2026-10-14-complement-and-acquisition-plan.md, "USER ANSWERS (2026-11-12)": "Homeworld
// reserve (Recommended)"). Whole-state goldens (stateHash), each scenario run three ways (one tick() call, 997 s chunks,
// 1 s steps) that must agree. OFF_PINS were captured on the code BEFORE the reserve (feat/crew-0.14.0 08f2cac8).
//
//   deep:window : a passive fleet of eight hulls, every berth it can fill filled, about 20,000 crew left over (40 days of
//                 transports), run across a transport window.
//   small:long  : the same fleet after 8 days of transports, then a two-day catch-up (96 windows).
//   emptied     : the freighter's bulk crew cleared between windows: it refills (from the reserve with the slice on).
//   quarters    : a Utilitarian Crew Quarters installed on the full freighter between windows: the new berths fill.
//   activeOpen  : an empty manual Aurora (open berths a player fills by hand) across a window, then switched to passive.
//   transfer    : the Eir switched to manual, crew transferred to the pool, switched back: it refills from the pool.
//   lock        : (reserve ON only) the emptied freighter out on a mission through a window, recalled, refilled.
//   sendBack    : (reserve ON only) a notable sent back off the Eir; the freed berth refills from the reserve.
import { describe, expect, it } from "vitest";
import { freshState, type GameState, type ShipInstance, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { signatureKey } from "./crew";
import { setComplementMode } from "./crewLock";
import { CREW_POOL, transferCrew } from "./crewTransfer";
import { dispatchCaptainOnMission, recallCaptain, tick } from "./tick";
import { graduateStandout, sendBackNotable } from "./crewGraduation";
import { shipCrewLocked } from "./crewLock";
import { homeworldReserveCount } from "./homeworldReserve";
import { totalCrew } from "./crew";
import { installPiece } from "./wiring/probes";
import { stateHash } from "./firstRunsGoldens.fixture";
import { withHomeworldReserveOff } from "./homeworldReserveSwitch.fixture";

const CAPTURE = Boolean(import.meta.env.HWR_CAPTURE);
const DAY = 86400;
const FLEET: readonly ShipTypeKey[] = ["carrier", "eir", "orion", "aurora", "battleship", "destroyer", "prospectorMiner"];
const EIR = "ship-3";
const AURORA = "ship-5";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ship-1 (the freighter, captain 1) plus seven parked passive hulls, filled by the real resolveCrew from the backlog of
// `days` of transports (one call delivers it and auto-crews the fleet). The next window is 1,793 s away.
function fleet(days: number, edit: (s: GameState) => GameState = (s) => s): GameState {
  const base = freshState();
  const extra: ShipInstance[] = FLEET.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  return resolveCrew(
    edit({
      ...base,
      ships: [...base.ships, ...extra],
      nextShipId: base.ships.length + extra.length + 1,
      gameTimeSeconds: days * DAY + 7,
      lastTransportWindow: 0,
    }),
  );
}

type Path = (s: GameState, seconds: number, rng: () => number) => GameState;
const PATHS: Record<"one" | "chunks" | "steps", Path> = {
  one: (s, n, rng) => tick(n, s, rng),
  chunks: (s, n, rng) => {
    let out = s;
    for (let left = n; left > 0; left -= 997) out = tick(Math.min(997, left), out, rng);
    return out;
  },
  steps: (s, n, rng) => {
    let out = s;
    for (let i = 0; i < n; i += 1) out = tick(1, out, rng);
    return out;
  },
};

type Scenario = { start: () => GameState; phases: { run: number; then?: (s: GameState) => GameState }[] };

const emptyFreighter = (s: GameState): GameState => ({
  ...s,
  ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [], mode: "passive" as const } } : sh)),
});

function freeOnEir(s: GameState): GameState {
  const manual = setComplementMode(s, EIR, "active");
  const picks = (manual.ships.find((sh) => sh.id === EIR)!.complement?.buckets ?? []).slice(0, 3).map((b) => ({ signatureKey: signatureKey(b), count: 50 }));
  return setComplementMode(transferCrew(manual, EIR, CREW_POOL, picks).next, EIR, "passive");
}

export const SCENARIOS: Record<string, Scenario> = {
  "deep:window": { start: () => fleet(40), phases: [{ run: 1900 }] },
  "small:long": { start: () => fleet(8), phases: [{ run: 2 * DAY }] },
  emptied: { start: () => fleet(8), phases: [{ run: 200, then: emptyFreighter }, { run: 600 }] },
  quarters: {
    start: () => fleet(8),
    phases: [{ run: 200, then: (s) => installPiece(s, { id: "hwr-quarters", slotType: "quarters", moduleVariant: "quartersUtilitarian" }) }, { run: 300 }],
  },
  activeOpen: {
    start: () => fleet(8, (s) => ({ ...s, ships: s.ships.map((sh) => (sh.id === AURORA ? { ...sh, complement: { buckets: [], mode: "active" as const } } : sh)) })),
    phases: [{ run: 1900, then: (s) => setComplementMode(s, AURORA, "passive") }, { run: 300 }],
  },
  transfer: { start: () => fleet(8), phases: [{ run: 1900, then: freeOnEir }, { run: 300 }] },
  // Reserve ON only (hub review 2026-11-12): the freighter emptied and out on a mission (crew-locked) through a transport
  // window, then recalled: it refills from the pool (the window's crew the sweep kept for its berths) and then the reserve.
  lock: {
    start: () => dispatchCaptainOnMission(emptyFreighter(fleet(8)), 1, "shortOreRun").next,
    phases: [{ run: 1900, then: (s) => recallCaptain(s, 1).next }, { run: 600 }],
  },
  // Reserve ON only: a notable graduated on the Eir and sent back (unassigned) frees a berth with the pool empty; it
  // refills from the reserve, then a transport window passes.
  sendBack: {
    start: () => {
      const s = fleet(8);
      return graduateStandout(s, EIR, signatureKey(s.ships.find((sh) => sh.id === EIR)!.complement!.buckets[0])).next;
    },
    phases: [{ run: 300, then: (s) => sendBackNotable(s, s.notableCrew[s.notableCrew.length - 1].id) }, { run: 1900 }],
  },
};

export function runScenario(sc: Scenario, path: Path): GameState {
  const rng = lcg(0x4e5);
  let s = sc.start();
  for (const ph of sc.phases) {
    s = path(s, ph.run, rng);
    if (ph.then) s = ph.then(s);
  }
  return s;
}

// Captured on feat/crew-0.14.0 08f2cac8 (before the reserve), one call; the three paths agreed. The switch-off run of
// every scenario must still land on these (the slice changes nothing with it off).
const OFF_PINS: Record<string, string> = {
  "deep:window": "c4251102",
  "small:long": "7b45d0e6",
  emptied: "a66ab366",
  quarters: "eb154510",
  activeOpen: "c9a47ddb",
  transfer: "868589af",
};

// The reserve live, one call; the three paths agree.
const ON_PINS: Record<string, string> = {
  "deep:window": "d203d51f",
  "small:long": "733836f5",
  emptied: "d40c5679",
  quarters: "30ebbe53",
  activeOpen: "68f8ba66",
  transfer: "f2009cea",
  lock: "9686c0c1",
  sendBack: "8008ed53",
};

function pinned(name: string, sc: Scenario, pins: Record<string, string>, tag: string): void {
  const one = runScenario(sc, PATHS.one);
  const h = stateHash(one);
  if (CAPTURE) (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout?.write(`  [${tag}] "${name}": "${h}",\n`);
  expect(stateHash(runScenario(sc, PATHS.chunks))).toBe(h);
  expect(stateHash(runScenario(sc, PATHS.steps))).toBe(h);
  if (!CAPTURE) expect(h).toBe(pins[name]);
}

describe("homeworld reserve goldens", () => {
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (name in OFF_PINS) {
      it(`${name} (reserve off): the pre-reserve pin, one call == 997 s chunks == 1 s steps`, () => {
        withHomeworldReserveOff(() => pinned(name, sc, OFF_PINS, "off"));
      }, 900000);
    }
    it(`${name} (reserve on): one call == 997 s chunks == 1 s steps, pinned`, () => {
      pinned(name, sc, ON_PINS, "on");
    }, 900000);
  }

  it("lock and sendBack really exercise what they are pinned for", () => {
    const crewOn = (s: GameState, id: string): number => totalCrew(s.ships.find((sh) => sh.id === id)!.complement?.buckets ?? []);
    const rng = lcg(0x4e5);
    // lock: out, crew-locked and empty through the window (the window delivered), then home it refills from both lists.
    const lockStart = SCENARIOS.lock.start();
    expect(shipCrewLocked(lockStart, "ship-1")).toBe(true);
    const out = tick(1900, lockStart, rng);
    expect(out.lastTransportWindow).toBeGreaterThan(lockStart.lastTransportWindow);
    expect(shipCrewLocked(out, "ship-1")).toBe(true);
    expect(crewOn(out, "ship-1")).toBe(0);
    expect(totalCrew(out.crewPool)).toBeGreaterThan(0);
    const home = runScenario(SCENARIOS.lock, PATHS.one);
    expect(crewOn(home, "ship-1")).toBeGreaterThan(totalCrew(out.crewPool));
    expect(homeworldReserveCount(home)).toBeLessThan(homeworldReserveCount(out));
    // sendBack: the Eir's freed berth refills from the reserve (the pool is empty).
    const graduated = SCENARIOS.sendBack.start();
    expect(graduated.crewPool).toEqual([]);
    const sent = runScenario({ start: SCENARIOS.sendBack.start, phases: [SCENARIOS.sendBack.phases[0], { run: 5 }] }, PATHS.one);
    expect(sent.notableCrew.some((n) => n.assignedShipId === EIR)).toBe(false);
    expect(crewOn(sent, EIR)).toBe(crewOn(graduated, EIR) + 1);
    expect(homeworldReserveCount(sent)).toBe(homeworldReserveCount(graduated) - 1);
  }, 900000);
});
