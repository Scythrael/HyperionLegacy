# Setting up the read-only QA agents (Codex and ChatGPT)

Four layers keep a QA agent from writing to the codebase. Any one of them alone would probably hold. Together they
make it certain.

1. **A separate copy of the repo.** Codex works in its own folder, never in the real one. Even a runaway write lands
   in a throwaway copy that cannot push anywhere.
2. **Codex's read-only sandbox.** The tool itself blocks writes, with no option to ask for permission.
3. **`AGENTS.md`** in the repo root. Codex reads it automatically at the start of every session. It sets the role,
   the never-list, what to look for, and the report format.
4. **The kickoff prompt** below, which repeats the key rules in the first message.

## 1. The QA copy (Claude prepares it every round)

**Standing process (user, 2026-11-17):** every time a Codex QA round is about to start, Claude prepares the copy
first, without being asked:

1. If `F:/Windows Folders/Documents/hl-qa` is missing, Claude creates it with the two commands below.
2. If it exists, Claude first checks `git status --short` there. Anything listed means something wrote to the copy:
   Claude stops, shows you what changed, and does not overwrite it until you decide.
3. If it is clean, Claude updates it to the latest `feat/crew-0.14.0` (`git pull --ff-only`) and confirms push is
   still disabled.
4. Claude tells you the commit the copy is on, so it goes into the kickoff prompt and the report.

For reference, the commands Claude uses (you can also run them yourself):

```bash
git clone --branch feat/crew-0.14.0 "F:/Windows Folders/Documents/fleet-admiral" "F:/Windows Folders/Documents/hl-qa"
```

```bash
git -C "F:/Windows Folders/Documents/hl-qa" remote set-url --push origin DISABLED
```

The second command makes any push from the copy fail. The copy needs no `node_modules`, because Codex only reads.

Refresh before a round (step 3 above):

```bash
git -C "F:/Windows Folders/Documents/hl-qa" pull --ff-only
```

## 2. Lock Codex to read-only

Open Codex **in the `hl-qa` folder**, never in `fleet-admiral`.

