import {
  PYTH_FEED_ID_BTC,
  PYTH_FEED_ID_USDC,
  PYTH_LAZER_FEED_BTC,
  PYTH_LAZER_FEED_USDC,
} from "@/lib/stacks/config";
import { ServiceError } from "@/services/errors";

/**
 * Since the Pyth Core upgrade (2026-08-26) every Hermes request needs a Pyth
 * API key; the legacy unauthenticated `hermes.pyth.network` host answers 401.
 */
const HERMES_BASE = (
  process.env.PYTH_HERMES_BASE ?? "https://pyth.dourolabs.app/hermes"
).replace(/\/+$/, "");

function pythApiKey(): string | null {
  const key = (
    process.env.PYTH_API_KEY ??
    process.env.PYTH_LAZER_API_KEY ??
    process.env.PYTH_PRO_API_KEY ??
    ""
  ).trim();
  return key.length > 0 ? key : null;
}

export type PythSpotPrices = {
  btcUsd: number;
  usdcUsd: number;
  publishTime: number;
};

type HermesParsed = {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
};

type HermesResponse = {
  binary?: { encoding?: string; data?: string[] };
  parsed?: HermesParsed[];
};

function pythPriceToUsd(price: string, expo: number): number {
  const n = Number(price);
  if (!Number.isFinite(n)) return 0;
  return n * 10 ** expo;
}

/** Latest BTC + USDC spot prices from Pyth Hermes. */
export async function fetchPythSpotPrices(): Promise<PythSpotPrices> {
  const ids = [PYTH_FEED_ID_BTC, PYTH_FEED_ID_USDC]
    .map((id) => `ids[]=${encodeURIComponent(id)}`)
    .join("&");
  const url = `${HERMES_BASE}/v2/updates/price/latest?${ids}&encoding=hex&parsed=true`;
  const token = pythApiKey();
  if (!token) {
    throw new ServiceError(
      500,
      "Set PYTH_API_KEY — Pyth Hermes requires an API key since 2026-08-26",
    );
  }

  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 120);
    throw new ServiceError(
      502,
      `Hermes price fetch failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const json = (await res.json()) as HermesResponse;
  const parsed = json.parsed ?? [];
  const btc = parsed.find((p) => p.id.includes("e62df6c8"));
  const usdc = parsed.find((p) => p.id.includes("eaa020c6"));
  if (!btc || !usdc) {
    throw new ServiceError(502, "Hermes did not return BTC/USDC prices");
  }

  return {
    btcUsd: pythPriceToUsd(btc.price.price, btc.price.expo),
    usdcUsd: pythPriceToUsd(usdc.price.price, usdc.price.expo),
    publishTime: Math.max(btc.price.publish_time, usdc.price.publish_time),
  };
}

const LAZER_REST = "https://pyth-lazer.dourolabs.app/v1/latest_price";
/** EVM Lazer envelope magic `0x2a22999a` (see stx-labs/stacks-pyth-lazer). */
const LAZER_EVM_MAGIC = "2a22999a";

function extractLazerEvmHex(json: unknown): string | null {
  const fromEvm = (o: Record<string, unknown>): string | null => {
    const evm = o.evm;
    if (evm && typeof evm === "object") {
      const data = (evm as { data?: unknown }).data;
      if (typeof data === "string" && data.length > 8) {
        return data.replace(/^0x/i, "");
      }
    }
    if (typeof o.data === "string" && o.data.length > 8) {
      return o.data.replace(/^0x/i, "");
    }
    return null;
  };

  if (Array.isArray(json)) {
    for (const item of json) {
      const hex = extractLazerEvmHex(item);
      if (hex) return hex;
    }
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  const direct = fromEvm(rec);
  if (direct) return direct;
  for (const key of ["message", "messages", "payload", "result", "data"]) {
    const nested = extractLazerEvmHex(rec[key]);
    if (nested) return nested;
  }
  return null;
}

/**
 * One Pyth Pro (Lazer) EVM update for the Zest market.
 * Hermes PNAU is rejected on-chain (err u400022).
 */
export async function fetchPythPriceFeedHexes(): Promise<string[]> {
  const token = pythApiKey();
  if (!token) {
    throw new ServiceError(
      500,
      "Set PYTH_API_KEY (Pyth Pro / Lazer) to attach Zest price feeds",
    );
  }

  const res = await fetch(LAZER_REST, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Isolated sBTC → USDCx only needs BTC (1) and USDC (7). STX (45) is
      // accepted on-chain if present, but demo Pro keys often lack that grant.
      priceFeedIds: [PYTH_LAZER_FEED_BTC, PYTH_LAZER_FEED_USDC],
      properties: [
        "price",
        "exponent",
        "confidence",
        "publisherCount",
        "feedUpdateTimestamp",
      ],
      formats: ["evm"],
      jsonBinaryEncoding: "hex",
      channel: "fixed_rate@200ms",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ServiceError(
      502,
      `Pyth Lazer fetch failed (${res.status}): ${text.slice(0, 180)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError(502, "Pyth Lazer returned non-JSON");
  }

  const hex = extractLazerEvmHex(json)?.toLowerCase() ?? null;
  if (!hex || !hex.startsWith(LAZER_EVM_MAGIC)) {
    throw new ServiceError(502, "Pyth Lazer did not return an EVM price update");
  }
  if (hex.length / 2 > 8192) {
    throw new ServiceError(502, "Pyth Lazer update exceeds Zest's 8192-byte cap");
  }

  return [hex];
}
