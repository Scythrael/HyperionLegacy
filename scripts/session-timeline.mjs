// Lists every shell command any Claude session (and its subagents) ran for this project in a UTC time window, so an
// incident like an emptied node_modules can be traced to the command that caused it.
// Usage: node scripts/session-timeline.mjs 2026-10-30T18:30 2026-10-30T18:41 [filter-regex]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [from, to, filter] = process.argv.slice(2);
if (!from || !to) {
  console.error("Usage: node scripts/session-timeline.mjs <fromUTC> <toUTC> [filter-regex]");
  process.exit(1);
}
const re = filter ? new RegExp(filter, "i") : null;
const dir = path.join(os.homedir(), ".claude", "projects", "F--Windows-Folders-Documents-fleet-admiral");

function* jsonlFiles(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

const rows = [];
for (const f of jsonlFiles(dir)) {
  if (fs.statSync(f).mtime < new Date(from + "Z")) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o.timestamp || o.timestamp < from || o.timestamp > to + "￿") continue;
    for (const c of o.message?.content ?? []) {
      if (c.type !== "tool_use" || (c.name !== "Bash" && c.name !== "PowerShell")) continue;
      const cmd = String(c.input?.command ?? "");
      if (re && !re.test(cmd)) continue;
      rows.push(`${o.timestamp}  ${path.relative(dir, f).slice(0, 48)}\n    ${cmd.slice(0, 300).replace(/\s+/g, " ")}`);
    }
  }
}
console.log(rows.sort().join("\n") || "No shell commands in that window.");
