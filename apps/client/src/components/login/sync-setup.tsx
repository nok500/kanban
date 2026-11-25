import { UNCLAIMED_BOARDS_WARNING, useUnclaimedLocalBoards } from "@kanban/core"
import { PasswordLogin } from "./password-login"

interface IProps {
  onDone: () => void
  onCancel?: () => void
}

export function SyncSetup({ onDone, onCancel }: IProps) {
  const { data: unclaimedBoards } = useUnclaimedLocalBoards()

  return (
    <div className="flex flex-col gap-4">
      {unclaimedBoards && (
        <p className="text-muted-foreground">{UNCLAIMED_BOARDS_WARNING}</p>
      )}

      <PasswordLogin onDone={onDone} onCancel={onCancel} />
    </div>
  )
}
