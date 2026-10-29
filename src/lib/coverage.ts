import type { Feature, LineString, MultiPolygon, Polygon, Position } from 'geojson'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'

export type Area = Feature<Polygon | MultiPolygon>

const M_PER_DEG = 111_195

/**
 * Meters of the route that fall outside every area, measured by testing the
 * middle of each ~stepMeters piece of the route.
 */
export function distanceOutside(
  line: LineString,
  areas: Area[],
  stepMeters = 20,
): { outsideMeters: number; totalMeters: number } {
  const coords = line.coordinates
  if (coords.length < 2) return { outsideMeters: 0, totalMeters: 0 }

  const cos = Math.cos((coords[0][1] * Math.PI) / 180)
  const boxes = areas.map((area) => {
    const all = (area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates).flat(2)
    const lons = all.map((p) => p[0])
    const lats = all.map((p) => p[1])
    return { area, minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) }
  })
  const inside = ([lon, lat]: Position) =>
    boxes.some(
      (b) =>
        lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat && booleanPointInPolygon([lon, lat], b.area),
    )

  let outsideMeters = 0
  let totalMeters = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon0, lat0] = coords[i]
    const [lon1, lat1] = coords[i + 1]
    const len = Math.hypot((lon1 - lon0) * cos * M_PER_DEG, (lat1 - lat0) * M_PER_DEG)
    if (len === 0) continue
    const pieces = Math.ceil(len / stepMeters)
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces
      if (!inside([lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t])) outsideMeters += len / pieces
    }
    totalMeters += len
  }
  return { outsideMeters, totalMeters }
}
