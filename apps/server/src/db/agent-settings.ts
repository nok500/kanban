import { getDB } from "./get-db"
import { agentSettings } from "./schema"

export type AgentMode = "installed" | "apiKey"

export interface StoredAgentSetting {
  agent: string
  mode: AgentMode
  apiKey: string | null
  provider: string | null
}

export async function listAgentSettings(): Promise<StoredAgentSetting[]> {
  const rows = await getDB()
    .select({
      agent: agentSettings.agent,
      mode: agentSettings.mode,
      apiKey: agentSettings.apiKey,
      provider: agentSettings.provider,
    })
    .from(agentSettings)
  return rows.map((r) => ({
    ...r,
    mode: r.mode === "apiKey" ? "apiKey" : "installed",
  }))
}

/** Fields left undefined keep their stored value; null clears them. */
export async function saveAgentSetting(
  agent: string,
  patch: {
    mode?: AgentMode
    apiKey?: string | null
    provider?: string | null
  }
): Promise<void> {
  const now = Date.now()
  const set: Partial<typeof agentSettings.$inferInsert> = { updatedAt: now }
  if (patch.mode !== undefined) set.mode = patch.mode
  if (patch.apiKey !== undefined) set.apiKey = patch.apiKey
  if (patch.provider !== undefined) set.provider = patch.provider
  await getDB()
    .insert(agentSettings)
    .values({
      agent,
      mode: patch.mode ?? "installed",
      apiKey: patch.apiKey ?? null,
      provider: patch.provider ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: agentSettings.agent, set })
}
