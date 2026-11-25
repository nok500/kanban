import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@kanban/ui-kit"
import { Plus, SquareDashedPlus, SquareText } from "lucide-react"
import {
  BUILTIN_BOARD_TEMPLATES,
  useDashboards,
  useFillBoard,
} from "@kanban/core"
import { CenteredState } from "../digest/centered-state"

interface IProps {
  boardId: string
}

/** A board with no columns: start it from a template, or blank. */
export function BoardEmptyState({ boardId }: IProps) {
  const { data: dashboards = [] } = useDashboards()
  const { mutate: fill, isPending } = useFillBoard(boardId)
  const templates = dashboards.filter((d) => d.template && d.id !== boardId)

  return (
    <div className="flex w-full items-center justify-center px-4">
      <CenteredState
        icon={<SquareDashedPlus className="size-8 text-muted-foreground" />}
      >
        <p className="text-sm text-muted-foreground">
          This board is empty. How do you want to start?
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="secondary"
                  disabled={isPending}
                  tooltip={false}
                />
              }
            >
              <SquareText />
              From template
            </MenuTrigger>
            <MenuContent>
              {BUILTIN_BOARD_TEMPLATES.map((template) => (
                <MenuItem key={template.id} onClick={() => fill(template.id)}>
                  {template.title}
                </MenuItem>
              ))}
              {templates.length > 0 && <MenuSeparator />}
              {templates.map((template) => (
                <MenuItem key={template.id} onClick={() => fill(template.id)}>
                  {template.title || "Untitled board"}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Button
            variant="secondary"
            disabled={isPending}
            onClick={() => fill(undefined)}
          >
            <Plus />
            Empty
          </Button>
        </div>
      </CenteredState>
    </div>
  )
}
