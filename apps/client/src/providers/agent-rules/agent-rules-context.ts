import { createContext, useContext } from "react"
import type { Card } from "@kanban/core"
/**
 * The open board's agent rules for its columns and cards: which Analise
 * columns run agents (LLM toggle), the CV cards in Docs, and which CV each JD
 * card uses. Hosts the CV picker.
 */
export interface AgentRules {
  /** Signed in to a server: the rules live there. */
  available: boolean
  isLlmColumn: (columnId: string) => boolean
  toggleLlmColumn: (columnId: string, enabled: boolean) => void
  /** The Docs cards that carry a CV, in column order. */
  cvs: Card[]
  /** The CV card picked for `cardId`, if any and still in Docs. */
  chosenCv: (cardId: string) => Card | null
  /** Asks which CV `card` should be analysed against. */
  pickCv: (card: Card) => void
  error: string | null
}

export const AgentRulesCtx = createContext<AgentRules | null>(null)

export const useAgentRules = () => useContext(AgentRulesCtx)
