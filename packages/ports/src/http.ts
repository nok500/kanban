/**
 * Where the server is and how bytes reach it: the transport and the base URL,
 * injected so tests and other runtimes can swap them.
 */
export interface Http {
  /**
   * The transport, with no session attached. `Auth` is what adds credentials;
   * the auth client builds on this one directly, since it is what obtains them.
   */
  fetch: typeof fetch

  /** Absolute URL for an app-relative path (`/api/version`). */
  url(path: string): string

  /**
   * Whether a server is known. False only where the base URL has to be
   * configured and has not been — same-origin platforms are always configured,
   * and the app runs purely local until this turns true.
   */
  isConfigured(): boolean

  /** Fires when the base URL changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}
