import { SidebarMenuButton, SidebarMenuItem } from "@kanban/ui-kit"
import { useLocation } from "wouter"
import { routes } from "@/lib/routes"

/** Sidebar entry that opens the templates. */
export function TemplatesButton() {
  const [location, navigate] = useLocation()
  const isActive = location === routes.templates()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip="Templates"
        onClick={() => navigate(`~${routes.templates()}`)}
      >
        <span>Templates</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
