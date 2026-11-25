import { SidebarMenuButton, SidebarMenuItem } from "@doska/ui-kit"
import { Settings } from "lucide-react"
import { useState } from "react"
import { AccountsModal } from "@/components/accounts/accounts-modal"
import { ChatEndpointsModal } from "@/components/chat-endpoints/chat-endpoints-modal"
import { LocalMcpModal } from "@/components/local-mcp/local-mcp-modal"
import { ServerMcpModal } from "@/components/server-mcp/server-mcp-modal"
import { SettingsModal } from "./settings-modal"

/** Sidebar entry that opens the settings modal. */
export function SettingsButton() {
  const [open, setOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [chatEndpointsOpen, setChatEndpointsOpen] = useState(false)
  const [localMcpOpen, setLocalMcpOpen] = useState(false)
  const [serverMcpOpen, setServerMcpOpen] = useState(false)

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => setOpen(true)}>
          <Settings className="size-4" />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SettingsModal
        open={open}
        onOpenChange={setOpen}
        onOpenAccounts={() => {
          // Stacked dialogs trap focus in each other, so settings steps aside.
          setOpen(false)
          setAccountsOpen(true)
        }}
        onOpenChatEndpoints={() => {
          setOpen(false)
          setChatEndpointsOpen(true)
        }}
        onOpenLocalMcp={() => {
          setOpen(false)
          setLocalMcpOpen(true)
        }}
        onOpenServerMcp={() => {
          setOpen(false)
          setServerMcpOpen(true)
        }}
      />
      <AccountsModal open={accountsOpen} onOpenChange={setAccountsOpen} />
      <ChatEndpointsModal
        open={chatEndpointsOpen}
        onOpenChange={setChatEndpointsOpen}
      />
      <LocalMcpModal open={localMcpOpen} onOpenChange={setLocalMcpOpen} />
      <ServerMcpModal open={serverMcpOpen} onOpenChange={setServerMcpOpen} />
    </>
  )
}
