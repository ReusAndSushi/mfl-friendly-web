import { NextRequest, NextResponse } from "next/server";
import { findSimilarOpponents, FORMATIONS } from "@/lib/mfl";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clubId = Number(sp.get("clubId"));
  const formation = sp.get("formation") ?? "4-3-3";
  const tolerance = Number(sp.get("tolerance") ?? "3");
  const divisionRadius = Number(sp.get("divisionRadius") ?? "1");

  if (!clubId || Number.isNaN(clubId)) {
    return NextResponse.json({ error: "clubId query param is required" }, { status: 400 });
  }
  if (!FORMATIONS[formation]) {
    return NextResponse.json(
      { error: `formation must be one of ${Object.keys(FORMATIONS).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await findSimilarOpponents({ clubId, formation, tolerance, divisionRadius });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
