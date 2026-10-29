# Stoplight Counter

A mobile-first web app for runners in Cambridge and Somerville, MA. Enter a route — two
addresses, or dots tapped on the map — and it counts the traffic signals along it.

Vite + React + TypeScript, Leaflet (react-leaflet), Turf.js. No backend: the signal data is
static files in `public/data/`, and routing and address search call public services from the
browser.

## Running it

Needs Node.js 20.19 or newer.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # production build in dist/
```

## Deploying

Pushing to `main` deploys to GitHub Pages: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
installs, runs the tests, builds with `BASE_PATH=/<repo name>/`, and publishes `dist/`. A failing
test stops the deploy.

For any other static host (e.g. Netlify Drop), run `npm run build` and upload `dist/`; with no
`BASE_PATH` set the site expects to be served from the domain root.

## How counting works

`countSignals` in [src/lib/countSignals.ts](src/lib/countSignals.ts) takes the route line and
the signal points:

1. A signal is on the route if it is within the **buffer** (default 20 m) of any part of it.
2. Signal points within 25 m of each other, or sharing a Cambridge ID, are merged into one
   intersection.
3. Each intersection is counted once. `passes` says how many times the route goes through it;
   a pass only ends once the route gets 50 m away, so sidewalk routes that wobble along the
   buffer edge don't count twice.
4. Flashing beacons and school-zone signals are counted separately and left out of the total
   unless the setting is on.

Long routes are split into chunks with bounding boxes, so each signal is only measured against
the parts of the route near it (a 50 km route takes about 10 ms).

## Data

| City | Source | Notes |
|---|---|---|
| Cambridge | [City GIS `TRAFFIC_Signals`](https://github.com/cambridgegis/cambridgegis_data/tree/main/Traffic/Traffic_Signals) | Official. The published file dates from June 2020. |
| Somerville | OpenStreetMap via Overpass | `highway=traffic_signals` and `crossing=traffic_signals` inside the city boundary. |
| Boundaries | OpenStreetMap via Overpass | Used for the map outline and the "outside Cambridge/Somerville" warning. |

Quirks of the Cambridge file that the prep script handles:

- Field names are mixed case (`ID`, `Location`, `Jurisdiction`).
- Each pole is a point; all poles at one intersection share an `ID`.
- `ID` 0 is a catch-all for 155 unassigned poles. Each is kept as its own signal and named after
  the nearest OSM street names when possible, otherwise "Unnamed signal".
- No IDs fall in 700–799 (flashing beacon) or 800–899 (school zone), so Cambridge currently has
  none of those. The only special signal in the data is one OSM flashing beacon in Somerville.

### Refreshing the data

```sh
npm run data                # rebuild public/data/ from cached downloads
npm run data -- --refresh   # download fresh copies first
```

[scripts/prepare-data.ts](scripts/prepare-data.ts) makes **one** request to GitHub and **one**
Overpass query, caches both in `scripts/.cache/` (git-ignored), and writes
`public/data/signals.geojson` and `public/data/boundaries.geojson`. Overpass asks clients to
identify themselves; to include contact details in the User-Agent, set:

```sh
STOPLIGHT_CONTACT="you@example.com" npm run data -- --refresh
```

The conversion logic is in [scripts/lib/transform.ts](scripts/lib/transform.ts) and has tests.

## Changing the buffer

- **In the app:** the gear button in the bottom sheet has a 10–50 m slider. The choice is saved
  on the device.
- **The default:** `DEFAULT_STATE.settings.bufferMeters` in [src/lib/storage.ts](src/lib/storage.ts).
  The slider range is `BUFFER_MIN` / `BUFFER_MAX` in the same file.
- **Merge distance and pass rules:** the `mergeMeters` and `passExitMeters` options of
  `countSignals` in [src/lib/countSignals.ts](src/lib/countSignals.ts).

## Changing routing or address search

Each service sits behind one function. Swap the implementation and nothing else changes.

**Routing** — `routeThrough` in [src/lib/routing.ts](src/lib/routing.ts). It currently uses the
OSRM foot profile on `routing.openstreetmap.de` (the `project-osrm.org` demo server only routes
cars). A replacement must match the `Router` type:

```ts
export const myRouter: Router = async (waypoints /* [lon, lat][] */, signal) => {
  const body = await fetchJson('routing', buildUrl(waypoints), { signal })
  return { line: /* GeoJSON LineString */, distanceMeters: /* number */ }
}

export const routeThrough: Router = myRouter
```

Throw `new ServiceError('routing', 'no-route')` when no route exists so the app shows the
right message. `fetchJson` (in [src/lib/errors.ts](src/lib/errors.ts)) already turns network
failures, 429s and 5xx responses into `ServiceError`s.

**Address search** — `searchPlaces` in [src/lib/geocoding.ts](src/lib/geocoding.ts). It uses
[Photon](https://photon.komoot.io), limited to a Cambridge + Somerville bounding box.
Nominatim is not used because its usage policy forbids client-side autocomplete. To swap, pass
a different `url` and `parse` to `createGeocoder`; that keeps the shared 1 request/second limit
and the cache.

## Service limits

- Address search: debounced 400 ms, at most 1 request per second across both fields, results
  cached.
- Routing: one request per route change; a newer change cancels the pending request.
- Data prep: one request per source, cached. Never fetch Overpass, Nominatim or Photon in a loop.

## Saved state

The last route (mode, dots or addresses, loop) and settings are saved in `localStorage` under
`stoplight-counter:v1`. Each field is checked on load, so bad or old data falls back to the
defaults instead of breaking the app.
