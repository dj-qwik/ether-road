// ───────────────────────── PIPE GEOMETRY: six track shapes, every pipe exactly as long, never touching ─────────────────────────
// Visual only (the race is decided in track coordinates), but it must LOOK fair too.
//
// Layout: the racers' pipes ride round a shared curving spine, evenly spaced on a circle (2 side by side, 3 in a
// triangle, 4 in a square). The track's layout sections bundle them tight, fling them apart, corkscrew them round each
// other or swap sides. Because they always stay evenly spaced on that circle, and the circle never shrinks below the
// pipes' width plus a gap, two pipes can never pass through each other.
//
// Equal length: the road is cut into 96-unit stretches; any pipe shorter than the longest in a stretch gets a smooth
// outward bulge (away from the spine, so it only ever moves AWAY from the other pipes), sized by bisection until its
// length matches. Then every pipe is re-sampled by arc length inside each stretch, so equal track distance means equal
// pipe length, everywhere.
const RAILGEO = (() => {
  // the spine each track's pipes are braided around (x across, y up, z = −s forward)
  const SPINES = {
    nebula: (s, o) => { o.x = 22 * Math.sin(s / 95) + 7 * Math.sin(s / 41 + 1.3); o.y = 7 * Math.sin(s / 73) + 1.8 * Math.sin(s / 29); },
    helix: (s, o) => { o.x = 14 * Math.sin(s / 60); o.y = 4 * Math.sin(s / 50) + 2 * Math.sin(s / 21); },
    canyon: (s, o) => { const a = s / 60; o.x = 30 * (Math.sin(a) + 0.2 * Math.sin(3 * a)); o.y = 3 * Math.sin(s / 90); },
    cathedral: (s, o) => { o.x = 10 * Math.sin(s / 80); o.y = 18 * Math.sin(s / 110) + 6 * Math.sin(s / 37); },
    storm: (s, o) => { o.x = 30 * Math.sin(s / 120) + 10 * Math.sin(s / 33); o.y = 5 * Math.sin(s / 61); },
    ghost: (s, o) => { o.x = 16 * Math.sin(s / 52); o.y = 9 * Math.sin(s / 44 + 0.7); },
  };
  const sp = { x: 0, y: 0, z: 0 }, sq = { x: 0, y: 0, z: 0 };
  function spine(key, s, out) { (SPINES[key] || SPINES.nebula)(s, out); out.z = -s; return out; }
  function spineFrame(key, s) {
    spine(key, s - 0.5, sp); spine(key, s + 0.5, sq);
    let tx = sq.x - sp.x, ty = sq.y - sp.y, tz = sq.z - sp.z; const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
    let sx = -tz, sz = tx; const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    return { sx, sy: 0, sz, ux: -sz * ty, uy: sz * tx - sx * tz, uz: sx * ty };
  }
  const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const GAP = 1.1; // clear space between neighbouring pipes, world units
  const BULGE_SOFT = 3.5; // an equalizing wave taller than this is split into more, smaller waves
  const rhoMin = (n) => (n < 2 ? 0 : (TUBE_R + GAP / 2) / Math.sin(Math.PI / n) + 0.3);
  const theta0 = (n) => (n === 2 ? 0 : n === 3 ? Math.PI / 2 : Math.PI / 4); // side by side · triangle · square
  function sections(course, sAtT, n) {
    const rm = rhoMin(n);
    let th = theta0(n), rho = rm;
    return course.layout.map((L) => {
      const target = L.kind === 'launch' ? rm : L.kind === 'bundle' ? rm + 0.5 : L.kind === 'spread' ? rm + 5 + 4 * Math.abs(L.rise || 0) : L.kind === 'twist' ? rm + 1.2 : rm + 1.8;
      let dth = L.kind === 'twist' ? (L.spin || 1) * 2 * Math.PI : L.kind === 'swap' ? (L.spin || 1) * Math.PI : L.kind === 'spread' ? 0.35 * (L.spin || 1) : 0;
      const s0 = sAtT(L.t0), s1 = sAtT(L.t1), rr = Math.max(rho, target);
      // pipes may sweep round each other at most 0.28 u sideways per u forward (smoothstep peaks at 1.5× the average):
      // a section cut short can't corkscrew the pipes into one another
      const cap = (0.28 * Math.max(1, s1 - s0)) / (1.5 * rr);
      if (Math.abs(dth) > cap) dth = Math.sign(dth) * cap;
      const sec = { kind: L.kind, s0, s1, rho0: rho, rho1: target, th0: th, dth };
      th += dth; rho = target;
      return sec;
    });
  }
  /** offset of pipe j (of n) from the spine at distance s, in the spine frame: [across, up] */
  function pipeOffset(secs, j, n, s) {
    if (n < 2) return [0, 0];
    let k = secs.length - 1; while (k > 0 && secs[k].s0 > s) k--;
    const a = secs[k], u = clamp((s - a.s0) / Math.max(1, a.s1 - a.s0), 0, 1);
    const rho = lerp(a.rho0, a.rho1, smooth(Math.min(1, u / 0.35))), th = a.th0 + a.dth * smooth(u) + (2 * Math.PI * j) / n;
    return [rho * Math.cos(th), rho * Math.sin(th)];
  }
  const S0 = -30, RAW = 0.25, CH = 96, STEP = 0.25; // start 30 u behind the line; raw step; stretch length; drawn step (track units)
  // frames (side, up) for a polyline: side = T × worldUp, up = side × T
  function frames(pos, N) {
    const side = new Float32Array(N * 3), up = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const a = Math.max(0, k - 1), c = Math.min(N - 1, k + 1);
      let tx = pos[c * 3] - pos[a * 3], ty = pos[c * 3 + 1] - pos[a * 3 + 1], tz = pos[c * 3 + 2] - pos[a * 3 + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = -tz, sz = tx; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
      side[k * 3] = sx; side[k * 3 + 2] = sz;
      up[k * 3] = -sz * ty; up[k * 3 + 1] = sz * tx - sx * tz; up[k * 3 + 2] = sx * ty;
    }
    return { side, up };
  }
  /**
   * Build the pipes for a race. Returns [{ N, pos, side, up, len, bump, out }] sampled every STEP track units from s = −30:
   * centre line, frame, the pipe's length over each stretch (identical across pipes), and the biggest bulge added.
   */
  function build(course, n, sAtT, trackKey) {
    const key = SPINES[trackKey] ? trackKey : 'nebula', secs = sections(course, sAtT, n);
    const sEnd = course.end + 60, NR = Math.ceil((sEnd - S0) / RAW) + 1, PER = CH / RAW, chunks = Math.floor((NR - 1) / PER);
    // 1) raw centre lines round the spine, and each one's outward direction (away from the spine)
    const raw = [];
    for (let j = 0; j < n; j++) {
      const p = new Float64Array(NR * 3), out = new Float64Array(NR * 3), o = { x: 0, y: 0, z: 0 };
      for (let k = 0; k < NR; k++) {
        const s = S0 + k * RAW; spine(key, s, o); const f = spineFrame(key, s), [ox, oy] = pipeOffset(secs, j, n, s);
        p[k * 3] = o.x + f.sx * ox + f.ux * oy; p[k * 3 + 1] = o.y + f.sy * ox + f.uy * oy; p[k * 3 + 2] = o.z + f.sz * ox + f.uz * oy;
        const l = Math.hypot(ox, oy) || 1, cx = n < 2 ? 0 : ox / l, cy = n < 2 ? 1 : oy / l;
        out[k * 3] = f.sx * cx + f.ux * cy; out[k * 3 + 1] = f.sy * cx + f.uy * cy; out[k * 3 + 2] = f.sz * cx + f.uz * cy;
      }
      raw.push({ p, out, bump: 0 });
    }
    // 2) equalize every stretch with a smooth outward bulge on the shorter pipes
    const bulge = (A, humps, u) => A * (1 - Math.cos(2 * Math.PI * humps * u)) / 2;
    const segLen = (r, k0, k1, A, humps) => {
      let L = 0, px = 0, py = 0, pz = 0;
      for (let k = k0; k <= k1; k++) {
        const h = bulge(A, humps, (k - k0) / (k1 - k0));
        const x = r.p[k * 3] + r.out[k * 3] * h, y = r.p[k * 3 + 1] + r.out[k * 3 + 1] * h, z = r.p[k * 3 + 2] + r.out[k * 3 + 2] * h;
        if (k > k0) L += Math.hypot(x - px, y - py, z - pz);
        px = x; py = y; pz = z;
      }
      return L;
    };
    const plan = [];
    for (let c = 0; c < chunks; c++) {
      const k0 = c * PER, k1 = k0 + PER;
      const L = raw.map((r) => segLen(r, k0, k1, 0, 1)), target = Math.max(...L);
      plan.push(raw.map((r, j) => {
        if (target - L[j] < 1e-6) return { A: 0, humps: 1 };
        // the fewest, gentlest waves that make up the difference: one wide hill if a low one will do, otherwise more
        // and smaller waves (a long pipe on the inside of a sharp bend gets a wavy slide, never one giant loop)
        let best = null;
        for (let humps = 1; humps <= 12; humps++) {
          let lo = 0, hi = 14;
          if (segLen(r, k0, k1, hi, humps) < target) continue;
          for (let it = 0; it < 50 && hi - lo > 1e-7; it++) { const m = (lo + hi) / 2; if (segLen(r, k0, k1, m, humps) < target) lo = m; else hi = m; }
          if (!best || hi < best.A) best = { A: hi, humps };
          if (hi <= BULGE_SOFT) break;
        }
        best = best || { A: 14, humps: 12 };
        r.bump = Math.max(r.bump, best.A); return best;
      }));
    }
    // 3) apply bulges, then resample each stretch by arc length at STEP track units
    const SPC = CH / STEP, N = chunks * SPC + 1;
    return raw.map((r, j) => {
      const NRu = chunks * PER + 1, q = new Float64Array(NRu * 3);
      for (let c = 0; c < chunks; c++) for (let k = c * PER; k <= (c + 1) * PER; k++) {
        const { A, humps } = plan[c][j], h = bulge(A, humps, (k - c * PER) / PER);
        for (let d = 0; d < 3; d++) q[k * 3 + d] = r.p[k * 3 + d] + r.out[k * 3 + d] * h;
      }
      const pos = new Float32Array(N * 3), len = new Float64Array(chunks);
      for (let c = 0; c < chunks; c++) {
        const k0 = c * PER, acc = [0];
        for (let k = k0 + 1; k <= k0 + PER; k++) acc.push(acc[acc.length - 1] + Math.hypot(q[k * 3] - q[(k - 1) * 3], q[k * 3 + 1] - q[(k - 1) * 3 + 1], q[k * 3 + 2] - q[(k - 1) * 3 + 2]));
        const total = acc[acc.length - 1]; len[c] = total;
        let m = 0;
        for (let i = 0; i < SPC; i++) {
          const want = (i / SPC) * total;
          while (m < PER - 1 && acc[m + 1] < want) m++;
          const w = (want - acc[m]) / Math.max(1e-12, acc[m + 1] - acc[m]), a = (k0 + m) * 3, b = a + 3, o = (c * SPC + i) * 3;
          pos[o] = q[a] + (q[b] - q[a]) * w; pos[o + 1] = q[a + 1] + (q[b + 1] - q[a + 1]) * w; pos[o + 2] = q[a + 2] + (q[b + 2] - q[a + 2]) * w;
        }
      }
      const e = (N - 1) * 3, last = (NRu - 1) * 3; pos[e] = q[last]; pos[e + 1] = q[last + 1]; pos[e + 2] = q[last + 2];
      const fr = frames(pos, N);
      return { N, pos, side: fr.side, up: fr.up, len, bump: r.bump };
    });
  }
  return { build, spine, spineFrame, S0, CH, STEP, rhoMin, GAP };
})();
