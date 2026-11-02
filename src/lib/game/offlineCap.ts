// offlineCap.ts: the offline cap's base length, in its own tiny module (HOTFIX 0.13.11.3).
//
// Kept apart from tick.ts so trustedTime.ts (which the minigame also loads) can follow the same
// number without pulling the whole economy in. tick.ts re-exports it and derives the per-state cap
// (offlineCapTicks) from it; every other reader (the trusted-time allowance, the release budget,
// the While You Were Away popup, Help) follows this one constant, so a retune is one edit.
//
// User decision, 2026-11-02: "Let's change the cap to 4 days by default. I think that's fairer.
// Especially since a lot of people might just play during work hours haha." (Was 2 days through
// 0.13.11.2.) A future talent may raise the cap per save: that plugs into offlineCapTicks, never here.

export const OFFLINE_CAP_DAYS_BASE = 4;

export const SECONDS_PER_DAY = 86_400;

// The base cap in real seconds (what a save with no cap bonus may be paid for one absence).
export const OFFLINE_CAP_SECONDS_BASE = OFFLINE_CAP_DAYS_BASE * SECONDS_PER_DAY;
