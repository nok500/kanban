import { useCallback, useMemo, useState, type ReactNode } from "react"
import { fallbackCard, useCard } from "@doska/core"
import { CardChatContext } from "@/lib/chat/card-chat-opener"
import type { ChatFocus } from "@/lib/chat/use-card-chat"
import { CardChatModal } from "./card-chat-modal"

interface IProps {
  cardId: string
  /** The live draft, so unsaved edits are part of the chat's context. */
  title: string
  body: string
  children: ReactNode
}

/**
 * Owns the open card's one chat modal, so the header button and the
 * per-paragraph buttons in the body open the same one.
 */
export function CardChatProvider({ cardId, title, body, children }: IProps) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<ChatFocus | null>(null)
  const { data: card = fallbackCard } = useCard(cardId)

  const openChat = useCallback((next?: ChatFocus) => {
    setFocus(next ?? null)
    setOpen(true)
  }, [])
  const api = useMemo(() => ({ openChat }), [openChat])

  return (
    <CardChatContext.Provider value={api}>
      {children}
      <CardChatModal
        open={open}
        onOpenChange={setOpen}
        cardId={cardId}
        card={{ title, body, tags: card.tags ?? [] }}
        initialFocus={focus}
      />
    </CardChatContext.Provider>
  )
}
