import {
  Button,
  Markdown,
  Modal,
  ModalContent,
  ModalHeader,
  Textarea,
  cn,
} from "@kanban/ui-kit"
import {
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  Settings2,
  LoaderCircle,
  RotateCcw,
  X,
  Square,
  SquarePen,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  messageContent,
  useCardChat,
  type CardContext,
  type ChatFocus,
  type ChatTarget,
  type ChatTurn,
} from "@/lib/chat/use-card-chat"
import {
  useAgentSession,
  type AgentSession,
  type AgentSessionTurn,
} from "@/lib/chat/use-agent-session"
import {
  useChatEndpoints,
  type ChatEndpointStatus,
} from "@/lib/hooks/use-chat-endpoints"
import { useAuth } from "@/lib/hooks"
import { ChatEndpointsManager } from "../chat-endpoints/chat-endpoints-manager"

const TARGET_KEY = "deck:chat-target"

const SUGGESTIONS = [
  "Summarize this card",
  "What are the key requirements of this role?",
  "What should I ask the interviewer?",
  "Draft a short, tailored cover note",
]

/** For a chat opened from one passage of the analysis. */
const FOCUS_SUGGESTIONS = [
  "Explain this point",
  "How do I address this in my CV?",
  "Give me interview talking points on this",
  "Rewrite this as a CV bullet",
]

interface IProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cardId: string
  card: CardContext
  /** Set when opened from a paragraph: attached to the next message. */
  initialFocus: ChatFocus | null
}

function loadTarget(): ChatTarget | null {
  try {
    const raw = localStorage.getItem(TARGET_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ChatTarget>
    return parsed.endpoint && parsed.model
      ? { endpoint: parsed.endpoint, model: parsed.model }
      : null
  } catch {
    return null
  }
}

/** The saved choice if it still exists, else the first loaded model, else any. */
function pickTarget(
  endpoints: ChatEndpointStatus[],
  saved: ChatTarget | null
): ChatTarget | null {
  const live = endpoints.filter((e) => e.reachable && e.models.length > 0)
  if (
    saved &&
    live.some(
      (e) =>
        e.name === saved.endpoint && e.models.some((m) => m.id === saved.model)
    )
  ) {
    return saved
  }
  for (const e of live) {
    const loaded = e.models.find((m) => m.status === "loaded")
    if (loaded) return { endpoint: e.name, model: loaded.id }
  }
  const first = live[0]
  return first ? { endpoint: first.name, model: first.models[0].id } : null
}

const encodeTarget = (t: ChatTarget) => `${t.endpoint}\u0000${t.model}`
/** The picker's value for "continue the card's agent session". */
const AGENT_VALUE = "\u0001agent"
const decodeTarget = (value: string): ChatTarget => {
  const [endpoint, model] = value.split("\u0000")
  return { endpoint, model }
}

/** A chat with a llama.cpp model about one card, which rides along as context. */
export function CardChatModal({
  open,
  onOpenChange,
  cardId,
  card,
  initialFocus,
}: IProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="md:h-[85svh] md:max-w-3xl">
        {open && (
          <ChatPane
            key={cardId}
            cardId={cardId}
            card={card}
            initialFocus={initialFocus}
            onClose={() => onOpenChange(false)}
          />
        )}
      </ModalContent>
    </Modal>
  )
}

