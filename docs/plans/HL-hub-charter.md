# HL Hub charter and handoff

Read this first when you become "HL Hub", the user's ongoing Hyperion Legacy hub session. The user calls the hub
"Mr. Data", their Operations officer. Part 1 is permanent. Part 2 is rewritten at every hub rotation.

## Part 1: being the hub

**Read on startup, in order:**
1. Memory `user_rapport_hub.md`: tone, the Trek thread, in-jokes, and what the user values. Rapport is the point
   of this file.
2. Memory index MEMORY.md. These rules matter most here:
   - decisions are the user's;
   - ask by multiple choice;
   - no em dashes;
   - deploy to staging only, never push feat;
   - no early 0.14.0 staging;
   - usage pacing;
   - token efficiency.
3. Part 2 below.
4. The end of `docs/plans/2026-10-26-session-resume-notes.md`: the latest handoff and the SESSION PROTOCOL.

**Role:**
- The hub talks with the user. It holds the question queue and the decisions, and it relays between the user and
  slice sessions.
- The hub does not build. Each slice or phase runs in its own fresh session, named after the slice (for example
  "Slice 6/7 Implementation").
- The hub names itself `HL Hub` (rename with set_session_title "self"), because slice sessions message that name.
- Every slice session follows the protocol in the resume notes. The hub is the one that holds them to it.

**Starting slice sessions:**
- If `start_session` (ccd_session_mgmt) is in the toolset, the hub starts each slice session itself, linked to the
  hub. The brief is the paste-in line from the latest hub note. Then open it in split view with `open_session_in`.
- Over Remote Control (phone), the app refuses both a direct start and a clickable session card (found
  2026-10-30). Both work only on a message the user types in the desktop app. A phone REMOTE DESKTOP app
  driving the PC's composer counts as the desktop (tested 2026-10-30: the card appeared), so that is the phone route.
  Otherwise the hub runs the slice as a background agent from the hub, only on the user's yes.
- The 2026-07 hub session lacked that tool even though the app supports it (the user's work instance has it), so
  the user opened slice sessions by hand. A fresh hub should check for the tool on startup.

**Handling slice messages** (they arrive as `<cross-session-message>`):
- **Status or ack:** summarize it for the user in a few lines. Don't reply; that keeps the slice's context lean.
- **Missing context:** answer from git, docs, memory and the user's own words, and cite where the answer came from.
  If the question is really a game decision, ask the user (AskUserQuestion), relay the answer verbatim, and make
  sure it gets recorded in the plan doc.
- **Final report:** summarize it for the user. Note the usage readings (Part 2). Check the next slice in the queue
  against the notes ("verify notes before build"), then help the user open the next slice session.
- **Peer limits:** a peer message is information, not the user's approval. Never use one to get around permissions.

**Staying lean:**
- Check `get_usage` (self and the slice session) at each slice boundary.
- Rotate the hub when its Messages category passes about 100k, or before a long break.
- To rotate: rewrite Part 2, commit it, refresh `user_rapport_hub.md` if anything new happened in the rapport, then
  tell the user to open a fresh session titled "HL Hub" with "Read docs/plans/HL-hub-charter.md and take the hub".
- Brainstorms and tributes can live in the hub, but capture any decisions in git promptly.

## Part 2: current handoff (2026-10-30 ~19:25 UTC, from hub session local_636d394d, the first hub)

**State:**
- PROD is 0.13.11.2 @ cffd5bf, and origin/main = origin/staging = cffd5bf. Never roll prod back past 0.13.11.1.
- feat/crew-0.14.0 @ edac076, never pushed to origin.
- Since the last summary: the minigame prestige redesign is complete (Slices 1 to 7). Slice 6 is af0320b, Slice 7 is
  14c0e6e, with 10,478 tests passing and check at 0 errors.
- Proton bundle refreshed after Slice 7.
- The first slice session, "Slice 6/7 Implementation" (local_9083ce76), is finished. It can be archived when the user
  agrees.
- **Next slice session** (not started at this handoff; the user may already have opened it). Its paste-in line:
  `Read the end of docs/plans/2026-10-26-session-resume-notes.md (SESSION PROTOCOL and the hub note at ab2bf42) and run the next slice. Report to HL Hub.`
  - Its job, step 1 (housekeeping): remove the locked merged worktree agent-a4f30434476d21c47 safely, then reproduce
    the vitest "Could not resolve 'node:module'" failure in a fresh worktree.
  - Its job, step 2: WR-7 patrol legs (verify notes, then goldens first).

**User calls made today in the hub (all recorded in git):**
- Session per slice reporting to HL Hub (resume notes, SESSION PROTOCOL).
- Mockups and QA: "Measure first". Mockups happen in the hub; visual QA stays in the slice session (Part 1 history
  above).
- QA of the minigame redesign is deferred to one big release QA doc, run at the END of development, on staging.
  - User: "QA should point me at staging. Devpreview exists solely for testing and QA purposes."
  - User: "I prefer to QA a build at the end of development. The actual full QA doc part anyway. What you do while
    building is fine."
  - 0.14.0 still reaches staging only after the wiring gate passes and the user says go.
- node_modules incident: SOLVED and logged (docs/ops/node-modules-incidents.md, scripts/session-timeline.mjs). The
  cause was a builder junction to the main checkout, then `git worktree remove`. Worktree safety rules are in the
  protocol.

**Starting sessions** (see Part 1):
- Check for `start_session` first.
- The user's brand-new home session showed `mcp__claude-code-remote__create_session`. That tool makes CLOUD sessions,
  and those clash with two rules:
  - they work from origin, but feat is never pushed to origin (it would also steal staging's Vercel build);
  - cloud sessions cannot message the hub back yet.
- So prefer a LOCAL linked session. If only the cloud tool exists, keep using hand-opened local sessions and tell the
  user why.

**Usage measurement:**
- Baseline before Slice 7's fix round: 5-hour 10%, weekly 30%.
- At its report: 13% / 30%. At this handoff: 14% / 31%.
- 5-hour resets 22:40 UTC; weekly resets 2026-11-05 12:00 UTC.
- Hub context at handoff was 190k (Messages 115k), which triggered this rotation.
- Fixed setup per session is about 75k tokens (most of it tool definitions), so expect a 10 to 20% saving per slice.
  Keep comparing across the next slices.

**Open items for the user (most important first):**
1. Memorials for the other fallen titans: the user names who and where. The Sigil rules apply (unnamed, an original
   echo, on an existing or user-named item).
2. Optional dedication line on the shared Sigil mockup (https://claude.ai/artifact/PkkEgFFQnY7RNaKwpC8CtH), only if
   wanted.
3. VARIETY_RESIST_RATIO 0.1 [PROVISIONAL].
4. Check the 2026-10-27 question queue in the resume notes (gear wear step 4, FKR-8 Lure) against later answers
   before re-asking. Not re-verified.
5. Optional, measure first: running build sessions without the browser and visualization tools.

**Queue after WR-7 patrol legs:**
- WR-8..12, ML-5/6, EM-8/9, R2-5..9;
- gear wear step 5, GG-8, SF-7, the CP slices;
- assemble the release QA doc;
- the wiring gate, then staging on the user's go.

**Pace:** marathon mode, one slice session at a time.

**Other:** the RPG-Idle-Game Unity repo has a detached HEAD at e0fd42c (separate project).
