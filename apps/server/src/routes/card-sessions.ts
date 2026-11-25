import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { join } from "node:path"
import { and, eq, isNull } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { getDB } from "../db/get-db"
import { cards } from "../db/schema"
import { env } from "../env"
import { canAccessBoard } from "./agents"
import { readJsonBody } from "./read-json-body"

/**
 * A card's saved conversations:
 *
 *  - the **agent session** the runner keeps for the card's last job (pi, agy,
 *    claude), read and continued through agent-runner;
 *  - the **llama chat**, the card chat's own conversation with a llama.cpp
 *    endpoint, stored here as `<sessions>/llama/<cardId>.json`.
 */

const CARD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
/** An agent answering a follow-up can take minutes (a local model reasoning). */
const RESUME_TIMEOUT_MS = 21 * 60 * 1000
const MAX_CHAT_BYTES = 2 * 1024 * 1024

type Params = { Params: { cardId: string } }

async function canAccessCard(cardId: string, userId: string) {
  if (!CARD_ID_RE.test(cardId)) return false
  const [card] = await getDB()
    .select({ boardId: cards.boardId })
    .from(cards)
    .where(and(eq(cards.id, cardId), isNull(cards.deletedAt)))
    .limit(1)
  return card ? canAccessBoard(card.boardId, userId) : false
}

/**
 * A request to agent-runner. Plain `node:http` rather than `fetch`: fetch
 * gives up on response headers after 5 minutes, and a resumed agent answers
 * only once it is done.
 */
function runnerRequest(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; json: unknown }> {
  const url = new URL(path, `${env.agentRunnerUrl}/`)
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8")
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            json = { error: text.slice(0, 300) || "empty reply" }
          }
          resolve({ status: res.statusCode ?? 502, json })
        })
      }
    )
    req.on("timeout", () => req.destroy(new Error("agent-runner timed out")))
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const chatPath = (cardId: string) =>
  join(env.agentSessionsDir, "llama", `${cardId}.json`)

export function registerCardSessionRoutes(app: FastifyInstance): void {
  app.get<Params>("/api/cards/:cardId/agent-session", async (req, reply) => {
    const { cardId } = req.params
    if (!(await canAccessCard(cardId, req.userId))) {
      return reply.code(403).send({ error: "Forbidden" })
    }
    try {
      const res = await runnerRequest(
        "GET",
        `/sessions/card/${cardId}`,
        undefined,
        10_000
      )
      if (res.status === 404) return reply.send({ session: null })
      return reply.code(res.status).send(res.json)
    } catch (err) {
      req.log.warn({ err, cardId }, "agent-session: runner unreachable")
      return reply.send({ session: null, error: "agent-runner unreachable" })
    }
  })

  app.post<Params>(
    "/api/cards/:cardId/agent-session/messages",
    async (req, reply) => {
      const { cardId } = req.params
      if (!(await canAccessCard(cardId, req.userId))) {
        return reply.code(403).send({ error: "Forbidden" })
      }
      const payload = await readJsonBody<{ message?: unknown }>(req.raw)
      const message =
        typeof payload?.message === "string" ? payload.message.trim() : ""
      if (!message) {
        return reply.code(400).send({ error: "message is required" })
      }
      req.log.info(
        { cardId, chars: message.length },
        "agent-session: continuing"
      )
      try {
        const res = await runnerRequest(
          "POST",
          `/sessions/card/${cardId}/messages`,
          { message },
          RESUME_TIMEOUT_MS
        )
        return reply.code(res.status).send(res.json)
      } catch (err) {
        req.log.warn({ err, cardId }, "agent-session: runner request failed")
        return reply.code(502).send({
          error:
            err instanceof Error ? err.message : "agent-runner unreachable",
        })
      }
    }
  )

  app.get<Params>("/api/cards/:cardId/chat", async (req, reply) => {
    const { cardId } = req.params
    if (!(await canAccessCard(cardId, req.userId))) {
      return reply.code(403).send({ error: "Forbidden" })
    }
    try {
      const saved = JSON.parse(await readFile(chatPath(cardId), "utf-8")) as {
        turns?: unknown
      }
      return reply.send({
        turns: Array.isArray(saved.turns) ? saved.turns : [],
      })
    } catch {
      return reply.send({ turns: [] })
    }
  })

  app.put<Params>("/api/cards/:cardId/chat", async (req, reply) => {
    const { cardId } = req.params
    if (!(await canAccessCard(cardId, req.userId))) {
      return reply.code(403).send({ error: "Forbidden" })
    }
    const payload = await readJsonBody<{ turns?: unknown }>(req.raw)
    if (!payload || !Array.isArray(payload.turns)) {
      return reply.code(400).send({ error: "turns must be an array" })
    }
    const data = JSON.stringify({
      cardId,
      updatedAt: Date.now(),
      turns: payload.turns,
    })
    if (Buffer.byteLength(data) > MAX_CHAT_BYTES) {
      return reply.code(413).send({ error: "Conversation too long to save" })
    }
    try {
      const path = chatPath(cardId)
      await mkdir(join(env.agentSessionsDir, "llama"), { recursive: true })
      await writeFile(`${path}.tmp`, data, "utf-8")
      await rename(`${path}.tmp`, path)
      return reply.code(204).send()
    } catch (err) {
      req.log.warn({ err, cardId }, "card chat: could not save")
      return reply.code(503).send({ error: "Chat storage unavailable" })
    }
  })
}
