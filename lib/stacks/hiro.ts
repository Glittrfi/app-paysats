import { hiroApiBase, type StacksNetworkId } from "@/lib/stacks/config";

type CacheEntry = { expires: number; status: number; body: string };

const responseCache = new Map<string, CacheEntry>();

function hiroHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.HIRO_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a Hiro API path with optional API key, 429 backoff, and short GET cache.
 * Unauthenticated Hiro limit is ~50 RPM; with HIRO_API_KEY it's ~500 RPM.
 */
export async function hiroFetch(
  path: string,
  opts?: {
    network?: StacksNetworkId;
    /** Cache successful GET responses (ms). Default 0 = no cache. */
    cacheTtlMs?: number;
    retries?: number;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const network = opts?.network ?? "mainnet";
  const base = hiroApiBase(network).replace(/\/$/, "");
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const cacheTtlMs = opts?.cacheTtlMs ?? 0;
  const retries = opts?.retries ?? 3;

  if (cacheTtlMs > 0) {
    const hit = responseCache.get(url);
    if (hit && hit.expires > Date.now()) {
      return new Response(hit.body, {
        status: hit.status,
        headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }
  }

  let last: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await fetch(url, {
      headers: hiroHeaders(),
      cache: "no-store",
      signal: opts?.signal ?? AbortSignal.timeout(15_000),
    });

    if (last.status !== 429) break;

    const retryAfter = Number(last.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter)
      ? Math.min(Math.max(retryAfter, 1) * 1000, 15_000)
      : Math.min(1000 * 2 ** attempt, 8_000);
    if (attempt < retries) await sleep(waitMs);
  }

  if (cacheTtlMs > 0 && last && last.ok) {
    const body = await last.text();
    responseCache.set(url, {
      expires: Date.now() + cacheTtlMs,
      status: last.status,
      body,
    });
    // Opportunistic prune
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of responseCache) {
        if (v.expires <= now) responseCache.delete(k);
      }
    }
    return new Response(body, {
      status: last.status,
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  }

  return last!;
}
