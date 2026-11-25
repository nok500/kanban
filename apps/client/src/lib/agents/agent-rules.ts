import type { Board, Card, Column } from "@kanban/core"

export type AgentName = "agy" | "claude" | "pi"

const AGENTS = new Set<string>(["agy", "claude", "pi"])
const INLINE_AGENT_RE = /(?:^|\s)#(agy|claude|pi)(?=\s|$)/i

/** The agent a card is tagged for (a tag, or `#agy` in the body), as the server reads it. */
export function cardAgent(card: Pick<Card, "tags" | "body">): AgentName | null {
  const tag = card.tags.map((t) => t.toLowerCase()).find((t) => AGENTS.has(t))
  if (tag) return tag as AgentName
  const inline = INLINE_AGENT_RE.exec(card.body)?.[1]
  return inline ? (inline.toLowerCase() as AgentName) : null
}

export const isAnaliseColumn = (column: Pick<Column, "title">) =>
  column.title.trim().toLowerCase() === "analise"

/** Already analysed: the agent leaves this marker on the card. */
export const isProcessed = (card: Pick<Card, "body">) =>
  /process as job-id:/i.test(card.body)

/** Docs cards carrying at least one attachment: the CVs an agent can use. */
export function cvCards(board: Board): Card[] {
  const docs = new Set(
    board.columns
      .filter((c) => !c.deletedAt && c.title.trim().toLowerCase() === "docs")
      .map((c) => c.id)
  )
  return board.cards
    .filter(
      (c) => !c.deletedAt && docs.has(c.columnId) && c.attachments.length > 0
    )
    .sort((a, b) =>
      a.position < b.position ? -1 : a.position > b.position ? 1 : 0
    )
}
