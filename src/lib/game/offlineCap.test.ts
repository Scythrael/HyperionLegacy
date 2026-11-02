// offlineCap.test.ts: HOTFIX 0.13.11.3, the 4-day offline cap and truthful While You Were Away recaps.
//
// The bug (at 0.13.11.2): a 3d 1h weekend absence was paid 2 days at load (the trusted-time allowance),
// the rest was held, and when the server confirmed the clock the release paid its last ~30 s of
// budget while a SECOND popup claimed the whole raw gap ("~1d 1h"). User, 2026-11-02: "Let's change
// the cap to 4 days by default." and "when the cap is hit, the popup should easily reflect this."
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OFFLINE_CAP_DAYS_BASE, OFFLINE_CAP_SECONDS_BASE } from "./offlineCap";
import { offlineCapSeconds, offlineCapTicks, tick } from "./tick";
import { freshState, type GameState } from "./model";
import { initTrustState, readTrusted, UNVERIFIED_ALLOWANCE_MS } from "../trustedTime";
import { cappedAbsence, exceedsOfflineCap, paidRealSeconds, planPoll, releaseHeld, awayRecapSpan, type AdvancePlan } from "./loopClock";
import { formatOfflineCap, offlineRecapText } from "./offlineSummary";
import { HELP_TOPICS } from "../helpTopics";

const H = 3600;
const D = 86_400;
const REAL0 = Date.UTC(2026, 10, 2, 9);
// The App's recap thresholds (App.svelte OFFLINE_SUMMARY_MIN_SECONDS / AWAY_SUMMARY_MIN_SECONDS).
const OFFLINE_SUMMARY_MIN_SECONDS = 60;
const AWAY_SUMMARY_MIN_SECONDS = 120;

// The load path exactly as App.svelte's onMount runs it, reduced to the numbers the recap reads.
function load(absenceSeconds: number, state: GameState) {
  const stamp = REAL0;
  const device = stamp + absenceSeconds * 1000;
  const r = readTrusted(initTrustState({ floorMs: stamp, verifiedMs: stamp }, [stamp], 0), device, 0);
  const offlineSeconds = (r.nowMs - stamp) / 1000;
  const heldSeconds = r.heldMs / 1000;
  const cap = offlineCapSeconds(state);
  return {
    offlineSeconds,
    heldSeconds,
    paidSeconds: Math.min(offlineSeconds, cap),
    cappedAwaySeconds: cappedAbsence(offlineSeconds + heldSeconds, cap),
    release: heldSeconds > 0 ? { budgetSeconds: Math.max(0, cap - offlineSeconds), heldSeconds } : null,
  };
}

// The poll the server confirmation triggers: everything that was held arrives at once.
function releasePoll(heldSeconds: number): AdvancePlan {
  const { plan } = planPoll({ cycleStartMs: REAL0, lastPollMs: REAL0, paused: false }, REAL0 + heldSeconds * 1000, 1, 1);
  if (plan.kind !== "advance") throw new Error("expected an advance plan");
  return plan;
}

describe("HOTFIX 0.13.11.3: the offline cap is 4 days and everything follows the constant", () => {
  it("the base is 4 days, and the per-state cap, the seconds cap and the trusted-time allowance all agree", () => {
    expect(OFFLINE_CAP_DAYS_BASE).toBe(4);
    expect(OFFLINE_CAP_SECONDS_BASE).toBe(4 * D);
    const s = freshState();
    expect(offlineCapTicks(s)).toBe(4 * D);
    expect(offlineCapSeconds(s)).toBe(4 * D);
    expect(offlineCapSeconds({ ...s, tickDurationSeconds: 2 })).toBe(4 * D); // the cap is time, whatever the cadence
    expect(UNVERIFIED_ALLOWANCE_MS).toBe(OFFLINE_CAP_SECONDS_BASE * 1000);
  });

  it("a 3d 1h absence pays in full on load, holds nothing, and so raises no second popup", () => {
    const s = freshState();
    const r = load(3 * D + H, s);
    expect(r.offlineSeconds).toBe(3 * D + H);
    expect(r.heldSeconds).toBe(0);
    expect(r.paidSeconds).toBe(3 * D + H);
    expect(r.cappedAwaySeconds).toBeNull();
    expect(r.release).toBeNull(); // nothing armed: no later release, no second recap
    const text = offlineRecapText(r.paidSeconds, offlineCapSeconds(s), r.cappedAwaySeconds);
    expect(text.lead).toBe("You were away for ~3d 1h. Here is what your fleet got done.");
    expect(text.capLine).toBe("Offline progress pays up to 4d per absence.");
    expect(text.capHit).toBe(false);
  });

  it("a 5-day absence pays 4 days, the recap says the cap was reached, and the release raises nothing", () => {
    const s = freshState();
    const r = load(5 * D, s);
    expect(r.paidSeconds).toBe(4 * D);
    expect(r.cappedAwaySeconds).toBe(5 * D);
    const text = offlineRecapText(r.paidSeconds, offlineCapSeconds(s), r.cappedAwaySeconds);
    expect(text.lead).toBe("Your fleet ran for ~4d while you were away. Here is what it got done.");
    expect(text.capLine).toBe("You were away ~5d. Offline progress pays up to 4d.");
    expect(text.capHit).toBe(true);
    // The server confirms: the held day arrives, but the cap is spent, so it pays nothing.
    if (r.release === null) throw new Error("expected a held release");
    const released = releaseHeld(releasePoll(r.heldSeconds), r.release, 0);
    expect(released.capped).toBe(true);
    expect(released.plan.mode).toBe("none");
    expect(paidRealSeconds(released.plan, s)).toBe(0);
  });

  it("the load itself pays exactly the cap through tick() for an absence past it", () => {
    const s = freshState();
    s.tickDurationSeconds = 6 * H; // coarse cadence keeps tick() cheap: the cap is 16 ticks
    const paid = tick(5 * D, s, () => 0, REAL0);
    const atCap = tick(4 * D, s, () => 0, REAL0);
    expect(paid.gameTimeSeconds).toBe(atCap.gameTimeSeconds);
  });
});

