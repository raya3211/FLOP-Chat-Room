(() => {
  const roomInput = document.getElementById("poems-room-input");
  const scanBtn = document.getElementById("poems-scan-btn");
  const statusDot = document.getElementById("poems-status-dot");
  const statusText = document.getElementById("poems-status-text");
  const countText = document.getElementById("poems-count-text");
  const liveToggle = document.getElementById("poems-live-toggle");
  const minLinesSelect = document.getElementById("poems-min-lines");
  const gapSelect = document.getElementById("poems-gap");
  const searchInput = document.getElementById("poems-search");
  const verifiedToggle = document.getElementById("poems-verified-toggle");
  const listEl = document.getElementById("poems-list");
  const emptyEl = document.getElementById("poems-empty");

  const LIVE_POLL_MS = 4000;
  const MAX_POEMS = 300;

  let currentRoom = roomInput.value.trim() || "lapiece";
  let sinceSeq = null;
  let inFlight = false;
  let liveTimer = null;
  let hasScannedOnce = false;

  // every message seen in this room so far, oldest first — re-grouped and
  // re-filtered locally whenever the controls change, so loosening/tightening
  // a filter doesn't need another network round-trip.
  let allMessages = [];

  function shortId(from) {
    if (typeof from !== "string") return { label: "?", verified: false, full: "" };
    if (from.startsWith("did:key:")) {
      const key = from.slice("did:key:".length);
      const short = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
      return { label: short, verified: true, full: from };
    }
    if (from === "human") return { label: "human", verified: false, full: from };
    return { label: from, verified: false, full: from };
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString(undefined, {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "--:--:--";
    }
  }

  function tsMillis(ts) {
    const n = new Date(ts).getTime();
    return Number.isFinite(n) ? n : null;
  }

  function lineCount(text) {
    return String(text ?? "")
      .split("\n")
      .filter((line) => line.trim() !== "").length;
  }

  // Some rooms aren't freeform chat — they're a turn-based word game where
  // each message is a JSON move (`sonnet.word.v1`, one word per turn) plus
  // server ack messages (`sonnet.receipt.v1`) that carry no poem content.
  // Detect that shape so we can reconstruct the actual poem text instead of
  // showing raw JSON grouped by author.
  function tryParseStructured(msg) {
    const raw = String(msg.text ?? "").trim();
    if (!raw.startsWith("{")) return null;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== "object") return null;

    if (obj.type === "sonnet.receipt.v1") {
      return {
        kind: "receipt",
        requestId: typeof obj.request_id === "string" ? obj.request_id : null,
        status: typeof obj.status === "string" ? obj.status : null,
      };
    }
    if (obj.type === "sonnet.word.v1" && typeof obj.word === "string") {
      const gameKey = [obj.contest_id, obj.game_id, obj.poem_room]
        .filter(Boolean)
        .join("/") || currentRoom;
      return {
        kind: "word",
        word: obj.word,
        version: typeof obj.version === "number" ? obj.version : null,
        requestId: typeof obj.request_id === "string" ? obj.request_id : null,
        gameKey,
      };
    }
    return null;
  }

  // Group the turn-based word-game messages into one reconstructed poem per
  // game, ordered by each move's `version` (falling back to arrival order).
  // Only words the referee actually confirmed (a matching sonnet.receipt.v1
  // with status "accepted", matched by request_id) count — a word that was
  // sent but never got an accepted receipt back isn't part of the poem yet.
  function buildStructuredPoems(messages) {
    const receiptByRequestId = new Map(); // request_id -> status

    messages.forEach((msg) => {
      const parsed = tryParseStructured(msg);
      if (parsed && parsed.kind === "receipt" && parsed.requestId) {
        receiptByRequestId.set(parsed.requestId, parsed.status);
      }
    });

    const games = new Map(); // gameKey -> [{ word, version, msg, idx }]
    let pendingCount = 0;

    messages.forEach((msg, idx) => {
      const parsed = tryParseStructured(msg);
      if (!parsed || parsed.kind !== "word") return;

      const status = parsed.requestId
        ? receiptByRequestId.get(parsed.requestId)
        : undefined;
      if (status !== "accepted") {
        pendingCount += 1;
        return; // not confirmed by the referee (yet, or rejected) — skip
      }

      if (!games.has(parsed.gameKey)) games.set(parsed.gameKey, []);
      games.get(parsed.gameKey).push({
        word: parsed.word,
        version: parsed.version,
        msg,
        idx,
      });
    });

    const poems = [];
    for (const [gameKey, entries] of games.entries()) {
      entries.sort((a, b) => {
        if (a.version !== null && b.version !== null && a.version !== b.version) {
          return a.version - b.version;
        }
        return a.idx - b.idx;
      });

      const contributors = [];
      const seenDid = new Set();
      for (const e of entries) {
        const meta = shortId(e.msg.from);
        if (!seenDid.has(meta.full || meta.label)) {
          seenDid.add(meta.full || meta.label);
          contributors.push(meta);
        }
      }

      poems.push({
        structured: true,
        gameKey,
        entries,
        contributors,
        text: buildPoemLines(entries),
        firstIdx: entries[0].idx,
        lastIdx: entries[entries.length - 1].idx,
        firstTs: entries[0].msg.ts,
        lastTs: entries[entries.length - 1].msg.ts,
      });
    }

    poems.sort((a, b) => a.lastIdx - b.lastIdx);
    // pendingCount is global across all games in this batch — good enough
    // for a single status hint, since most rooms only run one game at a time.
    for (const poem of poems) poem.pendingCount = pendingCount;
    return poems;
  }

  // Contestants seem to start a new line each time a capitalized word comes
  // up mid-poem (the first word doesn't count, since the whole poem starts
  // capitalized) — so "We find… New wind… We feel…" becomes three lines.
  function buildPoemLines(entries) {
    const lines = [];
    let current = [];
    entries.forEach((e, i) => {
      const w = e.word;
      if (i > 0 && /^[A-Z]/.test(w) && current.length) {
        lines.push(current.join(" "));
        current = [w];
      } else {
        current.push(w);
      }
    });
    if (current.length) lines.push(current.join(" "));
    return lines.join("\n");
  }

  // Everything that isn't a recognized structured-game message — regular
  // chat text, fed into the old same-author/time-gap grouping.
  function nonStructuredMessages(messages) {
    return messages.filter((msg) => {
      const parsed = tryParseStructured(msg);
      return !parsed; // drop both "word" (handled separately) and "receipt" (noise)
    });
  }

  function setStatus(text, kind) {
    statusText.textContent = text;
    statusDot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  }

  function currentMinLines() {
    return Number(minLinesSelect.value) || 3;
  }

  function currentGapMs() {
    return Number(gapSelect.value) || 0;
  }

  // Group messages into "poems". Many contestants post a poem line-by-line
  // as separate messages rather than one message with embedded newlines, so
  // a poem here is: a maximal run of that author's own messages where each
  // consecutive pair is within `gapMs` of each other (other people's
  // messages interleaved in between don't break the run). If gapMs is 0,
  // every message stands alone (only genuinely multi-line single messages
  // will pass the min-lines filter).
  function groupIntoPoems(messages, gapMs) {
    const byAuthor = new Map();
    messages.forEach((msg, idx) => {
      const key = typeof msg.from === "string" ? msg.from : `?${idx}`;
      if (!byAuthor.has(key)) byAuthor.set(key, []);
      byAuthor.get(key).push({ msg, idx });
    });

    const poems = [];

    for (const entries of byAuthor.values()) {
      let run = [];
      let lastTs = null;

      const flush = () => {
        if (run.length) poems.push(run);
        run = [];
        lastTs = null;
      };

      for (const entry of entries) {
        const ts = tsMillis(entry.msg.ts);
        if (
          gapMs > 0 &&
          run.length &&
          lastTs !== null &&
          ts !== null &&
          ts - lastTs <= gapMs
        ) {
          run.push(entry);
        } else {
          flush();
          run.push(entry);
        }
        lastTs = ts !== null ? ts : lastTs;
      }
      flush();
    }

    // chronological by the first message in each run
    poems.sort((a, b) => a[0].idx - b[0].idx);
    return poems;
  }

  function poemText(run) {
    return run.map((e) => String(e.msg.text ?? "")).join("\n");
  }

  function poemLineCount(run) {
    return run.reduce((sum, e) => sum + Math.max(1, lineCount(e.msg.text)), 0);
  }

  function matchesFilters(run, meta) {
    if (poemLineCount(run) < currentMinLines()) return false;
    if (verifiedToggle.checked && !meta.verified) return false;
    const q = searchInput.value.trim().toLowerCase();
    if (q) {
      const inLabel = meta.label.toLowerCase().includes(q);
      const inText = poemText(run).toLowerCase().includes(q);
      if (!inLabel && !inText) return false;
    }
    return true;
  }

  function renderList() {
    listEl.innerHTML = "";

    const structuredPoems = buildStructuredPoems(allMessages);
    const freeformPoems = groupIntoPoems(
      nonStructuredMessages(allMessages),
      currentGapMs()
    );
    freeformPoems.reverse();

    let shown = 0;

    // structured (word-game) poems first — newest game activity on top
    const structuredSorted = [...structuredPoems].reverse();
    for (const poem of structuredSorted) {
      if (!structuredMatchesFilters(poem)) continue;
      shown += 1;
      if (shown > MAX_POEMS) break;
      listEl.appendChild(renderStructuredCard(poem));
    }

    for (const run of freeformPoems) {
      const meta = shortId(run[0].msg.from);
      if (!matchesFilters(run, meta)) continue;
      shown += 1;
      if (shown > MAX_POEMS) break;
      listEl.appendChild(renderFreeformCard(run, meta));
    }

    emptyEl.hidden = shown > 0;
    if (shown === 0) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = hasScannedOnce
        ? `Belum ada puisi yang cocok di <strong>#${escapeHtml(currentRoom)}</strong> saat ini — baik puisi bebas (≥ ${currentMinLines()} baris) maupun game kata bergiliran. Coba turunin "min. baris", naikin "gabung jeda", atau tunggu "live" nangkep giliran berikutnya.`
        : `Masukin nama room lalu klik <strong>scan</strong> buat lihat puisi kontestan.`;
      listEl.appendChild(emptyEl);
    }

    countText.textContent = `${shown} puisi`;
  }

  function structuredMatchesFilters(poem) {
    const q = searchInput.value.trim().toLowerCase();
    if (q) {
      const inText = poem.text.toLowerCase().includes(q);
      const inContrib = poem.contributors.some((c) =>
        c.label.toLowerCase().includes(q)
      );
      if (!inText && !inContrib) return false;
    }
    if (verifiedToggle.checked) {
      const anyVerified = poem.contributors.some((c) => c.verified);
      if (!anyVerified) return false;
    }
    return true;
  }

  function renderStructuredCard(poem) {
    const card = document.createElement("article");
    card.className = "poem-card poem-card--structured";

    const header = document.createElement("div");
    header.className = "poem-header";

    const gameBadge = document.createElement("span");
    gameBadge.className = "poem-game-badge";
    gameBadge.textContent = poem.gameKey;
    gameBadge.title = "kunci game (contest/game/room)";

    const time = document.createElement("span");
    time.className = "poem-time";
    const startTime = formatTime(poem.firstTs);
    const endTime = formatTime(poem.lastTs);
    time.textContent = `${startTime}–${endTime}`;

    const words = document.createElement("span");
    words.className = "poem-lines";
    const pendingSuffix = poem.pendingCount ? ` · ${poem.pendingCount} nunggu ACK` : "";
    words.textContent = `${poem.entries.length} kata · ${poem.contributors.length} penulis${pendingSuffix}`;

    header.appendChild(gameBadge);
    header.appendChild(time);
    header.appendChild(words);

    const contribRow = document.createElement("div");
    contribRow.className = "poem-contributors";
    for (const c of poem.contributors) {
      const chip = document.createElement("span");
      chip.className = `row-id ${c.verified ? "verified" : "human"}`;
      chip.innerHTML = `<span class="tick"></span>${escapeHtml(c.label)}`;
      chip.title = c.full;
      contribRow.appendChild(chip);
    }

    const body = document.createElement("div");
    body.className = "poem-body";
    body.textContent = poem.text;

    card.appendChild(header);
    card.appendChild(contribRow);
    card.appendChild(body);
    return card;
  }

  function renderFreeformCard(run, meta) {
    const card = document.createElement("article");
    card.className = "poem-card";

    const header = document.createElement("div");
    header.className = "poem-header";

    const badge = document.createElement("span");
    badge.className = `row-id ${meta.verified ? "verified" : "human"}`;
    badge.innerHTML = `<span class="tick"></span>${escapeHtml(meta.label)}`;
    badge.title = meta.full;

    const time = document.createElement("span");
    time.className = "poem-time";
    const startTime = formatTime(run[0].msg.ts);
    const endTime = formatTime(run[run.length - 1].msg.ts);
    time.textContent = run.length > 1 ? `${startTime}–${endTime}` : startTime;

    const lines = document.createElement("span");
    lines.className = "poem-lines";
    const lc = poemLineCount(run);
    lines.textContent =
      run.length > 1 ? `${lc} baris · ${run.length} pesan` : `${lc} baris`;

    header.appendChild(badge);
    header.appendChild(time);
    header.appendChild(lines);

    const body = document.createElement("div");
    body.className = "poem-body";
    body.textContent = poemText(run);

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  function addMessages(messages) {
    if (!messages.length) return;
    allMessages.push(...messages);
    if (allMessages.length > 20000) {
      allMessages = allMessages.slice(allMessages.length - 20000);
    }
  }

  // Parse the byte-exact JSONL the /export endpoint returns: one JSON
  // record per line (seq, ts, from, text, nonce, sig — no wrapping object).
  function parseJsonl(raw) {
    const out = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // one bad line shouldn't sink the whole scan
      }
    }
    return out;
  }

  // The real "scan everything" path: /r/<room>/export gives a snapshot of
  // the room's whole currently-retained ring in one shot. Unlike /r/<room>
  // with since=/limit= — which always answers with the newest `limit`
  // messages after the cursor, not the next ones (flop-labs/technocore-chat#721)
  // — this doesn't silently skip a big backlog.
  async function exportScanRoom(room) {
    const res = await fetch(`/api/export?room=${encodeURIComponent(room)}`);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const raw = await res.text();
    const records = parseJsonl(raw);
    let lastSeq = null;
    for (const r of records) {
      if (typeof r.seq === "number" && (lastSeq === null || r.seq > lastSeq)) {
        lastSeq = r.seq;
      }
    }
    return { messages: records, lastSeq };
  }

  // Fallback when /export isn't reachable: a single window of the most
  // recent messages via the regular polling endpoint. Better than nothing,
  // but — per the same caveat above — can't reliably backfill a large
  // existing backlog, only what fits in one page.
  async function windowScanRoom(room) {
    const params = new URLSearchParams({ room, limit: "200" });
    const res = await fetch(`/api/lobby?${params.toString()}`);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return { messages, lastSeq: data.last_seq ?? null };
  }

  async function scanRoomFromStart(room) {
    if (inFlight) return;
    inFlight = true;
    setStatus("scanning (full export)…", "");
    try {
      let result;
      try {
        result = await exportScanRoom(room);
      } catch (exportErr) {
        setStatus("export gagal, coba window terbaru…", "");
        result = await windowScanRoom(room);
      }
      allMessages = result.messages;
      sinceSeq = result.lastSeq;
      hasScannedOnce = true;
      setStatus("live", "live");
      renderList();
    } catch (err) {
      setStatus(`gagal ambil #${room} — ${err.message || err}`, "error");
    } finally {
      inFlight = false;
    }
  }

  async function fetchNewOnly() {
    if (inFlight) return;
    inFlight = true;

    const params = new URLSearchParams({ room: currentRoom, limit: "200" });
    if (sinceSeq !== null) params.set("since", String(sinceSeq));

    setStatus("checking for new puisi…", "");

    try {
      const res = await fetch(`/api/lobby?${params.toString()}`);
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const data = await res.json();

      const messages = Array.isArray(data.messages) ? data.messages : [];
      addMessages(messages);
      sinceSeq = data.last_seq ?? sinceSeq;

      setStatus("live", "live");
      renderList();
    } catch (err) {
      setStatus(`gagal ambil #${currentRoom} — ${err.message || err}`, "error");
    } finally {
      inFlight = false;
    }
  }

  function stopLive() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  }

  function startLive() {
    stopLive();
    if (!liveToggle.checked) return;
    liveTimer = setInterval(fetchNewOnly, LIVE_POLL_MS);
  }

  function scan(room) {
    const next = (room || "").trim();
    if (!next) return;
    currentRoom = next;
    sinceSeq = null;
    allMessages = [];
    hasScannedOnce = false;
    renderList();
    scanRoomFromStart(next).then(startLive);
  }

  scanBtn.addEventListener("click", () => scan(roomInput.value));
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scan(roomInput.value);
  });

  minLinesSelect.addEventListener("change", renderList);
  gapSelect.addEventListener("change", renderList);
  searchInput.addEventListener("input", renderList);
  verifiedToggle.addEventListener("change", renderList);

  liveToggle.addEventListener("change", () => {
    if (liveToggle.checked) startLive();
    else stopLive();
  });

  // first time the poems tab is opened, auto-scan whatever room the user
  // currently has open in the live feed, so it isn't just a blank screen
  let autoScannedOnce = false;
  window.addEventListener("technocore:poems-view-shown", () => {
    if (autoScannedOnce) return;
    autoScannedOnce = true;
    const feedRoomInput = document.getElementById("room-input");
    const startRoom = (feedRoomInput && feedRoomInput.value.trim()) || roomInput.value.trim() || "lapiece";
    roomInput.value = startRoom;
    scan(startRoom);
  });
})();
