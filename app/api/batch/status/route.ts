import { NextResponse } from "next/server";
import { getOpponentBatchStatus } from "@/lib/batch";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getOpponentBatchStatus();
  return NextResponse.json({ clubs: status });
}
