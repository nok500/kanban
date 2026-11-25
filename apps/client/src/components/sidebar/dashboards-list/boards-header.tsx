import { Button, SidebarGroupLabel } from "@kanban/ui-kit"
import { Folder, Plus } from "lucide-react"
import { useLocation } from "wouter"
import { routes } from "@/lib/routes"

interface IProps {
  onNewFolder: () => void
}

export function BoardsHeader({ onNewFolder }: IProps) {
  const [, navigate] = useLocation()
  return (
    <SidebarGroupLabel className="mb-1 gap-1 rounded-none pr-0">
      <span className="flex-1 text-sm">Boards</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="New folder"
        className="text-muted-foreground"
        onClick={onNewFolder}
      >
        <Folder />
      </Button>
      {/* New boards start from a layout, picked on the Templates page. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="New board"
        className="text-muted-foreground"
        onClick={() => navigate(`~${routes.templates()}`)}
      >
        <Plus />
      </Button>
    </SidebarGroupLabel>
  )
}
