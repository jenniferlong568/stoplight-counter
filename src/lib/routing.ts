import type { LineString } from 'geojson'
import { length } from '@turf/length'
import { feature } from '@turf/helpers'
import { fetchJson, ServiceError } from './errors'

/** [lon, lat], WGS84. */
export type LonLat = [number, number]

export interface RouteResult {
  line: LineString
  distanceMeters: number
}

/** Anything that turns ordered waypoints into a street-following line. */
export type Router = (waypoints: LonLat[], signal?: AbortSignal) => Promise<RouteResult>

/** The dots to route through; a loop returns to the first dot. */
export function waypointsFor(dots: LonLat[], loop: boolean): LonLat[] {
  if (dots.length < 2) return dots
  return loop ? [...dots, dots[0]] : dots
}

const OSRM_FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'

interface OsrmResponse {
  code: string
  message?: string
  routes?: { geometry: LineString }[]
}

export function parseOsrm(body: OsrmResponse): RouteResult {
  const geometry = body.routes?.[0]?.geometry
  if (body.code === 'NoRoute' || body.code === 'NoSegment') {
    throw new ServiceError('routing', 'no-route', body.message)
  }
  if (body.code !== 'Ok' || !geometry) {
    throw new ServiceError('routing', 'bad-response', body.message ?? `OSRM code ${body.code}`)
  }
  return { line: geometry, distanceMeters: length(feature(geometry), { units: 'kilometers' }) * 1000 }
}

/** OSRM foot profile on the FOSSGIS server (the project-osrm.org demo only does cars). */
export const osrmFoot: Router = async (waypoints, signal) => {
  const coords = waypoints.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';')
  // OSRM answers 400 with a JSON body (e.g. code "NoRoute") when it can't route.
  const body = await fetchJson('routing', `${OSRM_FOOT_URL}/${coords}?overview=full&geometries=geojson`, { signal }, [400])
  return parseOsrm(body as OsrmResponse)
}

/** The one routing function the app uses. Swap the implementation here. */
export const routeThrough: Router = osrmFoot
