import { createContext, useContext } from "react"
import type { ChatFocus } from "./use-card-chat"

export interface CardChatApi {
  /** Opens the chat about the whole card, or about one passage of it. */
  openChat: (focus?: ChatFocus) => void
}

export const CardChatContext = createContext<CardChatApi | null>(null)

/** Null outside an open card (e.g. a public board); callers render nothing. */
export function useCardChatOpener(): CardChatApi | null {
  return useContext(CardChatContext)
}
