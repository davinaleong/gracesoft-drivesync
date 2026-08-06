import { createHmac, randomBytes } from "node:crypto";

const KEY_PREFIX = "dsk";

export interface GeneratedApiKey {
  /** Shown to the caller exactly once. Never stored. */
  rawKey: string;
  /** Non-secret, safe to display/log for key identification (e.g. "dsk_3f9a2b1c"). */
  keyPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `${KEY_PREFIX}_${secret}`;
  return { rawKey, keyPrefix: rawKey.slice(0, 12) };
}

// Deterministic HMAC so a presented key can be looked up by recomputing this
// and querying for equality — the raw key is never stored, and the pepper
// must be known to produce a matching hash, so a stolen DB dump alone
// doesn't yield usable keys.
export function hashApiKey(rawKey: string, pepper: string): string {
  return createHmac("sha256", pepper).update(rawKey).digest("hex");
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(`${KEY_PREFIX}_`) && value.length > KEY_PREFIX.length + 1;
}
