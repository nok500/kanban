import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiUrl, appFetch } from "@kanban/core"

export type SessionAgent = "pi" | "agy" | "claude"

export interface AgentSessionTurn {
  role: "user" | "assistant"
  content: string
  at: number
  /** The job's own prompt (JD, CVs, instructions), as opposed to a follow-up. */
  kind?: "job"
  /** The model's thinking before this answer, when the CLI keeps it (pi). */
  reasoning?: string
  error?: string
}

/** The session agent-runner kept for a card's last job. */
export interface AgentSession {
  id: string
  agent: SessionAgent
  cardId: string
  title: string
  createdAt: number
  updatedAt: number
  /** False when the CLI's own session could not be found: shown, not continued. */
  resumable: boolean
  busy: boolean
  /** pi: the LOCAL_PROVIDERS entry and model it last ran on. */
  provider?: { name: string; model: string }
  turns: AgentSessionTurn[]
}

const sessionUrl = (cardId: string) =>
  apiUrl(`/api/cards/${encodeURIComponent(cardId)}/agent-session`)

const queryKey = (cardId: string) => ["agent-session", cardId] as const

async function errorText(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: unknown }
    if (typeof json.error === "string") return json.error
  } catch {
    // fall through
  }
  return `Request failed (HTTP ${res.status})`
}

/** The card's agent session, if a job ran on it, and a way to continue it. */
export function useAgentSession(cardId: string) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: queryKey(cardId),
    queryFn: async (): Promise<AgentSession | null> => {
      const res = await appFetch(sessionUrl(cardId))
      if (!res.ok) return null
      const data = (await res.json()) as { session?: AgentSession | null }
      return data.session ?? null
    },
    staleTime: 10_000,
  })

  const mutation = useMutation({
    mutationFn: async (message: string): Promise<AgentSession> => {
      const res = await appFetch(`${sessionUrl(cardId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      })
      const data = (await res.json().catch(() => null)) as {
        session?: AgentSession
        error?: string
      } | null
      // A failed run still comes back with the session, its error recorded.
      if (data?.session) return data.session
      throw new Error(data?.error ?? (await errorText(res)))
    },
    onSuccess: (session) => qc.setQueryData(queryKey(cardId), session),
  })

  return {
    session: query.data ?? null,
    loading: query.isLoading,
    /** The message on its way, shown until the agent answers. */
    pending: mutation.isPending ? mutation.variables : null,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    send: (message: string) => mutation.mutate(message),
  }
}
