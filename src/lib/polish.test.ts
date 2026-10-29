import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LineString } from 'geojson'
import { distanceOutside, type Area } from './coverage'
import { fetchJson, friendlyMessage, ServiceError } from './errors'
import { DEFAULT_STATE, loadState, saveState, type SavedState } from './storage'

// ~1 km squares side by side, like Cambridge and Somerville sharing a border.
const DEG = 0.01
const square = (x0: number): Area => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[x0, 42], [x0 + DEG, 42], [x0 + DEG, 42 + DEG], [x0, 42 + DEG], [x0, 42]]],
  },
})
const areas = [square(-71.02), square(-71.01)]
const line = (...pts: [number, number][]): LineString => ({ type: 'LineString', coordinates: pts })

describe('distanceOutside', () => {
  test('a route inside the area, crossing between the two cities, is 0 m outside', () => {
    const { outsideMeters, totalMeters } = distanceOutside(line([-71.018, 42.005], [-71.002, 42.005]), areas)
    expect(outsideMeters).toBe(0)
    expect(totalMeters).toBeGreaterThan(1000)
  })

  test('measures the part that leaves the area', () => {
    // From the middle of the east square to 0.01° (~820 m) beyond its east edge.
    const { outsideMeters, totalMeters } = distanceOutside(line([-71.005, 42.005], [-70.99, 42.005]), areas)
    expect(outsideMeters / totalMeters).toBeCloseTo(2 / 3, 1)
  })

  test('a route entirely outside is all outside', () => {
    const { outsideMeters, totalMeters } = distanceOutside(line([-70.9, 42.1], [-70.89, 42.1]), areas)
    expect(outsideMeters).toBeCloseTo(totalMeters)
  })
})

describe('friendlyMessage', () => {
  test('explains each routing failure in plain words', () => {
    expect(friendlyMessage(new ServiceError('routing', 'offline'), 'routing')).toMatch(/check your connection/i)
    expect(friendlyMessage(new ServiceError('routing', 'rate-limited'), 'routing')).toMatch(/busy/)
    expect(friendlyMessage(new ServiceError('routing', 'no-route'), 'routing')).toMatch(/walking route/)
    expect(friendlyMessage(new Error('TypeError: x is undefined'), 'routing')).toBe(
      'Something went wrong finding a route. Try again.',
    )
  })

  test('geocoding failures suggest Draw mode', () => {
    expect(friendlyMessage(new ServiceError('geocoding', 'server'), 'geocoding')).toMatch(/switch to Draw/)
  })
})

describe('fetchJson', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl))

  test('a network failure is "offline"', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(fetchJson('routing', 'https://x')).rejects.toMatchObject({ kind: 'offline' })
  })

  test('429 is "rate-limited" and 503 is "server"', async () => {
    stubFetch(async () => new Response('', { status: 429 }))
    await expect(fetchJson('geocoding', 'https://x')).rejects.toMatchObject({ kind: 'rate-limited' })
    stubFetch(async () => new Response('', { status: 503 }))
    await expect(fetchJson('geocoding', 'https://x')).rejects.toMatchObject({ kind: 'server' })
  })

  test('accepted error statuses return the body', async () => {
    stubFetch(async () => new Response('{"code":"NoRoute"}', { status: 400 }))
    await expect(fetchJson('routing', 'https://x', {}, [400])).resolves.toEqual({ code: 'NoRoute' })
    await expect(fetchJson('routing', 'https://x')).rejects.toMatchObject({ kind: 'bad-response' })
  })

  test('an abort is passed through, not turned into "offline"', async () => {
    stubFetch(() => Promise.reject(new DOMException('Aborted', 'AbortError')))
    await expect(fetchJson('routing', 'https://x')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('saved state', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
  }

  test('round-trips the last route and settings', () => {
    const storage = memory()
    const state: SavedState = {
      mode: 'draw',
      dots: [[-71.1, 42.37], [-71.09, 42.38]],
      loop: true,
      start: { label: 'Central Square', detail: 'Cambridge', coordinates: [-71.104, 42.3655] },
      end: null,
      settings: { bufferMeters: 30, includeSpecial: true },
    }
    saveState(storage, state)
    expect(loadState(storage)).toEqual(state)
  })

  test('nothing saved, unreadable JSON, or no storage gives the defaults', () => {
    expect(loadState(memory())).toEqual(DEFAULT_STATE)
    expect(loadState({ getItem: () => '{not json' })).toEqual(DEFAULT_STATE)
    expect(loadState(undefined)).toEqual(DEFAULT_STATE)
  })

  test('bad fields are dropped and the buffer is clamped', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          mode: 'fly',
          dots: [[-71.1, 42.37], ['x', 1], [500, 42], null],
          start: { label: 'No coordinates', detail: '' },
          settings: { bufferMeters: 9999 },
        }),
    }
    expect(loadState(storage)).toEqual({
      ...DEFAULT_STATE,
      dots: [[-71.1, 42.37]],
      settings: { bufferMeters: 50, includeSpecial: false },
    })
  })

  test('saving ignores storage that throws (full or private mode)', () => {
    const storage = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => saveState(storage, DEFAULT_STATE)).not.toThrow()
  })
})
