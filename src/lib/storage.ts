import type { LonLat } from './routing'
import type { Place } from './geocoding'

export type Mode = 'addresses' | 'draw'

export interface Settings {
  bufferMeters: number
  includeSpecial: boolean
}

export interface SavedState {
  mode: Mode
  dots: LonLat[]
  loop: boolean
  start: Place | null
  end: Place | null
  settings: Settings
}

export const BUFFER_MIN = 10
export const BUFFER_MAX = 50
export const DEFAULT_STATE: SavedState = {
  mode: 'addresses',
  dots: [],
  loop: false,
  start: null,
  end: null,
  settings: { bufferMeters: 20, includeSpecial: false },
}

const KEY = 'stoplight-counter:v1'
const MAX_DOTS = 200

function isLonLat(v: unknown): v is LonLat {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(v[0]) <= 180 &&
    Math.abs(v[1]) <= 90
  )
}

function asPlace(v: unknown): Place | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  if (typeof p.label !== 'string' || typeof p.detail !== 'string' || !isLonLat(p.coordinates)) return null
  return { label: p.label, detail: p.detail, coordinates: [p.coordinates[0], p.coordinates[1]] }
}

/** Reads the saved state, keeping each field only if it is valid. Never throws. */
export function loadState(storage: Pick<Storage, 'getItem'> | undefined): SavedState {
  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STATE
    raw = parsed as Record<string, unknown>
  } catch {
    return DEFAULT_STATE
  }
  const settings = (typeof raw.settings === 'object' && raw.settings !== null ? raw.settings : {}) as Record<
    string,
    unknown
  >
  const buffer = settings.bufferMeters
  return {
    mode: raw.mode === 'draw' || raw.mode === 'addresses' ? raw.mode : DEFAULT_STATE.mode,
    dots: Array.isArray(raw.dots) ? raw.dots.filter(isLonLat).slice(0, MAX_DOTS) : [],
    loop: raw.loop === true,
    start: asPlace(raw.start),
    end: asPlace(raw.end),
    settings: {
      bufferMeters:
        typeof buffer === 'number' && Number.isFinite(buffer)
          ? Math.min(BUFFER_MAX, Math.max(BUFFER_MIN, Math.round(buffer)))
          : DEFAULT_STATE.settings.bufferMeters,
      includeSpecial: settings.includeSpecial === true,
    },
  }
}

/** Saves the state; ignores storage that is full or unavailable (e.g. private browsing). */
export function saveState(storage: Pick<Storage, 'setItem'> | undefined, state: SavedState): void {
  try {
    storage?.setItem(KEY, JSON.stringify(state))
  } catch {
    // Nothing useful to do: the app works without saving.
  }
}

/** localStorage, or undefined where touching it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
