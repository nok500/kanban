import { Button, Input, cn } from "@kanban/ui-kit"
import {
  CircleCheck,
  CircleX,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import {
  useChatEndpointConfig,
  useChatEndpoints,
  useDeleteChatEndpoint,
  useSaveChatEndpoint,
  useTestChatEndpoint,
  type ChatEndpointConfig,
  type ChatEndpointInput,
  type ChatEndpointStatus,
} from "@/lib/hooks/use-chat-endpoints"

/**
 * Admin editor for the llama.cpp servers card chat can use. Entries from
 * LLAMA_ENDPOINTS are listed read-only; the rest are stored on the server.
 */
export function ChatEndpointsManager() {
  const config = useChatEndpointConfig(true)
  const status = useChatEndpoints(true)
  // `null`: no form; "new": adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)

  const statusById = new Map(
    (status.data ?? []).map((s): [string, ChatEndpointStatus] => [s.id, s])
  )
  const endpoints = config.data ?? []

  if (config.isLoading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading endpoints…
      </p>
    )
  }
  if (config.isError) {
    return <p className="text-xs text-destructive">{config.error.message}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        llama.cpp servers (OpenAI-compatible API) that card chat can use. The
        kanban server calls them, so use an address it can reach: a LAN IP, a
        domain such as <code>https://llama.example.com</code>, or{" "}
        <code>host.docker.internal</code> for this machine.
      </p>

      {endpoints.length === 0 && editing !== "new" && (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
          No endpoints yet.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {endpoints.map((e) =>
          editing === e.id ? (
            <li key={e.id}>
              <EndpointForm endpoint={e} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <EndpointRow
              key={e.id}
              endpoint={e}
              status={statusById.get(e.id)}
              checking={status.isFetching}
              onEdit={() => setEditing(e.id)}
            />
          )
        )}
      </ul>

      {editing === "new" ? (
        <EndpointForm onDone={() => setEditing(null)} />
      ) : (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing("new")}
            disabled={editing !== null}
          >
            <Plus />
            Add endpoint
          </Button>
        </div>
      )}
    </div>
  )
}

function EndpointRow({
  endpoint,
  status,
  checking,
  onEdit,
}: {
  endpoint: ChatEndpointConfig
  status: ChatEndpointStatus | undefined
  checking: boolean
  onEdit: () => void
}) {
  const remove = useDeleteChatEndpoint()
  const [confirming, setConfirming] = useState(false)
  const readOnly = endpoint.source === "config"

  return (
    <li className="flex items-start gap-2 rounded-lg border p-2.5">
      <StatusDot status={status} checking={checking} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{endpoint.name}</span>
          {readOnly && (
            <span
              className="rounded bg-muted px-1.5 text-[0.65rem] font-normal text-muted-foreground"
              title="Set in LLAMA_ENDPOINTS on the server; change it there"
            >
              config
            </span>
          )}
          {endpoint.hasKey && (
            <KeyRound
              className="size-3 text-muted-foreground"
              aria-label="Has an API key"
            />
          )}
        </div>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {endpoint.apiUrl}
        </span>
        {status && (
          <span
            className={cn(
              "text-xs",
              status.reachable ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {status.reachable
              ? `${status.models.length} model${status.models.length === 1 ? "" : "s"}`
              : (status.error ?? "Unreachable")}
          </span>
        )}
        {remove.error && (
          <span className="text-xs text-destructive">
            {remove.error.message}
          </span>
        )}
      </div>
      {!readOnly &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate(endpoint.id)}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${endpoint.name}`}
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${endpoint.name}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
    </li>
  )
}

function StatusDot({
  status,
  checking,
}: {
  status: ChatEndpointStatus | undefined
  checking: boolean
}) {
  const cls = "mt-0.5 size-4 shrink-0"
  if (!status) {
    return checking ? (
      <LoaderCircle className={cn(cls, "animate-spin text-muted-foreground")} />
    ) : (
      <span className={cls} />
    )
  }
  return status.reachable ? (
    <CircleCheck className={cn(cls, "text-green-600 dark:text-green-500")} />
  ) : (
    <CircleX className={cn(cls, "text-destructive")} />
  )
}

function EndpointForm({
  endpoint,
  onDone,
}: {
  endpoint?: ChatEndpointConfig
  onDone: () => void
}) {
  const [name, setName] = useState(endpoint?.name ?? "")
  const [apiUrl, setApiUrl] = useState(endpoint?.apiUrl ?? "")
  const [uiUrl, setUiUrl] = useState(endpoint?.uiUrl ?? "")
  const [apiKey, setApiKey] = useState("")
  const [removeKey, setRemoveKey] = useState(false)
  const save = useSaveChatEndpoint()
  const test = useTestChatEndpoint()

  const hasStoredKey = Boolean(endpoint?.hasKey) && !removeKey

  /** What to send for the key: new value, removal, or nothing (keep). */
  const keyField = (): Pick<ChatEndpointInput, "apiKey"> => {
    if (apiKey.trim()) return { apiKey: apiKey.trim() }
    if (removeKey) return { apiKey: "" }
    return endpoint ? {} : { apiKey: "" }
  }

  const runTest = () =>
    test.mutate({
      id: endpoint?.id,
      apiUrl,
      ...keyField(),
    })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: endpoint?.id,
        input: { name: name.trim(), apiUrl, uiUrl, ...keyField() },
      },
      { onSuccess: onDone }
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="text-sm font-medium">
        {endpoint ? `Edit ${endpoint.name}` : "Add an endpoint"}
      </div>
      <Field label="Name" hint="Shown in the chat's model picker.">
        <Input
          value={name}
          placeholder="verdun"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <Field
        label="API URL"
        hint="Where the kanban server reaches llama.cpp. /v1 is added when missing."
      >
        <Input
          value={apiUrl}
          placeholder="https://llama.example.com"
          onChange={(e) => {
            setApiUrl(e.target.value)
            test.reset()
          }}
        />
      </Field>
      <Field
        label="UI URL (optional)"
        hint="Opened by your browser from the chat. Blank: derived from the API URL."
      >
        <Input
          value={uiUrl}
          placeholder="https://llama.example.com/"
          onChange={(e) => setUiUrl(e.target.value)}
        />
      </Field>
      <Field
        label="API key (optional)"
        hint="For llama-server --api-key, or a proxy expecting a bearer token."
      >
        {hasStoredKey && !apiKey ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" />A key is saved.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRemoveKey(true)}
            >
              Remove
            </Button>
            <span>or type a new one:</span>
          </div>
        ) : removeKey ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            The saved key will be removed.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRemoveKey(false)}
            >
              Undo
            </Button>
          </div>
        ) : null}
        {!removeKey && (
          <Input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            placeholder={hasStoredKey ? "New key (leave blank to keep)" : ""}
            onChange={(e) => {
              setApiKey(e.target.value)
              test.reset()
            }}
          />
        )}
      </Field>

      {test.data && (
        <p
          className={cn(
            "text-xs",
            test.data.reachable
              ? "text-green-600 dark:text-green-500"
              : "text-destructive"
          )}
        >
          {test.data.reachable
            ? `Connected to ${test.data.apiUrl}: ${test.data.models.map((m) => m.id).join(", ") || "no models"}`
            : `${test.data.apiUrl}: ${test.data.error ?? "unreachable"}`}
        </p>
      )}
      {(test.error || save.error) && (
        <p className="text-xs text-destructive">
          {(save.error ?? test.error)?.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!apiUrl.trim() || test.isPending}
          onClick={runTest}
        >
          {test.isPending ? <LoaderCircle className="animate-spin" /> : null}
          Test
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={save.isPending || !name.trim() || !apiUrl.trim()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      <span className="text-[0.7rem] text-muted-foreground">{hint}</span>
    </label>
  )
}
