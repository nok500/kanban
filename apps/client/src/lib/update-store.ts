import { useSyncExternalStore } from "react"
import { checkServiceWorkerUpdate, registerServiceWorker } from "./pwa"

// Shared result of the update check, so multiple parts of the UI (the toast,
// the settings section) react to the same state without each running its own.

/** A newer build is waiting in the service worker, or there is none. */
export type UpdateState =
  | { status: "none" }
  | { status: "available"; install: () => Promise<void> }

const CHECK_INTERVAL_MS = 15 * 60 * 1000

let state: UpdateState = { status: "none" }
let started = false
const listeners = new Set<() => void>()

function set(next: UpdateState) {
  state = next
  for (const listener of listeners) listener()
}

/** Registers the service worker on first use and re-checks every 15 minutes. */
export function startUpdateCheck(): void {
  if (started) return
  started = true
  registerServiceWorker((install) => set({ status: "available", install }))
  setInterval(() => void runUpdateCheck(), CHECK_INTERVAL_MS)
}

/**
 * Asks the browser to re-fetch the service worker. A waiting worker announces
 * itself through the registerServiceWorker callback, which publishes the state.
 */
export async function runUpdateCheck(): Promise<void> {
  await checkServiceWorkerUpdate()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe to the shared update state (kicks off the check on first use). */
export function useUpdateState(): UpdateState {
  startUpdateCheck()
  return useSyncExternalStore(subscribe, () => state)
}
