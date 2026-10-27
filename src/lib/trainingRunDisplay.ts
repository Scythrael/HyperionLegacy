// Safe first runs SF-6 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-6 and the USER ANSWERS of
// 2026-10-27, calls 12 and 13: "Approve as drafted"): the player text of the first-run chip and lines, VERBATIM, in one
// place so every surface (the expedition dispatch card and run view, the patrol dispatch card and popup, the gathering
// cards) reads the same words. Display only: the rules live in game/runDifficulty.ts (isFirstRun, isFirstGatheringRun)
// and enemyRanks.ts isTrainingRun; the forecasts already read the same stamp (Guaranteed on a training run).

// The chip (call 12, "Training run" chip).
export const TRAINING_RUN_CHIP = "Training run";
// The chip's line on an expedition (the dispatch card, the run view).
export const TRAINING_EXPEDITION_LINE = "Your first expedition cannot fail. From the next one on, the risk rises slowly.";
// The chip's line on a patrol (the dispatch card and its popup).
export const TRAINING_PATROL_LINE = "Your first patrol cannot fail. From the next one on, the risk rises slowly.";
// The gathering card's line (gathering cannot be lost, so it carries no chip).
export const FIRST_GATHERING_LINE = "First run: see how a mission works.";
