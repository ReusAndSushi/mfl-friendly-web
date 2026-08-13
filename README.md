# mfl-friendly-web

Hosted version of [mfl-friendly-bot](https://github.com/ReusAndSushi/mfl-friendly-bot):
a Vercel-deployed dashboard that finds MFL clubs with a similar starting-XI
rating, plus a scheduled job that plays friendlies against them automatically
every 5 minutes, no local script running.

## Architecture

- **`/` (dashboard)** and **`/api/discover`** - read-only. Computes your
  best-XI rating and lists similarly-rated opponents using MFL's public,
  unauthenticated API. No login required for this part.
- **`/api/play-next`** - the real, stateful part. Calls MFL's actual
  `POST /matches/start` endpoint directly (found by inspecting the network
  request the real "Play" button makes) using a session header *you* copy
  from your own browser and store as a Vercel secret. Protected by a
  `CRON_SECRET` so only your scheduled job can trigger it.
- **Vercel KV** - stores the club index (club id -> division/name/friendly
  status, built once via `npm run build-index`) and small bits of runtime
  state (last-played timestamp, today's play count, recently-challenged
  opponents) so the cooldown and daily cap survive across serverless calls.
- **GitHub Actions** (`.github/workflows/play-cron.yml`) - cron `*/5 * * * *`
  that POSTs to `/api/play-next`. Vercel's own Cron Jobs are capped at once/
  day on the free Hobby plan, so this repo's Actions cron is what actually
  drives the 5-minute cadence.

## One-time setup

1. **Create a Vercel project** from this repo (Vercel dashboard -> Add New
   -> Project -> import this GitHub repo).
2. **Add Vercel KV**: in the project's Storage tab, create a KV database and
   connect it to the project. This auto-populates the `KV_*` env vars.
3. **Set the rest of the env vars** (Project Settings -> Environment
   Variables), using `.env.example` as the list:
   - `MFL_CLUB_ID` - your club's numeric id.
   - `MFL_AUTH_HEADER` - copy this yourself: open app.playmfl.com, DevTools
     -> Network tab, click "Play" on any friendly, find the `matches/start`
     request, open its Headers, and copy the exact `Authorization` header
     value (including whatever scheme prefix it uses). This app never
     inspects or logs this value - it's passed straight through.
     **This will eventually expire** (MFL sessions time out) and you'll
     need to repeat this step and update the env var.
   - `MFL_TOLERANCE`, `MFL_DIVISION_RADIUS`, `MFL_FORMATION`,
     `MFL_MAX_PER_DAY` - tune to taste, see defaults in `.env.example`.
   - `CRON_SECRET` - make up any long random string.
4. **Deploy** (Vercel does this automatically on push, or click Deploy).
5. **Build the club index** (one-time, run locally):
   ```bash
   npm install
   vercel env pull .env.local   # pulls the KV credentials you just set up
   npm run build-index          # takes a few minutes, sweeps ~11,500 club ids
   ```
   Re-run this occasionally to pick up newly founded clubs.
6. **Set GitHub Actions secrets** (this repo's Settings -> Secrets and
   variables -> Actions):
   - `VERCEL_APP_URL` - your deployed URL, e.g. `https://mfl-friendly-web.vercel.app`
   - `CRON_SECRET` - same value you set in Vercel.

Once all of that's in place, the Actions cron will call `/api/play-next`
every 5 minutes; it no-ops (with a `reason` in the response) if the cooldown
hasn't elapsed, the daily cap is hit, or there's no eligible opponent.

## Local development

```bash
npm install
vercel env pull .env.local
npm run dev
```

## Notes on the design

- Discovery buckets the club index by division in KV rather than one big
  blob, so a request only reads the 1-3 division buckets near your own
  club instead of scanning everything.
- `MFL_AUTH_HEADER` sits in Vercel's environment, not just your own
  machine, once you set this up - see the parent repo's README for the
  tradeoffs of that before deciding to run this hosted version versus the
  local-only script.
- Opponent ratings are an estimate (best-XI from public squad data), not a
  read of their actual saved tactic, which isn't accessible for clubs you
  don't own.
