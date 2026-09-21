/* ==========================================================================
   Horizon Health OS — api.js
   Client REST vers le serveur central (Back-End Python).
   Le détail de chaque route est documenté dans docs/API_CONTRACT.md.
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.api = (function () {
  "use strict";

  const enc = encodeURIComponent;

  async function request(path, options) {
    const opts = options || {};
    const cfg = HHO.config.get();
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || cfg.REQUEST_TIMEOUT_MS);

    const headers = { "Accept": "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const token = HHO.store.state.auth.token;
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      const res = await fetch(String(cfg.API_BASE).replace(/\/+$/, "") + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal
      });
      HHO.store.setConn("api", "online");
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
      if (!res.ok) {
        const err = new Error((data && data.detail) || ("HTTP " + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      // Erreur réseau ou délai dépassé → serveur injoignable
      if (e.name === "AbortError" || e.name === "TypeError") HHO.store.setConn("api", "offline");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request: request,

    // Système
    health: function () { return request("/api/health", { timeout: 4000 }); },
    login: function (username, password) { return request("/api/auth/login", { method: "POST", body: { username: username, password: password } }); },

    // Équipage
    getCrew: function () { return request("/api/crew"); },
    getMember: function (id) { return request("/api/crew/" + enc(id)); },
    getTelemetry: function (id, range) { return request("/api/crew/" + enc(id) + "/telemetry?range=" + enc(range || HHO.config.get().TELEMETRY_RANGE)); },
    setContamination: function (id, contaminated) { return request("/api/crew/" + enc(id) + "/contamination", { method: "POST", body: { contaminated: !!contaminated } }); },

    // PsychoSpace
    getCheckins: function (id, limit) { return request("/api/crew/" + enc(id) + "/checkins?limit=" + (limit || HHO.config.get().CHECKIN_HISTORY)); },
    postCheckin: function (payload) { return request("/api/checkins", { method: "POST", body: payload, timeout: HHO.config.get().CHAT_TIMEOUT_MS }); },

    // IA embarquée (Ollama via le Back-End)
    getDiagnostics: function (id) { return request("/api/crew/" + enc(id) + "/diagnostics"); },
    getRecommendations: function (id) { return request("/api/crew/" + enc(id) + "/recommendations"); },
    getChat: function (id) { return request("/api/crew/" + enc(id) + "/chat"); },
    chat: function (id, message) { return request("/api/chat", { method: "POST", body: { crewId: id, message: message }, timeout: HHO.config.get().CHAT_TIMEOUT_MS }); },

    // Alertes & crise
    getAlerts: function () { return request("/api/alerts?limit=100"); },
    getCrisis: function () { return request("/api/crisis"); },
    acknowledgeCrisis: function () { return request("/api/crisis/acknowledge", { method: "POST", body: { method: "manual_override" } }); }
  };
})();
