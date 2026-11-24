import type { IncomingMessage } from "node:http"
import { storageFromEnv } from "@doska/file-storage/server"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { getDB } from "../db/get-db"
import { boardMembers, cards, columns, dashboards } from "../db/schema"
import { env } from "../env"
import type { ServerStorage } from "./files"

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
        .filter((p): p is Record<string, unknown> =>
          Boolean(p && typeof p === "object")
        )
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

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T
  } catch {
    return null
  }
}

async function streamToBase64(
  stream: AsyncIterable<Buffer | Uint8Array | string>
): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("base64")
}

async function canAccessBoard(
  boardId: string,
  userId: string
): Promise<boolean> {
  const db = getDB()
  const [board] = await db
    .select({ id: dashboards.id, ownerId: dashboards.ownerId })
    .from(dashboards)
    .where(and(eq(dashboards.id, boardId), isNull(dashboards.deletedAt)))
    .limit(1)
  if (!board) return false
  if (!board.ownerId || board.ownerId === userId) return true
  const [share] = await db
    .select({ boardId: boardMembers.boardId })
    .from(boardMembers)
    .where(
      and(
        eq(boardMembers.boardId, boardId),
        eq(boardMembers.userId, userId),
        isNull(boardMembers.revokedAt)
      )
    )
    .limit(1)
  return Boolean(share)
}

interface RunAgentBody {
  boardId?: string
  cardId?: string
  title?: string
  body?: string
  agent?: string
}

interface RunnerJobSnapshot {
  jobId: string
  status: string
  exitCode: number | null
  durationMs?: number | null
  startedAt?: number
  finishedAt?: number | null
  output?: string
}

const AGENT_TAGS = new Set(["agy", "claude"])
const INLINE_AGENT_RE = /(?:^|\s)#(agy|claude)(?=\s|$)/i
const activeCardJobs = new Set<string>()

function detectAgentFromCard(
  tags: string[] | null | undefined,
  body: string | null | undefined
): "agy" | "claude" | null {
  const fromTags = (tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .find((t) => AGENT_TAGS.has(t))
  if (fromTags === "agy" || fromTags === "claude") return fromTags
  const match = INLINE_AGENT_RE.exec(body ?? "")
  return match ? (match[1].toLowerCase() as "agy" | "claude") : null
}

async function waitForJobFinish(opts: {
  cardId: string
  jobId: string
  log: FastifyBaseLogger
}): Promise<void> {
  const { cardId, jobId, log } = opts
  const deadline = Date.now() + 5 * 60 * 1000

  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const res = await fetch(`${env.agentRunnerUrl}/jobs/${jobId}`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) continue
        const job = (await res.json()) as { status?: string }
        if (job.status && job.status !== "running") {
          log.info({ jobId, cardId, status: job.status }, "agents/watch: job finished")
          return
        }
      } catch {
        continue
      }
    }
    log.warn({ jobId, cardId }, "agents/watch: timed out waiting for job")
  } finally {
    activeCardJobs.delete(cardId)
  }
}

