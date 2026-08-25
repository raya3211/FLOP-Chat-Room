(() => {
  const composer = document.getElementById("composer");
  const locked = document.getElementById("composer-locked");
  const didEl = document.getElementById("composer-did");
  const input = document.getElementById("composer-input");
  const sendBtn = document.getElementById("composer-send");
  const statusEl = document.getElementById("composer-status");
  const roomInput = document.getElementById("room-input");

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
    statusEl.textContent = msg || "";
    statusEl.dataset.kind = kind || "";
  }

  function currentRoom() {
    return roomInput.value.trim() || "lapiece";
  }

  function render(record) {
    if (!record) {
      composer.hidden = true;
      locked.hidden = false;
      setStatus("");
      return;
    }
    composer.hidden = false;
    locked.hidden = true;
    didEl.textContent = shortenDid(record.did);
    didEl.title = record.did;
  }

  async function send() {
    const record = window.TechnocoreIdentity.load();
    if (!record) {
      render(null);
      return;
    }

    const text = input.value.trim();
    if (!text) return;

    const room = currentRoom();

    sendBtn.disabled = true;
    input.disabled = true;
    setStatus(`Signing and sending to #${room}…`, "");

    try {
      const nonce = nextNonce();
      const sig = window.TechnocoreIdentity.sign(record, room, nonce, text);
      const params = new URLSearchParams({
        room,
        did: record.did,
        sig,
        nonce: String(nonce),
        text,
      });
      const res = await fetch(`/api/say?${params.toString()}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      input.value = "";
      setStatus(`Posted to #${room}.`, "ok");
    } catch (err) {
      setStatus(`Couldn't post: ${err.message || err}`, "error");
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  window.addEventListener("technocore:identity-changed", (e) => render(e.detail));
  window.addEventListener("technocore:identity-cleared", () => render(null));

  render(window.TechnocoreIdentity.load());
})();
