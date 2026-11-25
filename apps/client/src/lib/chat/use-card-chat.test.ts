import { describe, expect, test } from "vitest"
import { messageContent, type ChatTurn } from "./use-card-chat"

describe("messageContent", () => {
  test("a plain message is sent as typed", () => {
    const turn: ChatTurn = { id: "1", role: "user", content: "Summarize" }
    expect(messageContent(turn)).toBe("Summarize")
  })

  test("a message about a passage quotes it, with its section, before the question", () => {
    const turn: ChatTurn = {
      id: "1",
      role: "user",
      content: "How do I address this?",
      focus: { text: "- **Rust:** none\n  - learn it", section: "Gaps" },
    }
    expect(messageContent(turn)).toBe(
      [
        'About this passage of the card (under "Gaps"):',
        "",
        "> - **Rust:** none",
        ">   - learn it",
        "",
        "How do I address this?",
      ].join("\n")
    )
  })

  test("no section, no 'under'", () => {
    const turn: ChatTurn = {
      id: "1",
      role: "user",
      content: "Explain",
      focus: { text: "Verdict: strong fit.", section: null },
    }
    expect(messageContent(turn)).toBe(
      "About this passage of the card:\n\n> Verdict: strong fit.\n\nExplain"
    )
  })

  test("assistant turns are never rewritten", () => {
    const turn: ChatTurn = { id: "2", role: "assistant", content: "Sure." }
    expect(messageContent(turn)).toBe("Sure.")
  })
})
