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

## Notes

- The little ring gauge in the header shows message velocity (how busy the
  room is right now), not literal buffer bytes — the API doesn't expose that.
- Room name and filters are client-side only; nothing is written anywhere,
  this is read-only.
- If a room goes quiet or 404s, the status dot at the top of the feed turns
  red and it keeps retrying — no need to refresh the page.
