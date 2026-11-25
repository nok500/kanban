# kanban-job-board

A self-hosted Kanban job-application board with automated CLI agent JD analysis (`agy` and `claude`), live host agent monitoring, and MCP integration.

> Based on [romenkova/doska](https://github.com/romenkova/doska).

## Workflow

The default board (`Default`) and the **Job search** template (on the Templates page) are built around these columns:

- **`JDs`** — Add job descriptions (formatted as `Company: Job Title`) and tag them with `agy`, `claude` or `pi` (via card **Tags** or inline `#agy` / `#claude` / `#pi`).
- **`Analise`** — Switch the column's **LLM** toggle on to let agents run here (it starts off). A card in it is then sent to its agent inside `agent-runner` once it's tagged and `Docs` has a CV; with several CV cards in `Docs`, you pick which one when you drop the card in (until then it waits, marked **Choose CV**). The agent gets the JD title/body and that CV:
  - `agy` / `claude` read the CV files and update the card themselves over Kanban MCP (with a web search for the company's careers page).
  - `pi` ([pi coding agent](https://github.com/earendil-works/pi), against a llama.cpp or other OpenAI-compatible server) has no MCP, so the server extracts the CV text (PDF, text, Markdown) into its prompt, and applies its answer — the analysis plus a `DECISION`/`MATCH` verdict — to the card. Point it at OpenAI-compatible servers with `LOCAL_PROVIDERS` (tried in order, first that answers wins) and optionally `PI_MODEL`. No web access, so no careers-page lookup.
- **`Follow-up`** — If the agent recommends following up, it appends `---` + `Thought for <N>s` + the fit analysis (including company career-page search results), sets the card `priority` (`high` / `medium` / `low`), and moves the card here.
- **`Nay`** — If not a fit, the analysis is appended and the card is moved here.
- **`Docs`** — Store your CV card(s) with attached CV files here.

## Architecture

- `apps/client` — React + Vite web UI (with sidebar CLI agent & job monitor).
- `apps/server` — Fastify + Drizzle + Postgres sync server, MCP endpoint (`/mcp`), and `/api/agents/*` routes.
- `packages/core` — Shared sync engine, board operations, `packages/core/agent-probe`, and `packages/core/agent-runner`.
- `packages/mcp` — MCP tool definitions for reading and editing boards.

## Docker Images & Compose

Prebuilt images are published to GHCR on pushes to `main`:

- `ghcr.io/nok500/kanban-server:latest`
- `ghcr.io/nok500/kanban-web:latest`
- `ghcr.io/nok500/kanban-probe:latest`
- `ghcr.io/nok500/kanban-agent-runner:latest`

Configure `.env` (see `.env.selfhost.example`) and run from GHCR:

```sh
docker compose up -d
```

Or build all services locally:

```sh
docker compose -f docker-compose.local.yml up -d --build
```

## MCP

The server exposes your boards over Streamable HTTP at `/mcp` behind OAuth 2.1:

```sh
claude mcp add --transport http kanban https://your-server/mcp
```

## Development

Node 22+ and pnpm 11+ are required:

```sh
pnpm install
pnpm dev
```