function ChatPane({
  cardId,
  card,
  initialFocus,
  onClose,
}: {
  cardId: string
  card: CardContext
  initialFocus: ChatFocus | null
  onClose: () => void
}) {
  const endpointsQuery = useChatEndpoints(true)
  const endpoints = useMemo(
    () => endpointsQuery.data ?? [],
    [endpointsQuery.data]
  )
  const [chosen, setChosen] = useState<ChatTarget | null>(loadTarget)
  const target = useMemo(
    () => pickTarget(endpoints, chosen),
    [endpoints, chosen]
  )
  const activeEndpoint = endpoints.find((e) => e.name === target?.endpoint)
  const { isAdmin } = useAuth()
  // Admins edit endpoints in place: a second dialog on top would fight this
  // one for focus.
  const [managing, setManaging] = useState(false)

  const { turns, streaming, send, retry, stop, clear } = useCardChat(
    cardId,
    card
  )
  const agent = useAgentSession(cardId)
  const session = agent.session
  // A processed card opens on its agent's session; picking a llama model
  // switches this pane to the llama chat.
  const [pickedLlama, setPickedLlama] = useState(false)
  const agentMode = Boolean(session) && !pickedLlama
  const agentBusy = agent.pending !== null
  const agentTurns = useMemo(
    () => (session ? sessionTurns(session, agent.pending) : []),
    [session, agent.pending]
  )
  const shownTurns: ShownTurn[] = agentMode ? agentTurns : turns
  const [draft, setDraft] = useState("")
  // The passage the next message is about; it rides along with that message.
  // The pane mounts on every open, so this resets to whatever opened it.
  const [focus, setFocus] = useState<ChatFocus | null>(initialFocus)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the reply as it streams, unless the user scrolled up to read.
  const pinnedRef = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [shownTurns])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const choose = (value: string) => {
    if (value === AGENT_VALUE) {
      setPickedLlama(false)
      return
    }
    const next = decodeTarget(value)
    setPickedLlama(true)
    setChosen(next)
    localStorage.setItem(TARGET_KEY, JSON.stringify(next))
  }

  const canSendAgent = agentMode && Boolean(session?.resumable) && !agentBusy
  const canSend = agentMode ? canSendAgent : Boolean(target) && !streaming

  const submit = () => {
    if (!draft.trim() || !canSend) return
    pinnedRef.current = true
    if (agentMode) {
      agent.send(
        messageContent({
          id: "draft",
          role: "user",
          content: draft.trim(),
          ...(focus ? { focus } : {}),
        })
      )
    } else if (target) {
      send(draft, target, focus)
    }
    setDraft("")
    setFocus(null)
  }

  const last = turns[turns.length - 1]
  const canRetry =
    !agentMode &&
    !streaming &&
    target &&
    last?.role === "assistant" &&
    Boolean(last.error)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ModalHeader onClose={onClose} className="border-b">
        {managing ? (
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to chat"
              onClick={() => setManaging(false)}
            >
              <ArrowLeft />
            </Button>
            LLM endpoints
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0">Chat</span>
            <span className="truncate text-sm font-normal text-muted-foreground">
              {card.title || "(untitled)"}
            </span>
          </span>
        )}
      </ModalHeader>

      {managing ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ChatEndpointsManager />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ModelSelect
              endpoints={endpoints}
              loading={endpointsQuery.isLoading}
              failed={endpointsQuery.isError}
              value={
                agentMode ? AGENT_VALUE : target ? encodeTarget(target) : null
              }
              session={session}
              onChange={choose}
              disabled={streaming || agentBusy}
              isAdmin={isAdmin}
              onManage={() => setManaging(true)}
            />
            <div className="ml-auto flex items-center gap-1">
              {!agentMode && activeEndpoint?.uiUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href={activeEndpoint.uiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ExternalLink />
                  llama UI
                </Button>
              )}
              {!agentMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clear()
                    inputRef.current?.focus()
                  }}
                  disabled={turns.length === 0}
                >
                  <SquarePen />
                  New chat
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Manage LLM endpoints"
                  onClick={() => setManaging(true)}
                >
                  <Settings2 />
                </Button>
              )}
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              pinnedRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            {agentMode && session && <SessionBanner session={session} />}
            {shownTurns.length === 0 ? (
              <EmptyState
                focused={Boolean(focus)}
                onPick={(text) => {
                  setDraft(text)
                  inputRef.current?.focus()
                }}
              />
            ) : (
              shownTurns.map((turn, i) =>
                turn.jobPrompt ? (
                  <JobPrompt key={turn.id} turn={turn} />
                ) : (
                  <Turn
                    key={turn.id}
                    turn={turn}
                    pending={
                      i === shownTurns.length - 1 &&
                      (agentMode ? agentBusy : streaming)
                    }
                    waitingLabel={
                      agentMode && session
                        ? `${session.agent} is working… (a follow-up can take a few minutes)`
                        : undefined
                    }
                  />
                )
              )
            )}
            {agentMode && agent.error && (
              <p className="text-xs text-destructive">Error: {agent.error}</p>
            )}
            {canRetry && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retry(target)}
                >
                  <RotateCcw />
                  Retry
                </Button>
              </div>
            )}
          </div>

          {focus && (
            <AttachedFocus
              focus={focus}
              showSuggestions={!draft.trim()}
              onPick={(text) => {
                setDraft(text)
                inputRef.current?.focus()
              }}
              onRemove={() => {
                setFocus(null)
                inputRef.current?.focus()
              }}
            />
          )}

          <form
            className={cn(
              "flex items-end gap-2 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              !focus && "border-t"
            )}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={
                agentMode && session
                  ? session.resumable
                    ? `Continue the ${session.agent} session… (Enter to send)`
                    : `This ${session.agent} session can't be continued; pick a llama model above`
                  : !target
                    ? "No model available"
                    : focus
                      ? "Ask about this point… (Enter to send, Shift+Enter for a new line)"
                      : "Ask about this card… (Enter to send, Shift+Enter for a new line)"
              }
              rows={2}
              className="max-h-48 min-h-10 flex-1 resize-none"
            />
            {streaming && !agentMode ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Stop"
                onClick={stop}
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={!canSend || !draft.trim()}
              >
                {agentBusy && agentMode ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ArrowUp />
                )}
              </Button>
            )}
          </form>
        </>
      )}
    </div>
  )
}

