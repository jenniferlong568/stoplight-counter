import type { Feature, LineString, Point, Position } from 'geojson'

export type City = 'Cambridge' | 'Somerville'
export type SignalType = 'signal' | 'flashing_beacon' | 'school_zone'
export type SignalSource = 'cambridge-gis' | 'osm'

/** Common signal schema. Coordinates live on the GeoJSON Point (WGS84). */
export interface SignalProperties {
  id: string
  city: City
  location: string
  type: SignalType
  source: SignalSource
}

export type Signal = Feature<Point, SignalProperties>

export interface Intersection {
  location: string
  city: City
  type: SignalType
  source: SignalSource
  /** How many separate times the route goes through this intersection. */
  passes: number
  /** In the main total: false for beacons and school zones unless includeSpecial is set. */
  counted: boolean
  /** Meters from the route start to the first pass. */
  distanceAlongRoute: number
  /** Average position of the merged signal points, [lon, lat]. */
  coordinates: Position
  /** IDs of every signal point merged into this intersection. */
  signalIds: string[]
}

export interface CountTotals {
  /** Main count of intersections (each counted once, regardless of passes). */
  total: number
  byCity: Record<City, number>
  /** Always reported; only part of `total`/`byCity` when includeSpecial is set. */
  flashingBeacons: number
  schoolZones: number
}

export interface CountResult {
  intersections: Intersection[]
  totals: CountTotals
}

export interface CountOptions {
  /** Distance from the route that counts as "on the route". Default 20 m. */
  bufferMeters?: number
  /** Signal points closer than this are one intersection. Default 25 m. */
  mergeMeters?: number
  /**
   * A pass only ends once the route gets this far from the intersection, so a
   * sidewalk route wobbling along the buffer edge is still one pass. Default 50 m.
   */
  passExitMeters?: number
  /** Count flashing beacons and school-zone signals in the main total. Default false. */
  includeSpecial?: boolean
}

const EARTH_RADIUS_M = 6_371_008.8
const EPSILON_M = 1e-6

type XY = [number, number]

/**
 * Equirectangular projection to meters around a reference latitude. At the
 * scale of one city the error is far below the 20 m buffer, and using one flat
 * frame keeps the buffer test and the pass detection exactly consistent.
 */
function makeProjection(ref: Position) {
  const toRad = Math.PI / 180
  const cosLat = Math.cos(ref[1] * toRad)
  return ([lon, lat]: Position): XY => [
    (lon - ref[0]) * toRad * EARTH_RADIUS_M * cosLat,
    (lat - ref[1]) * toRad * EARTH_RADIUS_M,
  ]
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** A stretch of route (in meters along it) that lies within the buffer of a point. */
interface Visit {
  start: number
  end: number
  /** Closest approach within this stretch. */
  closestAlong: number
  closestDist: number
}

interface Segment {
  p0: XY
  /** Unit direction; zero for a zero-length segment. */
  ux: number
  uy: number
  len: number
  /** Meters along the route where this segment starts. */
  offset: number
}

/** A run of consecutive segments and their bounding box, padded by the largest search radius. */
interface Chunk {
  minX: number
  minY: number
  maxX: number
  maxY: number
  segments: Segment[]
}

const SEGMENTS_PER_CHUNK = 32

/**
 * Splits the route into chunks with bounding boxes, so each signal is only
 * measured against the parts of a long route that pass near it.
 */
function prepareRoute(route: XY[], pad: number): Chunk[] {
  const chunks: Chunk[] = []
  let offset = 0
  for (let i = 0; i < route.length - 1; i++) {
    if (i % SEGMENTS_PER_CHUNK === 0) {
      chunks.push({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, segments: [] })
    }
    const chunk = chunks[chunks.length - 1]
    const p0 = route[i]
    const p1 = route[i + 1]
    const len = dist(p0, p1)
    chunk.segments.push({
      p0,
      ux: len === 0 ? 0 : (p1[0] - p0[0]) / len,
      uy: len === 0 ? 0 : (p1[1] - p0[1]) / len,
      len,
      offset,
    })
    chunk.minX = Math.min(chunk.minX, p0[0] - pad, p1[0] - pad)
    chunk.minY = Math.min(chunk.minY, p0[1] - pad, p1[1] - pad)
    chunk.maxX = Math.max(chunk.maxX, p0[0] + pad, p1[0] + pad)
    chunk.maxY = Math.max(chunk.maxY, p0[1] + pad, p1[1] + pad)
    offset += len
  }
  return chunks
}

/**
 * Every stretch of the route within `radius` of point `c`, one per segment.
 * `radius` must not exceed the padding the chunks were built with.
 */
function visitsNear(c: XY, chunks: Chunk[], radius: number): Visit[] {
  const visits: Visit[] = []
  for (const chunk of chunks) {
    if (c[0] < chunk.minX || c[0] > chunk.maxX || c[1] < chunk.minY || c[1] > chunk.maxY) continue
    for (const { p0, ux, uy, len, offset } of chunk.segments) {
      const t = (c[0] - p0[0]) * ux + (c[1] - p0[1]) * uy
      const perp2 = Math.max(0, (c[0] - p0[0]) ** 2 + (c[1] - p0[1]) ** 2 - t * t)
      if (perp2 > radius * radius) continue
      const half = Math.sqrt(radius * radius - perp2)
      const start = Math.max(0, t - half)
      const end = Math.min(len, t + half)
      if (start > end) continue
      const tc = Math.min(len, Math.max(0, t))
      visits.push({
        start: offset + start,
        end: offset + end,
        closestAlong: offset + tc,
        closestDist: dist(c, [p0[0] + ux * tc, p0[1] + uy * tc]),
      })
    }
  }
  return visits
}

/** Join overlapping or touching stretches; each result is one pass. */
function mergeVisits(visits: Visit[]): Visit[] {
  const sorted = [...visits].sort((a, b) => a.start - b.start)
  const passes: Visit[] = []
  for (const v of sorted) {
    const last = passes[passes.length - 1]
    if (last && v.start <= last.end + EPSILON_M) {
      last.end = Math.max(last.end, v.end)
      if (v.closestDist < last.closestDist) {
        last.closestDist = v.closestDist
        last.closestAlong = v.closestAlong
      }
    } else {
      passes.push({ ...v })
    }
  }
  return passes
}

/**
 * Groups indices whose points are within `maxDist` of each other (single
 * linkage) or share an id. Cambridge records every pole at an intersection
 * under one ID, and a wide intersection's poles can be farther apart than
 * `maxDist`.
 */
function clusterPoints(points: XY[], ids: string[], maxDist: number): number[][] {
  const parent = points.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (ids[i] === ids[j] || dist(points[i], points[j]) <= maxDist) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, number[]>()
  points.forEach((_, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), i])
  })
  return [...groups.values()]
}

