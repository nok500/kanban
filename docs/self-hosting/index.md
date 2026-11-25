---
title: Self-hosting
nav: Self-hosting
description: "Run Kanban Job Board with Docker: the one-line installer, the environment variables, and connecting your devices to it."
order: 2
updated: "2026-08-11"
---

## Prerequisites

You need a host with Docker and Docker Compose.

## One-line installer

```sh
curl -fsSL https://raw.githubusercontent.com/nok500/kanban/main/install.sh -o install.sh && sh install.sh
```

This command downloads and launches an [install script](https://raw.githubusercontent.com/nok500/kanban/main/install.sh). The script backs up data if any data is present, helps to fill in env variables, and launches containers.

To upgrade, run the whole command above again rather than the `install.sh` you
already have. Set `KANBAN_REF` to install from a branch or tag other than `main`. The script might change over time. It keeps your existing `.env`, and
takes a database and files volume backup first if it's redeploying over an existing database.

## By hand

```sh
curl -O https://raw.githubusercontent.com/nok500/kanban/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/nok500/kanban/main/.env.selfhost.example
# edit .env: set AUTH_PASSWORD, AUTH_SECRET (e.g. `openssl rand -hex 32`),
# and BASE_URL (this server's public origin, e.g. http://<your-host>:8080)
docker compose -f docker-compose.yml up -d
```

Instead of downloading the files via the links, you can also find them in the GitHub repo and copy them.

1. [docker-compose.yml](https://github.com/nok500/kanban/blob/main/docker-compose.yml)
2. [.env.selfhost.example](https://github.com/nok500/kanban/blob/main/.env.selfhost.example),
   rename to `.env`

Open the web UI at `http://<your-host>:8080` and sign in with the `AUTH_LOGIN` /
`AUTH_PASSWORD` from your `.env`.

Those credentials create the **first admin** account on first boot. The admin
can add more accounts from the app, and a board's owner can share it with them
or publish it as a read-only link. See [Accounts](../accounts.md).

## Configuration

See [Environment](environment.md) for every variable the server
reads from `.env`.

## Connecting your devices

- **Browser:** open the server's own web UI and sign in.
- **Agents:** see [MCP](../mcp.md).

## Next

- [Environment](environment.md): every variable in `.env`.
- [Accounts](../accounts.md): add more people to this server.
- [HTTPS](https.md): a certificate for a public deployment.
- [Attachments](attachments.md): keep files in S3 instead of a
  local volume.
- [Backups](backups.md): dump the database and files, and restore.
