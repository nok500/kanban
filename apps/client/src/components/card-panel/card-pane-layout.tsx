import { CardContent } from "@kanban/ui-kit"
import type { ReactNode } from "react"
import { CardContentLayout } from "./card-content-layout"

interface IProps {
  header: ReactNode
  attachments: ReactNode
  notice?: ReactNode
  title: ReactNode
  body: ReactNode
  tags?: ReactNode
  /** Fired by clicking the body. */
  onClickBody?: (e: React.MouseEvent) => void
}

/** How a card reads in the panel, whether or not it can be edited there. */
export function CardPaneLayout({
  header,
  attachments,
  notice,
  title,
  body,
  tags,
  onClickBody,
}: IProps) {
  return (
    <>
      {header}
      <CardContentLayout>
        {tags}
        {attachments}
        {notice}
        <CardContent
          className="flex flex-1 flex-col border-t-0 px-4 pt-2"
          onClick={onClickBody}
        >
          {title}
          {body}
        </CardContent>
      </CardContentLayout>
    </>
  )
}
