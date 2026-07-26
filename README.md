# Multi-Account Gmail MCP

A local Codex plugin and MCP server for managing multiple Gmail accounts with
an explicit account choice on every tool call.

It supports mailbox search, batch reading, threads, attachments, labels,
archive/read/star state, Trash and restore, drafts, replies, forwarding, direct
send, and guarded permanent deletion. OAuth tokens stay in macOS Keychain.

## Requirements

- macOS with Keychain
- Node.js 22 or newer
- Codex CLI and desktop app
- A Google Cloud project with the Gmail API enabled

## Quick start

Clone this repository, then run:

```bash
cd multi-account-gmail-mcp
npm --prefix plugins/multi-account-gmail-mcp ci
npm --prefix plugins/multi-account-gmail-mcp run configure -- \
  primary@example.com work@example.com
```

Create a Google OAuth desktop client:

1. Create or select a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen.
4. Create an OAuth client of type **Desktop app**.
5. Download its JSON file to:
   `~/.config/multi-account-gmail-mcp/client_secret.json`

Authorize every configured account:

```bash
npm --prefix plugins/multi-account-gmail-mcp run auth -- primary@example.com
npm --prefix plugins/multi-account-gmail-mcp run auth -- work@example.com
```

Add this repository as a local Codex marketplace and install the plugin:

```bash
codex plugin marketplace add "$PWD"
codex plugin add multi-account-gmail-mcp@multi-account-gmail-mcp
```

Start a new Codex task after installation.

## OAuth scope

The plugin requests `https://mail.google.com/`, Google's full-mailbox scope.
This permits reading, composing, sending, organizing, and permanently deleting
mail. Each user supplies their own Google Cloud OAuth client and explicitly
authorizes every mailbox.

Google classifies this as a restricted scope. Personal or test installations
may show an unverified-app warning. Publicly distributing one shared OAuth
client can require Google verification and additional compliance work; this
project instead expects every operator to create and control their own client.

## Safety model

- Every tool requires an account from the configured allowlist.
- Direct sending is available only through an explicitly named send tool.
- Permanent deletion tools are marked destructive and bypass Trash.
- Local outgoing attachments require absolute paths and are capped at 25 MB.
- Downloaded attachments use private temporary files.
- OAuth refresh tokens are stored in macOS Keychain, never in the repository.

Do not commit OAuth client JSON, refresh tokens, authorization codes, account
lists containing private addresses, or mailbox content.

## Configuration

The default configuration directory is:

```text
~/.config/multi-account-gmail-mcp
```

Supported overrides:

| Variable | Purpose |
| --- | --- |
| `GMAIL_MCP_ACCOUNTS` | Comma-separated account allowlist |
| `GMAIL_MCP_ACCOUNTS_FILE` | Alternate account configuration file |
| `GMAIL_MCP_CONFIG_DIR` | Alternate configuration directory |
| `GMAIL_MCP_OAUTH_CLIENT_FILE` | Alternate OAuth client JSON |
| `GMAIL_MCP_KEYCHAIN_SERVICE` | Alternate Keychain service name |
| `GMAIL_MCP_NO_OPEN=1` | Print the OAuth URL without opening a browser |

## Development

```bash
cd plugins/multi-account-gmail-mcp
npm ci
npm run check
npm test
```

The smoke test starts the MCP server with synthetic example accounts and never
connects to Gmail.

## License

MIT
