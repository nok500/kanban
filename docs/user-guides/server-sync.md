---
title: Sync to server
nav: Sync to server
description: "Sign the web app into your self-hosted server so a board syncs across your devices."
order: 3
updated: "2026-09-13"
---

Syncing to a server is available only with the [self-hosted setup](../self-hosting/index.md).

Once the setup is up and running, open the server's web UI in a browser, or install it as a PWA.

## Web page

The web app syncs to the server it belongs to automatically. The only thing needed is to log in with the credentials given to the install script (or specified in the [environment](../self-hosting/environment.md)).

To sign in, click the button at the bottom of the sidebar.

## Conflicts

Card body: line by line conflict resolution.

Everything else: LWW + HLC sync.
