(() => {
  const feedEl = document.getElementById("feed");
  const feedEmptyEl = document.getElementById("feed-empty");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const seqRangeEl = document.getElementById("seq-range");
  const rateTextEl = document.getElementById("rate-text");
  const roomInput = document.getElementById("room-input");
  const roomGoBtn = document.getElementById("room-go");
  const didFilterInput = document.getElementById("did-filter");
  const autoscrollToggle = document.getElementById("autoscroll-toggle");
  const verifiedOnlyToggle = document.getElementById("verified-only-toggle");
  const ringFillCircle = document.getElementById("ring-fill-circle");
  const ringPercentEl = document.getElementById("ring-percent");

  const RING_CIRCUMFERENCE = 113; // 2 * PI * r(18), matches the SVG stroke-dasharray
  const MAX_ROWS_IN_DOM = 400;
  const POLL_INTERVAL_MS = 2500;

  let currentRoom = roomInput.value.trim() || "lobby";
  let sinceSeq = null;
  let pollTimer = null;
  let inFlight = false;
  let consecutiveErrors = 0;
  let recentTimestamps = []; // for msgs/min calc
  let filterText = "";
  let verifiedOnly = false;

  function shortId(from) {
    if (typeof from !== "string") return { label: "?", verified: false };
    if (from.startsWith("did:key:")) {
      const key = from.slice("did:key:".length);
      const short = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
      return { label: short, verified: true };
    }
    if (from === "human") return { label: "human", verified: false };
    return { label: from, verified: false };
  }

  function linkify(text) {
    const urlRe = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRe, (url) => {
      const safe = url.replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
    });
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

  function updateRate() {
    const now = Date.now();
    recentTimestamps = recentTimestamps.filter((t) => now - t < 60000);
    const rate = recentTimestamps.length;
    rateTextEl.textContent = `${rate} msg${rate === 1 ? "" : "s"}/min`;

    // signature ring gauge: fills toward a soft ceiling of ~40 msgs/min, drains when quiet
    const pct = Math.max(0, Math.min(100, Math.round((rate / 40) * 100)));
    const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
    ringFillCircle.style.strokeDashoffset = String(offset);
    ringPercentEl.textContent = `${pct}%`;

    if (pct > 70) {
      ringFillCircle.style.stroke = "#f2a65a";
    } else {
      ringFillCircle.style.stroke = "#4fd1c5";
    }
  }

  function applyRowVisibility(row, meta) {
    const matchesFilter =
      !filterText ||
      meta.label.toLowerCase().includes(filterText) ||
      meta.text.toLowerCase().includes(filterText);
    const matchesVerified = !verifiedOnly || meta.verified;
    row.classList.toggle("dimmed", !(matchesFilter && matchesVerified));
  }

  const allRows = []; // { el, label, text, verified }

  function renderMessage(msg) {
    const { label, verified } = shortId(msg.from);
    const row = document.createElement("div");
    row.className = "row";

    const timeEl = document.createElement("div");
    timeEl.className = "row-time";
    timeEl.textContent = formatTime(msg.ts);

    const idEl = document.createElement("div");
    idEl.className = `row-id ${verified ? "verified" : "human"}`;
    idEl.innerHTML = `<span class="tick"></span>${escapeHtml(label)}`;

    const textEl = document.createElement("div");
    textEl.className = "row-text";
    const safeText = escapeHtml(String(msg.text ?? ""));
    textEl.innerHTML = linkify(safeText);

    row.appendChild(timeEl);
    row.appendChild(idEl);
    row.appendChild(textEl);

    const meta = { el: row, label, text: safeText, verified };
    applyRowVisibility(row, meta);
    allRows.push(meta);

    feedEl.appendChild(row);

    while (allRows.length > MAX_ROWS_IN_DOM) {
      const old = allRows.shift();
      old.el.remove();
    }
  }

  function isNearBottom() {
    const threshold = 80;
    return (
      feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < threshold
    );
  }

  async function poll() {
    if (inFlight) return;
    inFlight = true;

    const params = new URLSearchParams({ room: currentRoom, limit: "200" });
    if (sinceSeq !== null) params.set("since", String(sinceSeq));

    try {
      const res = await fetch(`/api/lobby?${params.toString()}`);
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const data = await res.json();

      consecutiveErrors = 0;
      statusDot.className = "status-dot live";
      statusText.textContent = "live";

      const messages = Array.isArray(data.messages) ? data.messages : [];
      const wasNearBottom = isNearBottom();

      if (messages.length) {
        feedEmptyEl.remove?.();
        for (const msg of messages) {
          renderMessage(msg);
          recentTimestamps.push(Date.now());
        }
        sinceSeq = data.last_seq ?? sinceSeq;
        seqRangeEl.textContent = `seq ${data.first_seq ?? "?"}–${data.last_seq ?? "?"}`;
      }

      updateRate();

      if (autoscrollToggle.checked && wasNearBottom) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    } catch (err) {
      consecutiveErrors += 1;
      statusDot.className = "status-dot error";
      statusText.textContent =
        consecutiveErrors > 3 ? "connection trouble — retrying" : "retrying…";
    } finally {
      inFlight = false;
    }
  }

  function resetFeed() {
    feedEl.innerHTML = '<div class="feed-empty" id="feed-empty">Tuning in…</div>';
    allRows.length = 0;
    sinceSeq = null;
    recentTimestamps = [];
    seqRangeEl.textContent = "seq —";
    updateRate();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  roomGoBtn.addEventListener("click", () => {
    const next = roomInput.value.trim();
    if (!next || next === currentRoom) return;
    currentRoom = next;
    resetFeed();
    startPolling();
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") roomGoBtn.click();
  });

  didFilterInput.addEventListener("input", () => {
    filterText = didFilterInput.value.trim().toLowerCase();
    for (const meta of allRows) applyRowVisibility(meta.el, meta);
  });

  verifiedOnlyToggle.addEventListener("change", () => {
    verifiedOnly = verifiedOnlyToggle.checked;
    for (const meta of allRows) applyRowVisibility(meta.el, meta);
  });

  startPolling();
})();
