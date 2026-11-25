import { useAccount } from "@kanban/core"
import {
  cn,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@kanban/ui-kit"
import {
  ChevronsUpDown,
  History,
  LogIn,
  Settings,
  UserRound,
} from "lucide-react"
import { useState } from "react"
import { useLoginPrompt } from "@/providers/login-prompt/login-prompt-context"
import { useTheme } from "@/providers/theme/theme-context"
import { THEME_ICON } from "@/lib/theme-display"
import { UserAvatar } from "@/components/accounts/user-avatar"
import { HistoryFeedModal } from "@/components/history/history-feed-modal"
import { SettingsDialogs } from "@/components/settings/settings-dialogs"
import { AccountModal } from "./account-modal"

/**
 * The user menu at the foot of the sidebar: account, theme, history and
 * settings in one dropdown.
 */
export function SidebarAccount() {
  const { session, name, subtitle, dropped, authed, pending } = useAccount()
  const openLogin = useLoginPrompt()
  const { theme, setTheme } = useTheme()
  const [accountOpen, setAccountOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const login = session?.login ?? null
  const signedOut = !authed && !pending
  const ThemeIcon = THEME_ICON[theme === "dark" ? "light" : "dark"]

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <Menu>
            <MenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  aria-label="User menu"
                  className="data-popup-open:bg-sidebar-accent"
                />
              }
            >
              <UserAvatar
                name={authed ? login : null}
                image={authed ? (session?.image ?? null) : null}
                className="size-8 rounded-full"
                fallbackClassName="rounded-full text-xs"
              />
              <div className="flex flex-col overflow-hidden text-left leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span
                  className={cn(
                    "truncate text-xs",
                    dropped ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {subtitle}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </MenuTrigger>
            <MenuContent align="start" side="top" className="min-w-56">
              {authed ? (
                <MenuItem onClick={() => setAccountOpen(true)}>
                  <UserRound />
                  Account
                </MenuItem>
              ) : signedOut ? (
                <MenuItem onClick={() => openLogin()}>
                  <LogIn />
                  Sign in to sync
                </MenuItem>
              ) : null}
              <MenuItem
                closeOnClick={false}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <ThemeIcon />
                {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => setHistoryOpen(true)}>
                <History />
                History
              </MenuItem>
              <MenuItem onClick={() => setSettingsOpen(true)}>
                <Settings />
                Settings
              </MenuItem>
            </MenuContent>
          </Menu>
        </SidebarMenuItem>
      </SidebarMenu>
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
      <HistoryFeedModal open={historyOpen} onOpenChange={setHistoryOpen} />
      <SettingsDialogs open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
