/* ==========================================================================
   Horizon Health OS — charts.js
   Mini-bibliothèque de graphiques en SVG pur (aucune dépendance externe,
   compatible Zéro-Cloud). Chaque graphique affiche un état vide explicite
   tant qu'aucune donnée n'a été reçue.
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.charts = (function () {
  "use strict";
  const U = HHO.util;

  const PALETTE = ["#4FD9E0", "#5FCB82", "#E3963D", "#B98CE0", "#E0C74F", "#E27A9E", "#7FA7E8", "#9ED36A", "#D98B5F", "#6FD1B5"];
  function colorAt(i) { return PALETTE[i % PALETTE.length]; }

  function fmtNum(v) {
    const a = Math.abs(v);
    return a >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  }

  function prepare(series) {
    return (series || []).map(function (s, i) {
      return {
        name: s.name,
        color: s.color || colorAt(i),
        dashed: !!s.dashed,
        points: (s.points || [])
          .map(function (p) { return { t: U.toMs(p.ts), v: U.num(p.value) }; })
          .filter(function (p) { return p.t != null && p.v != null; })
          .sort(function (a, b) { return a.t - b.t; })
      };
    }).filter(function (s) { return s.points.length; });
  }

  function legendHTML(items) {
    return '<div class="legend">' + items.map(function (s) {
      return '<span class="legend-chip"><span class="sw" style="background:' + s.color + '"></span>' + U.esc(s.name || "") + "</span>";
    }).join("") + "</div>";
  }

  /**
   * Courbe temporelle.
   * series : [{ name, color?, points: [{ ts, value }] }]
   * opts   : { height, min, max, step, threshold:{value,label}, yTicks:[{v,label}],
   *            emptyTitle, emptyHint, legend, area, ariaLabel }
   */
  function line(el, series, opts) {
    if (!el) return;
    opts = opts || {};
    const data = prepare(series);
    if (!data.length) {
      el.innerHTML = HHO.ui.emptyHTML(opts.emptyTitle || "Aucune donnée enregistrée", opts.emptyHint || "");
      return;
    }

    const W = Math.max(260, Math.floor(el.clientWidth || 560));
    const H = opts.height || 180;
    const P = { l: opts.yTicks ? 50 : 34, r: 12, t: 12, b: 22 };

    let tmin = Infinity, tmax = -Infinity, vmin = Infinity, vmax = -Infinity;
    data.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.t < tmin) tmin = p.t; if (p.t > tmax) tmax = p.t;
        if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v;
      });
    });
    if (opts.min != null) vmin = opts.min;
    if (opts.max != null) vmax = opts.max;
    if (vmax === vmin) { vmax += 1; vmin -= 1; }
    if (tmax === tmin) { tmax += 30000; tmin -= 30000; }

    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = function (t) { return P.l + (t - tmin) / (tmax - tmin) * iw; };
    const y = function (v) { return P.t + (1 - (U.clamp(v, vmin, vmax) - vmin) / (vmax - vmin)) * ih; };

    let svg = "";
    const ticks = opts.yTicks || [0, 1, 2, 3, 4].map(function (i) { return { v: vmin + (vmax - vmin) * i / 4 }; });
    ticks.forEach(function (tk) {
      const yy = y(tk.v).toFixed(1);
      svg += '<line class="ch-grid" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text class="ch-lbl" x="' + (P.l - 6) + '" y="' + yy + '" text-anchor="end" dominant-baseline="middle">' +
        U.esc(tk.label != null ? tk.label : fmtNum(tk.v)) + "</text>";
    });

    const span = tmax - tmin;
    const tf = span > 36 * 3600e3 ? U.fmtDate : U.fmtTime;
    [0, 1, 2, 3].forEach(function (i) {
      const t = tmin + span * i / 3;
      const anchor = i === 0 ? "start" : (i === 3 ? "end" : "middle");
      svg += '<text class="ch-lbl" x="' + x(t).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + anchor + '">' + tf(t) + "</text>";
    });

    if (opts.threshold && opts.threshold.value != null) {
      const ty = y(opts.threshold.value).toFixed(1);
      svg += '<line class="ch-thr" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + ty + '" y2="' + ty + '"/>';
      if (opts.threshold.label) svg += '<text class="ch-thr-lbl" x="' + (W - P.r - 4) + '" y="' + (ty - 5) + '" text-anchor="end">' + U.esc(opts.threshold.label) + "</text>";
    }

    data.forEach(function (s) {
      let d = "";
      s.points.forEach(function (p, i) {
        const px = x(p.t).toFixed(1), py = y(p.v).toFixed(1);
        if (i === 0) d += "M" + px + "," + py;
        else if (opts.step) d += "H" + px + "V" + py;
        else d += "L" + px + "," + py;
      });
      if (data.length === 1 && opts.area !== false) {
        const bottom = (P.t + ih).toFixed(1);
        svg += '<path d="' + d + "V" + bottom + "H" + x(s.points[0].t).toFixed(1) + 'Z" fill="' + s.color + '" fill-opacity=".08"/>';
      }
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.7" stroke-linejoin="round"' + (s.dashed ? ' stroke-dasharray="4 3"' : "") + "/>";
      const lp = s.points[s.points.length - 1];
      svg += '<circle cx="' + x(lp.t).toFixed(1) + '" cy="' + y(lp.v).toFixed(1) + '" r="2.8" fill="' + s.color + '"/>';
    });

    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" role="img" aria-label="' + U.esc(opts.ariaLabel || "Graphique") + '">' + svg + "</svg>" +
      (data.length > 1 || opts.legend ? legendHTML(data) : "");
  }

  /**
   * Radar (toile d'araignée).
   * axes   : [{ key, label }]
   * series : [{ name, color?, values: { key: 0..100 } }]
   */
  function radar(el, axes, series, opts) {
    if (!el) return;
    opts = opts || {};
    const data = (series || []).filter(function (s) {
      return axes.some(function (a) { return U.num(s.values[a.key]) != null; });
    }).map(function (s, i) { return Object.assign({ color: colorAt(i) }, s); });

    if (!data.length) {
      el.innerHTML = HHO.ui.emptyHTML(opts.emptyTitle || "Aucune donnée", opts.emptyHint || "");
      return;
    }

    const W = 300, H = 250, cx = W / 2, cy = H / 2 + 2, r = 86, n = axes.length;
    const ang = function (i) { return Math.PI * 2 * i / n - Math.PI / 2; };
    let svg = "";

    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      const pts = axes.map(function (_, i) { return (cx + Math.cos(ang(i)) * r * f).toFixed(1) + "," + (cy + Math.sin(ang(i)) * r * f).toFixed(1); }).join(" ");
      svg += '<polygon points="' + pts + '" fill="none" class="ch-grid"/>';
    });
    axes.forEach(function (a, i) {
      const c = Math.cos(ang(i)), s = Math.sin(ang(i));
      svg += '<line class="ch-grid" x1="' + cx + '" y1="' + cy + '" x2="' + (cx + c * r).toFixed(1) + '" y2="' + (cy + s * r).toFixed(1) + '"/>';
      const anchor = c > 0.3 ? "start" : (c < -0.3 ? "end" : "middle");
      svg += '<text class="ch-lbl" x="' + (cx + c * (r + 12)).toFixed(1) + '" y="' + (cy + s * (r + 12)).toFixed(1) + '" text-anchor="' + anchor + '" dominant-baseline="middle">' + U.esc(a.label) + "</text>";
    });
    data.forEach(function (sr) {
      const pts = axes.map(function (a, i) {
        const v = U.clamp(U.num(sr.values[a.key]) || 0, 0, 100) / 100;
        return (cx + Math.cos(ang(i)) * r * v).toFixed(1) + "," + (cy + Math.sin(ang(i)) * r * v).toFixed(1);
      }).join(" ");
      svg += '<polygon points="' + pts + '" fill="' + sr.color + '" fill-opacity=".09" stroke="' + sr.color + '" stroke-width="1.6" stroke-linejoin="round"/>';
    });

    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" width="100%" style="max-height:' + H + 'px" role="img" aria-label="' + U.esc(opts.ariaLabel || "Radar") + '">' + svg + "</svg>" + legendHTML(data);
  }

  /**
   * Jauge circulaire.
   * value : nombre ou null (affiche "—")
   * opts  : { size, stroke, max, unit, label, color, warnAt, threshold }
   */
  function ring(el, value, opts) {
    if (!el) return;
    opts = opts || {};
    const size = opts.size || 96, stroke = opts.stroke || 8, max = opts.max || 100;
    const r = (size - stroke) / 2 - 1, c = size / 2, circ = 2 * Math.PI * r;
    const v = value == null ? null : U.clamp(value, 0, max);
    const color = opts.color || (v != null && opts.warnAt != null && v >= opts.warnAt ? "var(--orange)" : "var(--cyan)");

    let marker = "";
    if (opts.threshold != null) {
      const a = (opts.threshold / max) * Math.PI * 2 - Math.PI / 2;
      const r1 = r - stroke / 2 - 2, r2 = r + stroke / 2 + 2;
      marker = '<line x1="' + (c + Math.cos(a) * r1).toFixed(1) + '" y1="' + (c + Math.sin(a) * r1).toFixed(1) +
        '" x2="' + (c + Math.cos(a) * r2).toFixed(1) + '" y2="' + (c + Math.sin(a) * r2).toFixed(1) + '" stroke="var(--text-dim)" stroke-width="1.5"/>';
    }
    const arc = v == null ? "" :
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + (circ * (1 - v / max)).toFixed(2) +
      '" transform="rotate(-90 ' + c + " " + c + ')" style="transition:stroke-dashoffset .5s ease"/>';

    const fs = Math.round(size * 0.2);
    el.innerHTML = '<div class="ring" style="width:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--border-soft)" stroke-width="' + stroke + '"/>' + arc + marker + "</svg>" +
      '<div class="ring-val" style="top:' + (size / 2 - fs * 0.65) + "px;font-size:" + fs + 'px">' + (v == null ? "—" : Math.round(v) + (opts.unit || "")) + "</div>" +
      (opts.label ? '<div class="ring-lbl">' + U.esc(opts.label) + "</div>" : "") + "</div>";
  }

  return { line: line, radar: radar, ring: ring, colorAt: colorAt, PALETTE: PALETTE };
})();
