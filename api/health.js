/*
 * /api/health — read-only diagnostics for the admin page.
 *
 * Reports which TV sources are configured and whether KV is reachable, WITHOUT
 * exposing any secret values (only booleans / non-sensitive config).
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvPing() {
  if (!KV_URL || !KV_TOKEN) return { configured: false, ping: null };
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    if (!r.ok) return { configured: true, ping: null, status: r.status };
    const j = await r.json();
    return { configured: true, ping: j && j.result ? String(j.result) : null };
  } catch (e) {
    return { configured: true, ping: null, error: String(e && e.message || e) };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const kv = await kvPing();
  res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    kv,
    thesportsdb: { premiumKey: !!process.env.THESPORTSDB_KEY },
    sofascore: { enabled: process.env.SOFASCORE_DISABLED !== "1" },
    fotmob: {
      enabled: process.env.FOTMOB_DISABLED !== "1",
      countries: (process.env.FOTMOB_COUNTRIES || "PT,GB,ES,BR,US,FR,DE,IT,NL")
        .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    },
    sportmonks: { keyConfigured: !!process.env.SPORTMONKS_KEY },
  });
};
