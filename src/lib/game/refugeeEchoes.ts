// E5-6b (Refugee Posts, 0.14.0): the echo refugees, rare arrivals who are a quiet, affectionate nod to someone the
// player may recognize.
//
// What the user decided (design docs/plans/2026-11-02-refugee-posts-e5-design.md, "USER (2026-11-03, verbatim): rare
// franchise nods among refugees" and "USER ANSWER (2026-11-13): echo roster sign-off"; the roster
// docs/plans/2026-11-03-refugee-echo-roster-DRAFT.md, "USER ANSWERS (2026-11-03)"):
//   - A "clear echo": an ORIGINAL name, plus a wink in their own one-line flavor. The roster below is the approved
//     sheet ("Approve all", 59 names), word for word; nothing here is invented beyond it. Nothing in this file names
//     what each person echoes.
//   - Rarity "~1 in 50": about 2% of arrivals, rolled on the arrival's own seeded stream (refugeeArrival.ts).
//   - Once per save: each echo arrives at most once; when all have arrived, a rare roll brings a normal refugee.
//   - One shared mark: one subtle original glyph for every echo (icons.ts "refugeeEcho"), no logos.
//   - They work like any refugee: the background on their row (picked to fit them), the normal skill roll for the
//     evacuation's tier, no stronger buff.
//
//   - The pick (the user, 2026-11-13: "Uniform pick (Recommended)"): which echo a rare roll brings is a uniform pick
//     among the echoes who have not arrived yet, in roster order (refugeeEchoPick), so a rare roll is an echo until
//     every one has arrived.

import type { RefugeeBackground } from "./refugees";

export interface RefugeeEcho {
  key: string; // stable save key (stored on the record and in RefugeeState.echoes); never shown
  name: string;
  background: RefugeeBackground;
  flavor: string; // their own line on the card
}

// The chance an arrival is an echo: "~1 in 50" (the user, 2026-11-03).
export const REFUGEE_ECHO_CHANCE = 1 / 50;

// TEST-ONLY off switch (refugeeEchoSwitch.fixture.ts): with `live` false every arrival is a normal refugee, the game
// before E5-6b exactly, so a golden captured before it can be traced. Never written by app code.
export const REFUGEE_ECHO_SWITCH: { live: boolean } = { live: true };

