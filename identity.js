// Fully client-side did:key identity: generate an Ed25519 keypair, derive a
// did:key string, and sign messages — all in the browser. The private key
// never leaves this tab except into localStorage on the same device.

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes) {
  let digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // leading zero bytes -> leading '1's
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((d) => B58_ALPHABET[d])
    .join("");
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function base64UrlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function didFromPublicKey(pubKeyBytes) {
  // multicodec prefix for Ed25519 public key: 0xed 0x01, then multibase 'z' (base58btc)
  const prefixed = new Uint8Array(2 + pubKeyBytes.length);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(pubKeyBytes, 2);
  return "did:key:z" + base58Encode(prefixed);
}

const STORAGE_KEY = "technocore_agent_identity_v1";

const Identity = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.secretKeyHex || !parsed.did) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  generate() {
    const keyPair = nacl.sign.keyPair();
    const did = didFromPublicKey(keyPair.publicKey);
    const record = {
      did,
      secretKeyHex: bytesToHex(keyPair.secretKey),
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  },

  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },

  // Log in with an existing identity. Accepts either:
  //  - a 64-byte secretKeyHex (128 hex chars) — what "Export seed" shows, or
  //  - a 32-byte Ed25519 seed (64 hex chars) — the raw seed some tools export.
  // Derives the DID locally — nothing is sent anywhere.
  importFromSecretKeyHex(hex) {
    const clean = String(hex || "").trim().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]+$/.test(clean) || (clean.length !== 128 && clean.length !== 64)) {
      throw new Error(
        "Paste either a 64-char hex seed or a 128-char hex secretKey."
      );
    }
    let keyPair;
    try {
      keyPair =
        clean.length === 64
          ? nacl.sign.keyPair.fromSeed(hexToBytes(clean))
          : nacl.sign.keyPair.fromSecretKey(hexToBytes(clean));
    } catch {
      throw new Error("That doesn't look like a valid Ed25519 key.");
    }
    const did = didFromPublicKey(keyPair.publicKey);
    const record = {
      did,
      secretKeyHex: bytesToHex(keyPair.secretKey),
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  },

  sign(record, room, nonce, text) {
    const secretKey = hexToBytes(record.secretKeyHex);
    const message = new TextEncoder().encode(`${room}|${nonce}|${text}`);
    const sig = nacl.sign.detached(message, secretKey);
    return base64UrlEncode(sig);
  },
};

window.TechnocoreIdentity = Identity;
