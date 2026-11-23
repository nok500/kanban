import { fromNodeHeaders, toNodeHandler } from "better-auth/node"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { auth } from "../auth"
import { originOf } from "../auth/guard"
import { OIDC_PROVIDER_ID } from "../auth/oidc"
import { env } from "../env"

const authHandler = toNodeHandler(auth)

async function delegateToAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  req.raw.headers["x-forwarded-for"] = req.ip
  await authHandler(req.raw, reply.raw)
  return reply.hijack()
}

/** better-auth owns /api/auth/* — these are the public, pre-session routes. */
export function registerAuthRoutes(app: FastifyInstance): void {
  // Accounts come from an admin (the first from AUTH_LOGIN/AUTH_PASSWORD, the
  // rest through the admin plugin) or from a first SSO sign-in.
  for (const url of ["/api/auth/sign-up", "/api/auth/sign-up/*"]) {
    app.all(url, async (_req, reply) =>
      reply.code(403).send({ error: "Sign-up is disabled" })
    )
  }

  app.get("/api/sso", async (_req, reply) =>
    reply.send({
      providers: env.oidcIssuer
        ? [{ id: OIDC_PROVIDER_ID, name: env.oidcName }]
        : [],
      authRequired: env.authRequired,
    })
  )

  app.all("/api/auth/*", delegateToAuth)

  // OAuth clients look for discovery at the well-known root, but better-auth
  // serves it under its own prefix — so rewrite the path and hand it over.
  app.get("/.well-known/oauth-authorization-server", async (req, reply) => {
    req.raw.url = "/api/auth/.well-known/oauth-authorization-server"
    return delegateToAuth(req, reply)
  })

  // MCP clients (e.g. Antigravity CLI) probe the path-scoped metadata URL
  // first, then fall back to the root, and require `resource` to match `/mcp`.
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    app.get(path, async (req, reply) => {
      const origin = originOf(req)
      const response = await auth.handler(
        new Request(
          `${origin}/api/auth/.well-known/oauth-protected-resource`,
          { headers: fromNodeHeaders(req.headers) }
        )
      )
      if (!response.ok) {
        return reply.code(response.status).send(await response.text())
      }
      const metadata = (await response.json()) as Record<string, unknown>
      return reply
        .code(response.status)
        .send({ ...metadata, resource: `${origin}/mcp` })
    })
  }
}
