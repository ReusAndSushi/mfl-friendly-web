// Small wrapper so the rest of the app doesn't care whether Vercel's
// dashboard populated UPSTASH_REDIS_REST_* or the older KV_REST_API_*
// env var names (both are seen in the wild depending on when/how the
// Redis integration was added). Lazily constructed so a missing env var
// only fails at request time, not at build/import time (which would
// otherwise break `next build` since route modules get loaded then too).
import { Redis } from "@upstash/redis";

let client: Redis | null = null;

export function kv(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing Redis credentials: set UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) - " +
        "add a Redis integration to this Vercel project and run `vercel env pull .env.local`."
    );
  }
  client = new Redis({ url, token });
  return client;
}
