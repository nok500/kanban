import { describe, expect, test } from "vitest"
import {
  parseMarkdown,
  renderMarkdown,
  type BlockInfo,
  type MarkdownAdapter,
} from "@kanban/markdown"
import { focusOf, isChatBlock } from "./chat-blocks"

/** An adapter that renders every node as a plain tagged object. */
const adapter = new Proxy({} as MarkdownAdapter, {
  get:
    (_target, type) =>
    (...args: unknown[]) => ({ type, args }),
})

/** Runs the real renderer and records every block offered to the hook. */
function offered(body: string): BlockInfo[] {
  const seen: BlockInfo[] = []
  void renderMarkdown(parseMarkdown(body), adapter, {
    source: body,
    decorateBlock: (block, content) => {
      seen.push(block)
      return content
    },
  })
  return seen
}

const CARD = [
  "Some JD text before the analysis.",
  "",
  "- a requirement",
  "",
  "---",
  "",
  "## Fit Analysis: Acme",
  "",
  "**Verdict:** strong fit.",
  "",
  "### Matching Skills",
  "- **Kubernetes:** ran 100 clusters",
  "- **Go:** wrote operators",
  "  - nested detail",
  "",
  "### Gaps",
  "1. No Rust",
  "",
  "> a quote",
  "",
  "process as job-id: 12",
].join("\n")

describe("decorateBlock", () => {
  test("offers top-level blocks and top-level list items, with exact source", () => {
    const blocks = offered(CARD)
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["paragraph", "Some JD text before the analysis."],
      ["listItem", "- a requirement"],
      ["paragraph", "**Verdict:** strong fit."],
      ["listItem", "- **Kubernetes:** ran 100 clusters"],
      // A nested list rides along with its item; it is not offered itself.
      ["listItem", "- **Go:** wrote operators\n  - nested detail"],
      ["listItem", "1. No Rust"],
      ["blockquote", "> a quote"],
      ["paragraph", "process as job-id: 12"],
    ])
  })

  test("tracks the section heading and whether a --- came before", () => {
    const blocks = offered(CARD)
    expect(blocks.map((b) => [b.section, b.afterRule])).toEqual([
      [null, false],
      [null, false],
      ["Fit Analysis: Acme", true],
      ["Matching Skills", true],
      ["Matching Skills", true],
      ["Gaps", true],
      ["Gaps", true],
      ["Gaps", true],
    ])
  })

  test("without the hook, nothing is offered and the output is unchanged", () => {
    const tree = parseMarkdown(CARD)
    const plain = renderMarkdown(tree, adapter)
    const hooked = renderMarkdown(tree, adapter, {
      source: CARD,
      decorateBlock: (_b, content) => content,
    })
    expect(JSON.stringify(hooked)).toBe(JSON.stringify(plain))
  })

  test("task checkbox indexes are unaffected by decoration", () => {
    const body = "---\n\n- [ ] one\n- [ ] two"
    const toggled: number[] = []
    const out = renderMarkdown(parseMarkdown(body), adapter, {
      source: body,
      onToggleTask: (i) => toggled.push(i),
      decorateBlock: (_b, content) => content,
    }) as unknown as { args: unknown[] }[]
    // list → items → each item's marker carries its onToggle.
    const list = out[1].args[2] as { args: [{ onToggle: () => void }] }[]
    list.forEach((item) => item.args[0].onToggle())
    expect(toggled).toEqual([0, 1])
  })
})

describe("which blocks get a chat button", () => {
  test("only the analysis after ---, without the job-id marker", () => {
    const chosen = offered(CARD)
      .filter(isChatBlock)
      .map((b) => b.text)
    expect(chosen).toEqual([
      "**Verdict:** strong fit.",
      "- **Kubernetes:** ran 100 clusters",
      "- **Go:** wrote operators\n  - nested detail",
      "1. No Rust",
      "> a quote",
    ])
  })

  test("a card with no --- gets no buttons", () => {
    expect(offered("just a note\n\n- with a list").filter(isChatBlock)).toEqual(
      []
    )
  })

  test("focus carries the passage and its section", () => {
    const go = offered(CARD).find((b) => b.text.startsWith("- **Go"))!
    expect(focusOf(go)).toEqual({
      text: "- **Go:** wrote operators\n  - nested detail",
      section: "Matching Skills",
    })
  })
})
