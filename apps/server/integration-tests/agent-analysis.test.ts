import { asc } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import { getDB } from "../src/db/get-db"
import { cards, user } from "../src/db/schema"
import {
  applyAgentResult,
  buildAnalysisPrompt,
  extractCvText,
  jobMarker,
  parseAnalysis,
} from "../src/routes/agent-analysis"
import { findPendingAgentCards } from "../src/routes/agents"
import { resetTables, rpcClient, startServer, type Harness } from "./harness"

/** A one-page PDF whose only text is `text`, with a correct xref table. */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return silentLog
  },
} as unknown as FastifyBaseLogger

const ANALYSIS = [
  "## Fit Analysis: SRE at Acme",
  "",
  "**Verdict:** strong fit.",
  "",
  "### Matching Skills & Experience",
  "- **Kubernetes:** ran 100 clusters",
  "",
  "### Gaps & Missing Requirements",
  "- **Rust:** none — take a course",
].join("\n")

let h: Harness
let ownerId: string

beforeAll(async () => {
  h = await startServer()
  const [owner] = await getDB()
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1)
  ownerId = owner.id
})

beforeEach(resetTables)

const now = 1_000

async function seedBoard() {
  const client = rpcClient(h)
  const column = (id: string, title: string, position: string) => ({
    store: "columns" as const,
    record: {
      id,
      title,
      position,
      dashboardId: "b1",
      collapsed: false,
      color: "",
      done: false,
      updatedAt: now,
      deletedAt: null,
    },
  })
  // The board row has its own, account-level channel.
  await client.dashboards.sync({
    since: 0,
    changes: [
      {
        store: "dashboards",
        record: {
          id: "b1",
          title: "Jobs",
          position: "a",
          updatedAt: now,
          deletedAt: null,
        },
      },
    ],
  })
  await client.board.sync({
    boardId: "b1",
    since: 0,
    changes: [
      column("c-analise", "Analise", "b"),
      column("c-follow", "Follow-up", "c"),
      column("c-nay", "Nay", "d"),
      column("c-other", "Elsewhere", "e"),
      {
        store: "cards",
        record: {
          id: "card1",
          title: "Acme: SRE",
          body: "JD: needs Kubernetes and Rust",
          position: "a",
          columnId: "c-analise",
          number: null,
          deadline: null,
          priority: "",
          tags: ["pi"],
          attachments: [],
          updatedAt: now,
          deletedAt: null,
        },
      },
    ],
  })
}

async function readCard() {
  const [row] = await getDB().select().from(cards)
  return row
}

// ---------------------------------------------------------------- units

describe("parseAnalysis", () => {
  test("splits off the trailing DECISION/MATCH lines", () => {
    expect(
      parseAnalysis(`${ANALYSIS}\n\nDECISION: follow-up\nMATCH: high`)
    ).toEqual({ analysis: ANALYSIS, decision: "follow-up", match: "high" })
  })

  test.each([
    ["**DECISION:** Nay", "nay"],
    ["Decision: follow up", "follow-up"],
    ["- DECISION: Follow-Up (worth it)", "follow-up"],
    ["`DECISION: nay`", "nay"],
  ])("tolerates formatting: %s", (line, decision) => {
    expect(parseAnalysis(`text\n\n${line}`).decision).toBe(decision)
  })

  test("the last decision wins, and inline mentions don't count", () => {
    const parsed = parseAnalysis(
      "If unsure, say DECISION: nay.\n\nDECISION: nay\nDECISION: follow-up"
    )
    expect(parsed.decision).toBe("follow-up")
    expect(parsed.analysis).toBe("If unsure, say DECISION: nay.")
  })

  test("drops inline <think> blocks", () => {
    expect(
      parseAnalysis("<think>hmm</think>\nAll good\nDECISION: nay")
    ).toEqual({ analysis: "All good", decision: "nay", match: null })
  })

  test("no verdict line → null", () => {
    expect(parseAnalysis("just prose").decision).toBeNull()
  })
})

describe("extractCvText", () => {
  test("reads a PDF's text", async () => {
    const cv = await extractCvText({
      name: "cv.pdf",
      mime: "application/pdf",
      bytes: makePdf("Jane Doe Kubernetes expert"),
    })
    expect(cv.text).toContain("Jane Doe Kubernetes expert")
  })

  test("reads text and markdown files", async () => {
    const cv = await extractCvText({
      name: "cv.md",
      mime: "application/octet-stream",
      bytes: Buffer.from("# Jane\nGo, Rust"),
    })
    expect(cv.text).toBe("# Jane\nGo, Rust")
  })

  test("explains what it can't read", async () => {
    const docx = await extractCvText({
      name: "cv.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: Buffer.from("PK..."),
    })
    expect(docx).toMatchObject({ text: null })
    expect(docx.note).toContain("unsupported")

    const broken = await extractCvText({
      name: "cv.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("not a pdf"),
    })
    expect(broken.text).toBeNull()
    expect(broken.note).toContain("could not read")
  })
})

