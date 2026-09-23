/**
 * Unit tests for the security guards. These run against the built output and
 * need no token and no network, so CI can run them on every push — unlike
 * scripts/smoke.mjs, which talks to the live API.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { assertAllowedPath, scrub } from "../dist/client.js";
import { redactPii } from "../dist/redact.js";

test("allowlist accepts the documented read paths", () => {
  const good = [
    "/stores",
    "/stores/18545484",
    "/store",
    "/store/products",
    "/store/products/123",
    "/orders",
    "/orders/456",
    "/orders/@1004",
    "/orders?status=draft",
    "/products",
    "/products/71",
    "/products/variant/12761",
    "/countries",
    "/tax/countries",
  ];
  for (const path of good) {
    assert.doesNotThrow(() => assertAllowedPath(path), `should allow ${path}`);
  }
});

test("allowlist refuses paths outside the read surface", () => {
  const bad = [
    "/webhooks",
    "/orders/456/confirm",
    "/shipping/rates",
    "/mockup-generator/create-task/71",
    "/oauth/scopes",
  ];
  for (const path of bad) {
    assert.throws(() => assertAllowedPath(path), `should refuse ${path}`);
  }
});

test("allowlist refuses traversal and host smuggling", () => {
  const hostile = [
    "/orders/../../webhooks",
    "/orders/..%2f..%2fwebhooks",
    "//evil.example.com/orders",
    "https://evil.example.com/orders",
    "http://evil.example.com/orders",
    "/orders\\..\\webhooks",
    "orders",
    "",
  ];
  for (const path of hostile) {
    assert.throws(() => assertAllowedPath(path), `should refuse ${path}`);
  }
});

test("allowlist matches the whole path, not a prefix", () => {
  // A path that merely starts with an allowed segment must not slip through.
  assert.throws(() => assertAllowedPath("/storesomething"));
  assert.throws(() => assertAllowedPath("/orders/456/items"));
});

test("scrub removes the token from outgoing text", () => {
  const original = process.env.PRINTFUL_TOKEN;
  process.env.PRINTFUL_TOKEN = "super-secret-value";
  try {
    const text = "Authorization: Bearer super-secret-value failed";
    assert.equal(scrub(text), "Authorization: Bearer [REDACTED] failed");
    assert.equal(scrub("nothing sensitive"), "nothing sensitive");
  } finally {
    if (original === undefined) delete process.env.PRINTFUL_TOKEN;
    else process.env.PRINTFUL_TOKEN = original;
  }
});

test("scrub is a no-op when no token is configured", () => {
  const original = process.env.PRINTFUL_TOKEN;
  delete process.env.PRINTFUL_TOKEN;
  try {
    assert.equal(scrub("plain text"), "plain text");
  } finally {
    if (original !== undefined) process.env.PRINTFUL_TOKEN = original;
  }
});

const ORDER = {
  id: 1,
  status: "draft",
  recipient: {
    name: "Ada Lovelace",
    company: "Analytical Engines",
    address1: "12 Example Street",
    address2: null,
    city: "London",
    state_name: "England",
    country_name: "United Kingdom",
    zip: "EC1A",
    phone: "+44 20 7946 0000",
    email: "ada@example.com",
    tax_number: "GB123",
  },
  items: [{ name: "Tee", quantity: 1 }],
};

test("redaction is off unless explicitly enabled", () => {
  const original = process.env.PRINTFUL_MCP_REDACT_PII;
  delete process.env.PRINTFUL_MCP_REDACT_PII;
  try {
    const out = redactPii(ORDER);
    assert.equal(out.recipient.name, "Ada Lovelace");
    assert.equal(out.recipient.email, "ada@example.com");
  } finally {
    if (original !== undefined) process.env.PRINTFUL_MCP_REDACT_PII = original;
  }
});

test("redaction masks identifying fields but keeps routing context", () => {
  const original = process.env.PRINTFUL_MCP_REDACT_PII;
  process.env.PRINTFUL_MCP_REDACT_PII = "1";
  try {
    const out = redactPii(ORDER);
    for (const field of [
      "name",
      "company",
      "address1",
      "zip",
      "phone",
      "email",
      "tax_number",
    ]) {
      assert.equal(out.recipient[field], "[REDACTED]", `${field} should be masked`);
    }
    // Non-identifying geography survives, so routing questions still work.
    assert.equal(out.recipient.city, "London");
    assert.equal(out.recipient.state_name, "England");
    assert.equal(out.recipient.country_name, "United Kingdom");
    // Null stays null rather than becoming a misleading "[REDACTED]".
    assert.equal(out.recipient.address2, null);
    // Everything outside recipient is untouched.
    assert.equal(out.status, "draft");
    assert.equal(out.items[0].name, "Tee");
  } finally {
    if (original === undefined) delete process.env.PRINTFUL_MCP_REDACT_PII;
    else process.env.PRINTFUL_MCP_REDACT_PII = original;
  }
});

test("redaction does not mutate the input object", () => {
  const original = process.env.PRINTFUL_MCP_REDACT_PII;
  process.env.PRINTFUL_MCP_REDACT_PII = "1";
  try {
    redactPii(ORDER);
    assert.equal(ORDER.recipient.name, "Ada Lovelace");
  } finally {
    if (original === undefined) delete process.env.PRINTFUL_MCP_REDACT_PII;
    else process.env.PRINTFUL_MCP_REDACT_PII = original;
  }
});

test("redaction reaches nested orders in a list response", () => {
  const original = process.env.PRINTFUL_MCP_REDACT_PII;
  process.env.PRINTFUL_MCP_REDACT_PII = "true";
  try {
    const out = redactPii([ORDER, ORDER]);
    assert.equal(out[0].recipient.name, "[REDACTED]");
    assert.equal(out[1].recipient.email, "[REDACTED]");
  } finally {
    if (original === undefined) delete process.env.PRINTFUL_MCP_REDACT_PII;
    else process.env.PRINTFUL_MCP_REDACT_PII = original;
  }
});
