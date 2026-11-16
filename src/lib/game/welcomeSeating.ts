// ============================================================================
// welcomeSeating.ts : FR-C fix pass (the welcome batch strands no crew on hand)
//
// The welcome batch (crewOverlay.ts welcomeSeat) first seats the crew already on hand (the pool, then the Homeworld
// reserve), and mints new crew only for the seats nobody on hand can take. Seating ship by ship, top rank down (the
// ordinary autoCrewShip fill) is greedy: an early ship takes high-rank crew into seats a lower rank could have held,
// and a later ship's high-rank seats then find only crew below them, so crew were stranded in the pool and the welcome
// minted crew for seats the stranded crew could have filled.
//
// This module seats the most crew possible, rank- and division-aware, as a maximum flow:
//   source -> (division, rank) supply -> each ship's division chain, entering at that rank's threshold node ->
//   threshold t to t - 1 (capacity: the room under the inclusive rank cap at t, commandStructure.ts) -> the division
//   (capacity: the division's room) -> the ship (capacity: its total room) -> sink.
// A crewmember of rank R counts against every threshold T <= R (the inclusive caps), which is exactly the flow passing
// down the chain from node R, so a feasible flow is a seating that breaks no cap, and a maximum flow seats the most.
// The graph is walked in a fixed order (supply top rank down in CREW_PROFESSIONS order, ships in the caller's order),
// so the seating is deterministic. Pure: no rng, no state.
// ============================================================================

import type { CrewBucket, CrewProfession, CrewRank, ShipTypeKey } from "./model";
import { CREW_PROFESSIONS, complementTotalCap, countAtRankOrHigher, countInDivision, divisionCap, inclusiveRankCap } from "./commandStructure";
import { totalCrew } from "./crew";

// One ship the crew on hand may be seated on: its hull, its quarters bonus and its occupancy (bulk plus assigned
// notables, the fill rule).
export interface SeatingShip {
  typeKey: ShipTypeKey;
  bonus: number;
  occupancy: CrewBucket[];
}

const RANKS_DOWN: readonly CrewRank[] = [8, 7, 6, 5, 4, 3, 2, 1];

interface Edge {
  to: number;
  cap: number;
  rev: number; // the index of the reverse edge in graph[to]
}

function addEdge(graph: Edge[][], from: number, to: number, cap: number): number {
  graph[from].push({ to, cap, rev: graph[to].length });
  graph[to].push({ to: from, cap: 0, rev: graph[from].length - 1 });
  return graph[from].length - 1;
}

// Edmonds-Karp: shortest augmenting paths first, each pushed by its bottleneck. Mutates `graph` (local). Pure overall.
function maxFlow(graph: Edge[][], source: number, sink: number): void {
  const n = graph.length;
  for (;;) {
    const prevNode = new Int32Array(n).fill(-1);
    const prevEdge = new Int32Array(n).fill(-1);
    prevNode[source] = source;
    const queue: number[] = [source];
    for (let head = 0; head < queue.length && prevNode[sink] === -1; head++) {
      const u = queue[head];
      const edges = graph[u];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.cap > 0 && prevNode[e.to] === -1) {
          prevNode[e.to] = u;
          prevEdge[e.to] = i;
          queue.push(e.to);
        }
      }
    }
    if (prevNode[sink] === -1) return;
    let push = Infinity;
    for (let v = sink; v !== source; v = prevNode[v]) push = Math.min(push, graph[prevNode[v]][prevEdge[v]].cap);
    for (let v = sink; v !== source; v = prevNode[v]) {
      const e = graph[prevNode[v]][prevEdge[v]];
      e.cap -= push;
      graph[v][e.rev].cap += push;
    }
  }
}

// Seat the most crew from `sources` (bucket lists in priority order: the pool, then the reserve) on `ships`. Returns
// the crew seated on each ship (in ship order) and what is left of each source. Within one division and rank the
// crew are taken from the sources in order, bucket by bucket, so the pool's crew are seated before the reserve's.
// Conserves every crewmember: seated plus left equals the sources. Pure.
export function seatCrewOnHand(ships: readonly SeatingShip[], sources: readonly CrewBucket[][]): { seated: CrewBucket[][]; left: CrewBucket[][] } {
  const supply = new Map<string, number>();
  const key = (p: CrewProfession, r: CrewRank) => `${p}|${r}`;
  for (const list of sources) for (const b of list) supply.set(key(b.profession, b.rank), (supply.get(key(b.profession, b.rank)) ?? 0) + b.count);
  const seated: CrewBucket[][] = ships.map(() => []);
  if (supply.size === 0 || ships.length === 0) return { seated, left: sources.map((l) => l) };

  // Nodes: 0 source, 1 sink, then the supply nodes, then per ship and division a chain of 9 (thresholds 8..1 and the
  // division node 0), then one total node per ship.
  const graph: Edge[][] = [[], []];
  const node = () => graph.push([]) - 1;
  const typeNode = new Map<string, number>();
  for (const r of RANKS_DOWN) for (const p of CREW_PROFESSIONS) if ((supply.get(key(p, r)) ?? 0) > 0) typeNode.set(key(p, r), node());
  for (const [k, id] of typeNode) addEdge(graph, 0, id, supply.get(k)!);
  const entry: { ship: number; p: CrewProfession; r: CrewRank; from: number; edge: number }[] = [];
  ships.forEach((ship, si) => {
    const total = node();
    addEdge(graph, total, 1, Math.max(0, complementTotalCap(ship.typeKey, ship.bonus) - totalCrew(ship.occupancy)));
    for (const p of CREW_PROFESSIONS) {
      const division = node();
      addEdge(graph, division, total, Math.max(0, divisionCap(ship.typeKey, p, ship.bonus) - countInDivision(ship.occupancy, p)));
      // chain[r] is the threshold node a rank-r crewmember enters at; its edge down carries the room at threshold r.
      const chain = new Map<CrewRank, number>();
      let below = division;
      for (const r of [...RANKS_DOWN].reverse()) {
        const at = node();
        addEdge(graph, at, below, Math.max(0, inclusiveRankCap(ship.typeKey, p, r, ship.bonus) - countAtRankOrHigher(ship.occupancy, p, r)));
        chain.set(r, at);
        below = at;
      }
      for (const r of RANKS_DOWN) {
        const from = typeNode.get(key(p, r));
        if (from === undefined) continue;
        entry.push({ ship: si, p, r, from, edge: addEdge(graph, from, chain.get(r)!, Number.MAX_SAFE_INTEGER) });
      }
    }
  });
  maxFlow(graph, 0, 1);

  // The flow on each supply-to-ship edge is how many of that division and rank the ship seats; draw them from the
  // sources in order.
  const left = sources.map((l) => l.map((b) => ({ ...b })));
  for (const e of entry) {
    let want = Number.MAX_SAFE_INTEGER - graph[e.from][e.edge].cap;
    for (const list of left) {
      for (const b of list) {
        if (want <= 0) break;
        if (b.profession !== e.p || b.rank !== e.r || b.count <= 0) continue;
        const take = Math.min(want, b.count);
        b.count -= take;
        want -= take;
        seated[e.ship].push({ ...b, count: take });
      }
    }
  }
  return { seated, left: left.map((l) => l.filter((b) => b.count > 0)) };
}
