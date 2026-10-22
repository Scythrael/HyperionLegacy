// WR-2 (0.14.0): THE SIMULATED PLAYER'S POLICIES. A policy is plain data: how the save starts (hull, crew, kit),
// what the player spends on (talents, facility rungs) and the ordered phases it plays (a gathering run, a patrol,
// expeditions). The driver (simPlayer.ts) reads it; nothing here touches state except the start transforms.
//
// Named policies (plan section 4 WR-2; the six balance archetypes of SUGGESTIONS ~1844 to ~1863 wait for the
// balance pass, which owns their tuning targets):
//   allAuto  : the user's T2 baseline [PROPOSAL in the plan]. A fresh save whose first explorer (Orion) is already
//              built, the weakest crew that can launch, every crew setting on auto, no gear, crew or talent changes:
//              one gathering run to its first delivery and a little past, one Dispatch Once Sweep patrol, then
//              expeditions on repeat (the first is the training run, safe first runs SF-2). Never presses Skip.
//   newcomer : the SUGGESTIONS archetype "dispatches whatever is available, upgrades whatever is cheapest", on the
//              REAL fresh save (the General Freighter): hires the board's lowest-rank Security and Science, draws
//              the Quartermaster's Standard-Issue kit for them, buys the cheapest talents and facility rungs it can,
//              gathers longer, patrols once, then tries expeditions. Since G2-4 (user 2026-10-16: no non-explorer
//              hull reaches any expedition system) the freighter's launch is refused (notExplorer), so it flies none.
//              NO EXPLORER PATH (0.14.0 integration review, documented instead of built): reaching an explorer is
//              not one action. It is a Research Lab at tier 2 and the Orion Hull Blueprint (5,000 credits, 280
//              ticks), a Shipyard, the Fabricator chain for the hull's components (10 Frame Segments, 8 Power
//              Couplings, 3 Structural Assemblies, from refined goods), the build (4,200 credits, 1,000 ticks), then
//              the captain and the crew moved to the new ship. The sim has no research, refine, craft, ship build or
//              reassign action, and this newcomer earns about 1,500 credits in its 2 hour gathering phase (seed 0,
//              most of it spent on cheapest rungs), so the path would be a new speedrun policy, which the WR-2 carry
//              note gives the balance pass. Expedition coverage stays with allAuto (an Orion from the start).
//   scripted : any policy plus a list of choices applied to the start (a talent node, an officer bonus, a gear line,
//              a module, a facility rung, a museum record). The ablation runs scripted([choice]) against allAuto.

import type { GameState, MissionKey, PatrolKey, ShipTypeKey } from "../model";
import type { CombatStance } from "../combat/positioning";

export type SimPhase =
  // Dispatch `mission` and fly it for `seconds` (auto-repeat), then recall and wait for the captain to idle.
  | { readonly kind: "gather"; readonly mission: MissionKey; readonly seconds: number }
  // One Dispatch Once patrol; wait for the captain to idle, then for the Shipyard to repair a lost hull.
  | { readonly kind: "patrol"; readonly patrol: PatrolKey; readonly stance: CombatStance }
  // Launch an expedition, wait until it completes, claim it; again while `repeat` and time is left. A run whose
  // objectives stop completing for `stallSeconds` while one is stuck is recorded STALLED and left in flight (the
  // policy never presses Skip), which ends the phase.
  | { readonly kind: "expedition"; readonly repeat: boolean; readonly stallSeconds: number };

export interface SimChoice {
  readonly id: string;
  readonly apply: (s: GameState) => GameState;
}

export interface SimPolicy {
  readonly name: string;
  readonly summary: string;
  readonly start: {
    readonly hull: ShipTypeKey | null; // null: the fresh save's own hull (the General Freighter)
    readonly crew: "weakest" | "board" | "none";
    readonly kit: boolean; // the Quartermaster's free Standard-Issue Armor / Weapon / Tool per member
  };
  readonly talents: "none" | "cheapest";
  readonly facilities: "none" | "cheapest";
  readonly phases: readonly SimPhase[];
  readonly horizonSeconds: number; // the default horizon (a run option may override it)
  readonly decisionSeconds: number; // how often the player looks at the game
  readonly choices: readonly SimChoice[];
}

export const SIM_HOUR = 3600;

// [PROPOSAL] the default stall window: two simulated hours without a completed objective while one is stuck.
export const SIM_STALL_SECONDS = 2 * SIM_HOUR;

export const ALL_AUTO: SimPolicy = {
  name: "allAuto",
  summary: "fresh save, Orion already built, weakest launchable crew, everything on auto, no changes",
  start: { hull: "orion", crew: "weakest", kit: false },
  talents: "none",
  facilities: "none",
  phases: [
    { kind: "gather", mission: "shortOreRun", seconds: 20 * 60 },
    { kind: "patrol", patrol: "crimsonReaverSweep", stance: "balanced" },
    { kind: "expedition", repeat: true, stallSeconds: SIM_STALL_SECONDS },
  ],
  horizonSeconds: 8 * SIM_HOUR,
  decisionSeconds: 60,
  choices: [],
};

export const NEWCOMER: SimPolicy = {
  name: "newcomer",
  summary: "the real fresh save (General Freighter), board hires, Quartermaster kit, cheapest talents and rungs",
  start: { hull: null, crew: "board", kit: true },
  talents: "cheapest",
  facilities: "cheapest",
  phases: [
    { kind: "gather", mission: "shortOreRun", seconds: 2 * SIM_HOUR },
    { kind: "patrol", patrol: "crimsonReaverSweep", stance: "balanced" },
    { kind: "expedition", repeat: true, stallSeconds: SIM_STALL_SECONDS },
  ],
  horizonSeconds: 8 * SIM_HOUR,
  decisionSeconds: 60,
  choices: [],
};

export const SIM_POLICIES: readonly SimPolicy[] = [ALL_AUTO, NEWCOMER];

// `base` plus `choices` applied to its start (after the crew and kit, so a member-scoped choice lands on the crew).
export function scripted(choices: readonly SimChoice[], base: SimPolicy = ALL_AUTO): SimPolicy {
  return {
    ...base,
    name: choices.length === 0 ? base.name : `${base.name}+${choices.map((c) => c.id).join("+")}`,
    choices: [...base.choices, ...choices],
  };
}

export function simPolicy(name: string): SimPolicy {
  const p = SIM_POLICIES.find((x) => x.name === name);
  if (!p) throw new Error(`unknown sim policy ${name}`);
  return p;
}
