import { Droppable } from "@hello-pangea/dnd"
import { useState, type ReactNode } from "react"
import type { Card } from "@kanban/core"
import { ConfirmDialog } from "../confirm-dialog"
import { ColumnMenu } from "./column-menu"
import { ColumnView } from "./column-view"
import { LlmColumnToggle } from "../agents/llm-column-toggle"
import { isAnaliseColumn } from "@/lib/agents/agent-rules"
import { useAgentRules } from "@/providers/agent-rules/agent-rules-context"

interface IProps {
  children: ReactNode
  id: string
  title: string
  color: string
  showBody: boolean
  onToggleBody: () => void
  onAddCard?: () => void
  onAddFromTemplate?: (template: Card) => void
  addCardDisabledReason?: string
  onRename: (title: string) => void
  onChangeColor: (color: string) => void
  /** Cards in this column count as finished. */
  done: boolean
  onChangeDone: (done: boolean) => void
  onDelete: () => void
}

export function Column({
  children,
  id,
  title,
  color,
  showBody,
  onToggleBody,
  onAddCard,
  onAddFromTemplate,
  addCardDisabledReason,
  onRename,
  onChangeColor,
  done,
  onChangeDone,
  onDelete,
}: IProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const agentRules = useAgentRules()
  const llmToggle =
    agentRules && isAnaliseColumn({ title }) ? (
      <LlmColumnToggle
        enabled={agentRules.isLlmColumn(id)}
        onToggle={(enabled) => agentRules.toggleLlmColumn(id, enabled)}
        unavailable={
          agentRules.available
            ? undefined
            : "Sign in to a server to run agents on this column."
        }
      />
    ) : undefined

  return (
    <Droppable droppableId={id}>
      {(provided, snapshot) => (
        <ColumnView
          title={title}
          color={color}
          done={done}
          showBody={showBody}
          onToggleBody={onToggleBody}
          onRename={onRename}
          onAddCard={onAddCard}
          addCardDisabledReason={addCardDisabledReason}
          onAddFromTemplate={
            addCardDisabledReason ? undefined : onAddFromTemplate
          }
          isDraggingOver={snapshot.isDraggingOver}
          listRef={provided.innerRef}
          listProps={provided.droppableProps}
          llmToggle={llmToggle}
          menu={
            <>
              <ColumnMenu
                title={title}
                color={color}
                onChangeColor={onChangeColor}
                done={done}
                onChangeDone={onChangeDone}
                onDelete={() => setConfirmOpen(true)}
              />
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Delete column?"
                description={`"${title}" and all of its cards move to the trash, where they stay restorable for 14 days.`}
                confirmLabel="Delete column"
                onConfirm={onDelete}
              />
            </>
          }
        >
          {children}
          {provided.placeholder}
        </ColumnView>
      )}
    </Droppable>
  )
}
