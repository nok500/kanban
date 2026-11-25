# Changelog

## Unreleased

### Added

- Job-description workflow: cards in `Process` / `Analise` columns tagged
  `agy`, `claude` or `pi` are sent to the agent runner, which writes a fit
  analysis with gap recommendations and moves the card to `Follow-up` or `Nay`
  through the Kanban MCP.
- Default board template `JDs | Analise | Follow-up | Nay | Docs`; CVs attached
  to cards in `Docs` are handed to the agent.
- Agent monitor in the sidebar, fed by the `agent-probe` service on each host.
- Card chat with llama.cpp (OpenAI-compatible API), started from the card
  header or from selected text, with one shared conversation per card.
  Endpoints are configurable under Settings → LLM endpoints.
- Cards open read-only; editing starts from the edit button.
- `docker-compose.local.yml` for running the whole stack from source.
- Nord color palette.

### Changed

- Standalone project: packages renamed to the `@kanban/*` scope, the
  Postgres role/database, volumes, nginx alias and browser storage keys
  renamed from `doska` to `kanban` (see `scripts/migrate-from-doska.sh`).
- Self-host installer fetches the compose file from a git ref of
  `nok500/kanban` (`KANBAN_REF`, default `main`) instead of resolving GitHub
  releases.

### Removed

- Native desktop app support (Tauri): local folder sync (vault), local MCP
  server, quick-note popup, card windows, desktop sign-in handoff and updater.
- The marketing/landing site. Docs are plain Markdown under `docs/`.
