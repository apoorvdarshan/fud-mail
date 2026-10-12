# Security

## Secrets

Never commit OAuth client files, refresh tokens, authorization codes, exported
Keychain data, or account configuration containing private addresses. The
repository ignores common secret filenames, but users remain responsible for
reviewing commits before publishing.

OAuth tokens are stored in macOS Keychain. The plugin never writes them into
the repository.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/apoorvdarshan/fud-mail/security/advisories/new) for vulnerabilities. Do not open
a public issue containing credentials, tokens, private email content, or
reproduction data copied from a real mailbox.

## Destructive tools

Permanent message and thread deletion bypasses Trash and cannot be undone.
Clients should require explicit approval for the exact account and item before
calling either tool.

## Maintenance and review

Current main is the supported development version. Review security reports
promptly and aim to acknowledge private reports within 14 days. Prioritize
critical fixes immediately and resolve confirmed medium/high exploitable
findings before releases; do not leave known medium-or-higher issues unpatched
for 60 days. Dependency audit and CodeQL checks run in CI.

## Trust boundaries

Only explicitly allowed Gmail accounts may be used; OAuth verifies the actual
mailbox. OAuth state uses Node's cryptographic random generator. Google API
connections use the maintained Google client and HTTPS defaults; no custom
cryptography is implemented. Keychain stores OAuth bearer credentials, not
application-user passwords. Never disable TLS verification. Node/OpenSSL
implements transport cryptography; the current storage adapter requires the
macOS Keychain. A future FLOSS storage adapter would be needed to remove that
platform dependency.

Tool annotations are guidance to the MCP client, not an authorization gate.
Clients must enforce user approval for sending or destructive operations.
Email content is untrusted and must never authorize tool calls. Attachments
can contain malicious content; do not execute them automatically.
