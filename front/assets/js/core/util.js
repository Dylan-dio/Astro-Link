/* ==========================================================================
   Horizon Health OS — util.js
   Fonctions utilitaires partagées. Les "normaliseurs" rendent le front
   tolérant aux petites variations de format venant du Back-End.
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.util = (function () {
  "use strict";

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** Accepte un timestamp en secondes, en millisecondes ou une date ISO. */
  function toMs(ts) {
    if (ts == null || ts === "") return null;
    if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
    const n = Number(ts);
    if (!isNaN(n)) return toMs(n);
    const p = Date.parse(ts);
    return isNaN(p) ? null : p;
  }

  function num(v) {
    if (v == null || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  const pad = function (n) { return String(n).padStart(2, "0"); };
  function fmtTime(ms) { if (!ms) return "—"; const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fmtTimeS(ms) { if (!ms) return "—"; const d = new Date(ms); return fmtTime(ms) + ":" + pad(d.getSeconds()); }
  function fmtDate(ms) { if (!ms) return "—"; const d = new Date(ms); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function fmtDateTime(ms) { return ms ? fmtDate(ms) + " " + fmtTime(ms) : "—"; }
  function fmtAgo(ms) {
    if (!ms) return "jamais";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 5) return "à l'instant";
    if (s < 60) return "il y a " + s + " s";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "il y a " + h + " h";
    return fmtDateTime(ms);
  }

  const clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };

  function initials(name) {
    const words = String(name || "").split(/\s+/).filter(function (w) { return w && !/\.$/.test(w); });
    return (words.slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("")) || "?";
  }

  /** Renvoie un tableau depuis une réponse API ([...] ou {items:[...]}, etc.). */
  function asArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === "object") {
      const keys = Array.prototype.slice.call(arguments, 1).concat(["items", "data", "results"]);
      for (let i = 0; i < keys.length; i++) if (Array.isArray(x[keys[i]])) return x[keys[i]];
    }
    return [];
  }

  /** Niveau de santé : "g" (vert), "o" (orange), "r" (rouge) ou null (inconnu). */
  function normLevel(v) {
    if (v == null) return null;
    const s = String(v).toLowerCase();
    if (["g", "green", "vert", "sain", "ok", "nominal", "healthy"].indexOf(s) >= 0) return "g";
    if (["o", "orange", "warning", "anxiety", "anxiete", "anxiété"].indexOf(s) >= 0) return "o";
    if (["r", "red", "rouge", "critical", "critique", "quarantine", "quarantaine"].indexOf(s) >= 0) return "r";
    return null;
  }

  const LEVELS = {
    g: { label: "Sain", color: "var(--green)" },
    o: { label: "Anxiété — repos conseillé", color: "var(--orange)" },
    r: { label: "Quarantaine", color: "var(--red)" },
    n: { label: "Aucune donnée", color: "var(--text-faint)" }
  };
  function levelInfo(l) { return LEVELS[l] || LEVELS.n; }

  /** Posture issue du capteur Tilt : "actif", "repos" ou null. */
  function tiltOf(v) {
    if (!v) return null;
    const t = v.tilt != null ? v.tilt : (v.tiltStatus != null ? v.tiltStatus : v.posture);
    if (t == null) return null;
    const s = String(t).toLowerCase();
    if (["repos", "rest", "lying", "couche", "couché", "0", "false"].indexOf(s) >= 0) return "repos";
    if (["actif", "active", "standing", "debout", "moving", "1", "true"].indexOf(s) >= 0) return "actif";
    return null;
  }

  /** Niveau d'urgence renvoyé par l'IA → classe CSS + libellé. */
  function urgencyOf(u) {
    const s = String(u == null ? "" : u).toLowerCase();
    if (["critical", "critique", "4"].indexOf(s) >= 0) return { cls: "u-crit", label: "Critique" };
    if (["high", "élevé", "eleve", "haute", "3"].indexOf(s) >= 0) return { cls: "u-high", label: "Élevé" };
    if (["medium", "moderate", "modéré", "modere", "moyen", "mid", "2"].indexOf(s) >= 0) return { cls: "u-mid", label: "Modéré" };
    if (["low", "faible", "bas", "1"].indexOf(s) >= 0) return { cls: "u-low", label: "Faible" };
    return { cls: "u-none", label: "Non évalué" };
  }

  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /** Limite la fréquence d'exécution tout en garantissant un dernier appel. */
  function throttle(fn, ms) {
    let last = 0, timer = null;
    return function () {
      const now = Date.now();
      const run = function () { last = Date.now(); timer = null; fn(); };
      if (now - last >= ms) run();
      else if (!timer) timer = setTimeout(run, ms - (now - last));
    };
  }

  function uid() { return "id-" + Math.random().toString(36).slice(2, 10); }

  return {
    $: $, $$: $$, esc: esc, toMs: toMs, num: num, clamp: clamp,
    fmtTime: fmtTime, fmtTimeS: fmtTimeS, fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtAgo: fmtAgo,
    initials: initials, asArray: asArray, normLevel: normLevel, levelInfo: levelInfo,
    tiltOf: tiltOf, urgencyOf: urgencyOf, debounce: debounce, throttle: throttle, uid: uid
  };
})();
