import { cn, SidebarHeader, SidebarMenu, SidebarMenuItem } from "@kanban/ui-kit"
import { Link } from "wouter"

export function AppSidebarHeader() {
  return (
    <SidebarHeader
      className={cn("mt-0.5 pt-[calc(--spacing(2)+env(safe-area-inset-top))]")}
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <Link to="~/">
            <div className="flex items-center">
              <span className="cn-font-heading text-base text-[17px]">
                Kanban
              </span>
            </div>
          </Link>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  )
}
