import { contract } from "@kanban/contract"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { sessionExpired } from "../auth"
import { appFetch } from "../fetch"
import { apiUrl } from "../server"

// Same-origin path proxied to the API (see vite.config).
const link = new RPCLink({
  // Resolved per request, so a server URL set after load is picked up.
  url: () => apiUrl("/api/rpc"),
  fetch: async (request, init) => {
    const res = await appFetch(request, {
      ...init,
      credentials: "include",
    })
    // Session missing or expired: let the auth store flip to signed-out so the
    // UI prompts a re-login.
    if (res.status === 401) sessionExpired()
    return res
  },
})

export const orpc: ContractRouterClient<typeof contract> =
  createORPCClient(link)
