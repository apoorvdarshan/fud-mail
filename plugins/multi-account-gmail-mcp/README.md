# Fud Mail plugin

This directory contains the Codex plugin and local MCP server.
See the [root README](../../README.md) for Claude Code/OpenCode setup and troubleshooting.

## Setup

From the repository root:

```bash
npm --prefix plugins/multi-account-gmail-mcp ci
npm --prefix plugins/multi-account-gmail-mcp run configure -- \
  primary@example.com work@example.com
```

Place a Google OAuth desktop-client JSON file at:

```text
~/.config/multi-account-gmail-mcp/client_secret.json
```

Then authorize every configured account:

```bash
npm --prefix plugins/multi-account-gmail-mcp run auth -- primary@example.com
npm --prefix plugins/multi-account-gmail-mcp run auth -- work@example.com
```

## Capabilities

The server exposes 25 tools for:

- profiles, search, single/batch reads, and threads;
- temporary attachment downloads;
- system and user labels;
- archive, Inbox, read/unread, star, importance, Trash, and restore;
- draft creation, updates, deletion, replies, and forwarding;
- reviewed-draft sending and explicit direct sending;
- explicitly approved permanent message or thread deletion.

Every operation requires a configured account. OAuth tokens are stored under
that account in macOS Keychain.

## Test

```bash
npm run check
npm test
```
