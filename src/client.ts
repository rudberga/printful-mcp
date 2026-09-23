/**
 * Minimal, deliberately read-only HTTP client for the Printful API.
 *
 * Security posture — every one of these is load-bearing, not decoration:
 *   - GET only. There is no code path that issues another method.
 *   - The base URL is a constant. Callers supply a path, never a URL, and the
 *     path is validated against an allowlist before it is used.
 *   - The token is read from the environment once and never echoed. Any value
 *     leaving this module is passed through `scrub()` first.
 *   - Requests time out, responses are size-capped, and 429s back off.
 */

const API_BASE = "https://api.printful.com";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
const MAX_RETRIES = 2;

/** Path prefixes this server is willing to read. Anything else is refused. */
const ALLOWED_PATHS: RegExp[] = [
  /^\/stores(\/\d+)?$/,
  /^\/store$/,
  /^\/store\/products(\/\d+)?$/,
  /^\/orders(\/(@[A-Za-z0-9._-]+|\d+))?$/,
  /^\/products(\/\d+)?$/,
  /^\/products\/variant\/\d+$/,
  /^\/countries$/,
  /^\/tax\/countries$/,
];

export class PrintfulError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "PrintfulError";
  }
}

function token(): string {
  const t = process.env.PRINTFUL_TOKEN?.trim();
  if (!t) {
    throw new PrintfulError(
      "PRINTFUL_TOKEN is not set. Add it to the env block of this server's MCP " +
        "configuration. The token is never read from a command-line argument, " +
        "because process arguments are visible to other users on the machine.",
    );
  }
  return t;
}

/**
 * Remove the token from anything on its way out. Belt and braces: the token
 * should never reach an error string, but an upstream service echoing an
 * Authorization header back would otherwise leak it into a transcript.
 */
export function scrub(text: string): string {
  const t = process.env.PRINTFUL_TOKEN?.trim();
  if (!t) return text;
  return text.split(t).join("[REDACTED]");
}

export function assertAllowedPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new PrintfulError(`Path must start with "/": ${path}`);
  }
  // Reject anything that could escape the base URL or smuggle a second host.
  if (path.includes("..") || path.includes("//") || path.includes("\\")) {
    throw new PrintfulError(`Refusing suspicious path: ${path}`);
  }
  const pathname = path.split("?")[0] ?? path;
  if (!ALLOWED_PATHS.some((re) => re.test(pathname))) {
    throw new PrintfulError(
      `Path not in this server's read allowlist: ${pathname}. ` +
        `Allowed: /stores, /store, /store/products, /orders, /products, ` +
        `/products/variant/{id}, /countries, /tax/countries.`,
    );
  }
}

export interface GetOptions {
  query?: Record<string, string | number | undefined>;
}

/** Issue one validated GET against the Printful API and return parsed JSON. */
export async function get<T = unknown>(
  path: string,
  opts: GetOptions = {},
): Promise<T> {
  assertAllowedPath(path);

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let lastError: PrintfulError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token()}`,
          Accept: "application/json",
          "User-Agent": "printful-mcp",
        },
        signal: controller.signal,
        redirect: "error", // never follow a redirect off api.printful.com
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new PrintfulError(scrub(`Request to ${path} failed: ${msg}`));
    } finally {
      clearTimeout(timer);
    }

    // Back off on rate limiting, honouring Retry-After within reason.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1000, 10_000)
        : 1000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      lastError = new PrintfulError("Rate limited by Printful", 429);
      continue;
    }

    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw new PrintfulError(
        `Response from ${path} exceeded ${MAX_BYTES} bytes. Narrow the request ` +
          `with limit/offset.`,
        res.status,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new PrintfulError(
        scrub(`Printful returned non-JSON for ${path}: ${text.slice(0, 300)}`),
        res.status,
      );
    }

    if (!res.ok) {
      const reason =
        (body as { result?: string; error?: { message?: string } })?.error
          ?.message ??
        (body as { result?: string })?.result ??
        res.statusText;
      throw new PrintfulError(
        scrub(`Printful ${res.status} for ${path}: ${reason}`),
        res.status,
        body,
      );
    }

    return (body as { result?: T }).result as T;
  }

  throw lastError ?? new PrintfulError(`Request to ${path} failed`);
}
