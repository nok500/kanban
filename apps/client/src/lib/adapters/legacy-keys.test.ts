import { describe, expect, it } from "vitest"
import { migrateLegacyKeys } from "./legacy-keys"

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe("migrateLegacyKeys", () => {
  it("moves doska: keys to kanban: and drops the old ones", () => {
    const storage = memoryStorage({
      "doska:last-board": "b1",
      "doska:board-views": "{}",
      "deck:server-url": "x",
    })
    migrateLegacyKeys(storage)
    expect(storage.getItem("kanban:last-board")).toBe("b1")
    expect(storage.getItem("kanban:board-views")).toBe("{}")
    expect(storage.getItem("doska:last-board")).toBeNull()
    expect(storage.getItem("deck:server-url")).toBe("x")
  })

  it("keeps a value already saved under the new key", () => {
    const storage = memoryStorage({
      "doska:last-board": "old",
      "kanban:last-board": "new",
    })
    migrateLegacyKeys(storage)
    expect(storage.getItem("kanban:last-board")).toBe("new")
    expect(storage.length).toBe(1)
  })
})
