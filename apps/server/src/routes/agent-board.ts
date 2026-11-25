import { and, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { getDB } from "../db/get-db"
import { agentCardCvs, agentColumns } from "../db/schema"
import { canAccessBoard, cvCardsByBoard } from "./agents"
import { readJsonBody } from "./read-json-body"

/**
 * A board's agent rules, as the board UI shows and edits them:
 *  - which Analise columns have the LLM toggle on;
 *  - the CV cards in its Docs column, and which one each JD card uses.
 */

const ID_RE = /^[A-Za-z0-9_:-]{1,128}$/

type BoardParams = { Params: { boardId: string } }

export function registerAgentBoardRoutes(app: FastifyInstance): void {
  app.get<BoardParams>("/api/agents/boards/:boardId", async (req, reply) => {
    const { boardId } = req.params
    if (!ID_RE.test(boardId) || !(await canAccessBoard(boardId, req.userId))) {
      return reply.code(403).send({ error: "Forbidden" })
    }
    const db = getDB()
    const [cols, choices, cvs] = await Promise.all([
      db
        .select({ columnId: agentColumns.columnId })
        .from(agentColumns)
        .where(
          and(eq(agentColumns.boardId, boardId), eq(agentColumns.enabled, true))
        ),
      db
        .select({
          cardId: agentCardCvs.cardId,
          cvCardId: agentCardCvs.cvCardId,
        })
        .from(agentCardCvs)
        .where(eq(agentCardCvs.boardId, boardId)),
      cvCardsByBoard([boardId]),
    ])
    return {
      llmColumns: cols.map((c) => c.columnId),
      cardCvs: Object.fromEntries(choices.map((c) => [c.cardId, c.cvCardId])),
      cvCards: cvs.get(boardId) ?? [],
    }
  })

  app.put<{ Params: { boardId: string; columnId: string } }>(
    "/api/agents/boards/:boardId/columns/:columnId",
    async (req, reply) => {
      const { boardId, columnId } = req.params
      if (
        !ID_RE.test(boardId) ||
        !ID_RE.test(columnId) ||
        !(await canAccessBoard(boardId, req.userId))
      ) {
        return reply.code(403).send({ error: "Forbidden" })
      }
      const body = await readJsonBody<{ enabled?: unknown }>(req.raw)
      if (typeof body?.enabled !== "boolean") {
        return reply.code(400).send({ error: "enabled must be a boolean" })
      }
      const now = Date.now()
      await getDB()
        .insert(agentColumns)
        .values({ columnId, boardId, enabled: body.enabled, updatedAt: now })
        .onConflictDoUpdate({
          target: agentColumns.columnId,
          set: { enabled: body.enabled, boardId, updatedAt: now },
        })
      req.log.info(
        { boardId, columnId, enabled: body.enabled },
        "agents: LLM column toggled"
      )
      return reply.code(204).send()
    }
  )

  app.put<{ Params: { boardId: string; cardId: string } }>(
    "/api/agents/boards/:boardId/cards/:cardId/cv",
    async (req, reply) => {
      const { boardId, cardId } = req.params
      if (
        !ID_RE.test(boardId) ||
        !ID_RE.test(cardId) ||
        !(await canAccessBoard(boardId, req.userId))
      ) {
        return reply.code(403).send({ error: "Forbidden" })
      }
      const body = await readJsonBody<{ cvCardId?: unknown }>(req.raw)
      const db = getDB()
      if (body?.cvCardId === null) {
        await db.delete(agentCardCvs).where(eq(agentCardCvs.cardId, cardId))
        return reply.code(204).send()
      }
      if (typeof body?.cvCardId !== "string" || !ID_RE.test(body.cvCardId)) {
        return reply
          .code(400)
          .send({ error: "cvCardId must be a card id or null" })
      }
      const now = Date.now()
      await db
        .insert(agentCardCvs)
        .values({ cardId, boardId, cvCardId: body.cvCardId, updatedAt: now })
        .onConflictDoUpdate({
          target: agentCardCvs.cardId,
          set: { cvCardId: body.cvCardId, boardId, updatedAt: now },
        })
      return reply.code(204).send()
    }
  )
}
