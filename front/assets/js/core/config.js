/* ==========================================================================
   Horizon Health OS — config.js
   Paramètres de l'interface. Les valeurs "éditables" peuvent être modifiées
   depuis la vue Paramètres (sauvegardées dans le navigateur).
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.config = (function () {
  "use strict";

  const DEFAULTS = {
    // --- Connexion au serveur central (Back-End Python) -------------------
    API_BASE: "http://localhost:8000",        // API REST
    WS_URL: "ws://localhost:8000/ws",         // Flux temps réel (WebSocket)

    // --- Préférences ------------------------------------------------------
    SOUND: true,                              // buzzer simulé dans le navigateur
    REQUIRE_AUTH: false,                      // protéger les vues médecin

    // --- Seuils métier (affichage uniquement, le calcul fait foi côté Back) -
    CONTAMINATION_THRESHOLD: 0.15,            // 15 % → protocole de quarantaine
    ANXIETY_THRESHOLD: 60,                    // stress déclaré ≥ 60 % → orange

    // --- Technique --------------------------------------------------------
    ONLINE_TIMEOUT_MS: 15000,                 // badge considéré "muet" au-delà
    HISTORY_MAX_POINTS: 600,                  // points de télémétrie gardés en mémoire
    RECONNECT_DELAY_MS: 2000,                 // première tentative de reconnexion WS
    POLL_INTERVAL_MS: 20000,                  // rafraîchissement REST de secours
    TELEMETRY_RANGE: "6h",                    // historique demandé au serveur
    CHECKIN_HISTORY: 14,                      // nombre de check-ins affichés
    REQUEST_TIMEOUT_MS: 8000,
    CHAT_TIMEOUT_MS: 90000,                   // un LLM local peut être lent
    HOLD_TO_CONFIRM_MS: 1500,
    VERSION: "1.9.0"
  };

  const EDITABLE = ["API_BASE", "WS_URL", "SOUND", "REQUIRE_AUTH"];
  const KEY = "hho.settings";
  let current = Object.assign({}, DEFAULTS);

  function readStored() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function load() {
    const stored = readStored();
    current = Object.assign({}, DEFAULTS);

    // Si l'interface est servie par le Back-End lui-même (http://...),
    // on utilise automatiquement la même origine.
    if (location.protocol === "http:" || location.protocol === "https:") {
      current.API_BASE = location.origin;
      current.WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    }
    EDITABLE.forEach(function (k) { if (stored[k] !== undefined) current[k] = stored[k]; });
    return current;
  }

  function save(patch) {
    const stored = readStored();
    EDITABLE.forEach(function (k) {
      if (patch[k] !== undefined) { current[k] = patch[k]; stored[k] = patch[k]; }
    });
    try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch (e) { /* stockage indisponible */ }
    return current;
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return load();
  }

  function get() { return current; }

  return { load: load, save: save, reset: reset, get: get, DEFAULTS: DEFAULTS };
})();
