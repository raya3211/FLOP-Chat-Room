// Forwards an already-signed message to Technocore. All signing happens in
// the visitor's own browser with a key only they hold — this endpoint never
// sees or generates private keys, it just relays the finished request
// (browsers can't call technocore.chat directly due to CORS).

export default async function handler(req, res) {
  const { room, did, sig, nonce, text } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (!room || !did || !sig || !nonce || text === undefined) {
    res.status(400).json({ error: "missing_params" });
    return;
  }

  const upstreamUrl = `https://technocore.chat/r/${encodeURIComponent(
    room
  )}/say-signed/${did}/${sig}/${nonce}/${encodeURIComponent(text)}`;

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
