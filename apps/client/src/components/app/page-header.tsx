import { SidebarTrigger, cn } from "@kanban/ui-kit"
import type { ReactNode } from "react"

interface IProps {
  className?: string
  children?: ReactNode
}

/** Top bar of a page: the sidebar toggle, then whatever the page puts beside it. */
export function PageHeader({ className, children }: IProps) {
  return (
    <header
      className={cn(
        "flex min-h-11.5 shrink-0 items-center gap-2 border-b px-4",
        "pt-[env(safe-area-inset-top)]",
        className
      )}
    >
      <SidebarTrigger />
      {children}
    </header>
  )
}
