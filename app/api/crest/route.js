/*
 * /api/crest?u=<fotmob image url> — same-origin crest proxy for the /image
 * canvas tool. Drawing a cross-origin crest onto a <canvas> taints it, which
 * makes toBlob()/toDataURL() throw, so the client loads crests through here
 * instead, keeping them same-origin and the canvas exportable.
 *
 * Locked to FotMob's image host so it can't be used as an open proxy. FotMob's
 * CDN 403s plain datacenter requests, so we present as a browser.
 */

export const runtime = "edge";

const IMG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.fotmob.com/",
};

export async function GET(req) {
  const url = new URL(req.url).searchParams.get("u") || "";
  if (!/^https:\/\/images\.fotmob\.com\//i.test(url)) {
    return new Response("bad image url", { status: 400 });
  }
  try {
    const r = await fetch(url, { headers: IMG_HEADERS });
    if (!r.ok) return new Response("upstream error", { status: 502 });
    const ct = r.headers.get("content-type") || "image/png";
    return new Response(r.body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch (e) {
    return new Response("fetch failed", { status: 502 });
  }
}
