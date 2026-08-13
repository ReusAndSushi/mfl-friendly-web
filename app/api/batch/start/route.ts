import { NextRequest, NextResponse } from "next/server";
import { startOpponentBatch, type OpponentPick } from "@/lib/batch";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clubId = Number(body.clubId);
  const opponents: OpponentPick[] = Array.isArray(body.opponents)
    ? body.opponents
        .map((o: any) => ({ id: Number(o.id), name: String(o.name ?? o.id) }))
        .filter((o: OpponentPick) => !Number.isNaN(o.id))
    : [];
  const countPerOpponent = Number(body.countPerOpponent ?? 5);

  if (!clubId || Number.isNaN(clubId)) {
    return NextResponse.json({ error: "clubId (your home club) is required" }, { status: 400 });
  }
  if (opponents.length === 0) {
    return NextResponse.json(
      { error: "opponents must be a non-empty array of {id, name}" },
      { status: 400 }
    );
  }
  if (!countPerOpponent || countPerOpponent < 1) {
    return NextResponse.json({ error: "countPerOpponent must be a positive number" }, { status: 400 });
  }

  const result = await startOpponentBatch(clubId, opponents, countPerOpponent);
  return NextResponse.json({ started: true, ...result });
}
