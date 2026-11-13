# Late-game credit balance with Overtime and telescope cycles (measurement, 2026-11-13)

Measure only, per the user's 2026-11-13 answer "Measure first" (docs/plans/2026-10-16-credit-sinks-pass.md). Game code
untouched; branch `feat/crew-0.14.0` at `18e32611`. Raw data and the scratch sim (`fleetSim.ts`, `analysis-800.txt`,
`result-*-800h.json`) are in the session scratchpad `credit-sim` folder.

## How it was measured

- A scratch sim drove the REAL engine (`sim/simPlayer.ts` `advance()` and `simRng`, `sim/actions.ts` `newGameState`, the
  real research, facility, docks, berth, hull build, talent, dispatch and Overtime transforms in `processSpeed.ts`).
  Decision step 120 s, 800 play hours, hourly rows. Seeds 0, 1 and 2 gave byte-identical rows.
- Three players: (a) never buys Overtime or telescope cycles; (b) buys Overtime only while the balance stays above 2 hours
  of income, plus a cycle whenever affordable; (c) buys every Overtime step whenever affordable, plus cycles.

## Approximations

1. Telescope cycles (Deep Field Refinement) are NOT built (user 2026-11-10 "Wait for aspects"). Modeled from the S3
   proposal: cycle n costs 250,000 x 1.5^(n - 1), 30 minutes, past level 8; Overtime on cycle n priced as tier 8 + n.
2. Fabricator components for hulls and the structural assemblies for docks and berths are granted; credits charged
   normally.
3. No expeditions, patrols or combat: Quartermaster kit sales, Shipyard repairs and expedition income are 0.
4. Excluded from the ladders: 8 research projects gated by relic discovery or decode (54,000) and Mission Control L2 and
   L3 (8,500).
5. Captains fly 180-hold haulers; the 4th keeps its granted 90-hold General Freighter.
6. Overtime bought only at decision points (every 120 s).

## Results

- Income: 6,176 per hour (0 to 50 h); 9,634 with 3 captains (50 to 330 h); 12,073 with 4 (from hour 332). Flat after.
- One-time ladders run out (a, b / c): berths 47 / 50, docks 58 / 62, hulls 58 / 63, research 345 / 351, facility rungs
  408 / 413, telescope rungs 483 / 488. Total 4,824,600 credits.
- (a) never: credits pile up without limit after hour 483, linear at 12,073 per hour, 3,852,429 at hour 800.
- (b) threshold: bought ZERO Overtime (each job starts right after a purchase empties the balance). Modeled telescope
  cycles absorb all income on average after hour 500 (cycles at hours 503, 534, 580, 650, 755; price and gap grow 1.5x).
  Balance at hour 800: 555,554.
- (c) max: Overtime totals 75,681 over 800 hours, 0.9% of all spending (36 to 90 per hour late). Balance at 800 h:
  466,381.
- One full 3-step Overtime purchase: 12,600 on a 30-minute level 7 rung (about one hour of late income); 21,600 on
  telescope level 8.

## What it means (facts only)

- Overtime is too small a sink to matter late (under 1% of spending).
- Without telescope cycles, nothing repeatable absorbs late income: credits grow linearly after about hour 480.
- With the modeled cycles, late income is absorbed on average; cycles are not built.
