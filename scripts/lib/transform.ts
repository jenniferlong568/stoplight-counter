import type { Feature, FeatureCollection, MultiPolygon, Point, Position } from 'geojson'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import type { City, Signal, SignalType } from '../../src/lib/countSignals.ts'

/** Raw Cambridge GIS TRAFFIC_Signals feature. Field names are mixed case in the published file. */
export interface CambridgeProps {
  ID: number
  Location?: string
  Jurisdiction?: string
  Contact?: string
}

export interface OsmNode {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}
export interface OsmWay {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}
export interface OsmRelation {
  type: 'relation'
  id: number
  tags?: Record<string, string>
  members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[]
}
export type OsmElement = OsmNode | OsmWay | OsmRelation

export type Boundary = Feature<MultiPolygon, { name: City }>

/** Cambridge ID ranges: 700–799 flashing beacon, 800–899 school zone, everything else a signal. */
export function cambridgeType(id: number): SignalType {
  if (id >= 700 && id <= 799) return 'flashing_beacon'
  if (id >= 800 && id <= 899) return 'school_zone'
  return 'signal'
}

/**
 * One Signal per Cambridge pole. Poles of the same intersection share an ID,
 * so they share an id here too and countSignals merges them. ID 0 is a
 * catch-all for unassigned poles, so each of those gets its own id.
 */
export function cambridgeSignals(
  fc: FeatureCollection<Point, CambridgeProps>,
  nameNear: (coord: Position) => string | undefined,
): Signal[] {
  const locationById = new Map<number, string>()
  for (const f of fc.features) {
    const loc = f.properties.Location?.trim()
    if (loc && !locationById.has(f.properties.ID)) locationById.set(f.properties.ID, loc)
  }
  return fc.features.map((f, i) => {
    const rawId = f.properties.ID
    const coord = f.geometry.coordinates
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coord[0], coord[1]] },
      properties: {
        id: rawId === 0 ? `cambridge-0-${i}` : `cambridge-${rawId}`,
        city: 'Cambridge',
        location: locationById.get(rawId) ?? nameNear(coord) ?? 'Unnamed signal',
        type: cambridgeType(rawId),
        source: 'cambridge-gis',
      },
    }
  })
}

/** Joins boundary ways into closed rings by matching shared end points. */
export function stitchRings(ways: Position[][]): Position[][] {
  const key = (p: Position) => `${p[0]},${p[1]}`
  const remaining = ways.map((w) => [...w])
  const rings: Position[][] = []
  while (remaining.length > 0) {
    const ring = remaining.shift()!
    while (key(ring[0]) !== key(ring[ring.length - 1])) {
      const end = key(ring[ring.length - 1])
      const i = remaining.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end)
      if (i === -1) throw new Error(`Boundary ring does not close at ${end}`)
      const [next] = remaining.splice(i, 1)
      if (key(next[0]) !== end) next.reverse()
      ring.push(...next.slice(1))
    }
    rings.push(ring)
  }
  return rings
}

export function osmBoundaries(elements: OsmElement[]): Boundary[] {
  return elements
    .filter((e): e is OsmRelation => e.type === 'relation')
    .map((rel) => {
      const ways = rel.members
        .filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry)
        .map((m) => m.geometry!.map((g): Position => [g.lon, g.lat]))
      return {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: stitchRings(ways).map((r) => [r]) },
        properties: { name: rel.tags?.name as City },
      }
    })
}

/** "Highland Ave & Medford St" from the named streets that pass through each node. */
export function osmNodeNames(elements: OsmElement[]): Map<number, string> {
  const names = new Map<number, Set<string>>()
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags?.name) continue
    for (const n of e.nodes) {
      if (!names.has(n)) names.set(n, new Set())
      names.get(n)!.add(e.tags.name)
    }
  }
  return new Map([...names].map(([id, set]) => [id, [...set].sort().join(' & ')]))
}

function osmSignalType(tags: Record<string, string>): SignalType {
  return tags.traffic_signals === 'blinker' ? 'flashing_beacon' : 'signal'
}

/** OSM signal nodes inside the given city boundary. */
export function osmSignals(elements: OsmElement[], boundary: Boundary): Signal[] {
  const names = osmNodeNames(elements)
  return elements
    .filter((e): e is OsmNode => e.type === 'node')
    .filter((n) => booleanPointInPolygon([n.lon, n.lat], boundary))
    .map((n) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
      properties: {
        id: `osm-node-${n.id}`,
        city: boundary.properties.name,
        location: names.get(n.id) ?? 'Unnamed signal',
        type: osmSignalType(n.tags ?? {}),
        source: 'osm',
      },
    }))
}

const M_PER_DEG = 111_195

/** Finds the street name of the nearest named OSM signal node within maxMeters. */
export function makeNameNear(elements: OsmElement[], maxMeters = 30) {
  const names = osmNodeNames(elements)
  const named = elements.filter((e): e is OsmNode => e.type === 'node' && names.has(e.id))
  return ([lon, lat]: Position): string | undefined => {
    const cos = Math.cos((lat * Math.PI) / 180)
    let best: string | undefined
    let bestD = maxMeters
    for (const n of named) {
      const d = Math.hypot((n.lon - lon) * cos * M_PER_DEG, (n.lat - lat) * M_PER_DEG)
      if (d <= bestD) {
        bestD = d
        best = names.get(n.id)
      }
    }
    return best
  }
}
