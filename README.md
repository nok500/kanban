# kanban-job-board

A self-hosted Kanban job-application board with automated CLI agent JD analysis (`agy` and `claude`), live host agent monitoring, and MCP integration.

> Based on [romenkova/doska](https://github.com/romenkova/doska).

## Workflow

The default board (`Default`) starts with five columns:

- **`JDs`** — Add job descriptions (formatted as `Company: Job Title`) and tag them with `agy` or `claude` (via card **Tags** or inline `#agy` / `#claude`).
- **`Analise`** — Moving a tagged card into `Analise` triggers the selected CLI agent inside `agent-runner`, passing the JD title/body and any CV files attached to cards in `Docs`.
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
