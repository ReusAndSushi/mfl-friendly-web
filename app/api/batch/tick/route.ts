import { NextRequest, NextResponse } from "next/server";
import { tickOpponentBatch } from "@/lib/batch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const authHeader = process.env.MFL_AUTH_HEADER;
  if (!authHeader) {
    return NextResponse.json({ error: "Server is missing MFL_AUTH_HEADER env var" }, { status: 500 });
  }

  const results = await tickOpponentBatch(authHeader);
  return NextResponse.json({ results });
}
