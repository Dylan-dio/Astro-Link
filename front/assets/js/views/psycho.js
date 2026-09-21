/* ==========================================================================
   Horizon Health OS — views/psycho.js
   Terminal personnel PsychoSpace (tablette de l'infirmerie) :
   check-in quotidien, Bio-Badge, assistant médical IA, recommandations.
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.psycho = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, C = HHO.charts, UI = HHO.ui;
  const KEY = "hho.me";

  const QUESTIONS = [
    { key: "sommeil", label: "Qualité du sommeil", low: "Très mauvaise", high: "Excellente", color: "#4FD9E0" },
    { key: "humeur", label: "Humeur", low: "Très basse", high: "Très bonne", color: "#5FCB82" },
    { key: "fatigue", label: "Fatigue", low: "Aucune", high: "Épuisement", color: "#E3963D" },
    { key: "stress", label: "Stress", low: "Serein", high: "Extrême", color: "#E24A42" },
    { key: "isolement", label: "Sentiment d'isolement", low: "Bien entouré", high: "Très isolé", color: "#B98CE0" }
  ];

  let me = null;
  let sending = false;

  function active() { return HHO.nav.current() === "psycho"; }

  function init() {
    try { me = localStorage.getItem(KEY) || null; } catch (e) { me = null; }

    buildForm();
    U.$("#psyWho").addEventListener("change", function (e) { setMe(e.target.value || null); });
    U.$("#psySubmit").addEventListener("click", submitCheckin);
    U.$("#chatSend").addEventListener("click", sendChat);
    U.$("#chatInput").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });

    S.on("crew", function () { whoOptions(); if (active()) { badge(); } });
    S.on("telemetry", U.throttle(function () { if (active() && me) badge(); }, 500));
    S.on("checkins", function (id) { if (active() && id === me) history(); });
    S.on("recommendations", function (id) { if (active() && id === me) reco(); });
    S.on("chat", function (id) { if (id === me) chat(); });
    S.on("resize", function () { if (active()) history(); });

    HHO.nav.register("psycho", function () { whoOptions(); renderAll(); if (me) load(); });
  }

  /* ---------------- Identification ---------------- */
  function whoOptions() {
    const sel = U.$("#psyWho");
    const crew = Array.from(S.state.crew.values());
    sel.innerHTML = '<option value="">' + (crew.length ? "Sélectionnez votre profil" : "Aucun profil disponible") + "</option>" +
      crew.map(function (m) {
        return '<option value="' + U.esc(m.id) + '"' + (m.id === me ? " selected" : "") + ">" + U.esc(m.name || m.id) + (m.role ? " — " + U.esc(m.role) : "") + "</option>";
      }).join("");
    sel.disabled = !crew.length;
    const hint = U.$("#psyWhoHint");
    if (!crew.length) hint.textContent = "En attente des profils de l'équipage depuis le serveur central.";
    else if (me && !S.state.crew.has(me)) hint.textContent = "Votre profil n'est plus reconnu par le serveur, sélectionnez-le à nouveau.";
    else if (!me) hint.textContent = "Identifiez-vous pour remplir votre check-in et consulter l'assistant médical.";
    else hint.textContent = "Connecté en tant que " + S.memberName(me) + ".";
    lockForm();
  }

  function setMe(id) {
    me = id ? String(id) : null;
    try { if (me) localStorage.setItem(KEY, me); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    whoOptions();
    renderAll();
    if (me) load();
  }

  async function load() {
    const id = me;
    const res = await Promise.allSettled([
      HHO.api.getCheckins(id),
      HHO.api.getRecommendations(id),
      HHO.api.getChat(id),
      HHO.api.getTelemetry(id)
    ]);
    if (id !== me) return;
    if (res[0].status === "fulfilled") S.setCheckins(id, U.asArray(res[0].value, "checkins"));
    if (res[1].status === "fulfilled") S.setRecommendations(id, U.asArray(res[1].value, "recommendations"));
    if (res[2].status === "fulfilled") {
      const msgs = U.asArray(res[2].value, "messages");
      if (msgs.length) S.setChat(id, msgs.map(normChat));
    }
    if (res[3].status === "fulfilled") S.setTelemetryHistory(id, U.asArray(res[3].value, "points"));
    renderAll();
  }

  function renderAll() { badge(); reco(); chat(); history(); lockForm(); }

  /* ---------------- Check-in ---------------- */
  function buildForm() {
    U.$("#psyQuestions").innerHTML = QUESTIONS.map(function (q) {
      return '<div class="range-field"><div class="rf-top"><label for="q-' + q.key + '"><span>' + q.label + "</span></label>" +
        '<output id="o-' + q.key + '" for="q-' + q.key + '">50</output></div>' +
        '<input type="range" id="q-' + q.key + '" min="0" max="100" step="1" value="50">' +
        '<div class="rf-caps"><span>' + q.low + "</span><span>" + q.high + "</span></div></div>";
    }).join("");
    QUESTIONS.forEach(function (q) {
      const input = U.$("#q-" + q.key), out = U.$("#o-" + q.key);
      input.addEventListener("input", function () { out.textContent = input.value; });
    });
  }

  function lockForm() {
    const disabled = !me || !S.state.crew.has(me);
    U.$("#psySubmit").disabled = disabled || sending;
    U.$("#chatSend").disabled = disabled;
    U.$("#chatInput").disabled = disabled;
    U.$("#chatInput").placeholder = disabled ? "Identifiez-vous pour consulter l'assistant" : "Décrivez vos symptômes (ex : maux de tête et toux depuis ce matin)";
  }

  function resetForm() {
    QUESTIONS.forEach(function (q) { U.$("#q-" + q.key).value = 50; U.$("#o-" + q.key).textContent = "50"; });
    U.$("#psyNote").value = "";
  }

  async function submitCheckin() {
    if (!me || sending) return;
    const status = U.$("#psyStatus");
    const payload = { crewId: me, ts: new Date().toISOString(), note: U.$("#psyNote").value.trim() || null };
    QUESTIONS.forEach(function (q) { payload[q.key] = Number(U.$("#q-" + q.key).value); });

    sending = true; lockForm();
    status.className = "form-status muted";
    status.textContent = "Transmission au serveur central…";
    try {
      const res = await HHO.api.postCheckin(payload);
      S.addCheckin(me, (res && res.checkin) || payload);
      if (res && res.recommendations) S.setRecommendations(me, U.asArray(res.recommendations));
      if (res && res.diagnostic) S.addDiagnostic(me, res.diagnostic);
      status.className = "form-status ok-text";
      status.textContent = "Check-in enregistré à " + U.fmtTime(Date.now()) + ". Merci.";
      HHO.audio.chime();
      resetForm();
      if (!(res && res.recommendations)) {
        HHO.api.getRecommendations(me).then(function (r) { S.setRecommendations(me, U.asArray(r, "recommendations")); }).catch(function () { /* ignore */ });
      }
    } catch (e) {
      status.className = "form-status bad-text";
      status.textContent = e.status ? "Le serveur a refusé le check-in (" + e.status + ")." : "Serveur injoignable : check-in non transmis. Réessayez.";
    } finally {
      sending = false; lockForm();
    }
  }

  /* ---------------- Mon Bio-Badge ---------------- */
  function badge() {
    const el = U.$("#psyBadge");
    if (!me || !S.state.crew.has(me)) { el.innerHTML = UI.emptyHTML("Aucun badge associé", "Sélectionnez votre profil pour afficher votre Bio-Badge."); return; }
    const m = S.state.crew.get(me);
    const t = S.state.telemetry.get(me);
    const latest = t ? t.latest : null;
    const lvl = S.levelOf(me);
    if (!latest) {
      el.innerHTML = '<div class="psy-badge-id">' + UI.badgeIcon(lvl, m.contaminated, 40) + "<div><b>" + U.esc(m.name || "") + "</b><span>" + U.esc(m.badgeId || "Badge non associé") + "</span></div></div>" +
        UI.emptyHTML("Badge non détecté", "Vérifiez que votre Bio-Badge est allumé et connecté au réseau du vaisseau.");
      return;
    }
    el.innerHTML = '<div class="psy-badge"><div id="psyRing"></div><div class="psy-badge-info">' +
      '<div class="psy-badge-id">' + UI.badgeIcon(lvl, m.contaminated, 40) + "<div><b>" + U.esc(m.name || "") + "</b><span>" + U.esc(m.badgeId || "") + " — " + U.fmtAgo(latest.ts) + "</span></div></div>" +
      "<div>" + UI.levelPill(lvl) + " " + UI.tiltPill(U.tiltOf(latest)) + "</div>" +
      '<div><div class="field-hint">Ratio repos / activité</div>' + UI.ratioHTML(t.history) + "</div></div></div>";
    C.ring(U.$("#psyRing"), U.num(latest.force), { size: 104, unit: "%", label: "Jauge d'anxiété", warnAt: HHO.config.get().ANXIETY_THRESHOLD });
  }

  /* ---------------- Recommandations ---------------- */
  function reco() {
    const el = U.$("#psyReco");
    const list = me ? (S.state.recommendations.get(me) || []) : [];
    if (!me) { el.innerHTML = UI.emptyHTML("Aucune recommandation", "Identifiez-vous pour recevoir vos suggestions personnalisées."); return; }
    if (!list.length) { el.innerHTML = UI.emptyHTML("Aucune recommandation pour l'instant", "L'IA vous proposera des activités après votre check-in."); return; }
    el.innerHTML = '<div class="reco-list">' + list.map(function (r) {
      if (typeof r === "string") return '<article class="reco-item"><p>' + U.esc(r) + "</p></article>";
      return '<article class="reco-item"><h3>' + U.esc(r.title || "Recommandation") + "</h3><p>" + U.esc(r.description || "") + "</p>" +
        (r.category ? '<div class="reco-cat">' + U.esc(r.category) + "</div>" : "") + "</article>";
    }).join("") + "</div>";
  }

  /* ---------------- Assistant médical ---------------- */
  function normChat(m) {
    return {
      role: m.role === "user" ? "user" : (m.role === "error" ? "error" : "ai"),
      text: m.text || m.message || m.reply || m.content || "",
      hypotheses: m.hypotheses || null,
      urgency: m.urgency || null,
      followUp: m.followUp || null,
      ts: U.toMs(m.ts) || Date.now()
    };
  }

  function chat() {
    const log = U.$("#chatLog");
    const list = me ? (S.state.chats.get(me) || []) : [];
    let html = "";
    if (!list.length) {
      html = '<div class="msg ai">' + (me
        ? "Bonjour " + U.esc(S.memberName(me)) + ". Décrivez vos symptômes : l'IA embarquée proposera des hypothèses et un niveau d'urgence. Vos échanges restent à bord."
        : "Identifiez-vous pour démarrer une consultation.") + "</div>";
    } else {
      html = list.map(function (m) {
        if (m.role === "user") return '<div class="msg user">' + U.esc(m.text) + '<div class="msg-meta">' + U.fmtTime(m.ts) + "</div></div>";
        if (m.role === "pending") return '<div class="msg ai pending">Analyse par l\'IA embarquée <span class="typing"><span></span><span></span><span></span></span></div>';
        if (m.role === "error") return '<div class="msg err">' + U.esc(m.text) + "</div>";
        return '<div class="msg ai">' + U.esc(m.text) + UI.hypothesesHTML(m.hypotheses) +
          (m.followUp ? '<div class="follow">' + U.esc(m.followUp) + "</div>" : "") +
          '<div class="msg-meta">' + (m.urgency ? UI.urgencyTag(m.urgency) : "") + "<span>" + U.fmtTime(m.ts) + "</span></div></div>";
      }).join("");
    }
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  async function sendChat() {
    const input = U.$("#chatInput");
    const text = input.value.trim();
    if (!text || !me) return;
    const id = me;
    input.value = "";
    S.addChat(id, { role: "user", text: text });
    S.addChat(id, { role: "pending" });
    U.$("#chatSend").disabled = true;
    try {
      const res = await HHO.api.chat(id, text);
      dropPending(id);
      S.addChat(id, normChat(Object.assign({ role: "ai" }, res || {}, { text: (res && (res.reply || res.text || res.message)) || "Réponse vide de l'IA." })));
      if (res && res.diagnostic) S.addDiagnostic(id, res.diagnostic);
    } catch (e) {
      dropPending(id);
      S.addChat(id, { role: "error", text: e.name === "AbortError" ? "L'IA embarquée n'a pas répondu à temps. Réessayez dans un instant." : "Assistant indisponible : le serveur central ou le modèle local ne répond pas." });
    } finally {
      lockForm();
    }
  }

  function dropPending(id) {
    const arr = (S.state.chats.get(id) || []).filter(function (m) { return m.role !== "pending"; });
    S.setChat(id, arr);
  }

  /* ---------------- Mon évolution ---------------- */
  function history() {
    const el = U.$("#psyHist");
    const list = me ? (S.state.checkins.get(me) || []) : [];
    C.line(el, QUESTIONS.map(function (q) {
      return { name: q.label, color: q.color, points: list.map(function (c) { return { ts: c.ts, value: c[q.key] }; }) };
    }), {
      height: 200, min: 0, max: 100, area: false,
      emptyTitle: me ? "Aucun check-in enregistré" : "Aucun profil sélectionné",
      emptyHint: me ? "Votre évolution s'affichera après vos premiers check-ins." : "Identifiez-vous pour consulter votre historique.",
      ariaLabel: "Évolution de mes check-ins"
    });
  }

  return { init: init };
})();
