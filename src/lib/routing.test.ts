import { describe, expect, test } from 'vitest'
import { parseOsrm, waypointsFor, type LonLat } from './routing'
import { formatDistance, pinLabels } from './format'

const a: LonLat = [-71.1, 42.37]
const b: LonLat = [-71.09, 42.38]
const c: LonLat = [-71.08, 42.37]

describe('waypointsFor', () => {
  test('passes dots through when not looping', () => {
    expect(waypointsFor([a, b, c], false)).toEqual([a, b, c])
  })

  test('loop returns to the first dot', () => {
    expect(waypointsFor([a, b, c], true)).toEqual([a, b, c, a])
  })

  test('loop with two dots is an out-and-back', () => {
    expect(waypointsFor([a, b], true)).toEqual([a, b, a])
  })

  test('fewer than two dots never loops', () => {
    expect(waypointsFor([a], true)).toEqual([a])
    expect(waypointsFor([], true)).toEqual([])
  })
})

describe('parseOsrm', () => {
  test('returns the geometry and its length', () => {
    // 0.01° of latitude is about 1.11 km.
    const result = parseOsrm({
      code: 'Ok',
      routes: [{ geometry: { type: 'LineString', coordinates: [[-71.1, 42.37], [-71.1, 42.38]] } }],
    })
    expect(result.line.coordinates).toHaveLength(2)
    expect(Math.round(result.distanceMeters)).toBe(1112)
  })

  test('NoRoute is a "no-route" failure', () => {
    expect(() => parseOsrm({ code: 'NoRoute', message: 'Impossible route between points' })).toThrow(
      expect.objectContaining({ kind: 'no-route', message: 'Impossible route between points' }),
    )
  })

  test('any other OSRM error is a "bad-response" failure', () => {
    expect(() => parseOsrm({ code: 'TooBig' })).toThrow(expect.objectContaining({ kind: 'bad-response' }))
  })
})

describe('formatDistance', () => {
  test('shows miles and kilometers', () => {
    expect(formatDistance(2877)).toEqual({ mi: '1.79 mi', km: '2.88 km' })
    expect(formatDistance(0)).toEqual({ mi: '0.00 mi', km: '0.00 km' })
  })
})

describe('pinLabels', () => {
  test('numbers counted signals and marks the rest', () => {
    expect(pinLabels([{ counted: true }, { counted: false }, { counted: true }])).toEqual(['1', '!', '2'])
  })
})
