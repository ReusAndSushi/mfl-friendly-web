// One-time (or periodic refresh) sweep of every MFL club id via the public,
// unauthenticated read API, grouped by division and written to Vercel KV.
// Run locally: `vercel env pull .env.local` first (to get KV credentials),
// then `npm run build-index`.
//
// This mirrors mfl_friendly_bot.py's --build-index, but buckets by division
// instead of one flat file, since the web app's serverless functions read
// only the 1-3 division buckets near a club's own division per request.

import { config } from "dotenv";
config({ path: ".env.local" });
import { Redis } from "@upstash/redis";

// Prefer the confirmed-real integration-managed names first - the plain
// UPSTASH_REDIS_REST_URL/TOKEN names can hold a stale/invalid leftover
// value from an earlier empty .env.example auto-import.
function firstValidUrl(...vals) {
  return vals.find((v) => v && /^https:\/\//.test(v));
}
function firstDefined(...vals) {
  return vals.find((v) => !!v);
}

const url = firstValidUrl(
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL,
  process.env.KV_REST_API_URL,
  process.env.UPSTASH_REDIS_REST_URL
);
const token = firstDefined(
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
  process.env.KV_REST_API_TOKEN,
  process.env.UPSTASH_REDIS_REST_TOKEN
);
if (!url || !token) {
  console.error(
    "Missing Redis credentials. Run `vercel env pull .env.local` first (after adding a Redis integration in the Vercel dashboard)."
  );
  process.exit(1);
}
const kv = new Redis({ url, token });

const API = "https://z519wdyajg.execute-api.us-east-1.amazonaws.com/prod";
const WORKERS = 10;
const MAX_ID_GUESS = 12000;

async function getClub(id) {
  const r = await fetch(`${API}/clubs/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`clubs/${id} -> ${r.status}`);
  return r.json();
}

async function detectMaxId() {
  let lo = 1;
  let hi = MAX_ID_GUESS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const club = await getClub(mid);
    if (club !== null) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const results = new Array(items.length);
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  console.log("Detecting highest club id in use...");
  const maxId = await detectMaxId();
  console.log(`Scanning club ids 1..${maxId} (${WORKERS} at a time)...`);

  const ids = Array.from({ length: maxId }, (_, i) => i + 1);
  let done = 0;
  const byDivision = new Map();

  await mapLimit(ids, WORKERS, async (id) => {
    const club = await getClub(id).catch(() => null);
    done += 1;
    if (done % 1000 === 0) console.log(`  ...${done}/${maxId}`);
    if (club && club.status === "FOUNDED" && typeof club.division === "number") {
      const rec = {
        id,
        name: club.name,
        division: club.division,
        friendlyPref: club.friendlyPref ?? null,
        friendlyPrefCooldown: club.friendlyPrefCooldown ?? 0,
      };
      if (!byDivision.has(club.division)) byDivision.set(club.division, []);
      byDivision.get(club.division).push(rec);
    }
  });

  console.log(`\nWriting ${byDivision.size} division buckets to Vercel KV...`);
  for (const [division, clubs] of byDivision) {
    await kv.set(`division:${division}`, clubs);
    console.log(`  division ${division}: ${clubs.length} clubs`);
  }
  await kv.set("index:builtAt", Date.now());

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
