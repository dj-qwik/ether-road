// ───────────────────────── THE WORLD: three.js scene drawn from the race data ─────────────────────────
// Nothing here affects play. Every rail is a graphite ribbon edged in its racer's colour, laid along a shared
// curving spine; the course layout braids, crosses and merges the rails so racers meet each other in space.
// Hazards sit in track coordinates (distance × lane) exactly where the simulation tests them.
const THEMES = {
  void: { bg: 0x04030c, fog: 0x070516, density: 0.0105, hazard: 0xff2e5b, accent: 0x22e6ff, accent2: 0xff3dcb, decor: 'rings' },
  solar: { bg: 0x110402, fog: 0x2a0b03, density: 0.012, hazard: 0xffd23f, accent: 0xff7a1c, accent2: 0xff3d3d, decor: 'embers' },
  ultraviolet: { bg: 0x0a0418, fog: 0x1a0b36, density: 0.013, hazard: 0xffffff, accent: 0x7a5cff, accent2: 0xc49bff, decor: 'rings' },
  chromatic: { bg: 0x050512, fog: 0x0b0a24, density: 0.0105, hazard: 0xff2e5b, accent: 0x22e6ff, accent2: 0xb6ff3b, decor: 'shards', shift: true },
  vector: { bg: 0x02060c, fog: 0x06121e, density: 0.012, hazard: 0xff2e5b, accent: 0x4cc9ff, accent2: 0xe0f6ff, decor: 'rain' },
  prism: { bg: 0x06050f, fog: 0x0e0b20, density: 0.0095, hazard: 0xff2e5b, accent: 0xa9c7ff, accent2: 0xff3dcb, decor: 'monoliths' },
  signal: { bg: 0x030a08, fog: 0x08201a, density: 0.012, hazard: 0xff4f6d, accent: 0x9fffe0, accent2: 0x5cffc8, decor: 'shards' },
  ion: { bg: 0x04040c, fog: 0x0a0a1e, density: 0.0105, hazard: 0xff2e5b, accent: 0x6fd8ff, accent2: 0xffe08a, decor: 'ionrings' },
};
const RAIL_HALF = 1.3, VIEW_AHEAD = 230, VIEW_BEHIND = 14, STRIP_LEN = 6;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const WORLD = (() => {
  let T = null, renderer = null, scene = null, camera = null, camOther = null, composer = null, bloom = null, ready = false;
  let race = null, starPts = null, decor = null, theme = THEMES.void, themeKey = 'void';
  const cam = { pos: null, look: null, fov: 66, roll: 0, shake: 0 };
  const W = { pixelRatio: 1, frameMs: 16, slowFrames: 0 };
  let trackKey = 'nebula';
  const spine = (s, out) => RAILGEO.spine(trackKey, s, out);
  const spineFrame = (s) => RAILGEO.spineFrame(trackKey, s);
  // ── materials/geometries (built once)
  let M = null, G = null;
  function gridTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#2b2740'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = 'rgba(170,160,255,.22)'; g.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(128, y + 0.5); g.stroke(); }
    for (const x of [16, 40, 88, 112]) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 256); g.stroke(); }
    g.fillStyle = 'rgba(235,230,255,.7)'; g.fillRect(62, 0, 4, 120); // centre dash between the lanes
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
  }
  function buildShared() {
    const hot = new T.Color(theme.hazard);
    M = {
      road: (() => { const g = gridTexture(); return new T.MeshStandardMaterial({ map: g, emissiveMap: g, emissive: new T.Color(theme.accent).multiplyScalar(0.18), color: 0xffffff, roughness: 0.55, metalness: 0.1 }); })(),
      hotSolid: new T.MeshStandardMaterial({ color: 0x0a0508, emissive: hot, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.4 }),
      hotGlow: new T.MeshBasicMaterial({ color: hot.clone().multiplyScalar(1.0), toneMapped: false }),
      hotGhost: new T.MeshBasicMaterial({ color: 0xbab4ff, transparent: true, opacity: 0.12, depthWrite: false, wireframe: true }),
      wallBody: new T.MeshStandardMaterial({ color: 0x14060b, emissive: hot, emissiveIntensity: 0.32, transparent: true, opacity: 0.88, roughness: 0.5 }),
      dim: new T.MeshStandardMaterial({ color: 0x15132a, emissive: 0x2b2650, emissiveIntensity: 0.6, roughness: 0.5 }),
      orb: new T.MeshBasicMaterial({ color: new T.Color(0xffe08a).multiplyScalar(2), toneMapped: false }),
      marker: new T.MeshBasicMaterial({ color: hot.clone().multiplyScalar(1.6), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: T.DoubleSide }),
      shard: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      otherSolid: new T.MeshStandardMaterial({ color: 0x0a0508, emissive: hot, emissiveIntensity: 0.5, transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.4 }),
      otherGlow: new T.MeshBasicMaterial({ color: hot.clone().multiplyScalar(0.8), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }),
      glowTex: glowTexture(),
    };
    G = {
      cone: new T.ConeGeometry(0.24, 0.72, 4), ico: new T.IcosahedronGeometry(0.33, 0), box: new T.BoxGeometry(1, 1, 1), oct: new T.OctahedronGeometry(0.26, 0),
      ring: new T.RingGeometry(0.62, 0.72, 40), tetra: new T.TetrahedronGeometry(0.12, 0), sph: new T.SphereGeometry(SPHERE_R, 40, 28), core: new T.SphereGeometry(SPHERE_R * 0.55, 20, 14),
      band: new T.TorusGeometry(SPHERE_R * 1.01, 0.022, 8, 56), wave: new T.RingGeometry(0.9, 1.05, 48),
    };
  }
  // ── init
  function init(canvas) {
    T = window.THREE;
    renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = T.SRGBColorSpace;
    W.pixelRatio = Math.min(devicePixelRatio || 1, 1.6);
    renderer.setPixelRatio(W.pixelRatio);
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(66, 1, 0.1, 900);
    cam.pos = new T.Vector3(0, 3, 8); cam.look = new T.Vector3(0, 0, -10);
    const hemi = new T.HemisphereLight(0x8a80ff, 0x050308, 0.55); hemi.layers.enableAll(); scene.add(hemi);
    const key = new T.DirectionalLight(0xffffff, 0.7); key.layers.enableAll(); key.position.set(4, 10, 6); scene.add(key); scene.add(key.target);
    W.key = key;
    // Your own road can never be hidden. Pass 1 draws everything else with a near clip of 9 u (another racer's rail
    // swinging past the lens simply isn't drawn); pass 2 clears depth and draws the followed racer's rail, hazards,
    // pickups and sphere (layer 1) on top. So nothing from another track can ever cover the lane ahead of you.
    camOther = new T.PerspectiveCamera(66, 1, 9, 900); camOther.layers.set(0); camera.layers.set(1);
    composer = new T.EffectComposer(renderer);
    composer.addPass(new T.RenderPass(scene, camOther));
    const mine = new T.RenderPass(scene, camera); mine.clear = false; mine.clearDepth = true;
    const draw = mine.render.bind(mine); mine.render = (...a) => { const bg = scene.background; scene.background = null; draw(...a); scene.background = bg; };
    composer.addPass(mine);
    bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.26, 0.3, 0.7); // ~55% below the first build
    if (location.hash.includes('nobloom')) bloom.enabled = false;
    composer.addPass(bloom);
    composer.addPass(new T.OutputPass());
    buildStars();
    setTheme('void');
    resize(); addEventListener('resize', resize);
    ready = true;
  }
  function resize() {
    if (!renderer) return;
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); composer.setPixelRatio(W.pixelRatio);
    bloom.resolution.set(Math.max(256, w / 2), Math.max(256, h / 2));
    camera.aspect = w / h; camera.updateProjectionMatrix(); if (camOther) { camOther.aspect = w / h; camOther.updateProjectionMatrix(); }
  }
  function setTheme(key) {
    themeKey = THEMES[key] ? key : 'void'; theme = THEMES[themeKey];
    scene.background = new T.Color(theme.bg);
    scene.fog = new T.FogExp2(theme.fog, theme.density);
    if (M) { for (const m of Object.values(M)) if (m.dispose && m.isMaterial) m.dispose(); }
    buildShared();
    if (starPts) starPts.material.color = new T.Color(theme.accent).lerp(new T.Color(0xffffff), 0.6);
  }
  function buildStars() {
    const n = 2600, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = 300 + Math.random() * 200, q = Math.sqrt(1 - u * u); p[i * 3] = q * Math.cos(a) * r; p[i * 3 + 1] = u * r * 0.6 + 40; p[i * 3 + 2] = q * Math.sin(a) * r; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
    starPts = new T.Points(g, new T.PointsMaterial({ color: 0xbfd8ff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    scene.add(starPts);
  }
  // ── a race: rails, hazards, orbs, spheres
  function clearRace() {
    if (!race) return;
    scene.remove(race.root);
    race.root.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); if (o.material && o.material.map && o.material.map.isCanvasTexture && o.userData.ownTex) o.material.map.dispose(); });
    race = null;
  }
  /** R: the round (createRound). me: seat index of this player (or -1). */
  function setRace(R, me, key, themeOverride) {
    clearRace();
    trackKey = SIM0.TRACKS[key] ? key : 'nebula';
    const th = THEMES[themeOverride] ? themeOverride : SIM0.TRACKS[trackKey].theme;
    if (th !== themeKey) setTheme(th);
    const root = new T.Group(); scene.add(root); race0.me = me;
    const course = R.course, n = R.active.length;
    const sMax = course.end + 60;
    const geo = RAILGEO.build(course, n, course.tl.sAtT, trackKey);
    const rails = R.active.map((b, j) => { const grp = new T.Group(); root.add(grp); return { b, j, ...geo[j], color: new T.Color(b.color), grp, layer: 0 }; });
    // ribbons + edges
    for (const rl of rails) rl.grp.add(ribbon(rl, 0, RAIL_HALF, 0, M.road, true));
    for (const rl of rails) {
      const mineRail = rl.b.i === me, edge = new T.MeshBasicMaterial({ color: rl.color.clone().multiplyScalar(mineRail || me < 0 ? 0.85 : 0.55), toneMapped: false });
      const under = new T.MeshBasicMaterial({ color: rl.color.clone().multiplyScalar(0.35), transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, side: T.DoubleSide });
      for (const sgn of [-1, 1]) {
        rl.grp.add(ribbon(rl, sgn * (RAIL_HALF + 0.03), 0.06, 0.07, edge));
        rl.grp.add(ribbon(rl, sgn * (RAIL_HALF + 0.12), 0.05, -0.45, under, false, true));
      }
    }
    // hazards + orbs
    const items = [];
    for (const rl of rails) {
      for (const h of course.blocks) items.push(makeHazard(h, rl, rl.grp));
      for (const o of course.orbs) items.push(makeOrb(o, rl, rl.grp));
      for (const st of course.strips) items.push(makeStrip(st, rl, rl.grp));
    }
    items.sort((a, c) => a.s0 - c.s0);
    // spheres
    const spheres = rails.map((rl) => makeSphere(rl, rl.grp, rl.b.i === me));
    // decor along the spine
    const dec = makeDecor(root, sMax);
    race = { R, me, rails, items, lo: 0, spheres, root, dec, shards: [], waves: [], finale: false };
    return race;
  }
  /** strip along a rail at lateral offset `off` (half width `hw`), lifted by `lift` along the rail's up. */
  function ribbon(rl, off, hw, lift, mat, uvs, vertical) {
    const ST = 2, N = Math.floor((rl.N - 1) / ST) + 1, v = new Float32Array(N * 2 * 3), uv = new Float32Array(N * 2 * 2), idx = []; // every 2nd sample (0.5 u) is plenty for the mesh
    for (let k = 0; k < N; k++) {
      const p = k * ST * 3;
      for (let e = 0; e < 2; e++) {
        const lat = vertical ? off : off + (e ? hw : -hw), h = vertical ? lift * (e ? 1 : 0) : lift;
        v[(k * 2 + e) * 3] = rl.pos[p] + rl.side[p] * lat + rl.up[p] * h;
        v[(k * 2 + e) * 3 + 1] = rl.pos[p + 1] + rl.side[p + 1] * lat + rl.up[p + 1] * h;
        v[(k * 2 + e) * 3 + 2] = rl.pos[p + 2] + rl.side[p + 2] * lat + rl.up[p + 2] * h;
        uv[(k * 2 + e) * 2] = e; uv[(k * 2 + e) * 2 + 1] = (k * ST * RAILGEO.STEP - 30) / 8;
      }
      if (k < N - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } // counter-clockwise from above: faces up
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(v, 3)); if (uvs) g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat); m.frustumCulled = false; return m;
  }
  // frame of rail rl at distance s, lateral x, height y → world position (+ basis)
  const F = { p: null, t: null, side: null, up: null };
  function railAt(rl, s, x = 0, y = 0, out) {
    const f = (s + 30) / RAILGEO.STEP, k = clamp(Math.floor(f), 0, rl.N - 2), w = clamp(f - k, 0, 1), a = k * 3, c = a + 3;
    const px = lerp(rl.pos[a], rl.pos[c], w), py = lerp(rl.pos[a + 1], rl.pos[c + 1], w), pz = lerp(rl.pos[a + 2], rl.pos[c + 2], w);
    const sx = lerp(rl.side[a], rl.side[c], w), sy = lerp(rl.side[a + 1], rl.side[c + 1], w), sz = lerp(rl.side[a + 2], rl.side[c + 2], w);
    const ux = lerp(rl.up[a], rl.up[c], w), uy = lerp(rl.up[a + 1], rl.up[c + 1], w), uz = lerp(rl.up[a + 2], rl.up[c + 2], w);
    out = out || {};
    out.x = px + sx * x + ux * y; out.y = py + sy * x + uy * y; out.z = pz + sz * x + uz * y;
    out.tx = rl.pos[c] - rl.pos[a]; out.ty = rl.pos[c + 1] - rl.pos[a + 1]; out.tz = rl.pos[c + 2] - rl.pos[a + 2];
    out.sx = sx; out.sy = sy; out.sz = sz; out.ux = ux; out.uy = uy; out.uz = uz;
    return out;
  }
  // place an object on a rail: origin at (s, lane x, height y), oriented along the road
  const _m = () => new T.Matrix4();
  const race0 = { me: -1 };
  function orient(obj, rl, s, x, y) {
    const f = railAt(rl, s, x, y);
    const tl = Math.hypot(f.tx, f.ty, f.tz) || 1;
    const m = _m().makeBasis(new T.Vector3(f.sx, f.sy, f.sz), new T.Vector3(f.ux, f.uy, f.uz), new T.Vector3(-f.tx / tl, -f.ty / tl, -f.tz / tl));
    obj.position.set(f.x, f.y, f.z); obj.quaternion.setFromRotationMatrix(m);
    return obj;
  }
  const laneX = (lane) => (lane ? LANE_X : -LANE_X);
  function setLayer(rl, layer) { rl.layer = layer; rl.grp.traverse((o) => { if (o.isLight) o.layers.enableAll(); else o.layers.set(layer); }); }
  // The one hazard: red spikes. A short hazard is one cluster of three; a long one is a continuous row that follows
  // the rail's curve, over a glowing red strip on the road, so a whole lane being closed reads at a glance.
  const _q = () => new T.Quaternion(), _v = () => new T.Vector3();
  function makeHazard(h, rl, root) {
    const lane = h.lane ^ rl.b.mirror, x = laneX(lane), len = h.s1 - h.s0;
    const g = new T.Group(); g.visible = false; root.add(g);
    const rows = Math.max(1, Math.round(len / 0.75)), step = len / rows, n = rows * 3;
    const cones = new T.InstancedMesh(G.cone, M.hotSolid, n); cones.frustumCulled = false;
    const m4 = new T.Matrix4(), q = _q(), sc = new T.Vector3(1, 1, 1);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      const sr = h.s0 + step * (r + 0.5), f = railAt(rl, sr, 0, 0), tl = Math.hypot(f.tx, f.ty, f.tz) || 1;
      q.setFromRotationMatrix(_m().makeBasis(_v().set(f.sx, f.sy, f.sz), _v().set(f.ux, f.uy, f.uz), _v().set(-f.tx / tl, -f.ty / tl, -f.tz / tl)));
      for (const dx of [-0.45, 0, 0.45]) {
        const p = railAt(rl, sr, x + dx, 0.36);
        sc.setScalar(1 + ((r * 7 + dx * 10) % 3) * 0.04);
        m4.compose(_v().set(p.x, p.y, p.z), q, sc); cones.setMatrixAt(k++, m4);
      }
    }
    g.add(cones);
    // glowing strip under the spikes
    const N = Math.max(2, Math.ceil(len / 0.5) + 1), v = new Float32Array(N * 6), idx = [];
    for (let i = 0; i < N; i++) {
      const sr = h.s0 + (len * i) / (N - 1);
      for (let e = 0; e < 2; e++) { const p = railAt(rl, sr, x + (e ? 0.74 : -0.74), 0.025); v.set([p.x, p.y, p.z], (i * 2 + e) * 3); }
      if (i < N - 1) { const a2 = i * 2; idx.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2); }
    }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(v, 3)); sg.setIndex(idx);
    const strip = new T.Mesh(sg, M.hotGlow); strip.frustumCulled = false; g.add(strip);
    return { h, rl, g, s0: h.s0 - 4, s1: h.s1 + 2, kind: h.kind, parts: {} };
  }
  // Speed strips: a pad across the whole road. Boost = cyan forward chevrons, slow = amber bars.
  const stripTex = {};
  function stripTexture(kind) {
    if (stripTex[kind]) return stripTex[kind];
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = kind === 'boost' ? 'rgba(10,40,60,.6)' : 'rgba(60,30,5,.6)'; g.fillRect(0, 0, 128, 128);
    if (kind === 'boost') { g.strokeStyle = '#7ff3ff'; g.lineWidth = 12; g.lineJoin = 'round'; for (const y of [28, 76]) { g.beginPath(); g.moveTo(14, y + 34); g.lineTo(64, y); g.lineTo(114, y + 34); g.stroke(); } }
    else { g.fillStyle = '#ffb347'; for (const y of [18, 58, 98]) g.fillRect(10, y, 108, 14); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping;
    return (stripTex[kind] = t);
  }
  function makeStrip(st, rl, root) {
    const L = st.s1 - st.s0, x = laneX(st.lane ^ rl.b.mirror), N = 13, v = new Float32Array(N * 6), uv = new Float32Array(N * 4), idx = [];
    for (let i = 0; i < N; i++) {
      const sr = st.s0 + (L * i) / (N - 1);
      for (let e = 0; e < 2; e++) { const p = railAt(rl, sr, x + (e ? 0.72 : -0.72), 0.02); v.set([p.x, p.y, p.z], (i * 2 + e) * 3); uv.set([e, -(L * i) / (N - 1) / 1.4], (i * 2 + e) * 2); }
      if (i < N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(v, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: stripTexture(st.kind), color: new T.Color(st.kind === 'boost' ? 0xbff8ff : 0xffd9a0).multiplyScalar(1.2), transparent: true, depthWrite: false, toneMapped: false }));
    m.frustumCulled = false;
    const g = new T.Group(); g.add(m); g.visible = false; root.add(g);
    // a glowing arch over the strip's lane so you can spot it from far away (cyan boost, amber slow)
    const col = new T.Color(st.kind === 'boost' ? 0x22e6ff : 0xffb347).multiplyScalar(1.3), am = new T.MeshBasicMaterial({ color: col, toneMapped: false });
    const arch = new T.Group(); orient(arch, rl, st.s0, x, 0);
    for (const dx of [-0.74, 0.74]) { const post = new T.Mesh(G.box, am); post.scale.set(0.08, 1.15, 0.08); post.position.set(dx, 0.58, 0); arch.add(post); }
    const top = new T.Mesh(G.box, am); top.scale.set(1.56, 0.1, 0.1); top.position.set(0, 1.18, 0); arch.add(top);
    for (const k of [-1, 1]) { const chev = new T.Mesh(G.cone, am); chev.scale.set(0.6, 0.45, 0.6); chev.position.set(k * 0.32, 0.86, 0); chev.rotation.x = st.kind === 'boost' ? -Math.PI / 2 : Math.PI / 2; arch.add(chev); }
    g.add(arch);
    return { strip: st, rl, g, m, s0: st.s0 - 4, s1: st.s1 + 2, kind: 'strip' };
  }
  const POWER_LOOK = { shield: 0x6fb7ff, magnet: 0xb48cff, double: 0xfff1a8 };
  function makeOrb(o, rl, root) {
    const lane = o.lane ^ rl.b.mirror, g = new T.Group(); orient(g, rl, o.s, laneX(lane), 0.55); g.visible = false; root.add(g);
    const mine = rl.b.i === race0.me || race0.me < 0, col = o.power ? POWER_LOOK[o.power] : 0xffd26b;
    let m;
    if (!o.power) m = new T.Mesh(G.oct, M.orb);
    else {
      m = new T.Group();
      const mat = new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(1.3), toneMapped: false });
      if (o.power === 'shield') { m.add(new T.Mesh(new T.IcosahedronGeometry(0.34, 1), new T.MeshBasicMaterial({ color: col, wireframe: true, toneMapped: false }))); m.add(new T.Mesh(new T.IcosahedronGeometry(0.16, 0), mat)); }
      else if (o.power === 'magnet') { const u = new T.Mesh(new T.TorusGeometry(0.22, 0.08, 8, 20, Math.PI), mat); u.rotation.z = Math.PI; m.add(u); for (const x of [-0.22, 0.22]) { const tip = new T.Mesh(G.box, new T.MeshBasicMaterial({ color: 0xffffff })); tip.scale.set(0.17, 0.12, 0.17); tip.position.set(x, 0.05, 0); m.add(tip); } }
      else { for (const x of [-0.15, 0.15]) { const d = new T.Mesh(G.oct, mat); d.scale.setScalar(0.8); d.position.x = x; m.add(d); } }
      if (!mine) m.scale.setScalar(0.8);
    }
    g.add(m);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: M.glowTex, color: col, transparent: true, opacity: o.power ? 0.6 : 0.45, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(1.3, 1.3, 1); g.add(halo);
    return { orb: o, rl, g, m, s0: o.s - 4, s1: o.s + 2, kind: 'orb' };
  }
  function nameTag(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.font = '700 30px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(4,3,12,.65)'; const w = Math.min(250, g.measureText(text).width + 30); g.beginPath(); g.roundRect(128 - w / 2, 10, w, 44, 22); g.fill();
    g.fillStyle = color; g.fillText(text, 128, 33);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); sp.scale.set(1.9, 0.48, 1); sp.userData.ownTex = true;
    return sp;
  }
  function makeSphere(rl, root, isMe) {
    const col = rl.color, g = new T.Group(); root.add(g);
    const skin = SKINLAB.build(rl.b.skin | 0, col, SPHERE_R), spin = skin.spin; g.add(spin, skin.extra);
    // power-up visuals: shield bubble, magnet ring, ×2 sparkle
    const shieldM = new T.Mesh(new T.IcosahedronGeometry(SPHERE_R * 1.55, 1), new T.MeshBasicMaterial({ color: 0x6fb7ff, wireframe: true, transparent: true, opacity: 0.7, toneMapped: false })); shieldM.visible = false; g.add(shieldM);
    const magnetM = new T.Mesh(new T.TorusGeometry(SPHERE_R * 1.8, 0.03, 6, 48), new T.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.85, toneMapped: false })); magnetM.rotation.x = Math.PI / 2; magnetM.visible = false; g.add(magnetM);
    const dblM = new T.Mesh(G.oct, new T.MeshBasicMaterial({ color: 0xfff1a8, toneMapped: false })); dblM.scale.setScalar(0.35); dblM.visible = false; g.add(dblM);
    // a soft ring of your colour on the road under your ball, so you always know which ball and lane is yours
    const mark = new T.Mesh(new T.RingGeometry(SPHERE_R * 1.25, SPHERE_R * 1.75, 40), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.2), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    mark.rotation.x = -Math.PI / 2; mark.position.y = -SPHERE_R + 0.02; mark.visible = false; g.add(mark);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: M.glowTex, color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(1.8, 1.8, 1); g.add(halo);
    const light = new T.PointLight(col, isMe ? 2.2 : 1.4, 6, 2); light.position.set(0, 0.4, 0); g.add(light);
    // trail ribbon
    const TN = 18, tv = new Float32Array(TN * 2 * 3), tc = new Float32Array(TN * 2 * 3), ti = [];
    for (let k = 0; k < TN - 1; k++) { const a = k * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(tv, 3)); tg.setAttribute('color', new T.BufferAttribute(tc, 3)); tg.setIndex(ti);
    const trail = new T.Mesh(tg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    trail.frustumCulled = false; rl.grp.add(trail);
    const tag = isMe ? null : nameTag(`${rl.b.glyph} ${rl.b.name}`, rl.b.color); if (tag) rl.grp.add(tag);
    return { rl, g, spin, extra: skin.extra, halo, light, trail, tag, hist: [], dead: false, roll: 0, x: laneX(rl.b.cl), isMe, shieldM, magnetM, dblM, mark };
  }
  function makeDecor(root, sMax) {
    const grp = new T.Group(); root.add(grp);
    const acc = new T.Color(theme.accent), acc2 = new T.Color(theme.accent2);
    const sp = { x: 0, y: 0, z: 0 };
    if (theme.decor === 'rings' || theme.decor === 'ionrings') {
      const step = theme.decor === 'ionrings' ? 42 : 85, geo = new T.TorusGeometry(theme.decor === 'ionrings' ? 9 : 14, 0.07, 6, 90);
      for (let s = 60; s < sMax; s += step) {
        const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: (Math.floor(s / step) % 2 ? acc : acc2).clone().multiplyScalar(1.4), transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
        spine(s, sp); m.position.set(sp.x, sp.y + 1, sp.z); const f = spineFrame(s); m.lookAt(sp.x - f.sz, sp.y + 1, sp.z + f.sx); m.rotateY(Math.PI / 2);
        grp.add(m);
      }
    } else if (theme.decor === 'monoliths') {
      const geo = new T.BoxGeometry(4, 40, 4);
      for (let s = 40; s < sMax; s += 30) for (const sg of [-1, 1]) {
        const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0x0d0b1e, emissive: sg > 0 ? acc : acc2, emissiveIntensity: 0.12, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.9 }));
        spine(s, sp); const f = spineFrame(s), d = 24 + 14 * Math.abs(Math.sin(s)); m.position.set(sp.x + f.sx * d * sg, sp.y - 6 + 8 * Math.sin(s * 0.7), sp.z + f.sz * d * sg); m.rotation.y = s; grp.add(m);
      }
    } else {
      // shards / embers / rain: drifting points near the road
      const n = 1800, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const s = Math.random() * sMax; spine(s, sp); const f = spineFrame(s), d = (Math.random() - 0.5) * 70, h = (Math.random() - 0.3) * 30; p[i * 3] = sp.x + f.sx * d; p[i * 3 + 1] = sp.y + h; p[i * 3 + 2] = sp.z + f.sz * d; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ color: acc.clone().multiplyScalar(1.5), size: theme.decor === 'rain' ? 0.12 : 0.16, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      pts.frustumCulled = false; grp.add(pts); grp.userData.pts = pts;
    }
    return grp;
  }
  // ── per-frame
  const tmpV = { x: 0, y: 0, z: 0 };
  function updateHazards(t, s) {
    const items = race.items;
    // items sorted by s0; only the followed racer's rail shows hazards and pickups (rivals' would only clutter)
    while (race.lo < items.length && items[race.lo].s1 < s - VIEW_BEHIND) { items[race.lo].g.visible = false; race.lo++; }
    for (let k = race.lo; k < items.length; k++) {
      const it = items[k];
      if (it.s0 > s + VIEW_AHEAD) break;
      // anything already behind the sphere would sit between it and the camera: gone
      if (it.rl !== race.top || (it.h ? it.h.s1 : it.orb ? it.orb.s : it.strip.s1) < s - 0.4) { it.g.visible = false; continue; }
      it.g.visible = true;
      if (it.kind === 'strip') { it.g.visible = !it.rl.b.strips.includes(it.strip.id); it.m.material.map.offset.y = -t * (it.strip.kind === 'boost' ? 2.5 : 0.6); continue; }
      if (it.kind === 'orb') { const got = it.rl.b.got.includes(it.orb.id); it.g.visible = !got; it.m.rotation.y = t * 3; it.m.rotation.x = t * 1.3; }
    }
  }
  /**
   * view = { t, s, spheres: [{ i, x (lateral), alive, dead (seconds since out), lane }], follow: seat, phase, winner }
   */
  function frame(dt, view) {
    if (!ready) return;
    const now = performance.now() / 1000;
    if (starPts) starPts.position.copy(camera.position);
    if (!race) { camera.position.set(Math.sin(now * 0.1) * 6, 3, 10); camera.lookAt(0, 0, -30); camOther.position.copy(camera.position); camOther.quaternion.copy(camera.quaternion); render(dt); return; }
    const { t, s } = view;
    updateHazards(t, s);
    // spheres
    let followSp = null;
    for (const sp of race.spheres) {
      const v = view.spheres.find((x) => x.i === sp.rl.b.i); if (!v) continue;
      if (v.i === view.follow) followSp = sp;
      const ss = v.s;
      const f = railAt(sp.rl, ss, v.x, SPHERE_R + 0.03 + 0.04 * Math.sin(now * 9.4 + sp.rl.j));
      if (!v.alive) {
        if (!sp.dead) { sp.dead = true; burst(f, sp.rl.color, sp.isMe, 1, sp.rl); }
        sp.g.visible = false; sp.light.intensity = 0; if (sp.tag) sp.tag.visible = false;
      } else { sp.dead = false; sp.g.visible = true; }
      sp.g.position.set(f.x, f.y, f.z);
      sp.roll += ((v.v || 0) * dt) / SPHERE_R; sp.spin.rotation.x = -sp.roll;
      for (const o of sp.extra.children) if (o.userData.orbit) o.rotation.z = now * o.userData.orbit;
      // orient the sphere's group along its rail so rolling looks right
      sp.g.quaternion.setFromRotationMatrix(_m().makeBasis(new T.Vector3(f.sx, f.sy, f.sz), new T.Vector3(f.ux, f.uy, f.uz), new T.Vector3(-f.tx, -f.ty, -f.tz).normalize()));
      sp.mark.visible = v.i === view.follow && v.alive; if (sp.mark.visible) sp.mark.material.opacity = 0.55 + 0.2 * Math.sin(now * 6);
      sp.shieldM.visible = !!v.shield && v.alive; if (sp.shieldM.visible) { sp.shieldM.rotation.y = now * 1.5; sp.shieldM.rotation.x = now * 0.7; }
      if (v.shieldPop && !sp.popped) { sp.popped = true; const pf = railAt(sp.rl, ss, v.x, SPHERE_R); burst(pf, new T.Color(0x6fb7ff), false, 0.5, sp.rl); }
      if (!v.shieldPop) sp.popped = false;
      sp.magnetM.visible = !!v.magnet && v.alive; if (sp.magnetM.visible) sp.magnetM.scale.setScalar(1 + 0.08 * Math.sin(now * 12));
      sp.dblM.visible = !!v.double && v.alive; if (sp.dblM.visible) { sp.dblM.position.set(Math.cos(now * 5) * 0.6, 0.45, Math.sin(now * 5) * 0.6); sp.dblM.rotation.y = now * 6; }
      // trail
      // trail: a fixed length of road behind the sphere (frame-rate independent), bending with recent lane changes
      if (v.alive) { sp.hist.unshift([ss, v.x]); while (sp.hist.length > 2 && sp.hist[sp.hist.length - 1][0] < ss - 8) sp.hist.pop(); }
      writeTrail(sp, v.winner, ss, v.alive);
      if (sp.tag && v.alive) { sp.tag.visible = true; sp.tag.position.set(f.x + f.ux * 1.05, f.y + f.uy * 1.05, f.z + f.uz * 1.05); }
    }
    updateBursts(dt);
    // the followed racer's rail is drawn on top (see init)
    const top = followSp ? followSp.rl : race.rails[0];
    if (race.top !== top) { for (const rl of race.rails) setLayer(rl, rl === top ? 1 : 0); race.top = top; }
    // camera: behind and a little above the followed sphere, framing at least 1.25 s of road ahead
    const rl = followSp ? followSp.rl : race.rails[0], fv = view.spheres.find((x) => x.i === (followSp ? followSp.rl.b.i : -1));
    const lx = fv ? fv.x : 0, sNow = fv ? fv.s : s;
    const k = 1 - Math.exp(-dt * 10);
    cam.lx = cam.lx === undefined ? lx : lerp(cam.lx, lx, k);
    cam.dist = lerp(cam.dist ?? 5, view.phase === 'done' ? 7.5 : 5.0, 1 - Math.exp(-dt * 2));
    cam.h = lerp(cam.h ?? 1.75, view.phase === 'done' ? 2.6 : 1.75, 1 - Math.exp(-dt * 2));
    const e = railAt(rl, sNow - cam.dist, cam.lx * 0.55, cam.h), l = railAt(rl, sNow + 11, cam.lx * 0.3, 0.25);
    // a new subject (spectating, results) eases over instead of jumping
    if (cam.subject !== rl || view.snap) { cam.from = cam.subject && !view.snap ? { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z, lx: cam.look.x, ly: cam.look.y, lz: cam.look.z } : null; cam.blend = 0; cam.subject = rl; }
    cam.blend = Math.min(1, (cam.blend ?? 1) + Math.max(dt, (now - (cam.lastNow || now))) * 1.8); cam.lastNow = now;
    const b = cam.from ? smooth(cam.blend) : 1;
    cam.pos.x = cam.from ? lerp(cam.from.x, e.x, b) : e.x; cam.pos.y = cam.from ? lerp(cam.from.y, e.y, b) : e.y; cam.pos.z = cam.from ? lerp(cam.from.z, e.z, b) : e.z;
    cam.look.x = cam.from ? lerp(cam.from.lx, l.x, b) : l.x; cam.look.y = cam.from ? lerp(cam.from.ly, l.y, b) : l.y; cam.look.z = cam.from ? lerp(cam.from.lz, l.z, b) : l.z;
    if (b >= 1) cam.from = null;
    // widen briefly when another racer is close (crossings, parallel runs)
    let near = 0; for (const sp of race.spheres) if (sp !== followSp && sp.g.visible) { const d = sp.g.position.distanceTo(cam.pos); if (d < 9) near = Math.max(near, 1 - d / 9); }
    const fovT = 64 + clamp(((fv && fv.v) || 20) - 20, 0, 24) / 15 * 8 + near * 4 + (view.phase === 'done' ? -4 : 0) + (camera.aspect < 1 ? (1 - camera.aspect) * 34 : 0); // portrait: keep both lanes in frame
    cam.fov = lerp(cam.fov, fovT, 1 - Math.exp(-dt * 3));
    camera.fov = cam.fov; camera.updateProjectionMatrix();
    cam.shake = Math.max(0, cam.shake - dt * 3);
    camera.position.set(cam.pos.x + (Math.random() - 0.5) * cam.shake * 0.3, cam.pos.y + (Math.random() - 0.5) * cam.shake * 0.3, cam.pos.z);
    camera.up.set(e.ux * 0.3, 0.7 + e.uy * 0.3, e.uz * 0.3);
    camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
    camOther.position.copy(camera.position); camOther.quaternion.copy(camera.quaternion); camOther.fov = camera.fov; camOther.aspect = camera.aspect; camOther.updateProjectionMatrix();
    guardLane(rl, sNow, followSp, now);
    W.key.position.set(cam.pos.x + 4, cam.pos.y + 10, cam.pos.z + 6); W.key.target.position.set(cam.look.x, cam.look.y, cam.look.z);
    // finale: the merge arena glows harder; chromatic theme drifts hue
    if (theme.shift) { const c = new T.Color().setHSL((now * 0.02) % 1, 0.7, 0.045, T.SRGBColorSpace); scene.fog.color.copy(c); scene.background.copy(c); }
    bloom.strength = 0.26 + (t > COLLAPSE_AT && view.phase === 'play' ? 0.1 : 0) + (view.phase === 'done' ? 0.12 : 0);
    if (race.dec.userData.pts) race.dec.userData.pts.rotation.y = 0;
    render(dt);
  }
  const xAt = (H, s) => { for (const h of H) if (h[0] <= s) return h[1]; return H.length ? H[H.length - 1][1] : 0; };
  // Keep your ball the only ball in your lane. Every frame, the stretch of your rail you can see (a little behind
  // your ball to 80 u ahead, from the road up to just above the ball) is projected to the screen; any rival ball
  // that would be drawn inside that shape, or close to its edge, isn't drawn (nor its trail and name). It comes back
  // only after it has been clear for a moment, so nothing flickers in and out at the edge.
  const PJ = { a: null, b: null };
  function screenOf(p, out) { out.set(p.x, p.y, p.z).project(camera); return { x: (out.x + 1) * 0.5 * innerWidth, y: (1 - out.y) * 0.5 * innerHeight, z: out.z }; }
  function guardLane(rl, sNow, followSp, now) {
    if (!PJ.a) { PJ.a = new T.Vector3(); PJ.b = new T.Vector3(); }
    camera.updateMatrixWorld();
    const quads = [];
    let prev = null;
    for (let d = -3; d <= 80; d += d < 10 ? 1 : 2.5) {
      const sr = sNow + d;
      const L = screenOf(railAt(rl, sr, -RAIL_HALF - 0.1, 0), PJ.a), Rr = screenOf(railAt(rl, sr, RAIL_HALF + 0.1, 0), PJ.a);
      const Lt = screenOf(railAt(rl, sr, -RAIL_HALF - 0.1, 1.2), PJ.a), Rt = screenOf(railAt(rl, sr, RAIL_HALF + 0.1, 1.2), PJ.a);
      const cur = { L, R: Rr, Lt, Rt, ok: L.z < 1 && Rr.z < 1 && L.z > -1 };
      if (prev && prev.ok && cur.ok) { quads.push([prev.L, prev.R, cur.R, cur.L]); quads.push([prev.Lt, prev.Rt, cur.Rt, cur.Lt]); quads.push([prev.L, prev.Lt, cur.Lt, cur.L]); quads.push([prev.R, prev.Rt, cur.Rt, cur.R]); }
      prev = cur;
    }
    const inQuad = (p, q, m) => {
      let pos = 0, neg = 0;
      for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (c > 0) pos++; else if (c < 0) neg++; }
      if (!pos || !neg) return true;
      for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, u = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1); if (Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) < m) return true; }
      return false;
    };
    for (const sp of race.spheres) {
      if (sp === followSp || sp.dead) continue;
      const c = screenOf(sp.g.position, PJ.b);
      // on-screen radius of the ball plus its glow, plus a safety margin
      const edge = screenOf(sp.g.position.clone().addScaledVector(camera.up, SPHERE_R * 1.3), PJ.a), rpx = Math.hypot(edge.x - c.x, edge.y - c.y) + 4;
      const hit = c.z > -1 && c.z < 1 && quads.some((q) => inQuad(c, q, rpx));
      if (hit) sp.clearAt = now + 0.35;
      const show = !(sp.clearAt > now);
      sp.g.visible = show; sp.trail.visible = show; if (sp.tag) sp.tag.visible = show && sp.tag.visible;
    }
  }
  function writeTrail(sp, win, s, alive) {
    const pa = sp.trail.geometry.attributes.position, ca = sp.trail.geometry.attributes.color, H = sp.hist, N = 18, col = sp.rl.color, len = win ? 5 : 3.2;
    for (let k = 0; k < N; k++) {
      const sk = s - (k / (N - 1)) * len, f = railAt(sp.rl, sk, xAt(H, sk), SPHERE_R * 0.7);
      const p = [f.x, f.y, f.z, f.sx, f.sy, f.sz], w = (win ? 0.3 : 0.2) * (1 - k / N), a = Math.pow(1 - k / N, 1.5) * (alive ? 0.9 : 0);
      for (let e = 0; e < 2; e++) { const sg = e ? 1 : -1, o = (k * 2 + e) * 3; pa.array[o] = p[0] + p[3] * w * sg; pa.array[o + 1] = p[1] + p[4] * w * sg - 0.05; pa.array[o + 2] = p[2] + p[5] * w * sg; ca.array[o] = col.r * a; ca.array[o + 1] = col.g * a; ca.array[o + 2] = col.b * a; }
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
  }
  // elimination: shell fractures into bright shards and a colour-coded shock ring
  function burst(f, color, big, scale = 1, rl = null) {
    const into = rl ? rl.grp : race.root, layer = rl ? rl.layer : 0;
    const mat = new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6), toneMapped: false, transparent: true });
    for (let k = 0; k < Math.round((big ? 34 : 22) * scale); k++) {
      const m = new T.Mesh(G.tetra, mat); m.position.set(f.x, f.y, f.z);
      const a = Math.random() * 6.283, u = Math.random() * 1.6 - 0.2, sp = 4 + Math.random() * 9;
      m.userData.v = new T.Vector3(Math.cos(a) * sp * 0.6 + f.tx * 3, u * sp, Math.sin(a) * sp * 0.6 + f.tz * 3); m.userData.spin = new T.Vector3(Math.random() * 9, Math.random() * 9, 0);
      m.layers.set(layer); into.add(m); race.shards.push({ m, life: 1.1 + Math.random() * 0.5, into });
    }
    const ring = new T.Mesh(G.wave, new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.position.set(f.x, f.y, f.z); ring.lookAt(f.x + f.ux, f.y + f.uy, f.z + f.uz); ring.layers.set(layer); into.add(ring); race.waves.push({ m: ring, life: 0.8, into });
    if (big) cam.shake = 1.4;
  }
  function updateBursts(dt) {
    for (const p of race.shards) { p.life -= dt; p.m.userData.v.y -= 9 * dt; p.m.position.addScaledVector(p.m.userData.v, dt); p.m.rotation.x += p.m.userData.spin.x * dt; p.m.rotation.y += p.m.userData.spin.y * dt; p.m.scale.setScalar(Math.max(0.01, p.life)); if (p.life <= 0) p.into.remove(p.m); }
    race.shards = race.shards.filter((p) => p.life > 0);
    for (const w of race.waves) { w.life -= dt; w.m.scale.setScalar(1 + (0.8 - w.life) * 9); w.m.material.opacity = Math.max(0, w.life); if (w.life <= 0) w.into.remove(w.m); }
    race.waves = race.waves.filter((w) => w.life > 0);
  }
  function render(dt) {
    // dynamic resolution: hold ~60 fps on mid-range hardware
    W.frameMs = W.frameMs * 0.95 + dt * 1000 * 0.05;
    if (W.frameMs > 21 && W.pixelRatio > 0.6) { if (++W.slowFrames > 40) { W.pixelRatio = Math.max(0.6, W.pixelRatio - 0.15); W.slowFrames = 0; resize(); } }
    else if (W.frameMs < 14 && W.pixelRatio < Math.min(devicePixelRatio || 1, 1.6)) { if (++W.slowFrames > 240) { W.pixelRatio = Math.min(Math.min(devicePixelRatio || 1, 1.6), W.pixelRatio + 0.1); W.slowFrames = 0; resize(); } }
    else W.slowFrames = 0;
    composer.render(dt);
  }
  return { init, setRace, clearRace, frame, get ready() { return ready; }, get race() { return race; }, shake(n) { cam.shake = Math.max(cam.shake, n); } };
})();
