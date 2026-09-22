/* ==========================================================================
   Horizon Health OS — nav.js
   Navigation entre les vues + authentification médecin (optionnelle,
   activable dans Paramètres → "Exiger une authentification").
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.nav = (function () {
  "use strict";
  const U = HHO.util;
  let current = null;
  const hooks = {};

  function init() {
    U.$$(".nav-btn[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.dataset.view); });
    });
  }

  function register(view, onShow) { hooks[view] = onShow; }

  function go(view, param) {
    if (HHO.auth.required(view) && !HHO.auth.ok()) {
      HHO.auth.prompt(function () { go(view, param); });
      return;
    }
    current = view;
    U.$$(".nav-btn[data-view]").forEach(function (b) {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    U.$$(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + view); });
    const sec = U.$("#view-" + view);
    if (sec) {
      U.$("#viewTitle").textContent = sec.dataset.title || "";
      U.$("#viewSub").textContent = sec.dataset.sub || "";
    }
    U.$("#main").scrollTop = 0;
    if (hooks[view]) hooks[view](param);
  }

  return { init: init, register: register, go: go, current: function () { return current; } };
})();

HHO.auth = (function () {
  "use strict";
  const U = HHO.util;
  const PROTECTED = ["home", "command", "crew"];
  const KEY = "hho.token";
  let pending = null;

  function required(view) { return !!HHO.config.get().REQUIRE_AUTH && PROTECTED.indexOf(view) >= 0; }
  function ok() { return !!HHO.store.state.auth.token; }

  function init() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (saved && saved.token) { HHO.store.state.auth.token = saved.token; HHO.store.state.auth.user = saved.user || null; }
    } catch (e) { /* ignore */ }

    U.$("#loginForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      const err = U.$("#loginError");
      const btn = U.$("#loginSubmit");
      err.textContent = "";
      btn.disabled = true;
      try {
        const res = await HHO.api.login(U.$("#loginUser").value.trim(), U.$("#loginPass").value);
        if (!res || !res.token) throw new Error("Réponse du serveur sans jeton");
        HHO.store.state.auth.token = res.token;
        HHO.store.state.auth.user = res.user || null;
        try { sessionStorage.setItem(KEY, JSON.stringify({ token: res.token, user: res.user || null })); } catch (x) { /* ignore */ }
        U.$("#loginModal").hidden = true;
        U.$("#loginPass").value = "";
        const cb = pending; pending = null;
        if (cb) cb();
      } catch (ex) {
        err.textContent = ex.status === 401 ? "Identifiants refusés." : "Serveur injoignable ou authentification indisponible.";
      } finally {
        btn.disabled = false;
      }
    });

    U.$("#loginCancel").addEventListener("click", function () {
      U.$("#loginModal").hidden = true;
      pending = null;
      HHO.nav.go("psycho");
    });
  }

  function prompt(cb) {
    pending = cb;
    U.$("#loginModal").hidden = false;
    U.$("#loginError").textContent = "";
    setTimeout(function () { U.$("#loginUser").focus(); }, 30);
  }

  function logout() {
    HHO.store.state.auth.token = null;
    HHO.store.state.auth.user = null;
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { init: init, required: required, ok: ok, prompt: prompt, logout: logout };
})();
