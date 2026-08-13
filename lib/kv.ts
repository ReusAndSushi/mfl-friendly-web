// Small wrapper so the rest of the app doesn't care exactly which env var
// names Vercel's Redis/Upstash integration populated. The names vary
// depending on whether a custom prefix was used when connecting the
// integration (e.g. plain KV_REST_API_URL, or a prefixed variant like
// <PREFIX>_KV_REST_API_URL if you gave the integration a custom prefix to
// avoid colliding with other env vars). Lazily constructed so a missing
// env var only fails at request time, not at build/import time (which
// would otherwise break `next build` since route modules get loaded then
// too).
import { Redis } from "@upstash/redis";

let client: Redis | null = null;

const URL_CANDIDATES = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_KV_REST_API_URL",
  "KV_REST_API_URL",
];
const TOKEN_CANDIDATES = [
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
  "KV_REST_API_TOKEN",
];

function firstDefined(names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

export function kv(): Redis {
  if (client) return client;
  const url = firstDefined(URL_CANDIDATES);
  const token = firstDefined(TOKEN_CANDIDATES);
  if (!url || !token) {
    throw new Error(
      "Missing Redis credentials: none of " +
        URL_CANDIDATES.join(", ") +
        " (url) / " +
        TOKEN_CANDIDATES.join(", ") +
        " (token) are set - add a Redis integration to this Vercel project " +
        "and check Settings -> Environment Variables for the exact names it created."
    );
  }
  client = new Redis({ url, token });
  return client;
}
