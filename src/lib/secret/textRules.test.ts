// textRules.test.ts: the project's text, glyph and accessibility rules on every 0.13.11 file.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  HELP_SECTIONS,
  HELP_SKILL_POINTS_TOTAL,
  COPY,
  AUTOMATION_NAMES,
  AUTOMATION_LINES,
  OC_FACTOR,
  TEN_BONUS,
  CAPTAIN_AT,
  FLEET_AT,
  PRESTIGECEPTION_AT,
  PC_BAR_RATIO,
  SKILL_GATE_LIFT_PC,
  SKILL_POINT_SCHEDULE,
  RELIC_PAST_CAP_WEIGHT,
  TIERS,
  MILESTONES,
} from "./config";
import { totalSkillCost } from "./engine";
import { formatThreshold, groupThousands } from "./format";
import { RELIC_SOFT_CAP } from "../game/relics";

const FILES = [
  "src/lib/secret/format.ts",
  "src/lib/secret/combo.ts",
  "src/lib/secret/codes.ts",
  "src/lib/secret/config.ts",
  "src/lib/secret/state.ts",
  "src/lib/secret/engine.ts",
  "src/lib/secret/catchUp.ts",
  "src/lib/secret/sim.ts",
  "src/lib/secret/runtime.ts",
  "src/lib/secret/testStates.ts",
  "src/lib/secret/testStorage.ts",
  "src/lib/secret/testReport.ts",
  "src/lib/secret/simReport.ts",
  "src/lib/secret/overlayKeys.ts",
  "src/lib/EnterCodeModal.svelte",
  "src/lib/SecretGameOverlay.svelte",
  "docs/plans/2026-10-22-hotfix-0.13.11-secret-generator-plan.md",
  // 0.13.11.1
  "src/lib/secret/sha256.ts",
  "src/lib/accountExtras.ts",
  "src/lib/achievements.ts",
  "src/lib/themeStyle.ts",
  "src/lib/AchievementToasts.svelte",
  "src/lib/HeaderButtons.svelte",
  "src/lib/secret/devTools.ts",
  "docs/plans/2026-10-23-hotfix-0.13.11.1-plan.md",
  "src/lib/trustedTime.ts",
  "src/lib/trustedTime.test.ts",
  "src/lib/secret/simTargets.test.ts",
  "src/lib/secret/simTargetsHigh.test.ts",
  "src/lib/secret/simOptimal.test.ts",
  "src/lib/secret/simCasual.test.ts",
  "src/lib/secret/simTargetsLong.test.ts",
  "src/lib/secret/buyQuotes.test.ts",
  // 0.13.11.2
  "src/lib/secret/prestigePreview.test.ts",
  "docs/plans/2026-10-26-hotfix-0.13.11.2-plan.md",
  // 0.14.0 Slice 5b: the background visualization track
  "src/lib/backgroundStyle.ts",
  "src/lib/backgroundStyle.test.ts",
  "src/lib/ftlRenderer.ts",
  "src/lib/ftlRenderer.test.ts",
  "src/lib/backgroundWiring.test.ts",
  "src/lib/Background.svelte",
  "src/lib/BackgroundConfigure.svelte",
  "src/lib/FasterThanLight.svelte",
  // 0.14.0 prestige redesign (Slice 7 close-out)
  "src/lib/secret/prestigeCards.ts",
  "src/lib/secret/prestigeConversion.ts",
  "src/lib/secret/overlayRows.ts",
  "src/lib/secret/overlayRows.test.ts",
  "docs/plans/2026-10-27-minigame-prestige-redesign-plan.md",
  "docs/qa/2026-10-30-minigame-prestige-redesign-qa.html",
].map((path) => ({ path, src: readFileSync(path, "utf-8") }));

