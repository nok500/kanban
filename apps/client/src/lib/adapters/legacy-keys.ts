const LEGACY_PREFIX = "doska:"
const PREFIX = "kanban:"

/**
 * One-time move of browser settings saved under the project's former
 * `doska:` key prefix to `kanban:`, so a renamed install keeps its last board,
 * board views, collapsed folders and the like. A key already set under the new
 * prefix wins. Safe to run on every load: once moved there is nothing left.
 */
export function migrateLegacyKeys(storage: Storage = localStorage): void {
  try {
    const legacy: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const next = PREFIX + key.slice(LEGACY_PREFIX.length)
      const value = storage.getItem(key)
      if (value !== null && storage.getItem(next) === null) {
        storage.setItem(next, value)
      }
      storage.removeItem(key)
    }
  } catch {
    // Storage unavailable (private mode, blocked context): nothing to move.
  }
}
