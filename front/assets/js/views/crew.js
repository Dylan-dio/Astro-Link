/* ==========================================================================
   Horizon Health OS — views/crew.js
   Fiches détaillées : dossier médical, constantes en direct, historiques,
   analyses de l'IA embarquée et recommandations pour chaque astronaute.
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.crew = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, C = HHO.charts, UI = HHO.ui;

  const CHECKIN_SERIES = [
    { key: "sommeil", name: "Sommeil", color: "#4FD9E0" },
    { key: "humeur", name: "Humeur", color: "#5FCB82" },
    { key: "fatigue", name: "Fatigue", color: "#E3963D" },
    { key: "stress", name: "Stress", color: "#E24A42" },
    { key: "isolement", name: "Isolement", color: "#B98CE0" }
  ];

  let selected = null;
  let filter = "";

  function active() { return HHO.nav.current() === "crew"; }
  function member() { return selected ? S.state.crew.get(selected) : null; }

  function init() {
    S.on("crew", U.throttle(function () {
      if (!active()) return;
      list();
      if (selected && S.state.crew.has(selected)) head(); else if (selected) emptyDetail();
    }, 300));
    S.on("telemetry", U.throttle(function () {
      if (!active()) return;
      list();
      if (selected) { head(); live(); forceChart(); tiltChart(); }
    }, 700));
    S.on("checkins", function (id) { if (active() && id === selected) { checkins(); live(); head(); } });
    S.on("diagnostics", function (id) { if (active() && id === selected) diagnostics(); });
    S.on("recommendations", function (id) { if (active() && id === selected) recommendations(); });
    S.on("resize", function () { if (active() && selected) { forceChart(); tiltChart(); checkins(); } });

    U.$("#crewList").addEventListener("click", function (e) {
      const b = e.target.closest("[data-id]");
      if (b) select(b.dataset.id);
    });
    U.$("#crewSearch").addEventListener("input", function (e) { filter = e.target.value.trim().toLowerCase(); list(); });
    U.$("#crewDetail").addEventListener("click", function (e) {
      const c = e.target.closest("[data-contam]");
      if (c) HHO.app.setContamination(c.dataset.contam, c.dataset.val === "true", c);
      const r = e.target.closest("[data-refresh]");
      if (r) load();
    });

    HHO.nav.register("crew", function (id) {
      list();
      if (id != null) select(id);
      else if (selected && S.state.crew.has(selected)) { skeleton(); renderAll(); }
      else {
        const first = S.state.crew.keys().next();
        if (!first.done) select(first.value); else emptyDetail();
      }
    });
  }

  /* ---------------- Liste ---------------- */
  function list() {
    const box = U.$("#crewList");
    const all = Array.from(S.state.crew.values());
    U.$("#crewCount").textContent = all.length ? String(all.length) : "—";
    const items = all.filter(function (m) {
      return !filter || (String(m.name || "") + " " + String(m.role || "") + " " + String(m.badgeId || "")).toLowerCase().indexOf(filter) >= 0;
    });
    if (!all.length) { box.innerHTML = UI.emptyHTML("Aucun profil", "En attente des dossiers de l'équipage."); return; }
    if (!items.length) { box.innerHTML = UI.emptyHTML("Aucun résultat", "Aucun membre ne correspond à la recherche."); return; }
    box.innerHTML = items.map(function (m) {
      const lvl = S.levelOf(m.id);
      const t = S.state.telemetry.get(m.id);
      return '<button class="cl-item' + (m.id === selected ? " active" : "") + '" data-id="' + U.esc(m.id) + '">' +
        UI.badgeIcon(lvl, m.contaminated, 28) +
        '<span class="cl-txt"><span class="cl-name">' + U.esc(m.name || "Sans nom") + '</span><span class="cl-role">' + U.esc(m.role || "—") + "</span></span>" +
        '<span class="cl-seen">' + (S.isOnline(m.id) ? "en ligne" : (t && t.latest ? U.fmtTime(t.latest.ts) : "")) + "</span></button>";
    }).join("");
  }

  /* ---------------- Sélection & chargement ---------------- */
  function select(id) {
    selected = String(id);
    list();
    if (!S.state.crew.has(selected)) { emptyDetail(); return; }
    skeleton();
    renderAll();
    load();
  }

  async function load() {
    const id = selected;
    if (!id) return;
    const res = await Promise.allSettled([
      HHO.api.getMember(id),
      HHO.api.getTelemetry(id),
      HHO.api.getCheckins(id),
      HHO.api.getDiagnostics(id),
      HHO.api.getRecommendations(id)
    ]);
    if (id !== selected) return;
    if (res[0].status === "fulfilled" && res[0].value) S.upsertCrew(Object.assign({ id: id }, res[0].value));
    if (res[1].status === "fulfilled") S.setTelemetryHistory(id, U.asArray(res[1].value, "points"));
    if (res[2].status === "fulfilled") S.setCheckins(id, U.asArray(res[2].value, "checkins"));
    if (res[3].status === "fulfilled") S.setDiagnostics(id, U.asArray(res[3].value, "diagnostics"));
    if (res[4].status === "fulfilled") S.setRecommendations(id, U.asArray(res[4].value, "recommendations"));
    if (res.every(function (r) { return r.status === "rejected"; })) {
      UI.toast("Serveur injoignable : affichage des dernières données connues.", "warning");
    }
    renderAll();
  }

  function emptyDetail() {
    U.$("#crewDetail").innerHTML = '<div class="panel">' + UI.emptyHTML("Aucun astronaute sélectionné",
      S.state.crew.size ? "Choisissez un membre de l'équipage dans la liste." : "Les fiches seront disponibles dès réception des profils depuis le serveur central.") + "</div>";
  }

  function skeleton() {
    U.$("#crewDetail").innerHTML =
      '<div class="panel detail-head" id="dHead"></div>' +
      '<div class="detail-grid">' +
      '<section class="panel d-identity"><div class="ph"><h2>Dossier médical</h2><span class="tag">Profil</span></div><div id="dIdentity"></div></section>' +
      '<section class="panel d-live"><div class="ph"><h2>Constantes en direct</h2><span class="tag">Bio-Badge Astro-Link</span></div><div id="dLive"></div></section>' +
      '<section class="panel d-force"><div class="ph"><h2>Jauge d\'anxiété</h2><span class="tag">Capteur de force</span></div><div class="chart-box" id="dForce"></div></section>' +
      '<section class="panel d-tilt"><div class="ph"><h2>Activité et repos</h2><span class="tag">Capteur d\'inclinaison</span></div><div class="chart-box" id="dTilt"></div><div id="dTiltRatio"></div></section>' +
      '<section class="panel d-checkins"><div class="ph"><h2>Suivi psychologique</h2><span class="tag">Check-ins PsychoSpace</span></div><div class="chart-box" id="dCheckins"></div><div class="table-scroll" id="dCheckinTable"></div></section>' +
      '<section class="panel d-diag"><div class="ph"><h2>Analyses de l\'IA embarquée</h2><span class="tag">Ollama — local</span></div><div id="dDiag"></div></section>' +
      '<section class="panel d-reco"><div class="ph"><h2>Recommandations</h2><span class="tag">Générées par l\'IA</span></div><div id="dReco"></div></section>' +
      "</div>";
  }

  function renderAll() {
    if (!member()) return;
    head(); identity(); live(); forceChart(); tiltChart(); checkins(); diagnostics(); recommendations();
  }

  /* ---------------- En-tête ---------------- */
  function head() {
    const el = U.$("#dHead"), m = member();
    if (!el || !m) return;
    const lvl = S.levelOf(m.id);
    const t = S.state.telemetry.get(m.id);
    el.innerHTML =
      '<div class="avatar lvl-' + (lvl || "n") + '">' + U.esc(U.initials(m.name)) + "</div>" +
      '<div class="dh-main"><h2>' + U.esc(m.name || "Sans nom") + '</h2><div class="dh-role">' + U.esc([m.role, m.specialty].filter(Boolean).join(" — ") || "Rôle non renseigné") + "</div>" +
      '<div class="dh-meta"><span>Badge <b>' + U.esc(m.badgeId || "non associé") + "</b></span>" +
      "<span>Dernier signal <b>" + (t && t.latest ? U.fmtAgo(t.latest.ts) : "aucun") + "</b></span>" +
      (m.isRealBadge ? "<span><b>Badge physique connecté</b></span>" : "") + "</div></div>" +
      '<div class="dh-actions">' + UI.levelPill(lvl) +
      '<button class="btn small ghost" data-refresh>Actualiser</button>' +
      '<button class="btn small ' + (m.contaminated ? "ghost" : "danger") + '" data-contam="' + U.esc(m.id) + '" data-val="' + (!m.contaminated) + '">' +
      (m.contaminated ? "Lever la contamination" : "Déclarer contaminé") + "</button></div>";
  }

  /* ---------------- Dossier médical ---------------- */
  function fieldVal(v, suffix) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
    if (Array.isArray(v)) return v.join(", ");
    return String(v) + (suffix || "");
  }

  function identity() {
    const el = U.$("#dIdentity"), m = member();
    if (!el || !m) return;
    const rows = [
      ["Rôle à bord", fieldVal(m.role)],
      ["Spécialité", fieldVal(m.specialty)],
      ["Âge", fieldVal(m.age, " ans")],
      ["Sexe", fieldVal(m.sex)],
      ["Groupe sanguin", fieldVal(m.bloodType)],
      ["Nationalité", fieldVal(m.nationality)],
      ["Taille", fieldVal(m.heightCm, " cm")],
      ["Masse", fieldVal(m.weightKg, " kg")],
      ["Allergies", fieldVal(m.allergies), true],
      ["Traitements en cours", fieldVal(m.treatments), true],
      ["Antécédents et notes médicales", fieldVal(m.medicalNotes), true]
    ];
    el.innerHTML = '<dl class="id-grid">' + rows.map(function (r) {
      return '<div class="' + (r[2] ? "wide" : "") + '"><dt>' + r[0] + '</dt><dd class="' + (r[1] == null ? "na" : "") + '">' + U.esc(r[1] == null ? "Non renseigné" : r[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  /* ---------------- Constantes en direct ---------------- */
  function tile(label, value, unit, sub) {
    return '<div class="tile"><span class="t-lbl">' + label + "</span>" +
      (value == null ? '<span class="t-val na">Non mesuré</span>' : '<span class="t-val">' + U.esc(value) + (unit ? "<small>" + unit + "</small>" : "") + "</span>") +
      (sub ? '<span class="t-sub">' + sub + "</span>" : "") + "</div>";
  }

  function live() {
    const el = U.$("#dLive"), m = member();
    if (!el || !m) return;
    const t = S.state.telemetry.get(m.id);
    const latest = t ? t.latest : null;
    if (!latest) {
      el.innerHTML = UI.emptyHTML("Aucune donnée du Bio-Badge", "Vérifiez que le badge " + (m.badgeId || "") + " est allumé et connecté au réseau du vaisseau.");
      return;
    }
    const force = U.num(latest.force);
    const temp = U.num(latest.temperature);
    const hr = U.num(latest.heartRate);
    const tilt = U.tiltOf(latest);
    el.innerHTML =
      '<div class="tiles">' +
      '<div class="tile t-ring"><div id="dForceRing"></div></div>' +
      '<div class="tile"><span class="t-lbl">Posture</span>' + UI.tiltPill(tilt) + '<span class="t-sub">Capteur Tilt</span></div>' +
      tile("Température", temp == null ? null : temp.toFixed(1), "°C", temp != null && temp >= 38 ? '<span class="bad-text">Fébrile</span>' : "") +
      tile("Fréquence cardiaque", hr == null ? null : Math.round(hr), "bpm", "") +
      tile("Dernière mesure", U.fmtTimeS(latest.ts), "", S.isOnline(m.id) ? '<span class="ok-text">Badge en ligne</span>' : '<span class="warn-text">Badge silencieux</span>') +
      "</div>";
    C.ring(U.$("#dForceRing"), force, { size: 92, unit: "%", label: "Anxiété (force)", warnAt: HHO.config.get().ANXIETY_THRESHOLD });
  }

  /* ---------------- Graphiques ---------------- */
  function forceChart() {
    const m = member();
    if (!m) return;
    const t = S.state.telemetry.get(m.id);
    C.line(U.$("#dForce"), [{
      name: "Anxiété", color: "#4FD9E0",
      points: (t ? t.history : []).map(function (p) { return { ts: p.ts, value: p.force }; })
    }], {
      height: 190, min: 0, max: 100,
      threshold: { value: HHO.config.get().ANXIETY_THRESHOLD, label: "Seuil d'anxiété" },
      emptyTitle: "Aucune pression enregistrée",
      emptyHint: "L'astronaute presse le capteur de force lors d'un pic de stress.",
      ariaLabel: "Historique de la jauge d'anxiété"
    });
  }

  function tiltChart() {
    const m = member();
    if (!m) return;
    const t = S.state.telemetry.get(m.id);
    const hist = t ? t.history : [];
    const pts = hist.map(function (p) {
      const tl = U.tiltOf(p);
      return { ts: p.ts, value: tl == null ? null : (tl === "actif" ? 1 : 0) };
    });
    C.line(U.$("#dTilt"), [{ name: "Posture", color: "#E3963D", points: pts }], {
      height: 150, min: 0, max: 1, step: true,
      yTicks: [{ v: 0, label: "Repos" }, { v: 1, label: "Actif" }],
      emptyTitle: "Aucune mesure d'inclinaison",
      emptyHint: "Le capteur Tilt permet d'évaluer l'activité et la qualité du sommeil.",
      ariaLabel: "Historique de la posture"
    });
    const r = U.$("#dTiltRatio");
    if (r) r.innerHTML = hist.length ? UI.ratioHTML(hist) : "";
  }

  function checkins() {
    const m = member();
    if (!m) return;
    const list = S.state.checkins.get(m.id) || [];
    C.line(U.$("#dCheckins"), CHECKIN_SERIES.map(function (s) {
      return { name: s.name, color: s.color, points: list.map(function (c) { return { ts: c.ts, value: c[s.key] }; }) };
    }), {
      height: 210, min: 0, max: 100, area: false,
      emptyTitle: "Aucun check-in enregistré",
      emptyHint: "L'astronaute remplit son questionnaire quotidien depuis le terminal PsychoSpace.",
      ariaLabel: "Historique des check-ins psychologiques"
    });
    const tbl = U.$("#dCheckinTable");
    if (!tbl) return;
    if (!list.length) { tbl.innerHTML = ""; return; }
    const rows = list.slice(-6).reverse();
    tbl.innerHTML = '<table class="ck-table"><thead><tr><th>Date</th>' + CHECKIN_SERIES.map(function (s) { return "<th>" + s.name + "</th>"; }).join("") +
      "<th>Note</th></tr></thead><tbody>" + rows.map(function (c) {
        return "<tr><td>" + U.fmtDateTime(c.ts) + "</td>" + CHECKIN_SERIES.map(function (s) {
          const v = U.num(c[s.key]); return "<td>" + (v == null ? "—" : Math.round(v)) + "</td>";
        }).join("") + '<td class="note">' + U.esc(c.note || "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ---------------- IA ---------------- */
  function diagnostics() {
    const el = U.$("#dDiag"), m = member();
    if (!el || !m) return;
    const list = S.state.diagnostics.get(m.id) || [];
    if (!list.length) { el.innerHTML = UI.emptyHTML("Aucune analyse", "Les diagnostics de l'IA embarquée apparaîtront après un check-in ou une consultation."); return; }
    el.innerHTML = '<div class="diag-list">' + list.map(function (d) {
      const u = U.urgencyOf(d.urgency);
      return '<article class="diag-item ' + u.cls + '"><div class="diag-top"><span>' + U.fmtDateTime(d.ts) + (d.source ? " — " + U.esc(d.source) : "") + "</span>" + UI.urgencyTag(d.urgency) + "</div>" +
        "<p>" + U.esc(d.summary || d.text || "") + "</p>" + UI.hypothesesHTML(d.hypotheses) + "</article>";
    }).join("") + "</div>";
  }

  function recommendations() {
    const el = U.$("#dReco"), m = member();
    if (!el || !m) return;
    const list = S.state.recommendations.get(m.id) || [];
    if (!list.length) { el.innerHTML = UI.emptyHTML("Aucune recommandation", "L'IA proposera des activités correctives selon l'état psychologique détecté."); return; }
    el.innerHTML = '<div class="reco-list">' + list.map(function (r) {
      if (typeof r === "string") return '<article class="reco-item"><p>' + U.esc(r) + "</p></article>";
      return '<article class="reco-item"><h3>' + U.esc(r.title || "Recommandation") + "</h3><p>" + U.esc(r.description || "") + "</p>" +
        (r.category ? '<div class="reco-cat">' + U.esc(r.category) + "</div>" : "") + "</article>";
    }).join("") + "</div>";
  }

  return { init: init, select: select };
})();
