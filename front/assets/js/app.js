/* ==========================================================================
   Horizon Health OS — app.js
   Point d'entrée : séquence de démarrage (vérifie réellement la connexion
   au serveur), barre haute, rafraîchissements et actions partagées.
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.app = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, UI = HHO.ui;

  /* ---------------- Chargements REST ---------------- */
  async function refreshCrew() {
    try {
      const res = await HHO.api.getCrew();
      const list = U.asArray(res, "crew");
      S.setCrewList(list);
      return list.length;
    } catch (e) { return null; }
  }

  async function refreshHistories() {
    const ids = Array.from(S.state.crew.keys());
    await Promise.allSettled(ids.map(function (id) {
      return HHO.api.getTelemetry(id).then(function (r) { S.setTelemetryHistory(id, U.asArray(r, "points")); });
    }));
  }

  async function refreshAlerts() {
    try { S.setAlerts(U.asArray(await HHO.api.getAlerts(), "alerts")); } catch (e) { /* ignore */ }
  }

  async function refreshCrisis() {
    try {
      const r = await HHO.api.getCrisis();
      if (r) S.setCrisis({ active: !!r.active, rate: U.num(r.contaminationRate), triage: U.asArray(r.triage), since: U.toMs(r.since) });
    } catch (e) { /* ignore */ }
  }

  async function refreshAll() {
    await refreshCrew();
    await Promise.allSettled([refreshHistories(), refreshAlerts(), refreshCrisis()]);
  }

  /* ---------------- Actions partagées ---------------- */
  async function setContamination(id, value, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await HHO.api.setContamination(id, value);
      S.upsertCrew(res && res.id != null ? res : { id: id, contaminated: value });
      UI.toast(S.memberName(id) + (value ? " déclaré(e) contaminé(e)." : " : contamination levée."), value ? "warning" : "success");
    } catch (e) {
      UI.toast("Le serveur n'a pas confirmé la modification" + (e.status ? " (" + e.status + ")" : " (injoignable)") + ".", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------------- Barre haute ---------------- */
  function clock() {
    const tick = function () {
      const now = Date.now();
      U.$("#shipClock").textContent = U.fmtTimeS(now);
      U.$("#shipDate").textContent = new Date(now).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
    };
    tick();
    setInterval(tick, 1000);
  }

  function renderConn() {
    const c = S.state.conn;
    const api = U.$("#connApi"), ws = U.$("#connWs");
    api.className = "conn " + c.api;
    ws.className = "conn " + c.ws;
    api.title = "API REST : " + c.api;
    ws.title = "Temps réel : " + c.ws;
  }

  const renderStrip = U.throttle(function () {
    U.$("#crewStrip").innerHTML = Array.from(S.state.crew.values()).map(function (m) {
      const l = S.levelOf(m.id);
      return '<span class="crew-dot lvl-' + (l || "n") + '" title="' + U.esc((m.name || m.id) + " — " + U.levelInfo(l).label) + '"></span>';
    }).join("");
  }, 500);

  /* ---------------- Séquence de démarrage ---------------- */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function waitFor(cond, timeout) {
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function check() {
        if (cond()) return resolve(true);
        if (Date.now() - t0 > timeout) return resolve(false);
        setTimeout(check, 100);
      })();
    });
  }

  async function boot() {
    const term = U.$("#bootTerm"), fill = U.$("#bootFill"), summary = U.$("#bootSummary"), enter = U.$("#bootEnter");
    const cfg = HHO.config.get();
    const steps = [
      { label: "Chargement de l'interface Horizon Health OS", run: async function () { return { ok: true }; } },
      {
        label: "Connexion au serveur central — " + cfg.API_BASE,
        run: async function () { try { await HHO.api.health(); return { ok: true }; } catch (e) { return { ok: false, note: "injoignable" }; } }
      },
      {
        label: "Liaison temps réel avec les Bio-Badges",
        run: async function () {
          HHO.socket.connect();
          const ok = await waitFor(function () { return S.state.conn.ws === "online"; }, 2500);
          return { ok: ok, note: ok ? "" : "nouvelle tentative en arrière-plan" };
        }
      },
      {
        label: "Récupération des dossiers de l'équipage",
        run: async function () {
          const n = await refreshCrew();
          if (n == null) return { ok: false, note: "indisponible" };
          return { ok: true, note: n + " profil" + (n > 1 ? "s" : "") };
        }
      },
      {
        label: "Chargement des historiques, alertes et état de crise",
        run: async function () { await Promise.allSettled([refreshHistories(), refreshAlerts(), refreshCrisis()]); return { ok: S.state.conn.api === "online" }; }
      }
    ];

    let allOk = true;
    for (let i = 0; i < steps.length; i++) {
      const line = document.createElement("div");
      line.className = "boot-line";
      line.innerHTML = '<span class="st">[ .... ]</span><span>' + U.esc(steps[i].label) + ' <span class="note"></span></span>';
      term.appendChild(line);
      requestAnimationFrame(function () { line.classList.add("show"); });
      await wait(140);
      const r = await steps[i].run();
      allOk = allOk && r.ok;
      const st = line.querySelector(".st");
      st.textContent = r.ok ? "[ OK ]" : "[ HORS LIGNE ]";
      st.className = "st " + (r.ok ? "ok" : "ko");
      if (r.note) line.querySelector(".note").textContent = "— " + r.note;
      fill.style.width = Math.round((i + 1) / steps.length * 100) + "%";
    }

    summary.textContent = allOk
      ? "Systèmes nominaux. Surveillance de l'équipage active."
      : "Mode dégradé : l'interface se mettra à jour automatiquement dès que le serveur répondra.";
    enter.hidden = false;
    enter.focus();

    await new Promise(function (resolve) {
      enter.addEventListener("click", resolve, { once: true });
    });
    HHO.audio.unlock();                       // geste utilisateur → son autorisé
    U.$("#boot").classList.add("hide");
    if (S.state.crisis.active) HHO.audio.startAlarm();
  }

  /* ---------------- Initialisation ---------------- */
  async function init() {
    HHO.config.load();
    HHO.nav.init();
    HHO.auth.init();
    HHO.views.command.init();
    HHO.views.crew.init();
    HHO.views.psycho.init();
    HHO.views.settings.init();
    HHO.crisis.init();

    clock();
    S.on("conn", renderConn);
    S.on("crew", renderStrip);
    S.on("telemetry", renderStrip);
    renderConn();

    window.addEventListener("resize", U.debounce(function () { S.emit("resize"); }, 200));

    await boot();
    HHO.nav.go("command");

    // Rafraîchissement de secours (si la liaison temps réel est coupée)
    setInterval(function () {
      refreshCrew();
      refreshAlerts();
      if (S.state.conn.ws !== "online") { refreshCrisis(); refreshHistories(); }
    }, HHO.config.get().POLL_INTERVAL_MS);
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    refreshCrew: refreshCrew, refreshAll: refreshAll, refreshAlerts: refreshAlerts,
    refreshCrisis: refreshCrisis, setContamination: setContamination
  };
})();
