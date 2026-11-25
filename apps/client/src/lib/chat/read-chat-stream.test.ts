import { describe, expect, test } from "vitest"
import { parseChunk, readChatStream, type ChatDelta } from "./read-chat-stream"

const event = (delta: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`

/** A body that delivers `text` in the given pieces, like a network would. */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece))
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = []
  for await (const delta of readChatStream(body)) out.push(delta)
  return out
}

describe("parseChunk", () => {
  test("reads content and reasoning", () => {
    expect(
      parseChunk(
        JSON.stringify({
          choices: [{ delta: { content: "hi", reasoning_content: "hmm" } }],
        })
      )
    ).toEqual({ content: "hi", reasoning: "hmm" })
  })

  test("ignores the role-only opener and null content", () => {
    expect(
      parseChunk(
        JSON.stringify({
          choices: [{ delta: { role: "assistant", content: null } }],
        })
      )
    ).toBeNull()
  })

  test("ignores malformed JSON", () => {
    expect(parseChunk("{not json")).toBeNull()
  })

  test("throws on an error event", () => {
    expect(() =>
      parseChunk(JSON.stringify({ error: { message: "context full" } }))
    ).toThrow("context full")
  })
})

describe("readChatStream", () => {
  test("yields deltas in order and stops at [DONE]", async () => {
    const body = streamOf([
      event({ role: "assistant", content: null }),
      event({ content: "Hello" }),
      event({ content: " there" }),
      "data: [DONE]\n\n",
      event({ content: "after done" }),
    ])
    expect(await collect(body)).toEqual([
      { content: "Hello" },
      { content: " there" },
    ])
  })

  test("reassembles events split across network chunks", async () => {
    const whole = event({ content: "split" }) + event({ content: " ok" })
    const pieces = [whole.slice(0, 7), whole.slice(7, 30), whole.slice(30)]
    expect(await collect(streamOf(pieces))).toEqual([
      { content: "split" },
      { content: " ok" },
    ])
  })

  test("handles CRLF line endings and a final event without a newline", async () => {
    const body = streamOf([
      event({ content: "a" }).replace(/\n/g, "\r\n"),
      `data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}`,
    ])
    expect(await collect(body)).toEqual([{ content: "a" }, { content: "b" }])
  })
})
