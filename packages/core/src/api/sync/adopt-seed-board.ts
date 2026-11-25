import { COLUMN_GROUPS } from "@doska/contract"
import type { Card, Column, Dashboard } from "../../types"
import { CARDS, COLUMNS } from "../constants"
import { db } from "../db/db"
import { stamp } from "./hlc"
import { touchColumn } from "./touch"

/**
 * The seeded "Default" board (see `seed()`) is written with `updatedAt: 0` and
 * never marked dirty, so a device that never touches it never pushes it — and
 * a new device can't resurrect a Default board deleted elsewhere. But once it
 * is used, only the edited cards and columns would sync: the server would hold
 * cards on a board it has no record of, and miss the untouched columns (which
 * is where an agent looks for Docs, Follow-up, Nay).
 *
 * So on the first edit to such a board, this stamps the board and its still
 * unstamped columns and marks them dirty too: a seed board in use syncs whole.
 */
export async function adoptSeedBoard(
  store: string,
  id: string,
  markDirty: (store: "dashboards" | "columns", id: string) => void
): Promise<boolean> {
  const boardId = await boardOf(store, id)
  if (!boardId || adopting.has(boardId)) return false

  adopting.add(boardId)
  try {
    const board = await db.getDashboard(boardId)
    // Stamped once already, or deleted: nothing to adopt.
    if (!board || board.updatedAt !== 0 || board.deletedAt != null) return false

    const at = stamp()
    const stamped: Dashboard = { ...board, updatedAt: at }
    await db.setDashboard(stamped)
    markDirty("dashboards", board.id)

    const columns = (await db.getColumns()).filter(
      (c) => c.dashboardId === boardId && c.updatedAt === 0
    )
    for (const column of columns) {
      await db.setColumn(touchColumn(column, COLUMN_GROUPS, at))
      markDirty("columns", column.id)
    }
    return true
  } finally {
    adopting.delete(boardId)
  }
}

/** Boards being adopted right now, so a burst of edits adopts once. */
const adopting = new Set<string>()

async function boardOf(store: string, id: string): Promise<string | null> {
  if (store === COLUMNS) {
    const column: Column | undefined = await db.getColumn(id)
    return column?.dashboardId ?? null
  }
  if (store === CARDS) {
    const card: Card | undefined = await db.getCard(id)
    if (!card) return null
    const column = await db.getColumn(card.columnId)
    return column?.dashboardId ?? null
  }
  return null
}