function ModelSelect({
  endpoints,
  loading,
  failed,
  value,
  session,
  onChange,
  disabled,
  isAdmin,
  onManage,
}: {
  endpoints: ChatEndpointStatus[]
  loading: boolean
  failed: boolean
  value: string | null
  session: AgentSession | null
  onChange: (value: string) => void
  disabled: boolean
  isAdmin: boolean
  onManage: () => void
}) {
  if (loading && !session) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Looking for models…
      </span>
    )
  }
  if (!session && (failed || !value)) {
    const down = endpoints.filter((e) => !e.reachable)
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs text-destructive">
        <span className="min-w-0 truncate">
          {failed
            ? "Could not load the model list."
            : down.length > 0
              ? `No model reachable (${down.map((e) => `${e.name}: ${e.error ?? "down"}`).join("; ")})`
              : isAdmin
                ? "No LLM endpoint yet."
                : "No LLM endpoint yet. Ask an admin to add one in Settings."}
        </span>
        {isAdmin && !failed && (
          <Button variant="outline" size="sm" onClick={onManage}>
            {endpoints.length === 0 ? "Add endpoint" : "Edit endpoints"}
          </Button>
        )}
      </span>
    )
  }
  return (
    <select
      aria-label="Model"
      className="h-7 max-w-[70%] min-w-0 truncate rounded-md border bg-transparent px-2 text-xs"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {session && (
        <optgroup label="This card's agent">
          <option value={AGENT_VALUE}>Continue {session.agent} session</option>
        </optgroup>
      )}
      {!value && <option value="">Pick a model</option>}
      {endpoints.map((e) => (
        <optgroup
          key={e.name}
          label={e.reachable ? e.name : `${e.name} (unreachable)`}
        >
          {e.models.map((m) => (
            <option
              key={m.id}
              value={encodeTarget({ endpoint: e.name, model: m.id })}
            >
              {m.id}
              {m.status && m.status !== "loaded" ? ` (${m.status})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** A list item's text keeps its marker; drop it for display. */
const displayText = (focus: ChatFocus) =>
  focus.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")

function FocusQuote({ focus, clamp }: { focus: ChatFocus; clamp: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
        About this point{focus.section ? ` · ${focus.section}` : ""}
      </span>
      <div
        className={cn(
          "border-l-2 pl-2 text-xs whitespace-pre-wrap text-foreground/80",
          clamp
        )}
      >
        {displayText(focus)}
      </div>
    </div>
  )
}

/** The passage attached to the message being written, above the input. */
function AttachedFocus({
  focus,
  showSuggestions,
  onPick,
  onRemove,
}: {
  focus: ChatFocus
  showSuggestions: boolean
  onPick: (text: string) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-3 pt-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <FocusQuote focus={focus} clamp="line-clamp-3" />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Don't attach this point"
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      {showSuggestions && (
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_SUGGESTIONS.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              onClick={() => onPick(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  focused,
  onPick,
}: {
  focused: boolean
  onPick: (text: string) => void
}) {
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">
        {focused
          ? "Your next message is about the point below; the whole card goes along as context."
          : "The card's title, tags and body are sent along as context."}
      </p>
      {!focused && (
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              onClick={() => onPick(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function Turn({
  turn,
  pending,
  waitingLabel,
}: {
  turn: ChatTurn
  pending: boolean
  waitingLabel?: string
}) {
  if (turn.role === "user") {
    return (
      <div className="ml-auto flex max-w-[85%] flex-col gap-1.5 rounded-xl bg-muted px-3 py-2">
        {turn.focus && <FocusQuote focus={turn.focus} clamp="line-clamp-2" />}
        <div className="whitespace-pre-wrap">{turn.content}</div>
      </div>
    )
  }

  const empty = !turn.content && !turn.reasoning
  return (
    <div className="flex max-w-full flex-col gap-2">
      {turn.reasoning && (
        <details className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {pending && !turn.content
              ? "Thinking…"
              : `Reasoning (${turn.reasoning.length.toLocaleString()} characters)`}
          </summary>
          <div className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap">
            {turn.reasoning}
          </div>
        </details>
      )}
      {turn.content && <Markdown className="preview">{turn.content}</Markdown>}
      {pending && empty && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {waitingLabel ??
            "Waiting for the model… (an unloaded model loads first)"}
        </span>
      )}
      {turn.error && (
        <p
          className={cn(
            "text-xs",
            turn.error === "Stopped"
              ? "text-muted-foreground"
              : "text-destructive"
          )}
        >
          {turn.error === "Stopped" ? "Stopped." : `Error: ${turn.error}`}
        </p>
      )}
    </div>
  )
}

type ShownTurn = ChatTurn & { jobPrompt?: boolean }

/** The session's turns as the chat shows them, plus the message on its way. */
function sessionTurns(
  session: AgentSession,
  pending: string | null
): ShownTurn[] {
  const shown: ShownTurn[] = session.turns.map(
    (t: AgentSessionTurn, i): ShownTurn => ({
      id: `${session.id}-${i}`,
      role: t.role,
      content: t.content,
      ...(t.error ? { error: t.error } : {}),
      ...(t.reasoning ? { reasoning: t.reasoning } : {}),
      ...(t.kind === "job" ? { jobPrompt: true } : {}),
    })
  )
  if (pending !== null) {
    shown.push(
      { id: "pending-user", role: "user", content: pending },
      { id: "pending-reply", role: "assistant", content: "" }
    )
  }
  return shown
}

function SessionBanner({ session }: { session: AgentSession }) {
  return (
    <p className="text-center text-xs text-muted-foreground">
      {session.agent} processed this card{" "}
      {session.provider
        ? `on ${session.provider.name} (${session.provider.model}) `
        : ""}
      {new Date(session.createdAt).toLocaleString()}.{" "}
      {session.resumable
        ? "Messages here continue that session."
        : "Its session can't be continued."}
    </p>
  )
}

/** The job's prompt: long (JD, CVs, instructions), so folded away. */
function JobPrompt({ turn }: { turn: ShownTurn }) {
  return (
    <details className="ml-auto max-w-[85%] rounded-xl bg-muted px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none">
        Job prompt ({turn.content.length.toLocaleString()} characters)
      </summary>
      <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap">
        {turn.content}
      </div>
    </details>
  )
}
