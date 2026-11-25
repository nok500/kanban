import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { findAccount } from "../db/accounts"
import {
  deleteChatEndpoint,
  findChatEndpoint,
  insertChatEndpoint,
  listChatEndpoints,
  updateChatEndpoint,
} from "../db/chat-endpoints"
import { env } from "../env"
import { readJsonBody } from "./read-json-body"

/**
 * Card chat: a thin proxy in front of one or more llama.cpp servers (their
 * OpenAI-compatible `/v1` API). The browser never talks to llama.cpp directly,
 * so there is no CORS to configure and the instances can sit on LAN addresses
 * or behind a domain the browser can't (or shouldn't) reach.
 *
 * Endpoints come from two places, merged by name:
 *   - `config`: LLAMA_ENDPOINTS, read-only (compose files, `.env`);
 *   - `ui`: added by an admin in Settings, stored in `chat_endpoints`.
 *
 * The client names an endpoint; it never sends a URL to chat with, so the
 * server only calls instances an admin or the deploy configured.
 */

export interface ChatEndpoint {
  /** `config:<name>` for LLAMA_ENDPOINTS entries, a uuid for stored ones. */
  id: string
  name: string
  source: "config" | "ui"
  /** Base of the OpenAI-compatible API, e.g. `https://llama.example.com/v1`. */
  apiUrl: string
  /** The llama.cpp web UI, as the browser should open it (optional). */
  uiUrl: string | null
  /** Sent as `Authorization: Bearer` (llama-server `--api-key`). */
  apiKey: string | null
}

export interface ChatModelInfo {
  id: string
  /** Router mode reports `loaded` / `unloaded` / `loading`; null otherwise. */
  status: string | null
}

export interface ProbeResult {
  reachable: boolean
  models: ChatModelInfo[]
  error?: string
}

type Role = "system" | "user" | "assistant"

interface ChatMessage {
  role: Role
  content: string
}

interface CardContext {
  title?: string
  body?: string
  tags?: string[]
}

interface CompletionBody {
  endpoint?: string
  model?: string
  messages?: unknown
  card?: CardContext
}

interface EndpointInput {
  name?: unknown
  apiUrl?: unknown
  uiUrl?: unknown
  /** Omitted: keep the stored key. Empty string: remove it. */
  apiKey?: unknown
}

/** Generous cap on what one chat may send upstream; a JD is a few KB. */
const MAX_PAYLOAD_CHARS = 200_000

const NAME_RE = /^[\w][\w .-]{0,39}$/

const trimSlash = (value: string) => value.replace(/\/+$/, "")

/**
 * Accepts what a person would paste — `https://llama.example.com`,
 * `http://192.168.8.220:8081/`, `https://example.com/llama`, `…/v1` — and
 * returns the API base, which always ends in `/v1` (llama-server serves its
 * OpenAI API there). Throws with a message fit for the form.
 */
export function normalizeApiUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error(
      "API URL must be a full URL, e.g. https://llama.example.com"
    )
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must start with http:// or https://")
  }
  if (url.username || url.password) {
    throw new Error("Put credentials in the API key field, not the URL")
  }
  if (url.search || url.hash) {
    throw new Error("API URL can't have a query string or #fragment")
  }
  const path = trimSlash(url.pathname)
  return `${url.origin}${path.endsWith("/v1") ? path : `${path}/v1`}`
}

