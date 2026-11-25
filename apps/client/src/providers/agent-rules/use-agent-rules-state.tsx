import { useMemo, useState } from "react"
import type { Board, Card } from "@kanban/core"
import { useAuth } from "@/lib/hooks"
import {
  cardAgent,
  cvCards,
  isAnaliseColumn,
  isProcessed,
} from "@/lib/agents/agent-rules"
import { useBoardAgentRules } from "@/lib/hooks/use-board-agent-rules"
import { CvPickerDialog } from "@/components/agents/cv-picker-dialog"
import type { AgentRules } from "./agent-rules-context"

/**
 * Builds the board's agent rules. The caller (the deck) renders `picker` and
 * wraps the board in `AgentRulesCtx.Provider` with `rules`, and calls
 * `afterDrop` once a card lands in a column.
 */
export function useAgentRulesState(boardId: string, board: Board | undefined) {
  const { authed } = useAuth()
  const available = authed === true
  const { rules, toggleColumn, setCardCv, error } = useBoardAgentRules(
    boardId,
    available
  )
  const [picking, setPicking] = useState<Card | null>(null)

  const value = useMemo((): AgentRules => {
    const cvs = board ? cvCards(board) : []
    const llm = new Set(rules?.llmColumns ?? [])
    return {
      available,
      isLlmColumn: (columnId) => llm.has(columnId),
      toggleLlmColumn: toggleColumn,
      cvs,
      chosenCv: (cardId) => {
        const id = rules?.cardCvs[cardId]
        return cvs.find((c) => c.id === id) ?? null
      },
      pickCv: setPicking,
      error,
    }
  }, [available, board, rules, toggleColumn, error])

  /**
   * A card was dropped into `toColumnId`: entering an LLM-on Analise column,
   * tagged for an agent, with several CVs in Docs, it asks which one to use.
   */
  const afterDrop = (card: Card, fromColumnId: string, toColumnId: string) => {
    if (!value.available || fromColumnId === toColumnId) return
    const column = board?.columns.find((c) => c.id === toColumnId)
    if (!column || !isAnaliseColumn(column) || !value.isLlmColumn(column.id)) {
      return
    }
    if (isProcessed(card) || !cardAgent(card)) return
    if (value.cvs.length > 1) setPicking(card)
  }

  const picker = (
    <CvPickerDialog
      card={picking}
      cvs={value.cvs}
      chosen={picking ? value.chosenCv(picking.id) : null}
      onPick={(cv) => {
        if (picking) setCardCv(picking.id, cv.id)
        setPicking(null)
      }}
      onClose={() => setPicking(null)}
    />
  )

  return { rules: value, afterDrop, picker }
}
