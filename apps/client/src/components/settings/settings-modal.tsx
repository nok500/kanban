import { CardContent, Modal, ModalContent, ModalHeader } from "@kanban/ui-kit"
import { BookOpen, BrainCircuit, Server, Users } from "lucide-react"
import { FaGithub } from "react-icons/fa"
import { isSyncConfigured } from "@kanban/core"
import { useAuth } from "@/lib/hooks"
import { SettingsSection } from "./section"
import { SettingsRow } from "./settings-row"
import { CardViewSection } from "./sections/card-view"
import { UpdatesSection } from "./sections/updates"

interface IProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenAccounts: () => void
  onOpenLlm: () => void
  onOpenServerMcp: () => void
}

export function SettingsModal({
  open,
  onOpenChange,
  onOpenAccounts,
  onOpenLlm,
  onOpenServerMcp,
}: IProps) {
  const { isAdmin, authed } = useAuth()

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="md:max-w-sm">
        <ModalHeader onClose={() => onOpenChange(false)}>Settings</ModalHeader>
        <CardContent className="flex flex-col overflow-y-auto px-0">
          <UpdatesSection />
          <CardViewSection />
          <SettingsSection>
            <div className="flex flex-col">
              {isAdmin && (
                <SettingsRow
                  icon={<Users className="size-4" />}
                  label="Accounts"
                  onClick={onOpenAccounts}
                />
              )}
              {isSyncConfigured() && authed === true && (
                <SettingsRow
                  icon={<BrainCircuit className="size-4" />}
                  label="LLM"
                  onClick={onOpenLlm}
                />
              )}
              {isSyncConfigured() && authed === true && (
                <SettingsRow
                  icon={<Server className="size-4" />}
                  label="Server MCP"
                  onClick={onOpenServerMcp}
                />
              )}
              <SettingsRow
                icon={<BookOpen className="size-4" />}
                label="Docs"
                href="https://github.com/nok500/kanban#readme"
              />
              <SettingsRow
                icon={<FaGithub className="size-4" />}
                label="GitHub"
                href="https://github.com/nok500/kanban"
              />
            </div>
          </SettingsSection>
        </CardContent>
      </ModalContent>
    </Modal>
  )
}
