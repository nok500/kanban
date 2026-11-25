import { useSyncExternalStore } from "react"
import type { SyncState } from "@kanban/sync"
import { sync } from "@kanban/core"

/**
 * Subscribes a component to the sync engine's live state (in-flight status and
 * the count of unsaved changes). Re-renders only on a real transition, since the
 * engine hands back a stable snapshot between changes.
 */
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(sync.subscribe, sync.getState)
}
