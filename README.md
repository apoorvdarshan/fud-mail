# Fud Mail

A local Codex plugin and MCP server for managing multiple Gmail accounts with
an explicit account choice on every tool call.

It supports mailbox search, batch reading, threads, attachments, labels,
archive/read/star state, Trash and restore, drafts, replies, forwarding, direct
send, and guarded permanent deletion. OAuth tokens stay in macOS Keychain.

## Requirements

- macOS with Keychain
- Node.js 22 or newer
- Codex, Claude Code, OpenCode, or another local stdio MCP client
- A Google Cloud project with the Gmail API enabled

## Quick start

Clone this repository, then configure your accounts:

```bash
git clone https://github.com/apoorvdarshan/fud-mail.git
cd fud-mail
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

## Connect your client

Run these commands from the repository root after authorizing your accounts.

### Codex

Add this repository as a local Codex marketplace and install the plugin:

```bash
codex plugin marketplace add "$PWD"
codex plugin add multi-account-gmail-mcp@multi-account-gmail-mcp
```

Start a new Codex task after installation.

### Claude Code

Register a user-scoped stdio server (available across projects):

```bash
claude mcp add --transport stdio --scope user fud-mail -- \
  "$(command -v node)" "$PWD/plugins/multi-account-gmail-mcp/src/server.mjs"
claude mcp get fud-mail
```

### OpenCode v2

```bash
opencode mcp add --global fud-mail -- \
  "$(command -v node)" "$PWD/plugins/multi-account-gmail-mcp/src/server.mjs"
opencode mcp list
```

For older OpenCode versions without `mcp add --global`, merge this entry into
`~/.config/opencode/opencode.json` (preserve your other settings). Replace both
absolute paths with your actual Node executable and cloned repository location:

```json
{
  "mcp": {
    "fud-mail": {
      "type": "local",
      "command": ["/absolute/path/to/node", "/absolute/path/to/fud-mail/plugins/multi-account-gmail-mcp/src/server.mjs"],
      "enabled": true
    }
  }
}
```

Start a new client session after registration. These clients share the same
local account configuration and Keychain tokens when run as the same macOS user.
Client setup references: [Claude Code MCP](https://code.claude.com/docs/en/mcp)
and [OpenCode v2 MCP](https://dev.opencode.ai/v2/docs/mcp-servers/).

### Existing installations

The repository is now named `fud-mail`. The published Codex plugin ID,
`plugins/multi-account-gmail-mcp` directory, `GMAIL_MCP_*` environment variables,
configuration directory, and Keychain service name remain unchanged for
compatibility. Existing users do not need to reauthorize because of the rename.
`fud-mail` is the suggested registration alias for Claude Code and OpenCode.

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

## Troubleshooting

- **No Gmail accounts configured / unsupported account:** run the `configure`
  command above with every intended address, then authorize each one. If you
  use `GMAIL_MCP_ACCOUNTS`, it takes precedence over the account file. Restart
  the MCP server after changing the allowlist.
- **Missing OAuth client file:** download a Desktop app client JSON from your
  own Google Cloud project to the documented path. Renaming another kind of
  credentials file will not convert it into an OAuth client.
- **Expired or revoked authorization (`invalid_grant`):** rerun
  `npm --prefix plugins/multi-account-gmail-mcp run auth -- user@example.com`.
  Check the OAuth app's consent-screen status and test-user configuration if
  authorization repeatedly expires. Sign in to the exact configured account.
- **Keychain access denied or tokens cannot be saved:** unlock your login
  Keychain and review the access prompt in macOS. Retry authorization after
  fixing access. Refresh-save failures produce a credential-free warning on
  stderr; the current session may keep working with in-memory credentials,
  but the refreshed tokens have not been persisted. A later refresh retries
  saving; there is no background retry timer.
- **Server does not connect:** check Node.js is version 22 or newer, dependencies
  are installed, and the client command uses absolute paths. A GUI client may
  have a different PATH from your shell. Check `claude mcp get fud-mail` or
  `opencode mcp list`, then restart the client session.
- **Windows/Linux:** live Gmail authorization currently requires macOS
  Keychain. CI can run synthetic tests on Linux; that does not provide Linux
  credential storage support.

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
