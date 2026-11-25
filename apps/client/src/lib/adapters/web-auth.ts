// The session rides in a cookie, so there is no token to keep on the client.

import type { Auth } from "@kanban/ports"

export const webAuth: Auth = {
  token: () => null,
  capture: () => {},
  clear: () => {},
}
