import type { ReactNode } from "react"
import type { Card, Column } from "@kanban/core"
import { FileWarning } from "lucide-react"
import {
  cardAgent,
  isAnaliseColumn,
  isProcessed,
} from "@/lib/agents/agent-rules"
import { useAgentRules } from "@/providers/agent-rules/agent-rules-context"

/**
 * On a card waiting in an LLM-enabled Analise column: what it still needs
 * before the agent picks it up (a CV in Docs, or a CV picked for it).
 */
export function useAgentCardNote(card: Card, column: Column): ReactNode {
  const rules = useAgentRules()
  if (!rules?.available || !isAnaliseColumn(column)) return undefined
  if (!rules.isLlmColumn(column.id) || isProcessed(card) || !cardAgent(card)) {
    return undefined
  }
  if (rules.cvs.length === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <FileWarning className="size-3.5" />
        No CV in Docs
      </span>
    )
  }
  if (rules.cvs.length === 1 || rules.chosenCv(card.id)) return undefined
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        rules.pickCv(card)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex items-center gap-1 rounded text-xs text-amber-600 hover:underline dark:text-amber-400"
    >
      <FileWarning className="size-3.5" />
      Choose CV
    </button>
  )
}
