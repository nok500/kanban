import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@kanban/ui-kit"
import { Info } from "lucide-react"

interface IProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  /** Why it can't be switched (signed out); shown instead of the toggle. */
  unavailable?: string
}

/** The LLM switch on an Analise column, with what it takes for a card to run. */
export function LlmColumnToggle({ enabled, onToggle, unavailable }: IProps) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="LLM: run agents on cards in this column"
        disabled={Boolean(unavailable)}
        onClick={() => onToggle(!enabled)}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded-full border px-1 pr-2 text-xs font-medium",
          enabled
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground hover:bg-muted",
          unavailable && "opacity-50"
        )}
      >
        <span
          className={cn(
            "relative h-4 w-7 rounded-full transition-colors",
            enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-3 rounded-full bg-background shadow-xs transition-[left]",
              enabled ? "left-3.5" : "left-0.5"
            )}
          />
        </span>
        LLM
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label="When cards here run"
              className="inline-flex text-muted-foreground"
            />
          }
        >
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-left">
          {unavailable ?? (
            <span className="flex flex-col gap-1">
              <span className="font-medium">
                With LLM on, a card here is analysed when:
              </span>
              <span>
                • it&apos;s tagged agy, claude or pi (the agent that runs);
              </span>
              <span>• the Docs column has a card with a CV attached;</span>
              <span>
                • with several CVs in Docs, you picked one for the card (asked
                when you drop it here).
              </span>
              <span className="text-muted-foreground">
                Off: cards here are left alone.
              </span>
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </span>
  )
}
