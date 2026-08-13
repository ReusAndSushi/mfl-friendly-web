// Shared MFL logic: public-API discovery + rating computation.
// Mirrors the local mfl_friendly_bot.py script's approach, but the club
// index lives in Vercel KV (bucketed by division) instead of a local JSON
// file, since a serverless function can't sweep ~11,500 club ids per call.

import { kv } from "@/lib/kv";

export const API = "https://z519wdyajg.execute-api.us-east-1.amazonaws.com/prod";

export const FORMATIONS: Record<string, string[]> = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CDM", "CM", "CM", "LW", "ST", "RW"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "CDM", "CDM", "CAM", "LW", "RW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LM", "CM", "CDM", "CM", "RM", "ST", "ST"],
  "3-4-3": ["GK", "CB", "CB", "CB", "LM", "CM", "CM", "RM", "LW", "ST", "RW"],
};

export type Player = {
  id: number;
  metadata: {
    firstName?: string;
    lastName?: string;
    overall: number;
    positions?: string[];
  };
  activeContract?: { club?: { id?: number } };
};

export type ClubRecord = {
  id: number;
  name: string;
  division: number | null;
  friendlyPref: string | null;
  friendlyPrefCooldown: number;
};

export type Candidate = { id: number; name: string; rating: number; gap: number };

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function getClub(clubId: number) {
  return fetchJson(`${API}/clubs/${clubId}`);
}

export async function getPlayers(clubId: number): Promise<Player[]> {
  return (await fetchJson(`${API}/clubs/${clubId}/players`)) ?? [];
}

export async function squadOf(clubId: number): Promise<Player[]> {
  const players = await getPlayers(clubId);
  return players.filter((p) => p.activeContract?.club?.id === clubId);
}

export function bestXiRating(players: Player[], formation: string) {
  const slots = FORMATIONS[formation];
  const pool = [...players].sort((a, b) => b.metadata.overall - a.metadata.overall);
  const used = new Set<number>();
  const picks: { slot: string; name: string; ovr: number }[] = [];

  for (const slot of slots) {
    let candidate = pool.find(
      (p) => !used.has(p.id) && p.metadata.positions?.includes(slot)
    );
    if (!candidate) candidate = pool.find((p) => !used.has(p.id));
    if (!candidate) break;
    used.add(candidate.id);
    picks.push({
      slot,
      name: `${candidate.metadata.firstName ?? ""} ${candidate.metadata.lastName ?? ""}`.trim(),
      ovr: candidate.metadata.overall,
    });
  }

  if (picks.length === 0) return { rating: 0, picks: [] };
  const rating = picks.reduce((s, p) => s + p.ovr, 0) / picks.length;
  return { rating, picks };
}

// --- KV-backed division index -------------------------------------------

function divisionKey(division: number) {
  return `division:${division}`;
}

export async function getDivisionClubs(division: number): Promise<ClubRecord[]> {
  const data = await kv().get<ClubRecord[]>(divisionKey(division));
  return data ?? [];
}

export async function setDivisionClubs(division: number, clubs: ClubRecord[]) {
  await kv().set(divisionKey(division), clubs);
}

const MAX_CLUB_ID_GUESS = 12000;

export async function detectMaxClubId(): Promise<number> {
  let lo = 1;
  let hi = MAX_CLUB_ID_GUESS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const club = await getClub(mid);
    if (club !== null) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Process one bounded chunk of club ids into the division-bucketed KV
 * index. Designed to be called repeatedly (e.g. by an admin endpoint hit
 * from an external loop) since a full ~11,500-id sweep doesn't fit in one
 * serverless invocation. Read-modify-write on division buckets is safe
 * here because chunks are expected to run sequentially, not concurrently. */
export async function buildIndexChunk(fromId: number, toId: number) {
  const db = kv();
  const additions = new Map<number, ClubRecord[]>();
  let scanned = 0;

  const ids = Array.from({ length: toId - fromId + 1 }, (_, i) => fromId + i);
  const CONCURRENCY = 15;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const club = await getClub(id).catch(() => null);
      scanned++;
      if (club && club.status === "FOUNDED" && typeof club.division === "number") {
        const rec: ClubRecord = {
          id,
          name: club.name,
          division: club.division,
          friendlyPref: club.friendlyPref ?? null,
          friendlyPrefCooldown: club.friendlyPrefCooldown ?? 0,
        };
        if (!additions.has(club.division)) additions.set(club.division, []);
        additions.get(club.division)!.push(rec);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  for (const [division, recs] of additions) {
    const existing = await getDivisionClubs(division);
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of recs) byId.set(r.id, r);
    await setDivisionClubs(division, Array.from(byId.values()));
  }

  return { scanned, foundedCount: [...additions.values()].reduce((n, a) => n + a.length, 0) };
}

// --- Discovery ------------------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function findSimilarOpponents(opts: {
  clubId: number;
  formation: string;
  tolerance: number;
  divisionRadius: number;
  maxLookups?: number;
}) {
  const { clubId, formation, tolerance, divisionRadius, maxLookups = 150 } = opts;

  const mySquad = await squadOf(clubId);
  const { rating: myRating, picks: myPicks } = bestXiRating(mySquad, formation);

  const myClub = await getClub(clubId);
  const myDivision: number | null = myClub?.division ?? null;

  let shortlist: ClubRecord[] = [];
  if (myDivision !== null) {
    const divisions: number[] = [];
    for (let d = myDivision - divisionRadius; d <= myDivision + divisionRadius; d++) {
      if (d >= 1) divisions.push(d);
    }
    const buckets = await Promise.all(divisions.map(getDivisionClubs));
    const now = Date.now();
    shortlist = buckets
      .flat()
      .filter(
        (rec) =>
          rec.id !== clubId &&
          rec.friendlyPref !== "DISABLED" &&
          (rec.friendlyPrefCooldown ?? 0) <= now
      )
      .slice(0, maxLookups);
  }

  const rated = await mapLimit(shortlist, 15, async (rec): Promise<Candidate | null> => {
    const squad = await squadOf(rec.id);
    if (squad.length === 0) return null;
    const { rating } = bestXiRating(squad, formation);
    const gap = Math.abs(rating - myRating);
    return gap <= tolerance ? { id: rec.id, name: rec.name, rating, gap } : null;
  });

  const matches = rated.filter((m): m is Candidate => m !== null).sort((a, b) => a.gap - b.gap);

  return { myRating, myPicks, myDivision, matches };
}

// --- Playing a friendly (direct API call, using a stored session header) -

export async function playFriendly(homeClubId: number, awayClubId: number, authHeader: string) {
  const r = await fetch(`${API}/matches/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      homeClubId,
      awayClubId,
      alternateEngine: false,
    }),
  });
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { ok: r.ok, status: r.status, body };
}
