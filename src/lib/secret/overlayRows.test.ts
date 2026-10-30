// overlayRows.test.ts: the Automation tab's and the Skills tab's rows, and the Milestones list's reward
// column (0.14.0 prestige redesign Slice 7, built to the signed-off mockup).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { freshSecretState, serializeSecret, deserializeSecret, type SecretState } from "./state";
import { setAutomationBuy, milestoneVisible, setAuto, checkMilestonesMut, markAutomationsSeen } from "./engine";
import { automationRows, automationRow, skillRow, skillRows, milestoneRewardText } from "./overlayRows";
import { AUTOMATION_IDS, AUTOMATION_NAMES, AUTOMATION_UNLOCKS, AUTOMATION_LINES, AUTOMATION_SHORT_LINES, AUTOMATION_BUY_DEFAULT, LEVELED_SKILLS, MILESTONES, COPY, SECRET_PRIZE_EXPONENT } from "./config";

const T0 = 1_000_000;
const fresh = (): SecretState => freshSecretState(T0);
const name = (id: (typeof MILESTONES)[number]["id"]) => MILESTONES.find((m) => m.id === id)!.name;

describe("the Automation tab", () => {
  it("a fresh game shows every automation as ???, naming nothing", () => {
    const rows = automationRows(fresh());
    expect(rows.map((r) => r.id).sort()).toEqual([...AUTOMATION_IDS].sort());
    for (const r of rows) {
      expect(r.state, r.id).toBe("hidden");
      expect(r.name).toBe("???");
      expect(r.line).toBe(COPY.automationHidden);
      expect(r.short).toBe(COPY.automationHiddenShort);
    }
    const text = JSON.stringify(rows);
    for (const id of AUTOMATION_IDS) expect(text).not.toContain(AUTOMATION_NAMES[id]);
  });

  it("a locked automation reads ??? until its milestone is visible, then names it and where it is earned", () => {
    const s = fresh();
    expect(milestoneVisible(s, "firstFleet")).toBe(false);
    expect(automationRow(s, "autoOverclock").state).toBe("hidden");
    s.captainCount = 1; // Fleet Week shows after the first Captain Prestige
    expect(milestoneVisible(s, "firstFleet")).toBe(true);
    const r = automationRow(s, "autoOverclock");
    expect(r).toEqual({ id: "autoOverclock", state: "ahead", name: "Auto Overclock", line: AUTOMATION_LINES.autoOverclock, short: AUTOMATION_LINES.autoOverclock, milestone: name("firstFleet") });
    for (const id of AUTOMATION_IDS) {
      const row = automationRow(s, id);
      expect(row.state === "hidden", id).toBe(!milestoneVisible(s, AUTOMATION_UNLOCKS[id]) || id === "autoPc");
    }
  });

  it("an earned automation has its switch and its controls: a buy amount, a target menu, or the switch alone", () => {
    const s = fresh();
    for (const id of AUTOMATION_IDS) s.automations[id] = true;
    s.milestones.firstPc = T0; // reveals Auto Prestigeception
    const rows = Object.fromEntries(automationRows(s).map((r) => [r.id, r]));
    for (const id of AUTOMATION_IDS) {
      const r = rows[id];
      expect(r.state, id).toBe("open");
      if (r.state !== "open") continue;
      expect(r.on, id).toBe(true);
      expect(r.milestone).toBe(name(AUTOMATION_UNLOCKS[id]));
      if (AUTOMATION_BUY_DEFAULT[id] !== undefined) expect(r.control, id).toEqual({ kind: "buy", amount: AUTOMATION_BUY_DEFAULT[id] });
    }
    expect(rows.autoCaptain.state === "open" && rows.autoCaptain.control).toEqual({ kind: "target", layer: "captain" });
    expect(rows.autoFleet.state === "open" && rows.autoFleet.control).toEqual({ kind: "target", layer: "fleet" });
    // User 2026-10-29: Auto Prestigeception fires at the bar, a plain on/off with no target menu.
    expect(rows.autoPc.state === "open" && rows.autoPc.control).toEqual({ kind: "switch" });
    // The buy amount and the switch read the save.
    const t = setAuto(setAutomationBuy(s, "autoOverclock", "10"), "autoOverclock", false);
    const oc = automationRow(t, "autoOverclock");
    expect(oc.state === "open" && oc.control).toEqual({ kind: "buy", amount: "10" });
    expect(oc.state === "open" && oc.on).toBe(false);
  });

  it("Auto Prestigeception stays ??? until the player's own first Prestigeception, even once earned", () => {
    const s = fresh();
    s.milestones.googol = T0;
    s.automations.autoPc = true;
    const r = automationRow(s, "autoPc");
    expect(r).toEqual({ id: "autoPc", state: "hidden", name: "???", line: COPY.automationSecret, short: COPY.automationSecret });
    expect(JSON.stringify(automationRows(s))).not.toMatch(/Prestigeception/);
    s.milestones.firstPc = T0 + 1;
    expect(automationRow(s, "autoPc").name).toBe(AUTOMATION_NAMES.autoPc);
  });

  it("lists the earned ones first, then the named ones, then the ??? rows (the mockup)", () => {
    const s = fresh();
    s.captainCount = 1;
    s.fleetTotal = 1;
    s.milestones.firstFleet = T0;
    s.automations.autoOverclock = true;
    s.automations.autoUpgrades = true;
    const states = automationRows(s).map((r) => r.state);
    expect(states[0]).toBe("open");
    expect(states[1]).toBe("open");
    expect(automationRows(s).slice(0, 2).map((r) => r.id)).toEqual(["autoOverclock", "autoUpgrades"]);
    const rank = { open: 0, ahead: 1, hidden: 2 };
    for (let i = 1; i < states.length; i++) expect(rank[states[i]]).toBeGreaterThanOrEqual(rank[states[i - 1]]);
    expect(states).toContain("ahead");
  });

  it("the Auto Captain row says it is waiting for Auto-buy I to IV while it is", () => {
    const s = fresh();
    s.automations.autoCaptain = true;
    const waiting = automationRow(s, "autoCaptain");
    expect(waiting.state === "open" && waiting.note).toBe(COPY.autoCaptainWaiting);
    s.automations.autoBuyLow = true;
    const ready = automationRow(s, "autoCaptain");
    expect(ready.state === "open" && ready.note).toBeNull();
  });
});

