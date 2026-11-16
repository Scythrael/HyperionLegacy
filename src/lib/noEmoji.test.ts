// The 0.14.0 emoji sweep guard (user 2026-11-16, "All of them in 0.14.0").
//
// WHY: emoji render differently on every OS, cannot take the theme's color, and on Android/Chrome even a "text" symbol
// such as the warning sign can come out as a color emoji. So every glyph a player sees is SVG through <Icon>
// (ui/icons.ts, classified in ui/iconPacks.ts ICON_SEMANTICS). This test reads every .svelte and .ts file under src
// (tests excluded), strips the CODE COMMENTS (the long-standing warning-sign notes in comments are for developers, not
// players), and fails on any pictographic emoji left in a string, in markup or in data, written literally, as a JS
// escape (\u{1F680}, a surrogate pair) or as an HTML entity (&#128640;).
//
// What counts: any Extended_Pictographic or Emoji_Presentation character, the emoji variation selector U+FE0F and the
// zero width joiner U+200D. Plain text symbols that are NOT emoji (the stars, the check mark drawn as text, arrows,
// the multiplication sign, the circled i) are not pictographic and pass. Nothing is allowlisted.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { BLUEPRINTS, EQUIPMENT_SLOTS } from "./game/model";
import { blueprintIcon, varietySvgIcon } from "./EquipmentTooltip.svelte";
import { ICON_PATHS } from "./ui/icons";
import { ICON_SEMANTICS } from "./ui/iconPacks";

const SRC = "src";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

// Blank a span, keeping its newlines so line numbers still match the file.
const blank = (s: string): string => s.replace(/[^\n]/g, " ");

// Strip // and /* */ comments from JS / TS, leaving strings and template literals intact (a "//" inside a string
// stays). A string never crosses a line here, so a stray quote can at worst mis-read the rest of its own line.
export function stripJsComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      // A template literal: copy its text, and strip comments inside each ${ } expression.
      let j = i + 1;
      out += "`";
      while (j < n && src[j] !== "`") {
        if (src[j] === "\\") {
          out += src.slice(j, j + 2);
          j += 2;
        } else if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            if (depth > 0) k++;
          }
          out += "${" + stripJsComments(src.slice(j + 2, k)) + "}";
          j = k + 1;
        } else {
          out += src[j];
          j++;
        }
      }
      out += "`";
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// A .svelte file: JS comments stripped inside <script>, CSS comments inside <style>, HTML comments in the markup.
export function stripSvelteComments(src: string): string {
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  const markup = (s: string) => s.replace(/<!--[\s\S]*?-->/g, blank);
  while ((m = re.exec(src)) !== null) {
    out += markup(src.slice(last, m.index));
    const open = m[0].slice(0, m[0].indexOf(">") + 1);
    const body = m[1] === "script" ? stripJsComments(m[2]) : m[2].replace(/\/\*[\s\S]*?\*\//g, blank);
    out += `${open}${body}</${m[1]}>`;
    last = m.index + m[0].length;
  }
  return out + markup(src.slice(last));
}

const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}]/u;

