import { useState } from 'react'
import type { CountTotals, Intersection } from '../lib/countSignals'
import { formatDistance, pinLabels } from '../lib/format'
import { BUFFER_MAX, BUFFER_MIN, type Mode, type Settings } from '../lib/storage'

interface Props {
  mode: Mode
  onModeChange: (mode: Mode) => void
  intersections: Intersection[]
  totals: CountTotals | null
  distanceMeters: number | null
  /** Shown above the status when part of the route is outside both cities. */
  warning: string | null
  /** What to show under the breakdown: an error, progress, or a hint. */
  status: string
  /** Shows a "Try again" button next to the status. */
  onRetry?: () => void
  loop: boolean
  onLoopChange: (loop: boolean) => void
  /** Omit to hide the Undo button. */
  onUndo?: () => void
  canUndo: boolean
  onClear: () => void
  canClear: boolean
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  /** Flashing beacons + school-zone signals in the whole dataset. */
  specialInData: number
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function BottomSheet({
  mode,
  onModeChange,
  intersections,
  totals,
  distanceMeters,
  warning,
  status,
  onRetry,
  loop,
  onLoopChange,
  onUndo,
  canUndo,
  onClear,
  canClear,
  settings,
  onSettingsChange,
  specialInData,
}: Props) {
  const [open, setOpen] = useState(true)
  const [showList, setShowList] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const distance = distanceMeters === null ? null : formatDistance(distanceMeters)
  const special =
    totals && !settings.includeSpecial
      ? [
          totals.flashingBeacons > 0 && plural(totals.flashingBeacons, 'flashing beacon'),
          totals.schoolZones > 0 && plural(totals.schoolZones, 'school zone signal'),
        ].filter(Boolean)
      : []
  const labels = pinLabels(intersections)

  return (
    <section className={`sheet ${open ? 'open' : 'closed'}`} aria-label="Route summary and controls">
      <button
        className="sheet-handle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Collapse panel' : 'Expand panel'}
      />

      {open && (
        <div className="sheet-top">
          <div className="mode-toggle" role="group" aria-label="How to enter a route">
            {(['addresses', 'draw'] as const).map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => onModeChange(m)}>
                {m === 'addresses' ? 'Addresses' : 'Draw'}
              </button>
            ))}
          </div>
          <button
            className="settings-button"
            aria-label="Settings"
            aria-expanded={showSettings}
            aria-controls="settings-panel"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
                transform="translate(-1 0)"
              />
            </svg>
          </button>
        </div>
      )}

      {open && showSettings && (
        <div className="settings" id="settings-panel">
          <label className="setting">
            <span>
              Count signals within <strong>{settings.bufferMeters} m</strong> of the route
            </span>
            <input
              type="range"
              min={BUFFER_MIN}
              max={BUFFER_MAX}
              step={5}
              value={settings.bufferMeters}
              onChange={(e) => onSettingsChange({ ...settings, bufferMeters: Number(e.target.value) })}
            />
          </label>
          <label className="toggle setting">
            <input
              type="checkbox"
              checked={settings.includeSpecial}
              onChange={(e) => onSettingsChange({ ...settings, includeSpecial: e.target.checked })}
            />
            <span>
              Include flashing beacons and school-zone signals
              <span className="muted"> ({specialInData} in the data)</span>
            </span>
          </label>
        </div>
      )}

      <div className="summary">
        <div className="total">
          <span className="total-number">{totals ? totals.total : '–'}</span>
          <span className="total-label">{totals?.total === 1 ? 'stoplight' : 'stoplights'}</span>
        </div>
        {distance && (
          <div className="distance">
            <div>{distance.mi}</div>
            <div className="muted">{distance.km}</div>
          </div>
        )}
      </div>

      {open && (
        <>
          {totals && (
            <p className="breakdown">
              Cambridge {totals.byCity.Cambridge} · Somerville {totals.byCity.Somerville}
              {special.length > 0 && <span className="muted"> · plus {special.join(', ')} not counted</span>}
            </p>
          )}
          {warning && (
            <p className="warning" role="alert">
              {warning}
            </p>
          )}
          <div className="status-row">
            <p className="status" role="status">
              {status}
            </p>
            {onRetry && (
              <button className="link-button" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>

          <div className="controls">
            {onUndo && (
              <button onClick={onUndo} disabled={!canUndo}>
                Undo
              </button>
            )}
            <button onClick={onClear} disabled={!canClear}>
              Clear
            </button>
            <label className="toggle">
              <input type="checkbox" checked={loop} onChange={(e) => onLoopChange(e.target.checked)} />
              <span>{mode === 'addresses' ? 'Out and back' : 'Loop back to start'}</span>
            </label>
          </div>

          {intersections.length > 0 && (
            <div className="disclosure">
              <button aria-expanded={showList} onClick={() => setShowList(!showList)}>
                Signals on this route ({intersections.length})
              </button>
              {showList && (
                <ol className="signal-list">
                  {intersections.map((x, i) => (
                    <li key={x.signalIds.join(',')} className={x.counted ? '' : 'not-counted'}>
                      <span className={`badge ${x.type === 'signal' ? '' : 'special'}`}>{labels[i]}</span>
                      <span className="signal-text">
                        <span className="signal-name">{x.location}</span>
                        <span className="muted">
                          {x.city} · {formatDistance(x.distanceAlongRoute).mi}
                          {!x.counted && ` · ${x.type === 'school_zone' ? 'school zone' : 'beacon'}, not counted`}
                        </span>
                      </span>
                      {x.passes > 1 && (
                        <span className="passes" aria-label={`passed ${x.passes} times`}>
                          ×{x.passes}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <p className="data-note">
            Data: Cambridge{' '}
            <a href="https://github.com/cambridgegis/cambridgegis_data" target="_blank" rel="noreferrer">
              city GIS
            </a>{' '}
            (official, 2020) · Somerville{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
          </p>
        </>
      )}
    </section>
  )
}
