/*
 * /api/image  (public path: /image) — a small tool page to preview and
 * download the "top games" social image for any date.
 *
 * The image itself is drawn by /og/today (a 1200×630 PNG). This page just wraps
 * it in a human UI: a date picker with prev/next/today, an optional count, a
 * live preview, and a Download button (same-origin <a download>, so the PNG
 * saves as hojehabola-top-games-<date>.png ready to post). A link to the
 * shareable /today page is offered too.
 *
 * Query: ?date=YYYY-MM-DD (defaults to today, Europe/Lisbon) [&n=1..6]
 * Not indexed — it's a utility; the shareable content lives at /today.
 */

const TZ = "Europe/Lisbon";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const get = (k) => (q[k] == null ? "" : String(q[k]));

  const today = todayYmd();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : today;
  let n = parseInt(get("n") || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(1, Math.min(6, n));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Download the top-games image · Hoje Há Bola</title>
<meta name="description" content="Preview and download a shareable image of the day's top football games for any date." />
<meta name="robots" content="noindex, follow" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
<style>
  :root{--bg:#0f1722;--panel:#16202e;--line:#243244;--txt:#e8eef5;--muted:#9fb0c3;--accent:#16d27a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--txt);line-height:1.5}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:880px;margin:0 auto;padding:20px 16px 56px}
  header.site{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:14px}
  h1{font-size:1.5rem;margin:.2em 0}
  p.lead{color:var(--muted);margin:.2em 0 18px}
  .controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:18px}
  .controls label{color:var(--muted);font-size:.85rem;margin-right:4px}
  button,select,input[type=date]{font:inherit;color:var(--txt);background:#0f1a26;
    border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  .nav button{min-width:40px;font-weight:700}
  .spacer{flex:1}
  .preview{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;
    display:flex;justify-content:center}
  .preview img{width:100%;max-width:1200px;height:auto;border-radius:8px;display:block}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:800;padding:12px 18px;border-radius:10px}
  .btn.primary{background:var(--accent);color:#062013;border:none}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  .btn.ghost:hover{border-color:var(--accent)}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:28px}
  .hint{color:var(--muted);font-size:.85rem;margin-top:10px}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <h1>Download the top-games image</h1>
    <p class="lead">Pick a date, preview the card, and download it to share on social.</p>

    <div class="controls">
      <span class="nav"><button id="prev" type="button" aria-label="Previous day">◀</button></span>
      <label for="date">Date</label>
      <input type="date" id="date" value="${esc(date)}" />
      <span class="nav"><button id="next" type="button" aria-label="Next day">▶</button></span>
      <button id="today" type="button">Today</button>
      <span class="spacer"></span>
      <label for="n">Games</label>
      <select id="n">
        ${[3, 4, 5, 6].map((v) => `<option value="${v}"${v === n ? " selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>

    <div class="preview">
      <img id="img" alt="Top football games" src="/og/today?date=${esc(date)}&n=${n}" />
    </div>

    <div class="actions">
      <a class="btn primary" id="dl" href="/og/today?date=${esc(date)}&n=${n}" download="hojehabola-top-games-${esc(date)}.png">⬇ Download image</a>
      <a class="btn ghost" id="open" href="/og/today?date=${esc(date)}&n=${n}" target="_blank" rel="noopener">Open full size</a>
      <a class="btn ghost" id="share" href="/today?date=${esc(date)}">Shareable page →</a>
    </div>
    <p class="hint">The image updates with live scores and kickoff times. Times shown in Europe/Lisbon.</p>

    <footer><a href="/">Hoje Há Bola</a> — football on TV, worldwide.</footer>
  </div>

  <script>
  (function () {
    var TODAY = ${JSON.stringify(today)};
    var img = document.getElementById("img");
    var dl = document.getElementById("dl");
    var open = document.getElementById("open");
    var share = document.getElementById("share");
    var dateEl = document.getElementById("date");
    var nEl = document.getElementById("n");

    function shift(ymd, days) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    function render() {
      var d = dateEl.value || TODAY;
      var n = nEl.value;
      var src = "/og/today?date=" + encodeURIComponent(d) + "&n=" + n;
      img.src = src;
      dl.href = src;
      dl.setAttribute("download", "hojehabola-top-games-" + d + ".png");
      open.href = src;
      share.href = "/today?date=" + encodeURIComponent(d);
      var u = new URL(location.href);
      u.searchParams.set("date", d);
      if (n === "5") u.searchParams.delete("n"); else u.searchParams.set("n", n);
      history.replaceState(null, "", u);
    }
    document.getElementById("prev").addEventListener("click", function () {
      dateEl.value = shift(dateEl.value || TODAY, -1); render();
    });
    document.getElementById("next").addEventListener("click", function () {
      dateEl.value = shift(dateEl.value || TODAY, 1); render();
    });
    document.getElementById("today").addEventListener("click", function () {
      dateEl.value = TODAY; render();
    });
    dateEl.addEventListener("change", render);
    nEl.addEventListener("change", render);
  })();
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
};
