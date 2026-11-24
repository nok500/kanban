import type { Card, Column } from "../../types"
import { db } from "../db/db"
import { appFetch } from "../fetch"
import { apiUrl } from "../server"
import { updateCard } from "./update-card"

const AGENT_TAGS = new Set(["agy", "claude"])
const INLINE_AGENT_RE = /(?:^|\s)#(agy|claude)(?=\s|$)/i

function detectAgent(card: Card): string | null {
  const fromTags = (card.tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .find((t) => AGENT_TAGS.has(t))
  if (fromTags) return fromTags

  const match = INLINE_AGENT_RE.exec(card.body ?? "")
  return match ? match[1].toLowerCase() : null
}

/**
 * Triggers the selected agent CLI (`agy` or `claude`) when a card carrying
 * that tag (in `card.tags` or inline `#agy`/`#claude` in body) is moved into
 * the `Analise` column, and appends the job-id to the card body.
 */
export function triggerAgentIfProcess(card: Card, toColumn: Column): void {
  if (toColumn.title.trim().toLowerCase() !== "analise") return
  const agent = detectAgent(card)
  if (!agent) return

  void (async () => {
    try {
      const res = await appFetch(apiUrl("/api/agents/run"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boardId: toColumn.dashboardId,
          cardId: card.id,
          title: card.title,
          body: card.body,
          agent,
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { jobId?: string | number }
      if (data.jobId == null) return

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kanban:agent-job-started"))
      }

      const latest = await db.getCard(card.id)
      if (!latest) return
      const marker = `process as job-id: ${data.jobId} (${agent})`
      if (latest.body.includes(marker)) return
      const nextBody = latest.body.trimEnd()
        ? `${latest.body.trimEnd()}\n\n${marker}`
        : marker
      await updateCard(card.id, { body: nextBody })
    } catch {
      // Ignore transient network errors; server logs capture dispatch failures.
    }
  })()
}
