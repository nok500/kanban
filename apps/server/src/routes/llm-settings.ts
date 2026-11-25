import type { FastifyInstance } from "fastify"
import { findAccount } from "../db/accounts"
import {
  listAgentSettings,
  saveAgentSetting,
  type AgentMode,
} from "../db/agent-settings"
import { env } from "../env"
import { readJsonBody } from "./read-json-body"

/**
 * Settings → LLM: how agent-runner runs each agent, and whether it can.
 *
 * - `claude`, `agy`: their installed login (the CLI and config dirs compose
 *   mounts) or an API key stored here and handed to the runner per job.
 * - `pi`: no login of its own; it runs on LOCAL_PROVIDERS from the runner's
 *   env: the one an admin picked, or the first that answers.
 */

export const KEYED_AGENTS = ["claude", "agy"] as const
type KeyedAgent = (typeof KEYED_AGENTS)[number]

const isKeyedAgent = (value: string): value is KeyedAgent =>
  (KEYED_AGENTS as readonly string[]).includes(value)

/** What the runner gets with a job or a follow-up for `agent`. */
export async function agentConfig(agent: string): Promise<{
  auth?: { mode: AgentMode; apiKey?: string }
  /** pi: the LOCAL_PROVIDERS entry to use; null = the first that answers. */
  provider?: string | null
}> {
  const setting = (await listAgentSettings()).find((s) => s.agent === agent)
  if (agent === "pi") return { provider: setting?.provider ?? null }
  if (setting?.mode === "apiKey" && setting.apiKey) {
    return { auth: { mode: "apiKey", apiKey: setting.apiKey } }
  }
  return { auth: { mode: "installed" } }
}

interface RunnerProvider {
  name: string
  baseUrl: string
  online: boolean
  model: string | null
  error?: string
}

interface RunnerStatus {
  agents?: Record<string, unknown>
  providers?: RunnerProvider[]
  sessions?: boolean
}

async function runnerStatus(): Promise<RunnerStatus | null> {
  try {
    const res = await fetch(`${env.agentRunnerUrl}/status`, {
      signal: AbortSignal.timeout(60_000),
    })
    return res.ok ? ((await res.json()) as RunnerStatus) : null
  } catch {
    return null
  }
}

export function registerLlmSettingsRoutes(app: FastifyInstance): void {
  app.get("/api/llm", async () => {
    const [status, settings] = await Promise.all([
      runnerStatus(),
      listAgentSettings(),
    ])
    // claude, agy and pi first, then whatever else the runner checks (opencode).
    const names = [
      ...new Set(["claude", "agy", "pi", ...Object.keys(status?.agents ?? {})]),
    ]
    const agents = names.map((agent) => {
      const setting = settings.find((s) => s.agent === agent)
      return {
        agent,
        mode: isKeyedAgent(agent) ? (setting?.mode ?? "installed") : null,
        hasKey: Boolean(setting?.apiKey),
        provider: agent === "pi" ? (setting?.provider ?? null) : null,
        status: status?.agents?.[agent] ?? null,
      }
    })
    return {
      runnerReachable: status !== null,
      sessions: status?.sessions ?? false,
      agents,
      /** pi's servers: LOCAL_PROVIDERS from the runner's env, probed. */
      providers: status?.providers ?? [],
    }
  })

  app.put<{ Params: { agent: string } }>(
    "/api/llm/agents/:agent",
    async (req, reply) => {
      const account = await findAccount(req.userId)
      if (!account?.isAdmin) {
        return reply
          .code(403)
          .send({ error: "Only an admin can change agents" })
      }
      const { agent } = req.params
      if (agent === "pi") {
        const body = await readJsonBody<{ provider?: unknown }>(req.raw)
        const provider = body?.provider
        if (provider !== null && typeof provider !== "string") {
          return reply
            .code(400)
            .send({ error: "provider must be a name or null (auto)" })
        }
        await saveAgentSetting("pi", { provider: provider?.trim() || null })
        req.log.info({ provider }, "llm: pi provider saved")
        return reply.code(204).send()
      }
      if (!isKeyedAgent(agent)) {
        return reply
          .code(400)
          .send({ error: "agent must be claude, agy or pi" })
      }
      const body = await readJsonBody<{ mode?: unknown; apiKey?: unknown }>(
        req.raw
      )
      if (body?.mode !== "installed" && body?.mode !== "apiKey") {
        return reply
          .code(400)
          .send({ error: "mode must be 'installed' or 'apiKey'" })
      }
      let apiKey: string | null | undefined
      if (body.apiKey === undefined) apiKey = undefined
      else if (typeof body.apiKey === "string")
        apiKey = body.apiKey.trim() || null
      else return reply.code(400).send({ error: "apiKey must be a string" })

      const current = (await listAgentSettings()).find((s) => s.agent === agent)
      const willHaveKey =
        apiKey === undefined ? Boolean(current?.apiKey) : Boolean(apiKey)
      if (body.mode === "apiKey" && !willHaveKey) {
        return reply.code(400).send({ error: "API key mode needs a key" })
      }
      await saveAgentSetting(agent, { mode: body.mode, apiKey })
      req.log.info({ agent, mode: body.mode }, "llm: agent setting saved")
      return reply.code(204).send()
    }
  )
}
