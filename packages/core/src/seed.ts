import type { Card, Column, Dashboard } from "./types"

/**
 * The board a fresh install opens on: Default board with 6 workflow columns.
 */
export const cards: Card[] = []

export const fallbackCard: Card = {
  id: "1",
  columnId: "1",
  position: "a0",
  number: null,
  deadline: null,
  priority: "",
  tags: [],
  users: [],
  attachments: [],
  template: false,
  stamps: {},
  bodyConflict: null,
  updatedAt: 0,
  deletedAt: null,
  title: "Untitled card",
  body: "",
}

/** Columns of the Default board. */
export const seedColumns: Column[] = [
  {
    id: "welcome-jds",
    title: "JDs",
    position: "a0",
    dashboardId: "welcome",
    collapsed: false,
    done: false,
    stamps: {},
    color: "",
    updatedAt: 0,
    deletedAt: null,
  },
  {
    id: "welcome-analise",
    title: "Analise",
    position: "a1",
    dashboardId: "welcome",
    collapsed: false,
    done: false,
    stamps: {},
    color: "amber",
    updatedAt: 0,
    deletedAt: null,
  },
  {
    id: "welcome-followup",
    title: "Follow-up",
    position: "a2",
    dashboardId: "welcome",
    collapsed: false,
    done: false,
    stamps: {},
    color: "green",
    updatedAt: 0,
    deletedAt: null,
  },
  {
    id: "welcome-nay",
    title: "Nay",
    position: "a3",
    dashboardId: "welcome",
    collapsed: false,
    done: true,
    stamps: {},
    color: "rose",
    updatedAt: 0,
    deletedAt: null,
  },
  {
    id: "welcome-docs",
    title: "Docs",
    position: "a4",
    dashboardId: "welcome",
    collapsed: false,
    done: false,
    stamps: {},
    color: "violet",
    updatedAt: 0,
    deletedAt: null,
  },
]

/** A board layout that ships with the app, listed on the Templates page. */
export interface BuiltinBoardTemplate {
  /** `builtin:<slug>`: never a board id, so `fillBoard` can tell them apart. */
  id: string
  title: string
  description: string
  columns: { title: string; color: string; done?: boolean }[]
}

export const BUILTIN_BOARD_TEMPLATES: BuiltinBoardTemplate[] = [
  {
    id: "builtin:job-search",
    title: "Job search",
    description:
      "JDs get analysed by an agent in Analise, then move to Follow-up or NAY.",
    columns: [
      { title: "JDs", color: "" },
      { title: "Analise", color: "amber" },
      { title: "Follow-up", color: "green" },
      { title: "Docs", color: "violet" },
      { title: "NAY", color: "rose", done: true },
      { title: "Applied", color: "blue" },
      { title: "Feedback", color: "teal" },
    ],
  },
  {
    id: "builtin:kanban",
    title: "Kanban",
    description: "A plain board for any work.",
    columns: [
      { title: "Backlog", color: "" },
      { title: "In progress", color: "amber" },
      { title: "Done", color: "green", done: true },
      { title: "Rejected", color: "rose", done: true },
    ],
  },
]

export const isBuiltinTemplate = (id: string) => id.startsWith("builtin:")

/** A built-in template's columns, positioned left to right, not yet on a board. */
export function builtinTemplateColumns(
  template: BuiltinBoardTemplate
): Column[] {
  return template.columns.map((c, i) => ({
    id: `${template.id}:${i}`,
    title: c.title,
    position: `a${i}`,
    dashboardId: "",
    collapsed: false,
    done: c.done ?? false,
    stamps: {},
    color: c.color,
    updatedAt: 0,
    deletedAt: null,
  }))
}

/** The columns a board gets from "Empty": the Job search layout. */
export const BOARD_COLUMNS: Column[] = builtinTemplateColumns(
  BUILTIN_BOARD_TEMPLATES[0]!
)

export const seedDashboards: Dashboard[] = [
  {
    id: "welcome",
    title: "Default",
    position: "a0",
    sort: [],
    tagColors: {},
    template: false,
    updatedAt: 0,
    deletedAt: null,
  },
]
