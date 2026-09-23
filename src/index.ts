#!/usr/bin/env node
/**
 * printful-mcp — a read-only Model Context Protocol server for Printful.
 *
 * Every tool here is a GET. There is no tool that creates, approves, holds or
 * cancels an order, and no generic write path, because an agent that can
 * approve a print-on-demand order can spend real money and start production
 * that cannot be undone. Those actions belong in Printful's dashboard where a
 * human sees them first.
 */

import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { get, PrintfulError, scrub } from "./client.js";
import { redactPii, redactionEnabled } from "./redact.js";

// Read the version from package.json rather than duplicating it here, so the
// version a client sees can never drift from the version that was published.
const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const server = new McpServer({ name: "printful-mcp", version: VERSION });

/** Shared annotations: nothing here mutates, everything talks to a remote API. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Render a successful payload, applying PII redaction on the way out. */
function ok(data: unknown): ToolResult {
  const text = JSON.stringify(redactPii(data), null, 2);
  return { content: [{ type: "text", text: scrub(text) }] };
}

/** Turn any thrown value into a clean, token-free tool error. */
function fail(err: unknown): ToolResult {
  const message =
    err instanceof PrintfulError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: scrub(message) }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

server.registerTool(
  "printful_whoami",
  {
    title: "Check Printful connection",
    description:
      "Verify the configured token and list the Printful stores it can read. " +
      "Use this first to confirm the connection and to get a store id.",
    inputSchema: {},
    annotations: { ...READ_ONLY, title: "Check Printful connection" },
  },
  async () =>
    run(async () => ({
      stores: await get("/stores"),
      pii_redaction: redactionEnabled() ? "enabled" : "disabled",
      server_version: VERSION,
    })),
);

server.registerTool(
  "printful_list_orders",
  {
    title: "List Printful orders",
    description:
      "List orders for the token's store, newest first. Filter by status: " +
      "draft, pending, failed, canceled, inprocess, onhold, partial, fulfilled. " +
      "A 'draft' order with needs_approval true is waiting for a human in the " +
      "Printful dashboard and has not been produced.",
    inputSchema: {
      status: z
        .enum([
          "draft",
          "pending",
          "failed",
          "canceled",
          "inprocess",
          "onhold",
          "partial",
          "fulfilled",
        ])
        .optional()
        .describe("Only return orders in this status"),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
    },
    annotations: { ...READ_ONLY, title: "List Printful orders" },
  },
  async ({ status, offset, limit }) =>
    run(() => get("/orders", { query: { status, offset, limit } })),
);

server.registerTool(
  "printful_get_order",
  {
    title: "Get a Printful order",
    description:
      "Fetch one order in full, including line items, print files and " +
      "embroidery thread options. Pass either printful_id (Printful's own id) " +
      "or external_id (the id from the connected store, e.g. a Shopify order " +
      "number) — exactly one of them.",
    inputSchema: {
      printful_id: z.number().int().positive().optional(),
      external_id: z
        .string()
        .regex(/^[A-Za-z0-9._-]{1,64}$/, "external_id has unexpected characters")
        .optional(),
    },
    annotations: { ...READ_ONLY, title: "Get a Printful order" },
  },
  async ({ printful_id, external_id }) => {
    if ((printful_id === undefined) === (external_id === undefined)) {
      return fail(
        new PrintfulError("Pass exactly one of printful_id or external_id."),
      );
    }
    const path =
      printful_id !== undefined
        ? `/orders/${printful_id}`
        : `/orders/@${external_id}`;
    return run(() => get(path));
  },
);

server.registerTool(
  "printful_list_store_products",
  {
    title: "List store products",
    description:
      "List the sync products in the connected store — the products that map " +
      "a storefront listing to a Printful variant and its print files.",
    inputSchema: {
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { ...READ_ONLY, title: "List store products" },
  },
  async ({ offset, limit }) =>
    run(() => get("/store/products", { query: { offset, limit } })),
);

server.registerTool(
  "printful_get_store_product",
  {
    title: "Get a store product",
    description:
      "Fetch one sync product with its variants and the print files attached " +
      "to each. Use this to see which artwork a product will actually print.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { ...READ_ONLY, title: "Get a store product" },
  },
  async ({ id }) => run(() => get(`/store/products/${id}`)),
);

server.registerTool(
  "printful_get_catalog_product",
  {
    title: "Get a catalog product",
    description:
      "Fetch a Printful catalog product and its variants — blanks, sizes, " +
      "colours and available print placements.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { ...READ_ONLY, title: "Get a catalog product" },
  },
  async ({ id }) => run(() => get(`/products/${id}`)),
);

server.registerTool(
  "printful_get",
  {
    title: "Read any allowed Printful path",
    description:
      "Escape hatch for read endpoints without a dedicated tool. GET only, and " +
      "the path must match this server's allowlist: /stores, /store, " +
      "/store/products, /orders, /products, /products/variant/{id}, " +
      "/countries, /tax/countries. Anything else is refused.",
    inputSchema: {
      path: z
        .string()
        .max(200)
        .describe("API path beginning with /, e.g. /orders?status=draft"),
    },
    annotations: { ...READ_ONLY, title: "Read any allowed Printful path" },
  },
  async ({ path }) => run(() => get(path)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — diagnostics must go to stderr.
  process.stderr.write(`printful-mcp ${VERSION} ready (read-only)\n`);

  // Close the transport on the way out so the client sees a clean disconnect
  // rather than a dead pipe.
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stderr.write(`printful-mcp shutting down (${signal})\n`);
    try {
      await server.close();
    } catch {
      // Nothing useful to do if closing fails; we are exiting anyway.
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// A rejection that escapes a tool handler should be logged and survived, not
// allowed to take down a server that is mid-conversation with a client.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(scrub(`printful-mcp unhandled rejection: ${reason}\n`));
});

main().catch((err) => {
  process.stderr.write(scrub(`printful-mcp failed to start: ${err}\n`));
  process.exit(1);
});
