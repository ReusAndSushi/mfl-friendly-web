import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/lib/kv";
import { findSimilarOpponents, playFriendly } from "@/lib/mfl";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MIN_INTERVAL_MS = 5 * 60 * 1000; // MFL's own observed friendly cooldown
const RECENT_OPPONENT_TTL_SECONDS = 60 * 60 * 6; // don't re-challenge the same club within 6h

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function POST(req: NextRequest) {
  // Only the scheduled GitHub Actions job (or you, manually) should be able
  // to trigger a real play - this is a real, stateful action.
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clubId = Number(process.env.MFL_CLUB_ID);
  const authHeader = process.env.MFL_AUTH_HEADER;
  const tolerance = Number(process.env.MFL_TOLERANCE ?? "3");
  const divisionRadius = Number(process.env.MFL_DIVISION_RADIUS ?? "1");
  const formation = process.env.MFL_FORMATION ?? "4-3-3";
  const maxPerDay = Number(process.env.MFL_MAX_PER_DAY ?? "10");

  if (!clubId || !authHeader) {
    return NextResponse.json(
      { error: "Server is missing MFL_CLUB_ID or MFL_AUTH_HEADER env vars" },
      { status: 500 }
    );
  }

  const db = kv();

  const lastAt = (await db.get<number>("play:lastAt")) ?? 0;
  const sinceLast = Date.now() - lastAt;
  if (sinceLast < MIN_INTERVAL_MS) {
    return NextResponse.json({
      played: false,
      reason: "cooldown",
      retryInMs: MIN_INTERVAL_MS - sinceLast,
    });
  }

  const dayKey = `play:count:${todayKey()}`;
  const countToday = (await db.get<number>(dayKey)) ?? 0;
  if (countToday >= maxPerDay) {
    return NextResponse.json({ played: false, reason: "daily_cap_reached", countToday, maxPerDay });
  }

  const recentOpponents = (await db.smembers("play:recentOpponents")) ?? [];
  const recentSet = new Set(recentOpponents.map(String));

  const { matches, myRating } = await findSimilarOpponents({
    clubId,
    formation,
    tolerance,
    divisionRadius,
  });

  const candidate = matches.find((m) => !recentSet.has(String(m.id)));
  if (!candidate) {
    return NextResponse.json({ played: false, reason: "no_eligible_candidate", myRating });
  }

  const result = await playFriendly(clubId, candidate.id, authHeader);

  if (result.ok) {
    await db.set("play:lastAt", Date.now());
    await db.set(dayKey, countToday + 1, { ex: 60 * 60 * 30 }); // expire well after the day ends
    await db.sadd("play:recentOpponents", String(candidate.id));
    await db.expire("play:recentOpponents", RECENT_OPPONENT_TTL_SECONDS);
  }

  return NextResponse.json({
    played: result.ok,
    opponent: { id: candidate.id, name: candidate.name, rating: candidate.rating, gap: candidate.gap },
    myRating,
    apiStatus: result.status,
    apiResponse: result.body,
  });
}