// Every code point a line spells: its literal characters plus the ones written as escapes or entities.
function decodedCodePoints(line: string): number[] {
  const cps: number[] = [...line].map((ch) => ch.codePointAt(0)!);
  for (const m of line.matchAll(/\\u\{([0-9a-fA-F]+)\}/g)) cps.push(parseInt(m[1], 16));
  // 🚀 style surrogate pairs, and lone ️ style escapes.
  for (const m of line.matchAll(/\\u([0-9a-fA-F]{4})(?:\\u([0-9a-fA-F]{4}))?/g)) {
    const hi = parseInt(m[1], 16);
    const lo = m[2] === undefined ? null : parseInt(m[2], 16);
    if (hi >= 0xd800 && hi <= 0xdbff && lo !== null && lo >= 0xdc00 && lo <= 0xdfff) cps.push((hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000);
    else {
      cps.push(hi);
      if (lo !== null) cps.push(lo);
    }
  }
  for (const m of line.matchAll(/&#(\d+);/g)) cps.push(parseInt(m[1], 10));
  for (const m of line.matchAll(/&#x([0-9a-fA-F]+);/g)) cps.push(parseInt(m[1], 16));
  // CSS escapes (content: "\1F512"): a backslash then 4 to 6 hex digits. Short JS escapes such as \b or \d decode to
  // control characters and are filtered out below.
  for (const m of line.matchAll(/\\([0-9a-fA-F]{4,6})(?![0-9a-fA-F])/g)) cps.push(parseInt(m[1], 16));
  return cps;
}

export function emojiOnLines(stripped: string): { line: number; text: string; found: string }[] {
  const hits: { line: number; text: string; found: string }[] = [];
  stripped.split("\n").forEach((text, idx) => {
    const found = decodedCodePoints(text)
      .filter((cp) => cp > 0x7f && cp <= 0x10ffff && PICTOGRAPHIC.test(String.fromCodePoint(cp)))
      .map((cp) => `U+${cp.toString(16).toUpperCase()}`);
    if (found.length > 0) hits.push({ line: idx + 1, text: text.trim().slice(0, 120), found: [...new Set(found)].join(" ") });
  });
  return hits;
}

describe("the emoji guard's own reader", () => {
  it("flags emoji in strings, markup, escapes and entities, and ignores comments and text symbols", () => {
    const ts = [
      'const a = "\u{1F680}";', // literal rocket in a string
      "const b = '\\u{1F512}';", // escaped lock
      'const c = "\\uD83D\\uDE80";', // surrogate pair
      "// a comment with \u{1F680} is fine",
      "/* so is ⚠️ here */ const d = 1;",
      'const e = "★ ✓ → × ⓘ";', // star, check, arrow, times, circled i: text symbols
      'const f = "a // not a comment \u{1F525}";',
    ].join("\n");
    const hits = emojiOnLines(stripJsComments(ts)).map((h) => h.line);
    expect(hits).toEqual([1, 2, 3, 7]);

    const svelte = [
      "<script>",
      "  // \u{1F512} in a script comment",
      '  const g = "ok";',
      "</script>",
      "<!-- \u{1F512} in a markup comment -->",
      "<span>\u{1F512} Locked</span>",
      "<span>&#128640;</span>",
      "<span>&#9432; &#10005;</span>",
      "<style>/* \u{1F512} */ .x { color: red; }</style>",
    ].join("\n");
    expect(emojiOnLines(stripSvelteComments(svelte)).map((h) => h.line)).toEqual([6, 7]);

    // CSS: comments ignored, a CSS escape in `content` caught (review follow-up 2026-11-16).
    const css = ["/* \u{1F512} note */", '.lock::before { content: "\\1F512"; }', ".ok::before { content: \"\\2605\"; }"].join("\n");
    expect(emojiOnLines(stripCssComments(css)).map((h) => h.line)).toEqual([2]);
  });
});

describe("member gear and unknown slots (the sweep's varietySvgIcon contract)", () => {
  it("an away-team member piece draws no ship glyph; an unknown ship slot falls back to the generic gear", () => {
    expect(varietySvgIcon(null, "memberArmor")).toBeNull();
    expect(varietySvgIcon(null, "implant")).toBeNull();
    expect(varietySvgIcon(null, "someNewSlot")).toBe("equipment");
  });
});

// CSS and plain HTML: strip /* */ and <!-- --> comments, keeping newlines.
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
}

function styleAndPageFiles(): string[] {
  const css: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = `${dir}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".css")) css.push(p);
    }
  };
  walk(SRC);
  return [...css, "index.html"];
}

describe("ship gear glyphs are all SVG (the sweep's EquipmentTooltip maps)", () => {
  const SHIP_SLOTS = ["cargoBay", "ftlDrive", "reactorCore", "specUtility", "shieldEmitters", "hullPlating", "weapon", "droneBay"];

  it("every economy variety draws its own classified glyph, apart from its slot-mates and every relic", () => {
    for (const slot of ["cargoBay", "ftlDrive", "reactorCore"]) {
      const own = EQUIPMENT_SLOTS[slot].varieties.map((v) => varietySvgIcon(v.key, slot));
      for (const ic of own) {
        expect(ic, slot).not.toBeNull();
        expect(ICON_SEMANTICS[ic!], `${slot}:${ic}`).toBe("subject");
        expect(ic!.startsWith("relic"), ic!).toBe(false);
      }
      expect(new Set(own).size, slot).toBe(own.length);
    }
  });

  it("every ship slot has a classified fallback glyph, and every weapon and drone blueprint draws one", () => {
    for (const slot of SHIP_SLOTS) {
      const ic = varietySvgIcon(null, slot);
      expect(ic, slot).not.toBeNull();
      expect(ICON_PATHS[ic!], slot).toBeDefined();
    }
    for (const bp of Object.values(BLUEPRINTS)) {
      if (bp.weaponOutput || bp.droneOutput) expect(blueprintIcon(bp.key), bp.key).not.toBeNull();
    }
  });
});

describe("no emoji in player-facing source (0.14.0 emoji sweep)", () => {
  it("every .svelte and .ts file under src is free of pictographic emoji outside comments", () => {
    const report: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const raw = readFileSync(file, "utf-8");
      const stripped = file.endsWith(".svelte") ? stripSvelteComments(raw) : stripJsComments(raw);
      for (const h of emojiOnLines(stripped)) report.push(`${file}:${h.line} ${h.found} | ${h.text}`);
    }
    expect(report, `emoji found (draw an <Icon> from ui/icons.ts instead):\n${report.join("\n")}`).toEqual([]);
  });

  it("every stylesheet under src and index.html are free of emoji outside comments (CSS escapes included)", () => {
    const report: string[] = [];
    for (const file of styleAndPageFiles()) {
      for (const h of emojiOnLines(stripCssComments(readFileSync(file, "utf-8")))) report.push(`${file}:${h.line} ${h.found} | ${h.text}`);
    }
    expect(report, `emoji found:\n${report.join("\n")}`).toEqual([]);
  });
});
