import { Button, Card as CardBase, columnHue } from "@kanban/ui-kit"
import { LayoutTemplate } from "lucide-react"
import {
  useCreateBoardFromTemplate,
  type BuiltinBoardTemplate,
} from "@kanban/core"
import { useDashboardNav } from "@/lib/hooks/use-dashboard-nav"

/** A layout that ships with the app: its columns, and a button to use it. */
export function BuiltinTemplateRow({
  template,
}: {
  template: BuiltinBoardTemplate
}) {
  const { mutate: create, isPending } = useCreateBoardFromTemplate()
  const { selectDashboard } = useDashboardNav()

  return (
    <li>
      <CardBase className="flex-col items-stretch gap-2 rounded-xl px-3 py-3">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium">
              {template.title}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {template.description}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={() =>
              create(template, {
                onSuccess: (created) => selectDashboard(created.id),
              })
            }
          >
            New board
          </Button>
        </div>
        <ul
          aria-label={`${template.title} columns`}
          className="flex flex-wrap gap-1.5 pl-7"
        >
          {template.columns.map((c) => {
            const hue = columnHue(c.color)
            return (
              <li
                key={c.title}
                className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
                style={
                  hue === null
                    ? undefined
                    : { borderColor: `oklch(0.7 0.12 ${hue})` }
                }
              >
                {c.title}
                {c.done ? " ✓" : ""}
              </li>
            )
          })}
        </ul>
      </CardBase>
    </li>
  )
}