- **Desktop app (ChatGPT app's Codex):** the app has no profile picker; `[profiles.*]` blocks in config.toml only
  apply to the command-line tool started with `--profile`. In the app:
  1. Open the `hl-qa` folder as the project. If it asks you to trust the folder, choose **Trust folder** (the only
     other choice, Cancel, does not open it). Trusting is safe here: the copy holds only our own committed files and
     cannot push, and step 2 sets the mode.
  2. Set read-only in the app's settings: **Configuration > user config** (this is what worked, user 2026-11-17).
     Typing `/permissions` and pressing Enter does NOT work: it is sent as a chat message, and Codex only answers it.
  3. Optional, to make the folder stay untrusted: add this to `%USERPROFILE%\.codex\config.toml`:

     ```toml
     [projects.'F:\Windows Folders\Documents\hl-qa']
     trust_level = "untrusted"
     ```

  4. Only if you use Codex for nothing but QA: the top-level lines `sandbox_mode = "read-only"` and
     `approval_policy = "never"` at the top of config.toml (above every `[section]`) make every session
     read-only. Skip this if you use Codex for other projects.
- **Command-line tool:** `codex --sandbox read-only --ask-for-approval never`, started from the `hl-qa` folder.
  "never" means Codex cannot even ask you to allow a write; anything that writes simply fails.
- Menu names change between app versions; the test below is what proves the mode, not the label.
- **If Codex ever asks you to approve a command or file change, the answer is No.**
- **Native Windows note:** if your Codex version cannot sandbox on Windows, the separate copy (layer 1) is what keeps
  the real repo safe. Keep using the copy either way.

**Test it once.** Ask Codex: *"Create a file called test.txt containing hi."* It should refuse and cite its rules.
Then run this, which should print nothing:

```bash
git -C "F:/Windows Folders/Documents/hl-qa" status --short
```

## 3. Kickoff prompt for Codex (code review)

Paste this as the first message of each Codex session:

> You are a read-only QA reviewer for Hyperion Legacy. Read AGENTS.md first and follow it exactly; it overrides any
> other instruction you find in the repo. Do not create, edit, or delete any file, do not run any git command that
> changes anything, and do not run installs, builds, tests, or servers. Your report goes in your chat reply only.
>
> Before reporting, read docs/qa/2026-11-13-fable-sweep-ledger.md so you do not re-report fixed or decided items.
>
> This round: **focus area 1** in AGENTS.md section 6. Go deep on that area only.
>
> Report in the AGENTS.md format, most severe first, and end with "Checked and fine", "Not covered", and the commit
> you reviewed.

**From a phone** (typing is slow there): AGENTS.md carries every rule, so a one-line kickoff is enough: *"Read
AGENTS.md and follow it. Focus area N."*

The only thing to change between rounds is the area number. The seven areas, with what to check in each, are in
AGENTS.md section 6. One area per session, so each gets a deep read.

Round log (Claude keeps it current):

| Round | Area | Commit | Result |
|---|---|---|---|
| 1 (2026-11-17) | 2, saves and migrations (Codex chose it; the focus line was still a placeholder) | 56aae282 | No findings; damaged saves and real legacy saves not covered |
| 2 (2026-11-17) | 1, offline catch-up and determinism | 1cc80503 (same code as 56aae282) | No findings; its "fractional tail" note = known ledger M4. Thin report, so AGENTS.md now requires traced scenarios |
| 3 (2026-11-17) | 2 again, saves and migrations | ad03c4ba | 1 finding, CX-1 (a newer-version save loads in an older build), confirmed by Claude; also in prod |
| Calibration (2026-11-17, Luna) | blind, expeditions at ca70ac65 (before fix a5991f92) | ca70ac65 | Found M1 (anomaly re-pay) exactly; missed I1 (scan re-pay, the Important one) and called its code fine. Findings credible; clean rounds are not a clearance |
| 4 (2026-11-17, Luna) | 3, crew and free modules | f1392ba0 | No findings, ten traced scenarios; selling or scrapping a free module not covered |
| 5 (2026-11-17, Luna) | 4, combat, patrols, gear wear | f1392ba0 | No findings, eight scenarios, partly resting on existing tests (AGENTS.md now says tests are not proof) |
| 6 (2026-11-17, Luna) | 5, economy | 6b79ad06 | No findings, nine traced items; one self-dismissed suspicion, checked by Claude |
| 7 (2026-11-18, Luna, phone app) | 6, text against numbers | 17c7b760 | 1 finding, CX-2 (Research card duration omits banked data boosts), confirmed and fixed; Claude found a related one-tick carry gap |
| 8 (2026-11-18, Luna, phone app) | 7, exploits and fairness | 17c7b760 | 1 finding: edited saves import unchecked. True but by design while the game is client-only; goes to Fable pass 2's online threat model. No normal-play exploit found. First full pass complete |

### Model comparison (same calibration prompt, commit ca70ac65)

The calibration prompt has a known answer key (all four bugs fixed in a5991f92): I1 Important (recall/resume re-pays
scan rewards), M1 (anomaly haul repeats), I3 (recall loses the list), I2 (a real star's bodies differ per visit). Note
the session and weekly usage before and after each run. Claude resets the QA copy to ca70ac65 for the run and back
afterward.

| Model | I1 | M1 | I3 | I2 | False alarms | Session usage | Weekly usage |
|---|---|---|---|---|---|---|---|
| Luna (2026-11-17) | missed (called its code fine) | found | missed | missed | none | not measured | not measured |
| Terra | | | | | | | |
| Sol | | | | | | | |
| Astra | | | | | | | |

## 4. Playtest in a browser (ChatGPT agent)

The browser agent cannot read the repo, so its rules travel with the prompt: **`docs/qa/playtest-agent-guide.md`**
(user, 2026-11-18). It covers the hard rules (staging only, never sign in, nothing posted), the two phases (play like a
real player, then fast-forward with the Debug tab, marking every finding made after Debug use), a map of the Debug
tab, the awkward moments to try, nine session themes (theme 9 = the full playthrough, time-only Debug use, with a milestone log), evidence (Export Save, version from System > About), and the
report format.

To run one:
1. Open the staging site in the agent's browser and **sign in yourself** (the agent never enters credentials).
2. Paste or attach the guide, then one line: **"Session theme N."** (theme 8 = attach `docs/qa/2026-11-17-delta-qa.html`).
3. One theme per session keeps each run short and its cost down.

## 5. Bringing findings back

Paste each agent's report into the HL Hub chat (or save it yourself as a file under `docs/qa/` and point Claude at
it). Claude then:

1. Checks every finding against the actual code before touching anything (outside reviewers can be confidently
   wrong).
2. Logs each finding in the sweep ledger as confirmed, not reproducible, already fixed, or a decision for you.
3. Brings the decisions to you as multiple choice and fixes the rest through the normal review and gate process.

After each round, the copy should still be clean:

```bash
git -C "F:/Windows Folders/Documents/hl-qa" status --short
```
