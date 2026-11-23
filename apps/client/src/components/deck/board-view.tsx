import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@doska/ui-kit"

interface IProps {
  /** Omitted where the page around the board owns its top bar. */
  header?: ReactNode
  /** The columns. */
  children: ReactNode
  isLoading?: boolean
  /** Suppresses snapping, which fights a drag in progress. */
  isDragging?: boolean
  /** Pinned to the bottom-right corner — the sync indicator, where there is one. */
  footer?: ReactNode
}

function hasVerticalScroll(el: HTMLElement, stopAt: HTMLElement): boolean {
  let node: HTMLElement | null = el
  while (node && node !== stopAt) {
    if (node.scrollHeight > node.clientHeight) {
      const { overflowY } = getComputedStyle(node)
      if (overflowY === "auto" || overflowY === "scroll") return true
    }
    node = node.parentElement
  }
  return false
}

/** The board: a header over a horizontal row of columns. */
export function BoardView({
  header,
  children,
  isLoading,
  isDragging,
  footer,
}: IProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      if (e.deltaY === 0 || e.deltaX !== 0) return
      if (container.scrollWidth <= container.clientWidth) return
      if (
        e.target instanceof HTMLElement &&
        hasVerticalScroll(e.target, container)
      ) {
        return
      }

      const delta =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? e.deltaY * 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? e.deltaY * container.clientWidth
            : e.deltaY

      e.preventDefault()
      container.scrollLeft += delta
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {header}
      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 w-full flex-1 overflow-x-auto overflow-y-hidden overscroll-contain px-0 xs:px-6",
          !isDragging &&
            !isLoading &&
            "snap-x snap-mandatory scroll-px-0 xs:scroll-px-6 md:snap-none",
          "transition-opacity duration-1000",
          isLoading ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="flex h-full items-stretch gap-0 xs:gap-6">
          {children}
        </div>
      </div>
      {footer && <div className="absolute right-4 bottom-4 z-50">{footer}</div>}
    </div>
  )
}
