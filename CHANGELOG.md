# Changelog

## 0.1.1 — 2026-10-13

- Renamed the public repository to Fud Mail while retaining existing plugin
  identifiers and credential paths.
- Added Claude Code/OpenCode setup and troubleshooting.
- Serialized OAuth refresh-token writes and removed credential-bearing error
  details from failed Keychain saves.
- Updated the MCP SDK to 1.32.1 and Nodemailer to 10.1.0, plus patched transitive
  dependencies. Added MIME-composition regression coverage for the major update.
- Added branch protection, linting, fuzz/property tests, CodeQL, Scorecard,
  contribution guidance, issue templates, and a code of conduct.

Upgrade: run `npm ci` in the plugin directory and restart the MCP client.
Existing account configuration, OAuth credentials, and plugin identifiers are
compatible. Live operation remains macOS-only.

Dependency fixes include Nodemailer advisories GHSA-6vj9-mwq6-2f5v,
GHSA-8vvx-rff5-p5rq, GHSA-g57g-f23g-4646, GHSA-v53p-9fqp-m79j, and
GHSA-prgh-xp8r-p3m5. No project-specific CVE/GHSA was assigned to the
Keychain error-redaction fix.
