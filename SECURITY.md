# Security

## Secrets

Never commit OAuth client files, refresh tokens, authorization codes, exported
Keychain data, or account configuration containing private addresses. The
repository ignores common secret filenames, but users remain responsible for
reviewing commits before publishing.

OAuth tokens are stored in macOS Keychain. The plugin never writes them into
the repository.

## Reporting a vulnerability

Use GitHub's private security-advisory feature for vulnerabilities. Do not open
a public issue containing credentials, tokens, private email content, or
reproduction data copied from a real mailbox.

## Destructive tools

Permanent message and thread deletion bypasses Trash and cannot be undone.
Clients should require explicit approval for the exact account and item before
calling either tool.
