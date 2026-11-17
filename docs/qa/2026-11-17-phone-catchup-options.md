# Phone catch-up with Repeat patrols on 0.14.0: findings and options (2026-11-17)

Research only (no build). Measured on feat/crew-0.14.0 @ 0f6956bc against prod tag release/0.13.11.4, five Repeat
patrols (src/lib/game/patrolPerf.fixture.ts), quiet desktop, bundled with the repo's rolldown, 1 h of 1 s steps.
Phones assumed 3x to 6x slower. Status: awaiting the user's choice.

## Why 0.14.0 is slower than prod

The code is not slow; it simulates about 10 times more combat. The FR-E "resume when safe" rule ends almost every flown
cycle in a short repair pause, and each pause runs about 12 projected cycles (the pristine check, the break check, about
10 bisection probes). Per hour: 211 cycle ends, 83 pauses, 83 safe-amount searches, 1,250 projected cycles, 2,904
projected battles, 323 real battles. Projections never repeat (all 1,250 had distinct inputs), so they cannot be cached.
Prod has no gear wear, pauses, projections or crew layer: 1,290 cycles an hour, fights of 2.3 rounds.

| Area (share of the timed hour, callees included) | Share |
|---|---|
| FR-E projections at a cycle's end (cycleRepairPause 39.3%, of it safeRepairAmount 32.0%; projectedPristineDefeat 5.6%) | about 45% |
| of which battle simulation inside projections | 34.6% |
| Minting the next cycle (relaunchCycleConditions, lazy crew getters, freshPatrolMission) | 11.9% |
| Gear wear every step (resolveGearWear; pieceRepairRate 5.4%) | 14.5% |
| Crew rollups, overlapping the rows above (rawShipCrewContribution, rollupBuckets 13.1%) | 16.3% |
| Real wave battles | 3.8% |
| Standard-Issue crew modules, direct cost | about 3 to 4% |
| M8 run-return probe (calls longer than one tick only) | 0% |

Per step: 0.14.0 about 222 us (projections 106, minting 28, gear wear 34, the rest about 70); prod about 31 us.

## Options

| # | Option | Exact? | Speedup | Risk | Size |
|---|---|---|---|---|---|
| E1 | Cache the crew rollup in rawShipCrewContribution (keyed on the buckets array identity, no notable merged, dept filter, the exact per-profession multiplier). Prototyped. | Yes (whole-state hashes equal on the 7 parity cases, 12 h and 4 days) | 11% per step; real 4-day run 62.0 s to 52.2 s | Low (buckets arrays are never mutated in place; add a guard test) | Small |
| E2 | Exact cleanup: battle movement reads per-tick constants once; a cross-step ship repair bonus cache; an index of worn pieces for gear wear; sumFamilyResist without strings | Yes by design | Estimated 10 to 20% more | Medium (battle engine) | Medium |
| E0 | Nothing more (the progress bar already prevents the freeze) | Yes | None | None | None |
| R1 | Coarser "resume when safe" search: stop bisecting within N per mille (still a tested-safe amount; a pause is at most N per mille longer) | No (pause lengths change) | On top of E1: N=8 12%, N=32 19%, N=128 30% | Design call | Tiny |
| R2 | Repair to full in a pause (reverses the user's "Resume when safe") | No | About 2x on top of E1 | Reverses a user decision | Tiny |
| R3 | Drop the pristine "outmatched" check (reverses a user decision) | No | About 8% short term | Reverses a user decision | Tiny |

Ruled out: caching projections (they never repeat), caching museum bonuses (no gain), a Web Worker (moves the work, does
not shorten it), parallel bisection probes (complex; phones have few fast cores).

## Phone waits (five patrols flying the whole time, worst case)

| Build | us a step | 4 days desktop | 4 days phone (x3 / x6) | 2 days phone (x3 / x6) |
|---|---|---|---|---|
| Prod 0.13.11.4 | 31 | 11 s | 32 s / 64 s | 16 s / 32 s |
| 0.14.0 now (E0) | 222 | 77 s | 3.8 / 7.7 min | 1.9 / 3.8 min |
| E1 | 198 | 68 s | 3.4 / 6.8 min | 1.7 / 3.4 min |
| E1+E2 (estimate) | about 160 | 55 s | 2.8 / 5.5 min | 1.4 / 2.8 min |
| E1+R1 (N=32) | 159 | 55 s | 2.7 / 5.5 min | 1.4 / 2.7 min |
| E1+R2 | 98 | 34 s | 1.7 / 3.4 min | 0.8 / 1.7 min |

As the fixture actually plays out (3 of 5 patrols stop "outmatched" within 30 h): 4 days now 62.0 s desktop (3.1 / 6.2
min phone); with E1 52.2 s (2.6 / 5.2 min); 2 days now about 34 s (1.7 / 3.4 min).

## Side finding (balance question for the user)

In the fixture, 3 of the 5 Repeat patrols stop "outmatched" within 30 h (one after 111 routes and 44 pauses), via the
FR-E pristine check. Is that intended at this gear level, or a 0.16.0 tuning item?
