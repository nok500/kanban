import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiUrl, appFetch } from "@kanban/core"

export interface ChatModelInfo {
  id: string
  /** llama.cpp router mode: `loaded` / `unloaded` / `loading`; null otherwise. */
  status: string | null
}

export type ChatEndpointSource = "config" | "ui"

/** A chat target as any signed-in user sees it: no URL, no key. */
export interface ChatEndpointStatus {
  id: string
  name: string
  source: ChatEndpointSource
  uiUrl: string | null
  reachable: boolean
  models: ChatModelInfo[]
  error?: string
}

/** An endpoint as an admin manages it. The key itself never comes back. */
export interface ChatEndpointConfig {
  id: string
  name: string
  source: ChatEndpointSource
  apiUrl: string
  uiUrl: string | null
  hasKey: boolean
}

export interface ChatEndpointInput {
  name: string
  apiUrl: string
  uiUrl: string
  /** Omitted: keep the stored key. Empty string: remove it. */
  apiKey?: string
}

export interface ChatEndpointTestResult {
  apiUrl: string
  reachable: boolean
  models: ChatModelInfo[]
  error?: string
}

const STATUS_KEY = ["chat", "endpoints"] as const
const CONFIG_KEY = ["chat", "endpoints", "config"] as const

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await appFetch(apiUrl(path), {
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  })
  if (res.status === 204) return undefined as T
  const json = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
  return json as T
}

/** The llama.cpp instances the server proxies to, with their models. */
export function useChatEndpoints(enabled: boolean) {
  return useQuery({
    queryKey: STATUS_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: async () =>
      (
        await request<{ endpoints?: ChatEndpointStatus[] }>(
          "/api/chat/endpoints"
        )
      ).endpoints ?? [],
  })
}

/** Admin: every endpoint with its URLs, for the settings editor. */
export function useChatEndpointConfig(enabled: boolean) {
  return useQuery({
    queryKey: CONFIG_KEY,
    enabled,
    queryFn: async () =>
      (
        await request<{ endpoints?: ChatEndpointConfig[] }>(
          "/api/chat/endpoints/config"
        )
      ).endpoints ?? [],
  })
}

function useInvalidateEndpoints() {
  const qc = useQueryClient()
  // A prefix match: refreshes both the chat list and the admin config.
  return () => qc.invalidateQueries({ queryKey: STATUS_KEY })
}

export function useSaveChatEndpoint() {
  const invalidate = useInvalidateEndpoints()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ChatEndpointInput }) =>
      request<ChatEndpointConfig>(
        id
          ? `/api/chat/endpoints/${encodeURIComponent(id)}`
          : "/api/chat/endpoints",
        { method: id ? "PATCH" : "POST", body: JSON.stringify(input) }
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteChatEndpoint() {
  const invalidate = useInvalidateEndpoints()
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/chat/endpoints/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  })
}

export function useTestChatEndpoint() {
  return useMutation({
    mutationFn: (input: { id?: string; apiUrl: string; apiKey?: string }) =>
      request<ChatEndpointTestResult>("/api/chat/endpoints/test", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  })
}
