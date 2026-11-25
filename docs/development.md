---
title: Development
nav: Development
description: "Run the Kanban Job Board monorepo locally: requirements, commands, repository layout, and the self-host smoke tests."
order: 8
updated: "2026-08-07"
---

Kanban Job Board is a pnpm + Turborepo monorepo. Requires **Node 22+** and **pnpm 11+**
(see `.nvmrc` / the root `package.json` engines).

```sh
pnpm install
pnpm dev        # web client + server, in watch mode
pnpm local:up   # the whole stack in Docker, built from source
```

The client dev server proxies the sync API to the local server, so sync works
end to end with no extra setup.

## Commands

| Command           | What it does                   |
| ----------------- | ------------------------------ |
| `pnpm build`      | Build all web/server packages. |
| `pnpm lint`       | Lint all packages.             |
| `pnpm type-check` | Type-check all packages.       |
| `pnpm test`       | Unit tests.                    |
| `pnpm e2e`        | Playwright end-to-end tests.   |
| `pnpm format`     | Prettier-format the repo.      |

## Layout

| Path          | What's in it                                                 |
| ------------- | ------------------------------------------------------------ |
| `apps/client` | The web client, the board UI itself.                         |
| `apps/server` | Sync API, auth, file endpoints, agents, and the MCP endpoint. |
| `docs`        | These docs.                                                  |

The shared code lives in `packages/`:

- `core`: the domain and data layers, platform agnostic.
- `ports`: the interfaces between shared code and a platform.
- `markdown`: parses a card body to mdast and walks it with a per-platform
  adapter, platform agnostic.
- `editor`: the CodeMirror card editor.
- `folder-tree`: the drag-and-drop folder tree in the sidebar.
- `sync`: the sync engine, platform agnostic.
- `ui-kit`: components.
- `mcp`: the board as MCP tools, transport-agnostic.
- `core/agent-runner`, `core/agent-probe`: the Python services behind the JD
  workflow and the agent monitor.

## Self-host smoke tests

The scripts that CI runs against a real Docker stack:

```sh
pnpm test:install          # installer
pnpm test:selfhost         # bring the stack up and check it
pnpm test:selfhost:data    # data survives a restart
pnpm test:selfhost:upgrade # upgrade over an existing database
pnpm test:selfhost:restore # backup and restore
pnpm selfhost:down         # tear it all down, volumes included
```

## Contributing

Issues and pull requests: [github.com/nok500/kanban](https://github.com/nok500/kanban).
Security reports go through [SECURITY.md](https://github.com/nok500/kanban/blob/main/SECURITY.md).
