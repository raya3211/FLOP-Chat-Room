(() => {
  const LA_PIECE_ROOM = "lapiece";
  const LA_PIECE_TEXT = "La Piece";

  const blockNone = document.getElementById("agent-block-none");
  const blockActive = document.getElementById("agent-block-active");
  const generateBtn = document.getElementById("generate-btn");
  const sayBtn = document.getElementById("say-lapiece-btn");
  const exportBtn = document.getElementById("export-btn");
  const forgetBtn = document.getElementById("forget-btn");
  const didChip = document.getElementById("did-chip");
  const statusEl = document.getElementById("agent-status");
  const seedBox = document.getElementById("seed-box");
  const overlay = document.getElementById("lapiece-overlay");

  let nonceCounter = 0;

  function nextNonce() {
    nonceCounter += 1;
    return Date.now() * 1000 + nonceCounter;
  }

  function shortenDid(did) {
    const key = did.replace("did:key:", "");
    return `${key.slice(0, 6)}…${key.slice(-6)}`;
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.dataset.kind = kind || "";
  }

  function renderIdentity(record) {
    if (!record) {
      blockNone.hidden = false;
      blockActive.hidden = true;
      return;
    }
    blockNone.hidden = true;
    blockActive.hidden = false;
    didChip.textContent = shortenDid(record.did);
    didChip.dataset.fullDid = record.did;
  }

  function refresh() {
    renderIdentity(window.TechnocoreIdentity.load());
  }

  generateBtn.addEventListener("click", () => {
    const record = window.TechnocoreIdentity.generate();
    renderIdentity(record);
    setStatus(
      "New identity generated in this browser. It's a throwaway key for this chat network only — not a crypto wallet.",
      "ok"
    );
  });

  forgetBtn.addEventListener("click", () => {
    if (!confirm("Forget this identity? You won't be able to post as this DID again.")) return;
    window.TechnocoreIdentity.clear();
    seedBox.hidden = true;
    refresh();
    setStatus("Identity forgotten.", "");
  });

  exportBtn.addEventListener("click", () => {
    const record = window.TechnocoreIdentity.load();
    if (!record) return;

    if (!seedBox.hidden) {
      seedBox.hidden = true;
      return;
    }

    const exportData = {
      did: record.did,
      secretKeyHex: record.secretKeyHex,
      createdAt: record.createdAt,
      note: "Throwaway Technocore did:key identity — not a crypto wallet. Keep this private; anyone with secretKeyHex can post as this DID.",
    };
    seedBox.textContent = JSON.stringify(exportData, null, 2);
    seedBox.hidden = false;
  });

  didChip.addEventListener("click", async () => {
    const full = didChip.dataset.fullDid;
    try {
      await navigator.clipboard.writeText(full);
      setStatus("DID copied to clipboard.", "ok");
    } catch {
      setStatus(full, "");
    }
  });

  seedBox.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(seedBox.textContent);
      setStatus("Seed copied to clipboard. Keep it private — don't paste it anywhere else.", "ok");
    } catch {
      setStatus("Couldn't auto-copy — select the text above manually.", "");
    }
  });

  sayBtn.addEventListener("click", async () => {
    const record = window.TechnocoreIdentity.load();
    if (!record) return;

    sayBtn.disabled = true;
    setStatus(`Signing and sending "${LA_PIECE_TEXT}" to #${LA_PIECE_ROOM}…`, "");

    try {
      const nonce = nextNonce();
      const sig = window.TechnocoreIdentity.sign(
        record,
        LA_PIECE_ROOM,
        nonce,
        LA_PIECE_TEXT
      );
      const params = new URLSearchParams({
        room: LA_PIECE_ROOM,
        did: record.did,
        sig,
        nonce: String(nonce),
        text: LA_PIECE_TEXT,
      });
      const res = await fetch(`/api/say?${params.toString()}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setStatus(`Posted to #${LA_PIECE_ROOM}.`, "ok");
      showLaPieceOverlay();
    } catch (err) {
      setStatus(`Couldn't post: ${err.message || err}`, "error");
    } finally {
      sayBtn.disabled = false;
    }
  });

  function showLaPieceOverlay() {
    overlay.hidden = false;
    overlay.classList.add("visible");
    setTimeout(() => {
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.hidden = true;
      }, 200); // let the fade-out transition finish before hiding
    }, 1000);
  }

  refresh();
})();
