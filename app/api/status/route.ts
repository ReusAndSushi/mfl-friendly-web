import { NextResponse } from "next/server";
import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const db = kv();
  const lastAt = (await db.get<number>("play:lastAt")) ?? null;
  const countToday = (await db.get<number>(`play:count:${todayKey()}`)) ?? 0;
  const indexBuiltAt = (await db.get<number>("index:builtAt")) ?? null;
  return NextResponse.json({ lastAt, countToday, indexBuiltAt });
}
