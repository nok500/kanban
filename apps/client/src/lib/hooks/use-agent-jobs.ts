import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { apiUrl, appFetch } from "@doska/core"
import { useAuth } from "@/lib/hooks"

export interface AgentJobInfo {
  jobId: string
  agent: string
  title: string
  cvCount: number
  pid: number | null
  status: "running" | "completed" | "failed" | string
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  logPath: string
}

const QUERY_KEY = ["agents", "jobs"] as const

/** Polls `/api/agents/jobs` (2s while any job is running, 10s when idle). */
export function useAgentJobs() {
  const { authed } = useAuth()
  const qc = useQueryClient()

  useEffect(() => {
    if (authed !== true) return
    const onStart = () => void qc.invalidateQueries({ queryKey: QUERY_KEY })
    window.addEventListener("kanban:agent-job-started", onStart)
    return () => window.removeEventListener("kanban:agent-job-started", onStart)
  }, [authed, qc])

  return useQuery({
    queryKey: QUERY_KEY,
    enabled: authed === true,
    queryFn: async (): Promise<AgentJobInfo[]> => {
      const res = await appFetch(apiUrl("/api/agents/jobs"))
      if (!res.ok) return []
      const json = (await res.json()) as { jobs?: AgentJobInfo[] }
      return json.jobs ?? []
    },
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === "running") ? 2000 : 10_000,
  })
}
