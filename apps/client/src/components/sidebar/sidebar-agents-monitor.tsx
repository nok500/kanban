import { useCallback, useEffect, useState } from "react"
import { apiUrl, appFetch } from "@doska/core"
import { SidebarGroup, cn } from "@doska/ui-kit"
import { FiRefreshCw } from "react-icons/fi"
import { useAuth } from "@/lib/hooks"

interface AgentProcessInfo {
  pid: number
  state: string
  status: string
  cwd: string | null
}

interface AgentCliState {
  running: boolean
  count: number
  activeCount: number
  processes: AgentProcessInfo[]
}

interface AgentHostStatus {
  name: string
  host: string
  url: string
  reachable: boolean
  latencyMs: number | null
  claude: AgentCliState
  agy: AgentCliState
  llama: AgentCliState
  ollama: AgentCliState
  error?: string
}

interface AgentsResponse {
  checkedAt: number
  hosts: AgentHostStatus[]
}

const POLL_INTERVAL_MS = 10_000

/** Compact sidebar widget monitoring CLI agents and local LLM runners across hosts. */
export function SidebarAgentsMonitor() {
  const { authed } = useAuth()
  const [data, setData] = useState<AgentsResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await appFetch(apiUrl("/api/agents"))
      if (!res.ok) return
      const json = (await res.json()) as AgentsResponse
      setData(json)
    } catch {
      // Ignore transient network errors; previous state stays visible.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed !== true) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [authed, refresh])

  if (authed !== true) return null

  const hosts = data?.hosts ?? []

  return (
    <SidebarGroup className="px-2 py-1.5">
      <div className="relative rounded-lg border border-border/60 bg-background/25 px-3 py-2.5">
        <button
          type="button"
          onClick={() => void refresh()}
          title="Refresh agent status"
          className="absolute top-2 right-2 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <FiRefreshCw className={cn("size-3", loading && "animate-spin")} />
        </button>

        <div className="flex flex-col gap-3">
          {hosts.map((host) => (
            <div key={`${host.name}-${host.host}`} className="flex flex-col gap-1">
              <div
                className="flex items-center gap-2 pr-5"
                title={
                  host.reachable
                    ? `${host.name} (${host.host}) · ${host.latencyMs ?? 0}ms`
                    : `${host.name} (${host.host}) offline${host.error ? `: ${host.error}` : ""}`
                }
              >
                <span className="text-xs font-medium tracking-wide uppercase text-foreground/90">
                  {host.name}
                </span>
                {!host.reachable && (
                  <span className="text-[10px] text-muted-foreground/60">
                    offline
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 pl-3">
                <AgentRow
                  label="antigravity"
                  state={host.agy}
                  reachable={host.reachable}
                />
                <AgentRow
                  label="claude"
                  state={host.claude}
                  reachable={host.reachable}
                />
                <AgentRow
                  label="ollama"
                  state={host.ollama}
                  reachable={host.reachable}
                />
                <AgentRow
                  label="llama.cpp"
                  state={host.llama}
                  reachable={host.reachable}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SidebarGroup>
  )
}

function isProcessActive(proc: AgentProcessInfo): boolean {
  return !["T", "t", "Z", "X"].includes(proc.state)
}

function formatProcTitle(proc: AgentProcessInfo): string {
  const details = `PID ${proc.pid} · ${proc.status} (${proc.state})`
  return proc.cwd ? `${proc.cwd}\n${details}` : details
}

function AgentRow({
  label,
  state,
  reachable,
}: {
  label: string
  state: AgentCliState
  reachable: boolean
}) {
  if (reachable && state.processes.length > 1) {
    return (
      <div className="flex flex-col gap-1">
        {state.processes.map((proc) => {
          const active = isProcessActive(proc)
          const stopped = proc.state === "T" || proc.state === "t"
          const dotTitle = formatProcTitle(proc)
          return (
            <div
              key={`${label}-${proc.pid}`}
              title={dotTitle}
              className="flex items-center justify-between gap-2 text-xs leading-tight"
            >
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-foreground/85">{label}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {proc.status}
                </span>
              </div>
              <span
                title={dotTitle}
                className={cn(
                  "size-3 shrink-0 rounded-full border transition-colors",
                  active
                    ? "border-emerald-300/80 bg-emerald-600 dark:border-emerald-300/70 dark:bg-emerald-500"
                    : stopped
                      ? "border-amber-300/80 bg-amber-500/80"
                      : "border-muted-foreground/60 bg-transparent"
                )}
              />
            </div>
          )
        })}
      </div>
    )
  }

  const allStopped = reachable && !state.running && state.count > 0
  const title = !reachable
    ? `${label}: host offline`
    : state.processes.length > 0
      ? state.processes.map(formatProcTitle).join("\n\n")
      : `${label}: idle`

  return (
    <div
      title={title}
      className="flex items-center justify-between gap-2 text-xs leading-tight"
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            "truncate",
            reachable ? "text-foreground/85" : "text-muted-foreground/50"
          )}
        >
          {label}
        </span>
        {reachable && state.count > 1 && (
          <span className="truncate text-[10px] text-muted-foreground">
            ×{state.count}
          </span>
        )}
      </div>

      <span
        title={title}
        className={cn(
          "size-3 shrink-0 rounded-full border transition-colors",
          !reachable
            ? "border-muted-foreground/25 bg-transparent"
            : state.running
              ? "border-emerald-300/80 bg-emerald-600 dark:border-emerald-300/70 dark:bg-emerald-500"
              : allStopped
                ? "border-amber-300/80 bg-amber-500/80"
                : "border-muted-foreground/60 bg-transparent"
        )}
      />
    </div>
  )
}
