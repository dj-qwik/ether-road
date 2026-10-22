// ───────────────────────── SPHERE SKINS: 24 looks, one hitbox ─────────────────────────
// Purely cosmetic. Every skin is drawn at the same size and the simulation never sees which one you picked.
// Your racer colour (rails, halo, name tag) stays the same whatever skin you wear, so racers stay easy to tell apart.
const SKINS = [
  { id: 0, name: 'Ether', note: 'Dark glass, your colour inside' },
  { id: 1, name: 'Chrome', note: 'Mirror steel' },
  { id: 2, name: 'Gold', note: 'Brushed gold' },
  { id: 3, name: 'Obsidian', note: 'Volcanic glass' },
  { id: 4, name: 'Glass', note: 'Clear shell, white core' },
  { id: 5, name: 'Plasma', note: 'Swirling charge' },
  { id: 6, name: 'Lava', note: 'Cracked and glowing' },
  { id: 7, name: 'Glacier', note: 'Ice with blue veins' },
  { id: 8, name: 'Nebula', note: 'A pocket of deep space' },
  { id: 9, name: 'Circuit', note: 'Printed traces' },
  { id: 10, name: 'Hexcore', note: 'Honeycomb lattice' },
  { id: 11, name: 'Marble', note: 'White stone, grey veins' },
  { id: 12, name: 'Carbon', note: 'Woven fibre' },
  { id: 13, name: 'Pearl', note: 'Shifts colour as it turns' },
  { id: 14, name: 'Toxic', note: 'Acid green' },
  { id: 15, name: 'Sunset', note: 'Banded dusk' },
  { id: 16, name: 'Zebra', note: 'Black and white stripes' },
  { id: 17, name: 'Checker', note: 'Finish-line flag' },
  { id: 18, name: 'Wireframe', note: 'Just the edges' },
  { id: 19, name: 'Holo', note: 'Rainbow foil' },
  { id: 20, name: 'Eclipse', note: 'Black disc, bright corona' },
  { id: 21, name: 'Saturn', note: 'Comes with a ring' },
  { id: 22, name: 'Atom', note: 'Three orbiting electrons' },
  { id: 23, name: 'Crystal', note: 'Faceted gem' },
];
const SKIN_COUNT = SKINS.length;
const SKINLAB = (() => {
  let T = null, env = null; const texCache = {};
  // seeded randomness so a skin looks the same every time
  const lcg = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };
  function canvasTex(key, w, h, draw, srgb = true) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
    const t = new T.CanvasTexture(c); if (srgb) t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
    return (texCache[key] = t);
  }
  // a simple studio sky for reflections (metals have nothing to reflect otherwise)
  function envMap() {
    if (env) return env;
    env = canvasTex('env', 512, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b0820'); gr.addColorStop(0.45, '#2a2460'); gr.addColorStop(0.5, '#e8e4ff'); gr.addColorStop(0.55, '#3a2a55'); gr.addColorStop(1, '#05040c');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (const [x, c] of [[60, '#22e6ff'], [200, '#ff3dcb'], [330, '#ffffff'], [450, '#7a5cff']]) { g.fillStyle = c; g.globalAlpha = 0.85; g.fillRect(x, 40, 34, 90); }
      g.globalAlpha = 1;
    });
    env.mapping = T.EquirectangularReflectionMapping;
    return env;
  }
  const noiseTex = (key, a, b, cells, seed) => canvasTex(key, 256, 128, (g, w, h) => {
    const r = lcg(seed); g.fillStyle = a; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cells; i++) { const x = r() * w, y = r() * h, rad = 6 + r() * 28; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, b); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.globalAlpha = 0.25 + r() * 0.5; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); for (const dx of [-w, w]) g.fillRect(x - rad + dx, y - rad, rad * 2, rad * 2); }
    g.globalAlpha = 1;
  });
  const veinTex = (key, base, vein, glow, seed, width = 2) => canvasTex(key, 512, 256, (g, w, h) => {
    const r = lcg(seed); g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = vein; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = r() * w, y = r() * h; g.lineWidth = width * (0.4 + r()); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 14; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 30; g.lineTo(x, y); }
      if (glow) { g.shadowColor = glow; g.shadowBlur = 8; } g.stroke();
    }
  });
  const stripeTex = (key, cols, n, vertical) => canvasTex(key, 256, 128, (g, w, h) => {
    for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; if (vertical) g.fillRect((i * w) / n, 0, w / n + 1, h); else g.fillRect(0, (i * h) / n, w, h / n + 1); }
  });
  /**
   * Build a skin. Returns { spin: Group (rolls with the sphere), extra: Group (stays upright: rings, corona) }.
   * color: the racer's colour (THREE.Color), used by the default skin and as an accent.
   */
  function build(id, color, R) {
    T = window.THREE;
    const spin = new T.Group(), extra = new T.Group(), sph = new T.SphereGeometry(R, 40, 28);
    const add = (geo, mat, parent = spin) => { const m = new T.Mesh(geo, mat); parent.add(m); return m; };
    const std = (o) => new T.MeshStandardMaterial({ envMap: envMap(), envMapIntensity: 1, ...o });
    const phys = (o) => new T.MeshPhysicalMaterial({ envMap: envMap(), envMapIntensity: 1, ...o });
    const glowCol = (c, k) => new T.Color(c).multiplyScalar(k);
    switch (SKINS[id] ? id : 0) {
      case 0: // Ether: dark glass shell, the racer's colour as a glowing core and two bands
        add(sph, phys({ color: 0x07070c, metalness: 0.6, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.68, emissive: color, emissiveIntensity: 0.05 }));
        add(new T.SphereGeometry(R * 0.55, 20, 14), new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4), toneMapped: false }));
        { const b = add(new T.TorusGeometry(R * 1.01, 0.022, 8, 56), new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.2), toneMapped: false })); const b2 = b.clone(); b2.rotation.y = Math.PI / 2; spin.add(b2); }
        break;
      case 1: add(sph, std({ color: 0xffffff, metalness: 1, roughness: 0.04 })); break;
      case 2: add(sph, std({ color: 0xffc44d, metalness: 1, roughness: 0.22 })); break;
      case 3: add(sph, phys({ color: 0x050308, metalness: 0.2, roughness: 0.05, clearcoat: 1, sheen: 1, sheenColor: new T.Color(0x7a5cff) })); break;
      case 4:
        add(sph, phys({ color: 0xffffff, metalness: 0, roughness: 0, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }));
        add(new T.SphereGeometry(R * 0.32, 16, 12), new T.MeshBasicMaterial({ color: 0xffffff }));
        break;
      case 5: { const t = noiseTex('plasma', '#14002a', '#ff3dcb', 70, 5); const t2 = noiseTex('plasma2', '#000', '#22e6ff', 50, 55); add(sph, std({ map: t, emissiveMap: t2, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 })); break; }
      case 6: { const t = veinTex('lava', '#1a0d08', '#ff6a00', '#ffb000', 6, 4); add(sph, std({ map: t, emissiveMap: t, emissive: 0xff7a1c, emissiveIntensity: 0.7, roughness: 0.85 })); break; }
      case 7: { const t = veinTex('ice', '#d8f3ff', '#5cc8ff', null, 7, 1.5); add(sph, phys({ map: t, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.9 })); break; }
      case 8: { const t = noiseTex('nebula', '#05021a', '#b06bff', 90, 8); const t2 = noiseTex('nebula2', '#000', '#ff6fb5', 60, 88); add(sph, std({ map: t, emissiveMap: t2, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.5 })); break; }
      case 9: { const t = canvasTex('circuit', 512, 256, (g, w, h) => { const r = lcg(9); g.fillStyle = '#04150c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3dff9a'; g.lineWidth = 2; for (let i = 0; i < 60; i++) { let x = Math.round(r() * 32) * 16, y = Math.round(r() * 16) * 16; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * 32; else y += (r() < 0.5 ? -1 : 1) * 32; g.lineTo(x, y); } g.stroke(); g.fillStyle = '#b6ffd6'; g.fillRect(x - 3, y - 3, 6, 6); } }); add(sph, std({ map: t, emissiveMap: t, emissive: 0x6bffb0, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 })); break; }
      case 10: { const t = canvasTex('hex', 512, 256, (g, w, h) => { g.fillStyle = '#020611'; g.fillRect(0, 0, w, h); g.strokeStyle = '#22e6ff'; g.lineWidth = 2.5; const s = 16; for (let y = 0; y < h + s; y += s * 1.5) for (let x = 0; x < w + s; x += s * Math.sqrt(3)) { const ox = (Math.round(y / (s * 1.5)) % 2) * s * Math.sqrt(3) / 2; g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; g.lineTo(x + ox + Math.cos(a) * s * 0.9, y + Math.sin(a) * s * 0.9); } g.closePath(); g.stroke(); } }); add(sph, std({ map: t, emissiveMap: t, emissive: 0x22e6ff, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.5 })); break; }
      case 11: { const t = veinTex('marble', '#f2f0ec', '#8d8a96', null, 11, 1.2); add(sph, phys({ map: t, roughness: 0.18, clearcoat: 1 })); break; }
      case 12: { const t = canvasTex('carbon', 128, 64, (g, w, h) => { g.fillStyle = '#111'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const gr = g.createLinearGradient(x, y, x + 8, y + 8); const on = ((x + y) / 8) % 2; gr.addColorStop(0, on ? '#2c2c30' : '#0a0a0c'); gr.addColorStop(1, on ? '#0c0c0e' : '#26262a'); g.fillStyle = gr; g.fillRect(x, y, 8, 8); } }); t.repeat.set(6, 3); add(sph, phys({ map: t, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05, metalness: 0.2 })); break; }
      case 13: add(sph, phys({ color: 0xf6f2ff, roughness: 0.2, metalness: 0.1, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1 })); break;
      case 14: { const t = noiseTex('toxic', '#2a4d00', '#d8ff5a', 80, 14); add(sph, std({ map: t, emissiveMap: t, emissive: 0xb6ff3b, emissiveIntensity: 0.5, roughness: 0.5 })); break; }
      case 15: { const t = stripeTex('sunset', ['#ffb347', '#ff7a59', '#ff3d7f', '#b83dff', '#5a2bff', '#2a1966'], 12, false); add(sph, std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4 })); break; }
      case 16: { const t = canvasTex('zebra', 512, 256, (g, w, h) => { g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h); g.fillStyle = '#0a0a0a'; const r = lcg(16); for (let x = 0; x < w; x += 28) { g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y / 30 + r()) * 10, y); for (let y = h; y >= 0; y -= 16) g.lineTo(x + 12 + Math.sin(y / 30) * 10, y); g.fill(); } }); add(sph, phys({ map: t, roughness: 0.3, clearcoat: 1 })); break; }
      case 17: { const t = canvasTex('check', 256, 128, (g, w, h) => { const n = 16; for (let y = 0; y < 8; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#0a0a0a' : '#f4f4f4'; g.fillRect(x * w / n, y * h / 8, w / n + 1, h / 8 + 1); } }); add(sph, phys({ map: t, roughness: 0.25, clearcoat: 1 })); break; }
      case 18: add(new T.IcosahedronGeometry(R, 1), new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.3), wireframe: true, toneMapped: false })); add(new T.SphereGeometry(R * 0.3, 12, 8), new T.MeshBasicMaterial({ color: 0xffffff })); break;
      case 19: { const t = canvasTex('holo', 256, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); ['#ff6fb5', '#ffd36b', '#8dff9a', '#6fe8ff', '#a98bff', '#ff6fb5'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }); add(sph, phys({ map: t, roughness: 0.1, metalness: 0.6, iridescence: 1, transparent: true, opacity: 0.85, clearcoat: 1 })); break; }
      case 20: {
        add(sph, std({ color: 0x000000, roughness: 0.6, metalness: 0 }));
        const c = canvasTex('corona', 128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 34, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,230,180,.9)'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
        const s = new T.Sprite(new T.SpriteMaterial({ map: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); s.scale.set(R * 3.4, R * 3.4, 1); extra.add(s); s.renderOrder = -1;
        break;
      }
      case 21: {
        const t = stripeTex('saturn', ['#e9d7b0', '#c9a874', '#f3e6c8', '#b48a55', '#e2c99a'], 14, false); add(sph, std({ map: t, roughness: 0.6 }));
        const ring = new T.Mesh(new T.RingGeometry(R * 1.35, R * 1.95, 64), new T.MeshBasicMaterial({ color: 0xe8d4a8, transparent: true, opacity: 0.75, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2 + 0.45; extra.add(ring);
        break;
      }
      case 22: {
        add(new T.SphereGeometry(R * 0.38, 20, 14), new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4), toneMapped: false }));
        for (let k = 0; k < 3; k++) {
          const o = new T.Group(); o.rotation.set(k * 1.05, k * 0.8, 0);
          o.add(new T.Mesh(new T.TorusGeometry(R * 0.95, 0.012, 6, 64), new T.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.8 })));
          const e = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff })); e.position.x = R * 0.95; o.add(e); o.userData.orbit = 3 + k;
          extra.add(o);
        }
        break;
      }
      case 23: add(new T.IcosahedronGeometry(R, 1), phys({ color: 0x9ff6ff, roughness: 0.02, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.8, clearcoat: 1, iridescence: 0.4 })); break;
    }
    return { spin, extra };
  }
  // small square previews for the picker, rendered once with their own little renderer
  let thumbs = null;
  function thumbnails(color) {
    if (thumbs) return thumbs;
    T = window.THREE;
    const cv = document.createElement('canvas'), r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(120, 120, false); r.setPixelRatio(1); r.toneMapping = T.ACESFilmicToneMapping; r.outputColorSpace = T.SRGBColorSpace;
    const sc = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 20); cam.position.set(0, 0.25, 3.1); cam.lookAt(0, 0, 0);
    sc.add(new T.HemisphereLight(0xb8b0ff, 0x100818, 1.2)); const d = new T.DirectionalLight(0xffffff, 1.6); d.position.set(2, 3, 4); sc.add(d);
    thumbs = SKINS.map((s) => {
      const { spin, extra } = build(s.id, color, 0.6); spin.rotation.set(0.3, 0.6, 0); sc.add(spin, extra);
      r.render(sc, cam); const url = cv.toDataURL(); sc.remove(spin, extra); return url;
    });
    r.dispose();
    return thumbs;
  }
  return { build, thumbnails };
})();
