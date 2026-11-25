import {
  Button,
  CardContent,
  Modal,
  ModalContent,
  ModalHeader,
  cn,
} from "@kanban/ui-kit"
import { FileText } from "lucide-react"
import type { Card } from "@kanban/core"

interface IProps {
  /** The JD card a CV is being picked for; null keeps the dialog closed. */
  card: Card | null
  cvs: Card[]
  chosen: Card | null
  onPick: (cv: Card) => void
  onClose: () => void
}

/** Which Docs CV a JD card is analysed against, when Docs has several. */
export function CvPickerDialog({ card, cvs, chosen, onPick, onClose }: IProps) {
  return (
    <Modal open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="md:max-w-md">
        <ModalHeader onClose={onClose}>Which CV?</ModalHeader>
        <CardContent className="flex flex-col gap-3 py-4">
          <p className="text-sm text-muted-foreground">
            The agent analyses{" "}
            <span className="font-medium text-foreground">
              {card?.title || "this card"}
            </span>{" "}
            against one CV from Docs. Until you pick, the card waits in Analise.
          </p>
          <ul className="flex flex-col gap-1.5" aria-label="CVs in Docs">
            {cvs.map((cv) => (
              <li key={cv.id}>
                <button
                  type="button"
                  onClick={() => onPick(cv)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted",
                    chosen?.id === cv.id && "border-primary bg-primary/5"
                  )}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {cv.title || "Untitled card"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {cv.attachments.map((a) => a.name).join(", ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Decide later
            </Button>
          </div>
        </CardContent>
      </ModalContent>
    </Modal>
  )
}