describe("buildAnalysisPrompt", () => {
  test("names the role, carries the JD and CV text, asks for the verdict lines", () => {
    const { system, user: prompt } = buildAnalysisPrompt({
      title: "Acme: Senior SRE",
      body: "Needs Kubernetes.",
      cvs: [
        { name: "cv.pdf", text: "Jane, 10y Kubernetes" },
        { name: "old.docx", text: null, note: "unsupported format" },
      ],
    })
    expect(system).toContain("web_search")
    expect(system).toContain("never invent")
    expect(prompt).toContain("### Company & Application")
    expect(prompt).toContain("## Fit Analysis: Senior SRE at Acme")
    expect(prompt).toContain("Needs Kubernetes.")
    expect(prompt).toContain("## CV: cv.pdf\n\nJane, 10y Kubernetes")
    expect(prompt).toContain("old.docx: unsupported format")
    expect(prompt).toContain("DECISION: follow-up")
    expect(prompt).toContain("MATCH: high, medium or low")
  })

  test("says so when there is no CV", () => {
    const { user: prompt } = buildAnalysisPrompt({
      title: "SRE",
      body: "",
      cvs: [],
    })
    expect(prompt).toContain("No CV text is available")
  })
})

// ---------------------------------------------------------------- flow

/** What the server does when a `pi` job finishes in the agent-runner. */
const apply = (
  overrides: Partial<Parameters<typeof applyAgentResult>[0]> = {}
) =>
  applyAgentResult({
    userId: ownerId,
    boardId: "b1",
    cardId: "card1",
    jobId: "42",
    agent: "pi",
    ok: true,
    output: `${ANALYSIS}\n\nDECISION: follow-up\nMATCH: high`,
    durationMs: 12_400,
    log: silentLog,
    ...overrides,
  })

describe("applyAgentResult", () => {
  test("follow-up: appends the analysis, sets priority, moves the card", async () => {
    await seedBoard()
    expect(await apply()).toEqual({ decision: "follow-up" })

    const card = await readCard()
    expect(card.columnId).toBe("c-follow")
    expect(card.priority).toBe("high")
    expect(card.body).toBe(
      `JD: needs Kubernetes and Rust\n\n---\n\n_Thought for 12s · pi_\n\n${ANALYSIS}\n\n${jobMarker("42")}`
    )
  })

  test("nay: moves to Nay and leaves the priority alone", async () => {
    await seedBoard()
    await apply({ output: `${ANALYSIS}\n\nDECISION: nay\nMATCH: low` })
    const card = await readCard()
    expect(card.columnId).toBe("c-nay")
    expect(card.priority).toBe("")
  })

  test("a positive verdict without MATCH defaults to medium", async () => {
    await seedBoard()
    await apply({ output: `${ANALYSIS}\n\nDECISION: follow-up` })
    expect((await readCard()).priority).toBe("medium")
  })

  test("no verdict: the card stays, with a note", async () => {
    await seedBoard()
    expect(await apply({ output: ANALYSIS })).toEqual({ decision: null })
    const card = await readCard()
    expect(card.columnId).toBe("c-analise")
    expect(card.body).toContain("No DECISION line")
    expect(card.body).toContain(jobMarker("42"))
  })

  test("moved by hand meanwhile: records the analysis, doesn't move it back", async () => {
    await seedBoard()
    await getDB().update(cards).set({ columnId: "c-other" })
    await apply()
    const card = await readCard()
    expect(card.columnId).toBe("c-other")
    expect(card.body).toContain("## Fit Analysis")
  })

  test("a failed run: its output on the card, with the marker so it isn't retried in a loop", async () => {
    await seedBoard()
    await apply({
      ok: false,
      output: "Error: connect ECONNREFUSED 127.0.0.1:8081",
    })
    const card = await readCard()
    expect(card.columnId).toBe("c-analise")
    expect(card.body).toContain("**pi analysis failed** (job 42)")
    expect(card.body).toContain("ECONNREFUSED 127.0.0.1:8081")
    expect(card.body.endsWith(jobMarker("42"))).toBe(true)
  })

  test("an empty answer counts as a failure", async () => {
    await seedBoard()
    await apply({ output: "   " })
    expect((await readCard()).body).toContain("**pi analysis failed**")
  })

  test("a missing card is not an error", async () => {
    await expect(apply({ cardId: "gone" })).resolves.toEqual({
      decision: "follow-up",
    })
  })
})

describe("POST /api/agents/run", () => {
  test("rejects an unknown agent, naming pi among the valid ones", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/agents/run",
      headers: { cookie: h.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ boardId: "b1", cardId: "card1", agent: "gpt" }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("'pi'")
  })
})

