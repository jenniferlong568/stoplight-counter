import { describe, expect, test } from 'vitest'
import type { FeatureCollection, Point } from 'geojson'
import {
  cambridgeSignals,
  cambridgeType,
  osmBoundaries,
  osmNodeNames,
  osmSignals,
  stitchRings,
  type CambridgeProps,
  type OsmElement,
} from './transform'

describe('cambridgeType', () => {
  test('maps ID ranges to signal types', () => {
    expect(cambridgeType(449)).toBe('signal')
    expect(cambridgeType(521)).toBe('signal')
    expect(cambridgeType(705)).toBe('flashing_beacon')
    expect(cambridgeType(812)).toBe('school_zone')
    expect(cambridgeType(917)).toBe('signal')
  })
})

describe('cambridgeSignals', () => {
  const pole = (ID: number, lon: number, Location?: string) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [lon, 42.37] },
    properties: { ID, ...(Location ? { Location } : {}) },
  })

  test('poles share their intersection id and name; ID 0 poles each get their own', () => {
    const fc: FeatureCollection<Point, CambridgeProps> = {
      type: 'FeatureCollection',
      features: [
        pole(449, -71.1, 'First St. & Binney St.'),
        pole(449, -71.1001),
        pole(0, -71.2),
        pole(0, -71.3),
      ],
    }
    const nameNear = (c: number[]) => (c[0] === -71.2 ? 'Cambridge St' : undefined)

    const out = cambridgeSignals(fc, nameNear).map((s) => s.properties)

    expect(out.map((p) => p.id)).toEqual(['cambridge-449', 'cambridge-449', 'cambridge-0-2', 'cambridge-0-3'])
    expect(out.map((p) => p.location)).toEqual([
      'First St. & Binney St.',
      'First St. & Binney St.',
      'Cambridge St',
      'Unnamed signal',
    ])
    expect(out.every((p) => p.city === 'Cambridge' && p.source === 'cambridge-gis')).toBe(true)
  })
})

describe('stitchRings', () => {
  test('joins ways end to end, reversing where needed', () => {
    const rings = stitchRings([
      [[0, 0], [1, 0]],
      [[1, 1], [1, 0]], // reversed
      [[1, 1], [0, 1], [0, 0]],
    ])
    expect(rings).toEqual([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])
  })

  test('throws when a ring cannot close', () => {
    expect(() => stitchRings([[[0, 0], [1, 0]]])).toThrow(/does not close/)
  })
})

describe('OSM signals', () => {
  const square = (name: string, x0: number) => ({
    type: 'relation' as const,
    id: x0,
    tags: { name },
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lon: x0, lat: 0 },
          { lon: x0 + 1, lat: 0 },
          { lon: x0 + 1, lat: 1 },
          { lon: x0, lat: 1 },
          { lon: x0, lat: 0 },
        ],
      },
    ],
  })
  const elements: OsmElement[] = [
    square('Cambridge', 0),
    square('Somerville', 1),
    { type: 'node', id: 1, lon: 1.5, lat: 0.5, tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 2, lon: 1.6, lat: 0.5, tags: { crossing: 'traffic_signals' } },
    { type: 'node', id: 3, lon: 0.5, lat: 0.5, tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 4, lon: 1.7, lat: 0.5, tags: { highway: 'traffic_signals', traffic_signals: 'blinker' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', name: 'Highland Ave' } },
    { type: 'way', id: 11, nodes: [1], tags: { highway: 'secondary', name: 'Medford St' } },
  ]

  test('names a node from the streets through it', () => {
    const names = osmNodeNames(elements)
    expect(names.get(1)).toBe('Highland Ave & Medford St')
    expect(names.get(2)).toBe('Highland Ave')
    expect(names.has(3)).toBe(false)
  })

  test('keeps only nodes inside the boundary', () => {
    const somerville = osmBoundaries(elements).find((b) => b.properties.name === 'Somerville')!
    const out = osmSignals(elements, somerville).map((s) => s.properties)

    expect(out.map((p) => p.id)).toEqual(['osm-node-1', 'osm-node-2', 'osm-node-4'])
    expect(out[0]).toEqual({
      id: 'osm-node-1',
      city: 'Somerville',
      location: 'Highland Ave & Medford St',
      type: 'signal',
      source: 'osm',
    })
    expect(out[2].type).toBe('flashing_beacon')
    expect(out[2].location).toBe('Unnamed signal')
  })
})
