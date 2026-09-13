# The icon gap list, for your approval

**Read this BEFORE the QA pass.** You asked for the missing icons to be presented at the end so you
could approve them and we add them before you test. This is that list.

⚠️ **Nothing here is built.** Each row is a drawing that does not exist. I have not invented any of
them, because a new icon is new content and that is yours to approve.

---

## What already swept

Eight of the Home board's glyphs now render real stroke-SVG icons from the registry:

| Hint | Registry icon | Was |
|---|---|---|
| refine | `refinery` | ⚙️ |
| fabricate | `fabricator` | 🔧 |
| research | `research` | 🔬 |
| shipBuild | `shipyard` | 🚧 |
| fuel | `fuel` | ⛽ |
| storage | `warehouse` | 📦 |
| docks | `docks` | ⚓ |
| salvage | `salvage` | ♻️ |

⚠️ **A hint is not always the registry's word**, and that is deliberate: the board's hints are VERBS
about work ("refine", "shipBuild") while the registry is named for THINGS ("refinery", "shipyard"),
because an icon depicts the place rather than the activity.

---

## The five that need a drawing

These still show emoji, and each needs an icon before the sweep can finish.

| # | Hint | Emoji today | What it marks | What it should probably depict |
|---|---|---|---|---|
| 1 | `facility` | 🛠️ | A facility upgrade, and a locked/not-built facility chip | A building or structure, generic enough to stand for ANY facility. ⚠️ Must not look like the Fabricator's icon, which is also tool-flavoured. |
| 2 | `repair` | 🔨 | A ship under repair at the Shipyard | Repair as an ACTION on a hull. ⚠️ Has to read apart from `shipyard`, which already means the building. |
| 3 | `extraction` | ⛏️ | A captain out on a gathering mission | Mining or hauling. The closest existing icon is `ore`, but that is the MATERIAL, not the act of going to get it. |
| 4 | `patrol` | ⚔️ | A captain out on a combat patrol | Combat or a patrol route. Nothing in the registry is combat-flavoured at all yet. |
| 5 | `dispatch` | 👤 | An idle captain awaiting orders | A person, or a person-plus-arrow. ⚠️ This one interacts with the captain-portrait question below. |

### ⚠️ And one that is NOT on this list on purpose

**Captain portraits.** You mentioned they need placeholders and will eventually be race-based SVGs.
I have deliberately left them out, because they are a different KIND of problem from the sweep: an
icon is one shared glyph meaning one thing, while a portrait is an IDENTITY that varies per captain
and later per race. Putting portraits into a registry built for UI glyphs would mean unpicking it
when races land. They want their own slot on the captain model, not a name in the icon table.

---

## How to answer

For each of the five, either describe what you want it to look like, or say "skip" and it keeps its
emoji for now. **Skipping is a perfectly good answer** for this release: a half-swept board is honest
about what is finished, and the remaining five are the least-seen glyphs on the screen.

Once you have decided, adding one is a data edit: a name and its path geometry in `ui/icons.ts`, and
the board picks it up automatically.
