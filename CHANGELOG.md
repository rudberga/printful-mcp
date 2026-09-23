# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-09-23

### Added
- Unit tests for the security guards (path allowlist, traversal refusal, token
  scrubbing, PII redaction) that run without a token or network access.
- GitHub Actions CI across Node 18, 20 and 22, including a check that the
  published tarball contains no source, tests or stray files.
- `SECURITY.md` describing the properties that are load-bearing and how to
  report a problem privately.
- Dependabot for npm and GitHub Actions updates.
- Graceful shutdown on SIGINT/SIGTERM and a handler for unhandled rejections,
  so the server closes its transport cleanly instead of dying mid-request.

### Fixed
- `repository`, `bugs`, `homepage` and `author` were missing from
  `package.json`, so the npm page had no link back to the source.

## [0.1.0] - 2026-09-23

Initial release: seven read-only tools over Printful orders, store products and
the catalog, with a path allowlist, token scrubbing, optional recipient-PII
redaction, and bounded requests.
