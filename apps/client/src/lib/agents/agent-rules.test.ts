import { describe, expect, test } from "vitest"
import type { Board, Card, Column } from "@kanban/core"
import { cardAgent, cvCards, isAnaliseColumn, isProcessed } from "./agent-rules"

const column = (id: string, title: string): Column =>
  ({ id, title, deletedAt: null }) as Column
const card = (id: string, columnId: string, extra: Partial<Card> = {}): Card =>
  ({
    id,
    columnId,
    position: "a0",
    tags: [],
    body: "",
    attachments: [],
    deletedAt: null,
    ...extra,
  }) as Card
const file = (name: string) => ({
  id: name,
  key: name,
  name,
  mime: "",
  size: 1,
})

describe("cardAgent", () => {
  test("reads the agent tag, any case", () => {
    expect(cardAgent(card("1", "c", { tags: ["remote", "PI"] }))).toBe("pi")
  })
  test("reads an inline #tag in the body", () => {
    expect(cardAgent(card("1", "c", { body: "Acme JD #claude" }))).toBe(
      "claude"
    )
  })
  test("null without one", () => {
    expect(cardAgent(card("1", "c", { tags: ["remote"], body: "#agyx" }))).toBe(
      null
    )
  })
})

test("Analise matches by title only, any case", () => {
  expect(isAnaliseColumn({ title: " analise " })).toBe(true)
  expect(isAnaliseColumn({ title: "Analysis" })).toBe(false)
})

test("a card with the job marker counts as processed", () => {
  expect(isProcessed({ body: "...\nprocess as job-id: 4" })).toBe(true)
})

test("cvCards: Docs cards with attachments, in column order", () => {
  const board: Board = {
    columns: [column("docs", "Docs"), column("jds", "JDs")],
    cards: [
      card("b", "docs", { position: "a2", attachments: [file("b.pdf")] }),
      card("empty", "docs", { position: "a0" }),
      card("a", "docs", { position: "a1", attachments: [file("a.pdf")] }),
      card("gone", "docs", { attachments: [file("x.pdf")], deletedAt: 5 }),
      card("jd", "jds", { attachments: [file("jd.pdf")] }),
    ],
  }
  expect(cvCards(board).map((c) => c.id)).toEqual(["a", "b"])
})