async function dispatchAgentJob(opts: {
  userId: string
  boardId: string
  cardId: string
  title: string
  body: string
  agent: "agy" | "claude"
  storage: ServerStorage | null
  log: FastifyBaseLogger
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { userId, boardId, cardId, title, body, agent, storage, log } = opts
  if (activeCardJobs.has(cardId)) {
    return { status: 200, body: { ok: true, skipped: true } }
  }
  activeCardJobs.add(cardId)

  const db = getDB()
  const boardCols = await db
    .select({ id: columns.id, title: columns.title })
    .from(columns)
    .where(and(eq(columns.boardId, boardId), isNull(columns.deletedAt)))

  const docsColIds = boardCols
    .filter((c) => c.title.trim().toLowerCase() === "docs")
    .map((c) => c.id)

  const cvs: Array<{ name: string; mime: string; contentBase64: string }> = []
  if (docsColIds.length > 0 && storage) {
    const docCards = await db
      .select({ attachments: cards.attachments })
      .from(cards)
      .where(
        and(
          eq(cards.boardId, boardId),
          inArray(cards.columnId, docsColIds),
          isNull(cards.deletedAt)
        )
      )

    for (const docCard of docCards) {
      for (const att of docCard.attachments ?? []) {
        try {
          const fetched = await storage.fetch(att.key)
          cvs.push({
            name: att.name,
            mime: att.mime,
            contentBase64: await streamToBase64(fetched.body),
          })
        } catch (err) {
          log.warn(
            { err, key: att.key },
            "agents/run: failed to fetch CV attachment"
          )
        }
      }
    }
  }

  try {
    log.info(
      {
        runnerUrl: env.agentRunnerUrl,
        agent,
        cardId,
        cvCount: cvs.length,
        cvNames: cvs.map((c) => c.name),
      },
      "agents/run: dispatching job to agent-runner"
    )
    const runnerRes = await fetch(`${env.agentRunnerUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent,
        boardId,
        cardId,
        title,
        body,
        cvs,
      }),
      signal: AbortSignal.timeout(5000),
    })
    const result = (await runnerRes.json()) as Record<string, unknown>
    log.info(
      { status: runnerRes.status, result },
      "agents/run: agent-runner responded"
    )
    if (runnerRes.ok && result.jobId != null) {
      void waitForJobFinish({
        cardId,
        jobId: String(result.jobId),
        log,
      })
    } else {
      activeCardJobs.delete(cardId)
    }
    return { status: runnerRes.status, body: result }
  } catch (err) {
    activeCardJobs.delete(cardId)
    log.error({ err }, "agents/run: failed to reach agent-runner")
    return {
      status: 502,
      body: {
        error: err instanceof Error ? err.message : "agent-runner unreachable",
      },
    }
  }
}

/** Polls Process/Analise columns every 10s for tagged cards and dispatches them. */
export function startAgentPoller(
  log: FastifyBaseLogger,
  storage: ServerStorage | null = storageFromEnv()
): NodeJS.Timeout {
  const tick = async () => {
    try {
      const db = getDB()
      const targetCols = await db
        .select({
          colId: columns.id,
          boardId: columns.boardId,
          ownerId: dashboards.ownerId,
        })
        .from(columns)
        .innerJoin(dashboards, eq(columns.boardId, dashboards.id))
        .where(
          and(
            isNull(columns.deletedAt),
            isNull(dashboards.deletedAt),
            sql`lower(trim(${columns.title})) in ('process', 'analise')`
          )
        )

      if (targetCols.length === 0) return

      const colIds = targetCols.map((c) => c.colId)
      const ownerByBoard = new Map<string, string>()
      for (const c of targetCols) {
        if (c.ownerId) ownerByBoard.set(c.boardId, c.ownerId)
      }

      const pendingCards = await db
        .select()
        .from(cards)
        .where(and(inArray(cards.columnId, colIds), isNull(cards.deletedAt)))

      for (const card of pendingCards) {
        if (activeCardJobs.has(card.id)) continue
        if (/process as job-id:/i.test(card.body)) continue
        const agent = detectAgentFromCard(card.tags, card.body)
        if (!agent) continue
        const userId = ownerByBoard.get(card.boardId)
        if (!userId) continue

        void dispatchAgentJob({
          userId,
          boardId: card.boardId,
          cardId: card.id,
          title: card.title,
          body: card.body,
          agent,
          storage,
          log,
        })
      }
    } catch (err) {
      log.warn({ err }, "agents/poller: tick failed")
    }
  }

  return setInterval(() => void tick(), 10_000)
}

/** Reports live status of CLI agents and dispatches JD analysis jobs. */
export function registerAgentRoutes(
  app: FastifyInstance,
  storage: ServerStorage | null = storageFromEnv()
): void {
  app.get("/api/agents", async () => {
    const targets = parseTargets()
    const hosts = await Promise.all(targets.map(probeTarget))
    return {
      checkedAt: Date.now(),
      hosts,
    }
  })

  app.get("/api/agents/jobs", async (_req, reply) => {
    try {
      const res = await fetch(`${env.agentRunnerUrl}/jobs`, {
        signal: AbortSignal.timeout(1500),
      })
      if (!res.ok) {
        return reply.send({ jobs: [], error: `HTTP ${res.status}` })
      }
      const data = (await res.json()) as { jobs?: unknown[] }
      return reply.send({ jobs: data.jobs ?? [] })
    } catch (err) {
      return reply.send({
        jobs: [],
        error: err instanceof Error ? err.message : "agent-runner unreachable",
      })
    }
  })

  app.post("/api/agents/run", async (req, reply) => {
    const payload = await readJsonBody<RunAgentBody>(req.raw)
    req.log.info(
      {
        userId: req.userId,
        boardId: payload?.boardId,
        cardId: payload?.cardId,
        agent: payload?.agent,
        title: payload?.title,
      },
      "agents/run: incoming request"
    )
    if (!payload?.boardId || !payload.cardId) {
      return reply.code(400).send({ error: "boardId and cardId are required" })
    }
    if (payload.agent !== "agy" && payload.agent !== "claude") {
      return reply.code(400).send({ error: "agent must be 'agy' or 'claude'" })
    }

    const allowed = await canAccessBoard(payload.boardId, req.userId)
    if (!allowed) {
      req.log.warn(
        { userId: req.userId, boardId: payload.boardId },
        "agents/run: forbidden"
      )
      return reply.code(403).send({ error: "Forbidden" })
    }

    const res = await dispatchAgentJob({
      userId: req.userId,
      boardId: payload.boardId,
      cardId: payload.cardId,
      title: payload.title ?? "",
      body: payload.body ?? "",
      agent: payload.agent,
      storage,
      log: req.log,
    })
    return reply.code(res.status).send(res.body)
  })
}
