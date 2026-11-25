import { SidebarGroup, cn } from "@kanban/ui-kit"
import { FiRefreshCw } from "react-icons/fi"
import { useAuth } from "@/lib/hooks"
import { useAgentJobs, type AgentJobInfo } from "@/lib/hooks/use-agent-jobs"
import {
  useLlmSettings,
  type AgentEntry,
  type LlmSettings,
} from "@/lib/hooks/use-llm-settings"

const POLL_INTERVAL_MS = 30_000
/** While anything runs, so the green dot follows the job closely. */
const BUSY_POLL_INTERVAL_MS = 3_000
const ACTIVITY_ROWS = 6

/**
 * The sidebar's agent panel: the CLI agents agent-runner can run (on the
 * machine the Kanban containers run on), then the latest jobs.
 */
export function SidebarAgentsMonitor() {
  const { authed } = useAuth()
  const jobs = useAgentJobs()
  const jobRunning = jobs.data?.some((j) => j.status === "running") ?? false
  const settings = useLlmSettings(
    authed === true,
    jobRunning ? BUSY_POLL_INTERVAL_MS : POLL_INTERVAL_MS
  )

  if (authed !== true) return null

  const refreshing = settings.isFetching || jobs.isFetching
  const recent = [...(jobs.data ?? [])]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, ACTIVITY_ROWS)

  return (
    <SidebarGroup className="px-2 py-1.5">
      <div className="relative rounded-lg border border-border/60 bg-background/25 px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            void settings.refetch()
            void jobs.refetch()
          }}
          title="Refresh agents and activity"
          className="absolute top-2 right-2 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <FiRefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        </button>

        <div className="flex flex-col gap-3">
          <Section title="Agents">
            {settings.isLoading ? (
              <Muted>checking…</Muted>
            ) : !settings.data?.runnerReachable ? (
              <Muted>agent-runner unreachable</Muted>
            ) : (
              settings.data.agents.map((entry) => (
                <AgentRow
                  key={entry.agent}
                  entry={entry}
                  settings={settings.data}
                />
              ))
            )}
          </Section>

          <Section title="Activity" divided>
            {recent.length === 0 ? (
              <Muted>no jobs yet</Muted>
            ) : (
              recent.map((job) => <JobRow key={job.jobId} job={job} />)
            )}
          </Section>
        </div>
      </div>
    </SidebarGroup>
  )
}

function Section({
  title,
  divided,
  children,
}: {
  title: string
  divided?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        divided && "border-t border-border/40 pt-2"
      )}
    >
      <span className="pr-5 text-xs font-medium tracking-wide text-foreground/90 uppercase">
        {title}
      </span>
      <div className="flex flex-col gap-1 pl-3">{children}</div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] text-muted-foreground/60">{children}</span>
  )
}

type AgentState = "running" | "ready" | "unavailable"

/**
 * `running`: a job or card chat follow-up for this agent is running in
 * agent-runner now. `ready`: idle, and it can run (the CLI starts, its login is
 * mounted; for pi, a provider answers). `unavailable`: it can't.
 */
function agentState(
  entry: AgentEntry,
  settings: LlmSettings
): { state: AgentState; detail: string } {
  const s = entry.status
  const running = s?.running ?? 0
  const busy = running
    ? `running ${running} ${running === 1 ? "job" : "jobs"} · `
    : ""
  if (!s?.ok) {
    return {
      state: running ? "running" : "unavailable",
      detail:
        s?.error ??
        (s?.missing.length ? `missing ${s.missing.join(", ")}` : "not found"),
    }
  }
  if (entry.agent === "pi") {
    const pinned = entry.provider
    const provider = pinned
      ? settings.providers.find((p) => p.name === pinned)
      : settings.providers.find((p) => p.online && p.model)
    if (!provider?.online || !provider.model) {
      return {
        state: running ? "running" : "unavailable",
        detail: `${busy}${s.version} · ${pinned ? `${pinned} offline` : "no provider online"}`,
      }
    }
    return {
      state: running ? "running" : "ready",
      detail: `${busy}${s.version} · on ${provider.name}`,
    }
  }
  const auth = entry.mode === "apiKey" ? " · API key" : ""
  return {
    state: running ? "running" : "ready",
    detail: `${busy}${s.version}${auth}`,
  }
}

const STATE_LABEL: Record<AgentState, string> = {
  running: "running",
  ready: "ready, idle",
  unavailable: "unavailable",
}

function AgentRow({
  entry,
  settings,
}: {
  entry: AgentEntry
  settings: LlmSettings
}) {
  const { state, detail } = agentState(entry, settings)
  return (
    <div
      title={`${entry.agent}: ${STATE_LABEL[state]}\n${detail}`}
      className="flex items-center gap-2 text-xs leading-tight"
    >
      <span
        aria-label={STATE_LABEL[state]}
        className={cn(
          "size-2 shrink-0 rounded-full",
          state === "running" &&
            "animate-pulse bg-emerald-600 dark:bg-emerald-500",
          state === "ready" && "border border-muted-foreground/60",
          state === "unavailable" && "bg-destructive/70"
        )}
      />
      <span
        className={cn(
          "truncate",
          state === "unavailable"
            ? "text-muted-foreground/60"
            : "text-foreground/85"
        )}
      >
        {entry.agent}
      </span>
    </div>
  )
}

function JobRow({ job }: { job: AgentJobInfo }) {
  const title = [
    `job #${job.jobId} (${job.agent})`,
    job.title || "(untitled)",
    `status: ${job.status}${job.exitCode != null ? ` (exit ${job.exitCode})` : ""}`,
  ].join("\n")

  return (
    <div
      title={title}
      className="grid grid-cols-[2.25rem_1fr_auto] items-baseline gap-1.5 text-xs leading-tight"
    >
      <span className="font-mono text-[11px] text-foreground/85">
        #{job.jobId}
      </span>
      <span className="truncate text-muted-foreground">{job.agent}</span>
      <span
        className={cn(
          "text-[10px] font-medium",
          job.status === "running"
            ? "text-emerald-600 dark:text-emerald-400"
            : job.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
        )}
      >
        {job.status}
      </span>
    </div>
  )
}