describe("HOTFIX 0.13.11.3: a release recap is labeled with the seconds it PAID", () => {
  it("the 0.13.11.2 bug: a release cut to its last 30 s of budget pays 30 s, below the recap threshold", () => {
    const s = freshState();
    const plan = releasePoll(D + H); // the raw gap the old label used
    const released = releaseHeld(plan, { budgetSeconds: 30, heldSeconds: D + H }, 0);
    expect(released.plan.mode).toBe("catchUp");
    expect(paidRealSeconds(released.plan, s)).toBe(30);
    expect(paidRealSeconds(released.plan, s)).toBeLessThan(AWAY_SUMMARY_MIN_SECONDS);
    expect(released.capped).toBe(true);
  });

  it("a release with budget left is labeled with what it paid, never the raw gap", () => {
    const s = freshState();
    const released = releaseHeld(releasePoll(D + H), { budgetSeconds: 600, heldSeconds: D + H }, 0);
    expect(paidRealSeconds(released.plan, s)).toBe(600);
    const span = awayRecapSpan(null, s, paidRealSeconds(released.plan, s), REAL0, null);
    expect(offlineRecapText(span.secondsAway, offlineCapSeconds(s), span.cappedAwaySeconds).lead).toBe(
      "You were away for ~10m. Here is what your fleet got done."
    );
  });

  it("a live catch-up past the cap pays and is labeled as the cap, and is flagged as capped", () => {
    const s = freshState();
    s.tickDurationSeconds = 6 * H;
    const { plan } = planPoll({ cycleStartMs: REAL0, lastPollMs: REAL0, paused: false }, REAL0 + 5 * D * 1000, s.tickDurationSeconds, 1);
    if (plan.kind !== "advance") throw new Error("expected an advance plan");
    expect(exceedsOfflineCap(plan, s)).toBe(true);
    expect(paidRealSeconds(plan, s)).toBe(4 * D);
  });

  it("extending an open recap adds the live play before the new absence plus what it paid, keeping the cap note", () => {
    const s = freshState();
    const open = { before: s, secondsAway: 4 * D, shownAtMs: REAL0, cappedAwaySeconds: 5 * D };
    const span = awayRecapSpan(open, freshState(), 30, REAL0 + 60_000, null);
    expect(span.secondsAway).toBe(4 * D + 60 + 30);
    expect(span.cappedAwaySeconds).toBe(5 * D);
  });

  it("an absence a minute or less past the cap does not claim the cap was reached", () => {
    expect(cappedAbsence(4 * D + 30, 4 * D)).toBeNull();
    expect(cappedAbsence(4 * D + 3600, 4 * D)).toBe(4 * D + 3600);
  });

  it("App labels every recap with paid seconds, never the raw gap (source check)", () => {
    const app = readFileSync("src/App.svelte", "utf-8");
    expect(app).not.toContain("welcomeBack(beforeEconomy, plan.realElapsedSeconds)");
    expect(app).toContain("welcomeBack(beforeEconomy, pollPaidSeconds,");
    expect(app).toContain("welcomeBack(away.snapshot, away.paidSeconds,");
    expect(app).toContain("summarizeOfflineProgress(beforeSnapshot, state, loadPaidSeconds)");
    expect(app).toContain("loadPaidSeconds >= OFFLINE_SUMMARY_MIN_SECONDS");
    expect(app).toContain("paidSeconds < AWAY_SUMMARY_MIN_SECONDS");
    expect(app).toContain("offlineRecapText(sum.secondsAway, offlineCapSeconds(state), offlineSummaryCappedAwaySeconds)");
    expect(OFFLINE_SUMMARY_MIN_SECONDS).toBeLessThan(AWAY_SUMMARY_MIN_SECONDS);
  });
});

describe("HOTFIX 0.13.11.3: the cap is named from its constant", () => {
  it("formats the cap as a plain length", () => {
    expect(formatOfflineCap(OFFLINE_CAP_SECONDS_BASE)).toBe("4d");
    expect(formatOfflineCap(4.5 * D)).toBe("4d 12h");
  });

  it("Help's Offline Progress topic states the cap", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "offline");
    expect(topic).toBeDefined();
    expect(topic!.body).toContain(`pays up to ${formatOfflineCap(OFFLINE_CAP_SECONDS_BASE)} per absence`);
    expect(/[–—]/.test(topic!.body)).toBe(false);
  });
});