/** Where the llama.cpp web UI usually lives for a given API base. */
export function deriveUiUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/v1$/, "")}/`
}

function normalizeUiUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error("UI URL must be a full URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("UI URL must start with http:// or https://")
  }
  return url.toString()
}

/** LLAMA_ENDPOINTS: comma-separated `Name|API URL[|UI URL]`. */
export function parseEndpoints(entries: string[]): ChatEndpoint[] {
  const parsed: ChatEndpoint[] = []
  for (const entry of entries) {
    const [name, apiUrl, uiUrl] = entry.split("|").map((part) => part.trim())
    if (!name || !apiUrl) continue
    parsed.push({
      id: `config:${name}`,
      name,
      source: "config",
      apiUrl: trimSlash(apiUrl),
      uiUrl: uiUrl || null,
      apiKey: null,
    })
  }
  return parsed
}

/** The card, as the conversation's system message. */
export function buildSystemPrompt(card: CardContext): string {
  const tags = (card.tags ?? []).filter(Boolean)
  return [
    "You are helping the user with a card from their Kanban job-application board.",
    "The card is below. Use it as context for every answer; when the user asks",
    "about the job, the company or their fit, ground your answer in it and say",
    "so when the card doesn't contain the information.",
    "",
    `# ${card.title?.trim() || "(untitled)"}`,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : "",
    "",
    card.body?.trim() || "(empty card)",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
}

function isRole(value: unknown): value is Exclude<Role, "system"> {
  return value === "user" || value === "assistant"
}

/** Keeps well-formed user/assistant turns; a system turn only comes from us. */
function sanitizeMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null
  const out: ChatMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const { role, content } = item as { role?: unknown; content?: unknown }
    if (!isRole(role) || typeof content !== "string") return null
    out.push({ role, content })
  }
  return out.length > 0 && out[out.length - 1].role === "user" ? out : null
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string } }).cause
    return cause?.code ? `${err.message} (${cause.code})` : err.message
  }
  return "Unreachable"
}

export async function probe(
  apiUrl: string,
  apiKey: string | null
): Promise<ProbeResult> {
  try {
    const res = await fetch(`${apiUrl}/models`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403 ? " (check the API key)" : ""
      return {
        reachable: false,
        models: [],
        error: `HTTP ${res.status}${hint}`,
      }
    }
    const json = (await res.json().catch(() => null)) as {
      data?: { id?: unknown; status?: { value?: unknown } }[]
    } | null
    if (!json || !Array.isArray(json.data)) {
      return {
        reachable: false,
        models: [],
        error: "Not an OpenAI-compatible /models response (wrong path?)",
      }
    }
    const models = json.data
      .filter((m) => typeof m.id === "string")
      .map((m) => ({
        id: m.id as string,
        status: typeof m.status?.value === "string" ? m.status.value : null,
      }))
    return { reachable: true, models }
  } catch (err) {
    return { reachable: false, models: [], error: errorText(err) }
  }
}

/** Validated fields for an insert (all required) or an update (as given). */
function readEndpointInput(
  input: EndpointInput,
  partial: boolean
): {
  name?: string
  apiUrl?: string
  uiUrl?: string | null
  apiKey?: string | null
} {
  const out: {
    name?: string
    apiUrl?: string
    uiUrl?: string | null
    apiKey?: string | null
  } = {}

  if (input.name !== undefined || !partial) {
    const name = typeof input.name === "string" ? input.name.trim() : ""
    if (!NAME_RE.test(name)) {
      throw new Error(
        "Name: 1–40 letters, digits, spaces, dots, dashes or underscores"
      )
    }
    out.name = name
  }
  if (input.apiUrl !== undefined || !partial) {
    if (typeof input.apiUrl !== "string") throw new Error("API URL is required")
    out.apiUrl = normalizeApiUrl(input.apiUrl)
  }
  if (input.uiUrl !== undefined) {
    if (input.uiUrl !== null && typeof input.uiUrl !== "string") {
      throw new Error("UI URL must be a string")
    }
    out.uiUrl = input.uiUrl?.trim() ? normalizeUiUrl(input.uiUrl) : null
  }
  if (input.apiKey !== undefined) {
    if (input.apiKey !== null && typeof input.apiKey !== "string") {
      throw new Error("API key must be a string")
    }
    out.apiKey = input.apiKey?.trim() || null
  }
  return out
}

/** What an admin sees: everything but the key itself. */
function publicConfig(e: ChatEndpoint) {
  return {
    id: e.id,
    name: e.name,
    source: e.source,
    apiUrl: e.apiUrl,
    uiUrl: e.uiUrl,
    hasKey: Boolean(e.apiKey),
  }
}

