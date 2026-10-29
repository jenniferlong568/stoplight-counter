import { useEffect } from 'react'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import {
  AttributionControl,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { Intersection } from '../lib/countSignals'
import type { LonLat, RouteResult } from '../lib/routing'
import { formatDistance, pinLabels } from '../lib/format'

// Between Union Square and Inman Square.
const CENTER: [number, number] = [42.3765, -71.0975]

const iconCache = new Map<string, L.DivIcon>()
function labelIcon(className: string, label: string, size: number): L.DivIcon {
  const key = `${className}|${label}`
  let icon = iconCache.get(key)
  if (!icon) {
    icon = L.divIcon({ className, html: `<span>${label}</span>`, iconSize: [size, size] })
    iconCache.set(key, icon)
  }
  return icon
}

const SOURCE_LABEL = { 'cambridge-gis': 'Cambridge GIS', osm: 'OpenStreetMap' } as const
const TYPE_LABEL = { signal: '', flashing_beacon: 'Flashing beacon', school_zone: 'School zone signal' } as const

function ClickToAdd({ onAdd }: { onAdd: (p: LonLat) => void }) {
  useMapEvents({ click: (e) => onAdd([e.latlng.lng, e.latlng.lat]) })
  return null
}

/** Zooms to each new route, leaving room for the address card and the bottom sheet. */
function FitToRoute({ route }: { route: RouteResult | null }) {
  const map = useMap()
  useEffect(() => {
    if (!route) return
    const bounds = L.latLngBounds(route.line.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]))
    map.fitBounds(bounds, { paddingTopLeft: [24, 190], paddingBottomRight: [24, 300], maxZoom: 17 })
  }, [map, route])
  return null
}

interface Props {
  /** Route dots (draw mode) or start/end places (address mode). */
  dots: LonLat[]
  dotLabels?: string[]
  route: RouteResult | null
  intersections: Intersection[]
  boundaries: FeatureCollection | null
  /** Tap to add a dot; omit to turn tapping off. */
  onAdd?: (p: LonLat) => void
  /** Drag to move a dot; omit to make dots fixed. */
  onMove?: (index: number, p: LonLat) => void
  fitToRoute: boolean
}

export function MapView({ dots, dotLabels, route, intersections, boundaries, onAdd, onMove, fitToRoute }: Props) {
  const labels = pinLabels(intersections)
  return (
    <MapContainer
      center={CENTER}
      zoom={15}
      className="map"
      doubleClickZoom={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <AttributionControl position="topright" />
      {boundaries && (
        <GeoJSON
          data={boundaries}
          interactive={false}
          style={{ color: '#475569', weight: 2, opacity: 0.4, dashArray: '6 6', fillOpacity: 0.03 }}
        />
      )}
      {onAdd && <ClickToAdd onAdd={onAdd} />}
      {fitToRoute && <FitToRoute route={route} />}
      {route && (
        <Polyline
          positions={route.line.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
          pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.75 }}
          interactive={false}
        />
      )}
      {intersections.map((x, i) => {
        const special = x.type !== 'signal'
        return (
          <Marker
            key={x.signalIds.join(',')}
            position={[x.coordinates[1], x.coordinates[0]]}
            icon={labelIcon(special ? 'signal-pin special' : 'signal-pin', labels[i], 24)}
          >
            <Popup>
              <strong>{x.location}</strong>
              <br />
              {x.city} · {SOURCE_LABEL[x.source]}
              {special && (
                <>
                  <br />
                  {TYPE_LABEL[x.type]}
                  {!x.counted && ' (not in the total)'}
                </>
              )}
              <br />
              At {formatDistance(x.distanceAlongRoute).mi}
              {x.passes > 1 && ` · passed ${x.passes}×`}
            </Popup>
          </Marker>
        )
      })}
      {dots.map(([lon, lat], i) => (
        <Marker
          key={i}
          position={[lat, lon]}
          draggable={!!onMove}
          zIndexOffset={1000}
          icon={labelIcon('route-dot', dotLabels?.[i] ?? String(i + 1), 28)}
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              onMove?.(i, [ll.lng, ll.lat])
            },
          }}
        />
      ))}
    </MapContainer>
  )
}
