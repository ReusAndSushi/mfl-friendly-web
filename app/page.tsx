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

const FORMATIONS = ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "3-4-3"];

export default function Page() {
  const [clubId, setClubId] = useState("602");
  const [formation, setFormation] = useState("4-3-3");
  const [tolerance, setTolerance] = useState("3");
  const [divisionRadius, setDivisionRadius] = useState("1");
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function runDiscover() {
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ clubId, formation, tolerance, divisionRadius });
      const r = await fetch(`/api/discover?${params}`);
      const j = await r.json();
      setResult(j);
    } finally {
      setLoading(false);
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
          <input
            value={clubId}
            onChange={(e) => setClubId(e.target.value)}
            style={inputStyle}
          />
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
          <input
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            style={inputStyle}
          />
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

      {result?.error && (
        <p style={{ color: "#ff6b6b", marginTop: 16 }}>{result.error}</p>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 24 }}>
          <p>
            Your best-XI rating: <strong>{result.myRating.toFixed(1)}</strong>
            {result.myDivision !== null && <> · division {result.myDivision}</>}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                <th style={{ padding: "6px 4px" }}>Club</th>
                <th style={{ padding: "6px 4px" }}>Rating</th>
                <th style={{ padding: "6px 4px" }}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {result.matches.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "6px 4px" }}>{m.name}</td>
                  <td style={{ padding: "6px 4px" }}>{m.rating.toFixed(1)}</td>
                  <td style={{ padding: "6px 4px" }}>{m.gap.toFixed(1)}</td>
                </tr>
              ))}
              {result.matches.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "12px 4px", color: "#999" }}>
                    No candidates within tolerance. Try a larger tolerance or division radius.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
