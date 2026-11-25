import { Button, Toast } from "@kanban/ui-kit"
import { Download } from "lucide-react"
interface IProps {
  installing: boolean
  visible: boolean
  onInstall: () => void
}

export function UpdateToastContent({
  installing,
  visible,
  onInstall,
}: IProps) {
  return (
    <Toast visible={visible} className="max-w-md gap-3">
      <span className="min-w-0">An update is available</span>
      <Button
        size="sm"
        className="shrink-0"
        disabled={installing}
        onClick={onInstall}
      >
        <Download className="size-4" />
        {installing ? "Loading…" : "Reload"}
      </Button>
    </Toast>
  )
}
