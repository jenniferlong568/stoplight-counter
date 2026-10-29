import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createGeocoder, createRateLimiter, parsePhoton, photonUrl } from './geocoding'

describe('photonUrl', () => {
  test('encodes the query and limits results to Cambridge + Somerville', () => {
    const url = new URL(photonUrl('Central Square, Cambridge'))
    expect(url.searchParams.get('q')).toBe('Central Square, Cambridge')
    expect(url.searchParams.get('bbox')).toBe('-71.1604,42.3524,-71.064,42.4182')
  })
})

describe('parsePhoton', () => {
  const feature = (lon: number, lat: number, properties: Record<string, string>) => ({
    geometry: { coordinates: [lon, lat] },
    properties,
  })

  test('labels named places, addresses, and drops duplicates', () => {
    const places = parsePhoton({
      features: [
        feature(-71.104, 42.3655, { name: 'Central Square', city: 'Cambridge' }),
        feature(-71.1036, 42.3653, { name: 'Central', street: 'Massachusetts Avenue', city: 'Cambridge' }),
        feature(-71.1, 42.36, { housenumber: '450', street: 'Massachusetts Avenue', city: 'Cambridge' }),
        feature(-71.1041, 42.3656, { name: 'Central Square', city: 'Cambridge' }),
        feature(-71.1, 42.36, { city: 'Cambridge' }),
      ],
    })

    expect(places).toEqual([
      { label: 'Central Square', detail: 'Cambridge', coordinates: [-71.104, 42.3655] },
      { label: 'Central', detail: 'Massachusetts Avenue, Cambridge', coordinates: [-71.1036, 42.3653] },
      { label: '450 Massachusetts Avenue', detail: 'Cambridge', coordinates: [-71.1, 42.36] },
    ])
  })
})

describe('rate limiting and caching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const calls: { url: string; at: number }[] = []
    const fetchJson = vi.fn(async (url: string) => {
      calls.push({ url, at: Date.now() })
      return { features: [] }
    })
    const search = createGeocoder({ url: (q) => q, parse: () => [], fetchJson })
    return { calls, fetchJson, search }
  }

  test('requests start at least 1 second apart', async () => {
    const { calls, search } = setup()
    const start = Date.now()

    const all = Promise.all([search('aaa'), search('bbb'), search('ccc')])
    await vi.runAllTimersAsync()
    await all

    expect(calls.map((c) => c.url)).toEqual(['aaa', 'bbb', 'ccc'])
    expect(calls.map((c) => c.at - start)).toEqual([0, 1000, 2000])
  })

  test('repeat queries come from the cache', async () => {
    const { fetchJson, search } = setup()
    await search('Union Square')
    await search('  union   square ')
    expect(fetchJson).toHaveBeenCalledTimes(1)
  })

  test('queries shorter than 3 characters are not sent', async () => {
    const { fetchJson, search } = setup()
    expect(await search('ab')).toEqual([])
    expect(fetchJson).not.toHaveBeenCalled()
  })

  test('a search aborted while waiting its turn is never sent', async () => {
    const { calls, search } = setup()
    const controller = new AbortController()

    const first = search('first')
    const stale = expect(search('stale', controller.signal)).rejects.toThrow('Aborted')
    controller.abort()
    await vi.runAllTimersAsync()

    await first
    await stale
    expect(calls.map((c) => c.url)).toEqual(['first'])
  })

  test('the limiter keeps spacing after an abort', async () => {
    const schedule = createRateLimiter(1000)
    const starts: number[] = []
    const t0 = Date.now()
    const task = async () => void starts.push(Date.now() - t0)
    const controller = new AbortController()

    const a = schedule(task)
    const b = schedule(task, controller.signal)
    const c = schedule(task)
    controller.abort()
    await vi.runAllTimersAsync()
    await Promise.allSettled([a, b, c])

    expect(starts).toEqual([0, 1000])
  })
})
