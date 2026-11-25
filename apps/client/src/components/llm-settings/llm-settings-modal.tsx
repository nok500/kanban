import {
  Button,
  CardContent,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  cn,
} from "@kanban/ui-kit"
import { CircleCheck, CircleX, LoaderCircle, RefreshCw } from "lucide-react"
import { useState } from "react"
import { useAuth } from "@/lib/hooks"
import {
  useLlmSettings,
  useSaveAgentSetting,
  useSavePiProvider,
  type AgentEntry,
  type AgentMode,
  type LocalProvider,
} from "@/lib/hooks/use-llm-settings"
import { useChatEndpoints } from "@/lib/hooks/use-chat-endpoints"
import { ChatEndpointsManager } from "../chat-endpoints/chat-endpoints-manager"

interface IProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const AGENT_INFO: Record<
  AgentEntry["agent"],
  { title: string; installed: string; keyLabel?: string; keyHint?: string }
> = {
  claude: {
    title: "Claude Code",
    installed:
      "The claude CLI and its login (~/.claude) mounted into agent-runner.",
    keyLabel: "Anthropic API key",
    keyHint: "Billed per use on your Anthropic account (ANTHROPIC_API_KEY).",
  },
  agy: {
    title: "Antigravity (agy)",
    installed:
      "The agy CLI and its login (~/.gemini) mounted into agent-runner.",
    keyLabel: "Gemini API key",
    keyHint:
      "agy runs on the Gemini API with this key (GEMINI_API_KEY) instead of your Antigravity sign-in.",
  },
  pi: {
    title: "pi (local models)",
    installed:
      "Runs on an OpenAI-compatible server from agent-runner's LOCAL_PROVIDERS (compose).",
  },
}

/** Settings → LLM: the agents agent-runner can run, and the local endpoints. */
export function LlmSettingsModal({ open, onOpenChange }: IProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="md:max-w-xl">
        <ModalHeader onClose={() => onOpenChange(false)}>LLM</ModalHeader>
        <CardContent className="overflow-y-auto px-0">
          {open && <LlmSettings />}
        </CardContent>
      </ModalContent>
    </Modal>
  )
}

function LlmSettings() {
  const { isAdmin } = useAuth()
  const settings = useLlmSettings(true)

  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Agents</h3>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={settings.isFetching}
            onClick={() => void settings.refetch()}
          >
            <RefreshCw className={cn(settings.isFetching && "animate-spin")} />
            Check again
          </Button>
        </div>
        {settings.isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            Asking agent-runner… (each CLI is started once to check it)
          </p>
        ) : settings.isError ? (
          <p className="text-xs text-destructive">{settings.error.message}</p>
        ) : (
          <>
            {!settings.data?.runnerReachable && (
              <p className="text-xs text-destructive">
                agent-runner is unreachable (AGENT_RUNNER_URL); no agent can
                run.
              </p>
            )}
            {settings.data?.agents.map((entry) => (
              <AgentRow
                key={entry.agent}
                entry={entry}
                isAdmin={isAdmin}
                providers={settings.data?.providers ?? []}
              />
            ))}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t px-4 py-4">
        <h3 className="text-sm font-medium">Card chat endpoints</h3>
        <p className="text-xs text-muted-foreground">
          OpenAI-compatible servers (llama.cpp and the like) the card chat can
          talk to.
        </p>
        {isAdmin ? <ChatEndpointsManager /> : <EndpointList />}
      </section>
    </div>
  )
}

