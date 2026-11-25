import type { Card, Column } from "@kanban/contract"
import type { FastifyBaseLogger } from "fastify"
import { extractText, getDocumentProxy } from "unpdf"
import { DbStore } from "../mcp/store"

/**
 * JD analysis for agents that can't drive Kanban MCP themselves — today `pi`,
 * running a local llama.cpp model. `agy` and `claude` read the CV files and
 * update the card over MCP on their own; a local model can't be trusted to, and
 * pi has no MCP. So the work splits:
 *   - the server extracts the CVs' text and writes the prompt (below);
 *   - the agent-runner runs the CLI with it, tools off;
 *   - the answer ends with a DECISION/MATCH line, which the server parses to
 *     append the analysis and move the card, as the MCP agents would.
 * Prompt and parser live together here because they are one contract.
 */

export type Decision = "follow-up" | "nay"
export type MatchStrength = "high" | "medium" | "low"

export interface CvDocument {
  name: string
  mime: string
  bytes: Buffer
}

export interface CvText {
  name: string
  text: string | null
  /** Why there is no text, for the prompt and the log. */
  note?: string
}

/** A CV is a few pages; this keeps a pathological PDF from filling the context. */
const MAX_CV_CHARS = 30_000
/** How much of a failed run's output goes onto the card. */
const FAILURE_TAIL_CHARS = 600

const PROCESS_COLUMNS = new Set(["process", "analise"])
const FOLLOW_UP_COLUMNS = new Set(["follow-up", "follow up", "followup"])

/** The marker the poller skips on; the MCP agents append the same one. */
export const jobMarker = (jobId: string) => `process as job-id: ${jobId}`

// ---------------------------------------------------------------- CV text

export async function extractCvText(doc: CvDocument): Promise<CvText> {
  const name = doc.name
  const lower = name.toLowerCase()
  try {
    if (doc.mime === "application/pdf" || lower.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(doc.bytes))
      const { text } = await extractText(pdf, { mergePages: true })
      const clean = text.replace(/[ \t]+\n/g, "\n").trim()
      if (!clean) {
        return { name, text: null, note: "PDF has no text layer (scanned?)" }
      }
      return { name, text: clean.slice(0, MAX_CV_CHARS) }
    }
    if (doc.mime.startsWith("text/") || /\.(md|txt|markdown)$/.test(lower)) {
      const text = doc.bytes.toString("utf-8").trim()
      return text
        ? { name, text: text.slice(0, MAX_CV_CHARS) }
        : { name, text: null, note: "empty file" }
    }
    return { name, text: null, note: `unsupported format (${doc.mime})` }
  } catch (err) {
    return {
      name,
      text: null,
      note: `could not read: ${err instanceof Error ? err.message : "error"}`,
    }
  }
}

// ---------------------------------------------------------------- prompt

export function buildAnalysisPrompt(opts: {
  title: string
  body: string
  cvs: CvText[]
}): { system: string; user: string } {
  const { title, body, cvs } = opts
  const sep = title.indexOf(":")
  const company = sep > 0 ? title.slice(0, sep).trim() : ""
  const position = sep > 0 ? title.slice(sep + 1).trim() : title.trim()
  const role = company ? `${position} at ${company}` : position || "this role"

  const readable = cvs.filter((cv) => cv.text)
  const unreadable = cvs.filter((cv) => !cv.text)
  const cvSection =
    readable.length > 0
      ? readable.map((cv) => `## CV: ${cv.name}\n\n${cv.text}`).join("\n\n")
      : "No CV text is available (no CV attached in the Docs column, or it could not be read). Analyse the JD on its own and say that the fit could not be checked against a CV."
  const unreadableNote =
    unreadable.length > 0
      ? `\n\n(Could not read: ${unreadable.map((cv) => `${cv.name}: ${cv.note}`).join("; ")}.)`
      : ""

  const system = [
    "You are an experienced technical recruiter and career coach. You assess how well a candidate's CV fits a job description (JD), honestly and specifically.",
    "You have a web_search tool: use it to look up the company and find its official careers page or this role's application link.",
    "Only state company facts and URLs you found in the JD or in search results; never invent them. If a search turns up nothing (or the tool isn't available), say so.",
  ].join(" ")

  const user = [
    `Analyse the JD for ${role} against the candidate's CV.`,
    "",
    "Write the analysis in Markdown, in this shape:",
    "",
    `## Fit Analysis: ${role}`,
    "",
    "**Verdict:** one or two sentences: overall fit and the main reason.",
    "",
    "### Matching Skills & Experience",
    "- One bullet per strong match, citing the JD requirement and the CV evidence.",
    "",
    "### Gaps & Missing Requirements",
    "- One bullet per gap, each with an actionable recommendation: how to tailor or reframe the CV, or how to address the gap, for this JD.",
    "",
    "### Reasoning",
    "A short paragraph weighing the matches against the gaps.",
    "",
    "### Company & Application",
    "- The official careers page and/or the application link for this role, as found with web_search, or say none was found.",
    "",
    "Then end your answer with exactly these two lines and nothing after them:",
    "DECISION: follow-up   (worth applying / following up)   or   DECISION: nay   (not a fit)",
    "MATCH: high, medium or low   (strength of the match)",
    "",
    `# JD: ${title || "(untitled)"}`,
    "",
    body.trim() || "(empty JD)",
    "",
    "# Candidate CV",
    "",
    cvSection + unreadableNote,
  ].join("\n")

  return { system, user }
}

