#!/usr/bin/env node
/**
 * End-to-end smoke test: spawns the server over stdio, speaks real MCP, and
 * exercises both the happy path and the guardrails.
 *
 * Requires a working PRINTFUL_TOKEN in the environment. Hits the live API.
 *   node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";

const NL = String.fromCharCode(10);

const child = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf(NL)) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + NL);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + NL);
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
check(
  "initialize",
  init.result?.serverInfo?.name === "printful-mcp",
  init.result?.serverInfo?.name,
);
notify("notifications/initialized", {});

const tools = await send("tools/list", {});
const toolList = tools.result?.tools ?? [];
const names = toolList.map((t) => t.name).sort();
check("tools/list returns 7 tools", names.length === 7, names.join(", "));
check(
  "all tools annotated read-only",
  toolList.every((t) => t.annotations?.readOnlyHint === true),
);

const who = await send("tools/call", { name: "printful_whoami", arguments: {} });
const whoText = who.result?.content?.[0]?.text ?? "";
check(
  "printful_whoami succeeds",
  who.result?.isError !== true,
  whoText.slice(0, 70).replace(/\s+/g, " "),
);

const denied = await send("tools/call", {
  name: "printful_get",
  arguments: { path: "/webhooks" },
});
check(
  "disallowed path refused",
  denied.result?.isError === true,
  (denied.result?.content?.[0]?.text ?? "").slice(0, 55),
);

const traversal = await send("tools/call", {
  name: "printful_get",
  arguments: { path: "/orders/../../webhooks" },
});
check("path traversal refused", traversal.result?.isError === true);

const absolute = await send("tools/call", {
  name: "printful_get",
  arguments: { path: "https://example.com/steal" },
});
check("absolute URL refused", absolute.result?.isError === true);

const bothIds = await send("tools/call", {
  name: "printful_get_order",
  arguments: { printful_id: 1, external_id: "1" },
});
check("mutually exclusive args refused", bothIds.result?.isError === true);

const token = process.env.PRINTFUL_TOKEN;
check("token never appears in output", !(token && whoText.includes(token)));

child.kill();
const failed = results.filter((r) => !r.passed).length;
console.log(`${NL}${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