// The approved roster, in its sheet order. Frozen: a pick's index reads this order, so a new echo is only ever
// appended.
export const REFUGEE_ECHOES: readonly RefugeeEcho[] = [
  { key: "lucan-skyward", name: "Lucan Skyward", background: "stargazer", flavor: "Grew up on a desert farm watching two suns set, and still swears the stars feel close." },
  { key: "lia-organis", name: "Lia Organis", background: "dispatcher", flavor: "Wears her hair in two neat coils and gives orders like she was born to the job." },
  { key: "hanlon-solace", name: "Hanlon Solace", background: "fuelHandler", flavor: "Claims his old freighter made a famous long run on almost no fuel. Nobody has checked the math." },
  { key: "chewen-rrakka", name: "Chewen Rrakka", background: "shipwright", flavor: "Tall, shaggy, warm-hearted, and fluent in fixing hulls while growling happily. Gives very gentle hugs." },
  { key: "ody-dagby", name: "Ody Dagby", background: "scholar", flavor: "Small, very old, fond of swamps. Patient with every student, she is." },
  { key: "ben-kenlow", name: "Ben Kenlow", background: "dispatcher", flavor: "A calm former hermit who always routes the control desk from the high ground." },
  { key: "raye-jakkard", name: "Raye Jakkard", background: "salvager", flavor: "Spent years picking through wrecked giants in the sand; knows the worth of every scrap." },
  { key: "landry-calloway", name: "Landry Calloway", background: "refiner", flavor: "Once ran a gas mine floating in the clouds. Still the smoothest talker on the refinery floor." },

  { key: "jonah-oneall", name: "Jonah O'Neall", background: "refiner", flavor: "Spells his surname with two L's and wants you to know it. Would rather be fishing." },
  { key: "samara-cartwright", name: "Samara Cartwright", background: "stargazer", flavor: "An astrophysicist who explains wormholes twice: once properly, once in plain words for the colonel." },
  { key: "danel-jacobsen", name: "Danel Jacobsen", background: "scholar", flavor: "Reads two dozen dead languages, sneezes at old dust, and asks if anyone wants to see the ruins." },
  { key: "tellek-jaffrey", name: "Tellek Jaffrey", background: "shipwright", flavor: "Lifts the heaviest hull plate without a word. When thanked, raises one eyebrow and says, \"Indeed.\"" },
  { key: "hamish-hammonde", name: "Hamish Hammonde", background: "dispatcher", flavor: "Texan calm, a shining bald head, and a firm \"you have a go\" for every crew that asks." },
  { key: "rory-mckee", name: "Rory McKee", background: "machinist", flavor: "Fixes anything in minutes, complains for hours, and is very serious about citrus allergies." },
  { key: "jon-shepley", name: "Jon Shepley", background: "fuelHandler", flavor: "A relaxed pilot with untamable hair who keeps the little shuttles topped up and ready." },
  { key: "vara-malverne", name: "Vara Malverne", background: "salvager", flavor: "Finds treasure in every scrap pile and pockets only some of it, she promises." },

  { key: "jon-sherrod", name: "Jon Sherrod", background: "shipwright", flavor: "Went somewhere nobody comes back from, came back anyway, and builds ships that do the same." },
  { key: "susanna-ivanska", name: "Susanna Ivanska", background: "dispatcher", flavor: "Dry as vacuum and never wrong about the docking schedule. She would like that noted." },
  { key: "dela-nennari", name: "Dela Nennari", background: "stargazer", flavor: "Speaks softly of stars and souls, with an ornate crest pinned in her hair." },
  { key: "garran-kaa", name: "Garran Kaa", background: "scholar", flavor: "Lost an eye and gained a book's worth of wisdom, which he will happily read to you." },
  { key: "lonzo-mollaro", name: "Lonzo Mollaro", background: "salvager", flavor: "Magnificent upswept hair, a love of cards, and a nose for anything shiny in the scrap." },
  { key: "virgil-cottar", name: "Virgil Cottar", background: "refiner", flavor: "Mild, kind and a little nervous; would very much like someone to send him a nice note." },
  { key: "mike-garibald", name: "Mike Garibald", background: "machinist", flavor: "Keeps a vintage motorcycle in pieces and a cartoon duck sticker on his toolbox." },
  { key: "marcus-colevane", name: "Marcus Colevane", background: "fuelHandler", flavor: "A wandering ranger who always has just enough in the tank to bring one more ship home." },

  { key: "randal-thorne", name: "Randal Thorne", background: "stargazer", flavor: "A red-haired shepherd's son from the river country. His dreams under the stars keep getting stranger." },
  { key: "matt-corrin", name: "Matt Corrin", background: "salvager", flavor: "Tips his wide-brimmed hat, wins at dice, and swears his luck is not his fault." },
  { key: "perry-aylward", name: "Perry Aylward", background: "machinist", flavor: "A gentle, broad-shouldered smith with odd golden eyes. Prefers the hammer to the axe." },
  { key: "nyna-alvere", name: "Nyna Alvere", background: "refiner", flavor: "Brews remedies and tugs her braid when annoyed, which is often." },
  { key: "moira-vane", name: "Moira Vane", background: "dispatcher", flavor: "Small, ageless and calm in blue silk. Sends people exactly where they need to go, rarely saying why." },
  { key: "lannon-mandry", name: "Lannon Mandry", background: "fuelHandler", flavor: "Stone-faced and steady as a mountain; no charge goes unguarded on his watch." },
  { key: "loyan-arentson", name: "Loyan Arentson", background: "scholar", flavor: "Very tall, very gentle, ears that twitch, and never far from a book. Hates to be hurried." },

  { key: "clayton-stride", name: "Clayton Stride", background: "dispatcher", flavor: "Spiky blond hair, an oversized sword-shaped wrench, and a little delivery service on the side." },
  { key: "tiffany-lockwood", name: "Tiffany Lockwood", background: "refiner", flavor: "Runs a cozy bar after shifts and can punch a stuck valve open with one fist." },
  { key: "erith-gainsby", name: "Erith Gainsby", background: "stargazer", flavor: "Once sold flowers under a city with no sky. Says she can hear the planet humming." },
  { key: "sid-highmore", name: "Sid Highmore", background: "shipwright", flavor: "Every generation has one: a gruff engineer who builds airships and loves them like family." },
  { key: "zane-tribble", name: "Zane Tribble", background: "salvager", flavor: "A cheerful wandering thief with a swishing tail of a scarf, who returns more than he takes." },
  { key: "vivo-ornet", name: "Vivo Ornet", background: "scholar", flavor: "Small and shy, with a tall pointed hat that hides his glowing eyes. Studies hard to learn what he is." },
  { key: "balthazar-bunn", name: "Balthazar Bunn", background: "fuelHandler", flavor: "Calls himself the leading man and keeps his sky skiff tanked to the brim." },

  { key: "sonny-kakaro", name: "Sonny Kakaro", background: "dispatcher", flavor: "Endlessly hungry and cheerful. Puts two fingers to his forehead and is somehow already there." },
  { key: "vegar-prinz", name: "Vegar Prinz", background: "refiner", flavor: "Insists he is royalty, runs the refinery hotter than anyone, and secretly adores his family." },
  { key: "blume-brieffer", name: "Blume Brieffer", background: "machinist", flavor: "A blue-haired inventor who packs a whole workshop into one little capsule." },
  { key: "gohen-sonny", name: "Gohen Sonny", background: "scholar", flavor: "Would rather be studying, but rises to any occasion. Has his father's smile." },
  { key: "pik-kolo", name: "Pik Kolo", background: "stargazer", flavor: "Tall, green-caped and stern. Meditates under the sky and is secretly the best babysitter around." },
  { key: "kirrin-kuri", name: "Kirrin Kuri", background: "salvager", flavor: "Short, bald, six little dots on his brow, and the most loyal friend you will ever meet." },
  { key: "trent-briefer", name: "Trent Briefer", background: "shipwright", flavor: "Lavender hair, a quiet sword, and a tiny time pod he built from his mother's old notes." },
  { key: "roshan-kame", name: "Roshan Kame", background: "fuelHandler", flavor: "An old island hermit with sunglasses and a turtle-shell pack. The depot runs sleepy, sunny and spotless." },

  { key: "izzy-midorin", name: "Izzy Midorin", background: "scholar", flavor: "Fills notebook after notebook on everyone's talents and mutters happily while he writes." },
  { key: "toshi-yagino", name: "Toshi Yagino", background: "shipwright", flavor: "Huge grin, bigger heart. Arrives laughing and announces that all is well now that he is here." },
  { key: "kats-bakuro", name: "Kats Bakuro", background: "refiner", flavor: "Explosive temper, explosive talent. The burners have never run hotter, and he will tell you so." },
  { key: "sho-todoraki", name: "Sho Todoraki", background: "fuelHandler", flavor: "Hair split red and white. Keeps one tank chilled and one warm, without any fuss." },
  { key: "ochre-uraka", name: "Ochre Uraka", background: "salvager", flavor: "Taps a wreck with her fingertips and it floats right up. Dreams of buying her parents a house." },
  { key: "tenn-iidaka", name: "Tenn Iidaka", background: "dispatcher", flavor: "Chops the air with one hand while correcting the schedule. Has never once been late." },
  { key: "mae-hatsuma", name: "Mae Hatsuma", background: "machinist", flavor: "Calls every gadget she builds her baby, and she has a great many babies." },
  { key: "shotaro-aiza", name: "Shotaro Aiza", background: "stargazer", flavor: "Naps in a sleeping bag between shifts; when his tired eyes open, he misses nothing." },

  { key: "kayla-fry", name: "Kayla Fry", background: "machinist", flavor: "Sweet-natured engine whisperer who talks to her ship and loves strawberries." },
  { key: "hobart-washburn", name: "Hobart Washburn", background: "fuelHandler", flavor: "A gentle pilot who keeps plastic dinosaurs on the console and leaves like a leaf on the wind." },
  { key: "john-creighton", name: "John Creighton", background: "stargazer", flavor: "An astronaut who fell through a wormhole once and now talks to himself about old movies." },
  { key: "arthur-dentry", name: "Arthur Dentry", background: "scholar", flavor: "Still in his bathrobe, never without a towel, and simply wants a proper cup of tea." },
  { key: "sam-gamwell", name: "Sam Gamwell", background: "refiner", flavor: "A gardener at heart. If you cannot carry the load, he will carry you." },
];

const BY_KEY: ReadonlyMap<string, RefugeeEcho> = new Map(REFUGEE_ECHOES.map((e) => [e.key, e]));

// The echo stored under `key`, or undefined for a key this build does not know. Pure.
export function refugeeEchoOf(key: unknown): RefugeeEcho | undefined {
  return typeof key === "string" ? BY_KEY.get(key) : undefined;
}

export function isRefugeeEchoKey(key: unknown): key is string {
  return refugeeEchoOf(key) !== undefined;
}

// Which echo a rare roll brings: a uniform pick (by `draw`, in [0, 1)) among the echoes who have not arrived yet, in
// roster order; null once every echo has arrived (the rare roll then brings a normal refugee). The user's decision
// (2026-11-13, "Uniform pick (Recommended)"). Pure.
export function refugeeEchoPick(arrived: readonly string[], draw: number): RefugeeEcho | null {
  const taken = new Set(arrived);
  const open = REFUGEE_ECHOES.filter((e) => !taken.has(e.key));
  if (open.length === 0) return null;
  const d = Number.isFinite(draw) && draw > 0 ? Math.min(draw, 1 - Number.EPSILON) : 0;
  return open[Math.min(open.length - 1, Math.floor(d * open.length))];
}
