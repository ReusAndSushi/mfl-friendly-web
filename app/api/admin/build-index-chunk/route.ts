import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/lib/kv";
import { detectMaxClubId, buildIndexChunk } from "@/lib/mfl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-time (or periodic refresh) index build, driven by an external caller
// hitting this endpoint repeatedly with an advancing cursor - a full sweep
// of ~11,500 club ids doesn't fit in a single serverless invocation. This
// runs on Vercel's infrastructure, which already holds the real Redis
// credentials, so no secret material needs to pass through anyone's local
// machine to (re)build the index.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-build-secret");
  if (!secret || secret !== process.env.BUILD_INDEX_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const batchSize = Number(body.batchSize ?? 800);

  let maxId = await kv().get<number>("index:maxId");
  if (!maxId) {
    maxId = await detectMaxClubId();
    await kv().set("index:maxId", maxId);
  }

  const cursor = Number(body.cursor ?? 1);
  const toId = Math.min(cursor + batchSize - 1, maxId);

  const { scanned, foundedCount } = await buildIndexChunk(cursor, toId);

  const done = toId >= maxId;
  if (done) {
    await kv().set("index:builtAt", Date.now());
  }

  return NextResponse.json({
    done,
    scanned,
    foundedCount,
    nextCursor: done ? null : toId + 1,
    maxId,
    progress: `${toId}/${maxId}`,
  });
}