/**
 * Every endpoint, config first; a stored endpoint can't shadow a config one's
 * name. Read per call, so an endpoint added in the UI is usable at once.
 */
async function resolveChatEndpoints(
  configEndpoints: ChatEndpoint[] = parseEndpoints(env.llamaEndpoints)
): Promise<ChatEndpoint[]> {
  const taken = new Set(configEndpoints.map((e) => e.name))
  const stored = (await listChatEndpoints())
    .filter((e) => !taken.has(e.name))
    .map((e): ChatEndpoint => ({ ...e, source: "ui" }))
  return [...configEndpoints, ...stored]
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  while (current && typeof current === "object") {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export function registerChatRoutes(
  app: FastifyInstance,
  configEndpoints: ChatEndpoint[] = parseEndpoints(env.llamaEndpoints)
): void {
  const resolveEndpoints = () => resolveChatEndpoints(configEndpoints)

  async function requireAdmin(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<boolean> {
    const account = await findAccount(req.userId)
    if (account?.isAdmin) return true
    await reply.code(403).send({ error: "Only an admin can manage endpoints" })
    return false
  }

  // ---- For everyone signed in: what can I chat with? ----------------------

  app.get("/api/chat/endpoints", async () => {
    const endpoints = await resolveEndpoints()
    return {
      endpoints: await Promise.all(
        endpoints.map(async (e) => ({
          id: e.id,
          name: e.name,
          source: e.source,
          uiUrl: e.uiUrl,
          ...(await probe(e.apiUrl, e.apiKey)),
        }))
      ),
    }
  })

  // ---- Admin: manage endpoints ---------------------------------------------

  app.get("/api/chat/endpoints/config", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply
    return { endpoints: (await resolveEndpoints()).map(publicConfig) }
  })

  /** Try a URL (and key) before saving; `id` reuses a stored key left blank. */
  app.post("/api/chat/endpoints/test", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply
    const body = await readJsonBody<EndpointInput & { id?: unknown }>(req.raw)
    if (!body || typeof body.apiUrl !== "string") {
      return reply.code(400).send({ error: "API URL is required" })
    }
    let apiUrl: string
    try {
      apiUrl = normalizeApiUrl(body.apiUrl)
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    let apiKey =
      typeof body.apiKey === "string" ? body.apiKey.trim() || null : null
    if (body.apiKey === undefined && typeof body.id === "string") {
      apiKey = (await findChatEndpoint(body.id))?.apiKey ?? null
    }
    return { apiUrl, ...(await probe(apiUrl, apiKey)) }
  })

  app.post("/api/chat/endpoints", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return reply
    const body = await readJsonBody<EndpointInput>(req.raw)
    if (!body) return reply.code(400).send({ error: "Invalid JSON body" })

    let values: ReturnType<typeof readEndpointInput>
    try {
      values = readEndpointInput(body, false)
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    if (configEndpoints.some((e) => e.name === values.name)) {
      return reply
        .code(409)
        .send({ error: `"${values.name}" is already set in LLAMA_ENDPOINTS` })
    }
    try {
      const row = await insertChatEndpoint({
        name: values.name as string,
        apiUrl: values.apiUrl as string,
        uiUrl: values.uiUrl || deriveUiUrl(values.apiUrl as string),
        apiKey: values.apiKey ?? null,
      })
      req.log.info(
        { name: row.name, apiUrl: row.apiUrl },
        "chat: endpoint added"
      )
      return reply.code(201).send(publicConfig({ ...row, source: "ui" }))
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply
          .code(409)
          .send({ error: `An endpoint named "${values.name}" exists` })
      }
      throw err
    }
  })

  app.patch<{ Params: { id: string } }>(
    "/api/chat/endpoints/:id",
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return reply
      if (req.params.id.startsWith("config:")) {
        return reply
          .code(409)
          .send({ error: "Set in LLAMA_ENDPOINTS; change it there" })
      }
      const body = await readJsonBody<EndpointInput>(req.raw)
      if (!body) return reply.code(400).send({ error: "Invalid JSON body" })

      let patch: ReturnType<typeof readEndpointInput>
      try {
        patch = readEndpointInput(body, true)
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
      if (patch.name && configEndpoints.some((e) => e.name === patch.name)) {
        return reply
          .code(409)
          .send({ error: `"${patch.name}" is already set in LLAMA_ENDPOINTS` })
      }
      const existing = await findChatEndpoint(req.params.id)
      if (!existing)
        return reply.code(404).send({ error: "Endpoint not found" })
      // A cleared UI URL falls back to the one the (possibly new) API implies.
      if (patch.uiUrl === null) {
        patch.uiUrl = deriveUiUrl(patch.apiUrl ?? existing.apiUrl)
      }
      try {
        const row = await updateChatEndpoint(req.params.id, patch)
        if (!row) return reply.code(404).send({ error: "Endpoint not found" })
        req.log.info(
          { name: row.name, apiUrl: row.apiUrl },
          "chat: endpoint updated"
        )
        return publicConfig({ ...row, source: "ui" })
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply
            .code(409)
            .send({ error: `An endpoint named "${patch.name}" exists` })
        }
        throw err
      }
    }
  )

  app.delete<{ Params: { id: string } }>(
    "/api/chat/endpoints/:id",
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return reply
      if (req.params.id.startsWith("config:")) {
        return reply
          .code(409)
          .send({ error: "Set in LLAMA_ENDPOINTS; remove it there" })
      }
      const removed = await deleteChatEndpoint(req.params.id)
      if (!removed) return reply.code(404).send({ error: "Endpoint not found" })
      req.log.info({ id: req.params.id }, "chat: endpoint removed")
      return reply.code(204).send()
    }
  )

  // ---- Chat ----------------------------------------------------------------

  app.post("/api/chat/completions", async (req, reply) => {
    const payload = await readJsonBody<CompletionBody>(req.raw)
    if (!payload) return reply.code(400).send({ error: "Invalid JSON body" })

    const endpoint = (await resolveEndpoints()).find(
      (e) => e.name === payload.endpoint
    )
    if (!endpoint) return reply.code(400).send({ error: "Unknown endpoint" })
    if (typeof payload.model !== "string" || !payload.model) {
      return reply.code(400).send({ error: "model is required" })
    }
    const messages = sanitizeMessages(payload.messages)
    if (!messages) {
      return reply.code(400).send({
        error: "messages must be user/assistant turns ending with user",
      })
    }

    const upstreamBody = JSON.stringify({
      model: payload.model,
      stream: true,
      messages: [
        { role: "system", content: buildSystemPrompt(payload.card ?? {}) },
        ...messages,
      ],
    })
    if (upstreamBody.length > MAX_PAYLOAD_CHARS) {
      return reply.code(413).send({ error: "Conversation too long" })
    }

    // Closing the modal or pressing Stop drops the browser's connection; stop
    // llama.cpp generating for nobody.
    const upstreamAbort = new AbortController()
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) upstreamAbort.abort()
    })

    let upstream: Response
    try {
      upstream = await fetch(`${endpoint.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(endpoint.apiKey),
        },
        body: upstreamBody,
        signal: upstreamAbort.signal,
      })
    } catch (err) {
      req.log.warn(
        { err, endpoint: endpoint.name },
        "chat: upstream unreachable"
      )
      return reply
        .code(502)
        .send({ error: `${endpoint.name} unreachable: ${errorText(err)}` })
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "")
      req.log.warn(
        { status: upstream.status, endpoint: endpoint.name, detail },
        "chat: upstream error"
      )
      return reply.code(502).send({
        error: `${endpoint.name} replied ${upstream.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      })
    }

    req.log.info(
      {
        endpoint: endpoint.name,
        model: payload.model,
        turns: messages.length,
      },
      "chat: streaming completion"
    )

    return (
      reply
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache, no-transform")
        // Tells nginx not to buffer, should a proxy in front not already say so.
        .header("x-accel-buffering", "no")
        .send(Readable.fromWeb(upstream.body as NodeReadableStream))
    )
  })
}