describe("the Skills tab", () => {
  it("a skill that opens at a milestone not visible yet reads ???", () => {
    const r = skillRow(fresh(), "headStart");
    expect(r.state).toBe("hidden");
    expect(r.name).toBe("???");
    expect(r.gate).toBe(COPY.skillHidden);
    expect(r.flavor).toBe("");
  });

  it("a gated skill says exactly when it opens; a prestige-count gate is always shown", () => {
    const s = fresh();
    s.captainCount = 1;
    expect(skillRow(s, "headStart")).toMatchObject({ state: "gated", name: "Head Start", gate: `Opens at ${name("firstFleet")}.`, canBuy: false });
    expect(skillRow(s, "captainsAcademy")).toMatchObject({ state: "gated", gate: "Opens at your 2nd Fleet Prestige this Prestigeception (now 0)." });
  });

  it("an open skill shows level X / Y, now and next, its cost, and the scale chip once its count is above 0", () => {
    const s = fresh();
    s.milestones.firstFleet = T0;
    s.fleetTotal = 6;
    s.skillPoints = 3;
    const r = skillRow(s, "headStart");
    expect(r).toMatchObject({ state: "open", level: 0, cap: 2, maxed: false, cost: 1, canBuy: true, gate: null });
    expect(r.now.value).toBe("1e1");
    expect(r.next).toMatch(/^1e\d+$/);
    expect(r.scale).toContain("from your 6 lifetime Fleet Prestiges");
    s.fleetTotal = 0;
    expect(skillRow(s, "headStart").scale).toBeNull();
  });

  it("a maxed skill reads Maxed with no next level, even with its gate closed", () => {
    const s = fresh();
    s.skillLevels = { captainsAcademy: 3 };
    const r = skillRow(s, "captainsAcademy");
    expect(r).toMatchObject({ state: "open", level: 3, maxed: true, next: null, cost: null, canBuy: false });
  });

  it("a skill with levels whose gate closed again (after a reset) keeps its level on the gated row", () => {
    const s = fresh();
    s.skillLevels = { captainsAcademy: 1 };
    expect(skillRow(s, "captainsAcademy")).toMatchObject({ state: "gated", level: 1 });
  });

  it("lists every leveled skill and no automation", () => {
    const rows = skillRows(fresh());
    expect(rows.map((r) => r.id)).toEqual(LEVELED_SKILLS.map((d) => d.id));
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    const skills = ov.slice(ov.indexOf('{:else if tab === "skills"}'), ov.indexOf('{:else if tab === "automation"}'));
    expect(skills).not.toMatch(/autoActive|setAuto|AUTOMATION_NAMES|automationRow/);
  });
});