function StatusLine({ entry }: { entry: AgentEntry }) {
  const s = entry.status
  if (!s) {
    return (
      <span className="text-xs text-muted-foreground">
        No status from agent-runner
      </span>
    )
  }
  return (
    <span
      className={cn(
        "flex min-w-0 items-start gap-1.5 text-xs",
        s.ok ? "text-muted-foreground" : "text-destructive"
      )}
    >
      {s.ok ? (
        <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleX className="mt-px size-3.5 shrink-0" />
      )}
      <span className="min-w-0">
        {s.ok
          ? `Installed: ${s.version}`
          : [
              s.error,
              s.missing.length ? `missing ${s.missing.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join("; ")}
      </span>
    </span>
  )
}

function AgentRow({
  entry,
  isAdmin,
  providers,
}: {
  entry: AgentEntry
  isAdmin: boolean
  providers: LocalProvider[]
}) {
  const info = AGENT_INFO[entry.agent]
  const keyed = entry.agent !== "pi"
  const save = useSaveAgentSetting()
  const [mode, setMode] = useState<AgentMode>(entry.mode ?? "installed")
  const [key, setKey] = useState("")
  const dirty = mode !== (entry.mode ?? "installed") || key.trim() !== ""

  const submit = () => {
    if (entry.agent === "pi") return
    save.mutate(
      {
        agent: entry.agent,
        mode,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      },
      { onSuccess: () => setKey("") }
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{info.title}</span>
        {keyed && (
          <span className="ml-auto text-xs text-muted-foreground">
            {entry.mode === "apiKey" ? "API key" : "Installed agent"}
          </span>
        )}
      </div>

      {keyed && (
        <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(["installed", "apiKey"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!isAdmin || save.isPending}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 rounded px-2 py-1",
                mode === m
                  ? "bg-background font-medium shadow-xs"
                  : "text-muted-foreground",
                isAdmin && "hover:text-foreground"
              )}
            >
              {m === "installed" ? "Installed agent" : "API key"}
            </button>
          ))}
        </div>
      )}

      {!keyed ? (
        <>
          <p className="text-xs text-muted-foreground">{info.installed}</p>
          <StatusLine entry={entry} />
          <PiProviders
            chosen={entry.provider}
            providers={providers}
            isAdmin={isAdmin}
          />
        </>
      ) : mode === "installed" ? (
        <>
          <p className="text-xs text-muted-foreground">{info.installed}</p>
          <StatusLine entry={entry} />
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">{info.keyHint}</p>
          {isAdmin ? (
            <Input
              type="password"
              autoComplete="off"
              placeholder={
                entry.hasKey ? "Key saved; type to replace it" : info.keyLabel
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          ) : (
            <p className="text-xs">
              {entry.hasKey ? "A key is set." : "No key set yet."}
            </p>
          )}
          {!entry.status?.binary && <StatusLine entry={entry} />}
        </div>
      )}

      {isAdmin && keyed && (dirty || save.isError) && (
        <div className="flex items-center gap-2">
          {save.isError && (
            <span className="text-xs text-destructive">
              {save.error.message}
            </span>
          )}
          <Button
            size="sm"
            className="ml-auto"
            disabled={
              save.isPending ||
              !dirty ||
              (mode === "apiKey" && !entry.hasKey && !key.trim())
            }
            onClick={submit}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The endpoints as non-admins see them: names and whether they answer. */
function EndpointList() {
  const endpoints = useChatEndpoints(true)
  if (endpoints.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading endpoints…</p>
  }
  const list = endpoints.data ?? []
  if (list.length === 0) {
    return <p className="text-xs text-muted-foreground">No endpoint yet.</p>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((e) => (
        <div
          key={e.id}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
        >
          {e.reachable ? (
            <CircleCheck className="size-3.5 text-emerald-600" />
          ) : (
            <CircleX className="size-3.5 text-destructive" />
          )}
          <span className="font-medium">{e.name}</span>
          <span className="ml-auto text-muted-foreground">
            {e.reachable ? `${e.models.length} models` : (e.error ?? "down")}
          </span>
        </div>
      ))}
    </div>
  )
}

/** pi's LOCAL_PROVIDERS, each with whether it answers, and the one pi uses. */
function PiProviders({
  chosen,
  providers,
  isAdmin,
}: {
  chosen: string | null
  providers: LocalProvider[]
  isAdmin: boolean
}) {
  const save = useSavePiProvider()
  if (providers.length === 0) {
    return (
      <p className="text-xs text-destructive">
        No LOCAL_PROVIDERS set on agent-runner, so pi has nothing to run on. Add
        them to its environment in the compose file.
      </p>
    )
  }
  const firstOnline = providers.find((p) => p.online && p.model)
  const missing = chosen && !providers.some((p) => p.name === chosen)
  const pick = (name: string | null) => {
    if (isAdmin && name !== chosen) save.mutate(name)
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      role="radiogroup"
      aria-label="pi runs on"
    >
      <ProviderOption
        selected={chosen === null}
        disabled={!isAdmin || save.isPending}
        onSelect={() => pick(null)}
        title="Auto"
        detail={
          firstOnline
            ? `First that answers, now ${firstOnline.name}`
            : "First that answers; none does right now"
        }
        online={firstOnline ? true : false}
      />
      {providers.map((p) => (
        <ProviderOption
          key={p.name}
          selected={chosen === p.name}
          disabled={!isAdmin || save.isPending}
          onSelect={() => pick(p.name)}
          title={p.name}
          detail={`${p.baseUrl} · ${
            p.online
              ? (p.model ?? p.error ?? "no model")
              : (p.error ?? "offline")
          }`}
          online={p.online && Boolean(p.model)}
        />
      ))}
      {missing && (
        <p className="text-xs text-destructive">
          pi is set to {chosen}, which is no longer in LOCAL_PROVIDERS: jobs
          will fail until you pick another.
        </p>
      )}
      {save.isError && (
        <p className="text-xs text-destructive">{save.error.message}</p>
      )}
    </div>
  )
}

function ProviderOption({
  selected,
  disabled,
  onSelect,
  title,
  detail,
  online,
}: {
  selected: boolean
  disabled: boolean
  onSelect: () => void
  title: string
  detail: string
  online: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted",
        disabled && !selected && "opacity-70"
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          online ? "bg-emerald-500" : "bg-destructive"
        )}
        aria-label={online ? "online" : "offline"}
      />
      <span className="font-medium">{title}</span>
      <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
    </button>
  )
}
