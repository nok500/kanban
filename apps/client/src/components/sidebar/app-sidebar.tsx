import { useParams } from "wouter"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  cn,
} from "@kanban/ui-kit"
import { usePublishedBoards, useSharedBoards } from "@kanban/core"
import { useAuth } from "@/lib/hooks"
import { AppSidebarHeader } from "./app-sidebar-header"
import { DashboardsList } from "./dashboards-list/dashboards-list"
import { SidebarAccount } from "./sidebar-account"
import { SidebarAgentsMonitor } from "./sidebar-agents-monitor"
import { TrashButton } from "@/components/trash/trash-button"
import { UpcomingButton } from "@/components/digest/upcoming-button"
import { TemplatesButton } from "@/components/templates/templates-button"

export function AppSidebar() {
  const { authed } = useAuth()
  const { data: sharedIds = [] } = useSharedBoards(authed === true)
  const { data: publishedIds = [] } = usePublishedBoards(authed === true)

  const activeDashboardId = useParams().id ?? ""

  return (
    <Sidebar className="ml-1">
      <AppSidebarHeader />
      <SidebarAgentsMonitor />
      <SidebarContent className="group/sidebar">
        <div
          aria-hidden
          className="pointer-events-none sticky top-0 z-10 h-6 shrink-0 bg-linear-to-b from-sidebar to-transparent"
        />
        <SidebarGroup>
          <SidebarMenu>
            <UpcomingButton />
            <TemplatesButton />
            <TrashButton />
          </SidebarMenu>
        </SidebarGroup>
        <DashboardsList
          activeDashboardId={activeDashboardId}
          sharedIds={sharedIds}
          publishedIds={publishedIds}
        />
      </SidebarContent>
      <SidebarFooter
        className={cn(
          "relative pt-2",
          "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8",
          "before:bg-linear-to-t before:from-sidebar before:to-transparent"
        )}
      >
        <SidebarAccount />
      </SidebarFooter>
    </Sidebar>
  )
}
