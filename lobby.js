// Vercel serverless function — proxies Technocore's public room feed.
// Client can't call technocore.chat directly from the browser reliably (CORS),
// so this runs server-side and just forwards the response.

export default async function handler(req, res) {
  const { room = "lobby", since, limit = "200" } = req.query;

  const params = new URLSearchParams();
  params.set("format", "json");
  params.set("limit", Array.isArray(limit) ? limit[0] : limit);
  if (since) params.set("since", Array.isArray(since) ? since[0] : since);
  params.set("n", Date.now().toString());

  const upstreamUrl = `https://technocore.chat/r/${encodeURIComponent(
    Array.isArray(room) ? room[0] : room
  )}?${params.toString()}`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    clearTimeout(timeout);

    const body = await upstream.text();
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({
      error: "upstream_unreachable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
