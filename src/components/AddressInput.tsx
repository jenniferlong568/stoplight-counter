import { useEffect, useId, useRef, useState } from 'react'
import { MIN_QUERY_LENGTH, searchPlaces, type Place } from '../lib/geocoding'
import { friendlyMessage, isAbort } from '../lib/errors'

const DEBOUNCE_MS = 400
// Close the list a moment after blur so a tap on a suggestion lands first.
// (Cancelling mousedown on the list instead breaks the next tap on touch screens:
// the field it lands in gets focus but no typing.)
const CLOSE_DELAY_MS = 200

interface Props {
  label: string
  placeholder: string
  value: Place | null
  onChange: (place: Place | null) => void
}

export function AddressInput({ label, placeholder, value, onChange }: Props) {
  const id = useId()
  const [text, setText] = useState(value?.label ?? '')
  // Only what the user typed is searched; picking a result sets text without searching.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!value) setText((t) => (query ? t : ''))
  }, [value, query])

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      setError(null)
      searchPlaces(query, controller.signal)
        .then((places) => {
          setResults(places)
          setActive(0)
        })
        .catch((e: unknown) => {
          if (!isAbort(e)) setError(friendlyMessage(e, 'geocoding'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  function choose(place: Place) {
    onChange(place)
    setText(place.label)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setText('')
    setQuery('')
    setResults([])
  }

  const showList = open && query.trim().length >= MIN_QUERY_LENGTH
  const listId = `${id}-list`

  return (
    <div className="address-field">
      <label htmlFor={id}>{label}</label>
      <div className="address-box">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setQuery(e.target.value)
            setOpen(true)
            if (value) onChange(null)
          }}
          onFocus={() => {
            clearTimeout(closeTimer.current)
            setOpen(true)
          }}
          onBlur={() => {
            closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
          }}
          onKeyDown={(e) => {
            if (!showList || results.length === 0) return
            if (e.key === 'ArrowDown') setActive((a) => (a + 1) % results.length)
            else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + results.length) % results.length)
            else if (e.key === 'Enter') choose(results[active])
            else if (e.key === 'Escape') setOpen(false)
            else return
            e.preventDefault()
          }}
        />
        {text && (
          <button className="address-clear" onClick={clear} aria-label={`Clear ${label.toLowerCase()}`}>
            ×
          </button>
        )}
      </div>
      {showList && (
        <ul className="address-results" id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {results.map((place, i) => (
            <li
              key={`${place.label}|${place.detail}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => choose(place)}
            >
              <span className="result-label">{place.label}</span>
              {place.detail && <span className="result-detail">{place.detail}</span>}
            </li>
          ))}
          {results.length === 0 && (
            <li className="result-note" aria-disabled="true">
              {error ?? (searching ? 'Searching…' : 'No matches in Cambridge or Somerville')}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
