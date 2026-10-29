export type Service = 'routing' | 'geocoding' | 'data'
export type FailureKind = 'offline' | 'rate-limited' | 'server' | 'no-route' | 'bad-response'

export class ServiceError extends Error {
  readonly service: Service
  readonly kind: FailureKind
  constructor(service: Service, kind: FailureKind, detail?: string) {
    super(detail ?? `${service} failed: ${kind}`)
    this.name = 'ServiceError'
    this.service = service
    this.kind = kind
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * fetch + JSON with failures sorted into ServiceError kinds. Responses whose
 * status is in `acceptStatuses` (besides 2xx) are returned as JSON so the
 * caller can read the service's own error body.
 */
export async function fetchJson(
  service: Service,
  url: string,
  init: RequestInit = {},
  acceptStatuses: number[] = [],
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ServiceError(service, 'offline', String(e))
  }
  if (res.status === 429) throw new ServiceError(service, 'rate-limited', `HTTP 429`)
  if (res.status >= 500) throw new ServiceError(service, 'server', `HTTP ${res.status}`)
  if (!res.ok && !acceptStatuses.includes(res.status)) {
    throw new ServiceError(service, 'bad-response', `HTTP ${res.status}`)
  }
  try {
    return await res.json()
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ServiceError(service, 'bad-response', 'Response was not JSON')
  }
}

const MESSAGES: Record<Service, Partial<Record<FailureKind, string>> & { fallback: string }> = {
  routing: {
    offline: "Can't reach the routing service. Check your connection and try again.",
    'rate-limited': 'The routing service is busy. Wait a minute and try again.',
    server: 'The routing service is having trouble right now. Try again in a bit.',
    'no-route': "Couldn't find a walking route there. Try moving a dot onto a street or path.",
    fallback: 'Something went wrong finding a route. Try again.',
  },
  geocoding: {
    offline: "Can't reach address search. Check your connection.",
    'rate-limited': 'Address search is busy. Pause a moment, then keep typing.',
    fallback: "Address search isn't working right now. You can switch to Draw and tap your route instead.",
  },
  data: {
    offline: "Couldn't load the signal data. Check your connection and reload the page.",
    fallback: "Couldn't load the signal data. Reload the page to try again.",
  },
}

/** A message for people, not developers. */
export function friendlyMessage(e: unknown, service: Service): string {
  const messages = MESSAGES[service]
  if (e instanceof ServiceError) return messages[e.kind] ?? messages.fallback
  return messages.fallback
}
