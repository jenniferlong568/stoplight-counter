import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection, MultiPolygon, Point } from 'geojson'
import { MapView } from './components/MapView'
import { BottomSheet } from './components/BottomSheet'
import { AddressInput } from './components/AddressInput'
import { countSignals, type Signal, type SignalProperties } from './lib/countSignals'
import { routeThrough, waypointsFor, type LonLat, type RouteResult } from './lib/routing'
import type { Place } from './lib/geocoding'
import { distanceOutside } from './lib/coverage'
import { fetchJson, friendlyMessage, isAbort } from './lib/errors'
import { formatDistance } from './lib/format'
import { browserStorage, loadState, saveState, type Mode, type Settings } from './lib/storage'

const DATA_URL = `${import.meta.env.BASE_URL}data/`
// Ignore the odd stretch along a border street; warn about anything longer.
const OUTSIDE_WARNING_METERS = 50

function hint(mode: Mode, dots: LonLat[], start: Place | null, end: Place | null, bufferMeters: number): string {
  if (mode === 'addresses') {
    if (!start && !end) return 'Enter a start and an end address.'
    if (!start) return 'Choose a start address.'
    if (!end) return 'Choose an end address.'
    return `Signals within ${bufferMeters} m of the route are counted.`
  }
  if (dots.length === 0) return 'Tap the map to add your start.'
  if (dots.length === 1) return 'Tap again to add the next dot.'
  return 'Drag a dot to move it, or tap to add another.'
}

const saved = loadState(browserStorage())

export default function App() {
  const [mode, setMode] = useState<Mode>(saved.mode)
  const [dots, setDots] = useState<LonLat[]>(saved.dots)
  const [start, setStart] = useState<Place | null>(saved.start)
  const [end, setEnd] = useState<Place | null>(saved.end)
  const [loop, setLoop] = useState(saved.loop)
  const [settings, setSettings] = useState<Settings>(saved.settings)
  const [signals, setSignals] = useState<Signal[]>([])
  const [boundaries, setBoundaries] = useState<FeatureCollection<MultiPolygon> | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [retries, setRetries] = useState(0)

  useEffect(() => {
    fetchJson('data', DATA_URL + 'signals.geojson')
      .then((fc) => setSignals((fc as FeatureCollection<Point, SignalProperties>).features))
      .catch((e: unknown) => setDataError(friendlyMessage(e, 'data')))
    fetchJson('data', DATA_URL + 'boundaries.geojson')
      .then((fc) => setBoundaries(fc as FeatureCollection<MultiPolygon>))
      .catch((e: unknown) => setDataError(friendlyMessage(e, 'data')))
  }, [])

  useEffect(() => {
    saveState(browserStorage(), { mode, dots, loop, start, end, settings })
  }, [mode, dots, loop, start, end, settings])

  const places = useMemo(() => [start, end].filter((p): p is Place => p !== null), [start, end])
  const waypoints = useMemo(() => {
    if (mode === 'draw') return waypointsFor(dots, loop)
    return places.length === 2 ? waypointsFor(places.map((p) => p.coordinates), loop) : []
  }, [mode, dots, places, loop])

  // One routing request per change to the waypoints; a newer change cancels the older request.
  useEffect(() => {
    setRouteError(null)
    if (waypoints.length < 2) {
      setRoute(null)
      setRouting(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setRouting(true)
      routeThrough(waypoints, controller.signal)
        .then(setRoute)
        .catch((e: unknown) => {
          if (isAbort(e)) return
          setRoute(null)
          setRouteError(friendlyMessage(e, 'routing'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setRouting(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [waypoints, retries])

  // Don't show the other mode's route while this one loads.
  useEffect(() => setRoute(null), [mode])

  const result = useMemo(
    () =>
      route
        ? countSignals(route.line, signals, {
            bufferMeters: settings.bufferMeters,
            includeSpecial: settings.includeSpecial,
          })
        : null,
    [route, signals, settings],
  )

  const warning = useMemo(() => {
    if (!route || !boundaries) return null
    const { outsideMeters } = distanceOutside(route.line, boundaries.features)
    if (outsideMeters < OUTSIDE_WARNING_METERS) return null
    return `About ${formatDistance(outsideMeters).mi} of this route is outside Cambridge and Somerville. Signals there aren't counted.`
  }, [route, boundaries])

  const specialInData = useMemo(
    () => new Set(signals.filter((s) => s.properties.type !== 'signal').map((s) => s.properties.id)).size,
    [signals],
  )

  const drawing = mode === 'draw'
  const status =
    dataError ??
    routeError ??
    (routing ? 'Finding a walking route…' : hint(mode, dots, start, end, settings.bufferMeters))

  return (
    <div className={`app mode-${mode}`}>
      <MapView
        dots={drawing ? dots : places.map((p) => p.coordinates)}
        dotLabels={drawing ? undefined : [start ? 'A' : 'B', 'B']}
        route={route}
        intersections={result?.intersections ?? []}
        boundaries={boundaries}
        onAdd={drawing ? (p) => setDots((d) => [...d, p]) : undefined}
        onMove={drawing ? (i, p) => setDots((d) => d.map((q, j) => (j === i ? p : q))) : undefined}
        fitToRoute={!drawing}
      />
      {!drawing && (
        <section className="address-card" aria-label="Route addresses">
          <AddressInput label="Start" placeholder="e.g. Central Square, Cambridge" value={start} onChange={setStart} />
          <AddressInput label="End" placeholder="e.g. Union Square, Somerville" value={end} onChange={setEnd} />
        </section>
      )}
      <BottomSheet
        mode={mode}
        onModeChange={setMode}
        intersections={result?.intersections ?? []}
        totals={result?.totals ?? null}
        distanceMeters={route?.distanceMeters ?? null}
        warning={warning}
        status={status}
        onRetry={routeError && !dataError ? () => setRetries((n) => n + 1) : undefined}
        loop={loop}
        onLoopChange={setLoop}
        onUndo={drawing ? () => setDots((d) => d.slice(0, -1)) : undefined}
        canUndo={dots.length > 0}
        onClear={() => {
          if (drawing) setDots([])
          else {
            setStart(null)
            setEnd(null)
          }
        }}
        canClear={drawing ? dots.length > 0 : places.length > 0}
        settings={settings}
        onSettingsChange={setSettings}
        specialInData={specialInData}
      />
    </div>
  )
}
