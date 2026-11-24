# Contributing to kanban-job-board

## Dev setup

Node 22+ and pnpm 11+ are required.

### Running locally

1. Clone the repository and install dependencies with `pnpm install`.
2. Run `pnpm dev` to start both the server and client.

The repo is a pnpm + turbo monorepo: `apps/` holds the runnable apps (`client`, `server`, `desktop`), and `packages/` holds shared code (`core`, `mcp`, `contract`, `merge`, `sync`, `ui-kit`, etc.).

## Tests

- Unit and integration tests: `pnpm test`
- E2E tests: `pnpm e2e`
