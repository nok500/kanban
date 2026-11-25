import type { ReactNode } from "react"
import { AgentRulesCtx, type AgentRules } from "./agent-rules-context"

export function AgentRulesProvider({
  rules,
  children,
}: {
  rules: AgentRules
  children: ReactNode
}) {
  return (
    <AgentRulesCtx.Provider value={rules}>{children}</AgentRulesCtx.Provider>
  )
}
