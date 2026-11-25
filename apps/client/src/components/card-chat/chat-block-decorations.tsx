import { Button } from "@kanban/ui-kit"
import { MessageSquareText } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import {
  MarkdownRenderersProvider,
  useMarkdownRenderers,
  type DecorateBlock,
} from "@kanban/markdown"
import { useCardChatOpener } from "@/lib/chat/card-chat-opener"
import { focusOf, isChatBlock } from "@/lib/chat/chat-blocks"

/**
 * Re-provides the body's markdown renderers with a chat button on each block
 * of the analysis. Mount it inside `CardMarkdown`, around the open card's body,
 * and only while previewing: the editor has its own text to click into.
 */
export function ChatBlockDecorations({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const parent = useMarkdownRenderers()
  const chat = useCardChatOpener()

  const value = useMemo(() => {
    if (!enabled || !chat) return parent
    const decorateBlock: DecorateBlock = (block, content, key) =>
      isChatBlock(block) ? (
        <ChatBlock key={key} onChat={() => chat.openChat(focusOf(block))}>
          {content}
        </ChatBlock>
      ) : (
        content
      )
    return { ...parent, decorateBlock }
  }, [enabled, chat, parent])

  return (
    <MarkdownRenderersProvider value={value}>
      {children}
    </MarkdownRenderersProvider>
  )
}

function ChatBlock({
  onChat,
  children,
}: {
  onChat: () => void
  children: ReactNode
}) {
  return (
    <div className="group/chat relative pr-8">
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        tooltip={false}
        title="Chat about this"
        aria-label="Chat about this"
        onClick={(e) => {
          e.stopPropagation()
          onChat()
        }}
        className="absolute top-0 right-0 text-muted-foreground opacity-0 transition-opacity group-hover/chat:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
      >
        <MessageSquareText />
      </Button>
    </div>
  )
}
