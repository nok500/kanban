import { useEffect, useState } from "react"
import { SquareText } from "lucide-react"
import {
  BUILTIN_BOARD_TEMPLATES,
  sync,
  useDashboards,
  useTemplateCards,
} from "@kanban/core"
import { Button } from "@kanban/ui-kit"
import { PageHeader } from "../app/page-header"
import { CenteredState } from "../digest/centered-state"
import { BoardTemplateRow } from "./board-template-row"
import { BuiltinTemplateRow } from "./builtin-template-row"
import { CardTemplateRow } from "./card-template-row"
import { TemplatesHelpButton } from "./templates-help-button"
import { TemplatesHelpModal } from "./templates-help-modal"

/** Everything marked as a template. Pulls every board, since a template card can
 * sit on one this device has not opened. */
export function TemplatesView() {
  const { data: dashboards = [], isPending } = useDashboards()
  const { data: cards = [] } = useTemplateCards()
  const [helpOpen, setHelpOpen] = useState(false)

  const boardIds = dashboards.map((d) => d.id).join(",")
  useEffect(() => {
    if (!boardIds) return
    void sync.reconcileBoards(boardIds.split(","))
  }, [boardIds])

  const boards = dashboards.filter((d) => d.template)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-base font-semibold">Templates</h1>
        <TemplatesHelpButton onClick={() => setHelpOpen(true)} />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Board layouts
            </h2>
            <ul aria-label="Built-in templates" className="flex flex-col gap-2">
              {BUILTIN_BOARD_TEMPLATES.map((template) => (
                <BuiltinTemplateRow key={template.id} template={template} />
              ))}
            </ul>
          </section>

          {!isPending && boards.length === 0 && cards.length === 0 && (
            <CenteredState
              icon={<SquareText className="size-8 text-muted-foreground" />}
            >
              <p className="max-w-sm text-sm text-muted-foreground">
                None of your own yet. <br />
                Pick "Add to templates" in a card's or a board's menu.
              </p>
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => setHelpOpen(true)}
              >
                How templates work
              </Button>
            </CenteredState>
          )}

          {boards.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Your boards
              </h2>
              <ul aria-label="Board templates" className="flex flex-col gap-2">
                {boards.map((board) => (
                  <BoardTemplateRow key={board.id} board={board} />
                ))}
              </ul>
            </section>
          )}

          {cards.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Cards
              </h2>
              <ul aria-label="Card templates" className="flex flex-col gap-2">
                {cards.map((entry) => (
                  <CardTemplateRow key={entry.card.id} entry={entry} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <TemplatesHelpModal open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
