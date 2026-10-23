// ───────────────────────── THE WORLD: three.js scene drawn from the race data ─────────────────────────
// Nothing here affects play. Every racer rides the inside of a see-through neon pipe; the four pipes braid round a
// shared spine. Your own pipe is graphite glass with a lavender grid and neon rings in your colour; the others glow
// as outlines, so you always know where they are. Spikes, pickups and strips sit on the pipe wall exactly where the
// simulation tests them (distance × position round the pipe). The camera rides inside your pipe and rolls with your
// ball, so your ball is always at the bottom of the screen.
const THEMES = {
  void: { bg: 0x04030c, fog: 0x070516, density: 0.0085, hazard: 0xff2e5b, accent: 0x22e6ff, accent2: 0xff3dcb, decor: 'rings' },
  solar: { bg: 0x110402, fog: 0x2a0b03, density: 0.01, hazard: 0xffd23f, accent: 0xff7a1c, accent2: 0xff3d3d, decor: 'embers' },
  ultraviolet: { bg: 0x0a0418, fog: 0x1a0b36, density: 0.011, hazard: 0xffffff, accent: 0x7a5cff, accent2: 0xc49bff, decor: 'rings' },
  chromatic: { bg: 0x050512, fog: 0x0b0a24, density: 0.0085, hazard: 0xff2e5b, accent: 0x22e6ff, accent2: 0xb6ff3b, decor: 'shards', shift: true },
  vector: { bg: 0x02060c, fog: 0x06121e, density: 0.01, hazard: 0xff2e5b, accent: 0x4cc9ff, accent2: 0xe0f6ff, decor: 'rain' },
  prism: { bg: 0x06050f, fog: 0x0e0b20, density: 0.008, hazard: 0xff2e5b, accent: 0xa9c7ff, accent2: 0xff3dcb, decor: 'monoliths' },
  signal: { bg: 0x030a08, fog: 0x08201a, density: 0.01, hazard: 0xff4f6d, accent: 0x9fffe0, accent2: 0x5cffc8, decor: 'shards' },
  ion: { bg: 0x04040c, fog: 0x0a0a1e, density: 0.0085, hazard: 0xff2e5b, accent: 0x6fd8ff, accent2: 0xffe08a, decor: 'ionrings' },
};
// what each pickup looks like (colour + shape), shared with the HUD
const ITEM_LOOK = {
  shield: { color: '#6FB7FF', name: 'Shield' }, magnet: { color: '#B48CFF', name: 'Magnet' }, double: { color: '#FFF1A8', name: 'Double orbs' },
  cannon: { color: '#FF9F43', name: 'Cannon' }, burst: { color: '#FF4FD8', name: 'Burst' }, emp: { color: '#F5FF4A', name: 'EMP' }, ether: { color: '#DFFFFF', name: 'Ether boost' },
};
const VIEW_AHEAD = 190, VIEW_BEHIND = 6;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const segAngle = (x) => -Math.PI / 2 + (2 * Math.PI * x) / SEGS; // position round the pipe → angle (0 = bottom, +1 = one step right)
const WORLD = (() => {
  let T = null, renderer = null, scene = null, camera = null, camOther = null, composer = null, bloom = null, ready = false;
  let race = null, starPts = null, theme = THEMES.void, themeKey = 'void';
  const cam = { pos: null, look: null, fov: 76, shake: 0, phi: null };
  const W = { pixelRatio: 1, frameMs: 16, slowFrames: 0 };
  let trackKey = 'nebula';
  const spine = (s, out) => RAILGEO.spine(trackKey, s, out);
  const spineFrame = (s) => RAILGEO.spineFrame(trackKey, s);
  // ── materials/geometries (built once per theme)
  let M = null, G = null;
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
  }
  // the pipe wall: u runs round the pipe (16 positions), v along it (one tile = 6 u)
  function pipeTexture(color, own) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 192; const g = c.getContext('2d'), W2 = 512 / SEGS;
    if (own) { g.fillStyle = 'rgba(36,32,58,0.78)'; g.fillRect(0, 0, 512, 192); }
    else { g.globalAlpha = 0.14; g.fillStyle = color; g.fillRect(0, 0, 512, 192); g.globalAlpha = 1; } // a faint glass skin (added on top of the scene) so other pipes read as tubes
    if (own) {
      g.fillStyle = 'rgba(255,255,255,0.025)'; for (let k = 0; k < SEGS; k += 2) g.fillRect(k * W2, 0, W2, 192); // alternate positions faintly
      g.strokeStyle = 'rgba(175,165,255,.22)'; g.lineWidth = 1.5;
      for (let k = 0; k < SEGS; k++) { g.beginPath(); g.moveTo(k * W2 + 1, 0); g.lineTo(k * W2 + 1, 192); g.stroke(); }
      for (const y of [64, 128]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    }
    g.strokeStyle = color; g.globalAlpha = own ? 0.8 : 0.85; g.lineWidth = own ? 2.5 : 5;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(512, 2); g.stroke(); // a ring in your colour every 6 u
    for (let k = 0; k < SEGS; k += 4) { g.beginPath(); g.moveTo(k * W2 + 1, 0); g.lineTo(k * W2 + 1, 192); g.stroke(); } // 4 lines along the pipe
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function buildShared() {
    const hot = new T.Color(theme.hazard);
    M = {
      hotSolid: new T.MeshStandardMaterial({ color: 0x1a060c, emissive: hot, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4 }),
      hotPatch: new T.MeshBasicMaterial({ color: hot.clone().multiplyScalar(0.9), transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, side: T.DoubleSide }),
      guide: new T.MeshBasicMaterial({ color: new T.Color(0xb6ff3b), transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, side: T.DoubleSide, blending: T.AdditiveBlending }),
      orb: new T.MeshBasicMaterial({ color: new T.Color(0xffe08a).multiplyScalar(1.6), toneMapped: false }),
      glowTex: glowTexture(),
    };
    G = {
      cone: new T.ConeGeometry(0.2, 0.62, 4), box: new T.BoxGeometry(1, 1, 1), oct: new T.OctahedronGeometry(0.26, 0),
      tetra: new T.TetrahedronGeometry(0.12, 0), wave: new T.RingGeometry(0.9, 1.05, 48), ico: new T.IcosahedronGeometry(1, 2),
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
    camera = new T.PerspectiveCamera(76, 1, 0.05, 900);
    cam.pos = new T.Vector3(0, 3, 8); cam.look = new T.Vector3(0, 0, -10);
    const hemi = new T.HemisphereLight(0x8a80ff, 0x050308, 0.7); hemi.layers.enableAll(); scene.add(hemi);
    const key = new T.DirectionalLight(0xffffff, 0.6); key.layers.enableAll(); key.position.set(4, 10, 6); scene.add(key); scene.add(key.target);
    W.key = key;
    // Your own pipe can never be hidden. Pass 1 draws everything else (other pipes, their balls, the scenery); pass 2
    // clears depth and draws your pipe, its spikes and pickups and your ball (layer 1) on top. Your pipe's glass
    // walls let the others show through, dimmed.
    camOther = new T.PerspectiveCamera(76, 1, 0.5, 900); camOther.layers.set(0); camera.layers.set(1);
    composer = new T.EffectComposer(renderer);
    composer.addPass(new T.RenderPass(scene, camOther));
    const mine = new T.RenderPass(scene, camera); mine.clear = false; mine.clearDepth = true;
    const draw = mine.render.bind(mine); mine.render = (...a) => { const bg = scene.background; scene.background = null; draw(...a); scene.background = bg; };
    composer.addPass(mine);
    bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.26, 0.3, 0.7);
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
  // ── geometry helpers: a point on rail rl at distance s, offset (X across, Y up) in the rail's frame
  function railAt(rl, s, x = 0, y = 0, out) {
    const f = (s + 30) / RAILGEO.STEP, k = clamp(Math.floor(f), 0, rl.N - 2), w = clamp(f - k, 0, 1), a = k * 3, c = a + 3;
    const px = lerp(rl.pos[a], rl.pos[c], w), py = lerp(rl.pos[a + 1], rl.pos[c + 1], w), pz = lerp(rl.pos[a + 2], rl.pos[c + 2], w);
    const sx = lerp(rl.side[a], rl.side[c], w), sy = lerp(rl.side[a + 1], rl.side[c + 1], w), sz = lerp(rl.side[a + 2], rl.side[c + 2], w);
    const ux = lerp(rl.up[a], rl.up[c], w), uy = lerp(rl.up[a + 1], rl.up[c + 1], w), uz = lerp(rl.up[a + 2], rl.up[c + 2], w);
    out = out || {};
    out.x = px + sx * x + ux * y; out.y = py + sy * x + uy * y; out.z = pz + sz * x + uz * y;
    const tx = rl.pos[c] - rl.pos[a], ty = rl.pos[c + 1] - rl.pos[a + 1], tz = rl.pos[c + 2] - rl.pos[a + 2], tl = Math.hypot(tx, ty, tz) || 1;
    out.tx = tx / tl; out.ty = ty / tl; out.tz = tz / tl;
    out.sx = sx; out.sy = sy; out.sz = sz; out.ux = ux; out.uy = uy; out.uz = uz;
    return out;
  }
  /** a point inside rail rl's pipe: distance s, position x round the wall (float), r from the pipe's centre line.
   *  Also returns the wall's inward normal (nx…) and the direction round the pipe (rx…, "right" at the bottom). */
  function tubeAt(rl, s, x, r, out) {
    const phi = segAngle(x), c = Math.cos(phi), sn = Math.sin(phi);
    const f = railAt(rl, s, r * c, r * sn, out);
    f.nx = -(c * f.sx + sn * f.ux); f.ny = -(c * f.sy + sn * f.uy); f.nz = -(c * f.sz + sn * f.uz);
    f.rx = -sn * f.sx + c * f.ux; f.ry = -sn * f.sy + c * f.uy; f.rz = -sn * f.sz + c * f.uz;
    return f;
  }
  const _m = () => new T.Matrix4(), _v = () => new T.Vector3();
  /** place obj on the wall: local X = round the pipe (right), Y = inward (up off the wall), Z = backwards */
  function orientWall(obj, rl, s, x, r) {
    const f = tubeAt(rl, s, x, r);
    obj.position.set(f.x, f.y, f.z);
    obj.quaternion.setFromRotationMatrix(_m().makeBasis(_v().set(f.rx, f.ry, f.rz), _v().set(f.nx, f.ny, f.nz), _v().set(-f.tx, -f.ty, -f.tz)));
    return obj;
  }
  // ── a race
  function clearRace() {
    if (!race) return;
    scene.remove(race.root);
    race.root.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); if (o.material && o.material.map && o.userData.ownTex) o.material.map.dispose(); });
    race = null;
  }
  const race0 = { me: -1 };
  /** R: the round (createRound). me: seat index of this player (or -1). */
  function setRace(R, me, key, themeOverride) {
    clearRace();
    trackKey = SIM0.TRACKS[key] ? key : 'nebula';
    const th = THEMES[themeOverride] ? themeOverride : SIM0.TRACKS[trackKey].theme;
    if (th !== themeKey) setTheme(th);
    const root = new T.Group(); scene.add(root); race0.me = me;
    const course = R.course, n = R.active.length, sMax = course.end + 60;
    const geo = RAILGEO.build(course, n, course.tl.sAtT, trackKey);
    const rails = R.active.map((b, j) => { const grp = new T.Group(); root.add(grp); return { b, j, ...geo[j], color: new T.Color(b.color), grp, layer: 0 }; });
    for (const rl of rails) {
      rl.ownMat = new T.MeshBasicMaterial({ map: pipeTexture(rl.b.color, true), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false });
      rl.otherMat = new T.MeshBasicMaterial({ map: pipeTexture(rl.b.color, false), transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, toneMapped: false, opacity: 0.85 });
      // the pipe in 40 u pieces; only the pieces near the racers are drawn
      rl.chunks = [];
      for (let s0 = -30; s0 < sMax; s0 += PIPE_CHUNK) {
        const g = pipeGeometry(rl, s0, Math.min(sMax, s0 + PIPE_CHUNK));
        const pipe = new T.Mesh(g, rl.otherMat); pipe.renderOrder = -1;
        rl.grp.add(pipe); rl.chunks.push({ s0, s1: s0 + PIPE_CHUNK, pipe });
      }
      rl.items = new Map(); // spike groups / pickups built lazily, only for the pipe being followed
    }
    const spheres = rails.map((rl) => makeSphere(rl, rl.grp, rl.b.i === me));
    const dec = makeDecor(root, sMax);
    race = { R, me, rails, spheres, root, dec, shards: [], rings: [], fx: [], top: null, evAt: 0, waveFx: new Map(), shotFx: new Map() };
    return race;
  }
  // a piece of pipe as a tube mesh (1 u steps along, 32 round), uv: u round the pipe, v along it (6 u per tile)
  const PIPE_CHUNK = 40;
  function pipeGeometry(rl, sA, sB) {
    const RS = 32, N = Math.round(sB - sA) + 1, v = new Float32Array(N * (RS + 1) * 3), uv = new Float32Array(N * (RS + 1) * 2), idx = [];
    for (let k = 0; k < N; k++) {
      const s = sA + k;
      for (let j = 0; j <= RS; j++) {
        const x = (j / RS) * SEGS - 0.5, f = tubeAt(rl, s, x, TUBE_R), o = (k * (RS + 1) + j);
        v[o * 3] = f.x; v[o * 3 + 1] = f.y; v[o * 3 + 2] = f.z; uv[o * 2] = j / RS; uv[o * 2 + 1] = s / 6;
        if (k < N - 1 && j < RS) { const a = o, b = o + RS + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(v, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
    return g;
  }
  function setLayer(o, layer) { o.traverse((x) => { if (x.isLight) x.layers.enableAll(); else x.layers.set(layer); }); }
  function setFollowed(rl) {
    for (const r of race.rails) {
      const mine = r === rl;
      for (const c of r.chunks) { c.pipe.material = mine ? r.ownMat : r.otherMat; c.mine = mine; }
      r.layer = mine ? 1 : 0; setLayer(r.grp, r.layer);
      for (const it of r.items.values()) it.g.visible = false;
    }
    race.top = rl;
  }
  // ── spikes on the pipe wall: one instanced mesh per group (a cone per position per row) over a red patch
  function makeGroup(g, rl) {
    // spiral sleeves are long runs of thin slices: one row of single spikes each, so the twisting channel stays readable
    const sleeve = g.kind === 'spiral', len = g.s1 - g.s0, rows = sleeve ? 1 : Math.max(1, Math.round(len / 0.55)), step = len / rows, DX = sleeve ? [0] : [-0.22, 0.22];
    const segs = []; for (let k = 0; k < SEGS; k++) if ((g.mask >> k) & 1) segs.push(k);
    const grp = new T.Group();
    const cones = new T.InstancedMesh(G.cone, M.hotSolid, rows * segs.length * DX.length); cones.frustumCulled = false;
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(1, 1, 1), basis = _m();
    let n = 0;
    for (let r = 0; r < rows; r++) for (const k of segs) for (const dx of DX) {
      const f = tubeAt(rl, g.s0 + step * (r + 0.5), k + dx, TUBE_R - 0.3);
      q.setFromRotationMatrix(basis.makeBasis(_v().set(f.rx, f.ry, f.rz), _v().set(f.nx, f.ny, f.nz), _v().set(-f.tx, -f.ty, -f.tz)));
      sc.setScalar(0.92 + ((r * 7 + k * 3) % 4) * 0.05); m4.compose(_v().set(f.x, f.y, f.z), q, sc); cones.setMatrixAt(n++, m4);
    }
    cones.count = n; grp.add(cones);
    // the red patch on the wall under every spiked position, so a blocked arc reads from far away
    const A = 6, NR = 2, v = [], idx = [];
    for (const k of segs) for (let i = 0; i < NR; i++) for (let j = 0; j <= A; j++) {
      const f = tubeAt(rl, g.s0 + (len * i) / (NR - 1), k - 0.48 + (0.96 * j) / A, TUBE_R - 0.015); v.push(f.x, f.y, f.z);
    }
    let base = 0;
    for (const k of segs) { for (let j = 0; j < A; j++) { const a = base + j, b = base + A + 1 + j; idx.push(a, b, a + 1, a + 1, b, b + 1); } base += NR * (A + 1); void k; }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.Float32BufferAttribute(v, 3)); pg.setIndex(idx);
    const patch = new T.Mesh(pg, M.hotPatch); patch.frustumCulled = false; grp.add(patch);
    // in a sleeve, the open channel glows so you can see where it twists
    if (sleeve) {
      const gv = [], gi = []; let gb = 0;
      for (let k = 0; k < SEGS; k++) if (!((g.mask >> k) & 1)) {
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const f = tubeAt(rl, g.s0 + len * i, k - 0.32 + 0.64 * j, TUBE_R - 0.02); gv.push(f.x, f.y, f.z); }
        gi.push(gb, gb + 2, gb + 1, gb + 1, gb + 2, gb + 3); gb += 4;
      }
      const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(gv, 3)); gg.setIndex(gi);
      const guide = new T.Mesh(gg, M.guide); guide.frustumCulled = false; grp.add(guide);
    }
    setLayer(grp, rl.layer); rl.grp.add(grp);
    return { kind: 'group', g: grp, ref: g, s0: g.s0, s1: g.s1 };
  }
  // pickups on the wall
  function itemMesh(power) {
    const L = ITEM_LOOK[power], col = new T.Color(L ? L.color : '#ffe08a'), mat = new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.25), toneMapped: false }), g = new T.Group();
    if (!power) g.add(new T.Mesh(G.oct, M.orb));
    else if (power === 'shield') { g.add(new T.Mesh(new T.IcosahedronGeometry(0.34, 1), new T.MeshBasicMaterial({ color: col, wireframe: true, toneMapped: false }))); g.add(new T.Mesh(new T.IcosahedronGeometry(0.16, 0), mat)); }
    else if (power === 'magnet') { const u = new T.Mesh(new T.TorusGeometry(0.22, 0.08, 8, 20, Math.PI), mat); u.rotation.z = Math.PI; g.add(u); for (const x of [-0.22, 0.22]) { const tip = new T.Mesh(G.box, new T.MeshBasicMaterial({ color: 0xffffff })); tip.scale.set(0.17, 0.12, 0.17); tip.position.set(x, 0.05, 0); g.add(tip); } }
    else if (power === 'double') { for (const x of [-0.15, 0.15]) { const d = new T.Mesh(G.oct, mat); d.scale.setScalar(0.8); d.position.x = x; g.add(d); } }
    else if (power === 'cannon') { const barrel = new T.Mesh(new T.CylinderGeometry(0.11, 0.15, 0.6, 12), mat); barrel.rotation.x = Math.PI / 2; g.add(barrel); const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.04, 6, 16), new T.MeshBasicMaterial({ color: 0xffffff })); ring.position.z = -0.25; g.add(ring); }
    else if (power === 'burst') { for (let k = 0; k < 3; k++) { const s = new T.Mesh(G.oct, mat); s.scale.set(0.5, 1.4, 0.5); s.rotation.z = (k * Math.PI) / 3; g.add(s); } }
    else if (power === 'emp') { const pts = [[-0.1, 0.32], [0.08, 0.04], [-0.06, 0.02], [0.12, -0.32]]; for (let k = 0; k < 3; k++) { const [a, b] = [pts[k], pts[k + 1]], seg = new T.Mesh(G.box, mat), dx = b[0] - a[0], dy = b[1] - a[1]; seg.scale.set(0.07, Math.hypot(dx, dy), 0.07); seg.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0); seg.rotation.z = -Math.atan2(dx, dy); g.add(seg); } }
    else if (power === 'ether') { const d = new T.Mesh(new T.OctahedronGeometry(0.3, 0), new T.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 0.7, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.85 })); d.scale.y = 1.4; g.add(d); }
    return g;
  }
  function makePickup(o, rl) {
    const g = new T.Group(); orientWall(g, rl, o.s, o.seg, TUBE_R - 0.55);
    const m = itemMesh(o.power); g.add(m);
    const col = o.power ? ITEM_LOOK[o.power].color : '#ffd26b';
    const halo = new T.Sprite(new T.SpriteMaterial({ map: M.glowTex, color: col, transparent: true, opacity: o.power ? 0.65 : 0.45, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(o.power ? 1.5 : 1.1, o.power ? 1.5 : 1.1, 1); g.add(halo);
    setLayer(g, rl.layer); rl.grp.add(g);
    return { kind: 'pickup', g, m, ref: o, s0: o.s, s1: o.s };
  }
  // speed strip: a pad on one position with moving chevrons (cyan boost) or bars (amber slow), framed by a glowing gate
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
  function makeStrip(st, rl) {
    const L = st.s1 - st.s0, NS = 13, v = [], uv = [], idx = [];
    for (let i = 0; i < NS; i++) {
      for (let e = 0; e < 2; e++) { const f = tubeAt(rl, st.s0 + (L * i) / (NS - 1), st.seg + (e ? 0.45 : -0.45), TUBE_R - 0.02); v.push(f.x, f.y, f.z); uv.push(e, -(L * i) / (NS - 1) / 1.4); }
      if (i < NS - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(v, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: stripTexture(st.kind), color: new T.Color(st.kind === 'boost' ? 0xbff8ff : 0xffd9a0).multiplyScalar(1.2), transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    m.frustumCulled = false;
    const g = new T.Group(); g.add(m);
    const am = new T.MeshBasicMaterial({ color: new T.Color(st.kind === 'boost' ? 0x22e6ff : 0xffb347).multiplyScalar(1.2), toneMapped: false });
    const gate = new T.Group(); orientWall(gate, rl, st.s0, st.seg, TUBE_R);
    for (const dx of [-0.42, 0.42]) { const post = new T.Mesh(G.box, am); post.scale.set(0.06, 0.95, 0.06); post.position.set(dx, 0.47, 0); gate.add(post); }
    const top = new T.Mesh(G.box, am); top.scale.set(0.9, 0.08, 0.08); top.position.set(0, 0.95, 0); gate.add(top);
    g.add(gate);
    setLayer(g, rl.layer); rl.grp.add(g);
    return { kind: 'strip', g, m, ref: st, s0: st.s0, s1: st.s1 };
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
    const fxMat = (c, o = 0.75) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, toneMapped: false, depthWrite: false });
    const shieldM = new T.Mesh(new T.IcosahedronGeometry(SPHERE_R * 1.55, 1), new T.MeshBasicMaterial({ color: 0x6fb7ff, wireframe: true, transparent: true, opacity: 0.7, toneMapped: false })); shieldM.visible = false; g.add(shieldM);
    const magnetM = new T.Mesh(new T.TorusGeometry(SPHERE_R * 1.8, 0.03, 6, 48), fxMat(0xb48cff, 0.85)); magnetM.rotation.x = Math.PI / 2; magnetM.visible = false; g.add(magnetM);
    const dblM = new T.Mesh(G.oct, new T.MeshBasicMaterial({ color: 0xfff1a8, toneMapped: false })); dblM.scale.setScalar(0.35); dblM.visible = false; g.add(dblM);
    const etherM = new T.Mesh(new T.IcosahedronGeometry(SPHERE_R * 1.9, 2), new T.MeshBasicMaterial({ color: 0xdfffff, wireframe: true, transparent: true, opacity: 0.55, toneMapped: false, blending: T.AdditiveBlending })); etherM.visible = false; g.add(etherM);
    const slowM = new T.Mesh(new T.TorusGeometry(SPHERE_R * 1.45, 0.05, 6, 32), fxMat(0xff4fd8, 0.8)); slowM.visible = false; g.add(slowM);
    const empM = new T.Group(); for (let k = 0; k < 3; k++) { const a = new T.Mesh(new T.TorusGeometry(SPHERE_R * (1.3 + k * 0.25), 0.02, 4, 24, Math.PI * 0.8), fxMat(0xf5ff4a, 0.9)); a.rotation.set(k, k * 2, 0); empM.add(a); } empM.visible = false; g.add(empM);
    // a ring of your colour on the wall under your ball, so you always know which ball is yours
    const mark = new T.Mesh(new T.RingGeometry(SPHERE_R * 1.25, SPHERE_R * 1.75, 40), new T.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.2), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    mark.rotation.x = -Math.PI / 2; mark.position.y = -SPHERE_R + 0.03; mark.visible = false; g.add(mark);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: M.glowTex, color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(1.8, 1.8, 1); g.add(halo);
    const light = new T.PointLight(col, isMe ? 2.4 : 1.4, 7, 2); light.position.set(0, 0.6, 0); g.add(light);
    // trail ribbon along the wall
    const TN = 18, tv = new Float32Array(TN * 2 * 3), tc = new Float32Array(TN * 2 * 3), ti = [];
    for (let k = 0; k < TN - 1; k++) { const a = k * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(tv, 3)); tg.setAttribute('color', new T.BufferAttribute(tc, 3)); tg.setIndex(ti);
    const trail = new T.Mesh(tg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    trail.frustumCulled = false; rl.grp.add(trail);
    const tag = isMe ? null : nameTag(`${rl.b.glyph} ${rl.b.name}`, rl.b.color); if (tag) rl.grp.add(tag);
    return { rl, g, spin, extra: skin.extra, halo, light, trail, tag, hist: [], dead: false, roll: 0, isMe, shieldM, magnetM, dblM, etherM, slowM, empM, mark };
  }
  function makeDecor(root, sMax) {
    const grp = new T.Group(); root.add(grp);
    const acc = new T.Color(theme.accent), acc2 = new T.Color(theme.accent2);
    const sp = { x: 0, y: 0, z: 0 };
    if (theme.decor === 'rings' || theme.decor === 'ionrings') {
      const step = theme.decor === 'ionrings' ? 42 : 85, geo = new T.TorusGeometry(theme.decor === 'ionrings' ? 16 : 22, 0.08, 6, 90);
      for (let s = 60; s < sMax; s += step) {
        const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: (Math.floor(s / step) % 2 ? acc : acc2).clone().multiplyScalar(1.3), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }));
        spine(s, sp); m.position.set(sp.x, sp.y, sp.z); const f = spineFrame(s); m.lookAt(sp.x - f.sz, sp.y, sp.z + f.sx); m.rotateY(Math.PI / 2);
        grp.add(m);
      }
    } else if (theme.decor === 'monoliths') {
      const geo = new T.BoxGeometry(4, 40, 4);
      for (let s = 40; s < sMax; s += 30) for (const sg of [-1, 1]) {
        const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0x0d0b1e, emissive: sg > 0 ? acc : acc2, emissiveIntensity: 0.12, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.9 }));
        spine(s, sp); const f = spineFrame(s), d = 34 + 14 * Math.abs(Math.sin(s)); m.position.set(sp.x + f.sx * d * sg, sp.y - 6 + 8 * Math.sin(s * 0.7), sp.z + f.sz * d * sg); m.rotation.y = s; grp.add(m);
      }
    } else {
      const n = 1800, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const s = Math.random() * sMax; spine(s, sp); const f = spineFrame(s); let d = (Math.random() - 0.5) * 90; if (Math.abs(d) < 18) d += Math.sign(d || 1) * 18; const h = (Math.random() - 0.3) * 40; p[i * 3] = sp.x + f.sx * d; p[i * 3 + 1] = sp.y + h; p[i * 3 + 2] = sp.z + f.sz * d; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ color: acc.clone().multiplyScalar(1.5), size: theme.decor === 'rain' ? 0.12 : 0.16, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      pts.frustumCulled = false; grp.add(pts);
    }
    return grp;
  }
  // ── per-frame: build/show what's ahead on the followed pipe
  function updateItems(rl, b, t, s) {
    const C = race.R.course, items = rl.items;
    const want = (key, make) => { let it = items.get(key); if (!it) { it = make(); items.set(key, it); } return it; };
    const H = C.blocks;
    for (let j = SIM0.firstBlock(H, s - VIEW_BEHIND); j < H.length; j++) { const g = H[j]; if (g.s0 > s + VIEW_AHEAD) break; if (g.s1 + 1 < s - VIEW_BEHIND) continue; const it = want('g' + g.id, () => makeGroup(g, rl)); it.seen = race.frameNo; }
    for (const o of C.orbs) { if (o.s > s + VIEW_AHEAD) break; if (o.s < s - VIEW_BEHIND) continue; const it = want('o' + o.id, () => makePickup(o, rl)); it.seen = race.frameNo; }
    for (const st of C.strips) { if (st.s0 > s + VIEW_AHEAD || st.s1 < s - VIEW_BEHIND) continue; const it = want('x' + st.id, () => makeStrip(st, rl)); it.seen = race.frameNo; }
    for (const [key, it] of items) {
      if (it.seen !== race.frameNo) { rl.grp.remove(it.g); it.g.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); }); items.delete(key); continue; }
      // anything already behind the ball would sit between it and the camera: hidden
      const passed = it.s1 < s - 0.4;
      if (it.kind === 'group') it.g.visible = !passed && !b.gone.has(it.ref.id);
      else if (it.kind === 'pickup') { it.g.visible = !passed && !b.got.includes(it.ref.id); it.m.rotation.y = t * 3; it.m.rotation.x = t * 1.3; }
      else { it.g.visible = !passed && !b.strips.includes(it.ref.id); it.m.material.map.offset.y = -t * (it.ref.kind === 'boost' ? 2.5 : 0.6); }
    }
  }
  /**
   * view = { t, s, follow, phase, tick (race tick, fractional), spheres: [{ i, x (position round the pipe, float), s, v, alive, winner,
   *          shield, magnet, double, shieldPop, ether, slowed, lift (0..1 EMP), item }] }
   */
  function frame(dt, view) {
    if (!ready) return;
    const now = performance.now() / 1000;
    if (starPts) starPts.position.copy(camera.position);
    if (!race) { camera.position.set(Math.sin(now * 0.1) * 6, 3, 10); camera.lookAt(0, 0, -30); camOther.position.copy(camera.position); camOther.quaternion.copy(camera.quaternion); render(dt); return; }
    race.frameNo = (race.frameNo || 0) + 1;
    const { t } = view;
    let followSp = null;
    for (const sp of race.spheres) { const v = view.spheres.find((x) => x.i === sp.rl.b.i); if (v && v.i === view.follow) followSp = sp; }
    const top = followSp ? followSp.rl : race.rails[0];
    if (race.top !== top) setFollowed(top);
    const fv = view.spheres.find((x) => x.i === top.b.i) || view.spheres[0];
    updateItems(top, top.b, t, fv ? fv.s : 0);
    { const sv = fv ? fv.s : 0; for (const r of race.rails) for (const c of r.chunks) { c.pipe.visible = c.s1 > sv - 12 && c.s0 < sv + VIEW_AHEAD + 20; } }
    // balls
    for (const sp of race.spheres) {
      const v = view.spheres.find((x) => x.i === sp.rl.b.i); if (!v) continue;
      const lift = v.lift ? Math.sin(Math.PI * Math.min(1, v.lift)) * 0.85 : 0, buzz = v.lift ? (Math.random() - 0.5) * 0.08 : 0;
      const f = tubeAt(sp.rl, v.s, v.x + buzz, TUBE_R - SPHERE_R - 0.03 - lift - 0.03 * Math.abs(Math.sin(now * 9.4 + sp.rl.j)));
      if (!v.alive) {
        if (!sp.dead) { sp.dead = true; burst(f, sp.rl.color, sp.isMe, 1, sp.rl); }
        sp.g.visible = false; sp.light.intensity = 0; if (sp.tag) sp.tag.visible = false;
      } else { sp.dead = false; sp.g.visible = true; sp.light.intensity = 2.4; }
      sp.light.visible = v.i === view.follow; // one moving light (the ball you follow) keeps the scene cheap to draw
      sp.g.position.set(f.x, f.y, f.z);
      sp.g.quaternion.setFromRotationMatrix(_m().makeBasis(_v().set(f.rx, f.ry, f.rz), _v().set(f.nx, f.ny, f.nz), _v().set(-f.tx, -f.ty, -f.tz)));
      sp.roll += ((v.v || 0) * dt) / SPHERE_R; sp.spin.rotation.x = -sp.roll;
      for (const o of sp.extra.children) if (o.userData.orbit) o.rotation.z = now * o.userData.orbit;
      sp.mark.visible = v.i === view.follow && v.alive && !v.lift; if (sp.mark.visible) { sp.mark.material.opacity = 0.55 + 0.2 * Math.sin(now * 6); sp.mark.position.y = -SPHERE_R + 0.03 + lift; }
      sp.shieldM.visible = !!v.shield && v.alive; if (sp.shieldM.visible) { sp.shieldM.rotation.y = now * 1.5; sp.shieldM.rotation.x = now * 0.7; }
      if (v.shieldPop && !sp.popped) { sp.popped = true; burst(f, new T.Color(0x6fb7ff), false, 0.5, sp.rl); }
      if (!v.shieldPop) sp.popped = false;
      sp.magnetM.visible = !!v.magnet && v.alive; if (sp.magnetM.visible) sp.magnetM.scale.setScalar(1 + 0.08 * Math.sin(now * 12));
      sp.dblM.visible = !!v.double && v.alive; if (sp.dblM.visible) { sp.dblM.position.set(Math.cos(now * 5) * 0.6, 0.45, Math.sin(now * 5) * 0.6); sp.dblM.rotation.y = now * 6; }
      sp.etherM.visible = !!v.ether && v.alive; if (sp.etherM.visible) { sp.etherM.rotation.y = now * 4; sp.etherM.rotation.z = now * 2.6; sp.etherM.material.color.setHSL((now * 0.6) % 1, 0.8, 0.8); }
      sp.slowM.visible = !!v.slowed && v.alive; if (sp.slowM.visible) { sp.slowM.rotation.x = Math.PI / 2; sp.slowM.scale.setScalar(1 + 0.12 * Math.sin(now * 14)); }
      sp.empM.visible = !!v.lift && v.alive; if (sp.empM.visible) { sp.empM.rotation.y = now * 11; sp.empM.rotation.x = now * 7; }
      if (v.alive) { sp.hist.unshift([v.s, v.x]); while (sp.hist.length > 2 && sp.hist[sp.hist.length - 1][0] < v.s - 8) sp.hist.pop(); }
      writeTrail(sp, v.winner, v.s, v.alive && !v.lift);
      if (sp.tag && v.alive) { sp.tag.visible = true; sp.tag.position.set(f.x + f.nx * 0.9, f.y + f.ny * 0.9, f.z + f.nz * 0.9); }
    }
    updateBursts(dt);
    itemFx(view, now);
    // camera: inside the followed pipe, behind the ball, rolling with it so the ball is always at the bottom
    const rl = top, sNow = fv ? fv.s : 0, x = fv ? fv.x : 0;
    const k = 1 - Math.exp(-dt * 9);
    if (cam.phi == null || cam.subject !== rl) cam.phi = x;
    let dx = x - cam.phi; while (dx > SEGS / 2) dx -= SEGS; while (dx < -SEGS / 2) dx += SEGS; cam.phi += dx * k;
    cam.dist = lerp(cam.dist ?? 4.2, view.phase === 'done' ? 6.5 : 4.2, 1 - Math.exp(-dt * 2));
    const e = tubeAt(rl, sNow - cam.dist, cam.phi, TUBE_R * 0.12), l = tubeAt(rl, sNow + 9, cam.phi, TUBE_R * 0.42);
    if (cam.subject !== rl || view.snap) { cam.from = cam.subject && !view.snap ? { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z, lx: cam.look.x, ly: cam.look.y, lz: cam.look.z } : null; cam.blend = 0; cam.subject = rl; }
    cam.blend = Math.min(1, (cam.blend ?? 1) + Math.max(dt, (now - (cam.lastNow || now))) * 1.8); cam.lastNow = now;
    const bl = cam.from ? smooth(cam.blend) : 1;
    cam.pos.x = cam.from ? lerp(cam.from.x, e.x, bl) : e.x; cam.pos.y = cam.from ? lerp(cam.from.y, e.y, bl) : e.y; cam.pos.z = cam.from ? lerp(cam.from.z, e.z, bl) : e.z;
    cam.look.x = cam.from ? lerp(cam.from.lx, l.x, bl) : l.x; cam.look.y = cam.from ? lerp(cam.from.ly, l.y, bl) : l.y; cam.look.z = cam.from ? lerp(cam.from.lz, l.z, bl) : l.z;
    if (bl >= 1) cam.from = null;
    const fovT = 74 + clamp(((fv && fv.v) || 20) - 20, 0, 24) / 15 * 7 + (view.phase === 'done' ? -4 : 0) + (camera.aspect < 1 ? (1 - camera.aspect) * 30 : 0);
    cam.fov = lerp(cam.fov, fovT, 1 - Math.exp(-dt * 3));
    camera.fov = cam.fov; camera.updateProjectionMatrix();
    cam.shake = Math.max(0, cam.shake - dt * 3);
    camera.position.set(cam.pos.x + (Math.random() - 0.5) * cam.shake * 0.2, cam.pos.y + (Math.random() - 0.5) * cam.shake * 0.2, cam.pos.z + (Math.random() - 0.5) * cam.shake * 0.2);
    camera.up.set(e.nx, e.ny, e.nz);
    camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
    camOther.position.copy(camera.position); camOther.quaternion.copy(camera.quaternion); camOther.fov = camera.fov; camOther.aspect = camera.aspect; camOther.updateProjectionMatrix();
    guardLane(rl, sNow, x, followSp, now);
    W.key.position.set(cam.pos.x + 4, cam.pos.y + 10, cam.pos.z + 6); W.key.target.position.set(cam.look.x, cam.look.y, cam.look.z);
    if (theme.shift) { const c = new T.Color().setHSL((now * 0.02) % 1, 0.7, 0.045, T.SRGBColorSpace); scene.fog.color.copy(c); scene.background.copy(c); }
    bloom.strength = 0.26 + (t > COLLAPSE_AT && view.phase === 'play' ? 0.1 : 0) + (view.phase === 'done' ? 0.12 : 0);
    render(dt);
  }
  // ── item effects: bursts (an expanding energy shell), EMPs (a shock ring racing up every pipe), cannon shots
  function itemFx(view, now) {
    const R = race.R, tickNow = view.tick != null ? view.tick : R.tick;
    for (const w of R.waves) {
      let fx = race.waveFx.get(w);
      const reach = Math.max(0, (tickNow - w.tick0) * DT * (w.kind === 'burst' ? SIM0.WAVE_SPEED : SIM0.EMP_SPEED));
      const owner = race.rails.find((r) => r.b.i === w.i);
      if (!fx) {
        if (w.kind === 'burst') {
          const m = new T.Mesh(G.ico, new T.MeshBasicMaterial({ color: new T.Color(ITEM_LOOK.burst.color), wireframe: true, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
          const c = tubeAt(owner, w.s0, 0, 0); m.position.set(c.x, c.y, c.z); race.root.add(m); fx = { m };
        } else {
          fx = { rings: race.rails.map((r) => { const m = new T.Mesh(new T.TorusGeometry(TUBE_R * 0.98, 0.09, 6, 48), new T.MeshBasicMaterial({ color: new T.Color(ITEM_LOOK.emp.color).multiplyScalar(1.4), transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false })); setLayer(m, r.layer); r.grp.add(m); return { r, m }; }) };
        }
        race.waveFx.set(w, fx);
        if (w.kind === 'emp' || w.kind === 'burst') shake(0.4);
      }
      const age = (tickNow - w.tick0) * DT;
      if (fx.m) { fx.m.scale.setScalar(Math.max(0.1, reach)); fx.m.rotation.y = now; fx.m.material.opacity = Math.max(0, 0.6 - age * 0.12); fx.m.visible = age < 5; }
      if (fx.rings) for (const { r, m } of fx.rings) {
        const s = w.s0 + reach, f = railAt(r, s, 0, 0);
        m.position.set(f.x, f.y, f.z); m.lookAt(f.x + f.tx, f.y + f.ty, f.z + f.tz); m.visible = age < 4; m.material.opacity = Math.max(0, 0.9 - age * 0.2);
        if (m.layers.mask !== (1 << r.layer)) setLayer(m, r.layer);
      }
    }
    for (const sh of R.shots) {
      let fx = race.shotFx.get(sh);
      const owner = race.rails.find((r) => r.b.i === sh.i), g = sh.target >= 0 ? R.course.blocks.find((x) => x.id === sh.target) : null;
      const to = g ? g.s0 : sh.s0 + SIM0.SHOT_RANGE, u = clamp((tickNow - sh.tick0) / Math.max(1, sh.hitTick - sh.tick0), 0, 1);
      if (!fx) {
        const m = new T.Mesh(new T.SphereGeometry(0.16, 12, 8), new T.MeshBasicMaterial({ color: new T.Color(ITEM_LOOK.cannon.color).multiplyScalar(2), toneMapped: false }));
        const halo = new T.Sprite(new T.SpriteMaterial({ map: M.glowTex, color: ITEM_LOOK.cannon.color, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(1.4, 1.4, 1); m.add(halo);
        setLayer(m, owner.layer); owner.grp.add(m); fx = { m, done: false }; race.shotFx.set(sh, fx);
      }
      const f = tubeAt(owner, lerp(sh.s0 + 0.5, to, u), sh.seg, TUBE_R - SPHERE_R - 0.05);
      fx.m.position.set(f.x, f.y, f.z); fx.m.visible = u < 1;
      if (u >= 1 && !fx.done) { fx.done = true; if (g) { const p = tubeAt(owner, g.s0, sh.seg, TUBE_R - 0.4); burst(p, new T.Color(theme.hazard), owner === race.top, 1.2, owner); } }
    }
  }
  // Keep your ball the only ball near your lane: any rival ball that would be drawn on screen over the stretch of your
  // pipe floor around your ball (2½ positions either side, from just behind it to 70 u ahead) isn't drawn. It comes
  // back after it has been clear for a moment, so nothing flickers in and out at the edge.
  const PJ = { a: null, b: null };
  function screenOf(p, out) { out.set(p.x, p.y, p.z).project(camera); return { x: (out.x + 1) * 0.5 * innerWidth, y: (1 - out.y) * 0.5 * innerHeight, z: out.z }; }
  function guardLane(rl, sNow, x, followSp, now) {
    if (!PJ.a) { PJ.a = new T.Vector3(); PJ.b = new T.Vector3(); }
    camera.updateMatrixWorld();
    const quads = [];
    let prev = null;
    for (let d = -2; d <= 70; d += d < 10 ? 1 : 3) {
      const sr = sNow + d;
      const L = screenOf(tubeAt(rl, sr, x - 2.5, TUBE_R), PJ.a), Rr = screenOf(tubeAt(rl, sr, x + 2.5, TUBE_R), PJ.a);
      const Lt = screenOf(tubeAt(rl, sr, x - 2.5, TUBE_R - 1.1), PJ.a), Rt = screenOf(tubeAt(rl, sr, x + 2.5, TUBE_R - 1.1), PJ.a);
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
      const edge = screenOf(sp.g.position.clone().addScaledVector(camera.up, SPHERE_R * 1.3), PJ.a), rpx = Math.hypot(edge.x - c.x, edge.y - c.y) + 4;
      const hit = c.z > -1 && c.z < 1 && quads.some((q) => inQuad(c, q, rpx));
      if (hit) sp.clearAt = now + 0.35;
      const show = !(sp.clearAt > now);
      sp.g.visible = show; sp.trail.visible = show; if (sp.tag) sp.tag.visible = show && sp.tag.visible;
    }
  }
  const xAt = (H, s) => { for (const h of H) if (h[0] <= s) return h[1]; return H.length ? H[H.length - 1][1] : 0; };
  function writeTrail(sp, win, s, alive) {
    const pa = sp.trail.geometry.attributes.position, ca = sp.trail.geometry.attributes.color, H = sp.hist, N = 18, col = sp.rl.color, len = (win ? 5 : 3.2) * (sp.rl === race.top ? 0.4 : 1);
    for (let k = 0; k < N; k++) {
      const sk = s - (k / (N - 1)) * len, xx = xAt(H, sk), w = ((win ? 0.3 : 0.2) * (1 - k / N) * SEGS) / (2 * Math.PI * TUBE_R), a = Math.pow(1 - k / N, 1.5) * (alive ? 0.9 : 0);
      for (let e = 0; e < 2; e++) { const f = tubeAt(sp.rl, sk, xx + (e ? w : -w), TUBE_R - 0.06), o = (k * 2 + e) * 3; pa.array[o] = f.x; pa.array[o + 1] = f.y; pa.array[o + 2] = f.z; ca.array[o] = col.r * a; ca.array[o + 1] = col.g * a; ca.array[o + 2] = col.b * a; }
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
  }
  // elimination: shell fractures into bright shards and a colour-coded shock ring
  function burst(f, color, big, scale = 1, rl = null) {
    const into = rl ? rl.grp : race.root, layer = rl ? rl.layer : 0;
    const mat = new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), toneMapped: false, transparent: true });
    for (let k = 0; k < Math.round((big ? 34 : 22) * scale); k++) {
      const m = new T.Mesh(G.tetra, mat); m.position.set(f.x, f.y, f.z);
      const a = Math.random() * 6.283, sp = 3 + Math.random() * 7;
      m.userData.v = new T.Vector3(Math.cos(a) * sp * 0.6 + (f.tx || 0) * 3, Math.sin(a) * sp * 0.6, (f.tz || 0) * 3 + (Math.random() - 0.5) * sp); m.userData.spin = new T.Vector3(Math.random() * 9, Math.random() * 9, 0);
      m.layers.set(layer); into.add(m); race.shards.push({ m, life: 1.0 + Math.random() * 0.5, into });
    }
    const ring = new T.Mesh(G.wave, new T.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8), transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.position.set(f.x, f.y, f.z); ring.lookAt(f.x + (f.tx || 0), f.y + (f.ty || 0), f.z + (f.tz || 1)); ring.layers.set(layer); into.add(ring); race.rings.push({ m: ring, life: 0.8, into });
    if (big) cam.shake = 1.4;
  }
  function updateBursts(dt) {
    for (const p of race.shards) { p.life -= dt; p.m.position.addScaledVector(p.m.userData.v, dt); p.m.rotation.x += p.m.userData.spin.x * dt; p.m.rotation.y += p.m.userData.spin.y * dt; p.m.scale.setScalar(Math.max(0.01, p.life)); if (p.life <= 0) p.into.remove(p.m); }
    race.shards = race.shards.filter((p) => p.life > 0);
    for (const w of race.rings) { w.life -= dt; w.m.scale.setScalar(1 + (0.8 - w.life) * 4); w.m.material.opacity = Math.max(0, w.life); if (w.life <= 0) w.into.remove(w.m); }
    race.rings = race.rings.filter((w) => w.life > 0);
  }
  function render(dt) {
    W.frameMs = W.frameMs * 0.95 + dt * 1000 * 0.05;
    if (W.frameMs > 21 && W.pixelRatio > 0.6) { if (++W.slowFrames > 40) { W.pixelRatio = Math.max(0.6, W.pixelRatio - 0.15); W.slowFrames = 0; resize(); } }
    else if (W.frameMs < 14 && W.pixelRatio < Math.min(devicePixelRatio || 1, 1.6)) { if (++W.slowFrames > 240) { W.pixelRatio = Math.min(Math.min(devicePixelRatio || 1, 1.6), W.pixelRatio + 0.1); W.slowFrames = 0; resize(); } }
    else W.slowFrames = 0;
    composer.render(dt);
  }
  function shake(n) { cam.shake = Math.max(cam.shake, n); }
  return { init, setRace, clearRace, frame, get ready() { return ready; }, get race() { return race; }, shake };
})();
