/* ==========================================================================
   Horizon Health OS — store.js
   Source de vérité unique côté front. Toutes les données viennent du
   Back-End (REST ou WebSocket) : AUCUNE donnée n'est écrite en dur ici.
   Les vues s'abonnent aux événements via HHO.store.on("evenement", fn).

   Événements émis :
     crew, telemetry, checkins, diagnostics, recommendations, chat,
     alerts, feed, crisis, conn, hall, resize
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.store = (function () {
  "use strict";
  const U = HHO.util;

  const state = {
    crew: new Map(),            // id -> profil
    telemetry: new Map(),       // id -> { latest, history: [] }
    checkins: new Map(),        // id -> [check-ins triés]
    diagnostics: new Map(),     // id -> [analyses IA]
    recommendations: new Map(), // id -> [recommandations IA]
    chats: new Map(),           // id -> [messages]
    alerts: [],
    feed: [],                   // derniers messages WebSocket bruts
    crisis: { active: false, rate: null, triage: [], since: null },
    conn: { api: "unknown", ws: "offline", lastMessageAt: null },
    auth: { token: null, user: null }
  };

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error("[HHO] erreur listener " + evt, e); }
    });
  }

  const cfg = function () { return HHO.config.get(); };

  /* ---------------- Équipage ---------------- */
  function normMember(m) {
    const out = Object.assign({}, m, { id: String(m.id) });
    delete out.latestVitals; delete out.latestCheckin;
    return out;
  }

  function absorbEmbedded(m) {
    const id = String(m.id);
    if (m.latestVitals && !(state.telemetry.get(id) || {}).latest) {
      const v = m.latestVitals;
      setLatest(id, v, v.ts);
    }
    if (m.latestCheckin && !(state.checkins.get(id) || []).length) {
      state.checkins.set(id, [normCheckin(m.latestCheckin, id)]);
    }
  }

  function setCrewList(list) {
    const next = new Map();
    list.forEach(function (m) {
      if (!m || m.id == null) return;
      const id = String(m.id);
      next.set(id, Object.assign({}, state.crew.get(id) || {}, normMember(m)));
      absorbEmbedded(m);
    });
    state.crew = next;
    emit("crew");
  }

  function upsertCrew(m) {
    if (!m || m.id == null) return;
    const id = String(m.id);
    state.crew.set(id, Object.assign({}, state.crew.get(id) || {}, normMember(m)));
    absorbEmbedded(m);
    emit("crew", id);
  }

  function memberName(id) {
    const m = state.crew.get(String(id));
    return m ? (m.name || "Sans nom") : (id != null ? "Badge " + id : "Système");
  }

  /* ---------------- Télémétrie ---------------- */
  function normPoint(v, ts) {
    return Object.assign({}, v, { ts: U.toMs(ts != null ? ts : v.ts) || Date.now() });
  }

  function bucket(id) {
    let t = state.telemetry.get(id);
    if (!t) { t = { latest: null, history: [] }; state.telemetry.set(id, t); }
    return t;
  }

  function setLatest(id, vitals, ts) {
    const t = bucket(String(id));
    t.latest = normPoint(vitals || {}, ts);
  }

  function pushTelemetry(id, vitals, ts) {
    id = String(id);
    const t = bucket(id);
    const p = normPoint(vitals || {}, ts);
    t.latest = p;
    t.history.push(p);
    const max = cfg().HISTORY_MAX_POINTS;
    if (t.history.length > max) t.history.splice(0, t.history.length - max);
    emit("telemetry", id);
  }

  function setTelemetryHistory(id, points) {
    id = String(id);
    const t = bucket(id);
    const hist = points.map(function (p) { return normPoint(p, p.ts); })
      .sort(function (a, b) { return a.ts - b.ts; });
    const lastTs = hist.length ? hist[hist.length - 1].ts : 0;
    // on conserve les points temps réel plus récents que l'historique reçu
    const live = t.history.filter(function (p) { return p.ts > lastTs; });
    t.history = hist.concat(live).slice(-cfg().HISTORY_MAX_POINTS);
    if (t.history.length) t.latest = t.history[t.history.length - 1];
    emit("telemetry", id);
  }

  function isOnline(id) {
    const t = state.telemetry.get(String(id));
    return !!(t && t.latest && Date.now() - t.latest.ts < cfg().ONLINE_TIMEOUT_MS);
  }

  /* ---------------- Check-ins PsychoSpace ---------------- */
  function normCheckin(c, id) {
    return Object.assign({}, c, { crewId: String(c.crewId != null ? c.crewId : id), ts: U.toMs(c.ts) || Date.now() });
  }
  function setCheckins(id, list) {
    id = String(id);
    state.checkins.set(id, list.map(function (c) { return normCheckin(c, id); }).sort(function (a, b) { return a.ts - b.ts; }));
    emit("checkins", id);
  }
  function addCheckin(id, c) {
    id = String(id);
    const arr = state.checkins.get(id) || [];
    const n = normCheckin(c, id);
    if (!arr.some(function (x) { return (x.id != null && x.id === n.id) || x.ts === n.ts; })) arr.push(n);
    arr.sort(function (a, b) { return a.ts - b.ts; });
    state.checkins.set(id, arr);
    emit("checkins", id);
  }
  function lastCheckin(id) {
    const arr = state.checkins.get(String(id)) || [];
    return arr.length ? arr[arr.length - 1] : null;
  }

  /* ---------------- IA : analyses & recommandations ---------------- */
  function setDiagnostics(id, list) {
    id = String(id);
    state.diagnostics.set(id, list.map(function (d) { return Object.assign({}, d, { ts: U.toMs(d.ts) || Date.now() }); })
      .sort(function (a, b) { return b.ts - a.ts; }));
    emit("diagnostics", id);
  }
  function addDiagnostic(id, d) {
    id = String(id);
    const arr = state.diagnostics.get(id) || [];
    arr.unshift(Object.assign({}, d, { ts: U.toMs(d.ts) || Date.now() }));
    state.diagnostics.set(id, arr.slice(0, 50));
    emit("diagnostics", id);
  }
  function setRecommendations(id, list) {
    state.recommendations.set(String(id), list);
    emit("recommendations", String(id));
  }

  /* ---------------- Chat ---------------- */
  function setChat(id, list) { state.chats.set(String(id), list); emit("chat", String(id)); }
  function addChat(id, msg) {
    id = String(id);
    const arr = state.chats.get(id) || [];
    arr.push(Object.assign({ ts: Date.now() }, msg));
    state.chats.set(id, arr);
    emit("chat", id);
  }

  /* ---------------- Alertes & flux ---------------- */
  function normAlert(a) {
    return Object.assign({}, a, { id: a.id != null ? a.id : U.uid(), ts: U.toMs(a.ts) || Date.now() });
  }
  function setAlerts(list) {
    state.alerts = list.map(normAlert).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 200);
    emit("alerts");
  }
  function addAlert(a) {
    const n = normAlert(a);
    if (state.alerts.some(function (x) { return x.id === n.id; })) return;
    state.alerts.unshift(n);
    state.alerts = state.alerts.slice(0, 200);
    emit("alerts");
  }
  function addFeed(msg) {
    state.feed.unshift({ at: Date.now(), msg: msg });
    if (state.feed.length > 80) state.feed.length = 80;
    state.conn.lastMessageAt = Date.now();
    emit("feed");
  }

  /* ---------------- Crise ---------------- */
  function setCrisis(c) {
    const prev = state.crisis.active;
    state.crisis = Object.assign({}, state.crisis, c);
    emit("crisis", { changed: prev !== state.crisis.active });
  }

  function contaminationRate() {
    if (state.crisis.active && state.crisis.rate != null) return state.crisis.rate;
    const total = state.crew.size;
    if (!total) return null;
    let n = 0;
    state.crew.forEach(function (m) { if (m.contaminated) n++; });
    return n / total;
  }

  /* ---------------- Connexion ---------------- */
  function setConn(key, value) {
    if (state.conn[key] === value) return;
    state.conn[key] = value;
    emit("conn");
  }

  /* ---------------- Niveau de santé ---------------- */
  // Priorité : contamination > niveau fourni par le serveur > calcul local de secours.
  function levelOf(id) {
    id = String(id);
    const m = state.crew.get(id);
    if (!m) return null;
    if (m.contaminated) return "r";
    const server = U.normLevel(m.healthLevel);
    if (server) return server;
    const t = state.telemetry.get(id);
    const force = U.num(t && t.latest ? t.latest.force : null);
    const ck = lastCheckin(id);
    const stress = U.num(ck ? ck.stress : null);
    const vals = [force, stress].filter(function (v) { return v != null; });
    if (!vals.length) return null;
    return Math.max.apply(null, vals) >= cfg().ANXIETY_THRESHOLD ? "o" : "g";
  }

  return {
    state: state, on: on, emit: emit,
    setCrewList: setCrewList, upsertCrew: upsertCrew, memberName: memberName,
    pushTelemetry: pushTelemetry, setTelemetryHistory: setTelemetryHistory, isOnline: isOnline,
    setCheckins: setCheckins, addCheckin: addCheckin, lastCheckin: lastCheckin,
    setDiagnostics: setDiagnostics, addDiagnostic: addDiagnostic, setRecommendations: setRecommendations,
    setChat: setChat, addChat: addChat,
    setAlerts: setAlerts, addAlert: addAlert, addFeed: addFeed,
    setCrisis: setCrisis, contaminationRate: contaminationRate,
    setConn: setConn, levelOf: levelOf
  };
})();
