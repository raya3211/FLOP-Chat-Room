(() => {
  const roomInput = document.getElementById("poems-room-input");
  const scanBtn = document.getElementById("poems-scan-btn");
  const statusDot = document.getElementById("poems-status-dot");
  const statusText = document.getElementById("poems-status-text");
  const countText = document.getElementById("poems-count-text");
  const liveToggle = document.getElementById("poems-live-toggle");
  const minLinesSelect = document.getElementById("poems-min-lines");
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

  // every message seen in this room so far, oldest first — re-filtered
  // locally whenever the min-lines/search/verified controls change, so we
  // don't have to re-hit the network just to loosen or tighten the filter.
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

  function lineCount(text) {
    return String(text ?? "")
      .split("\n")
      .filter((line) => line.trim() !== "").length;
  }

  function setStatus(text, kind) {
    statusText.textContent = text;
    statusDot.className = `status-dot${kind ? ` ${kind}` : ""}`;
  }

  function currentMinLines() {
    return Number(minLinesSelect.value) || 3;
  }

  function matchesFilters(msg, meta) {
    if (lineCount(msg.text) < currentMinLines()) return false;
    if (verifiedToggle.checked && !meta.verified) return false;
    const q = searchInput.value.trim().toLowerCase();
    if (q) {
      const inLabel = meta.label.toLowerCase().includes(q);
      const inText = String(msg.text ?? "").toLowerCase().includes(q);
      if (!inLabel && !inText) return false;
    }
    return true;
  }

  function renderList() {
    listEl.innerHTML = "";

    // newest first, so the latest submissions surface at the top
    const ordered = [...allMessages].reverse();
    let shown = 0;

    for (const msg of ordered) {
      const meta = shortId(msg.from);
      if (!matchesFilters(msg, meta)) continue;
      shown += 1;
      if (shown > MAX_POEMS) break;

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
      time.textContent = formatTime(msg.ts);

      const lines = document.createElement("span");
      lines.className = "poem-lines";
      lines.textContent = `${lineCount(msg.text)} baris`;

      header.appendChild(badge);
      header.appendChild(time);
      header.appendChild(lines);

      const body = document.createElement("div");
      body.className = "poem-body";
      body.textContent = String(msg.text ?? "");

      card.appendChild(header);
      card.appendChild(body);
      listEl.appendChild(card);
    }

    emptyEl.hidden = shown > 0;
    if (shown === 0) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = hasScannedOnce
        ? `Belum ada puisi (≥ ${currentMinLines()} baris) yang cocok di <strong>#${escapeHtml(currentRoom)}</strong> saat ini.`
        : `Masukin nama room lalu klik <strong>scan</strong> buat lihat puisi kontestan.`;
      listEl.appendChild(emptyEl);
    }

    countText.textContent = `${shown} puisi`;
  }

  function addMessages(messages) {
    if (!messages.length) return;
    allMessages.push(...messages);
    if (allMessages.length > 2000) {
      allMessages = allMessages.slice(allMessages.length - 2000);
    }
  }

  async function fetchRoom({ append }) {
    if (inFlight) return;
    inFlight = true;

    const params = new URLSearchParams({ room: currentRoom, limit: "200" });
    if (append && sinceSeq !== null) params.set("since", String(sinceSeq));

    setStatus(append ? "checking for new puisi…" : "scanning…", "");

    try {
      const res = await fetch(`/api/lobby?${params.toString()}`);
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const data = await res.json();

      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (!append) allMessages = [];
      addMessages(messages);
      sinceSeq = data.last_seq ?? sinceSeq;
      hasScannedOnce = true;

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
    liveTimer = setInterval(() => fetchRoom({ append: true }), LIVE_POLL_MS);
  }

  function scan(room) {
    const next = (room || "").trim();
    if (!next) return;
    currentRoom = next;
    sinceSeq = null;
    allMessages = [];
    hasScannedOnce = false;
    renderList();
    fetchRoom({ append: false }).then(startLive);
  }

  scanBtn.addEventListener("click", () => scan(roomInput.value));
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scan(roomInput.value);
  });

  minLinesSelect.addEventListener("change", renderList);
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
