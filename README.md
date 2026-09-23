# printful-mcp

[![npm](https://img.shields.io/npm/v/printful-mcp)](https://www.npmjs.com/package/printful-mcp)
[![CI](https://github.com/rudberga/printful-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rudberga/printful-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/printful-mcp)](./LICENSE)

A **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server for the [Printful](https://www.printful.com) print-on-demand API.

Lets an AI assistant answer questions about your Printful store — order status, what a print file actually contains, which variant maps to which artwork — without being able to spend your money.

## Why read-only

An agent that can approve a print-on-demand order can start production that cannot be undone and bill you for it. There is no tool here that creates, approves, holds or cancels an order, and no generic write path. Those actions belong in Printful's dashboard, where a human sees them first.

If you want writes, fork it and add them deliberately. Please don't ask this package to grow a `POST`.

## Install

```bash
npx printful-mcp
```

Get a token from the [Printful developer portal](https://developers.printful.com) (Settings → API), then add the server to your MCP client.

**Claude Code** — `.mcp.json` in your project, or `~/.claude.json` for every project:

```json
{
  "mcpServers": {
    "printful": {
      "command": "npx",
      "args": ["-y", "printful-mcp"],
      "env": { "PRINTFUL_TOKEN": "your-token-here" }
    }
  }
}
```

**Claude Desktop** — the same block in `claude_desktop_config.json`.

The token is read **only** from the environment. It is never accepted as a command-line argument, because process arguments are visible to other users on the machine.

## Tools

| Tool | What it does |
|---|---|
| `printful_whoami` | Verify the token and list readable stores. Start here. |
| `printful_list_orders` | List orders, filterable by status. |
| `printful_get_order` | One order in full — line items, print files, thread options. By Printful id or the connected store's external id. |
| `printful_list_store_products` | Sync products in the connected store. |
| `printful_get_store_product` | One sync product, its variants and the print files attached to each. |
| `printful_get_catalog_product` | A Printful catalog blank, its variants and print placements. |
| `printful_get` | Escape hatch for allowlisted read paths without a dedicated tool. |

Every tool is annotated `readOnlyHint: true`.

## Configuration

| Variable | Required | Effect |
|---|---|---|
| `PRINTFUL_TOKEN` | yes | Printful API token. |
| `PRINTFUL_MCP_REDACT_PII` | no | Set to `1` to mask recipient names, street addresses, phone numbers, emails and tax numbers in every response. City, state and country are preserved. |

### About that PII flag

Printful orders carry real customer names and addresses. Anything a tool returns lands in a model's context and usually in a saved transcript. If you don't need shipping details, set `PRINTFUL_MCP_REDACT_PII=1` and keep that data out of the conversation entirely — you still see order status, items and print files.

It is opt-in rather than default because "where is this order going" is a legitimate and common question, and silently masking it would be surprising.

## Security posture

- **GET only.** No code path issues another HTTP method.
- **Path allowlist.** The base URL is a constant; callers pass a path, never a URL. Paths are matched against an allowlist, and `..`, `//`, backslashes and absolute URLs are refused before any request is made.
- **No redirect following.** A redirect off `api.printful.com` is an error, not a hop.
- **Token hygiene.** Read from the environment, never logged, and every outbound string is scrubbed of it as a second line of defence.
- **Bounded requests.** 15-second timeout, 2 MB response cap, capped backoff on HTTP 429.
- **Small surface.** Two runtime dependencies: the MCP SDK and Zod.

Found a security problem? See [SECURITY.md](./SECURITY.md) — please use private vulnerability reporting rather than a public issue.

## Development

```bash
npm install
npm test     # build + unit tests, no token or network needed
npm run smoke  # end-to-end against the live API, needs PRINTFUL_TOKEN
```

`test/guards.test.mjs` covers the security guards — the path allowlist, traversal
and absolute-URL refusal, token scrubbing and PII redaction — with no token and
no network, so CI runs it on every push across Node 18, 20 and 22.

`scripts/smoke.mjs` speaks real MCP over stdio against the live API: it checks the handshake, the tool list and annotations, a successful call, and that the guardrails actually refuse disallowed paths, traversal attempts, absolute URLs and mutually exclusive arguments.

## License

MIT
