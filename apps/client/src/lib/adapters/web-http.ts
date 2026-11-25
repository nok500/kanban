import type { Http } from "@kanban/ports"
import { subscribeServerUrl } from "@kanban/core"

export const webHttp: Http = {
  fetch: (input, init) => globalThis.fetch(input, init),
  url: (path) => `${window.location.origin}${path}`,
  isConfigured: () => true,
  subscribe: subscribeServerUrl,
}
