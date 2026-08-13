"use client";

import { useEffect, useState } from "react";

type Candidate = { id: number; name: string; rating: number; gap: number };
type DiscoverResult = {
  myRating: number;
  myDivision: number | null;
  matches: Candidate[];
  error?: string;
};
type Status = { lastAt: number | null; countToday: number; indexBuiltAt: number | null };
type BatchClubStatus = { clubId: number; queued: number; played: number; lastAt: number | null };

const FORMATIONS = ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "3-4-3"];

export default function Page() {
  const [clubId, setClubId] = useState("602");
  const [formation, setFormation] = useState("4-3-3");
  const [tolerance, setTolerance] = useState("3");
  const [divisionRadius, setDivisionRadius] = useState("1");
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const [selected, setSelected] = useState<Record<number, Candidate>>({});
  const [countPerOpponent, setCountPerOpponent] = useState("5");
  const [batchSecret, setBatchSecret] = useState("");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchStatus, setBatchStatus] = useState<BatchClubStatus[]>([]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    refreshBatchStatus();
    const interval = setInterval(refreshBatchStatus, 20000);
    return () => clearInterval(interval);
  }, []);

  async function refreshBatchStatus() {
    try {
      const r = await fetch("/api/batch/status");
      const j = await r.json();
      setBatchStatus(j.clubs ?? []);
    } catch {
      /* ignore */
    }
  }

  async function runDiscover() {
    setLoading(true);
    setResult(null);
    setSelected({});
    try {
      const params = new URLSearchParams({ clubId, formation, tolerance, divisionRadius });
      const r = await fetch(`/api/discover?${params}`);
      const j = await r.json();
      setResult(j);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(c: Candidate) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = c;
      return next;
    });
  }

  const selectedList = Object.values(selected);
  const totalQueued = selectedList.length * (Number(countPerOpponent) || 0);

  async function startBatch() {
    setBatchStarting(true);
    setBatchMessage(null);
    try {
      const r = await fetch("/api/batch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": batchSecret },
        body: JSON.stringify({
          clubId: Number(clubId),
          opponents: selectedList.map((c) => ({ id: c.id, name: c.name })),
          countPerOpponent: Number(countPerOpponent),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBatchMessage(`Error: ${j.error ?? r.status}`);
      } else {
        setBatchMessage(
          `Queued ${j.totalQueued} friendlies for club ${j.clubId}: ${j.countPerOpponent} each vs. ` +
            `${j.opponents.map((o: Candidate) => o.name).join(", ")}. Plays automatically as the ` +
            `cron ticks (every 5 min, respecting your club's cooldown).`
        );
        setSelected({});
        refreshBatchStatus();
      }
    } finally {
      setBatchStarting(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>MFL Friendly Bot</h1>
      <p style={{ color: "#999", marginTop: 0 }}>
        Finds MFL clubs with a similar starting-XI rating. Discovery here uses MFL&apos;s public
        API (read-only). Actually playing friendlies is handled separately by a scheduled job.
      </p>

      {status && (
        <div style={{ background: "#161618", borderRadius: 8, padding: 12, marginBottom: 24, fontSize: 14 }}>
          <div>
            Last friendly played:{" "}
            {status.lastAt ? new Date(status.lastAt).toLocaleString() : "never (or job not deployed yet)"}
          </div>
          <div>Played today: {status.countToday}</div>
          <div>
            Club index built:{" "}
            {status.indexBuiltAt ? new Date(status.indexBuiltAt).toLocaleString() : "not built yet"}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <label>
          Club ID
          <input value={clubId} onChange={(e) => setClubId(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Formation
          <select value={formation} onChange={(e) => setFormation(e.target.value)} style={inputStyle}>
            {FORMATIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tolerance (OVR gap)
          <input value={tolerance} onChange={(e) => setTolerance(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Division radius
          <input
            value={divisionRadius}
            onChange={(e) => setDivisionRadius(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <button onClick={runDiscover} disabled={loading} style={buttonStyle}>
        {loading ? "Searching..." : "Find similar opponents"}
      </button>

      {result?.error && <p style={{ color: "#ff6b6b", marginTop: 16 }}>{result.error}</p>}

      {result && !result.error && (
        <div style={{ marginTop: 24 }}>
          <p>
            Your best-XI rating: <strong>{result.myRating.toFixed(1)}</strong>
            {result.myDivision !== null && <> · division {result.myDivision}</>}
          </p>
          <p style={{ color: "#999", fontSize: 13, marginTop: -8 }}>
            Check the opponents you want, then set a count and start a batch below.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                <th style={{ padding: "6px 4px", width: 28 }}></th>
                <th style={{ padding: "6px 4px" }}>Club</th>
                <th style={{ padding: "6px 4px" }}>Rating</th>
                <th style={{ padding: "6px 4px" }}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {result.matches.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "6px 4px" }}>
                    <input
                      type="checkbox"
                      checked={!!selected[m.id]}
                      onChange={() => toggleSelected(m)}
                    />
                  </td>
                  <td style={{ padding: "6px 4px" }}>{m.name}</td>
                  <td style={{ padding: "6px 4px" }}>{m.rating.toFixed(1)}</td>
                  <td style={{ padding: "6px 4px" }}>{m.gap.toFixed(1)}</td>
                </tr>
              ))}
              {result.matches.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "12px 4px", color: "#999" }}>
                    No candidates within tolerance. Try a larger tolerance or division radius.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "40px 0 24px", border: "none", borderTop: "1px solid #222" }} />

      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Run a batch</h2>
      <p style={{ color: "#999", marginTop: 0, fontSize: 14 }}>
        Your club ({clubId || "?"}) plays a queue of friendlies against the opponents you checked
        above, {countPerOpponent || "N"} games against each. Your club has a single 5-minute
        cooldown, so the queue drains one game per tick, cycling through opponents in order.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <label>
          Games per opponent
          <input
            value={countPerOpponent}
            onChange={(e) => setCountPerOpponent(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Admin secret (CRON_SECRET)
          <input
            type="password"
            value={batchSecret}
            onChange={(e) => setBatchSecret(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Selected: {selectedList.length} opponent(s) → {totalQueued} total friendlies
        {selectedList.length > 0 && <> ({selectedList.map((c) => c.name).join(", ")})</>}
      </p>

      <button
        onClick={startBatch}
        disabled={batchStarting || selectedList.length === 0 || !batchSecret}
        style={buttonStyle}
      >
        {batchStarting ? "Starting..." : "Start batch"}
      </button>

      {batchMessage && <p style={{ marginTop: 12, fontSize: 14 }}>{batchMessage}</p>}

      {batchStatus.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 20 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
              <th style={{ padding: "6px 4px" }}>Club ID</th>
              <th style={{ padding: "6px 4px" }}>Played</th>
              <th style={{ padding: "6px 4px" }}>Queued</th>
              <th style={{ padding: "6px 4px" }}>Last played</th>
            </tr>
          </thead>
          <tbody>
            {batchStatus.map((c) => (
              <tr key={c.clubId} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "6px 4px" }}>{c.clubId}</td>
                <td style={{ padding: "6px 4px" }}>{c.played}</td>
                <td style={{ padding: "6px 4px" }}>{c.queued}</td>
                <td style={{ padding: "6px 4px" }}>
                  {c.lastAt ? new Date(c.lastAt).toLocaleTimeString() : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  background: "#161618",
  border: "1px solid #333",
  borderRadius: 6,
  color: "#eaeaea",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#e8c33a",
  border: "none",
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
};
