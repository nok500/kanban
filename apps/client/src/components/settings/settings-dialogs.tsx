import { useState } from "react"
import { AccountsModal } from "@/components/accounts/accounts-modal"
import { LlmSettingsModal } from "@/components/llm-settings/llm-settings-modal"
import { ServerMcpModal } from "@/components/server-mcp/server-mcp-modal"
import { SettingsModal } from "./settings-modal"

interface IProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The settings modal and the dialogs it opens (one at a time). */
export function SettingsDialogs({ open, onOpenChange }: IProps) {
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [llmOpen, setLlmOpen] = useState(false)
  const [serverMcpOpen, setServerMcpOpen] = useState(false)

  // Stacked dialogs trap focus in each other, so settings steps aside.
  const openInstead = (open: (value: boolean) => void) => () => {
    onOpenChange(false)
    open(true)
  }

  return (
    <>
      <SettingsModal
        open={open}
        onOpenChange={onOpenChange}
        onOpenAccounts={openInstead(setAccountsOpen)}
        onOpenLlm={openInstead(setLlmOpen)}
        onOpenServerMcp={openInstead(setServerMcpOpen)}
      />
      <AccountsModal open={accountsOpen} onOpenChange={setAccountsOpen} />
      <LlmSettingsModal open={llmOpen} onOpenChange={setLlmOpen} />
      <ServerMcpModal open={serverMcpOpen} onOpenChange={setServerMcpOpen} />
    </>
  )
}
