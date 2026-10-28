// prestigeCards.ts: the Prestige tab cards' bar text (0.14.0 prestige redesign, Slice 2), kept pure
// so it is unit tested (this repo has no Svelte component harness). Display only: every number comes
// from the engine's own bar functions, so a card can never show a different bar than the button and
// the automatic prestiges read.
//
// Design 3.1: the cards show the current bar ("Needs") and, new, the bar after one more of that layer
// ("Next one needs"; the row's label reads "Next one" under "Needs", since card labels stay at two
// words and 12 characters so they never clip) so the rise is visible. When the Fleet bar climbs past the Prestigeception bar,
// that is by design the signal to Prestigeception: the Fleet card says "Prestigeception first".

import { fleetBarExponent, pcBarExponent, nextFleetBarExponent, nextPcBarExponent } from "./engine";
import { groupThousands, formatExponent } from "./format";
import { COPY } from "./config";
import type { SecretState } from "./state";

// An effective exponent as a bar: "1.8e308", "2.08e385", "e15,000" (a whole power of ten reads like
// the Ore goals do). Two decimals at most, trailing zeros dropped.
export function formatBar(e: number): string {
  let whole = Math.floor(e);
  let mantissa = Number(Math.pow(10, e - whole).toFixed(2));
  if (mantissa >= 10) {
    mantissa = 1;
    whole += 1;
  }
  return mantissa === 1 ? formatExponent(whole) : `${mantissa}e${groupThousands(whole)}`;
}

export interface PrestigeCardBars {
  fleetNeeds: string; // the Fleet card's "Needs" value
  fleetNext: string; // its "Next one needs" value
  fleetButton: string; // the Fleet button while it pays nothing
  pcNeeds: string;
  pcNext: string;
  pcButton: string;
  // The Fleet bar (now, or after one more Fleet) is above the Prestigeception bar.
  fleetPcFirst: boolean;
  fleetNextPcFirst: boolean;
}

export function prestigeCardBars(s: SecretState): PrestigeCardBars {
  const fleet = fleetBarExponent(s);
  const nextFleet = nextFleetBarExponent(s);
  const pc = pcBarExponent(s);
  const fleetPcFirst = fleet > pc;
  const fleetNextPcFirst = nextFleet > pc;
  return {
    fleetNeeds: fleetPcFirst ? COPY.pcFirst : `${formatBar(fleet)} Ore`,
    fleetNext: fleetNextPcFirst ? COPY.pcFirst : `${formatBar(nextFleet)} Ore`,
    fleetButton: fleetPcFirst ? `Fleet Prestige (${COPY.pcFirst})` : `Fleet Prestige (needs ${formatBar(fleet)} Ore)`,
    pcNeeds: `${formatBar(pc)} Ore in one climb`,
    pcNext: `${formatBar(nextPcBarExponent(s))} Ore`,
    pcButton: `Prestigeception (needs ${formatBar(pc)} Ore)`,
    fleetPcFirst,
    fleetNextPcFirst,
  };
}
