import { NextResponse } from "next/server";
import { getBatchStatus } from "@/lib/batch";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getBatchStatus();
  return NextResponse.json({ clubs: status });
}
