/* ==========================================================================
   Horizon Health OS — ui.js
   Composants d'interface réutilisables + buzzer simulé (Web Audio API,
   sons générés en JS : aucun fichier audio, aucun téléchargement).
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.ui = (function () {
  "use strict";
  const U = HHO.util;

  function emptyHTML(title, hint) {
    return '<div class="empty">' +
      '<svg class="empty-ico" viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="3 4"/>' +
      '<circle cx="20" cy="20" r="8" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>' +
      '<line class="sweep" x1="20" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="1.3"/>' +
      '<circle cx="20" cy="20" r="2" fill="currentColor"/></svg>' +
      "<b>" + U.esc(title) + "</b>" + (hint ? "<span>" + U.esc(hint) + "</span>" : "") + "</div>";
  }

  /** Représentation du Bio-Badge Astro-Link : boîtier + LED RVB. */
  function badgeIcon(level, blink, size) {
    size = size || 30;
    const color = U.levelInfo(level).color;
    return '<svg class="astrolink" width="' + size + '" height="' + size + '" viewBox="0 0 30 30" aria-hidden="true">' +
      '<rect x="3" y="2" width="24" height="26" rx="4" fill="var(--panel-alt)" stroke="var(--border)" stroke-width="1.3"/>' +
      '<rect x="7.5" y="6.5" width="15" height="3" rx="1.5" fill="var(--border)"/>' +
      '<rect x="7.5" y="11.5" width="10" height="2" rx="1" fill="var(--border-soft)"/>' +
      '<circle class="' + (blink ? "led-blink" : "") + '" cx="15" cy="20.5" r="4.6" fill="' + color + '"' +
      (level ? ' style="filter:drop-shadow(0 0 4px ' + color + ')"' : "") + "/></svg>";
  }

  function levelPill(level) {
    return '<span class="lvl-pill lvl-' + (level || "n") + '"><span class="sdot"></span>' + U.esc(U.levelInfo(level).label) + "</span>";
  }

  function tiltPill(tilt) {
    if (!tilt) return '<span class="pill"><span class="sdot"></span>Posture inconnue</span>';
    return tilt === "repos"
      ? '<span class="pill p-repos"><span class="sdot"></span>Repos</span>'
      : '<span class="pill p-actif"><span class="sdot"></span>Actif</span>';
  }

  function urgencyTag(u) {
    const x = U.urgencyOf(u);
    return '<span class="urg ' + x.cls + '">Urgence : ' + x.label + "</span>";
  }

  function hypothesesHTML(list) {
    if (!list || !list.length) return "";
    return '<ul class="hyp-list">' + list.map(function (h) {
      if (typeof h === "string") return "<li><span>" + U.esc(h) + "</span></li>";
      const conf = U.num(h.confidence != null ? h.confidence : h.probability);
      const pct = conf == null ? "" : "<b>" + Math.round(conf <= 1 ? conf * 100 : conf) + " %</b>";
      return "<li><span>" + U.esc(h.label || h.name || "") + "</span>" + pct + "</li>";
    }).join("") + "</ul>";
  }

  function ratioHTML(history) {
    const pts = (history || []).map(U.tiltOf).filter(Boolean);
    if (!pts.length) return '<div class="field-hint">Aucune mesure de posture sur la période.</div>';
    const lying = Math.round(pts.filter(function (t) { return t === "repos"; }).length / pts.length * 100);
    return '<div class="ratio"><div class="ratio-bar"><div class="r-lying" style="width:' + lying + '%"></div><div class="r-active" style="width:' + (100 - lying) + '%"></div></div>' +
      '<div class="ratio-legend"><span>Repos ' + lying + " %</span><span>Actif " + (100 - lying) + " %</span></div></div>";
  }

  function toast(message, kind) {
    const box = U.$("#toasts");
    if (!box) return;
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.setAttribute("role", kind === "error" ? "alert" : "status");
    t.textContent = message;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === "error" ? 6000 : 4000);
  }

  /** Bouton "maintenir pour confirmer". */
  function holdButton(btn, fill, duration, onDone) {
    let raf = null, start = null;
    function frame(ts) {
      if (start === null) start = ts;
      const pct = U.clamp((ts - start) / duration * 100, 0, 100);
      fill.style.width = pct + "%";
      if (pct >= 100) { cancel(); onDone(); return; }
      raf = requestAnimationFrame(frame);
    }
    function begin(e) { if (e) e.preventDefault(); cancel(); raf = requestAnimationFrame(frame); }
    function cancel() { if (raf) cancelAnimationFrame(raf); raf = null; start = null; fill.style.width = "0%"; }
    btn.addEventListener("pointerdown", begin);
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { btn.addEventListener(ev, cancel); });
    btn.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !raf) begin(e); });
    btn.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") cancel(); });
  }

  return {
    emptyHTML: emptyHTML, badgeIcon: badgeIcon, levelPill: levelPill, tiltPill: tiltPill,
    urgencyTag: urgencyTag, hypothesesHTML: hypothesesHTML, ratioHTML: ratioHTML,
    toast: toast, holdButton: holdButton
  };
})();

/* --------------------------------------------------------------------------
   Buzzer passif simulé — reproduit dans le navigateur les sons du badge.
   -------------------------------------------------------------------------- */
HHO.audio = (function () {
  "use strict";
  let ctx = null;
  let alarmTimer = null;

  function context() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    return ctx;
  }
  function enabled() { return !!HHO.config.get().SOUND; }

  /** Les navigateurs exigent un geste utilisateur avant de jouer du son. */
  function unlock() {
    const c = context();
    if (c && c.state === "suspended") c.resume();
  }

  function tone(freq, dur, type, vol, delay) {
    const c = context();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    const t0 = c.currentTime + (delay || 0);
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function chime() { if (!enabled()) return; tone(660, 0.25, "sine", 0.12, 0); tone(880, 0.32, "sine", 0.12, 0.15); }

  function notify(level) {
    if (!enabled()) return;
    if (String(level).toLowerCase() === "critical") { tone(740, 0.18, "square", 0.06, 0); tone(740, 0.18, "square", 0.06, 0.24); }
    else tone(520, 0.2, "sine", 0.08, 0);
  }

  function siren() {
    const c = context();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    const t0 = c.currentTime;
    o.type = "sawtooth";
    o.frequency.setValueAtTime(880, t0);
    o.frequency.linearRampToValueAtTime(1320, t0 + 0.25);
    o.frequency.linearRampToValueAtTime(880, t0 + 0.5);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
    g.gain.linearRampToValueAtTime(0.001, t0 + 0.5);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + 0.52);
  }

  function startAlarm() {
    if (!enabled() || alarmTimer) return;
    siren();
    alarmTimer = setInterval(siren, 580);
  }
  function stopAlarm() { if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; } }

  function testAlarm() {
    unlock();
    siren(); setTimeout(siren, 580); setTimeout(siren, 1160);
  }

  return { unlock: unlock, chime: chime, notify: notify, startAlarm: startAlarm, stopAlarm: stopAlarm, testAlarm: testAlarm };
})();
