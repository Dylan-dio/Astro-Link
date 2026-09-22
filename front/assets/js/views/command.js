/* ==========================================================================
   Horizon Health OS — views/command.js
   Vue Médecin "Command Center" : supervision globale de l'équipage.
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.command = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, C = HHO.charts, UI = HHO.ui;

  // Axes du radar : plus la surface est grande, plus le risque psychologique est élevé.
  const RADAR_AXES = [
    { key: "stress", label: "Stress" },
    { key: "fatigue", label: "Fatigue" },
    { key: "isolement", label: "Isolement" },
    { key: "moral", label: "Moral bas" },
    { key: "sommeil", label: "Sommeil bas" }
  ];

  function active() { return HHO.nav.current() === "command"; }
  function crewArr() { return Array.from(S.state.crew.values()); }

  const renderMain = U.throttle(function () {
    if (!active()) return;
    kpis(); matrix(); radar(); heartChart();
  }, 300);
  const renderFeed = U.throttle(function () { if (active()) feed(); }, 300);

  function init() {
    ["crew", "telemetry", "checkins", "crisis", "resize"].forEach(function (e) { S.on(e, renderMain); });
    S.on("alerts", function () { if (active()) { alerts(); kpis(); } });
    S.on("feed", renderFeed);
    U.$("#crewMatrix").addEventListener("click", onMatrixClick);
    HHO.nav.register("command", function () { renderMain(); alerts(); feed(); });
    setInterval(function () { if (active()) { renderMain(); alerts(); } }, 5000); // rafraîchit les "il y a…"
  }

  /* ---------------- Indicateurs clés ---------------- */
  function kpis() {
    const crew = crewArr();
    const cfg = HHO.config.get();
    const thr = Math.round(cfg.CONTAMINATION_THRESHOLD * 100);
    U.$("#kpiThreshold").textContent = thr + " %";

    // Équipage connecté
    if (!crew.length) {
      U.$("#kpiCrew").textContent = "—";
      U.$("#kpiCrewSub").textContent = "Aucun profil reçu du serveur";
    } else {
      const online = crew.filter(function (m) { return S.isOnline(m.id); }).length;
      U.$("#kpiCrew").textContent = online + " / " + crew.length;
      U.$("#kpiCrewSub").textContent = online ? "Bio-Badges émettant actuellement" : "Aucun badge n'émet pour l'instant";
    }

    // Contamination
    const rate = S.contaminationRate();
    const contamEl = U.$("#kpiContam");
    if (rate == null) {
      contamEl.textContent = "—";
      contamEl.className = "kpi-value";
      C.ring(U.$("#kpiContamGauge"), null, { size: 68, stroke: 7, threshold: thr });
    } else {
      const pct = Math.round(rate * 100);
      contamEl.textContent = pct + " %";
      contamEl.className = "kpi-value" + (rate >= cfg.CONTAMINATION_THRESHOLD ? " bad" : (rate > 0 ? " warn" : ""));
      C.ring(U.$("#kpiContamGauge"), pct, {
        size: 68, stroke: 7, threshold: thr,
        color: rate >= cfg.CONTAMINATION_THRESHOLD ? "var(--red)" : (rate > 0 ? "var(--orange)" : "var(--green)")
      });
    }

    // Alertes 24 h
    const day = S.state.alerts.filter(function (a) { return Date.now() - a.ts < 864e5; });
    const crit = day.filter(function (a) { return String(a.level).toLowerCase() === "critical"; }).length;
    const alertsEl = U.$("#kpiAlerts");
    alertsEl.textContent = S.state.conn.api === "online" || day.length ? String(day.length) : "—";
    alertsEl.className = "kpi-value" + (crit ? " bad" : "");
    U.$("#kpiAlertsSub").textContent = day.length ? (crit ? crit + " critique" + (crit > 1 ? "s" : "") : "Aucune alerte critique") : "Aucune alerte sur 24 h";

    // Stress moyen (dernier check-in de chaque membre)
    const stresses = crew.map(function (m) {
      const ck = S.lastCheckin(m.id);
      return ck ? U.num(ck.stress) : null;
    }).filter(function (v) { return v != null; });
    const stressEl = U.$("#kpiStress");
    if (!stresses.length) { stressEl.textContent = "—"; stressEl.className = "kpi-value"; }
    else {
      const avg = Math.round(stresses.reduce(function (a, b) { return a + b; }, 0) / stresses.length);
      stressEl.textContent = avg + " %";
      stressEl.className = "kpi-value" + (avg >= cfg.ANXIETY_THRESHOLD ? " warn" : "");
    }
  }

  /* ---------------- Matrice de l'équipage ---------------- */
  function meter(label, value, warnAt) {
    if (value == null) return '<div class="meter"><span class="m-lbl">' + label + '</span><div class="m-track"></div><span class="m-val">—</span></div>';
    const v = U.clamp(Math.round(value), 0, 100);
    return '<div class="meter"><span class="m-lbl">' + label + '</span><div class="m-track"><div class="m-fill' + (warnAt != null && v >= warnAt ? " warn" : "") +
      '" style="width:' + v + '%"></div></div><span class="m-val">' + v + " %</span></div>";
  }

  function card(m) {
    const cfg = HHO.config.get();
    const lvl = S.levelOf(m.id);
    const info = U.levelInfo(lvl);
    const t = S.state.telemetry.get(m.id);
    const latest = t ? t.latest : null;
    const ck = S.lastCheckin(m.id);
    const tilt = U.tiltOf(latest);
    const online = S.isOnline(m.id);
    const id = U.esc(m.id);

    return '<article class="crew-card lvl-' + (lvl || "n") + (m.contaminated ? " contaminated" : "") + '">' +
      '<div class="bar"></div>' +
      '<header class="cc-head">' + UI.badgeIcon(lvl, m.contaminated, 34) +
      '<div class="cc-id"><div class="name">' + U.esc(m.name || "Sans nom") + '</div><div class="role">' + U.esc(m.role || "Rôle non renseigné") + "</div></div>" +
      (m.isRealBadge ? '<span class="tag-real">Badge physique</span>' : "") + "</header>" +
      '<div class="cc-metrics">' +
      meter("Stress", ck ? U.num(ck.stress) : null, cfg.ANXIETY_THRESHOLD) +
      '<div class="cc-row"><span>Rythme cardiaque</span><b>' + (latest && U.num(latest.heartRate) != null ? Math.round(latest.heartRate) + " bpm" : "—") + "</b></div>" +
      '<div class="cc-row"><span>Posture</span><b>' + (tilt ? (tilt === "repos" ? "Repos" : "Actif") : "—") + "</b></div>" +
      '<div class="cc-row"><span>Dernier check-in</span><b>' + (ck ? U.fmtAgo(ck.ts) : "—") + "</b></div>" +
      '<div class="cc-row"><span>Signal du badge</span><b class="' + (online ? "ok" : "") + '">' + (latest ? U.fmtAgo(latest.ts) : "Aucun") + "</b></div>" +
      "</div>" +
      '<div class="cc-status" style="color:' + info.color + '"><span class="sdot"></span>' + U.esc(info.label) + "</div>" +
      '<footer class="cc-actions">' +
      '<button class="btn small ghost" data-open="' + id + '">Fiche détaillée</button>' +
      '<button class="btn small ' + (m.contaminated ? "ghost" : "danger") + '" data-contam="' + id + '" data-val="' + (!m.contaminated) + '">' +
      (m.contaminated ? "Lever la contamination" : "Déclarer contaminé") + "</button>" +
      "</footer></article>";
  }

  function matrix() {
    const crew = crewArr();
    const box = U.$("#crewMatrix");
    U.$("#matrixTag").textContent = crew.length ? crew.length + " profil" + (crew.length > 1 ? "s" : "") : "En attente";
    if (!crew.length) {
      box.innerHTML = UI.emptyHTML("Aucun membre d'équipage enregistré",
        S.state.conn.api === "offline" ? "Le serveur central est injoignable. Vérifiez l'adresse dans Paramètres." : "Les profils apparaîtront dès que le serveur central les transmettra.");
      box.style.display = "block";
      return;
    }
    box.style.display = "";
    box.innerHTML = crew.map(card).join("");
  }

  function onMatrixClick(e) {
    const open = e.target.closest("[data-open]");
    if (open) { HHO.nav.go("crew", open.dataset.open); return; }
    const contam = e.target.closest("[data-contam]");
    if (contam) HHO.app.setContamination(contam.dataset.contam, contam.dataset.val === "true", contam);
  }

  /* ---------------- Radar psychologique ---------------- */
  function radar() {
    const series = crewArr().map(function (m, i) {
      const ck = S.lastCheckin(m.id);
      const v = {};
      if (ck) {
        if (U.num(ck.stress) != null) v.stress = U.num(ck.stress);
        if (U.num(ck.fatigue) != null) v.fatigue = U.num(ck.fatigue);
        if (U.num(ck.isolement) != null) v.isolement = U.num(ck.isolement);
        if (U.num(ck.humeur) != null) v.moral = 100 - U.num(ck.humeur);
        if (U.num(ck.sommeil) != null) v.sommeil = 100 - U.num(ck.sommeil);
      }
      return { name: (m.name || "").split(" ").slice(-1)[0] || m.id, color: C.colorAt(i), values: v };
    });
    C.radar(U.$("#radarChart"), RADAR_AXES, series, {
      emptyTitle: "Aucune évaluation disponible",
      emptyHint: "Le radar se remplira avec les check-ins PsychoSpace.",
      ariaLabel: "Radar du risque psychologique de l'équipage"
    });
  }

  /* ---------------- Rythme cardiaque de l'équipage (historique) ---------------- */
  function heartChart() {
    const series = crewArr().map(function (m, i) {
      const t = S.state.telemetry.get(m.id);
      return {
        name: m.name || m.id,
        color: C.colorAt(i),
        points: (t ? t.history : []).map(function (p) { return { ts: p.ts, value: p.heartRate }; })
      };
    });
    C.line(U.$("#crewHrChart"), series, {
      height: 200, min: 40, max: 160,
      threshold: { value: 110, label: "Tachycardie" },
      emptyTitle: "Aucune mesure du rythme cardiaque",
      emptyHint: "La courbe démarrera à la réception des premières données des Bio-Badges.",
      ariaLabel: "Évolution du rythme cardiaque de l'équipage"
    });
  }

  /* ---------------- Journal des alertes ---------------- */
  function alerts() {
    const box = U.$("#alertList");
    const list = S.state.alerts.slice(0, 40);
    if (!list.length) { box.innerHTML = UI.emptyHTML("Aucune alerte", "Les alertes générées par le serveur et l'IA s'afficheront ici."); return; }
    box.innerHTML = list.map(function (a) {
      const lvl = String(a.level || "info").toLowerCase();
      return '<div class="feed-item a-' + U.esc(lvl) + '"><span class="fi-dot"></span><div>' +
        '<div class="fi-msg">' + U.esc(a.message || a.title || "Alerte") + "</div>" +
        '<div class="fi-meta"><span>' + U.esc(a.crewId != null ? S.memberName(a.crewId) : "Système") + "</span><span>" + U.fmtAgo(a.ts) + "</span></div></div></div>";
    }).join("");
  }

  /* ---------------- Flux temps réel ---------------- */
  function summary(m) {
    switch (m.type) {
      case "telemetry": {
        const v = m.vitals || {};
        const parts = [];
        const t = U.tiltOf(v); if (t) parts.push(t);
        if (v.temperature != null) parts.push(v.temperature + " °C");
        if (v.heartRate != null) parts.push(v.heartRate + " bpm");
        return S.memberName(m.crewId) + " — " + (parts.join(", ") || "données reçues");
      }
      case "alert": return (m.message || (m.alert && m.alert.message) || "alerte");
      case "crisis": return "Protocole de quarantaine engagé";
      case "crisis_resolved": return "Quarantaine levée";
      case "hall_sensor": return "Clé aimantée détectée — " + S.memberName(m.crewId);
      case "checkin": return "Check-in reçu — " + S.memberName(m.crewId);
      case "diagnostic": return "Analyse IA — " + S.memberName(m.crewId);
      default: {
        const s = JSON.stringify(m);
        return s.length > 120 ? s.slice(0, 120) + "…" : s;
      }
    }
  }

  function feed() {
    const box = U.$("#liveFeed");
    const items = S.state.feed.slice(0, 40);
    if (!items.length) {
      box.innerHTML = UI.emptyHTML("Aucun message reçu",
        S.state.conn.ws === "online" ? "Liaison établie — en attente du premier message des Bio-Badges." : "Le flux démarrera dès que la liaison temps réel sera établie.");
      return;
    }
    box.innerHTML = items.map(function (it) {
      const type = String(it.msg.type || "inconnu");
      return '<div class="lf-row"><span class="lf-t">' + U.fmtTimeS(it.at) + '</span><span class="lf-type t-' + U.esc(type) + '">' + U.esc(type) +
        '</span><span class="lf-txt">' + U.esc(summary(it.msg)) + "</span></div>";
    }).join("");
  }

  return { init: init };
})();
