import type { FastifyInstance } from "fastify"
import { env } from "../env"

export interface AgentProcessInfo {
  pid: number
  state: string
  status: string
  cwd: string | null
}

export interface AgentCliState {
  running: boolean
  count: number
  activeCount: number
  processes: AgentProcessInfo[]
}

export interface AgentHostStatus {
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

interface ProbeTarget {
  name: string
  url: string
}

const DEFAULT_TARGETS: ProbeTarget[] = [
  { name: "VOODOO", url: "http://192.168.8.229:4747/status" },
  { name: "VERDUN", url: "http://192.168.8.220:4747/status" },
]

function parseTargets(): ProbeTarget[] {
  if (env.agentMonitors.length === 0) return DEFAULT_TARGETS

  const parsed: ProbeTarget[] = []
  for (const entry of env.agentMonitors) {
    const sep = entry.indexOf("|")
    if (sep > 0) {
      parsed.push({
        name: entry.slice(0, sep).trim(),
        url: entry.slice(sep + 1).trim(),
      })
    } else {
      parsed.push({ name: hostFromUrl(entry), url: entry })
    }
  }
  return parsed.length > 0 ? parsed : DEFAULT_TARGETS
}

function hostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return rawUrl
  }
}

function emptyCliState(): AgentCliState {
  return { running: false, count: 0, activeCount: 0, processes: [] }
}

function normalizeCliState(value: unknown): AgentCliState {
  if (!value || typeof value !== "object") return emptyCliState()
  const obj = value as {
    running?: unknown
    count?: unknown
    activeCount?: unknown
    processes?: unknown
  }
  const processes: AgentProcessInfo[] = Array.isArray(obj.processes)
    ? obj.processes
        .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
        .map((p) => ({
          pid: typeof p.pid === "number" ? p.pid : 0,
          state: typeof p.state === "string" ? p.state : "?",
          status: typeof p.status === "string" ? p.status : "unknown",
          cwd: typeof p.cwd === "string" ? p.cwd : null,
        }))
    : []
  const count =
    typeof obj.count === "number" && Number.isFinite(obj.count)
      ? obj.count
      : processes.length
  const activeCount =
    typeof obj.activeCount === "number" && Number.isFinite(obj.activeCount)
      ? obj.activeCount
      : count
  return {
    running: Boolean(obj.running) || activeCount > 0,
    count,
    activeCount,
    processes,
  }
}

async function probeTarget(target: ProbeTarget): Promise<AgentHostStatus> {
  const host = hostFromUrl(target.url)
  const startedAt = Date.now()
  try {
    const res = await fetch(target.url, {
      signal: AbortSignal.timeout(1500),
    })
    const latencyMs = Date.now() - startedAt
    if (!res.ok) {
      return {
        name: target.name,
        host,
        url: target.url,
        reachable: false,
        latencyMs,
        claude: emptyCliState(),
        agy: emptyCliState(),
        llama: emptyCliState(),
        ollama: emptyCliState(),
        error: `HTTP ${res.status}`,
      }
    }
    const data = (await res.json()) as {
      claude?: unknown
      agy?: unknown
      llama?: unknown
      ollama?: unknown
    }
    return {
      name: target.name,
      host,
      url: target.url,
      reachable: true,
      latencyMs,
      claude: normalizeCliState(data.claude),
      agy: normalizeCliState(data.agy),
      llama: normalizeCliState(data.llama),
      ollama: normalizeCliState(data.ollama),
    }
  } catch (err) {
    return {
      name: target.name,
      host,
      url: target.url,
      reachable: false,
      latencyMs: null,
      claude: emptyCliState(),
      agy: emptyCliState(),
      llama: emptyCliState(),
      ollama: emptyCliState(),
      error: err instanceof Error ? err.message : "Unreachable",
    }
  }
}

/** Reports live status of `claude` and `agy` CLI agents across configured hosts. */
export function registerAgentRoutes(app: FastifyInstance): void {
  app.get("/api/agents", async () => {
    const targets = parseTargets()
    const hosts = await Promise.all(targets.map(probeTarget))
    return {
      checkedAt: Date.now(),
      hosts,
    }
  })
}
