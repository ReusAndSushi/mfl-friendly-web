import { NextRequest, NextResponse } from "next/server";
import { tickBatch } from "@/lib/batch";

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

  const tolerance = Number(process.env.MFL_TOLERANCE ?? "3");
  const divisionRadius = Number(process.env.MFL_DIVISION_RADIUS ?? "1");
  const formation = process.env.MFL_FORMATION ?? "4-3-3";

  const results = await tickBatch({ authHeader, tolerance, divisionRadius, formation });
  return NextResponse.json({ results });
}
