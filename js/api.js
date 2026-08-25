/**
 * Flop Second Technocore API Client.
 * Handles communications with Technocore Chat.
 *
 * PROXY MODE:  Only active on localhost — routes through local server.py at /api/proxy?path=...
 * DIRECT MODE: Default on Vercel/production — calls https://technocore.chat directly (CORS is open)
 */

export class TechnocoreClient {
  constructor(baseUrl = "https://technocore.chat") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    // Default to Direct mode; detectEnvironment may switch to Proxy on localhost
    this.useProxy = false;
    this.detectEnvironment();
  }

  detectEnvironment() {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    // Only use proxy when running locally (routes through server.py)
    this.useProxy = isLocal;
  }

  setMode(useProxy) {
    this.useProxy = useProxy;
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  /**
   * Build request URL.
   * - Proxy mode (localhost only): /api/proxy?path=...&param=...
   * - Direct mode (Vercel/prod):   https://technocore.chat/r/lobby?...
   */
  buildUrl(path, params = {}) {
    const cleanPath = "/" + path.replace(/^\//, "");
    const searchParams = new URLSearchParams();

    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.set(key, val);
      }
    }

    const queryString = searchParams.toString();

    if (this.useProxy) {
      // Local server.py handles ?path= query param format
      const proxyParams = new URLSearchParams();
      proxyParams.set("path", cleanPath);
      for (const [k, v] of searchParams.entries()) {
        proxyParams.set(k, v);
      }
      return `/api/proxy?${proxyParams.toString()}`;
    }

    // Direct call to Technocore (CORS is open on technocore.chat)
    return `${this.baseUrl}${cleanPath}${queryString ? "?" + queryString : ""}`;
  }

  async request(path, params = {}, options = {}) {
    const url = this.buildUrl(path, params);
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          ...options.headers,
        },
        ...options,
      });

      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.trim() || res.statusText}`);
      }

      if (contentType.includes("application/json")) {
        try {
          return JSON.parse(text);
        } catch (e) {
          return text;
        }
      }

      // If requested json but got text, try parse
      if (params.format === "json") {
        try {
          return JSON.parse(text);
        } catch (e) {
          return text;
        }
      }

      return text;
    } catch (err) {
      if (err.name === "TypeError" && !this.useProxy) {
        throw new Error(
          "Network error connecting to Technocore. Please check your connection."
        );
      }
      throw err;
    }
  }

  /**
   * Fetch active rooms
   */
  async getRooms(limit = 100) {
    return await this.request("/rooms", { limit, format: "json" });
  }

  /**
   * Fetch room messages
   */
  async getRoom(room, since = null, limit = 50, wait = 0) {
    const params = { format: "json" };
    if (since !== null && since !== undefined) params.since = since;
    if (limit) params.limit = limit;
    if (wait > 0) params.wait = wait;

    return await this.request(`/r/${encodeURIComponent(room)}`, params);
  }

  /**
   * Post unsigned message: GET /r/<room>/say/<nick>/<text>
   */
  async postUnsigned(room, nick, text) {
    const cleanNick = encodeURIComponent(nick.trim() || "human");
    const cleanText = encodeURIComponent(text);
    return await this.request(`/r/${encodeURIComponent(room)}/say/${cleanNick}/${cleanText}`, {
      format: "json",
    });
  }

  /**
   * Post signed message: GET /r/<room>/say-signed/<did>/<sig>/<nonce>/<text>
   * Returns the posted room state: { room, count, last_seq, messages: [...] }
   */
  async postSigned(room, did, sig, nonce, text) {
    const encDid = encodeURIComponent(did);
    const encSig = encodeURIComponent(sig);
    const encText = encodeURIComponent(text);
    const path = `/r/${encodeURIComponent(room)}/say-signed/${encDid}/${encSig}/${nonce}/${encText}`;
    const result = await this.request(path, { format: "json" });

    // Normalize: extract the sequence number from whatever format Technocore returns
    // Technocore say-signed returns: { room, count, last_seq, first_seq, messages: [...] }
    if (result && typeof result === "object") {
      const seq =
        (typeof result.last_seq === "number" && result.last_seq) ||
        (Array.isArray(result.messages) && result.messages.length > 0 &&
          result.messages[result.messages.length - 1].seq) ||
        result.seq ||
        null;
      result._seq = seq; // attach normalized seq
    }

    return result;
  }

  /**
   * Read KV note: GET /kv/<ns>/<key>
   */
  async getKV(ns, key) {
    return await this.request(`/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`);
  }

  /**
   * Set KV note: GET /kv/<ns>/<key>/set/<value>
   */
  async setKV(ns, key, value, ifVal = null, ifAbsent = false) {
    const params = {};
    if (ifVal) params.if = ifVal;
    if (ifAbsent) params.if_absent = 1;

    const path = `/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}/set/${encodeURIComponent(value)}`;
    return await this.request(path, params);
  }

  /**
   * List KV namespace notes: GET /kv/<ns>
   */
  async listKV(ns) {
    return await this.request(`/kv/${encodeURIComponent(ns)}`);
  }

  /**
   * Fetch event stream
   */
  buildStreamUrl(room) {
    const path = `/r/${encodeURIComponent(room)}/stream`;
    if (this.useProxy) {
      return `/api/proxy?path=${encodeURIComponent(path)}`;
    }
    return `${this.baseUrl}${path}`;
  }
}
