# Contributing to Fud Mail

Use GitHub issues for bugs, feature requests, and public discussion in English.
Use a pull request from a feature branch for changes. Describe the problem,
solution, and validation; keep unrelated changes separate. Contributions use
this repository's MIT license. Follow CODE_OF_CONDUCT.md.

## Development and acceptance

Use Node.js 22 or newer (22.13+ for ESLint 10), npm, and JavaScript ES modules.
Run from `plugins/multi-account-gmail-mcp`:

```sh
npm ci
npm run check
npm run lint
npm test
npm audit --audit-level=moderate
```

Use ESLint's recommended rules with zero warnings. The caught-error rule is
excepted because credential subprocess errors may contain tokens. Never expose
those errors or attach their raw causes to public errors.
Add automated tests for major new behavior and regression tests for fixes.
CI includes synthetic MCP smoke tests, unit tests, 3,000 seeded fast-check
property cases (message bodies, recipient parsing and reply-all safety),
ESLint, dependency auditing, and CodeQL. None of these tests sends real email.
Broader live-mailbox coverage is not claimed. Reproduce a fast-check failure
using its reported seed and path, and add the minimized case as a regression.

The maintainer reviews proposed changes and may merge their own PR after
required checks pass. No second maintainer's approval is required.

## Releases

Use unique Semantic Versioning identifiers, record user-facing changes in
CHANGELOG.md, and tag each public release. Until the first tagged release,
source snapshots are identified by their full Git commit SHA. Before releases,
run all checks above, review CodeQL findings, and fix confirmed medium/high
exploitable findings. Document compatibility changes and known vulnerability
fixes (including advisory IDs when available). Never publish credentials or
real mailbox content in code, tests, logs, or reports.
