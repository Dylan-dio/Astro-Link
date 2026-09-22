/* ==========================================================================
   Horizon Health OS — views/settings.js
   Paramètres de connexion au serveur central et préférences d'affichage.
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.settings = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, UI = HHO.ui;

  function active() { return HHO.nav.current() === "settings"; }

  function init() {
    fill();
    U.$("#setSave").addEventListener("click", save);
    U.$("#setTest").addEventListener("click", test);
    U.$("#setReset").addEventListener("click", function () {
      HHO.config.reset(); fill(); applyConnection();
      UI.toast("Paramètres réinitialisés.", "success");
    });
    U.$("#setSound").addEventListener("change", function (e) {
      HHO.config.save({ SOUND: e.target.checked });
      if (!e.target.checked) HHO.audio.stopAlarm();
      else if (S.state.crisis.active) HHO.audio.startAlarm();
    });
    U.$("#setAuth").addEventListener("change", function (e) {
      HHO.config.save({ REQUIRE_AUTH: e.target.checked });
      if (!e.target.checked) HHO.auth.logout();
    });
    U.$("#setTestAlarm").addEventListener("click", function () { HHO.audio.testAlarm(); });

    S.on("conn", function () { if (active()) sys(); });
    S.on("crew", function () { if (active()) sys(); });
    HHO.nav.register("settings", function () { fill(); sys(); });
    setInterval(function () { if (active()) sys(); }, 3000);
  }

  function fill() {
    const c = HHO.config.get();
    U.$("#setApi").value = c.API_BASE;
    U.$("#setWs").value = c.WS_URL;
    U.$("#setSound").checked = !!c.SOUND;
    U.$("#setAuth").checked = !!c.REQUIRE_AUTH;
  }

  function applyConnection() {
    HHO.socket.reconnect();
    HHO.app.refreshAll();
  }

  function save() {
    const api = U.$("#setApi").value.trim();
    const ws = U.$("#setWs").value.trim();
    const res = U.$("#setResult");
    if (!/^https?:\/\//i.test(api)) { res.className = "form-status bad-text"; res.textContent = "L'adresse de l'API doit commencer par http:// ou https://"; return; }
    if (!/^wss?:\/\//i.test(ws)) { res.className = "form-status bad-text"; res.textContent = "L'adresse temps réel doit commencer par ws:// ou wss://"; return; }
    HHO.config.save({ API_BASE: api.replace(/\/+$/, ""), WS_URL: ws });
    res.className = "form-status ok-text";
    res.textContent = "Paramètres enregistrés — reconnexion en cours.";
    applyConnection();
  }

  async function test() {
    const res = U.$("#setResult");
    res.className = "form-status muted";
    res.textContent = "Test de l'API en cours…";
    const prev = HHO.config.get().API_BASE;
    HHO.config.get().API_BASE = U.$("#setApi").value.trim().replace(/\/+$/, "");   // test sans sauvegarder
    const t0 = performance.now();
    try {
      const h = await HHO.api.health();
      const ms = Math.round(performance.now() - t0);
      res.className = "form-status ok-text";
      res.textContent = "Serveur joignable (" + ms + " ms)" + (h && h.version ? " — version " + h.version : "") + (h && h.ollama ? " — IA : " + h.ollama : "") + ".";
    } catch (e) {
      res.className = "form-status bad-text";
      res.textContent = e.status ? "Le serveur répond mais /api/health renvoie " + e.status + "." : "Serveur injoignable à cette adresse.";
    } finally {
      HHO.config.get().API_BASE = prev;
    }
  }

  function connLabel(v) {
    return { online: "Connecté", offline: "Hors ligne", connecting: "Connexion…", unknown: "Non testé" }[v] || v;
  }

  function sys() {
    const c = HHO.config.get();
    const rows = [
      ["Version de l'interface", c.VERSION],
      ["API REST", connLabel(S.state.conn.api)],
      ["Liaison temps réel", connLabel(S.state.conn.ws)],
      ["Dernier message reçu", S.state.conn.lastMessageAt ? U.fmtAgo(S.state.conn.lastMessageAt) : "aucun"],
      ["Profils chargés", String(S.state.crew.size)],
      ["Seuil de quarantaine", Math.round(c.CONTAMINATION_THRESHOLD * 100) + " %"],
      ["Seuil de stress", c.ANXIETY_THRESHOLD + " %"],
      ["Mode de fonctionnement", "100 % hors-ligne — aucune ressource externe"]
    ];
    U.$("#sysInfo").innerHTML = rows.map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + U.esc(r[1]) + "</dd></div>"; }).join("");
  }

  return { init: init };
})();

/* ==========================================================================
   Mode Crise — protocole de quarantaine automatique
   Déclenché UNIQUEMENT par le serveur (message WebSocket "crisis" ou
   GET /api/crisis). Levé par le passage de la clé aimantée du médecin sur
   le capteur à effet Hall d'un badge ("hall_sensor" puis "crisis_resolved"),
   ou en secours par l'acquittement manuel.
   ========================================================================== */
