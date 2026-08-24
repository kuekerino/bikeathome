/**
 * Rides kept in the browser, across restarts and tabs.
 *
 * IndexedDB rather than cookies or local storage, for a reason worth writing
 * down: a cookie holds about 4 KB and is sent to the server on every request,
 * and local storage holds about 5 MB in total. A forty-minute ride is roughly
 * 2400 samples and several hundred kilobytes, so cookies are out by three
 * orders of magnitude and local storage would fill after a handful of rides —
 * taking the settings down with it.
 *
 * Two stores, not one. Listing the history must not have to read every sample
 * of every ride, so summaries live apart from the tracks and the list stays
 * cheap however many rides pile up.
 *
 * Still nothing leaves the browser.
 */

import type { RideSample } from '../ride/recorder'
import type { Workout } from '../workout/model'
import type { RideSummary } from './summary'

const DB_NAME = 'bikeathome'
const DB_VERSION = 1
const RIDES = 'rides'
const TRACKS = 'tracks'

export interface StoredTrack {
  id: number
  samples: RideSample[]
  /** Kept so a session can be ridden again, not just read. */
  workout: Workout | null
}

/** Private browsing and some locked-down profiles have no IndexedDB at all. */
export function historyAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  open ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RIDES)) db.createObjectStore(RIDES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the ride history.'))
    request.onblocked = () => reject(new Error('Another tab is holding an older ride history.'))
  })
  return open
}

function run<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (stores: IDBObjectStore[]) => IDBRequest<T> | null,
): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames]
        const transaction = db.transaction(names, mode)
        const request = work(names.map((name) => transaction.objectStore(name)))

        let value: T | undefined
        if (request) request.onsuccess = () => (value = request.result)
        // Resolving on the transaction rather than the request: a write is not
        // durable until the transaction commits, and reporting success earlier
        // would be a lie a crash could expose.
        transaction.oncomplete = () => resolve(value)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('History write aborted.'))
      }),
  )
}

/**
 * Asks the browser not to evict this data under storage pressure.
 *
 * Without it a browser short of space may quietly drop the whole database, and
 * a training log that can vanish is not a training log. Chrome grants it
 * silently for a site the rider uses often; a refusal is not an error, just a
 * weaker guarantee.
 */
let persistenceAsked = false
async function askToPersist(): Promise<void> {
  if (persistenceAsked || typeof navigator === 'undefined' || !navigator.storage?.persist) return
  persistenceAsked = true
  try {
    if (!(await navigator.storage.persisted?.())) await navigator.storage.persist()
  } catch {
    // Nothing to fall back to, and nothing worth interrupting a ride for.
  }
}

/** Writes a ride, replacing any earlier save of the same one. */
export async function saveRide(
  summary: RideSummary,
  samples: readonly RideSample[],
  workout: Workout | null,
): Promise<void> {
  void askToPersist()
  await run([RIDES, TRACKS], 'readwrite', ([rides, tracks]) => {
    rides?.put(summary)
    tracks?.put({ id: summary.id, samples: [...samples], workout } satisfies StoredTrack)
    return null
  })
}

/** Newest first, which is the order anyone reads a training log in. */
export async function listRides(): Promise<RideSummary[]> {
  const all = await run<RideSummary[]>(RIDES, 'readonly', ([rides]) => rides!.getAll())
  return (all ?? []).sort((a, b) => b.startedAt - a.startedAt)
}

export async function loadTrack(id: number): Promise<StoredTrack | undefined> {
  return run<StoredTrack>(TRACKS, 'readonly', ([tracks]) => tracks!.get(id))
}

export async function deleteRide(id: number): Promise<void> {
  void askToPersist()
  await run([RIDES, TRACKS], 'readwrite', ([rides, tracks]) => {
    rides?.delete(id)
    tracks?.delete(id)
    return null
  })
}

export async function clearRides(): Promise<void> {
  void askToPersist()
  await run([RIDES, TRACKS], 'readwrite', ([rides, tracks]) => {
    rides?.clear()
    tracks?.clear()
    return null
  })
}

/** Roughly how much room is left, when the browser will say. */
export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usedMb: usage / 1e6, quotaMb: quota / 1e6 }
}
