import { NextRequest, NextResponse } from "next/server";
import { startBatch } from "@/lib/batch";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clubIds: number[] = Array.isArray(body.clubIds) ? body.clubIds.map(Number) : [];
  const countPerClub = Number(body.countPerClub ?? 25);

  if (clubIds.length === 0 || clubIds.some((c) => !c || Number.isNaN(c))) {
    return NextResponse.json({ error: "clubIds must be a non-empty array of numeric ids" }, { status: 400 });
  }
  if (!countPerClub || countPerClub < 1) {
    return NextResponse.json({ error: "countPerClub must be a positive number" }, { status: 400 });
  }

  const result = await startBatch(clubIds, countPerClub);
  return NextResponse.json({ started: true, ...result });
}