describe("findPendingAgentCards", () => {
  const cardRecord = (
    id: string,
    columnId: string,
    extra: Record<string, unknown> = {}
  ) => ({
    store: "cards" as const,
    record: {
      id,
      title: "Acme: SRE",
      body: "JD",
      position: "a",
      columnId,
      number: null,
      deadline: null,
      priority: "",
      tags: [],
      attachments: [],
      updatedAt: now,
      deletedAt: null,
      ...extra,
    },
  })
  const columnRecord = (id: string, boardId: string, title: string) => ({
    store: "columns" as const,
    record: {
      id,
      title,
      position: title === "Docs" ? "z" : "b",
      dashboardId: boardId,
      collapsed: false,
      color: "",
      done: false,
      updatedAt: now,
      deletedAt: null,
    },
  })
  // Attachment keys are uuids; the CV's index makes each one distinct.
  const cv = (name: string, n: number) => ({
    id: `att-${name}`,
    key: `att/0000000${n}-0000-4000-8000-000000000000.pdf`,
    name,
    mime: "application/pdf",
    size: 10,
  })

  /** An Analise card, and Docs with one CV card per name in `cvs`. */
  const pushBoard = (
    boardId: string,
    card: { id: string; tags?: string[]; body?: string },
    cvs: string[] = ["cv.pdf"]
  ) =>
    rpcClient(h).board.sync({
      boardId,
      since: 0,
      changes: [
        columnRecord(`${boardId}-analise`, boardId, "Analise"),
        columnRecord(`${boardId}-docs`, boardId, "Docs"),
        cardRecord(card.id, `${boardId}-analise`, card),
        ...cvs.map((name, n) =>
          cardRecord(`${boardId}-cv${n}`, `${boardId}-docs`, {
            title: `CV ${n}`,
            position: `a${n}`,
            attachments: [cv(name, n)],
          })
        ),
      ],
    })

  const put = (url: string, payload: unknown) =>
    h.app.inject({
      method: "PUT",
      url,
      headers: { cookie: h.cookie, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    })
  const enableLlm = (boardId: string, enabled = true) =>
    put(`/api/agents/boards/${boardId}/columns/${boardId}-analise`, {
      enabled,
    })

  test("nothing runs until the Analise column's LLM toggle is on", async () => {
    await pushBoard("welcome", { id: "w1", tags: ["pi"] })
    expect(await findPendingAgentCards()).toEqual([])

    expect((await enableLlm("welcome")).statusCode).toBe(204)
    // Like the client's seeded "Default" board: cards and columns synced,
    // the board record never pushed.
    expect(await findPendingAgentCards()).toEqual([
      {
        userId: ownerId,
        boardId: "welcome",
        cardId: "w1",
        title: "Acme: SRE",
        body: "JD",
        agent: "pi",
        cvCardId: "welcome-cv0",
      },
    ])

    await enableLlm("welcome", false)
    expect(await findPendingAgentCards()).toEqual([])
  })

  test("finds inline tags too", async () => {
    await pushBoard("b2", { id: "inline", body: "JD #claude" })
    await enableLlm("b2")
    const found = await findPendingAgentCards()
    expect(found.map((c) => [c.cardId, c.agent])).toEqual([
      ["inline", "claude"],
    ])
  })

  test("skips untagged cards and ones already processed", async () => {
    await pushBoard("welcome", { id: "plain" })
    await pushBoard("welcome", {
      id: "done",
      tags: ["pi"],
      body: `JD\n\n${jobMarker("7")}`,
    })
    await enableLlm("welcome")
    expect(await findPendingAgentCards()).toEqual([])
  })

  test("waits for a CV in Docs", async () => {
    await pushBoard("welcome", { id: "w1", tags: ["pi"] }, [])
    await enableLlm("welcome")
    expect(await findPendingAgentCards()).toEqual([])
  })

  test("with several CVs, waits for the one picked for the card", async () => {
    await pushBoard("welcome", { id: "w1", tags: ["agy"] }, ["a.pdf", "b.pdf"])
    await enableLlm("welcome")
    expect(await findPendingAgentCards()).toEqual([])

    const pick = await put("/api/agents/boards/welcome/cards/w1/cv", {
      cvCardId: "welcome-cv1",
    })
    expect(pick.statusCode).toBe(204)
    const found = await findPendingAgentCards()
    expect(found.map((c) => [c.cardId, c.cvCardId])).toEqual([
      ["w1", "welcome-cv1"],
    ])
  })

  test("the board's rules read back for the UI", async () => {
    await pushBoard("welcome", { id: "w1", tags: ["pi"] }, ["a.pdf", "b.pdf"])
    await enableLlm("welcome")
    await put("/api/agents/boards/welcome/cards/w1/cv", {
      cvCardId: "welcome-cv0",
    })
    const res = await h.app.inject({
      method: "GET",
      url: "/api/agents/boards/welcome",
      headers: { cookie: h.cookie },
    })
    expect(res.json()).toEqual({
      llmColumns: ["welcome-analise"],
      cardCvs: { w1: "welcome-cv0" },
      cvCards: [
        { id: "welcome-cv0", title: "CV 0", files: ["a.pdf"] },
        { id: "welcome-cv1", title: "CV 1", files: ["b.pdf"] },
      ],
    })
  })
})
