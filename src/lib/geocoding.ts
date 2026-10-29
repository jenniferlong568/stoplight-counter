import type { LonLat } from './routing'
import { fetchJson } from './errors'

export interface Place {
  /** Main line, e.g. "Central Square" or "450 Massachusetts Avenue". */
  label: string
  /** Second line, e.g. "Massachusetts Avenue, Cambridge". */
  detail: string
  coordinates: LonLat
}

export type Geocoder = (query: string, signal?: AbortSignal) => Promise<Place[]>

/** Cambridge + Somerville, from public/data/boundaries.geojson: [minLon, minLat, maxLon, maxLat]. */
export const SEARCH_BBOX = [-71.1604, 42.3524, -71.064, 42.4182] as const

export const MIN_QUERY_LENGTH = 3

const PHOTON_URL = 'https://photon.komoot.io/api/'

export function photonUrl(query: string): string {
  const params = new URLSearchParams({ q: query, bbox: SEARCH_BBOX.join(','), limit: '6', lang: 'en' })
  return `${PHOTON_URL}?${params}`
}

interface PhotonFeature {
  geometry: { coordinates: number[] }
  properties: Record<string, string | undefined>
}

export function parsePhoton(body: { features?: PhotonFeature[] }): Place[] {
  const seen = new Set<string>()
  const places: Place[] = []
  for (const f of body.features ?? []) {
    const p = f.properties
    const address = [p.housenumber, p.street].filter(Boolean).join(' ')
    const label = p.name ?? address
    if (!label) continue
    const detail = [p.name ? address || p.street : undefined, p.city ?? p.locality].filter(Boolean).join(', ')
    const key = `${label}|${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    const [lon, lat] = f.geometry.coordinates
    places.push({ label, detail, coordinates: [lon, lat] })
  }
  return places
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError')
}

/**
 * Runs tasks one at a time with at least `minIntervalMs` between starts.
 * A task whose signal aborts while it waits is dropped without running.
 */
export function createRateLimiter(minIntervalMs: number, now = () => Date.now()) {
  let nextStart = 0
  let queue: Promise<unknown> = Promise.resolve()

  return function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = async () => {
      if (signal?.aborted) throw abortError()
      const wait = nextStart - now()
      if (wait > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, wait)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(abortError())
          })
        })
      }
      if (signal?.aborted) throw abortError()
      nextStart = now() + minIntervalMs
      return task()
    }
    const result = queue.then(run, run)
    queue = result.catch(() => undefined)
    return result
  }
}

interface GeocoderOptions {
  url: (query: string) => string
  parse: (body: never) => Place[]
  minIntervalMs?: number
  fetchJson?: (url: string, signal?: AbortSignal) => Promise<unknown>
}

function defaultFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  return fetchJson('geocoding', url, { signal })
}

/** A rate-limited, cached geocoder. Every caller shares the one limit. */
export function createGeocoder({
  url,
  parse,
  minIntervalMs = 1000,
  fetchJson = defaultFetchJson,
}: GeocoderOptions): Geocoder {
  const schedule = createRateLimiter(minIntervalMs)
  const cache = new Map<string, Place[]>()
  return async (query, signal) => {
    const q = query.trim().replace(/\s+/g, ' ')
    if (q.length < MIN_QUERY_LENGTH) return []
    const key = q.toLowerCase()
    const hit = cache.get(key)
    if (hit) return hit
    const places = parse((await schedule(() => fetchJson(url(q), signal), signal)) as never)
    cache.set(key, places)
    return places
  }
}

/**
 * The one geocoding function the app uses. Swap the implementation here.
 * Photon, not Nominatim: Nominatim's usage policy forbids client-side autocomplete.
 */
export const searchPlaces: Geocoder = createGeocoder({ url: photonUrl, parse: parsePhoton })
