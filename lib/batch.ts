// Multi-club batch play: run N friendlies across several of your own clubs
// on command, rather than the single continuous club driven by MFL_CLUB_ID.
// Each club has its OWN 5-minute cooldown (it's a per-club timestamp on
// MFL's side, not global), so clubs in a batch progress independently -
// one tick can play a friendly for every eligible club at once, not just
// one club per tick.
import { kv } from "@/lib/kv";
import { findSimilarOpponents, playFriendly } from "@/lib/mfl";

const MIN_INTERVAL_MS = 5 * 60 * 1000;
const RECENT_OPPONENT_TTL_SECONDS = 60 * 60 * 6;

const ACTIVE_KEY = "batch:active";
const remainingKey = (clubId: number) => `batch:remaining:${clubId}`;
const lastAtKey = (clubId: number) => `batch:lastAt:${clubId}`;
const playedKey = (clubId: number) => `batch:played:${clubId}`;
const recentOpponentsKey = (clubId: number) => `batch:recentOpponents:${clubId}`;

export async function startBatch(clubIds: number[], countPerClub: number) {
  const db = kv();
  for (const clubId of clubIds) {
    await db.set(remainingKey(clubId), countPerClub);
    await db.set(playedKey(clubId), 0);
    await db.sadd(ACTIVE_KEY, String(clubId));
  }
  return { clubIds, countPerClub };
}

export async function getBatchStatus() {
  const db = kv();
  const active = ((await db.smembers(ACTIVE_KEY)) ?? []).map(Number);
  const status = await Promise.all(
    active.map(async (clubId) => ({
      clubId,
      remaining: (await db.get<number>(remainingKey(clubId))) ?? 0,
      played: (await db.get<number>(playedKey(clubId))) ?? 0,
      lastAt: (await db.get<number>(lastAtKey(clubId))) ?? null,
    }))
  );
  return status;
}

export type TickResult = {
  clubId: number;
  played: boolean;
  reason?: string;
  opponent?: { id: number; name: string; rating: number; gap: number };
};

/** Process one tick: for every active club whose cooldown has elapsed and
 * has remaining count, play one friendly. Independent per club, so this
 * can play for multiple clubs in a single call. */
export async function tickBatch(opts: {
  authHeader: string;
  tolerance: number;
  divisionRadius: number;
  formation: string;
}): Promise<TickResult[]> {
  const db = kv();
  const active = ((await db.smembers(ACTIVE_KEY)) ?? []).map(Number);
  const now = Date.now();
  const results: TickResult[] = [];

  for (const clubId of active) {
    const remaining = (await db.get<number>(remainingKey(clubId))) ?? 0;
    if (remaining <= 0) {
      await db.srem(ACTIVE_KEY, String(clubId));
      continue;
    }

    const lastAt = (await db.get<number>(lastAtKey(clubId))) ?? 0;
    if (now - lastAt < MIN_INTERVAL_MS) {
      results.push({ clubId, played: false, reason: "cooldown" });
      continue;
    }

    const recentOpponents = (await db.smembers(recentOpponentsKey(clubId))) ?? [];
    const recentSet = new Set(recentOpponents.map(String));

    const { matches } = await findSimilarOpponents({
      clubId,
      formation: opts.formation,
      tolerance: opts.tolerance,
      divisionRadius: opts.divisionRadius,
    });
    const candidate = matches.find((m) => !recentSet.has(String(m.id)));
    if (!candidate) {
      results.push({ clubId, played: false, reason: "no_eligible_candidate" });
      continue;
    }

    const result = await playFriendly(clubId, candidate.id, opts.authHeader);
    if (result.ok) {
      await db.set(lastAtKey(clubId), now);
      await db.set(remainingKey(clubId), remaining - 1);
      await db.incr(playedKey(clubId));
      await db.sadd(recentOpponentsKey(clubId), String(candidate.id));
      await db.expire(recentOpponentsKey(clubId), RECENT_OPPONENT_TTL_SECONDS);
      if (remaining - 1 <= 0) await db.srem(ACTIVE_KEY, String(clubId));
      results.push({
        clubId,
        played: true,
        opponent: { id: candidate.id, name: candidate.name, rating: candidate.rating, gap: candidate.gap },
      });
    } else {
      results.push({ clubId, played: false, reason: `api_error_${result.status}` });
    }
  }

  return results;
}
