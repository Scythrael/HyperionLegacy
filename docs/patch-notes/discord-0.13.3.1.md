<!--
DISCORD POST, 0.13.3.1. Paste the block below the rule as-is.

WHY THIS FILE EXISTS (SUGGESTIONS.md, "STANDARDIZE THE PATCH-NOTE FORMAT"): every release
so far has had its Discord version hand-cut at the end and thrown away, which is how 0.13.3's
notes drifted from the in-game entry. Keeping it in the repo NEXT TO the release it summarises
means the two get edited together. This is the first one; the convention starts here.

⚠️ THREE AUDIENCES, THREE LENGTHS, ONE SOURCE OF TRUTH. src/lib/patchNotes.ts is the long
form and is authoritative. This is the 2,000-character Discord cut. If they disagree,
patchNotes.ts is right and this file is stale.

⚠️ CHARACTER COUNT: 1,815 against Discord's 2,000 hard ceiling. RE-COUNT AFTER EVERY EDIT.
A first draft came in at 1,948, which passes but leaves only 52 characters of margin; that
was trimmed deliberately, because a post that exceeds the ceiling is refused at paste time
and the whole point of this file is that the drafting failure happens HERE and not there.
Treat roughly 1,800 as the working target, not 2,000.
-->

---

**Hyperion Legacy 0.13.3.1: Auto-Salvage, with brakes**

Last patch gave the rules teeth. This one gives you the controls.

**🔧 The Auto-Salvage Terminal**
The automation now has a bay of its own and a queue of its own, so it never competes with you for salvage capacity. This is the fix for the stall: a long crafting run used to fill your bays, spares would pile up to the cap, and fabrication would halt with no way out but cancelling your own queued work. Now the two run side by side. The Terminal borrows idle bays to chew through a backlog, but anything you queue yourself takes priority and claims them straight back.

**🏪 The Quartermaster** (new facility)
A supply counter that issues Standard-Issue patterns free, for every slot that has one. An empty slot is now an errand rather than a dead end. You get the floor and nothing more, one spare per pattern at a time, and installing it opens the row for another. Buying and selling are marked Coming Soon.

**⭐ Tell the rules what to keep**
• **Favorites**: star any spare and auto-salvage will never take it, however wide your rules are set. You can still salvage it yourself.
• **By rarity**: one checkbox per rarity band, alongside the existing quality and duplicate rules.
• **A grace window**: anything just crafted or just uninstalled is left alone for a while. Yours to set from 5 minutes to 7 days, or switched off entirely.

**Standard-Issue gear can finally be cleared out**: it was the one clutter the declutter tool refused to touch. Your rules now reach it, it is still left alone by default, and every protection covers it. Worth knowing before you widen things: it recovers nothing when broken down, and a ship needs its required slots filled to fly. That is what the Quartermaster is for.

Your save carries over untouched.
