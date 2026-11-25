import type { IncomingMessage } from "node:http"

/**
 * Reads and parses a JSON request body. The app registers a no-op parser for
 * JSON (see app.ts), so routes that want a body read the raw stream themselves.
 * Returns null for an empty or malformed body.
 */
export async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
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
