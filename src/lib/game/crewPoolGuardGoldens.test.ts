// CP-21 close-out (docs/plans/2026-10-14-complement-and-acquisition-plan.md, "CP-21 close-out (2026-11-11)"): golden
// hashes captured on the code BEFORE the crew pool perf guard (feat/crew-0.14.0 8bf79c6b). The guard is a pure
// optimization of crewOverlay.ts resolveCrew (skip a passive ship that cannot take anyone, skip the copy of an idle
// pool), so NONE of these pins may ever move for it. Whole serialized states (stateHash), each run three ways (one
// tick() call, 997 s chunks, 1 s steps) that must agree:
//
//   idle:deep     : a passive fleet of eight hulls with every berth it can fill filled and about 20,000 crew left in the
//                   pool (40 days of transports), run across a transport window.
//   idle:small    : the same fleet after 8 days of transports (a smaller pool), across two windows.
//   freed:transfer: the Eir switched to manual, up to 50 of each of its first three groups transferred to the pool,
//                   switched back to passive: it refills.
//   freed:sendBack: a notable graduated on the Eir and later sent back: the freed berth refills.
//   quarters      : a Utilitarian Crew Quarters installed on the full freighter mid-run: the new berths fill.
//   lock          : the freighter emptied and out on a mission (paused while out), recalled: it fills once home.
//   toPassive     : an empty manual Aurora switched to passive mid-run: it fills.
import { describe, expect, it } from "vitest";
import { freshState, type GameState, type ShipInstance, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { signatureKey, totalCrew } from "./crew";
import { setComplementMode } from "./crewLock";
import { CREW_POOL, transferCrew } from "./crewTransfer";
import { graduateStandout, sendBackNotable } from "./crewGraduation";
import { dispatchCaptainOnMission, recallCaptain, tick } from "./tick";
import { installPiece } from "./wiring/probes";
import { stateHash } from "./firstRunsGoldens.fixture";

const CAPTURE = Boolean(import.meta.env.CP21_CAPTURE);
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

// ship-1 (the freighter, captain 1) plus seven parked passive hulls, filled by the real resolveCrew from the backlog
// of `days` of transports (one call delivers it and auto-crews the fleet).
export function guardFleet(days: number, edit: (s: GameState) => GameState = (s) => s): GameState {
  const base = freshState();
  const extra: ShipInstance[] = FLEET.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  const start: GameState = edit({
    ...base,
    ships: [...base.ships, ...extra],
    nextShipId: base.ships.length + extra.length + 1,
    gameTimeSeconds: days * DAY + 7,
    lastTransportWindow: 0,
  });
  return resolveCrew(start);
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

// A scenario: a start state, then phases of (run seconds, then an edit through the engine's own actions).
type Scenario = { start: () => GameState; phases: { run: number; then?: (s: GameState) => GameState }[] };

const shipOf = (s: GameState, id: string): ShipInstance => s.ships.find((sh) => sh.id === id)!;
const crewOn = (s: GameState, id: string): number => totalCrew(shipOf(s, id).complement?.buckets ?? []);

function freeOnEir(s: GameState): GameState {
  const manual = setComplementMode(s, EIR, "active");
  const picks = (shipOf(manual, EIR).complement?.buckets ?? []).slice(0, 3).map((b) => ({ signatureKey: signatureKey(b), count: 50 }));
  const moved = transferCrew(manual, EIR, CREW_POOL, picks).next;
  return setComplementMode(moved, EIR, "passive");
}

const SCENARIOS: Record<string, Scenario> = {
  "idle:deep": { start: () => guardFleet(40), phases: [{ run: 1900 }] },
  "idle:small": { start: () => guardFleet(8), phases: [{ run: 3700 }] },
  "freed:transfer": { start: () => guardFleet(8), phases: [{ run: 400, then: freeOnEir }, { run: 1500 }] },
  "freed:sendBack": {
    start: () => {
      const s = guardFleet(8);
      const key = signatureKey(shipOf(s, EIR).complement!.buckets[0]);
      return graduateStandout(s, EIR, key).next;
    },
    phases: [
      { run: 300, then: (s) => sendBackNotable(s, s.notableCrew[s.notableCrew.length - 1].id) },
      { run: 300 },
    ],
  },
  quarters: {
    start: () => guardFleet(8),
    phases: [{ run: 200, then: (s) => installPiece(s, { id: "cp21-quarters", slotType: "quarters", moduleVariant: "quartersUtilitarian" }) }, { run: 300 }],
  },
  lock: {
    start: () => {
      const s = guardFleet(8);
      const emptied = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [], mode: "passive" as const } } : sh)) };
      return dispatchCaptainOnMission(emptied, 1, "shortOreRun").next;
    },
    phases: [{ run: 300, then: (s) => recallCaptain(s, 1).next }, { run: 600 }],
  },
  toPassive: {
    start: () =>
      guardFleet(8, (s) => ({ ...s, ships: s.ships.map((sh) => (sh.id === AURORA ? { ...sh, complement: { buckets: [], mode: "active" as const } } : sh)) })),
    phases: [{ run: 300, then: (s) => setComplementMode(s, AURORA, "passive") }, { run: 300 }],
  },
};

