import { describe, expect, test } from 'vitest'
import type { LineString } from 'geojson'
import { countSignals, type Signal, type SignalProperties } from './countSignals'

// Test geometry is built in meters east/north of a point near Central Square.
const ORIGIN = { lon: -71.1035, lat: 42.3655 }
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)

function at(east: number, north: number): [number, number] {
  return [ORIGIN.lon + east / M_PER_DEG_LON, ORIGIN.lat + north / M_PER_DEG_LAT]
}

function line(...points: [number, number][]): LineString {
  return { type: 'LineString', coordinates: points.map(([e, n]) => at(e, n)) }
}

function signal(
  east: number,
  north: number,
  props: Partial<SignalProperties> & { id: string },
): Signal {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at(east, north) },
    properties: {
      city: 'Cambridge',
      location: `Signal ${props.id}`,
      type: 'signal',
      source: 'cambridge-gis',
      ...props,
    },
  }
}

describe('countSignals', () => {
  test('straight route past 3 signals counts 3, in route order', () => {
    const route = line([0, 0], [1000, 0])
    const signals = [
      signal(700, 5, { id: '3' }),
      signal(100, -8, { id: '1' }),
      signal(400, 12, { id: '2' }),
      signal(500, 150, { id: 'far' }), // a block away: not on the route
    ]

    const { intersections, totals } = countSignals(route, signals)

    expect(intersections.map((x) => x.signalIds)).toEqual([['1'], ['2'], ['3']])
    expect(intersections.map((x) => Math.round(x.distanceAlongRoute))).toEqual([100, 400, 700])
    expect(intersections.every((x) => x.passes === 1)).toBe(true)
    expect(totals).toEqual({
      total: 3,
      byCity: { Cambridge: 3, Somerville: 0 },
      flashingBeacons: 0,
      schoolZones: 0,
    })
  })

  test('out-and-back counts each intersection once with passes: 2', () => {
    const route = line([0, 0], [1000, 0], [0, 0])
    const signals = [signal(300, 6, { id: 'a' }), signal(800, -4, { id: 'b' })]

    const { intersections, totals } = countSignals(route, signals)

    expect(intersections).toHaveLength(2)
    expect(intersections.map((x) => x.passes)).toEqual([2, 2])
    expect(intersections.map((x) => Math.round(x.distanceAlongRoute))).toEqual([300, 800])
    expect(totals.total).toBe(2)
  })

  test('no signals on the route gives zero', () => {
    const route = line([0, 0], [1000, 0])

    expect(countSignals(route, []).totals.total).toBe(0)

    const offRoute = [signal(200, 60, { id: 'x' }), signal(900, -45, { id: 'y' })]
    const result = countSignals(route, offRoute)
    expect(result.intersections).toEqual([])
    expect(result.totals.total).toBe(0)
  })

  test('3 OSM nodes at one intersection count as 1', () => {
    const route = line([0, 0], [1000, 0])
    const osm = { city: 'Somerville', source: 'osm', location: 'Highland Ave & Medford St' } as const
    const signals = [
      signal(495, 8, { ...osm, id: 'node/1' }),
      signal(510, -6, { ...osm, id: 'node/2' }),
      signal(502, 14, { ...osm, id: 'node/3' }),
    ]

    const { intersections, totals } = countSignals(route, signals)

    expect(intersections).toHaveLength(1)
    expect(intersections[0].signalIds.sort()).toEqual(['node/1', 'node/2', 'node/3'])
    expect(intersections[0].passes).toBe(1)
    expect(totals.byCity).toEqual({ Cambridge: 0, Somerville: 1 })
  })

  test('a border signal in both datasets is not double-counted', () => {
    const route = line([0, 0], [1000, 0])
    const signals = [
      signal(600, 3, { id: '412', location: 'Beacon St & Park St' }),
      signal(604, -2, { id: 'node/99', city: 'Somerville', source: 'osm', location: '' }),
    ]

    const { intersections, totals } = countSignals(route, signals)

    expect(intersections).toHaveLength(1)
    expect(intersections[0]).toMatchObject({
      city: 'Cambridge',
      source: 'cambridge-gis',
      location: 'Beacon St & Park St',
    })
    expect(totals.total).toBe(1)
    expect(totals.byCity).toEqual({ Cambridge: 1, Somerville: 0 })
  })

  test('flashing beacons and school zones are counted separately unless the flag is set', () => {
    const route = line([0, 0], [1000, 0])
    const signals = [
      signal(100, 0, { id: '10' }),
      signal(400, 0, { id: '705', type: 'flashing_beacon' }),
      signal(700, 0, { id: '810', type: 'school_zone' }),
    ]

    const off = countSignals(route, signals).totals
    expect(off).toEqual({
      total: 1,
      byCity: { Cambridge: 1, Somerville: 0 },
      flashingBeacons: 1,
      schoolZones: 1,
    })

    expect(countSignals(route, signals).intersections.map((x) => x.counted)).toEqual([true, false, false])

    const on = countSignals(route, signals, { includeSpecial: true }).totals
    expect(on.total).toBe(3)
    expect(on.byCity.Cambridge).toBe(3)
    expect(on.flashingBeacons).toBe(1)
    expect(on.schoolZones).toBe(1)
  })

  test('poles sharing an id are one intersection even when far apart', () => {
    const route = line([0, 0], [1000, 0])
    const signals = [
      signal(480, 10, { id: 'cambridge-917' }),
      signal(530, -10, { id: 'cambridge-917' }),
    ]

    const { intersections } = countSignals(route, signals)

    expect(intersections).toHaveLength(1)
    expect(intersections[0].signalIds).toEqual(['cambridge-917'])
  })

  test('a route wobbling along the buffer edge is one pass', () => {
    // Sidewalk routing bows out to 22 m from the signal for a moment.
    const route = line([0, 0], [490, 0], [495, -3], [500, 0], [1000, 0])
    const signals = [signal(495, 19, { id: '1' })]

    const { intersections } = countSignals(route, signals)

    expect(intersections).toHaveLength(1)
    expect(intersections[0].passes).toBe(1)
  })

  test('turning around just past a signal is one pass; well past it is two', () => {
    const signals = [signal(300, 5, { id: '1' })]

    const justPast = countSignals(line([0, 0], [330, 0], [0, 0]), signals)
    expect(justPast.intersections[0].passes).toBe(1)

    const wellPast = countSignals(line([0, 0], [400, 0], [0, 0]), signals)
    expect(wellPast.intersections[0].passes).toBe(2)
  })

  test('long routes find signals at every point, including chunk edges', () => {
    // 5 km straight route with a vertex every 5 m: 1000 segments, many chunks.
    const points = Array.from({ length: 1001 }, (_, i): [number, number] => [i * 5, 0])
    const route = line(...points)
    // 160 m and 320 m are where one 32-segment chunk ends and the next begins.
    const at = [0, 160, 320, 2500, 4999]
    const signals = at.map((x, i) => signal(x, 10, { id: String(i) }))

    const { intersections } = countSignals(route, signals)

    expect(intersections.map((x) => Math.round(x.distanceAlongRoute))).toEqual(at)
    expect(intersections.every((x) => x.passes === 1)).toBe(true)
  })

  test('a long route against thousands of signals stays fast', () => {
    // ~50 km zigzag across a 5 km square, a vertex every ~10 m, 2000 signals in a grid.
    const points: [number, number][] = []
    for (let row = 0; row < 10; row++) {
      const xs = Array.from({ length: 500 }, (_, i) => i * 10)
      for (const x of row % 2 ? xs.reverse() : xs) points.push([x, row * 500])
    }
    const signals: Signal[] = []
    for (let i = 0; i < 2000; i++) signals.push(signal((i % 50) * 100, Math.floor(i / 50) * 125, { id: String(i) }))

    const t = performance.now()
    const { totals } = countSignals(line(...points), signals)
    const ms = performance.now() - t

    expect(totals.total).toBeGreaterThan(0)
    expect(ms).toBeLessThan(150)
  })

  test('buffer width is configurable', () => {
    const route = line([0, 0], [1000, 0])
    const signals = [signal(500, 30, { id: '1' })]

    expect(countSignals(route, signals).totals.total).toBe(0)
    expect(countSignals(route, signals, { bufferMeters: 40 }).totals.total).toBe(1)
  })

  test('a signal at a corner the route turns is one pass, not two', () => {
    const route = line([0, 0], [500, 0], [500, 500])
    const signals = [signal(505, 5, { id: '1' })]

    const { intersections } = countSignals(route, signals)

    expect(intersections).toHaveLength(1)
    expect(intersections[0].passes).toBe(1)
  })
})
