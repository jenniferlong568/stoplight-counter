// Builds public/data/signals.geojson and public/data/boundaries.geojson.
//
//   node scripts/prepare-data.ts            # uses cached downloads if present
//   node scripts/prepare-data.ts --refresh  # downloads again (one request per source)
//
// Set STOPLIGHT_CONTACT (an email or URL) to include contact info in the
// User-Agent sent to Overpass, as its usage policy asks.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FeatureCollection, Point } from 'geojson'
import {
  cambridgeSignals,
  makeNameNear,
  osmBoundaries,
  osmSignals,
  type CambridgeProps,
  type OsmElement,
} from './lib/transform.ts'

const ROOT = join(import.meta.dirname, '..')
const CACHE = join(ROOT, 'scripts', '.cache')
const OUT = join(ROOT, 'public', 'data')

const CAMBRIDGE_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Traffic/Traffic_Signals/TRAFFIC_Signals.geojson'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// One query: both city boundaries, every signal node in them, and the named
// streets through those nodes (for intersection names; OSM signal nodes are unnamed).
const OVERPASS_QUERY = `[out:json][timeout:90];
area["boundary"="administrative"]["admin_level"="4"]["name"="Massachusetts"]->.ma;
rel(area.ma)["boundary"="administrative"]["admin_level"="8"]["name"~"^(Somerville|Cambridge)$"]->.cities;
.cities out geom;
.cities map_to_area->.a;
(
  node(area.a)["highway"="traffic_signals"];
  node(area.a)["crossing"="traffic_signals"];
)->.sig;
.sig out body;
way(bn.sig)["highway"]["name"];
out body;`

const refresh = process.argv.includes('--refresh')
const contact = process.env.STOPLIGHT_CONTACT
const userAgent = `stoplight-counter-dataprep/0.1${contact ? ` (${contact})` : ''}`

async function cached(file: string, download: () => Promise<Response>): Promise<string> {
  const path = join(CACHE, file)
  if (!refresh && existsSync(path)) return readFileSync(path, 'utf8')
  console.log(`Downloading ${file}…`)
  const res = await download()
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${await res.text()}`)
  const text = await res.text()
  writeFileSync(path, text)
  return text
}

mkdirSync(CACHE, { recursive: true })
mkdirSync(OUT, { recursive: true })

const cambridgeRaw = await cached('cambridge-signals.geojson', () => fetch(CAMBRIDGE_URL))
const overpassRaw = await cached('overpass.json', () =>
  fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: OVERPASS_QUERY }),
  }),
)

const cambridge = JSON.parse(cambridgeRaw) as FeatureCollection<Point, CambridgeProps>
const elements = (JSON.parse(overpassRaw) as { elements: OsmElement[] }).elements

const boundaries = osmBoundaries(elements)
const somerville = boundaries.find((b) => b.properties.name === 'Somerville')
if (!somerville) throw new Error('Somerville boundary missing from Overpass response')

const signals = [
  ...cambridgeSignals(cambridge, makeNameNear(elements)),
  ...osmSignals(elements, somerville),
]

writeFileSync(join(OUT, 'boundaries.geojson'), JSON.stringify({ type: 'FeatureCollection', features: boundaries }))
writeFileSync(join(OUT, 'signals.geojson'), JSON.stringify({ type: 'FeatureCollection', features: signals }))

const count = (pred: (s: (typeof signals)[number]) => boolean) => signals.filter(pred).length
console.log(`boundaries.geojson: ${boundaries.map((b) => b.properties.name).join(', ')}`)
console.log(
  `signals.geojson: ${signals.length} points ` +
    `(Cambridge ${count((s) => s.properties.city === 'Cambridge')}, ` +
    `Somerville ${count((s) => s.properties.city === 'Somerville')}, ` +
    `unnamed ${count((s) => s.properties.location === 'Unnamed signal')}, ` +
    `beacons ${count((s) => s.properties.type === 'flashing_beacon')}, ` +
    `school zones ${count((s) => s.properties.type === 'school_zone')})`,
)
