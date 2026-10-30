# node_modules incident log

The user asked for this log (2026-10-30): "let's keep a log of what happens so we can get to the bottom of what
happened if it happens again in the future."

**If node_modules is found empty or broken:**
1. Before reinstalling, record the time you found it, `ls node_modules | wc -l`, and the directory's mtime.
2. Run `node scripts/session-timeline.mjs <fromUTC> <toUTC>` for the window between the last known-good use and the
   discovery. It lists every shell command any Claude session or subagent ran for this project. Add `node_modules|npm`
   as a third argument to narrow it.
3. Add an entry below, then reinstall with `npm ci`, and tell HL Hub.

**Notes for reading the evidence:**
- The directory mtime only shows the last entry change. vitest or vite creating a cache folder (`.vite`, `.vitest`)
  also moves it, so the mtime is not proof of when the folder was emptied.
- Node resolves packages by walking up the folders. A worktree under `.claude/worktrees/` with no node_modules of its
  own falls back to the main checkout's.

## 2026-10-30, main checkout found empty: ROOT CAUSE FOUND (hub, same day)

The cause was a node_modules junction followed by a worktree removal. The standing rule "never junction or copy
node_modules" already forbade the junction.

- **15:12:11 UTC:** the Slice 6 builder (agent-a0aa119dafd828440) ran `New-Item -ItemType Junction` to make its
  worktree's node_modules point at the main checkout's node_modules.
- **17:09:52 UTC:** after the merge and the backup, the slice session ran
  `git worktree remove .claude/worktrees/agent-a0aa119dafd828440`. Git deleted the worktree's contents through the
  junction, which emptied the main checkout's node_modules.
- **17:32:58 UTC:** the Slice 7 builder also junctioned, this time to another worktree's node_modules. It removed
  that junction safely with `cmd /c rmdir` at 17:43 and ran its own `npm ci`. Its "Could not resolve 'node:module'"
  trouble came after that. Whether the two are connected is not proven.
- **Found by:** `node scripts/session-timeline.mjs 2026-10-30T15:11 2026-10-30T18:30 "node_modules|npm|worktree remove"`.

**Safeguards (added to the session protocol in the resume notes):**
1. Every builder brief says: run `npm ci` in your own worktree; never junction, symlink or copy node_modules.
2. Before any `git worktree remove`, check the worktree's node_modules for a reparse point. If it is a link, remove
   only the link first (`cmd /c rmdir <path>`), then remove the worktree.
3. Each slice session removes its own merged builder worktrees before it ends. If one is locked by a live agent
   process, stop the agent first, then `git worktree unlock` and remove it.

## 2026-10-30, the original report (written before the cause was found)

- **Last known good:** the dev preview ran from the main checkout until 15:11 UTC, after the 13:56-14:00 UTC
  worktree cleanup. That clears the cleanup.
- **18:40:27 UTC:** the Slice 7 session merged in the main checkout (14c0e6e).
- **18:40:31 UTC:** it ran `npx vitest run` and `npm run check` there. Both failed to load.
- **18:40:40 UTC:** the node_modules mtime. This is likely vitest's own cache write into an already empty folder, not
  the deletion.
- **18:40:46 UTC:** found empty. Restored with `npm ci` (about 18:41 UTC).
- **No delete or install command** appears in any session's transcript between 18:30 and 18:40:46 UTC. The window
  from 15:11 to 18:30 UTC was not searched yet.
- **Related:** the Slice 7 builder saw the vitest dep cache fail to rebuild in a fresh worktree ("Could not resolve
  'node:module'") and worked around it with a local vitest config. Not shown to be the same cause.
- **Next time:** run step 2 over the full window from the last known good use.
