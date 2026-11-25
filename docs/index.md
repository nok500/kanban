---
title: Documentation
nav: Overview
description: "Kanban Job Board is a Kanban board where the cards are Markdown."
order: 1
updated: "2026-08-09"
---

Kanban Job Board is a Kanban board where the cards are Markdown.

Kanban Job Board uses IndexedDB as the intermediate data source, and every few seconds (3 by default) syncs to the self-hosted server's database. It installs as a PWA and keeps working offline.

## How to run it

### Self-hosting

More on self-hosting here: [Self-hosting guide](self-hosting/index.md).

You will need Docker and Docker Compose. The self-hosting setup spins up the web server and the sync server. It also sets up the database and S3 (or local storage).

## What a card is

A card body is GitHub-flavored Markdown, with a few additions to the syntax:

- `- [ ]` task lists: the card header shows a done/total count and the boxes
  are clickable.
- `[[12|Card title]]` links to another card and picks up its column's color.
- A line containing only `-cut-` ends the card's preview: the board shows what's
  above it, the full body opens in the card view.

Cards also have deadlines and priorities. Boards support search and sort, as well as a simplified column view, and a cross-board view sorted by date.

## Where to go next

- [User guides](user-guides/index.md).
- [Self-hosting](self-hosting/index.md): installer, HTTPS, backups.
- [Accounts](accounts.md): more than one person on your server.
- [MCP](mcp.md): let an agent read and edit your boards.
- [Development](development.md): run the monorepo locally.
