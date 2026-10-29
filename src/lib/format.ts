const METERS_PER_MILE = 1609.344

export function formatDistance(meters: number): { mi: string; km: string } {
  return {
    mi: `${(meters / METERS_PER_MILE).toFixed(2)} mi`,
    km: `${(meters / 1000).toFixed(2)} km`,
  }
}

/** Map/list badges: counted signals are numbered in route order, the rest get "!". */
export function pinLabels(intersections: { counted: boolean }[]): string[] {
  let n = 0
  return intersections.map((x) => (x.counted ? String(++n) : '!'))
}
