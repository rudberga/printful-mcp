/**
 * Optional recipient-PII redaction.
 *
 * Printful orders carry real customer names, street addresses, phone numbers
 * and emails. Anything a tool returns lands in a model's context and, usually,
 * in a saved transcript. Operators who don't need shipping details can set
 * PRINTFUL_MCP_REDACT_PII=1 and keep that data out of the conversation
 * entirely, while still seeing order status, items and print files.
 *
 * It is opt-in rather than default because "where is this order going" is a
 * legitimate and common question; silently masking it would be surprising.
 */

const PII_FIELDS = new Set([
  "name",
  "company",
  "address1",
  "address2",
  "zip",
  "phone",
  "email",
  "tax_number",
]);

export function redactionEnabled(): boolean {
  const v = process.env.PRINTFUL_MCP_REDACT_PII?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function maskValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  return "[REDACTED]";
}

/**
 * Walk the structure and mask PII fields inside any `recipient` object.
 * City, state and country survive — they are useful for routing questions and
 * are not identifying on their own.
 */
export function redactPii<T>(data: T): T {
  if (!redactionEnabled()) return data;
  return walk(data, false) as T;
}

function walk(node: unknown, insideRecipient: boolean): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, insideRecipient));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const nowInside = insideRecipient || key === "recipient";
      if (nowInside && PII_FIELDS.has(key)) {
        out[key] = maskValue(value);
      } else {
        out[key] = walk(value, nowInside);
      }
    }
    return out;
  }
  return node;
}