const TYPE_RANK: Record<SignalType, number> = { signal: 0, school_zone: 1, flashing_beacon: 2 }

/**
 * Which signal speaks for a merged intersection: the official city record
 * beats OSM (so a border signal keeps Cambridge's attributes), then a regular
 * signal beats a beacon or school zone, then lowest id for stability.
 */
function pickRepresentative(signals: Signal[]): Signal {
  return [...signals].sort((a, b) => {
    const pa = a.properties
    const pb = b.properties
    const bySource = Number(pa.source === 'osm') - Number(pb.source === 'osm')
    if (bySource !== 0) return bySource
    const byType = TYPE_RANK[pa.type] - TYPE_RANK[pb.type]
    if (byType !== 0) return byType
    return pa.id.localeCompare(pb.id, undefined, { numeric: true })
  })[0]
}

function isSpecial(type: SignalType): boolean {
  return type === 'flashing_beacon' || type === 'school_zone'
}

export function countSignals(
  route: LineString | Feature<LineString>,
  signals: Signal[],
  options: CountOptions = {},
): CountResult {
  const { bufferMeters = 20, mergeMeters = 25, passExitMeters = 50, includeSpecial = false } = options
  const exitMeters = Math.max(bufferMeters, passExitMeters)
  const coords = route.type === 'Feature' ? route.geometry.coordinates : route.coordinates

  const totals: CountTotals = {
    total: 0,
    byCity: { Cambridge: 0, Somerville: 0 },
    flashingBeacons: 0,
    schoolZones: 0,
  }
  if (coords.length < 2 || signals.length === 0) return { intersections: [], totals }

  const project = makeProjection(coords[0])
  const chunks = prepareRoute(coords.map(project), exitMeters)

  // Signals inside the buffer: any part of the route within bufferMeters.
  const nearby = signals.flatMap((signal) => {
    const xy = project(signal.geometry.coordinates)
    const visits = visitsNear(xy, chunks, bufferMeters)
    if (visits.length === 0) return []
    return [{ signal, xy, visits, exitVisits: visitsNear(xy, chunks, exitMeters) }]
  })

  const intersections: Intersection[] = clusterPoints(
    nearby.map((s) => s.xy),
    nearby.map((s) => s.signal.properties.id),
    mergeMeters,
  ).map((group) => {
    const members = group.map((i) => nearby[i])
    // Each stretch within exitMeters that dips inside the buffer is one pass.
    const visits = members.flatMap((m) => m.visits)
    const passes = mergeVisits(members.flatMap((m) => m.exitVisits)).flatMap((outer) => {
      const inside = visits.filter((v) => v.start >= outer.start - EPSILON_M && v.end <= outer.end + EPSILON_M)
      if (inside.length === 0) return []
      return [inside.reduce((best, v) => (v.closestDist < best.closestDist ? v : best))]
    })
    const rep = pickRepresentative(members.map((m) => m.signal)).properties
    const lons = members.map((m) => m.signal.geometry.coordinates[0])
    const lats = members.map((m) => m.signal.geometry.coordinates[1])
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    return {
      location: rep.location,
      city: rep.city,
      type: rep.type,
      source: rep.source,
      passes: passes.length,
      counted: !isSpecial(rep.type) || includeSpecial,
      distanceAlongRoute: passes[0].closestAlong,
      coordinates: [mean(lons), mean(lats)],
      signalIds: [...new Set(members.map((m) => m.signal.properties.id))],
    }
  })

  intersections.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute)

  for (const x of intersections) {
    if (x.type === 'flashing_beacon') totals.flashingBeacons++
    if (x.type === 'school_zone') totals.schoolZones++
    if (x.counted) {
      totals.total++
      totals.byCity[x.city]++
    }
  }

  return { intersections, totals }
}
