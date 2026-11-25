import { CARD_GROUPS } from "@kanban/contract"
import {
  BOARD_COLUMNS,
  BUILTIN_BOARD_TEMPLATES,
  builtinTemplateColumns,
  isBuiltinTemplate,
} from "../../seed"
import type { Column } from "../../types"
import { db } from "../db/db"
import { newId } from "./new-id"
import { sync } from "../sync"
import { stamp } from "../sync/hlc"
import { touchCard } from "../sync/touch"
import { live } from "./live"

/**
 * Adds the default columns to a board. With `templateId`: a built-in
 * template's columns (`builtin:…`), or a copy of that board's columns and
 * cards.
 */
export async function fillBoard(id: string, templateId?: string) {
  const builtin = templateId
    ? BUILTIN_BOARD_TEMPLATES.find((t) => t.id === templateId)
    : undefined
  if (templateId && isBuiltinTemplate(templateId) && !builtin) {
    throw new Error(`Unknown built-in template ${templateId}`)
  }
  const sourceColumns: Column[] = builtin
    ? builtinTemplateColumns(builtin)
    : templateId
      ? (await db.getColumns()).filter(
          (c) => c.dashboardId === templateId && live(c)
        )
      : BOARD_COLUMNS
  const columnIds = new Map<string, string>()

  await Promise.all(
    sourceColumns.map(async (source) => {
      const column = {
        ...source,
        id: newId("col"),
        dashboardId: id,
        updatedAt: stamp(),
        deletedAt: null,
        stamps: {},
      }
      columnIds.set(source.id, column.id)
      await db.setColumn(column)
      sync.markDirty("columns", column.id)
    })
  )

  if (!templateId || builtin) return
  const cards = (await db.getCards()).filter(
    (c) => live(c) && columnIds.has(c.columnId)
  )
  await Promise.all(
    cards.map(async (source) => {
      const card = touchCard(
        {
          ...source,
          id: newId("card"),
          columnId: columnIds.get(source.columnId) ?? "",
          number: null,
          users: [],
          attachments: [],
          template: false,
          bodyConflict: null,
          updatedAt: 0,
          stamps: {},
        },
        CARD_GROUPS
      )
      await db.setCard(card)
      sync.markDirty("cards", card.id)
    })
  )
}
