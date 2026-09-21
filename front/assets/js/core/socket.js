/* ==========================================================================
   Horizon Health OS — socket.js
   Flux temps réel : le Back-End relaie les messages MQTT des Bio-Badges
   Astro-Link vers ce WebSocket. Reconnexion automatique en cas de coupure.
   Format des messages : voir docs/API_CONTRACT.md (section WebSocket).
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.socket = (function () {
  "use strict";
  const S = HHO.store;
  let ws = null;
  let retries = 0;
  let timer = null;

  function connect() {
    clearTimeout(timer);
    const url = HHO.config.get().WS_URL;
    if (!url) return;

    let sock;
    try { sock = new WebSocket(url); }
    catch (e) { S.setConn("ws", "offline"); schedule(); return; }

    ws = sock;
    S.setConn("ws", "connecting");

    sock.onopen = function () {
      if (sock !== ws) return;
      retries = 0;
      S.setConn("ws", "online");
    };
    sock.onmessage = function (evt) {
      if (sock !== ws) return;
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (Array.isArray(msg)) msg.forEach(dispatch); else dispatch(msg);
    };
    sock.onclose = function () {
      if (sock !== ws) return;          // ancienne connexion remplacée
      S.setConn("ws", "offline");
      schedule();
    };
    sock.onerror = function () { /* onclose suit toujours */ };
  }

  function schedule() {
    clearTimeout(timer);
    const base = HHO.config.get().RECONNECT_DELAY_MS;
    const delay = Math.min(30000, base * Math.pow(1.6, retries++));
    timer = setTimeout(connect, delay);
  }

  function reconnect() {
    retries = 0;
    const old = ws;
    ws = null;                           // neutralise les handlers de l'ancienne
    if (old) { try { old.close(); } catch (e) { /* ignore */ } }
    connect();
  }

  function send(obj) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  function dispatch(msg) {
    if (!msg || typeof msg !== "object") return;
    S.addFeed(msg);
    const id = msg.crewId != null ? String(msg.crewId) : null;

    switch (msg.type) {
      case "telemetry":
        if (id == null) return;
        if (!S.state.crew.has(id) && HHO.app) HHO.app.refreshCrew();
        S.pushTelemetry(id, msg.vitals || {}, msg.ts);
        if (msg.contaminated !== undefined || msg.healthLevel !== undefined) {
          const patch = { id: id };
          if (msg.contaminated !== undefined) patch.contaminated = !!msg.contaminated;
          if (msg.healthLevel !== undefined) patch.healthLevel = msg.healthLevel;
          S.upsertCrew(patch);
        }
        break;

      case "crew_list":
        S.setCrewList(HHO.util.asArray(msg.crew));
        break;

      case "crew_update":
        if (msg.crew) S.upsertCrew(msg.crew);
        break;

      case "checkin":
        if (id != null && msg.checkin) S.addCheckin(id, msg.checkin);
        break;

      case "diagnostic":
        if (id != null && msg.diagnostic) S.addDiagnostic(id, msg.diagnostic);
        break;

      case "recommendations":
        if (id != null) S.setRecommendations(id, HHO.util.asArray(msg.items));
        break;

      case "alert":
        S.addAlert(msg.alert || msg);
        if (HHO.audio) HHO.audio.notify(msg.level || (msg.alert && msg.alert.level));
        break;

      case "crisis":
        S.setCrisis({
          active: true,
          rate: HHO.util.num(msg.contaminationRate),
          triage: HHO.util.asArray(msg.triage),
          since: HHO.util.toMs(msg.since || msg.ts) || Date.now()
        });
        break;

      case "crisis_resolved":
        S.setCrisis({ active: false, triage: [], resolvedBy: msg.by || null });
        break;

      case "hall_sensor":
        S.emit("hall", msg);
        break;

      default:
        // type inconnu : conservé dans le flux temps réel pour le débogage
        break;
    }
  }

  return { connect: connect, reconnect: reconnect, send: send, dispatch: dispatch };
})();
