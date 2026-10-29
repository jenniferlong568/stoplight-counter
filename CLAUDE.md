# Stoplight Counter
A mobile-first web app for runners in Cambridge and Somerville, MA. I enter a running
route (start/end addresses, or dots I draw on the map) and it counts the traffic
signals on the route.

## Stack
Vite + React + TypeScript, react-leaflet, Turf.js. Data prep scripts in /scripts (Node).
Processed data in /public/data. No backend unless CORS forces a tiny proxy.

## Data
- Cambridge: official City GIS layer TRAFFIC_Signals (github.com/cambridgegis/cambridgegis_data,
  folder Traffic/Traffic_Signals). Fields: ID, JURISDICTION, LOCATION, CONTACT.
  ID ranges: 0–500 city, 700–799 flashing beacon, 800–899 school zone, 900–999 state-owned.
- Somerville: no city dataset; use OpenStreetMap via Overpass (highway=traffic_signals,
  crossing=traffic_signals) inside the Somerville boundary.
- Common schema: { id, city, location, type, source }. All coordinates WGS84.
- Basemap: OSM tiles. Geocoding: Photon (photon.komoot.io), not Nominatim — Nominatim's usage
  policy forbids client-side autocomplete. Routing: OSRM foot profile on routing.openstreetmap.de
  (the project-osrm.org demo is car-only). Each behind one swappable function
  (src/lib/geocoding.ts, src/lib/routing.ts).

## Rules
- Work one phase at a time; stop and report when a phase is done.
- Write tests for logic. Run them before saying something works.
- Never fetch Overpass, Nominatim or Photon in a loop; respect rate limits (geocoding max 1 request/sec).
