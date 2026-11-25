import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  cn,
} from "@kanban/ui-kit"
import { CircleCheck, CircleX, ListChecks, LoaderCircle } from "lucide-react"
import type { Board } from "@kanban/core"
import {
  cardAgent,
  isAnaliseColumn,
  isProcessed,
  type AgentName,
} from "@/lib/agents/agent-rules"
import { useLlmSettings, type LlmSettings } from "@/lib/hooks/use-llm-settings"
import { useAgentRules } from "@/providers/agent-rules/agent-rules-context"

const AGENTS: AgentName[] = ["claude", "agy", "pi"]

interface Check {
  label: string
  ok: boolean | null
  detail: string
}

function agentsCheck(
  settings: LlmSettings | undefined,
  loading: boolean,
  needed: AgentName[]
): { check: Check; perAgent: Check[] } {
  if (loading || !settings) {
    return {
      check: { label: "Agents reachable", ok: null, detail: "Checking…" },
      perAgent: [],
    }
  }
  if (!settings.runnerReachable) {
    return {
      check: {
        label: "Agents reachable",
        ok: false,
        detail: "agent-runner is unreachable",
      },
      perAgent: [],
    }
  }
  const online = settings.providers.find((p) => p.online && p.model)
  const piProvider = settings.agents.find((a) => a.agent === "pi")?.provider
  const piOn = piProvider
    ? settings.providers.find((p) => p.name === piProvider)
    : online
  const perAgent = AGENTS.map((agent): Check => {
    const entry = settings.agents.find((a) => a.agent === agent)
    const s = entry?.status
    if (!s?.ok) {
      return {
        label: agent,
        ok: false,
        detail:
          s?.error ??
          (s?.missing.length ? `missing ${s.missing.join(", ")}` : "not found"),
      }
    }
    if (agent === "pi" && !(piOn?.online && piOn.model)) {
      return {
        label: agent,
        ok: false,
        detail: piProvider ? `${piProvider} is offline` : "no provider online",
      }
    }
    const via =
      agent === "pi"
        ? `on ${piOn?.name}`
        : entry?.mode === "apiKey"
          ? "API key"
          : "installed"
    return { label: agent, ok: true, detail: via }
  })
  const okOf = (agent: AgentName) => perAgent.find((c) => c.label === agent)?.ok
  const ok = needed.length
    ? needed.every((a) => okOf(a))
    : perAgent.some((c) => c.ok)
  const detail = needed.length
    ? `Needed here: ${needed.join(", ")}`
    : `${perAgent.filter((c) => c.ok).length} of ${AGENTS.length} ready`
  return { check: { label: "Agents reachable", ok, detail }, perAgent }
}

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
    )
  }
  return ok ? (
    <CircleCheck className="size-4 text-emerald-600" />
  ) : (
    <CircleX className="size-4 text-destructive" />
  )
}

/**
 * Beside the sync status: whether this board is set up for agents to run —
 * LLM on for Analise, a CV in Docs, and the agents its cards need reachable.
 */
export function AgentChecklist({ board }: { board: Board }) {
  const rules = useAgentRules()
  const analise = board.columns.filter(
    (c) => !c.deletedAt && isAnaliseColumn(c)
  )
  const settings = useLlmSettings(Boolean(rules?.available && analise.length))
  if (!rules?.available || analise.length === 0) return null

  const llmOn = analise.filter((c) => rules.isLlmColumn(c.id))
  const waiting = board.cards.filter(
    (c) =>
      !c.deletedAt &&
      llmOn.some((col) => col.id === c.columnId) &&
      !isProcessed(c)
  )
  const needed = [
    ...new Set(waiting.map(cardAgent).filter((a): a is AgentName => !!a)),
  ]

  const llm: Check = {
    label: "LLM on in Analise",
    ok: llmOn.length > 0,
    detail: llmOn.length > 0 ? "Cards there get analysed" : "Off: nothing runs",
  }
  const cv: Check = {
    label: "CV in Docs",
    ok: rules.cvs.length > 0,
    detail:
      rules.cvs.length === 0
        ? "Attach a CV to a card in Docs"
        : rules.cvs.length === 1
          ? `${rules.cvs[0].title || "1 card"}`
          : `${rules.cvs.length} CV cards: picked per card`,
  }
  const agents = agentsCheck(settings.data, settings.isLoading, needed)
  const checks = [llm, cv, agents.check]
  const passed = checks.filter((c) => c.ok).length
  const allOk = passed === checks.length

  return (
    <Menu onOpenChange={(open) => open && void settings.refetch()}>
      <MenuTrigger
        render={
          <Button
            variant="secondary"
            aria-label={`Agent checklist: ${passed} of ${checks.length} ready`}
            tooltip={false}
            className={cn(
              allOk
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-400"
            )}
          />
        }
      >
        <ListChecks />
        <span>
          LLM {passed}/{checks.length}
        </span>
      </MenuTrigger>
      <MenuContent side="top" align="end" className="w-72 py-1">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Agents on this board
        </div>
        {checks.map((c) => (
          <div key={c.label} className="flex items-start gap-2 px-3 py-1.5">
            <Mark ok={c.ok} />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.detail}</span>
            </span>
          </div>
        ))}
        {agents.perAgent.length > 0 && (
          <div className="flex flex-col gap-0.5 px-3 pb-1.5 pl-9">
            {agents.perAgent.map((a) => (
              <span
                key={a.label}
                className={cn(
                  "flex gap-1.5 text-xs",
                  a.ok ? "text-muted-foreground" : "text-destructive"
                )}
              >
                <span className="font-medium">{a.label}</span>
                <span className="truncate">{a.detail}</span>
              </span>
            ))}
          </div>
        )}
        {llmOn.length === 0 && (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() =>
                analise.forEach((c) => rules.toggleLlmColumn(c.id, true))
              }
            >
              Turn LLM on for{" "}
              {analise.length === 1 ? "Analise" : "Analise columns"}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