describe("the e25,000,000 milestone stays ??? in every view until reached", () => {
  it("the Milestones list, its reward column, the Stats goals and the overlay source", () => {
    const s = fresh();
    s.milestones.e20m = T0;
    expect(milestoneVisible(s, "e25m")).toBe(false);
    expect(milestoneRewardText(s, "e25m", false)).toBe("???");
    expect(milestoneRewardText(s, "e25m", true)).toBe(COPY.ftlRewardDone);
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).not.toMatch(/SECRET_PRIZE_EXPONENT|"e25m"|25000000/);
    const goals = ov.slice(ov.indexOf("const ORE_GOALS"), ov.indexOf("\n", ov.indexOf("const ORE_GOALS")));
    expect(goals).not.toContain(String(SECRET_PRIZE_EXPONENT));
    // The list renders a milestone only through milestoneVisible.
    expect(ov).toContain("{#if milestoneVisible(s, m.id)}");
  });

  it("the other reward columns: Starfall by name, automations by name (or the mystery line), else recorded", () => {
    const s = fresh();
    expect(milestoneRewardText(s, "starfall", true)).toBe(COPY.starfallRewardDone);
    expect(milestoneRewardText(s, "firstFleet", true)).toBe("Auto Overclock unlocked");
    expect(milestoneRewardText(s, "googol", false)).not.toContain("Prestigeception");
    expect(milestoneRewardText(s, "e100k", true)).toBe(COPY.rewardRecorded);
  });
});

describe("the mockup's phone lines", () => {
  it("automatic Captain and Fleet Prestige read 'At your target.' on a phone; the rest read their full line", () => {
    const s = fresh();
    for (const id of AUTOMATION_IDS) s.automations[id] = true;
    s.milestones.firstPc = T0;
    for (const id of AUTOMATION_IDS) {
      const r = automationRow(s, id);
      expect(r.state === "open" && r.short, id).toBe(AUTOMATION_SHORT_LINES[id] ?? AUTOMATION_LINES[id]);
    }
    expect(AUTOMATION_SHORT_LINES.autoCaptain).toBe("At your target.");
    expect(COPY.automationHiddenShort).toBe("A milestone you have not seen yet.");
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain('<span class="lbl-full">Next level:</span><span class="lbl-short">Next:</span>');
    const phone = ov.slice(ov.indexOf("@media (max-width: 480px)"));
    expect(phone).toMatch(/\.row-flavor \{\s*display: none;/);
  });
});

// User 2026-10-30: the signed-off mockup's NEW marker on the Automation tab. Lit when an automation unlocks (or a
// secret one reveals itself), cleared when the tab is opened; an optional save field, no version bump.
describe("the Automation tab's NEW marker", () => {
  it("lights when a milestone grants an automation, not for a secret grant, and again when the secret reveals itself", () => {
    const s = fresh();
    s.fleetTotal = 1;
    checkMilestonesMut(s, T0);
    expect(s.automations.autoOverclock).toBe(true);
    expect(s.automationsNew).toBe(true);
    const seen = markAutomationsSeen(s);
    expect(seen.automationsNew).toBeUndefined();
    expect(markAutomationsSeen(seen)).toBe(seen);
    // A Respectable Googol grants the secret Auto Prestigeception: nothing to see yet, so nothing lights.
    seen.milestones.googol = T0;
    checkMilestonesMut(seen, T0 + 1);
    expect(seen.automations.autoPc).toBe(true);
    expect(seen.automationsNew).toBeUndefined();
    // The player's own first Prestigeception reveals it: that lights it.
    seen.pcCount = 1;
    checkMilestonesMut(seen, T0 + 2);
    expect(seen.automationsNew).toBe(true);
  });

  it("a step that records no milestone never lights it", () => {
    const s = fresh();
    s.fleetTotal = 1;
    checkMilestonesMut(s, T0);
    const t = markAutomationsSeen(s);
    checkMilestonesMut(t, T0 + 1);
    expect(t.automationsNew).toBeUndefined();
  });

  it("round-trips in the save, written only while lit; an old save reads unlit", () => {
    const s: SecretState = { ...fresh(), prestigeV: 1 }; // a 0.14.0 save (loading never converts it)
    expect(serializeSecret(s)).not.toContain("automationsNew");
    s.automationsNew = true;
    const raw = serializeSecret(s);
    expect(raw).toContain('"automationsNew":true');
    expect(deserializeSecret(raw, T0)!.automationsNew).toBe(true);
    expect(serializeSecret(deserializeSecret(raw, T0)!)).toBe(raw);
    const bad = JSON.parse(raw);
    bad.automationsNew = "yes";
    expect(deserializeSecret(JSON.stringify(bad), T0)!.automationsNew).toBeUndefined();
    delete bad.automationsNew;
    expect(deserializeSecret(JSON.stringify(bad), T0)!.automationsNew).toBeUndefined();
  });

  it("the tab shows it and opening the tab clears it", () => {
    const ov = readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8");
    expect(ov).toContain('{#if t.key === "automation" && s.automationsNew}<span class="tab-new">NEW</span>{/if}');
    expect(ov).toContain('$: if (tab === "automation" && s.automationsNew && !busy) secretAct((x) => markAutomationsSeen(x));');
  });
});
