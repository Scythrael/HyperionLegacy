// TEST-ONLY: G1-5 (short-range relic drops) golden helpers, shared by shortRangeRelicsGoldens.test.ts and
// shortRangeRelics.test.ts. Never imported by app code.

import { type GameState } from "./model";

// A run as a pre-G1-5 build dispatched it: no relic stamp on the mission. Pure; a no-op before G1-5.
export function asPreRelicDispatch(s: GameState): GameState {
  return {
    ...s,
    captains: s.captains.map((c) => {
      if (c.mission === null || c.mission.kind !== "shortRange" || !("relicBlanks" in c.mission)) return c;
      const m = { ...c.mission } as Record<string, unknown>;
      delete m.relicBlanks;
      return { ...c, mission: m as unknown as typeof c.mission };
    }),
  };
}

// The state with every short-range relic find taken out: the stamp, the run's relic count, the vault tokens it found
// and the completion entry's relic count. Pure; a no-op before G1-5.
export function withoutShortRangeRelics(s: GameState): GameState {
  const out = asPreRelicDispatch(s);
  return {
    ...out,
    captains: out.captains.map((c) => {
      if (c.mission === null || c.mission.kind !== "shortRange" || !("relicsThisRun" in c.mission)) return c;
      const m = { ...c.mission } as Record<string, unknown>;
      delete m.relicsThisRun;
      return { ...c, mission: m as unknown as typeof c.mission };
    }),
    relicVault: (out.relicVault ?? []).filter((t) => t.source !== "shortRange"),
    completionLog: (out.completionLog ?? []).map((e) => {
      if (!("relicsFound" in e)) return e;
      const rest = { ...e } as Record<string, unknown>;
      delete rest.relicsFound;
      return rest as unknown as typeof e;
    }),
  };
}