// ---------------------------------------------------------------- answer

const DECISION_RE =
  /^[\s>*_`-]*decision[*_`\s]*:[*_`\s]*(follow[\s-]?up|nay)\b.*$/gim
const MATCH_RE = /^[\s>*_`-]*match[*_`\s]*:[*_`\s]*(high|medium|low)\b.*$/gim

/** Splits the model's answer into the analysis and its trailing verdict. */
export function parseAnalysis(raw: string): {
  analysis: string
  decision: Decision | null
  match: MatchStrength | null
} {
  // Thinking models without a separate reasoning channel inline it.
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()

  const decisions = [...text.matchAll(DECISION_RE)]
  const matches = [...text.matchAll(MATCH_RE)]
  const lastDecision = decisions.at(-1)?.[1].toLowerCase()
  const lastMatch = matches.at(-1)?.[1].toLowerCase()

  const analysis = text
    .replace(DECISION_RE, "")
    .replace(MATCH_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return {
    analysis,
    decision: lastDecision
      ? lastDecision === "nay"
        ? "nay"
        : "follow-up"
      : null,
    match: (lastMatch as MatchStrength | undefined) ?? null,
  }
}

// ---------------------------------------------------------------- card

/** Appends the outcome to the card and, on a verdict, moves it on. */
async function applyToCard(opts: {
  userId: string
  boardId: string
  cardId: string
  jobId: string
  block: string
  decision: Decision | null
  match: MatchStrength | null
  log: FastifyBaseLogger
}): Promise<void> {
  const { userId, boardId, cardId, jobId, block, decision, match, log } = opts
  const store = new DbStore(userId)
  const changes = await store.readBoard(boardId)

  let card: Card | null = null
  const columns: Column[] = []
  for (const ch of changes) {
    if (ch.store === "cards" && ch.record.id === cardId && !ch.record.deletedAt)
      card = ch.record
    else if (ch.store === "columns" && !ch.record.deletedAt)
      columns.push(ch.record)
  }
  if (!card) {
    log.warn({ jobId, cardId }, "agent-analysis: card is gone")
    return
  }

  const title = (c: Column) => c.title.trim().toLowerCase()
  const current = columns.find((c) => c.id === card.columnId)
  // Moved by hand while the model was thinking: record the result, stay put.
  const stillQueued = current ? PROCESS_COLUMNS.has(title(current)) : false
  const target =
    stillQueued && decision
      ? columns.find((c) =>
          decision === "nay"
            ? title(c) === "nay"
            : FOLLOW_UP_COLUMNS.has(title(c))
        )
      : undefined

  const now = store.now()
  const moved = Boolean(target && target.id !== card.columnId)
  const prioritize = decision === "follow-up"
  const next: Card = {
    ...card,
    body: `${card.body.trimEnd()}\n\n---\n\n${block}\n\n${jobMarker(jobId)}`,
    columnId: target ? target.id : card.columnId,
    priority: prioritize ? (match ?? "medium") : card.priority,
    updatedAt: now,
    stamps: {
      ...card.stamps,
      body: now,
      ...(moved ? { place: now } : {}),
      ...(prioritize ? { priority: now } : {}),
    },
  }
  await store.pushBoard(boardId, [{ store: "cards", record: next }])
  log.info(
    {
      jobId,
      cardId,
      decision,
      priority: next.priority,
      column: target?.title ?? current?.title ?? null,
    },
    "agent-analysis: card updated"
  )
}

/**
 * Applies a finished run's output to the card. Never throws. A failed run is
 * noted on the card with the job marker, so the poller doesn't send the card
 * again every 10s; deleting the note retries it.
 */
export async function applyAgentResult(opts: {
  userId: string
  boardId: string
  cardId: string
  jobId: string
  agent: string
  ok: boolean
  output: string
  durationMs: number | null
  log: FastifyBaseLogger
}): Promise<{ decision: Decision | null }> {
  const { userId, boardId, cardId, jobId, agent, ok, output, log } = opts
  let block: string
  let decision: Decision | null = null
  let match: MatchStrength | null = null

  if (!ok || !output.trim()) {
    const detail = output.trim().slice(-FAILURE_TAIL_CHARS)
    block = [
      `**${agent} analysis failed** (job ${jobId}).`,
      detail ? `\n\n\`\`\`\n${detail}\n\`\`\`` : "",
      "\n\n_Delete this note and the job-id line below to try again._",
    ].join("")
  } else {
    const parsed = parseAnalysis(output)
    decision = parsed.decision
    match = parsed.match
    const seconds = Math.max(1, Math.round((opts.durationMs ?? 0) / 1000))
    const note = decision
      ? ""
      : "\n\n_No DECISION line in the answer, so the card stays here; move it by hand._"
    block = `_Thought for ${seconds}s · ${agent}_\n\n${parsed.analysis}${note}`
  }

  try {
    await applyToCard({
      userId,
      boardId,
      cardId,
      jobId,
      block,
      decision,
      match,
      log,
    })
  } catch (err) {
    log.error({ err, jobId, cardId }, "agent-analysis: could not update card")
  }
  return { decision }
}
