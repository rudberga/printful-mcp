# Security Policy

## Reporting a vulnerability

Please report security issues through
[GitHub's private vulnerability reporting](https://github.com/rudberga/printful-mcp/security/advisories/new)
rather than a public issue. If that isn't available to you, open a minimal issue
saying only that you've found a security problem, and I'll follow up privately.

Please don't include a working exploit in a public issue.

## What this package is designed to prevent

This server is deliberately read-only, and several properties are load-bearing.
A defect in any of these is a security issue, not a bug report:

- **No write path.** No tool issues anything but a `GET`. If a change would let
  an agent create, approve, hold or cancel a Printful order, that change does
  not belong here.
- **No arbitrary host access.** The base URL is a constant. Callers supply a
  path, never a URL. Paths are matched against an allowlist, and `..`, `//`,
  backslashes and absolute URLs are refused before any request is made.
  Redirects off `api.printful.com` are errors, not hops.
- **Token confinement.** The token is read only from the environment, never
  from a command-line argument, and is scrubbed from every outbound string.
  If you can get the token to appear in a tool result or an error message,
  that's a vulnerability.
- **Bounded requests.** Timeout, response size cap and capped backoff exist so
  a hostile or broken upstream can't hang or flood a client.

## Scope notes

Printful order data contains real customer names and addresses. Set
`PRINTFUL_MCP_REDACT_PII=1` to keep that out of model context and transcripts.
Whether your MCP client stores transcripts, and where, is outside this
package's control — treat that as part of your own threat model.

## Supported versions

The latest published version is supported. This is a small package; fixes go
out as a new release rather than being backported.
