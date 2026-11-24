import type { IncomingMessage } from "node:http"
import type { Card, Column } from "@doska/contract"
import { storageFromEnv } from "@doska/file-storage/server"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { getDB } from "../db/get-db"
import { boardMembers, cards, columns, dashboards } from "../db/schema"
import { env } from "../env"
import { DbStore } from "../mcp/store"
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

function parseVerdict(output: string): "follow-up" | "nay" | null {
  const explicit = /verdict\s*:\s*(follow-up|yay|nay)\b/i.exec(output)
  if (explicit) {
    const v = explicit[1].toLowerCase()
    return v === "nay" ? "nay" : "follow-up"
  }
  const matches = [...output.matchAll(/\b(follow-up|yay|nay)\b/gi)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1][1].toLowerCase()
  return last === "nay" ? "nay" : "follow-up"
}

function parseMatchPriority(output: string): "high" | "medium" | "low" | null {
  const match = /match\s*:\s*(high|medium|low)\b/i.exec(output)
  return match ? (match[1].toLowerCase() as "high" | "medium" | "low") : null
}

async function watchAndApplyJobResult(opts: {
  userId: string
  boardId: string
  cardId: string
  jobId: string
  log: FastifyBaseLogger
}): Promise<void> {
  const { userId, boardId, cardId, jobId, log } = opts
  const deadline = Date.now() + 5 * 60 * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    let job: RunnerJobSnapshot
    try {
      const res = await fetch(`${env.agentRunnerUrl}/jobs/${jobId}`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) continue
      job = (await res.json()) as RunnerJobSnapshot
    } catch {
      continue
    }

    if (job.status === "running") continue

    const output = (job.output ?? "").trim()
    const verdict = parseVerdict(output)

    try {
      const store = new DbStore(userId)
      const changes = await store.readBoard(boardId)

      let existingCard: Card | null = null
      const boardColumns: Column[] = []
      for (const ch of changes) {
        if (ch.store === "cards" && ch.record.id === cardId && !ch.record.deletedAt) {
          existingCard = ch.record
        } else if (ch.store === "columns" && !ch.record.deletedAt) {
          boardColumns.push(ch.record)
        }
      }

      if (!existingCard) {
        log.warn({ boardId, cardId, jobId }, "agents/watch: card not found")
        return
      }

      const currentCol = boardColumns.find(
        (c) => c.id === existingCard.columnId
      )
      if (!currentCol || currentCol.title.trim().toLowerCase() !== "analise") {
        log.info(
          {
            boardId,
            cardId,
            jobId,
            column: currentCol?.title ?? null,
          },
          "agents/watch: skipping card no longer in Analise column"
        )
        return
      }

      const targetCol = verdict
        ? boardColumns.find((c) => c.title.trim().toLowerCase() === verdict)
        : undefined

      const now = store.now()
      const durationMs =
        typeof job.durationMs === "number"
          ? job.durationMs
          : job.finishedAt && job.startedAt
            ? job.finishedAt - job.startedAt
            : null
      const header =
        durationMs != null && !/^thought for /i.test(output)
          ? `Thought for ${Math.max(1, Math.round(durationMs / 1000))}s\n\n`
          : ""
      const outputBlock = output
        ? `${header}${output}`
        : `Job ${jobId} finished (${job.status}, exit ${job.exitCode ?? "?"}).`
      const baseBody = existingCard.body.trimEnd()
      const nextBody = baseBody
        ? `${baseBody}\n\n---\n\n${outputBlock}`
        : `---\n\n${outputBlock}`

      const moved = Boolean(targetCol && targetCol.id !== existingCard.columnId)
      const nextPriority =
        verdict === "follow-up"
          ? (parseMatchPriority(output) ?? "medium")
          : existingCard.priority

      const updatedCard: Card = {
        ...existingCard,
        body: nextBody,
        columnId: targetCol ? targetCol.id : existingCard.columnId,
        priority: nextPriority,
        updatedAt: now,
        stamps: {
          ...existingCard.stamps,
          body: now,
          ...(moved ? { place: now } : {}),
          ...(verdict === "follow-up" ? { priority: now } : {}),
        },
      }

      await store.pushBoard(boardId, [{ store: "cards", record: updatedCard }])
      log.info(
        {
          jobId,
          cardId,
          verdict,
          priority: nextPriority,
          targetColumn: targetCol?.title ?? null,
          outputChars: output.length,
        },
        "agents/watch: updated card with job output"
      )
    } catch (err) {
      log.error({ err, jobId, cardId }, "agents/watch: failed to update card")
    }
    return
  }

  log.warn({ jobId, cardId }, "agents/watch: timed out waiting for job")
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

    const db = getDB()
    const boardCols = await db
      .select({ id: columns.id, title: columns.title })
      .from(columns)
      .where(
        and(eq(columns.boardId, payload.boardId), isNull(columns.deletedAt))
      )

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
            eq(cards.boardId, payload.boardId),
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
            req.log.warn(
              { err, key: att.key },
              "agents/run: failed to fetch CV attachment"
            )
          }
        }
      }
    }

    try {
      req.log.info(
        {
          runnerUrl: env.agentRunnerUrl,
          agent: payload.agent,
          cardId: payload.cardId,
          cvCount: cvs.length,
          cvNames: cvs.map((c) => c.name),
        },
        "agents/run: dispatching job to agent-runner"
      )
      const runnerRes = await fetch(`${env.agentRunnerUrl}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: payload.agent,
          boardId: payload.boardId,
          cardId: payload.cardId,
          title: payload.title ?? "",
          body: payload.body ?? "",
          cvs,
        }),
        signal: AbortSignal.timeout(5000),
      })
      const result = (await runnerRes.json()) as Record<string, unknown>
      req.log.info(
        { status: runnerRes.status, result },
        "agents/run: agent-runner responded"
      )
      if (runnerRes.ok && result.jobId != null) {
        void watchAndApplyJobResult({
          userId: req.userId,
          boardId: payload.boardId,
          cardId: payload.cardId,
          jobId: String(result.jobId),
          log: req.log,
        })
      }
      return reply.code(runnerRes.status).send(result)
    } catch (err) {
      req.log.error({ err }, "agents/run: failed to reach agent-runner")
      return reply.code(502).send({
        error:
          err instanceof Error ? err.message : "agent-runner unreachable",
      })
    }
  })
}
