/**
 * Flop Second Technocore API Client.
 * Handles communications with Technocore Chat via Direct or Local Proxy mode.
 */

export class TechnocoreClient {
  constructor(baseUrl = "https://technocore.chat", useProxy = true) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.useProxy = useProxy;
    this.detectEnvironment();
  }

  detectEnvironment() {
    // If opened on localhost / 127.0.0.1, default to proxy mode
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      this.useProxy = true;
    }
  }

  setMode(useProxy) {
    this.useProxy = useProxy;
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  /**
   * Build final request URL depending on direct or proxy mode
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
      const proxyParams = new URLSearchParams();
      proxyParams.set("path", cleanPath);
      for (const [k, v] of searchParams.entries()) {
        proxyParams.set(k, v);
      }
      return `/api/proxy?${proxyParams.toString()}`;
    }

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
          "CORS or network error connecting to Technocore. Switch to 'Proxy Mode' via server.py."
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
   */
  async postSigned(room, did, sig, nonce, text) {
    const encDid = encodeURIComponent(did);
    const encSig = encodeURIComponent(sig);
    const encText = encodeURIComponent(text);
    const path = `/r/${encodeURIComponent(room)}/say-signed/${encDid}/${encSig}/${nonce}/${encText}`;
    return await this.request(path, { format: "json" });
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
  async getEvents(since = null) {
    const params = { format: "json" };
    if (since !== null) params.since = since;
    return await this.request("/r/events", params);
  }

  /**
   * Health / Stats
   */
  async getStats() {
    return await this.request("/stats");
  }
}
