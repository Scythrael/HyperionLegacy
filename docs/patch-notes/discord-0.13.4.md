<!--
DISCORD POST, 0.13.4. Paste the block below the rule as-is.

⚠️ SOURCE OF TRUTH: src/lib/patchNotes.ts. This is the derived 2,000-character Discord cut.
If they disagree, patchNotes.ts is right and this file is stale.

⚠️ CHARACTER COUNT: 1816 against the 2,000 hard ceiling. RE-COUNT AFTER EVERY EDIT, and treat
roughly 1,800 as the working target rather than 2,000. A post over the ceiling is refused at
paste time, which is the failure this file exists to catch here instead of there.

⚠️ F5 (Standard-Issue filling every hardpoint) IS NOT IN THIS RELEASE. It was peeled at build
time; see design section 16.7. Do not mention it.
-->

---

**Hyperion Legacy 0.13.4: Infrastructure**

Four systems under the hood. Your save carries over untouched.

**🛬 Docking bays**
A returning ship now needs a free docking bay to dock and unload. Fly fewer ships than you have berths, which is every small fleet, and **nothing changes for you at all**. With all berths busy, the next ship home waits at the end of its return leg and takes the first one that frees, and it says so: "Waiting for a docking bay (2nd in line)", with an estimate. You start with two; the Docks console adds them one at a time up to ten. The wait is only ever a wait: a berth is held by a ship that is unloading, unloading always finishes, and nothing is stored about who holds what, so a berth cannot get stuck.

**⚔️ Why your patrols came home**
A finished patrol now leaves a line on Home: which patrol, how many routes it flew, and why it stopped. **Recalled** and **orders complete** used to be indistinguishable, so pressing Recall could tell you your orders had finished. They are two different things now. The route count follows a run across a relaunch, so eleven routes reports eleven.

**⚙️ Batches spread across bays**
Once nothing new is waiting, a bay that frees up **joins an order already running** instead of standing idle. Two bays on one order finish it in about half the time. Materials are counted exactly as before: an order reserves what it needs once, however many bays work it. The line says "2 bays working this order together", because otherwise the countdown just halves and looks broken.

**📋 Per-facility queue depth**
Five new Homeworld Talents, one each for the Refinery, Fabricator, Salvage Bay, Research Lab and Shipyard. Deliberately a late purchase: the shared Standing Orders chain carries you first, and nothing you already bought changed.
