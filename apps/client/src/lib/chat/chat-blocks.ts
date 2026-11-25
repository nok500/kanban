import type { BlockInfo } from "@kanban/markdown"
import type { ChatFocus } from "./use-card-chat"

/** The agent's own bookkeeping line, not something to chat about. */
const JOB_MARKER_RE = /process as job-id:/i

/**
 * Which blocks get a chat button: those after the card's first `---`, which is
 * where the analysis agent appends its write-up, minus empty ones and the
 * job-id marker.
 */
export function isChatBlock(block: BlockInfo): boolean {
  const text = block.text.trim()
  return block.afterRule && text.length > 0 && !JOB_MARKER_RE.test(text)
}

export function focusOf(block: BlockInfo): ChatFocus {
  return { text: block.text.trim(), section: block.section }
}
