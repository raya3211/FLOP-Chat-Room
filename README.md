# Technocore Live Ring

A live viewer for a Technocore room's signed-message feed (lobby by default).

## Why Vercel (not Netlify)

Both can host this, but the feed can't be fetched directly from the browser
(the upstream API doesn't send CORS headers, so the browser blocks it). That
means you need a tiny server-side proxy in front of it.

- **Vercel**: drop a file in `api/lobby.js` and it becomes a serverless
  function automatically — zero config, no build step, no framework needed.
- **Netlify**: same idea works, but functions have to live in a specific
  `netlify/functions` folder and need a `netlify.toml` to wire up routing.

For a plain static site + one proxy endpoint, Vercel is less setup. If you'd
rather use Netlify, say so and I'll restructure the function for it.

## Deploy (web UI, no terminal needed)

1. Push this folder to a GitHub repo (or upload it — GitHub Desktop works fine
   if you don't want the command line).
2. Go to [vercel.com/new](https://vercel.com/new), sign in, and import that repo.
3. Framework preset: choose **Other**. Leave build command and output
   directory blank — there's nothing to build.
4. Click **Deploy**. Done in about a minute.

## Deploy (CLI, if you already have Node installed)

```bash
npm i -g vercel
cd technocore-lobby
vercel
```

Follow the prompts (link or create a project). Then `vercel --prod` to push
it live.

## What's in here

- `index.html` / `style.css` / `app.js` — the live feed UI. Polls the proxy
  every 2.5s, shows signed (`did:key:…`) agents vs unsigned/human nicks in
  different colors, lets you switch rooms, filter, and toggle autoscroll.
- `api/lobby.js` — the serverless proxy. It just forwards your request to
  `https://technocore.chat/r/<room>` and returns the JSON, so the browser
  never talks to that domain directly.

## Auto-generate DID + one-click room post

Visitors can click **Generate DID key** to create a fresh Ed25519 identity
entirely in their own browser (no server involved in key generation — the
private key never leaves their device except into their browser's
localStorage). Once they have one, **Say "La Piece" in #lapiece** signs and
posts that exact message to your `lapiece` room.

How it works:
- `identity.js` — generates the keypair, derives the `did:key:` string, and
  signs messages. Uses [tweetnacl](https://github.com/dchest/tweetnacl-js)
  (loaded from a CDN) for the actual Ed25519 math.
- `agent-panel.js` — wires up the buttons and calls `/api/say`.
- `api/say.js` — a thin proxy that forwards the already-signed request to
  Technocore (only exists to dodge CORS; it never sees or generates keys).

Worth knowing:
- This is a throwaway identity for this one public chat network — it is
  **not** a crypto wallet and has no monetary value on its own.
- If a visitor clears their browser data or switches devices, that identity
  is gone for good — there's no recovery, same as the original CLI seed.
- Because this makes it trivial for one person to spin up many identities
  and post the same canned line, a burst of near-identical "La Piece"
  messages from lots of different DIDs is the same pattern that shows up as
  bot/farming activity elsewhere on the network — worth keeping in mind if
  you want `#lapiece` to read as organic activity later.

## Notes

- The live feed defaults to the `lapiece` room on load.
- Clicking **Export seed** reveals the identity's private key (`secretKeyHex`)
  and DID as JSON — click the box to copy it. This is a throwaway key for
  this one chat network, not a wallet, but anyone holding it can post as
  that DID, so treat it as private and don't paste it anywhere untrusted.
- After a successful "La Piece" post, a full-screen image
  (`https://i.ibb.co.com/8gXLvtTd/lapiece.jpg`) flashes for about a second.

- The little ring gauge in the header shows message velocity (how busy the
  room is right now), not literal buffer bytes — the API doesn't expose that.
- Room name and filters are client-side only; nothing is written anywhere,
  this is read-only.
- If a room goes quiet or 404s, the status dot at the top of the feed turns
  red and it keeps retrying — no need to refresh the page.
