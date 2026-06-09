import type { DeckGraph, PlaceConnection } from '@/domain/entities'

// Pure deck-topology graph ops over the bounded-world room-connectivity edges
// (`place_connections`, v26). The graph is a plain adjacency over place ids:
// `adjacency[placeId]` lists the rooms reachable in one hop. A bidirectional
// connection contributes an entry on both sides; a one-way connection only on
// the source side. Reachability checks (`isConnected`, `orphanRooms`) treat the
// topology as UNDIRECTED — a room wired by a one-way ladder is still part of
// the ship — because we are validating "can the layout be traversed/mapped",
// not directed travel cost.

function addEdge(adjacency: Record<number, number[]>, from: number, to: number): void {
  const list = adjacency[from] ?? (adjacency[from] = [])
  if (!list.includes(to)) list.push(to)
}

export function buildDeckGraph(connections: PlaceConnection[]): DeckGraph {
  const adjacency: Record<number, number[]> = {}
  for (const c of connections) {
    addEdge(adjacency, c.from_place_id, c.to_place_id)
    if (c.bidirectional === 1) addEdge(adjacency, c.to_place_id, c.from_place_id)
  }
  return { adjacency }
}

export function neighbors(graph: DeckGraph, placeId: number): number[] {
  return graph.adjacency[placeId] ?? []
}

// Undirected adjacency: every place that shares an edge with `placeId` in
// either direction. Used by the reachability flood so one-way edges don't
// fragment the topology.
function undirectedNeighbors(graph: DeckGraph, placeId: number): number[] {
  const out = new Set<number>(graph.adjacency[placeId] ?? [])
  for (const [from, tos] of Object.entries(graph.adjacency)) {
    if (tos.includes(placeId)) out.add(Number(from))
  }
  return [...out]
}

function reachableFrom(graph: DeckGraph, start: number, within: Set<number>): Set<number> {
  const seen = new Set<number>([start])
  const stack = [start]
  while (stack.length > 0) {
    const current = stack.pop() as number
    for (const next of undirectedNeighbors(graph, current)) {
      if (within.has(next) && !seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return seen
}

// True when the manifest forms a single connected component (every place
// reachable from any other). Empty/singleton manifests are trivially connected.
export function isConnected(graph: DeckGraph, placeIds: number[]): boolean {
  if (placeIds.length <= 1) return true
  const within = new Set(placeIds)
  const reached = reachableFrom(graph, placeIds[0], within)
  return reached.size === within.size
}

// Places that cannot be reached from the main component (the first listed
// place's flood), including any with no edges at all. Returns them in the order
// they appear in `placeIds`.
export function orphanRooms(graph: DeckGraph, placeIds: number[]): number[] {
  if (placeIds.length === 0) return []
  const within = new Set(placeIds)
  const reached = reachableFrom(graph, placeIds[0], within)
  return placeIds.filter((id) => !reached.has(id))
}
