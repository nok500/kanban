import { useCallback, useEffect, useRef, useState } from "react"
import { apiUrl, appFetch } from "@kanban/core"
import { readChatStream } from "./read-chat-stream"

/** A passage of the card a message is about, from a per-paragraph button. */
export interface ChatFocus {
  text: string
  /** The heading the passage sits under, if any. */
  section: string | null
}

export interface ChatTurn {
  id: string
  role: "user" | "assistant"
  content: string
  /** On a user turn: the passage of the card the question was asked about. */
  focus?: ChatFocus
  reasoning?: string
  /** Set on an assistant turn whose request failed or was cut short. */
  error?: string
}

export interface ChatTarget {
  endpoint: string
  model: string
}

export interface CardContext {
  title: string
  body: string
  tags: string[]
}

/**
 * One conversation per card: however the chat is opened (the header, or a
 * paragraph's button), and however often, it picks up where it left off. The
 * map caches it for the page; the server keeps it across reloads and devices
 * (`/api/cards/:id/chat`).
 */
const conversations = new Map<string, ChatTurn[]>()
/** Cards whose saved conversation was already fetched this page load. */
const loaded = new Set<string>()

const chatUrl = (cardId: string) =>
  apiUrl(`/api/cards/${encodeURIComponent(cardId)}/chat`)

/** Saves the card's conversation; a failure only costs persistence. */
function persist(cardId: string): void {
  const turns = conversations.get(cardId) ?? []
  void appFetch(chatUrl(cardId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turns }),
  }).catch(() => undefined)
}

let nextId = 0
const turnId = () => `t${Date.now().toString(36)}-${nextId++}`

/** The server's JSON error, or a status line when the body isn't JSON. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: unknown }
    if (typeof json.error === "string") return json.error
  } catch {
    // fall through
  }
  return `Request failed (HTTP ${res.status})`
}

/**
 * What the model sees for a user turn: the passage it was asked about, quoted
 * ahead of the question, so later turns still know what "this" referred to.
 */
export function messageContent(turn: ChatTurn): string {
  if (turn.role !== "user" || !turn.focus) return turn.content
  const where = turn.focus.section ? ` (under "${turn.focus.section}")` : ""
  const quoted = turn.focus.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
  return `About this passage of the card${where}:\n\n${quoted}\n\n${turn.content}`
}

export function useCardChat(cardId: string, card: CardContext) {
  const key = cardId
  const [turns, setTurnsState] = useState<ChatTurn[]>(
    () => conversations.get(key) ?? []
  )
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // The card can change while a reply streams; the request uses the version
  // current at send time, so read it through a ref rather than a dependency.
  const cardRef = useRef(card)
  cardRef.current = card

  // The map is the source of truth, not React state: a reply that finishes (or
  // is stopped) after the modal closed must still land in the saved
  // conversation, and React drops updates for an unmounted component.
  const setTurns = useCallback(
    (update: (prev: ChatTurn[]) => ChatTurn[]) => {
      const next = update(conversations.get(key) ?? [])
      conversations.set(key, next)
      setTurnsState(next)
    },
    [key]
  )

  // Leaving (closing the modal, switching cards) stops the reply in flight.
  useEffect(() => () => abortRef.current?.abort(), [key])

  // The saved conversation, once per card per page load. Anything typed
  // before it arrives wins: it is newer.
  useEffect(() => {
    if (loaded.has(key)) return
    loaded.add(key)
    void appFetch(chatUrl(key))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { turns?: ChatTurn[] } | null) => {
        if (!data?.turns?.length || conversations.get(key)?.length) return
        conversations.set(key, data.turns)
        setTurnsState(data.turns)
      })
      .catch(() => loaded.delete(key))
  }, [key])

  const patchTurn = useCallback(
    (id: string, patch: (turn: ChatTurn) => Partial<ChatTurn>) => {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch(t) } : t))
      )
    },
    [setTurns]
  )

  /** Streams a reply to `history` (which must end with a user turn). */
  const run = useCallback(
    async (history: ChatTurn[], target: ChatTarget) => {
      const reply: ChatTurn = { id: turnId(), role: "assistant", content: "" }
      setTurns(() => [...history, reply])
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await appFetch(apiUrl("/api/chat/completions"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint: target.endpoint,
            model: target.model,
            card: cardRef.current,
            // Failed replies are shown, never sent back as context.
            messages: history
              .filter((t) => !t.error)
              .map((t) => ({ role: t.role, content: messageContent(t) })),
          }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const error = await errorFrom(res)
          patchTurn(reply.id, () => ({ error }))
          return
        }
        for await (const delta of readChatStream(res.body)) {
          patchTurn(reply.id, (t) => ({
            content: t.content + (delta.content ?? ""),
            reasoning: delta.reasoning
              ? (t.reasoning ?? "") + delta.reasoning
              : t.reasoning,
          }))
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        patchTurn(reply.id, () => ({
          error: aborted
            ? "Stopped"
            : err instanceof Error
              ? err.message
              : "Request failed",
        }))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setStreaming(false)
        persist(key)
      }
    },
    [key, patchTurn, setTurns]
  )

  const send = useCallback(
    (text: string, target: ChatTarget, focus?: ChatFocus | null) => {
      const content = text.trim()
      if (!content || streaming) return
      const user: ChatTurn = {
        id: turnId(),
        role: "user",
        content,
        ...(focus ? { focus } : {}),
      }
      void run([...turns, user], target)
    },
    [run, streaming, turns]
  )

  /** Drops the last reply and asks again with the same history. */
  const retry = useCallback(
    (target: ChatTarget) => {
      if (streaming) return
      let lastUser = turns.length - 1
      while (lastUser >= 0 && turns[lastUser].role !== "user") lastUser--
      if (lastUser < 0) return
      void run(turns.slice(0, lastUser + 1), target)
    },
    [run, streaming, turns]
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setTurns(() => [])
    persist(key)
  }, [key, setTurns])

  return { turns, streaming, send, retry, stop, clear }
}
