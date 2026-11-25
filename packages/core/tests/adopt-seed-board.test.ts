import { beforeEach, describe, expect, it } from "vitest"
import { CARDS, COLUMNS, DASHBOARDS } from "../src/api/constants"
import { adoptSeedBoard } from "../src/api/sync/adopt-seed-board"
import { installMemoryRuntime, rows } from "./memory-runtime"

const board = (
  id: string,
  updatedAt: number,
  deletedAt: number | null = null
) => ({
  id,
  title: id,
  position: "a0",
  sort: [],
  tagColors: {},
  template: false,
  updatedAt,
  deletedAt,
})
const column = (id: string, dashboardId: string, updatedAt: number) => ({
  id,
  title: id,
  position: "a0",
  dashboardId,
  collapsed: false,
  done: false,
  color: "",
  stamps: {},
  updatedAt,
  deletedAt: null,
})
const card = (id: string, columnId: string) => ({
  id,
  columnId,
  title: id,
  body: "",
  updatedAt: 5,
  deletedAt: null,
})

/** The seeded Default board: everything at 0, one column already edited. */
function seedDefault() {
  rows.set(`${DASHBOARDS}/welcome`, board("welcome", 0))
  for (const id of ["welcome-jds", "welcome-followup", "welcome-docs"])
    rows.set(`${COLUMNS}/${id}`, column(id, "welcome", 0))
  rows.set(
    `${COLUMNS}/welcome-analise`,
    column("welcome-analise", "welcome", 9)
  )
  rows.set(`${CARDS}/c1`, card("c1", "welcome-jds"))
}

function recorder() {
  const marked: string[] = []
  return {
    marked,
    mark: (store: string, id: string) => void marked.push(`${store}/${id}`),
  }
}

beforeEach(installMemoryRuntime)

describe("adoptSeedBoard", () => {
  it("on a first edit, stamps the seed board and its unstamped columns and marks them dirty", async () => {
    seedDefault()
    const r = recorder()

    expect(await adoptSeedBoard(CARDS, "c1", r.mark)).toBe(true)

    expect(r.marked.sort()).toEqual([
      "columns/welcome-docs",
      "columns/welcome-followup",
      "columns/welcome-jds",
      "dashboards/welcome",
    ])
    const stamped = rows.get(`${DASHBOARDS}/welcome`) as { updatedAt: number }
    expect(stamped.updatedAt).toBeGreaterThan(0)
    // Every group gets the same stamp, so the server takes the whole column.
    const followup = rows.get(`${COLUMNS}/welcome-followup`) as {
      updatedAt: number
      stamps: Record<string, number>
    }
    expect(followup.updatedAt).toBe(stamped.updatedAt)
    expect(
      Object.values(followup.stamps).every((s) => s === stamped.updatedAt)
    ).toBe(true)
    // The column the user already edited keeps its own version.
    expect(
      (rows.get(`${COLUMNS}/welcome-analise`) as { updatedAt: number })
        .updatedAt
    ).toBe(9)
  })

  it("adopts from a column edit too", async () => {
    seedDefault()
    const r = recorder()
    expect(await adoptSeedBoard(COLUMNS, "welcome-jds", r.mark)).toBe(true)
    expect(r.marked).toContain("dashboards/welcome")
  })

  it("adopts once: the board is stamped afterwards", async () => {
    seedDefault()
    const r = recorder()
    await adoptSeedBoard(CARDS, "c1", r.mark)
    const again = recorder()
    expect(await adoptSeedBoard(CARDS, "c1", again.mark)).toBe(false)
    expect(again.marked).toEqual([])
  })

  it("leaves boards that are already synced, deleted, or unknown alone", async () => {
    rows.set(`${DASHBOARDS}/real`, board("real", 7))
    rows.set(`${COLUMNS}/real-col`, column("real-col", "real", 0))
    rows.set(`${CARDS}/r1`, card("r1", "real-col"))
    rows.set(`${DASHBOARDS}/gone`, board("gone", 0, 3))
    rows.set(`${COLUMNS}/gone-col`, column("gone-col", "gone", 0))
    rows.set(`${CARDS}/g1`, card("g1", "gone-col"))
    const r = recorder()

    expect(await adoptSeedBoard(CARDS, "r1", r.mark)).toBe(false)
    expect(await adoptSeedBoard(CARDS, "g1", r.mark)).toBe(false)
    expect(await adoptSeedBoard(CARDS, "missing", r.mark)).toBe(false)
    expect(await adoptSeedBoard(DASHBOARDS, "real", r.mark)).toBe(false)
    expect(r.marked).toEqual([])
  })
})
