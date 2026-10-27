// Safe first runs SF-6 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-6 and the USER ANSWERS of
// 2026-10-27, calls 12 and 13: "Approve as drafted"): the player text of the first-run chip and lines, VERBATIM, in one
// place so every surface (the expedition dispatch card and run view, the patrol dispatch card and popup, the gathering
// cards) reads the same words. Display only: the rules live in game/runDifficulty.ts (isFirstRun, isFirstGatheringRun)
// and enemyRanks.ts isTrainingRun; the forecasts already read the same stamp (Guaranteed on a training run). The chip
// itself renders through TrainingRunChip.svelte.

import { extractionMissionOf, type GameState, type MissionPhase } from "./game/model";
import { isFirstGatheringRun } from "./game/runDifficulty";

// The chip (call 12, "Training run" chip).
export const TRAINING_RUN_CHIP = "Training run";
// The chip's line on an expedition (the dispatch card, the run view). User 2026-10-27 ("This run cannot fail"): one
// line for both run types, true wherever the chip shows (the guarantee goes to the first EXPLORER expedition).
export const TRAINING_EXPEDITION_LINE = "This training run cannot fail. From the next one on, the risk rises slowly.";
// The chip's line on a patrol (the dispatch card and its popup).
export const TRAINING_PATROL_LINE = "This training run cannot fail. From the next one on, the risk rises slowly.";
// The gathering card's line (gathering cannot be lost, so it carries no chip).
export const FIRST_GATHERING_LINE = "First run: see how a mission works.";

// Review fix (2026-10-27): the ONE in-progress gathering card that carries FIRST_GATHERING_LINE, so the line shows once
// (QA item 7) however many captains gather at once. A gathering run stores no start time (adding one would be an
// engine and save change; SF-6 is display only), so the card is the run CLOSEST TO ITS FIRST DELIVERY (the latest
// phase, then the most progress in it): the one whose delivery ends the first run. Ties go to the lowest captain id.
// Null once the save has delivered a gathering cycle, or when nobody is gathering. Pure.
const PHASE_ORDER: readonly MissionPhase[] = ["ordersReceived", "transitOut", "extracting", "transitBack", "unloading"];
export function firstGatheringCardCaptainId(state: Pick<GameState, "captains" | "lifetimeStats">): number | null {
  if (!isFirstGatheringRun(state)) return null;
  let best: { id: number; phase: number; progress: number } | null = null;
  for (const c of state.captains) {
    const m = extractionMissionOf(c);
    if (m === null) continue;
    const cand = { id: c.id, phase: PHASE_ORDER.indexOf(m.phase), progress: m.phaseProgressTicks };
    const ahead =
      best === null ||
      cand.phase > best.phase ||
      (cand.phase === best.phase && (cand.progress > best.progress || (cand.progress === best.progress && cand.id < best.id)));
    if (ahead) best = cand;
  }
  return best?.id ?? null;
}