function runScenario(sc: Scenario, path: Path): GameState {
  const rng = lcg(0xc21);
  let s = sc.start();
  for (const ph of sc.phases) {
    s = path(s, ph.run, rng);
    if (ph.then) s = ph.then(s);
  }
  return s;
}

// Captured on the pre-guard code (feat/crew-0.14.0 8bf79c6b), one call; the three paths agreed.
const PINS: Record<string, string> = {
  "idle:deep": "c4251102",
  "idle:small": "d8bc48ba",
  "freed:transfer": "774789ba",
  "freed:sendBack": "7b25a78e",
  quarters: "13b331ed",
  lock: "c476dfd7",
  toPassive: "d8f49b13",
};

describe("CP-21 crew pool guard goldens (captured before the guard; a pure optimization never moves them)", () => {
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    it(`${name}: one call == 997 s chunks == 1 s steps, pinned`, () => {
      const one = runScenario(sc, PATHS.one);
      const h = stateHash(one);
      if (CAPTURE) {
        (globalThis as { process?: { stdout?: { write(s: string): void } } }).process?.stdout?.write(`  "${name}": "${h}",\n`);
      }
      expect(stateHash(runScenario(sc, PATHS.chunks))).toBe(h);
      expect(stateHash(runScenario(sc, PATHS.steps))).toBe(h);
      if (!CAPTURE) expect(h).toBe(PINS[name]);
    }, 600000);
  }

  it("each scenario really exercises what it is pinned for", () => {
    const deep = guardFleet(40);
    expect(totalCrew(deep.crewPool)).toBeGreaterThan(19500);
    const transfer = SCENARIOS["freed:transfer"];
    const before = runScenario({ start: transfer.start, phases: [{ run: 400 }] }, PATHS.one);
    const freed = freeOnEir(before);
    expect(crewOn(freed, EIR)).toBeLessThan(crewOn(before, EIR));
    expect(crewOn(runScenario(transfer, PATHS.one), EIR)).toBeGreaterThan(crewOn(freed, EIR));
    const lockStart = SCENARIOS.lock.start();
    expect(crewOn(lockStart, "ship-1")).toBe(0);
    expect(crewOn(runScenario({ start: SCENARIOS.lock.start, phases: [{ run: 300 }] }, PATHS.one), "ship-1")).toBe(0);
    expect(crewOn(runScenario(SCENARIOS.lock, PATHS.one), "ship-1")).toBeGreaterThan(0);
    const quartersEnd = runScenario(SCENARIOS.quarters, PATHS.one);
    expect(crewOn(quartersEnd, "ship-1")).toBeGreaterThan(crewOn(SCENARIOS.quarters.start(), "ship-1"));
    const passiveEnd = runScenario(SCENARIOS.toPassive, PATHS.one);
    expect(crewOn(SCENARIOS.toPassive.start(), AURORA)).toBe(0);
    expect(crewOn(passiveEnd, AURORA)).toBeGreaterThan(0);
    const sendBack = SCENARIOS["freed:sendBack"];
    const graduated = sendBack.start();
    expect(graduated.notableCrew.some((n) => n.assignedShipId === EIR)).toBe(true);
    const sentEnd = runScenario(sendBack, PATHS.one);
    expect(sentEnd.notableCrew.some((n) => n.assignedShipId === EIR)).toBe(false);
    expect(crewOn(sentEnd, EIR)).toBe(crewOn(graduated, EIR) + 1);
  }, 600000);
});
