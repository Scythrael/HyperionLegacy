// Relics v2 R2-3 test fixture: a relic study as a pre-R2-3 build started it (a v1 study: its identifyRelic effect carries
// no `v`). R2-3 stamps `v: 2` on every NEW study; a study already in flight at the update has no stamp and resolves through
// the v1 roll exactly as dispatched. Every golden captured before R2-3 starts its studies through these helpers, so it
// keeps proving the v1 path (the "as pre-X dispatch" precedent of the dispatch goldens).

import type { GameState, TimedProcess } from "./model";
import { startRelicStudy } from "./tick";

// A process with the v2 stamp removed (any other process is returned as it is). Pure.
export function asV1RelicStudyProcess(p: TimedProcess): TimedProcess {
  if (p.kind !== "relicStudy" || p.effect.type !== "identifyRelic" || !("v" in p.effect)) return p;
  const { v: _v, ...effect } = p.effect;
  return { ...p, effect };
}

// The state with every relic study in flight shown as a v1 study. Pure: the SAME state when nothing changes.
export function asV1RelicStudies(state: GameState): GameState {
  const procs = state.activeProcesses.map(asV1RelicStudyProcess);
  return procs.every((p, i) => p === state.activeProcesses[i]) ? state : { ...state, activeProcesses: procs };
}

// startRelicStudy, the started study shown as a v1 study (the state a pre-R2-3 build held). Pure.
export function startV1RelicStudy(state: GameState, tokenId: string): { next: GameState; started: boolean } {
  const r = startRelicStudy(state, tokenId);
  return r.started ? { next: asV1RelicStudies(r.next), started: true } : { next: r.next, started: false };
}
