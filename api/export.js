// Vercel serverless function — proxies Technocore's room export endpoint.
// Unlike /r/<room> (which always returns the *newest* `limit` messages after
// the cursor, even when polled with `since` — see flop-labs/technocore-chat#721),
// /r/<room>/export returns a byte-exact JSONL snapshot of everything the room's
// ring currently retains. That's what a real "scan the whole room" needs.

export default async function handler(req, res) {
  const { room = "lobby" } = req.query;

  const upstreamUrl = `https://technocore.chat/r/${encodeURIComponent(
    Array.isArray(room) ? room[0] : room
  )}/export`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
