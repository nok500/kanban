import { CardContent, Modal, ModalContent, ModalHeader } from "@doska/ui-kit"
import { ChatEndpointsManager } from "./chat-endpoints-manager"

interface IProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatEndpointsModal({ open, onOpenChange }: IProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="md:max-w-lg">
        <ModalHeader onClose={() => onOpenChange(false)}>
          LLM endpoints
        </ModalHeader>
        <CardContent className="overflow-y-auto py-4">
          {open && <ChatEndpointsManager />}
        </CardContent>
      </ModalContent>
    </Modal>
  )
}
