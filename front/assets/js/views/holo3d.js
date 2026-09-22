/* ==========================================================================
   Horizon Health OS — views/holo3d.js
   Hologramme 3D temps réel de l'astronaute suivi (three.js, copie locale :
   assets/vendor/three/three.min.js — aucune ressource externe).

   Corps : maillage humain réel dérivé du modèle de base MakeHuman (licence
   CC0, domaine public — assets/models/human-mesh.js), morphologie homme
   musclé. Si ce fichier est absent, un mannequin procédural le remplace.
   Rendu :
     - peau holographique : effet Fresnel, lumière principale, lignes de
       balayage, bande de scan, scintillement, maillage filaire discret ;
     - passe de profondeur : seule la surface visible s'éclaire ;
     - squelette rouge placé sur les articulations réelles du modèle,
       cœur qui bat au rythme cardiaque reçu du Bio-Badge ;
     - socle cylindrique lumineux, cône de projection, sol pointillé.
   Si WebGL ou three.js sont indisponibles, create() renvoie null et la vue
   d'accueil garde l'hologramme vectoriel (SVG).
   ========================================================================== */
window.HHO = window.HHO || {};

HHO.holo3d = (function () {
  "use strict";

  const LEVEL_COLORS = { g: 0x6FD8FF, o: 0xF2B34B, r: 0xFF4D5A, n: 0x47747C };
  const BONE_COLOR = 0xFF5A4A;
  const FEVER_COLOR = 0xF2B34B;

  /* ---------------- Shaders ---------------- */
  const SHELL_VS = [
    "varying vec3 vN;",
    "varying vec3 vV;",
    "varying float vY;",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vY = wp.y;",
    "  vN = normalize(normalMatrix * normal);",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vV = normalize(-mv.xyz);",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");

  const SHELL_FS = [
    "uniform vec3 uColor;",
    "uniform vec3 uFeverColor;",
    "uniform float uFever;",
    "uniform float uHeadY;",
    "uniform float uTime;",
    "uniform float uScan;",
    "uniform float uOpacity;",
    "varying vec3 vN;",
    "varying vec3 vV;",
    "varying float vY;",
    "void main() {",
    "  vec3 n = normalize(vN);",
    "  vec3 v = normalize(vV);",
    "  vec3 baseCol = mix(uColor, uFeverColor, uFever * smoothstep(uHeadY - 0.03, uHeadY + 0.03, vY));",
    "  float ndv = clamp(dot(n, v), 0.0, 1.0);",
    "  float fres = pow(1.0 - ndv, 2.3);",
    "  float key = clamp(dot(n, normalize(vec3(-0.5, 0.55, 0.7))), 0.0, 1.0);",
    "  float fill = clamp(dot(n, normalize(vec3(0.7, -0.1, 0.4))), 0.0, 1.0);",
    "  float lines = 0.82 + 0.18 * step(0.5, fract(vY * 150.0 - uTime * 0.9));",
    "  float band = exp(-pow((vY - uScan) * 26.0, 2.0));",
    "  float flick = 0.96 + 0.04 * sin(uTime * 43.0) * sin(uTime * 7.3);",
    "  vec3 col = baseCol * (0.1 + key * 1.05 + fill * 0.18 + fres * 1.2) * lines * flick;",
    "  col += mix(baseCol, vec3(1.0), 0.45) * band * 0.32;",
    "  float a = clamp((0.2 + key * 0.45 + fres * 0.7 + band * 0.22) * uOpacity, 0.0, 1.0);",
    "  gl_FragColor = vec4(col, a);",
    "}"
  ].join("\n");

  const BONE_FS = [
    "uniform vec3 uColor;",
    "uniform float uOpacity;",
    "varying vec3 vN;",
    "varying vec3 vV;",
    "varying float vY;",
    "void main() {",
    "  vec3 n = normalize(vN);",
    "  vec3 v = normalize(vV);",
    "  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);",
    "  float key = clamp(dot(n, normalize(vec3(-0.5, 0.55, 0.7))), 0.0, 1.0);",
    "  vec3 col = uColor * (0.35 + key * 0.75) + vec3(1.0, 0.78, 0.72) * pow(key, 12.0) * 0.6 + uColor * fres * 0.5;",
    "  gl_FragColor = vec4(col, uOpacity * (0.62 + fres * 0.3));",
    "}"
  ].join("\n");

  const CONE_FS = [
    "uniform vec3 uColor;",
    "uniform float uTime;",
    "varying vec3 vN;",
    "varying vec3 vV;",
    "varying float vY;",
    "void main() {",
    "  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);",
    "  float fade = clamp(1.0 - (vY + 0.05) / 2.3, 0.0, 1.0);",
    "  float pulse = 0.85 + 0.15 * sin(uTime * 1.8);",
    "  float a = fade * fade * (0.025 + fres * 0.32) * pulse;",
    "  gl_FragColor = vec4(uColor, a);",
    "}"
  ].join("\n");

  const FLOOR_VS = [
    "varying vec2 vP;",
    "void main() {",
    "  vP = position.xy;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n");

  const FLOOR_FS = [
    "uniform vec3 uColor;",
    "uniform float uTime;",
    "varying vec2 vP;",
    "void main() {",
    "  float r = length(vP);",
    "  float glow = exp(-r * r * 1.6) * 0.35;",
    "  vec2 g = abs(fract(vP * 6.0) - 0.5);",
    "  float dotm = smoothstep(0.08, 0.02, length(g));",
    "  float grid = dotm * smoothstep(2.4, 0.4, r) * 0.55;",
    "  float ring = smoothstep(0.02, 0.0, abs(r - fract(uTime * 0.25) * 2.2)) * smoothstep(2.2, 0.8, r) * 0.25;",
    "  gl_FragColor = vec4(uColor, glow + grid + ring);",
    "}"
  ].join("\n");

  /* ---------------- Construction de la scène ---------------- */
  function buildScene(T) {
    const HM = window.HHO && HHO.humanMesh;           // maillage humain CC0 (sinon : mannequin procédural)
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(24, 0.8, 0.1, 50);
    const CAM = HM ? { y: 0.98, look: 0.82, z: 5.2 } : { y: 1.05, look: 0.86, z: 5.4 };
    camera.position.set(0, CAM.y, CAM.z);
    camera.lookAt(0, CAM.look, 0);

    const shared = {
      uTime: { value: 0 }, uScan: { value: 2 }, uOpacity: { value: 1 },
      uFever: { value: 0 }, uFeverColor: { value: new T.Color(FEVER_COLOR) }
    };
    const bodyColor = new T.Color(LEVEL_COLORS.g);
    const headColor = new T.Color(LEVEL_COLORS.g);

    function shellMat(color, headY) {
      return new T.ShaderMaterial({
        uniforms: {
          uColor: { value: color }, uTime: shared.uTime, uScan: shared.uScan, uOpacity: shared.uOpacity,
          uFever: shared.uFever, uFeverColor: shared.uFeverColor, uHeadY: { value: headY }
        },
        vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
        transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthFunc: T.LessEqualDepth
      });
    }
    const matBody = shellMat(bodyColor, 99);          // uHeadY réglé plus bas pour le maillage humain
    const matHead = shellMat(headColor, 99);
    const matDepth = new T.MeshBasicMaterial({ colorWrite: false });
    const matWire = new T.MeshBasicMaterial({ color: bodyColor, wireframe: true, transparent: true, opacity: 0.04, blending: T.AdditiveBlending, depthWrite: false });
    const boneUniforms = { uColor: { value: new T.Color(BONE_COLOR) }, uOpacity: { value: 0.55 } };
    const matBone = new T.ShaderMaterial({
      uniforms: boneUniforms, vertexShader: SHELL_VS, fragmentShader: BONE_FS,
      transparent: true, depthTest: false, depthWrite: false
    });

    const SPH = new T.SphereGeometry(1, 36, 24);
    const up = new T.Vector3(0, 1, 0);

    const root = new T.Group();                       // pivote (balancement + souris)
    scene.add(root);
    const skin = [];                                  // [geometry, matrix, isHead] (mannequin procédural)
    const bones = new T.Group();
    bones.renderOrder = 2;
    root.add(bones);

    function place(geo, pos, scale, rot, isHead) {
      const m = new T.Matrix4();
      const q = rot instanceof T.Quaternion ? rot : new T.Quaternion().setFromEuler(new T.Euler(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0));
      m.compose(new T.Vector3(pos[0], pos[1], pos[2]), q, new T.Vector3(scale[0], scale[1], scale[2]));
      skin.push([geo, m, !!isHead]);
    }
    function ell(p, s, r, mirror, head) {
      place(SPH, p, s, r, head);
      if (mirror) place(SPH, [-p[0], p[1], p[2]], s, r ? [r[0], -r[1], -r[2]] : null, head);
    }
    function limb(a, b, r1, r2, mirror) {
      const A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]);
      const dir = B.clone().sub(A), len = dir.length();
      const geo = new T.CylinderGeometry(r2, r1, len, 32, 1, true);
      const q = new T.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      const mid = A.clone().add(B).multiplyScalar(0.5);
      place(geo, [mid.x, mid.y, mid.z], [1, 1, 1], q);
      place(SPH, a, [r1, r1, r1]);
      place(SPH, b, [r2, r2, r2]);
      if (mirror) limb([-a[0], a[1], a[2]], [-b[0], b[1], b[2]], r1, r2, false);
    }
    function bone(a, b, r, mirror) {
      const A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]);
      const dir = B.clone().sub(A), len = dir.length();
      if (len < 1e-4) return;
      const shaft = new T.Mesh(new T.CylinderGeometry(r * 0.8, r * 0.8, len, 14, 1, true), matBone);
      shaft.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      shaft.position.copy(A.clone().add(B).multiplyScalar(0.5));
      bones.add(shaft);
      [A, B].forEach(function (P) {
        const e = new T.Mesh(SPH, matBone);
        e.position.copy(P);
        e.scale.setScalar(r * 1.15);
        bones.add(e);
      });
      if (mirror) bone([-a[0], a[1], a[2]], [-b[0], b[1], b[2]], r, false);
    }
    function boneEll(p, s, r, mirror) {
      const m = new T.Mesh(SPH, matBone);
      m.position.set(p[0], p[1], p[2]);
      m.scale.set(s[0], s[1], s[2]);
      if (r) m.rotation.set(r[0], r[1], r[2]);
      bones.add(m);
      if (mirror) boneEll([-p[0], p[1], p[2]], s, r ? [r[0], -r[1], -r[2]] : null, false);
    }

    let heartPos = [0.028, 1.305, 0.035], badgePos = [-0.085, 1.37, 0.118];
    const tinted = [matWire];                       // matériaux qui suivent la couleur d'état

    /* ===== Corps humain réel (maillage MakeHuman, licence CC0) ===== */
    function decode(b64) {
      const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Uint16Array(u8.buffer);
    }

    function humanFromMesh() {
      const q = decode(HM.positions), idx = decode(HM.indices);
      const pos = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) { const k = i % 3; pos[i] = HM.bboxMin[k] + q[i] / 65535 * (HM.bboxMax[k] - HM.bboxMin[k]); }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeVertexNormals();

      const J = HM.joints, mk = HM.marks;
      matBody.uniforms.uHeadY.value = J.neck[1] + 0.06;           // zone « tête » pour la fièvre
      const dm = new T.Mesh(geo, matDepth); dm.renderOrder = 1; root.add(dm);
      const cm = new T.Mesh(geo, matBody); cm.renderOrder = 3; root.add(cm);
      const wm = new T.Mesh(geo, matWire); wm.renderOrder = 4; root.add(wm);

      const V = function (n) { return J[n] ? new T.Vector3(J[n][0], J[n][1], J[n][2]) : null; };
      const arr = function (v) { return [v.x, v.y, v.z]; };
      const hd = mk.head, ch = mk.chest;

      // Crâne et mâchoire
      boneEll([0, hd.c[1] + 0.008, hd.c[2] - 0.006], [hd.h[0] * 0.78, hd.h[1] * 0.7, hd.h[2] * 0.76]);
      boneEll([0, hd.c[1] - hd.h[1] * 0.62, hd.c[2] + hd.h[2] * 0.12], [hd.h[0] * 0.5, hd.h[1] * 0.16, hd.h[2] * 0.5]); // mandibule

      // Colonne vertébrale le long des articulations
      const chain = ["pelvis", "spine-1", "spine-2", "spine-3", "spine-4", "neck", "head"].map(V).filter(Boolean);
      chain.sort(function (a, b) { return a.y - b.y; });
      for (let i = 0; i + 1 < chain.length; i++) {
        const A = chain[i], B = chain[i + 1], d = B.clone().sub(A), L = d.length();
        const n = Math.max(1, Math.round(L / 0.022));
        for (let k = 0; k < n; k++) {
          const P = A.clone().add(d.clone().multiplyScalar((k + 0.5) / n));
          const vtb = new T.Mesh(new T.CylinderGeometry(0.0115, 0.0115, 0.014, 10), matBone);
          vtb.position.copy(P);
          vtb.quaternion.setFromUnitVectors(up, d.clone().normalize());
          bones.add(vtb);
        }
      }

      // Cage thoracique
      const top = J["l-clavicle"][1] - 0.035;
      const bottom = Math.min(J["spine-2"][1], J["spine-3"][1]) + 0.01;
      for (let i = 0; i < 11; i++) {
        const y = top - (top - bottom) * i / 10;
        const R = ch.h[0] * (0.5 + 0.32 * Math.sin(Math.PI * (i + 1.4) / 12.5));
        const rib = new T.Mesh(new T.TorusGeometry(R, 0.0042, 6, 44, Math.PI * 1.72), matBone);
        rib.rotation.set(Math.PI / 2 + 0.28, 0, Math.PI / 2 + Math.PI * 0.14);
        rib.scale.set(1, (ch.h[2] / ch.h[0]) * 1.05, 1);
        rib.position.set(0, y, ch.c[2] + 0.004);
        bones.add(rib);
      }
      boneEll([0, (top + bottom) / 2 + 0.03, ch.c[2] + ch.h[2] * 0.78], [0.012, (top - bottom) * 0.42, 0.006]); // sternum

      ["l", "r"].forEach(function (sd) {
        const P = function (n) { return V(sd + "-" + n); };
        const sgn = sd === "l" ? 1 : -1;
        const sh = P("shoulder"), el = P("elbow"), ha = P("hand");
        bone([sgn * 0.02, J[sd + "-clavicle"][1], ch.c[2] + ch.h[2] * 0.7], arr(sh), 0.008);   // clavicule
        bone(arr(sh), arr(el), 0.014);                                                          // humérus
        bone([el.x, el.y, el.z + 0.008], [ha.x, ha.y, ha.z + 0.01], 0.0075);                    // radius
        bone([el.x, el.y - 0.006, el.z - 0.008], [ha.x - sgn * 0.004, ha.y - 0.004, ha.z - 0.008], 0.0068); // cubitus
        for (let f = 1; f <= 5; f++) {                                                          // métacarpes, phalanges
          let prev = ha;
          for (let k = 1; k <= 4; k++) {
            const jn = P("finger-" + f + "-" + k);
            if (!jn) continue;
            bone(arr(prev), arr(jn), k === 1 ? 0.004 : 0.0034);
            prev = jn;
          }
        }
        const ul = P("upper-leg"), kn = P("knee"), an = P("ankle");
        boneEll([ul.x * 0.8, ul.y + 0.06, J.pelvis[2] + 0.02], [0.045, 0.038, 0.013], [0.35, sgn * 0.5, sgn * 0.55]); // os iliaque
        bone([sgn * 0.022, ul.y - 0.035, J.pelvis[2] + 0.07], [ul.x * 0.7, ul.y - 0.015, J.pelvis[2] + 0.055], 0.008);        // pubis
        bone(arr(ul), arr(kn), 0.016);                                                          // fémur
        boneEll([kn.x, kn.y + 0.005, kn.z + 0.055], [0.018, 0.021, 0.01]);                      // rotule
        bone(arr(kn), arr(an), 0.013);                                                          // tibia
        bone([kn.x + sgn * 0.024, kn.y - 0.03, kn.z - 0.01], [an.x + sgn * 0.02, an.y + 0.03, an.z - 0.01], 0.0065); // péroné
        const f1 = P("foot-1"), f2 = P("foot-2");
        if (f1) bone(arr(an), arr(f1), 0.008);
        if (f1 && f2) bone(arr(f1), arr(f2), 0.006);
        for (let tI = 1; tI <= 5; tI++) {                                                       // orteils
          let prev = f1 || an;
          for (let k = 1; k <= 4; k++) {
            const jn = P("toe-" + tI + "-" + k);
            if (!jn) continue;
            bone(arr(prev), arr(jn), 0.004);
            prev = jn;
          }
        }
      });
      boneEll([0, J.pelvis[1] + 0.03, J.pelvis[2] - 0.035], [0.03, 0.05, 0.02]);              // sacrum

      heartPos = [ch.c[0] + 0.03, ch.c[1] - 0.035, ch.c[2] + ch.h[2] * 0.35];
      badgePos = [mk.badge[0], mk.badge[1], mk.badge[2] + 0.006];
    }

    /* ===== Mannequin procédural (repli si le maillage est absent) ===== */
    function procedural() {
      matHead.uniforms.uHeadY.value = -99;              // la tête a son propre matériau
      /* ----- Tête (style mannequin : traits sculptés, sans yeux peints) ----- */
      ell([0, 1.678, 0], [0.087, 0.11, 0.1], null, false, true);            // crâne
      ell([0, 1.612, 0.02], [0.064, 0.056, 0.074], null, false, true);      // mâchoire
      ell([0, 1.575, 0.052], [0.03, 0.022, 0.03], null, false, true);       // menton
      ell([0.042, 1.636, 0.058], [0.03, 0.026, 0.03], null, true, true);   // pommettes
      ell([0, 1.692, 0.074], [0.066, 0.017, 0.03], null, false, true);      // arcade sourcilière
      ell([0, 1.646, 0.096], [0.012, 0.03, 0.02], [0.25, 0, 0], false, true); // nez
      ell([0, 1.626, 0.1], [0.018, 0.009, 0.012], null, false, true);        // ailes du nez
      ell([0, 1.603, 0.082], [0.023, 0.008, 0.012], null, false, true);      // lèvre supérieure
      ell([0, 1.593, 0.08], [0.021, 0.008, 0.012], null, false, true);       // lèvre inférieure
      ell([0.085, 1.655, -0.004], [0.01, 0.026, 0.016], null, true, true); // oreilles
      ell([0.032, 1.662, 0.074], [0.018, 0.01, 0.014], null, true, true);  // paupières

      /* ----- Cou ----- */
      limb([0, 1.49, -0.008], [0, 1.585, 0.0], 0.06, 0.052);
      limb([0.055, 1.605, -0.012], [0.016, 1.49, 0.05], 0.013, 0.011, true); // sterno-cléido-mastoïdiens
      ell([0.085, 1.498, -0.03], [0.1, 0.038, 0.06], [0, 0, -0.35], true);   // trapèzes

      /* ----- Tronc ----- */
      const prof = [[0.0, 0.9], [0.1, 0.905], [0.152, 0.93], [0.166, 0.97], [0.162, 1.01], [0.146, 1.06],
        [0.14, 1.1], [0.147, 1.16], [0.161, 1.22], [0.174, 1.28], [0.181, 1.34], [0.178, 1.4],
        [0.16, 1.45], [0.11, 1.49], [0.06, 1.51], [0.0, 1.515]].map(function (p) { return new T.Vector2(p[0], p[1]); });
      place(new T.LatheGeometry(prof, 48), [0, 0, 0], [1, 1, 0.64]);
      ell([0.072, 1.346, 0.08], [0.084, 0.056, 0.04], [0, 0, 0.18], true);   // pectoraux
      [1.245, 1.186, 1.127].forEach(function (y) { ell([0.033, y, 0.086], [0.029, 0.025, 0.014], null, true); }); // abdominaux
      ell([0.03, 1.07, 0.083], [0.026, 0.03, 0.012], null, true);
      ell([0.118, 1.13, 0.03], [0.036, 0.085, 0.05], null, true);             // obliques
      [1.24, 1.275, 1.31].forEach(function (y) { ell([0.14, y, 0.05], [0.018, 0.014, 0.022], [0, 0, -0.5], true); }); // dentelés
      ell([0.112, 1.3, -0.05], [0.066, 0.115, 0.046], null, true);              // grands dorsaux
      ell([0.075, 0.963, -0.075], [0.085, 0.095, 0.066], null, true);         // fessiers
      ell([0.212, 1.446, 0.0], [0.068, 0.063, 0.07], null, true);            // deltoïdes

      /* ----- Bras en croix ----- */
      limb([0.22, 1.44, 0], [0.5, 1.435, 0], 0.056, 0.045, true);
      ell([0.335, 1.438, 0.018], [0.1, 0.043, 0.042], null, true);             // biceps
      ell([0.33, 1.442, -0.018], [0.11, 0.044, 0.04], null, true);            // triceps
      limb([0.5, 1.435, 0], [0.765, 1.43, 0], 0.045, 0.03, true);             // avant-bras
      ell([0.57, 1.434, 0], [0.085, 0.044, 0.045], null, true);
      ell([0.828, 1.428, 0], [0.055, 0.018, 0.042], null, true);              // paume
      [[0.03, 0.93], [0.01, 0.957], [-0.01, 0.95], [-0.03, 0.928]].forEach(function (d) {
        limb([0.872, 1.428, d[0]], [d[1], 1.426, d[0] * 1.08], 0.0098, 0.008, true);     // doigts
      });
      limb([0.8, 1.425, 0.036], [0.848, 1.42, 0.074], 0.012, 0.009, true);    // pouces

      /* ----- Jambes ----- */
      limb([0.095, 0.93, 0], [0.1, 0.52, 0.01], 0.088, 0.055, true);          // cuisses
      ell([0.098, 0.76, 0.045], [0.046, 0.14, 0.04], null, true);             // droit fémoral
      ell([0.132, 0.72, 0.012], [0.034, 0.13, 0.05], null, true);              // vaste externe
      ell([0.072, 0.6, 0.034], [0.034, 0.058, 0.034], null, true);             // vaste interne
      ell([0.1, 0.74, -0.04], [0.058, 0.14, 0.05], null, true);                // ischio-jambiers
      ell([0.062, 0.8, 0.0], [0.038, 0.1, 0.05], null, true);                  // adducteurs
      ell([0.1, 0.506, 0.012], [0.05, 0.05, 0.05], null, true);               // genoux
      ell([0.1, 0.512, 0.056], [0.025, 0.03, 0.013], null, true);             // rotules
      limb([0.1, 0.49, 0], [0.105, 0.09, 0], 0.052, 0.031, true);              // jambes
      ell([0.1, 0.39, -0.026], [0.048, 0.1, 0.048], null, true);                // mollets
      ell([0.11, 0.35, 0.022], [0.024, 0.1, 0.024], null, true);              // jambiers antérieurs
      ell([0.105, 0.08, 0], [0.034, 0.034, 0.034], null, true);               // chevilles
      ell([0.108, 0.035, 0.05], [0.042, 0.03, 0.11], null, true);             // pieds
      ell([0.108, 0.024, 0.148], [0.04, 0.018, 0.03], null, true);            // orteils

      // Deux passes par pièce de peau : profondeur puis couleur (+ maillage discret)
      skin.forEach(function (s) {
        const d = new T.Mesh(s[0], matDepth);
        d.applyMatrix4(s[1]);
        d.renderOrder = 1;
        root.add(d);
        const c = new T.Mesh(s[0], s[2] ? matHead : matBody);
        c.applyMatrix4(s[1]);
        c.renderOrder = 3;
        root.add(c);
        if (s[0] !== SPH) {
          const w = new T.Mesh(s[0], matWire);
          w.applyMatrix4(s[1]);
          w.renderOrder = 4;
          root.add(w);
        }
      });

      /* ----- Squelette ----- */
      bones.renderOrder = 2;
      boneEll([0, 1.688, -0.014], [0.058, 0.07, 0.064]);                           // crâne
      boneEll([0, 1.608, 0.01], [0.044, 0.018, 0.046]);                       // mandibule
      for (let i = 0; i < 26; i++) {                                          // colonne
        const y = 0.98 + i * 0.0225;
        const v = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.015, 10), matBone);
        v.position.set(0, y, -0.045 + 0.018 * Math.sin((y - 0.98) * 5.5));
        bones.add(v);
      }
      for (let i = 0; i < 10; i++) {                                          // côtes
        const R = 0.085 + 0.048 * Math.sin(Math.PI * (i + 1.6) / 11.5);
        const rib = new T.Mesh(new T.TorusGeometry(R, 0.0042, 6, 44, Math.PI * 1.72), matBone);
        rib.rotation.set(Math.PI / 2 + 0.28, 0, Math.PI / 2 + Math.PI * 0.14);
        rib.scale.set(1, 0.72, 1);
        rib.position.set(0, 1.435 - i * 0.03, -0.012);
        bones.add(rib);
      }
      boneEll([0, 1.35, 0.088], [0.013, 0.07, 0.006]);                        // sternum
      bone([0.015, 1.472, 0.07], [0.19, 1.476, 0.0], 0.008, true);            // clavicules
      boneEll([0.068, 1.0, -0.012], [0.058, 0.048, 0.016], [0.35, 0.5, 0.55], true); // os iliaques
      bone([0.03, 0.935, 0.045], [0.075, 0.95, 0.03], 0.008, true);          // pubis
      boneEll([0, 0.965, -0.05], [0.03, 0.05, 0.02]);                         // sacrum
      bone([0.22, 1.44, 0], [0.5, 1.436, 0], 0.014, true);                    // humérus
      bone([0.51, 1.438, 0.008], [0.765, 1.432, 0.012], 0.008, true);         // radius
      bone([0.51, 1.43, -0.008], [0.765, 1.428, -0.01], 0.007, true);         // cubitus
      [[0.03, 0.93], [0.01, 0.955], [-0.01, 0.948], [-0.03, 0.926]].forEach(function (d) {
        bone([0.79, 1.43, d[0] * 0.6], [0.872, 1.429, d[0]], 0.004, true);
        bone([0.876, 1.428, d[0]], [d[1] - 0.006, 1.426, d[0] * 1.08], 0.0035, true);
      });
      bone([0.095, 0.93, 0], [0.1, 0.527, 0.008], 0.016, true);               // fémurs
      boneEll([0.1, 0.51, 0.042], [0.018, 0.02, 0.01], null, true);           // rotules
      bone([0.1, 0.49, 0.004], [0.105, 0.1, 0], 0.013, true);                 // tibias
      bone([0.126, 0.48, -0.012], [0.126, 0.11, -0.01], 0.0065, true);        // péronés
      [-0.02, 0, 0.02].forEach(function (dz) {
        bone([0.106, 0.075, -0.01], [0.108 + dz * 0.6, 0.03, 0.14], 0.005, true); // pieds
      });
      skin.forEach(function (s) {
        const d = new T.Mesh(s[0], matDepth);
        d.applyMatrix4(s[1]);
        d.renderOrder = 1;
        root.add(d);
        const c = new T.Mesh(s[0], s[2] ? matHead : matBody);
        c.applyMatrix4(s[1]);
        c.renderOrder = 3;
        root.add(c);
        if (s[0] !== SPH) {
          const w = new T.Mesh(s[0], matWire);
          w.applyMatrix4(s[1]);
          w.renderOrder = 4;
          root.add(w);
        }
      });
    }

    if (HM && HM.positions && HM.joints && HM.marks) humanFromMesh(); else procedural();

    /* ----- Cœur (bat au rythme reçu) ----- */
    const heartMat = new T.ShaderMaterial({
      uniforms: { uColor: { value: new T.Color(0xFF3B4E) }, uOpacity: { value: 0.95 } },
      vertexShader: SHELL_VS, fragmentShader: BONE_FS, transparent: true, depthTest: false, depthWrite: false
    });
    const heart = new T.Group();
    [[-0.012, 0.012], [0.012, 0.012]].forEach(function (o) {
      const lobe = new T.Mesh(SPH, heartMat);
      lobe.position.set(o[0], o[1], 0);
      lobe.scale.set(0.018, 0.018, 0.018);
      heart.add(lobe);
    });
    const tip = new T.Mesh(new T.ConeGeometry(0.026, 0.045, 20), heartMat);
    tip.rotation.z = Math.PI;
    tip.position.y = -0.012;
    heart.add(tip);
    heart.position.set(heartPos[0], heartPos[1], heartPos[2]);
    heart.rotation.z = -0.35;
    heart.renderOrder = 5;
    root.add(heart);

    /* ----- Emplacement du Bio-Badge ----- */
    const badgeMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false });
    const badge = new T.Mesh(new T.SphereGeometry(0.009, 16, 12), badgeMat);
    badge.position.set(badgePos[0], badgePos[1], badgePos[2]);
    badge.renderOrder = 6;
    root.add(badge);
    const ringMat = new T.MeshBasicMaterial({ color: bodyColor, transparent: true, depthTest: false, blending: T.AdditiveBlending });
    tinted.push(ringMat);
    const ring = new T.Mesh(new T.TorusGeometry(0.02, 0.0025, 8, 32), ringMat);
    ring.position.copy(badge.position);
    ring.renderOrder = 6;
    root.add(ring);

    /* ----- Socle, cône de projection, sol ----- */
    const base = new T.Group();
    scene.add(base);
    const glowMat = function (op) { const m = new T.MeshBasicMaterial({ color: bodyColor, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false }); tinted.push(m); return m; };
    const pedestal = new T.Mesh(new T.CylinderGeometry(0.62, 0.66, 0.12, 72, 1), new T.MeshBasicMaterial({ color: 0x07131A }));
    pedestal.position.y = -0.08;
    base.add(pedestal);
    const topDisc = new T.Mesh(new T.CircleGeometry(0.62, 72), new T.MeshBasicMaterial({ color: 0x0A1C24 }));
    topDisc.rotation.x = -Math.PI / 2;
    topDisc.position.y = -0.019;
    base.add(topDisc);
    [[0.62, 0.009, 1, -0.02], [0.62, 0.03, 0.18, -0.02], [0.66, 0.012, 0.9, -0.14], [0.42, 0.004, 0.55, -0.017]].forEach(function (r) {
      const t = new T.Mesh(new T.TorusGeometry(r[0], r[1], 8, 96), glowMat(r[2]));
      t.rotation.x = Math.PI / 2;
      t.position.y = r[3];
      base.add(t);
    });
    const dashes = new T.Group();                      // anneau pointillé tournant
    for (let i = 0; i < 40; i++) {
      const d = new T.Mesh(new T.BoxGeometry(0.045, 0.004, 0.008), glowMat(0.8));
      const a = i / 40 * Math.PI * 2;
      d.position.set(Math.cos(a) * 0.52, -0.016, Math.sin(a) * 0.52);
      d.rotation.y = -a + Math.PI / 2;
      dashes.add(d);
    }
    base.add(dashes);
    const floor = new T.Mesh(new T.PlaneGeometry(5, 5), new T.ShaderMaterial({
      uniforms: { uColor: { value: bodyColor }, uTime: shared.uTime },
      vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS,
      transparent: true, blending: T.AdditiveBlending, depthWrite: false
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.145;
    base.add(floor);
    const cone = new T.Mesh(new T.CylinderGeometry(1.0, 0.6, 2.3, 72, 1, true), new T.ShaderMaterial({
      uniforms: { uColor: { value: bodyColor }, uTime: shared.uTime },
      vertexShader: SHELL_VS, fragmentShader: CONE_FS,
      transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide
    }));
    cone.position.y = 1.13;
    cone.renderOrder = 7;
    base.add(cone);

    /* ----- État et animation ----- */
    const st = { level: "g", bpm: 72, fever: false, signal: true, beat: 0, userAngle: 0 };
    const target = new T.Color(LEVEL_COLORS.g);
    const headTarget = new T.Color(LEVEL_COLORS.g);

    function setState(s) {
      if (s.level !== undefined) st.level = s.level || "n";
      if (s.bpm !== undefined) st.bpm = s.bpm;
      if (s.fever !== undefined) st.fever = !!s.fever;
      if (s.signal !== undefined) st.signal = !!s.signal;
      target.setHex(LEVEL_COLORS[st.level] || LEVEL_COLORS.n);
      headTarget.setHex(st.fever ? FEVER_COLOR : (LEVEL_COLORS[st.level] || LEVEL_COLORS.n));
      boneUniforms.uColor.value.setHex(st.level === "r" ? 0xFFD0C8 : BONE_COLOR);
    }

    function update(t, dt) {
      shared.uTime.value = t;
      shared.uScan.value = 1.95 - ((t * 0.32) % 1) * 2.2;          // bande de scan descendante
      shared.uOpacity.value += ((st.signal ? 1 : 0.4) - shared.uOpacity.value) * Math.min(1, dt * 3);
      shared.uFever.value += ((st.fever ? 1 : 0) - shared.uFever.value) * Math.min(1, dt * 2.5);
      bodyColor.lerp(target, Math.min(1, dt * 2.5));
      headColor.lerp(headTarget, Math.min(1, dt * 2.5));
      tinted.forEach(function (m) { m.color.copy(bodyColor); });

      root.rotation.y = st.userAngle + Math.sin(t * 0.33) * 0.55;    // balancement autour de l'angle choisi

      const period = 60 / Math.max(30, Math.min(200, st.bpm || 72));  // battement réel (double impulsion)
      st.beat = (st.beat + dt / period) % 1;
      const p = st.beat;
      const k = 1 + 0.38 * Math.exp(-p * 16) + 0.16 * Math.exp(-Math.pow(p - 0.28, 2) * 260);
      heart.scale.setScalar(k);
      heartMat.uniforms.uOpacity.value = 0.7 + 0.3 * (k - 1) / 0.38;

      const bp = (t * 0.7) % 1;                                       // pulsation du Bio-Badge
      ring.scale.setScalar(0.6 + bp * 1.6);
      ringMat.opacity = 1 - bp;
      badgeMat.opacity = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.2));

      dashes.rotation.y = -t * 0.35;
    }

    setState({});
    return { scene: scene, camera: camera, camZ: CAM.z, update: update, setState: setState, state: st, root: root, human: !!(HM && HM.positions) };
  }

  /* ---------------- Intégration dans la page ---------------- */
  function supported() {
    if (!window.THREE) return false;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) { return false; }
  }

  function create(container) {
    if (!container || !supported()) return null;
    const T = window.THREE;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "Hologramme 3D de l'astronaute suivi");
    canvas.title = "Faites glisser pour faire pivoter l'hologramme";
    container.appendChild(canvas);

    const S = buildScene(T);
    let raf = null, last = performance.now(), alive = true, disposed = false;
    let drag = null;

    function resize() {
      const w = container.clientWidth || 300, h = container.clientHeight || 360;
      renderer.setSize(w, h, false);
      S.camera.aspect = w / h;
      S.camera.position.z = S.camZ * Math.max(1, 0.82 / S.camera.aspect);   // garde le corps dans le cadre
      S.camera.updateProjectionMatrix();
    }
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);
    resize();

    canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, a: S.state.userAngle }; if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging"); });
    canvas.addEventListener("pointermove", function (e) { if (drag) S.state.userAngle = drag.a + (e.clientX - drag.x) * 0.012; });
    ["pointerup", "pointercancel"].forEach(function (ev) { canvas.addEventListener(ev, function () { drag = null; canvas.classList.remove("dragging"); }); });

    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!document.body.contains(container)) { dispose(); return; }
      if (container.offsetParent === null || document.hidden) { last = now; return; }   // vue masquée : pas de rendu
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      S.update(now / 1000, dt);
      renderer.render(S.scene, S.camera);
    }
    raf = requestAnimationFrame(frame);

    function dispose() {
      if (disposed) return;
      disposed = true;
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
      S.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    return { setState: S.setState, dispose: dispose };
  }

  return { create: create, supported: supported, buildScene: buildScene };
})();
