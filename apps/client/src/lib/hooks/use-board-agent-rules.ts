import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiUrl, appFetch } from "@kanban/core"

/** A board's agent rules as the server keeps them (routes/agent-board.ts). */
export interface BoardAgentRules {
  /** Analise columns with the LLM toggle on. */
  llmColumns: string[]
  /** JD card id → the Docs card whose CV it is analysed against. */
  cardCvs: Record<string, string>
}

const key = (boardId: string) => ["agents", "board", boardId] as const
const base = (boardId: string) =>
  `/api/agents/boards/${encodeURIComponent(boardId)}`

async function put(path: string, body: unknown): Promise<void> {
  const res = await appFetch(apiUrl(path), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(json?.error ?? `HTTP ${res.status}`)
  }
}

export function useBoardAgentRules(boardId: string, enabled: boolean) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: key(boardId),
    enabled,
    queryFn: async (): Promise<BoardAgentRules> => {
      const res = await appFetch(apiUrl(base(boardId)))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as BoardAgentRules
    },
    staleTime: 15_000,
  })

  const patch = (update: (rules: BoardAgentRules) => BoardAgentRules) =>
    qc.setQueryData<BoardAgentRules>(key(boardId), (old) =>
      update(old ?? { llmColumns: [], cardCvs: {} })
    )

  const toggleColumn = useMutation({
    mutationFn: ({
      columnId,
      enabled,
    }: {
      columnId: string
      enabled: boolean
    }) =>
      put(`${base(boardId)}/columns/${encodeURIComponent(columnId)}`, {
        enabled,
      }),
    onMutate: ({ columnId, enabled }) =>
      patch((r) => ({
        ...r,
        llmColumns: enabled
          ? [...new Set([...r.llmColumns, columnId])]
          : r.llmColumns.filter((id) => id !== columnId),
      })),
    onSettled: () => qc.invalidateQueries({ queryKey: key(boardId) }),
  })

  const setCardCv = useMutation({
    mutationFn: ({ cardId, cvCardId }: { cardId: string; cvCardId: string }) =>
      put(`${base(boardId)}/cards/${encodeURIComponent(cardId)}/cv`, {
        cvCardId,
      }),
    onMutate: ({ cardId, cvCardId }) =>
      patch((r) => ({ ...r, cardCvs: { ...r.cardCvs, [cardId]: cvCardId } })),
    onSettled: () => qc.invalidateQueries({ queryKey: key(boardId) }),
  })

  return {
    rules: query.data ?? null,
    toggleColumn: (columnId: string, enabled: boolean) =>
      toggleColumn.mutate({ columnId, enabled }),
    setCardCv: (cardId: string, cvCardId: string) =>
      setCardCv.mutate({ cardId, cvCardId }),
    error:
      (toggleColumn.error ?? setCardCv.error) instanceof Error
        ? (toggleColumn.error ?? setCardCv.error)!.message
        : null,
  }
}