HHO.crisis = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, UI = HHO.ui;
  let minimized = false;
  let hallTimer = null;

  function init() {
    S.on("crisis", update);
    S.on("crew", function () { if (S.state.crisis.active) render(); });
    S.on("hall", onHall);
    U.$("#crisisMinimize").addEventListener("click", function () { minimized = true; update(); });
    U.$("#crisisReopen").addEventListener("click", function () { minimized = false; update(); });
    UI.holdButton(U.$("#crisisOverride"), U.$("#crisisOverrideFill"), HHO.config.get().HOLD_TO_CONFIRM_MS, acknowledge);
  }

  function update(evt) {
    const c = S.state.crisis;
    document.body.classList.toggle("crisis", !!c.active);
    if (c.active) {
      if (evt && evt.changed) { minimized = false; UI.toast("Seuil de contamination atteint : protocole de quarantaine engagé.", "error"); }
      render();
      U.$("#crisisModal").hidden = minimized;
      U.$("#crisisBanner").hidden = !minimized;
      HHO.audio.startAlarm();
    } else {
      U.$("#crisisModal").hidden = true;
      U.$("#crisisBanner").hidden = true;
      HHO.audio.stopAlarm();
      if (evt && evt.changed) {
        HHO.audio.chime();
        UI.toast(c.resolvedBy === "hall_sensor" ? "Alarme acquittée par la clé du médecin. Quarantaine levée." : "Protocole de quarantaine levé.", "success");
      }
      minimized = false;
    }
  }

  function computedTriage() {
    return Array.from(S.state.crew.values()).map(function (m) {
      const lvl = S.levelOf(m.id);
      return {
        crewId: m.id,
        priority: m.contaminated ? 1 : (lvl === "o" ? 2 : 3),
        reason: m.contaminated ? "Contamination déclarée" : (lvl === "o" ? "Stress élevé — surveillance rapprochée" : "Constantes nominales")
      };
    }).sort(function (a, b) { return a.priority - b.priority; });
  }

  function render() {
    const c = S.state.crisis;
    const cfg = HHO.config.get();
    const rate = S.contaminationRate();
    const contaminated = Array.from(S.state.crew.values()).filter(function (m) { return m.contaminated; }).length;

    U.$("#crisisRate").textContent = rate == null ? "—" : Math.round(rate * 100) + " %";
    U.$("#crisisCount").textContent = String(contaminated);
    U.$("#crisisThreshold").textContent = Math.round(cfg.CONTAMINATION_THRESHOLD * 100) + " %";
    U.$("#crisisSince").textContent = c.since ? "Depuis " + U.fmtTimeS(c.since) : "";
    U.$("#crisisBannerTxt").textContent = "Quarantaine en cours — " + contaminated + " membre" + (contaminated > 1 ? "s" : "") + " contaminé" + (contaminated > 1 ? "s" : "") + " — en attente de la clé du médecin";

    const triage = (c.triage && c.triage.length) ? c.triage : computedTriage();
    const body = U.$("#triageBody");
    if (!triage.length) {
      body.innerHTML = '<tr><td colspan="4" class="t-reason">Triage en attente des données de l\'équipage.</td></tr>';
      return;
    }
    body.innerHTML = triage.slice().sort(function (a, b) { return (a.priority || 9) - (b.priority || 9); }).map(function (t) {
      const p = Math.max(1, Math.min(3, parseInt(t.priority, 10) || 3));
      const label = { 1: "P1 — Immédiat", 2: "P2 — Sous 30 min", 3: "P3 — Surveillance" }[p];
      const m = S.state.crew.get(String(t.crewId));
      return "<tr><td><span class=\"sev p" + p + "\">" + label + "</span></td><td>" + U.esc(S.memberName(t.crewId)) + "</td>" +
        '<td class="t-reason">' + U.esc(t.reason || "") + "</td><td>" + (m && m.contaminated ? '<span class="bad-text">Contaminé</span>' : U.esc(U.levelInfo(S.levelOf(t.crewId)).label)) + "</td></tr>";
    }).join("");
  }

  function onHall(msg) {
    const box = U.$("#hallWait");
    box.classList.add("detected");
    U.$("#hallTitle").textContent = "Clé du médecin détectée";
    U.$("#hallText").textContent = "Capteur magnétique du badge de " + S.memberName(msg.crewId) + " — acquittement en cours…";
    clearTimeout(hallTimer);
    hallTimer = setTimeout(resetHall, 4000);
  }

  function resetHall() {
    U.$("#hallWait").classList.remove("detected");
    U.$("#hallTitle").textContent = "En attente de la clé du médecin";
    U.$("#hallText").textContent = "Passez la clé aimantée sur le capteur magnétique d'un Bio-Badge contaminé pour acquitter l'alarme.";
  }

  async function acknowledge() {
    try {
      await HHO.api.acknowledgeCrisis();
      S.setCrisis({ active: false, triage: [], resolvedBy: "manual_override" });
    } catch (e) {
      UI.toast(e.status ? "Acquittement refusé par le serveur (" + e.status + ")." : "Serveur injoignable : acquittement impossible. Utilisez la clé aimantée sur le badge.", "error");
    }
  }

  return { init: init };
})();
