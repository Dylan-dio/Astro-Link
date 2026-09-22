/* ==========================================================================
   Horizon Health OS — views/home.js
   Écran d'accueil de la console holographique :
     - Santé : hologramme du corps de l'astronaute suivi + constantes
     - Bio-Badge : posture, LED, signal, contamination
     - État de l'équipage : bandeau d'indicateurs globaux
     - Statut de l'astronaute : dossier résumé + courbe d'anxiété
     - Priorités médicales : triage de l'équipage
     - Notifications : alertes du serveur et de l'IA
   Aucune donnée en dur : tout provient du store (serveur central).
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.home = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, C = HHO.charts, UI = HHO.ui;
  const KEY = "hho.focus";
  const dismissed = new Set();
  let focus = null;

  /* Icônes au trait (SVG maison) */
  const I = {
    gauge: '<svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/></svg>',
    ecg: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-4 3 9 2-5h7"/></svg>',
    temp: '<svg viewBox="0 0 24 24"><path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/></svg>',
    crew: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 19c.8-3 3.2-5 6-5s5.2 2 6 5"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14c2.4 0 4.3 1.6 5 4"/></svg>',
    bio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><path d="M12 3.5a4 4 0 0 1 2.2 7.3M12 3.5a4 4 0 0 0-2.2 7.3M4.6 16.3a4 4 0 0 1 5.2-5M4.6 16.3a4 4 0 0 0 6.2 2.4M19.4 16.3a4 4 0 0 0-5.2-5M19.4 16.3a4 4 0 0 1-6.2 2.4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="13" r="1.5"/><path d="M12 15v5"/></svg>',
    posture: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M8 10h8M12 14l-3 6M12 14l3 6"/></svg>',
    led: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="5"/><path d="M10 15v5M14 15v5"/></svg>',
    signal: '<svg viewBox="0 0 24 24"><path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'
  };

  function active() { return HHO.nav.current() === "home"; }
  function crewArr() { return Array.from(S.state.crew.values()); }
  function member() { return focus ? S.state.crew.get(focus) : null; }

  const renderAll = U.throttle(function () {
    updateDock();
    if (!active()) return;
    health(); badge(); env(); status(); prio(); notif();
  }, 400);

  function init() {
    try { focus = localStorage.getItem(KEY) || null; } catch (e) { focus = null; }

    ["crew", "telemetry", "checkins", "alerts", "crisis", "conn", "resize"].forEach(function (e) { S.on(e, renderAll); });
    S.on("crew", focusOptions);

    U.$("#focusWho").addEventListener("change", function (e) { setFocus(e.target.value || null); });
    U.$("#hOpenFile").addEventListener("click", function () { if (focus) HHO.nav.go("crew", focus); });
    U.$("#hPrio").addEventListener("click", function (e) {
      const b = e.target.closest("[data-focus]");
      if (b) setFocus(b.dataset.focus);
    });
    U.$("#hNotif").addEventListener("click", function (e) {
      const b = e.target.closest("[data-dismiss]");
      if (b) { dismissed.add(b.dataset.dismiss); renderAll(); }
    });

    HHO.nav.register("home", function () { focusOptions(); renderAll(); load(); });
    setInterval(function () { if (active()) renderAll(); }, 5000);
    focusOptions();
  }

  /* ---------------- Astronaute suivi ---------------- */
  function focusOptions() {
    const sel = U.$("#focusWho");
    const crew = crewArr();
    sel.innerHTML = crew.length
      ? crew.map(function (m) { return '<option value="' + U.esc(m.id) + '"' + (m.id === focus ? " selected" : "") + ">" + U.esc(m.name || m.id) + "</option>"; }).join("")
      : '<option value="">Aucun astronaute</option>';
    sel.disabled = !crew.length;
    ensureFocus();
  }

  function ensureFocus() {
    if (focus && S.state.crew.has(focus)) return;
    const crew = crewArr();
    if (!crew.length) return;
    const pick = crew.find(function (m) { return m.isRealBadge; }) || crew[0];
    setFocus(pick.id);
  }

  function setFocus(id) {
    focus = id ? String(id) : null;
    try { if (focus) localStorage.setItem(KEY, focus); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    focusOptions();
    renderAll();
    load();
  }

  async function load() {
    const id = focus;
    if (!id) return;
    const r = await Promise.allSettled([HHO.api.getTelemetry(id), HHO.api.getCheckins(id)]);
    if (id !== focus) return;
    if (r[0].status === "fulfilled") S.setTelemetryHistory(id, U.asArray(r[0].value, "points"));
    if (r[1].status === "fulfilled") S.setCheckins(id, U.asArray(r[1].value, "checkins"));
  }

  /* ---------------- Santé : hologramme du corps ---------------- */
  function bodySVG() {
    let ribs = "";
    for (let y = 104; y <= 168; y += 13) {
      ribs += '<path d="M100 ' + y + "Q82 " + (y + 1) + " 72 " + (y + 11) + '"/><path d="M100 ' + y + "Q118 " + (y + 1) + " 128 " + (y + 11) + '"/>';
    }
    return '<svg class="holo-body" viewBox="0 0 200 440" aria-hidden="true">' +
      '<defs><linearGradient id="hbFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".3"/><stop offset="1" stop-color="currentColor" stop-opacity=".05"/></linearGradient></defs>' +
      '<g class="hb-shell" fill="url(#hbFill)" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">' +
      '<ellipse cx="100" cy="40" rx="21" ry="26"/>' +
      '<path d="M92 64h16v14H92z"/>' +
      '<path d="M70 82Q100 74 130 82L146 92Q152 140 138 150L128 196Q134 222 130 236H70Q66 222 72 196L62 150Q48 140 54 92Z"/>' +
      '<path d="M54 94Q42 102 40 140L33 200L28 252L39 254L45 204L57 152Z"/>' +
      '<path d="M146 94Q158 102 160 140L167 200L172 252L161 254L155 204L143 152Z"/>' +
      '<path d="M72 238H98L97 330L95 424H79L76 330Z"/>' +
      '<path d="M128 238H102L103 330L105 424H121L124 330Z"/>' +
      "</g>" +
      '<g class="hb-bones" fill="none" stroke="currentColor" stroke-width=".9">' +
      '<path d="M100 70V228"/>' + ribs +
      '<path d="M72 90Q86 85 100 88Q114 85 128 90"/>' +
      '<path d="M78 212Q100 240 122 212"/>' +
      '<path d="M86 242V330M114 242V330M86 336V416M114 336V416"/>' +
      '<path d="M50 100L42 198M150 100L158 198M40 204L34 248M160 204L166 248"/>' +
      '<path d="M90 36h8M102 36h8M94 52h12"/>' +
      "</g>" +
      '<circle class="hb-badge" cx="116" cy="120" r="4.5"/>' +
      '<circle class="hb-badge-ring" cx="116" cy="120" r="9"/>' +
      "</svg>";
  }

  function vital(icon, value, label, warn) {
    return '<div class="vital' + (warn ? " warn" : "") + '"><div class="v-ico">' + I[icon] + "</div>" +
      "<b>" + (value == null ? "—" : U.esc(value)) + "</b><span>" + label + "</span></div>";
  }

  function health() {
    const m = member();
    const el = U.$("#hHealth");
    U.$("#hHealthName").textContent = m ? (m.name || m.id) : "—";
    if (!m) {
      el.className = "health-body is-empty";
      el.innerHTML = UI.emptyHTML("Aucun astronaute suivi",
        S.state.crew.size ? "Choisissez un astronaute en haut de l'écran." : "Les profils apparaîtront dès que le serveur central les transmettra.");
      return;
    }
    const t = S.state.telemetry.get(m.id);
    const v = t ? t.latest : null;
    const lvl = S.levelOf(m.id);
    const thr = HHO.config.get().ANXIETY_THRESHOLD;
    const force = U.num(v && v.force), hr = U.num(v && v.heartRate), temp = U.num(v && v.temperature);
    const segs = 20;
    const on = force == null ? 0 : Math.round(U.clamp(force, 0, 100) / 100 * segs);

    el.className = "health-body";
    el.innerHTML =
      '<div class="vitals-col">' +
      vital("gauge", force == null ? null : Math.round(force) + " %", "Anxiété", force != null && force >= thr) +
      vital("ecg", hr == null ? null : Math.round(hr) + " bpm", "Rythme") +
      vital("temp", temp == null ? null : temp.toFixed(1) + " °C", "Température", temp != null && temp >= 38) +
      "</div>" +
      '<div class="body-holo lvl-' + (lvl || "n") + '">' + bodySVG() + '<div class="hb-scan"></div>' +
      '<div class="hb-caption">' + (v ? UI.levelPill(lvl) : '<span class="faint">Badge non détecté</span>') + "</div></div>" +
      '<div class="seg-wrap"><div class="seg-scale" aria-label="Jauge d\'anxiété">' +
      Array.from({ length: segs }, function (_, i) { return '<i class="' + (i < on ? "on" + (force >= thr ? " warn" : "") : "") + '"></i>'; }).join("") +
      "</div><span>Force</span></div>";
  }

  /* ---------------- Bio-Badge ---------------- */
  function cell(icon, valueHTML, label) {
    return '<div class="bcell"><span class="ico">' + I[icon] + "</span><div><b>" + valueHTML + "</b><span>" + label + "</span></div></div>";
  }

  function badge() {
    const m = member();
    const el = U.$("#hBadge");
    U.$("#hBadgeId").textContent = m && m.badgeId ? m.badgeId : "—";
    if (!m) { el.innerHTML = UI.emptyHTML("Aucun badge", "Sélectionnez un astronaute."); return; }
    const t = S.state.telemetry.get(m.id);
    const v = t ? t.latest : null;
    const lvl = S.levelOf(m.id);
    const tilt = U.tiltOf(v);
    const ledName = { g: "Verte", o: "Orange", r: "Rouge" }[lvl] || "Éteinte";
    const ledCls = { g: "ok-text", o: "warn-text", r: "bad-text" }[lvl] || "faint";
    el.innerHTML = '<div class="badge-cells">' +
      cell("posture", tilt ? (tilt === "repos" ? "Repos" : "Actif") : "—", "Posture") +
      cell("led", '<span class="' + ledCls + '">' + ledName + "</span>", "LED du badge") +
      cell("signal", '<span class="' + (S.isOnline(m.id) ? "ok-text" : "") + '">' + (v ? U.fmtAgo(v.ts) : "Aucun") + "</span>", "Signal") +
      cell("shield", m.contaminated ? '<span class="bad-text">Contaminé</span>' : "Non", "Contamination") +
      "</div>" +
      (t && t.history.length ? '<p class="field-hint bc-ratio-lbl">Ratio repos / activité</p>' + UI.ratioHTML(t.history) : "");
  }

  /* ---------------- État de l'équipage ---------------- */
  function envCell(icon, label, value, cls) {
    return '<div class="env-cell"><span class="env-lbl">' + label + '</span><span class="ico">' + I[icon] + '</span><b class="' + (cls || "") + '">' + U.esc(value) + "</b></div>";
  }

  function env() {
    const crew = crewArr();
    const cfg = HHO.config.get();
    const online = crew.filter(function (m) { return S.isOnline(m.id); }).length;
    const rate = S.contaminationRate();
    const day = S.state.alerts.filter(function (a) { return Date.now() - a.ts < 864e5; }).length;
    const forces = crew.map(function (m) {
      const t = S.state.telemetry.get(m.id);
      return t && t.latest ? U.num(t.latest.force) : null;
    }).filter(function (v) { return v != null; });
    const avg = forces.length ? Math.round(forces.reduce(function (a, b) { return a + b; }, 0) / forces.length) : null;
    const ws = S.state.conn.ws;

    U.$("#hEnv").innerHTML =
      envCell("crew", "Équipage", crew.length ? online + " / " + crew.length : "—") +
      envCell("bio", "Contamination", rate == null ? "—" : Math.round(rate * 100) + " %",
        rate != null && rate >= cfg.CONTAMINATION_THRESHOLD ? "bad" : (rate > 0 ? "warn" : "")) +
      envCell("bell", "Alertes 24 h", S.state.conn.api === "online" || day ? String(day) : "—", day ? "warn" : "") +
      envCell("gauge", "Anxiété moy.", avg == null ? "—" : avg + " %", avg != null && avg >= cfg.ANXIETY_THRESHOLD ? "warn" : "") +
      envCell("link", "Liaison", ws === "online" ? "Active" : (ws === "connecting" ? "Connexion" : "Coupée"), ws === "online" ? "ok" : "bad");
  }

  /* ---------------- Statut de l'astronaute ---------------- */
  function status() {
    const m = member();
    const list = U.$("#hStatusList"), chart = U.$("#hStatusChart"), rings = U.$("#hMiniRings");
    U.$("#hOpenFile").disabled = !m;
    if (!m) {
      U.$("#hStatusTag").textContent = "—";
      list.innerHTML = "";
      rings.innerHTML = "";
      chart.innerHTML = UI.emptyHTML("Aucun astronaute suivi", "");
      return;
    }
    const lvl = S.levelOf(m.id);
    const ck = S.lastCheckin(m.id);
    const t = S.state.telemetry.get(m.id);
    U.$("#hStatusTag").textContent = m.badgeId || "";

    const allergies = Array.isArray(m.allergies) ? (m.allergies.length ? m.allergies.join(", ") : "Aucune") : m.allergies;
    const rows = [
      ["Astronaute", m.name],
      ["Rôle", m.role],
      ["Groupe sanguin", m.bloodType],
      ["Allergies", allergies],
      ["Dernier check-in", ck ? U.fmtAgo(ck.ts) : null]
    ];
    list.innerHTML = rows.map(function (r) {
      const empty = r[1] == null || r[1] === "";
      return "<div><dt>" + r[0] + '</dt><dd class="' + (empty ? "na" : "") + '">' + U.esc(empty ? "Non renseigné" : r[1]) + "</dd></div>";
    }).join("") + '<div><dt>État</dt><dd class="lvl-' + (lvl || "n") + '">' + U.esc(U.levelInfo(lvl).label) + "</dd></div>";

    C.line(chart, [{
      name: "Anxiété",
      color: lvl === "r" ? "#FF4D5A" : (lvl === "o" ? "#F2B34B" : "#5EE7F2"),
      points: (t ? t.history : []).map(function (p) { return { ts: p.ts, value: p.force }; })
    }], {
      height: 210, min: 0, max: 100,
      threshold: { value: HHO.config.get().ANXIETY_THRESHOLD, label: "Seuil d'anxiété" },
      emptyTitle: "Aucune mesure du capteur de force",
      emptyHint: "La courbe apparaîtra dès les premières données du Bio-Badge.",
      ariaLabel: "Anxiété de l'astronaute suivi"
    });

    const defs = [["humeur", "Humeur"], ["sommeil", "Sommeil"], ["energie", "Énergie"]];
    rings.innerHTML = defs.map(function (d) { return '<div id="hr-' + d[0] + '"></div>'; }).join("");
    defs.forEach(function (d) {
      let v = null;
      if (ck) {
        if (d[0] === "energie") { const f = U.num(ck.fatigue); v = f == null ? null : 100 - f; }
        else v = U.num(ck[d[0]]);
      }
      C.ring(U.$("#hr-" + d[0]), v, { size: 60, stroke: 5, unit: "%", label: d[1], color: v != null && v < 40 ? "var(--orange)" : null });
    });
  }

  /* ---------------- Priorités médicales ---------------- */
  function prio() {
    const crew = crewArr();
    const el = U.$("#hPrio");
    if (!crew.length) { el.innerHTML = UI.emptyHTML("Aucune priorité", "Le triage démarrera à la réception des profils."); return; }
    const thr = HHO.config.get().ANXIETY_THRESHOLD;
    const rank = function (m) { const l = S.levelOf(m.id); return m.contaminated ? 1 : (l === "o" ? 2 : (l === "g" ? 3 : 4)); };
    const rows = crew.slice().sort(function (a, b) { return rank(a) - rank(b); });

    el.innerHTML = '<ul class="prio-list">' + rows.map(function (m) {
      const r = rank(m);
      const t = S.state.telemetry.get(m.id);
      const v = t ? t.latest : null;
      const ck = S.lastCheckin(m.id);
      const subs = [];
      if (m.contaminated) subs.push("Isolement et suivi de la température");
      if (v && U.num(v.force) != null && v.force >= thr) subs.push("Anxiété élevée : " + Math.round(v.force) + " %");
      if (ck && U.num(ck.stress) != null && ck.stress >= thr) subs.push("Stress déclaré : " + Math.round(ck.stress) + " %");
      if (v && U.num(v.temperature) != null && v.temperature >= 38) subs.push("Température : " + v.temperature + " °C");
      if (!v) subs.push("Aucun signal du Bio-Badge");
      if (!subs.length) subs.push("Constantes nominales");
      return '<li class="prio-item p' + r + (m.id === focus ? " active" : "") + '"><button data-focus="' + U.esc(m.id) + '">' +
        '<span class="p-dot"></span><span class="p-txt"><b>' + U.esc(m.name || m.id) + "</b>" +
        subs.map(function (s) { return '<span class="p-sub">' + U.esc(s) + "</span>"; }).join("") +
        "</span></button></li>";
    }).join("") + "</ul>";
  }

  /* ---------------- Notifications ---------------- */
  function notif() {
    const el = U.$("#hNotif");
    const list = S.state.alerts.filter(function (a) { return !dismissed.has(String(a.id)); }).slice(0, 8);
    U.$("#hNotifCount").textContent = list.length ? list.length + (list.length > 1 ? " actives" : " active") : "Aucune";
    if (!list.length) { el.innerHTML = UI.emptyHTML("Aucune notification", "Les alertes du serveur et de l'IA apparaîtront ici."); return; }
    el.innerHTML = '<div class="notif-list">' + list.map(function (a) {
      const lvl = String(a.level || "info").toLowerCase();
      return '<div class="notif n-' + U.esc(lvl) + '"><span class="ico">' + (lvl === "info" ? I.info : I.warn) + "</span>" +
        '<div class="n-txt"><b>' + U.esc(a.message || "Alerte") + "</b><span><span>" + U.esc(a.crewId != null ? S.memberName(a.crewId) : "Système") +
        "</span><span>" + U.fmtAgo(a.ts) + "</span></span></div>" +
        '<button class="n-close" data-dismiss="' + U.esc(String(a.id)) + '" aria-label="Masquer la notification">' + I.close + "</button></div>";
    }).join("") + "</div>";
  }

  /* ---------------- Pastilles du dock ---------------- */
  function badgeNum(sel, n) {
    const b = U.$(sel);
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 9 ? "9+" : String(n);
  }
  function updateDock() {
    badgeNum("#dockBadgeHome", S.state.alerts.filter(function (a) { return !dismissed.has(String(a.id)) && Date.now() - a.ts < 864e5; }).length);
    let c = 0;
    S.state.crew.forEach(function (m) { if (m.contaminated) c++; });
    badgeNum("#dockBadgeCrew", c);
  }

  return { init: init, focus: function () { return focus; } };
})();
