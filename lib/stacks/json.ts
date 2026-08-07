/**
 * Bitflow route objects embed Clarity amounts as BigInt, which JSON.stringify
 * cannot serialize. Tag them for the wire and revive them before executeSwap.
 */

type BigIntTag = { __type: "bigint"; value: string };

function isBigIntTag(v: unknown): v is BigIntTag {
  return (
    !!v &&
    typeof v === "object" &&
    (v as BigIntTag).__type === "bigint" &&
    typeof (v as BigIntTag).value === "string"
  );
}

/** Deep-clone a value, turning BigInt into a JSON-safe tagged object. */
export function serializeBigInts<T>(value: T): T {
  return walkSerialize(value) as T;
}

function walkSerialize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() } satisfies BigIntTag;
  }
  if (Array.isArray(value)) return value.map(walkSerialize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkSerialize(v);
    }
    return out;
  }
  return value;
}

/** Deep-clone a value, turning tagged BigInts back into real BigInts. */
export function reviveBigInts<T>(value: T): T {
  return walkRevive(value) as T;
}

function walkRevive(value: unknown): unknown {
  if (isBigIntTag(value)) return BigInt(value.value);
  if (Array.isArray(value)) return value.map(walkRevive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkRevive(v);
    }
    return out;
  }
  return value;
}