// 0.13.11.1 additions inside files that predate the text rules, checked as slices.
function slice(path: string, from: string, to: string): { path: string; src: string } {
  const all = readFileSync(path, "utf-8");
  const a = all.indexOf(from);
  const b = all.indexOf(to, a + from.length);
  expect(a, `${path}: ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `${path}: ${to}`).toBeGreaterThan(a);
  return { path: `${path} [${from}]`, src: all.slice(a, b) };
}
const SLICES = () => [
  slice("src/app.css", "THEME STYLES (0.13.11.1", "/* REDUCED MOTION"),
  slice("src/App.svelte", "// 0.13.11.1: the combo only UNLOCKS.", "// The modal's top-tab list"),
  slice("src/App.svelte", "<!-- 0.13.11.1 HEADER BUTTON BLOCK", '<main class="tab-body">'),
  slice("src/App.svelte", "<!-- 0.13.11.1 THEME (user", "<!-- HEADER CURRENCIES"),
  slice("src/App.svelte", "// The look: preset + manual picks", "// [DEV] grant the Starfall"),
  slice("src/lib/patchNotes.ts", 'version: "0.13.11.1"', 'version: "0.13.11"'),
  slice("src/lib/patchNotes.ts", 'version: "0.13.11.2"', 'version: "0.13.11.1"'),
  slice("src/lib/game/model.ts", "0.13.11.1 ACCOUNT-LEVEL EXTRAS", "unlockedThemeStyles?: string[];"),
  slice("src/lib/game/loopClock.ts", "export function clampCatchUp", "\n}"),
];

const COMPONENTS = FILES.filter((f) => f.path.endsWith(".svelte"));

describe("0.13.11 text rules", () => {
  it("reads real files", () => {
    for (const f of FILES) expect(f.src.length, f.path).toBeGreaterThan(200);
  });

  it("has no em or en dashes and no double-hyphen dash substitutes", () => {
    for (const f of [...FILES, ...SLICES()]) {
      expect(/[–—]/.test(f.src), `${f.path} has an em or en dash`).toBe(false);
      expect(/(^|\s)--(\s|$)/m.test(f.src), `${f.path} has a "--" dash`).toBe(false);
    }
  });

  it("has no stray control characters (a raw backspace once slipped into a comment)", () => {
    const whole = ["src/lib/game/loopClock.ts", "src/lib/game/loopClock.test.ts", "src/App.svelte"].map((path) => ({ path, src: readFileSync(path, "utf-8") }));
    for (const f of [...FILES, ...SLICES(), ...whole]) expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(f.src), `${f.path} has a control character`).toBe(false);
  });

  it("uses SVG glyphs, never emoji", () => {
    for (const f of [...FILES, ...SLICES()]) expect(/\p{Extended_Pictographic}/u.test(f.src), `${f.path} has an emoji`).toBe(false);
  });

  it("says install, never fit, and objective, never task", () => {
    for (const f of [...FILES, ...SLICES()].filter((x) => !x.path.endsWith(".md"))) {
      expect(/\bfit(s|ting|ted|ment)?\b/i.test(f.src), `${f.path} says fit`).toBe(false);
      expect(/\btasks?\b/i.test(f.src), `${f.path} says task`).toBe(false);
    }
  });

  it("sizes every font on the scale so the text-size control reaches it", () => {
    for (const c of COMPONENTS) {
      for (const m of c.src.matchAll(/font-size:\s*([^;}]+)[;}]/g)) {
        expect(m[1].includes("var(--text-") || m[1].includes("var(--ui-scale)"), `${c.path}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("only animates the overlay when the player has not asked for reduced motion", () => {
    const overlay = COMPONENTS.find((c) => c.path.endsWith("SecretGameOverlay.svelte"))!.src;
    const guard = overlay.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(guard).toBeGreaterThan(0);
    const animations = [...overlay.matchAll(/animation:/g)].map((m) => m.index!);
    expect(animations.length).toBeGreaterThan(0);
    for (const at of animations) expect(at).toBeGreaterThan(guard);
    const enter = COMPONENTS.find((c) => c.path.endsWith("EnterCodeModal.svelte"))!.src;
    expect(enter).not.toMatch(/animation:|transition:/);
  });

  it("gives every combo pad button an accessible name", () => {
    const enter = COMPONENTS.find((c) => c.path.endsWith("EnterCodeModal.svelte"))!.src;
    const pad = [...enter.matchAll(/<button[^>]*class="ec-btn (?:ec-dir|ec-small|ec-round)[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(pad.length).toBe(8);
    for (const b of pad) expect(b, b).toMatch(/aria-label="[^"]+"/);
  });

  it("never names the combo or the secret in player-facing Settings or Help text", () => {
    const app = readFileSync("src/App.svelte", "utf-8");
    const codesPanel = app.slice(app.indexOf('{#if activeOptionsTab === "codes"}'), app.indexOf("{/if}", app.indexOf('{#if activeOptionsTab === "codes"}')));
    expect(codesPanel).not.toMatch(/combo|konami|secret|v0\.0000001a/i);
    const help = readFileSync("src/lib/helpTopics.ts", "utf-8");
    expect(help).not.toMatch(/combo|konami|v0\.0000001a|Prestigeception/i);
  });
});

// 0.14.0 prestige redesign Slice 7: the [?] Help view and THE FINE PRINT rewritten for the redesign.
describe("0.14.0 minigame Help and text rules", () => {
  const help = HELP_SECTIONS.map((h) => h.body).join(" ");
  const section = (title: string) => HELP_SECTIONS.find((h) => h.title === title)?.body ?? "";
  // Every player-facing line of the minigame: Help, COPY, the automation and milestone texts.
  const playerText = [help, ...Object.values(COPY), ...Object.values(AUTOMATION_NAMES), ...Object.values(AUTOMATION_LINES), ...MILESTONES.flatMap((m) => [m.name, m.detail, m.how, m.flavor ?? "", m.reward ?? ""])].join(" ");

  it("every number in Help reads from a constant: the source of HELP_SECTIONS has no digit outside a ${...}", () => {
    const src = readFileSync("src/lib/secret/config.ts", "utf-8");
    const block = src.slice(src.indexOf("export const HELP_SECTIONS"), src.indexOf("];", src.indexOf("export const HELP_SECTIONS")));
    expect(block.length).toBeGreaterThan(2000);
    // Drop the type annotation, then every ${...} (none nests braces), then look for digits.
    const text = block.replace(/^export const HELP_SECTIONS[^=]*=/, "").replace(/\$\{[^}]*\}/g, "");
    expect(text.match(/\d/g), text.match(/.{0,30}\d.{0,30}/)?.[0]).toBeNull();
  });

  it("the Help numbers are the constants' values", () => {
    expect(section("THE TEN BONUS")).toContain(`×${TEN_BONUS}`);
    expect(section("OVERCLOCK AND UPGRADES")).toContain(`×${OC_FACTOR} per level`);
    const three = section("THREE KINDS OF PRESTIGE");
    expect(three).toContain(`${formatThreshold(CAPTAIN_AT)} Ore`);
    expect(three).toContain("1e60 Ore");
    expect(three).toContain(`${formatThreshold(FLEET_AT)} Ore`);
    expect(three).toContain("1.8e308 Ore");
    expect(three).toContain(`${formatThreshold(PRESTIGECEPTION_AT)} Ore`);
    // Skill Points by schedule (the Slices 3 + 4 review): the schedule's head, its repeating last entry, the total.
    const head = SKILL_POINT_SCHEDULE.slice(0, -1);
    expect(three).toContain(`${head.slice(0, -1).join(", ")} and ${head[head.length - 1]} for your first ${head.length} Fleet Prestiges, then ${SKILL_POINT_SCHEDULE[SKILL_POINT_SCHEDULE.length - 1]} each`);
    expect(HELP_SKILL_POINTS_TOTAL).toBe(totalSkillCost());
    expect(three).toContain(`(${totalSkillCost()} in all)`);
    expect(section("THE FINE PRINT")).toContain(`${PC_BAR_RATIO} times as many Dream Points as you hold`);
    expect(section("SKILLS")).toContain(`From your ${SKILL_GATE_LIFT_PC}th Prestigeception on`);
    expect(section("RELIC BOOSTS")).toContain(`${groupThousands(RELIC_SOFT_CAP)} count ${RELIC_PAST_CAP_WEIGHT} times over`);
    const ladder = TIERS.map((t) => t.unlockFleet).filter((n) => n > 0);
    expect(section("THE FINE PRINT")).toContain(`${ladder.slice(0, -1).join(", ")} and ${ladder[ladder.length - 1]} lifetime Fleet Prestiges`);
    expect(section("AUTOMATIONS")).toContain("1, 10 or Max at a time");
  });

  it("covers the redesign: automations and their tab, skill gates and the lift, the three prestiges, milestones, pay at the bar", () => {
    const titles = HELP_SECTIONS.map((h) => h.title);
    for (const t of ["THREE KINDS OF PRESTIGE", "THE FINE PRINT", "SKILLS", "AUTOMATIONS", "MILESTONES"]) expect(titles).toContain(t);
    expect(section("AUTOMATIONS")).toMatch(/earned at a milestone, never bought/);
    expect(section("AUTOMATIONS")).toMatch(/Automation tab/);
    expect(section("AUTOMATIONS")).toMatch(/Auto Captain Prestige holds while Auto-buy I to IV is off/);
    expect(section("MILESTONES")).toMatch(/unlock an automation/);
    expect(section("SKILLS")).toMatch(/each row says exactly when/);
    expect(section("SKILLS")).toMatch(/open from the start of each climb/);
    expect(section("THE FINE PRINT")).toMatch(/waiting earns nothing extra/);
    expect(section("THE FINE PRINT")).toContain(COPY.pcFirst);
    // The secret automation and locked content stay unnamed.
    expect(help).not.toContain(AUTOMATION_NAMES.autoPc);
    expect(help).not.toContain(AUTOMATION_NAMES.autoSkills);
  });

  it("never abbreviates Fleet Admiral Prestige, and says Tactical Protocols, never gambit, to the player", () => {
    const files = [readFileSync("src/lib/SecretGameOverlay.svelte", "utf-8"), readFileSync("src/lib/secret/config.ts", "utf-8"), playerText];
    for (const f of files) expect(f).not.toMatch(/\bFAP\b/);
    expect(playerText).not.toMatch(/gambit/i);
  });
});
