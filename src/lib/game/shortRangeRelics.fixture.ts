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

// The state with every short-range relic find taken out: the stamp, the run's relic count, the vault tokens it found,
// the completion entry's relic count and each live run's find line (the G1-5 review follow-up; the later entries'
// "done-N" ids and the id counter closed back up, as if the lines were never written). Pure; a no-op before G1-5.
export function withoutShortRangeRelics(s: GameState): GameState {
  const out = asPreRelicDispatch(s);
  let removed = 0;
  const log = (out.completionLog ?? []).flatMap((e) => {
    if (e.kind === "shortRangeRelicFind") {
      removed += 1;
      return [];
    }
    if (removed === 0) return [e];
    const n = Number(e.id.slice("done-".length));
    return [{ ...e, id: Number.isFinite(n) ? `done-${n - removed}` : e.id }];
  });
  return {
    ...out,
    ...(removed > 0 && out.nextCompletionLogId !== undefined ? { nextCompletionLogId: out.nextCompletionLogId - removed } : {}),
    captains: out.captains.map((c) => {
      if (c.mission === null || c.mission.kind !== "shortRange" || !("relicsThisRun" in c.mission)) return c;
      const m = { ...c.mission } as Record<string, unknown>;
      delete m.relicsThisRun;
      return { ...c, mission: m as unknown as typeof c.mission };
    }),
    relicVault: (out.relicVault ?? []).filter((t) => t.source !== "shortRange"),
    completionLog: (removed > 0 ? log : (out.completionLog ?? [])).map((e) => {
      if (!("relicsFound" in e)) return e;
      const rest = { ...e } as Record<string, unknown>;
      delete rest.relicsFound;
      return rest as unknown as typeof e;
    }),
  };
}
