import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@kanban/ui-kit"
import { Bot, MessagesSquare, Sparkles, Terminal } from "lucide-react"
import { useCardChatOpener } from "@/lib/chat/card-chat-opener"

/** Header control: opens a chat about the whole card with a chosen provider. */
export function CardChatButton() {
  const chat = useCardChatOpener()
  if (!chat) return null

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Chat about this card"
            tooltip={false}
          />
        }
      >
        <MessagesSquare />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onClick={() => chat.openChat()}>
          <Terminal />
          llama.cpp
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled>
          <Sparkles />
          Gemini (soon)
        </MenuItem>
        <MenuItem disabled>
          <Bot />
          Claude (soon)
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
