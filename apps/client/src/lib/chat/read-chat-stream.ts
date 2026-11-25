/** One increment of a streamed chat completion. */
export interface ChatDelta {
  content?: string
  /** Thinking models (llama.cpp `--reasoning-format`) stream this separately. */
  reasoning?: string
}

interface ChunkJson {
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[]
  error?: { message?: unknown } | string
}

/** Turns one SSE `data:` payload into a delta; null for anything without text. */
export function parseChunk(data: string): ChatDelta | null {
  let json: ChunkJson
  try {
    json = JSON.parse(data) as ChunkJson
  } catch {
    return null
  }
  if (json.error) {
    const message =
      typeof json.error === "string" ? json.error : json.error.message
    throw new Error(typeof message === "string" ? message : "Stream error")
  }
  const delta = json.choices?.[0]?.delta
  if (!delta) return null
  const out: ChatDelta = {}
  if (typeof delta.content === "string" && delta.content)
    out.content = delta.content
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content)
    out.reasoning = delta.reasoning_content
  return out.content || out.reasoning ? out : null
}

/**
 * Reads an OpenAI-style SSE stream (`data: {...}` events, ending with
 * `data: [DONE]`) and yields its text deltas. Network chunks split events at
 * arbitrary points, so partial lines are carried over to the next read.
 */
export async function* readChatStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatDelta> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      // `stream: true` keeps a multi-byte character split across chunks intact.
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (data === "[DONE]") return
        const delta = parseChunk(data)
        if (delta) yield delta
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith("data:")) {
      const data = tail.slice(5).trim()
      if (data !== "[DONE]") {
        const delta = parseChunk(data)
        if (delta) yield delta
      }
    }
  } finally {
    reader.releaseLock()
  }
}
