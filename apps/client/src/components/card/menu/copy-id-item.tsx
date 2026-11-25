import { MenuItem, MenuSeparator } from "@kanban/ui-kit"
import { Hash } from "lucide-react"
import { useCard } from "@kanban/core"
import { cardDisplayId } from "@kanban/contract"

/** Copies the card's display id. Nothing to copy on a card that has never
 *  synced — its number is stamped there. */
export function CopyIdItem({ cardId }: { cardId: string }) {
  const { data: card } = useCard(cardId)

  const displayId = cardDisplayId(card?.number)
  if (!displayId) return null

  return (
    <>
      <MenuSeparator />
      <MenuItem onClick={() => void navigator.clipboard?.writeText(displayId)}>
        <Hash />
        Copy id
      </MenuItem>
    </>
  )
}
