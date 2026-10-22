// ───────────────────────── RAIL GEOMETRY: six track shapes, every rail exactly as long ─────────────────────────
// Visual only (the race is decided in track coordinates), but it must LOOK fair too: every racer's rail has its
// own curves, yet every rail covers exactly the same length of road between the same two moments. So a sphere
// never appears to travel further or faster than anyone else's.
//
// How: each rail is first laid out along the track's spine with its own lateral/vertical offset pattern
// (braids, crossings, helixes, merges). The road is cut into 96-unit stretches (about 3–4 s of racing); any rail
// shorter than the longest in a stretch gets a long, gentle rolling hill plus a sideways S-bend, sized by
// bisection until its length matches. Then every rail is re-sampled by arc length inside each stretch, so every
// rail is exactly as long as the others over every stretch, and over the whole race.
const RAILGEO = (() => {
  // the spine each track's rails are braided around (x across, y up, z = −s forward)
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
  function sectionOffset(sec, j, n, s, sign) {
    const c = (n - 1) / 2, d = (j - c) * sign, u = Math.max(0, Math.min(1, (s - sec.s0) / Math.max(1, sec.s1 - sec.s0)));
    switch (sec.kind) {
      case 'launch': return [d * 3.0, 0];
      case 'parallel': return [d * 3.3, Math.sin(s / 17 + j) * 0.25];
      case 'solo': return [d * (sec.spread || 13) + 4 * Math.sin(s / 31 + j * 1.7), ((j % 2) ? 1 : -1) * 2.6 * (sec.rise || 0) + 1.2 * Math.sin(s / 23 + j)];
      case 'cross': return [d * 3.4 * Math.cos(Math.PI * u), d * 1.6 * Math.sin(Math.PI * u)];
      case 'helix': { const a = (2 * Math.PI * j) / n + (sec.spin || 1) * u * 2 * Math.PI - Math.PI / 2; const R = 3.6 * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.08)) + 0.0001; const lin = d * 3.2 * (1 - Math.sin(Math.PI * u)); return [Math.cos(a) * R + lin, Math.sin(a) * R]; }
      case 'merge': return [d * 2.85, 0];
      default: return [d * 3, 0];
    }
  }
  function sections(course, sAtT, spread) {
    let sign = 1;
    return course.layout.map((L) => { const sec = { ...L, s0: sAtT(L.t0), s1: sAtT(L.t1), sign, spread }; if (L.kind === 'cross') sign = -sign; return sec; });
  }
  function railOffset(secs, j, n, s) {
    let k = secs.length - 1; while (k > 0 && secs[k].s0 > s) k--;
    const a = secs[k], o = sectionOffset(a, j, n, s, a.sign), B = 22, nb = secs[k + 1], pb = secs[k - 1];
    if (nb && s > nb.s0 - B) { const w = smooth((s - (nb.s0 - B)) / (2 * B)), o2 = sectionOffset(nb, j, n, s, nb.sign); return [o[0] + (o2[0] - o[0]) * w, o[1] + (o2[1] - o[1]) * w]; }
    if (pb && s < a.s0 + B) { const w = smooth((s - (a.s0 - B)) / (2 * B)), o0 = sectionOffset(pb, j, n, s, pb.sign); return [o0[0] + (o[0] - o0[0]) * w, o0[1] + (o[1] - o0[1]) * w]; }
    return o;
  }
  const S0 = -30, RAW = 0.25, CH = 96, STEP = 0.25; // start 30 u behind the line; raw step; chunk length; drawn step (track units)
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
   * Build the rails for a race. Returns [{ N, pos, side, up, len, bump }] sampled every STEP track units from s = −30,
   * where len[c] is that rail's length over chunk c (identical across rails) and bump the tallest hill added.
   */
  function build(course, n, sAtT, trackKey) {
    const key = SPINES[trackKey] ? trackKey : 'nebula', secs = sections(course, sAtT, { canyon: 5, storm: 10 }[key] || 9);
    const sEnd = course.end + 60, NR = Math.ceil((sEnd - S0) / RAW) + 1, PER = CH / RAW, chunks = Math.floor((NR - 1) / PER);
    // 1) raw rails along the spine with their offsets
    const raw = [];
    for (let j = 0; j < n; j++) {
      const p = new Float64Array(NR * 3), o = { x: 0, y: 0, z: 0 };
      for (let k = 0; k < NR; k++) {
        const s = S0 + k * RAW; spine(key, s, o); const f = spineFrame(key, s), [ox, oy] = railOffset(secs, j, n, s);
        p[k * 3] = o.x + f.sx * ox + f.ux * oy; p[k * 3 + 1] = o.y + f.sy * ox + f.uy * oy; p[k * 3 + 2] = o.z + f.sz * ox + f.uz * oy;
      }
      raw.push({ p, fr: frames(p, NR), bump: 0 });
    }
    // 2) equalize every chunk with a smooth rise (and, for bigger gaps, a gentle S-weave) on the shorter rails.
    //    hill(A): height A·0.6 along the rail's up, sideways weave A that returns to zero at both chunk ends
    const hill = (A, humps, u) => [A * 0.7 * (1 - Math.cos(2 * Math.PI * humps * u)) / 2, A * 0.7 * Math.sin(2 * Math.PI * humps * u)];
    const segLen = (p, k0, k1, fr, A, humps) => {
      let L = 0, px = 0, py = 0, pz = 0;
      for (let k = k0; k <= k1; k++) {
        const u = (k - k0) / (k1 - k0), [h, w] = hill(A, humps, u);
        const x = p[k * 3] + fr.up[k * 3] * h + fr.side[k * 3] * w, y = p[k * 3 + 1] + fr.up[k * 3 + 1] * h, z = p[k * 3 + 2] + fr.up[k * 3 + 2] * h + fr.side[k * 3 + 2] * w;
        if (k > k0) L += Math.hypot(x - px, y - py, z - pz);
        px = x; py = y; pz = z;
      }
      return L;
    };
    const plan = []; // per chunk: target length, and per rail { A, humps }
    for (let c = 0; c < chunks; c++) {
      const k0 = c * PER, k1 = k0 + PER;
      const L = raw.map((r) => segLen(r.p, k0, k1, r.fr, 0, 1)), target = Math.max(...L);
      const per = raw.map((r, j) => {
        if (target - L[j] < 1e-6) return { A: 0, humps: 1 };
        for (const humps of [1, 2, 3]) {
          let lo = 0, hi = 36;
          if (segLen(r.p, k0, k1, r.fr, hi, humps) < target) continue;
          for (let it = 0; it < 50 && hi - lo > 1e-7; it++) { const m = (lo + hi) / 2; if (segLen(r.p, k0, k1, r.fr, m, humps) < target) lo = m; else hi = m; }
          r.bump = Math.max(r.bump, hi); return { A: hi, humps };
        }
        return { A: 36, humps: 3 };
      });
      plan.push({ target, per });
    }
    // 3) apply hills, then resample each chunk by arc length at 1-unit track steps
    const SPC = CH / STEP, N = chunks * SPC + 1; // drawn samples per chunk
    return raw.map((r, j) => {
      const NRu = chunks * PER + 1, q = new Float64Array(NRu * 3);
      for (let c = 0; c < chunks; c++) for (let k = c * PER; k <= (c + 1) * PER; k++) {
        const { A, humps } = plan[c].per[j], u = (k - c * PER) / PER, [h, w] = hill(A, humps, u);
        for (let d = 0; d < 3; d++) q[k * 3 + d] = r.p[k * 3 + d] + r.fr.up[k * 3 + d] * h + r.fr.side[k * 3 + d] * w;
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
  return { build, spine, spineFrame, S0, CH, STEP };
})();
