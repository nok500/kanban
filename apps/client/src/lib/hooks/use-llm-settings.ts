import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiUrl, appFetch } from "@kanban/core"

export type LlmAgent = "claude" | "agy" | "pi"
export type AgentMode = "installed" | "apiKey"

/** What agent-runner found for one CLI (see runner.py `agent_status`). */
export interface AgentRunnerStatus {
  ok: boolean
  binary: string | null
  version: string | null
  error: string | null
  /** Config the installed login needs that isn't mounted. */
  missing: string[]
  /** An API key already set in the runner's own environment. */
  envApiKey?: boolean
}

export interface AgentEntry {
  agent: LlmAgent
  /** null for pi, which has no login of its own. */
  mode: AgentMode | null
  hasKey: boolean
  /** pi: the LOCAL_PROVIDERS entry it's pinned to; null = first online. */
  provider: string | null
  status: AgentRunnerStatus | null
}

/** A LOCAL_PROVIDERS entry from the runner's env, probed just now. */
export interface LocalProvider {
  name: string
  baseUrl: string
  online: boolean
  /** The model pi would ask for there (PI_MODEL, a loaded one, or the first). */
  model: string | null
  error?: string
}

export interface LlmSettings {
  runnerReachable: boolean
  sessions: boolean
  agents: AgentEntry[]
  providers: LocalProvider[]
}

const KEY = ["llm", "settings"] as const

export function useLlmSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async (): Promise<LlmSettings> => {
      const res = await appFetch(apiUrl("/api/llm"))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as LlmSettings
    },
    staleTime: 30_000,
  })
}

export function useSavePiProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (provider: string | null) => {
      const res = await appFetch(apiUrl("/api/llm/agents/pi"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSaveAgentSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      agent: "claude" | "agy"
      mode: AgentMode
      /** Omitted: keep the stored key. Empty string: remove it. */
      apiKey?: string
    }) => {
      const res = await appFetch(apiUrl(`/api/llm/agents/${input.agent}`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: input.mode, apiKey: input.apiKey }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
