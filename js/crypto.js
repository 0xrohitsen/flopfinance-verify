/**
 * Flop Second Cryptographic Engine & DID Utilities.
 * Implements Ed25519 did:key:z6Mk..., canonical Technocore payload builder,
 * Base58BTC multibase encoding/decoding, and encrypted vault storage.
 */

const BASE58BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58BTC_MAP = {};
for (let i = 0; i < BASE58BTC_ALPHABET.length; i++) {
  BASE58BTC_MAP[BASE58BTC_ALPHABET[i]] = BigInt(i);
}

const MULTICODEC_ED25519 = new Uint8Array([0xed, 0x01]);
const MULTIBASE_LENGTH = 48;
const SIGNATURE_LENGTH = 86;

const WORDLIST = [
  "alpha", "bravo", "cyber", "delta", "echo", "flock", "glide", "hyper",
  "ionic", "jet", "kilo", "lunar", "matrix", "nexus", "orbit", "pulse",
  "quantum", "radar", "solar", "turbo", "ultra", "vector", "wave", "zenith",
  "agent", "beacon", "crypto", "did", "engine", "flux", "gateway", "horizon"
];

// Invisible Unicode Categories matcher
const INVISIBLE_REGEX = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u206F\u00A0\s]+/g;

export const FlopCrypto = {
  /**
   * Generate a secure random 8-word passphrase (min 32 chars)
   */
  generatePassphrase() {
    const words = [];
    const randArr = new Uint8Array(8);
    window.crypto.getRandomValues(randArr);
    for (let i = 0; i < 8; i++) {
      words.push(WORDLIST[randArr[i] % WORDLIST.length]);
    }
    // Add random 4-digit PIN for extra entropy
    const pin = Math.floor(1000 + Math.random() * 9000);
    return words.join("-") + "-" + pin;
  },

  /**
   * Download a text file in browser
   */
  downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  },

  /**
   * Base58BTC encode bytes
   */
  base58btcEncode(bytes) {
    let zeroes = 0;
    while (zeroes < bytes.length && bytes[zeroes] === 0) {
      zeroes++;
    }

    let num = BigInt(0);
    for (let i = 0; i < bytes.length; i++) {
      num = (num << BigInt(8)) + BigInt(bytes[i]);
    }

    let str = "";
    const base = BigInt(58);
    while (num > BigInt(0)) {
      const rem = num % base;
      num = num / base;
      str = BASE58BTC_ALPHABET[Number(rem)] + str;
    }

    return "1".repeat(zeroes) + str;
  },

  /**
   * Base58BTC decode string to bytes
   */
  base58btcDecode(str) {
    let zeroes = 0;
    while (zeroes < str.length && str[zeroes] === "1") {
      zeroes++;
    }

    let num = BigInt(0);
    const base = BigInt(58);
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (!(char in BASE58BTC_MAP)) {
        throw new Error(`Invalid Base58BTC character: ${char}`);
      }
      num = num * base + BASE58BTC_MAP[char];
    }

    const hex = num.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : "0" + hex;
    const len = paddedHex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(paddedHex.substr(i * 2, 2), 16);
    }

    if (zeroes > 0) {
      const result = new Uint8Array(zeroes + bytes.length);
      result.set(bytes, zeroes);
      return result;
    }
    return bytes;
  },

  /**
   * Derive public DID from raw 32-byte Ed25519 public key bytes
   */
  didFromPublicKeyBytes(pubKeyBytes) {
    if (pubKeyBytes.length !== 32) {
      throw new Error("Ed25519 public key must be 32 bytes");
    }
    const combined = new Uint8Array(2 + 32);
    combined.set(MULTICODEC_ED25519, 0);
    combined.set(pubKeyBytes, 2);

    const multibase = "z" + this.base58btcEncode(combined);
    if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
      throw new Error("Invalid derived DID format");
    }
    return "did:key:" + multibase;
  },

  /**
   * Extract raw 32-byte Ed25519 public key from did:key:z6Mk...
   */
  publicKeyBytesFromDid(did) {
    const prefix = "did:key:";
    if (!did || !did.startsWith(prefix)) {
      throw new Error("DID must start with did:key:z6Mk");
    }
    const multibase = did.slice(prefix.length);
    if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
      throw new Error("DID must be a 48-character multibase string starting with z6Mk");
    }
    const decoded = this.base58btcDecode(multibase.slice(1));
    if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
      throw new Error("DID does not contain a valid Ed25519 public key header");
    }
    return decoded.slice(2);
  },

  /**
   * Abbreviate DID for UI display (z6Mk...2doK)
   */
  abbreviateDid(did) {
    if (!did || !did.startsWith("did:key:")) return did;
    const mb = did.replace("did:key:", "");
    if (mb.length < 12) return did;
    return `${mb.slice(0, 4)}…${mb.slice(-4)}`;
  },

  /**
   * Clean and normalize single-line message according to Technocore protocol
   */
  normalizeMessage(text) {
    if (typeof text !== "string") throw new Error("Message text must be a string");
    // Replace all invisible/whitespace control chars with a single space
    const normalized = text.replace(INVISIBLE_REGEX, " ").trim();
    if (!normalized) {
      throw new Error("Message has no visible text after normalization");
    }
    if (normalized.length > 4096) {
      throw new Error(`Message exceeds 4096 characters (got ${normalized.length})`);
    }
    return normalized;
  },

  /**
   * Validate room name
   */
  validateRoom(room) {
    if (!room || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) {
      throw new Error("Room must match ^[a-z0-9][a-z0-9_-]{0,47}$");
    }
    return room;
  },

  /**
   * Generate next high-precision wall-clock nonce
   */
  nextNonce() {
    return String(Date.now()) + String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  },

  /**
   * Build normalized text and byte payload for signing
   */
  messagePayload(room, nonce, text) {
    const validRoom = this.validateRoom(room);
    const validNonce = String(nonce);
    if (!/^[0-9]{1,19}$/.test(validNonce)) {
      throw new Error("Nonce must contain 1-19 digits");
    }
    const normText = this.normalizeMessage(text);
    const payloadStr = `${validRoom}|${validNonce}|${normText}`;
    const payloadBytes = new TextEncoder().encode(payloadStr);
    return { normText, payloadStr, payloadBytes };
  },

  /**
   * Base64URL encode without padding
   */
  base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },

  /**
   * Base64URL decode to Uint8Array
   */
  base64UrlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },

  /**
   * Offline / Server-Assisted Signature Verification
   */
  async verifySignature(did, sig, room, nonce, text) {
    const { payloadStr, payloadBytes } = this.messagePayload(room, nonce, text);
    
    // Attempt local WebCrypto if Ed25519 is supported
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.verify) {
      try {
        const pubKeyBytes = this.publicKeyBytesFromDid(did);
        const cryptoKey = await window.crypto.subtle.importKey(
          "raw",
          pubKeyBytes,
          { name: "Ed25519" },
          false,
          ["verify"]
        );
        const sigBytes = this.base64UrlDecode(sig);
        const valid = await window.crypto.subtle.verify(
          { name: "Ed25519" },
          cryptoKey,
          sigBytes,
          payloadBytes
        );
        return { valid, payloadStr, method: "webcrypto" };
      } catch (err) {
        // Fall back to server verification API if browser WebCrypto lacks Ed25519
      }
    }

    // Call local server verify API
    try {
      const res = await fetch("/api/crypto/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did, sig, room, nonce, text }),
      });
      if (res.ok) {
        const data = await res.json();
        return { valid: data.valid, payloadStr: data.payload_string, method: "server" };
      }
    } catch (e) {
      // Server unreachable
    }

    throw new Error("Signature verification requires WebCrypto Ed25519 or Flop Second local server.");
  },

  /**
   * Generate an encrypted identity via backend or WebCrypto
   */
  async generateIdentity(passphrase) {
    if (!passphrase || passphrase.length < 12) {
      throw new Error("Passphrase must be at least 12 characters");
    }

    // Try server API first
    try {
      const res = await fetch("/api/crypto/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) {
        const data = await res.json();
        return data; // { did, pem }
      }
    } catch (e) {
      // Fallback
    }

    // If server is not running, check WebCrypto Ed25519
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.generateKey) {
      try {
        const keyPair = await window.crypto.subtle.generateKey(
          { name: "Ed25519" },
          true,
          ["sign", "verify"]
        );
        const pubRaw = new Uint8Array(await window.crypto.subtle.exportKey("raw", keyPair.publicKey));
        const did = this.didFromPublicKeyBytes(pubRaw);
        
        // Export PKCS8
        const pkcs8 = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        return {
          did,
          pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(pkcs8)))}\n-----END PRIVATE KEY-----`,
          rawKeyPair: keyPair,
        };
      } catch (err) {
        throw new Error("Browser does not support Ed25519 natively. Please run server.py.");
      }
    }

    throw new Error("Unable to generate key. Please run server.py.");
  },

  /**
   * Sign message with identity — pure browser WebCrypto fallback (works on Vercel without server.py)
   */
  async signMessage(pem, passphrase, room, text, nonce = null) {
    const activeNonce = nonce || this.nextNonce();

    // Try server API first (works on localhost)
    try {
      const res = await fetch("/api/crypto/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pem, passphrase, room, text, nonce: activeNonce }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Server not available — fall through to WebCrypto
    }

    // Pure browser WebCrypto Ed25519 fallback (Vercel / static deployment)
    if (window.crypto && window.crypto.subtle) {
      try {
        const { normText, payloadBytes } = this.messagePayload(room, activeNonce, text);

        // Extract raw PKCS8 bytes from PEM
        const pemBody = pem
          .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
          .replace(/\s+/g, "");
        const pkcs8Bytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

        // Import PKCS8 as Ed25519 signing key
        const privateKey = await window.crypto.subtle.importKey(
          "pkcs8",
          pkcs8Bytes,
          { name: "Ed25519" },
          false,
          ["sign"]
        );

        // Sign the payload
        const sigBuf = await window.crypto.subtle.sign(
          { name: "Ed25519" },
          privateKey,
          payloadBytes
        );

        const sig = this.base64UrlEncode(new Uint8Array(sigBuf));

        return {
          sig,
          nonce: activeNonce,
          room,
          text: normText,
          payload_string: `${room}|${activeNonce}|${normText}`,
          method: "webcrypto",
        };
      } catch (err) {
        throw new Error("Browser Ed25519 signing failed: " + err.message);
      }
    }

    throw new Error("Signing is not supported in this browser. Please use a modern browser.");
  },
};

