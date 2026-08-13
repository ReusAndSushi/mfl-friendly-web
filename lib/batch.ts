// On-command batch: your club plays a queue of friendlies against
// hand-picked opponents (e.g. 5 games each vs. 5 chosen teams = 25 total).
// One home club per batch queue, processed in order; the club's own
// 5-minute cooldown paces how fast the queue drains (one friendly per
// eligible home club per tick). Multiple home clubs can each have their
// own independent queue running at the same time.
import { kv } from "@/lib/kv";
import { playFriendly } from "@/lib/mfl";

const MIN_INTERVAL_MS = 5 * 60 * 1000;

const HOME_CLUBS_KEY = "oppbatch:homeClubs";
const queueKey = (clubId: number) => `oppbatch:queue:${clubId}`;
const lastAtKey = (clubId: number) => `oppbatch:lastAt:${clubId}`;
const playedKey = (clubId: number) => `oppbatch:played:${clubId}`;

export type OpponentPick = { id: number; name: string };

/** Queue up countPerOpponent friendlies against each chosen opponent,
 * round-robin interleaved so the same opponent isn't played back-to-back
 * when possible. */
export async function startOpponentBatch(
  clubId: number,
  opponents: OpponentPick[],
  countPerOpponent: number
) {
  const db = kv();
  const queue: OpponentPick[] = [];
  for (let round = 0; round < countPerOpponent; round++) {
    for (const opp of opponents) queue.push(opp);
  }
  if (queue.length > 0) {
    await db.rpush(queueKey(clubId), ...queue.map((o) => JSON.stringify(o)));
    await db.sadd(HOME_CLUBS_KEY, String(clubId));
  }
  return { clubId, opponents, countPerOpponent, totalQueued: queue.length };
}

export async function getOpponentBatchStatus() {
  const db = kv();
  const homeClubs = ((await db.smembers(HOME_CLUBS_KEY)) ?? []).map(Number);
  return Promise.all(
    homeClubs.map(async (clubId) => ({
      clubId,
      queued: await db.llen(queueKey(clubId)),
      played: (await db.get<number>(playedKey(clubId))) ?? 0,
      lastAt: (await db.get<number>(lastAtKey(clubId))) ?? null,
    }))
  );
}

export type TickResult = {
  clubId: number;
  played: boolean;
  reason?: string;
  opponent?: OpponentPick;
};

export async function tickOpponentBatch(authHeader: string): Promise<TickResult[]> {
  const db = kv();
  const homeClubs = ((await db.smembers(HOME_CLUBS_KEY)) ?? []).map(Number);
  const now = Date.now();
  const results: TickResult[] = [];

  for (const clubId of homeClubs) {
    try {
      const qLen = await db.llen(queueKey(clubId));
      if (qLen === 0) {
        await db.srem(HOME_CLUBS_KEY, String(clubId));
        continue;
      }

      const lastAt = (await db.get<number>(lastAtKey(clubId))) ?? 0;
      if (now - lastAt < MIN_INTERVAL_MS) {
        results.push({ clubId, played: false, reason: "cooldown" });
        continue;
      }

      const raw = await db.lpop(queueKey(clubId));
      if (!raw) {
        await db.srem(HOME_CLUBS_KEY, String(clubId));
        continue;
      }
      const opponent: OpponentPick = typeof raw === "string" ? JSON.parse(raw) : (raw as any);

      const result = await playFriendly(clubId, opponent.id, authHeader);
      if (result.ok) {
        await db.set(lastAtKey(clubId), now);
        await db.incr(playedKey(clubId));
        results.push({ clubId, played: true, opponent });
      } else {
        // Put it back at the front of the queue so a transient API error
        // doesn't silently drop this opponent from the batch.
        await db.lpush(queueKey(clubId), raw);
        results.push({ clubId, played: false, reason: `api_error_${result.status}` });
      }

      if ((await db.llen(queueKey(clubId))) === 0) {
        await db.srem(HOME_CLUBS_KEY, String(clubId));
      }
    } catch (e: any) {
      results.push({ clubId, played: false, reason: `error: ${String(e?.message ?? e)}` });
    }
  }

  return results;
}
