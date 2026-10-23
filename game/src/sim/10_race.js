// ───────────────────────── THE RACE: course generation + the one step function server and browsers run ─────────────────────────
// Everything that decides a result lives here and is deterministic. Each racer rides the inside of a pipe split into
// SEGS positions around its wall; collisions are tested in track coordinates (distance along the pipe × position),
// never against meshes. The 3D world is drawn from this data.

// ───── the base timeline: how far a racer at base speed has travelled at every tick ─────
const S_TICKS = RACE_TICKS + 1800;
const S_TABLE = (() => { const a = new Float64Array(S_TICKS + 1); for (let k = 1; k <= S_TICKS; k++) a[k] = a[k - 1] + speedAt((k - 1) * DT) * DT; return a; })();
const sAtTick = (k) => S_TABLE[Math.max(0, Math.min(S_TICKS, k))];
function sAtT(t) { const x = t / DT, k = Math.floor(x); return k >= S_TICKS ? S_TABLE[S_TICKS] : k < 0 ? 0 : S_TABLE[k] + (S_TABLE[k + 1] - S_TABLE[k]) * (x - k); }
function tickAtS(x) { let lo = 0, hi = S_TICKS; while (lo < hi) { const m = (lo + hi) >> 1; if (S_TABLE[m] >= x) hi = m; else lo = m + 1; } return lo; }
function tOfS(x) { const k = tickAtS(x); if (k <= 0) return 0; const a = S_TABLE[k - 1], b = S_TABLE[k]; return (k - 1 + (b > a ? (x - a) / (b - a) : 0)) * DT; }
const TL0 = { sAtTick, sAtT, tickAtS, tOfS, speedAtT: speedAt };

// ───── speed strips (optional pads on one position) ─────
//   boost — ×1.4 for 2.2 s: more distance, less time to react · slow — ×0.65 for 2.2 s: more time, less distance
const STRIP = { boost: { mul: 1.4 }, slow: { mul: 0.65 }, hold: 2.2, rampIn: 0.25, rampOut: 0.4, len: 5 };
function fxMul(kind, d) { // d = seconds since the strip was hit
  if (!kind || d < 0 || d > STRIP.rampIn + STRIP.hold + STRIP.rampOut) return 1;
  const k = d < STRIP.rampIn ? d / STRIP.rampIn : d < STRIP.rampIn + STRIP.hold ? 1 : 1 - (d - STRIP.rampIn - STRIP.hold) / STRIP.rampOut;
  return 1 + (STRIP[kind].mul - 1) * k;
}

// ───── pickups ─────
// Instant (work the moment you roll over them):
//   shield — blocks the next hit of anything: spikes, a burst or an EMP (one hit, then gone)
//   magnet — for 4 s, orbs up to 3 positions either side are yours · double — for 6 s, orbs count twice
// Held (one at a time; press Use to fire; rolling over another held pickup swaps it in):
//   cannon — 2 shots: each destroys the next group of spikes in your position (for you only)
//   burst  — an energy shell spreads from you in every direction; every ball it reaches is slowed to 60% for 2 s
//   emp    — a shockwave runs ahead up every pipe; each ball ahead of you it reaches is lifted off the track for
//            1.5 s: it can't steer, slows to 50%, can't be hit, and always comes down on a free position
//   ether  — ether boost: a bit above top speed and invincible for 3 s (spikes, bursts and EMPs pass through you)
const POWERS = {
  shield: {}, magnet: { ticks: 240 }, double: { ticks: 360 },
  cannon: { held: 1, ammo: 2 }, burst: { held: 1 }, emp: { held: 1 }, ether: { held: 1, ticks: 180, speed: 40 },
};
const ITEM_CODE = { cannon: 1, burst: 2, emp: 3, ether: 4 };
const SLOW_FX = { mul: 0.6, ticks: 120 }, EMP_FX = { mul: 0.5, ticks: 90 };
const WAVE_SPEED = 130, EMP_SPEED = 140, SHOT_SPEED = 170, SHOT_RANGE = 80, USE_GAP = 8;
// Speed strips: two boost and two slow per course, at times nudged ±1.5 s at random.
const STRIP_PLAN = [[12, 'boost'], [18.5, 'slow'], [28.5, 'boost'], [38, 'slow']];
// Pickups come in CACHES: 2–3 different items side by side round the pipe, off the safe line. Roll over the one you
// want and the rest of that cache is gone for you, so racers end up carrying different things by choice. Which items,
// how many caches and when they come up are drawn at random from the course seed; every racer meets the same caches
// at the same spots, so nobody is dealt a better hand.
const CACHE_POOL = [['cannon', 3], ['burst', 2], ['emp', 2], ['ether', 2], ['shield', 2], ['magnet', 1.5], ['double', 1.5]];
const CACHE_FIRST = [6.5, 9], CACHE_GAP = [5, 8], CACHE_LAST = 46, CACHE_SPACING = 2; // seconds; positions between items
function cachePlan(r) {
  const out = [];
  for (let t = lerp(CACHE_FIRST[0], CACHE_FIRST[1], r()); t < CACHE_LAST; t += lerp(CACHE_GAP[0], CACHE_GAP[1], r())) {
    const n = r() < 0.45 ? 3 : 2, items = [], pool = CACHE_POOL.slice();
    while (items.length < n) {
      let x = r() * pool.reduce((a, [, w]) => a + w, 0), k = 0;
      for (; k < pool.length - 1; k++) if ((x -= pool[k][1]) <= 0) break;
      items.push(pool[k][0]); pool.splice(k, 1);
    }
    out.push([t, 'cache', items]);
  }
  return out;
}

// ───── course difficulty (seconds) ─────
const GAPT = [[2.6, 1.25], [12, 0.88], [25, 0.66], [38, 0.52], [48, 0.41], [53, 0.32], [57, 0.27], [60, 0.23]]; // time between spike patterns
const WIDTH = [[2.6, 8], [10, 6], [20, 4.4], [32, 3.3], [42, 2.8], [48, 2.3], [51, 1.6], [54, 1], [60, 1]];     // opening width (positions)
const COLLAPSE_AT = 48; // "FINAL COLLAPSE": the pipe tightens until someone breaks
const REACT = 0.1, STEP_SEC = STEP_TICKS * DT; // openings ahead are visible well in advance: planning absorbs most of the reaction time
const maxShift = (dt, tt = 0) => clamp(Math.floor((dt * (tt >= COLLAPSE_AT ? 0.97 : 0.88) - (tt >= COLLAPSE_AT ? 0.05 : REACT)) / STEP_SEC), 0, SEGS / 2);
const FULL = (1 << SEGS) - 1;
function gapMask(c, w) { let m = FULL; for (let k = 0; k < w; k++) m &= ~(1 << segWrap(c - ((w - 1) >> 1) + k)); return m; }
const KIND = { spike: { len: 0.8 } };
// ───── electrified plates ─────
// A wide arc of the pipe wall that pulses with the music: live for 2 beats, dead for 2 (144 BPM, so 0.83 s each),
// flickering for 0.3 s before it goes live. Touch it while it's live and you're out, exactly like spikes. It runs on
// the race clock, so every racer at the game's speed meets it in the same state. Two kinds, 50/50:
//   bluff — the plate lies across the safe line but is dead the whole time you pass (if you're on the game's pace):
//           roll straight over it, or dodge round it if you don't trust it
//   live  — the plate covers where you are and is live the whole time you pass: get off it
// Racers off the game's pace (a strip, a burst or EMP hit, ether boost) meet it in a different state: read the pulse.
const ZAP = { period: 4 * BEAT, on: 0.5, warn: 0.3, len: [3.5, 6.5], width: [6, 10] };
const zapPhase = (g, tick) => { const P = ZAP.period, x = (tick * DT - g.ph) % P; return x < 0 ? x + P : x; };
/** is plate g live on this tick? (spike groups are always "live") */
function zapOn(g, tick) { return g.ph == null || zapPhase(g, tick) < ZAP.period * ZAP.on; }

/**
 * Build a course from a seed string. Pure function of the seed: the server and every browser build the same one.
 * Returns { blocks: spike groups sorted by s0 ({ id, pat, kind, s0, s1, mask }), orbs, strips, path, layout, end }.
 * Every racer gets this exact course in their own pipe.
 */
function buildCourse(seed, trackKey) {
  const track = TRACKS[trackKey] || TRACKS.nebula;
  const rng = makeRng('course:' + track.key + ':' + seed), r = () => rng();
  const plan = STRIP_PLAN.map(([at, kind]) => [at + (r() - 0.5) * 3, kind]).concat(cachePlan(r)).sort((a, b) => a[0] - b[0]);
  let caches = 0;
  const blocks = [], orbs = [], strips = [], path = [];
  let id = 0, pat = 0, c = 0, t = 1.2, lastDir = r() < 0.5 ? 1 : -1;
  const mix = Object.entries(track.mix);
  const pickKind = (tt) => {
    const w = mix.map(([k, v]) => [k, tt < 6 ? (k === 'ring' ? 1 : 0) : tt < 12 && k === 'spiral' ? 0 : tt < 16 && k === 'cluster' ? 0 : (tt < 8 || tt >= COLLAPSE_AT) && k === 'zap' ? 0 : tt >= COLLAPSE_AT && k === 'cluster' ? v * 0.4 : v]);
    let x = r() * w.reduce((a, [, v]) => a + v, 0); for (const [k, v] of w) { if ((x -= v) <= 0) return k; } return 'ring';
  };
  const group = (kind, s0, s1, mask) => { const g = { id: id++, pat, kind, s0, s1, mask }; blocks.push(g); return g; };
  const shiftTo = (from, m) => { if (m <= 0) return from; let mag = Math.max(1, Math.round(m * (t >= COLLAPSE_AT ? 0.75 + 0.25 * r() : 0.4 + 0.6 * r()))); const dir = r() < 0.72 ? -lastDir : lastDir; lastDir = dir; return segWrap(from + dir * mag); };
  while (t < RACE_SECONDS + 5) {
    let gap = pwl(GAPT, t) * (0.92 + 0.22 * r());
    let kind = pickKind(t);
    const w = clamp(Math.round(pwl(WIDTH, t) + (r() - 0.5) * (t < COLLAPSE_AT ? 1.2 : 0.6)), t < COLLAPSE_AT ? 2 : 1, 8);
    // a pickup or strip is due: put it off the safe line in the open stretch, and leave time to get there and back
    const dueE = plan.length && t >= plan[0][0] && t > 4 ? plan.shift() : null, due = dueE && dueE[1];
    let nextC = shiftTo(c, maxShift(gap, t));
    if (kind === 'zap' && (due || t + gap * 1.6 >= COLLAPSE_AT)) kind = 'ring'; // plates stay out of pickup stretches and the final collapse
    let zap = null;
    if (kind === 'zap') {
      // plate width and length; live plates sit on where you are and push you off to a spot you can reach in time
      const wz = clamp(Math.round(lerp(ZAP.width[0], ZAP.width[1], r())), ZAP.width[0], ZAP.width[1]), L = lerp(ZAP.len[0], ZAP.len[1], r()), live = r() < 0.5;
      if (live) {
        const dir = r() < 0.5 ? -1 : 1, dist = ((wz - 1) >> 1) + 1 + (wz % 2 ? 0 : dir > 0 ? 1 : 0) + Math.floor(r() * 2);
        nextC = segWrap(c + dir * dist);
        gap = Math.max(gap, (dist * STEP_SEC + REACT) / 0.85 + 0.08);
      }
      zap = { wz, L, live, at: live ? c : nextC };
    }
    if (due === 'cache') {
      // the cache's items in a row round the pipe, 2 positions apart, centred 4–5 positions off the safe line
      const items = dueE[2], n = items.length, dir = r() < 0.5 ? -1 : 1, mid = segWrap(c + dir * (4 + Math.floor(r() * 2)));
      const segs = items.map((_, k) => segWrap(mid + Math.round((k - (n - 1) / 2) * CACHE_SPACING)));
      const far = Math.max(...segs.map((p) => Math.abs(segDist(c, p))));
      const d1 = (far * STEP_SEC + REACT) / 0.85 + 0.12;
      nextC = segWrap(mid + (r() < 0.5 ? -1 : 1) * Math.floor(r() * 3));
      const back = Math.max(...segs.map((p) => Math.abs(segDist(p, nextC))));
      const d2 = (back * STEP_SEC + REACT) / 0.85 + 0.12, sp = sAtT(t + d1), cache = caches++;
      items.forEach((power, k) => orbs.push({ id: orbs.length, seg: segs[k], s: sp, power, cache }));
      gap = Math.max(gap, d1 + d2);
    } else if (due) {
      const off = (r() < 0.5 ? -1 : 1) * (3 + Math.floor(r() * 3)), p = segWrap(c + off);
      const len = STRIP[due] ? STRIP.len : 0, v = speedAt(t);
      const d1 = (Math.abs(off) * STEP_SEC + REACT) / 0.85 + 0.12;
      nextC = segWrap(p + (r() < 0.5 ? -1 : 1) * Math.floor(r() * 3));
      const d2 = (Math.abs(segDist(p, nextC)) * STEP_SEC + REACT) / 0.85 + 0.12;
      const tp = t + d1, sp = sAtT(tp);
      if (STRIP[due]) strips.push({ id: strips.length, kind: due, seg: p, s0: sp, s1: sp + len });
      else orbs.push({ id: orbs.length, seg: p, s: sp, power: due });
      gap = Math.max(gap, d1 + len / v + d2);
    } else if (t > 4 && r() < 0.4) {
      // a gold orb a little off the line, only if there's time to fetch it and still make the next opening
      const off = (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 3)), p = segWrap(c + off);
      const d1 = (Math.abs(off) * STEP_SEC + REACT) / 0.85 + 0.05, d2 = (Math.abs(segDist(p, nextC)) * STEP_SEC + REACT) / 0.85 + 0.05;
      if (d1 + d2 <= gap) orbs.push({ id: orbs.length, seg: p, s: sAtT(t + d1), power: null });
    }
    const tm = t + gap, s0 = sAtT(tm), v = speedAt(tm);
    pat++;
    if (zap) {
      const s1 = s0 + zap.L, ta = tOfS(s0 - SPHERE_R), te = tOfS(s1 + SPHERE_R), mid = (ta + te) / 2;
      const g = group('zap', s0, s1, FULL ^ gapMask(zap.at, zap.wz));
      // centre the live window (live) or the dead window (bluff) on the moment a racer on the game's pace is on it
      g.ph = mid - (zap.live ? 0.25 : 0.75) * ZAP.period; g.live = zap.live ? 1 : 0;
      path.push({ s: s0, seg: nextC });
      c = nextC; t = tm + zap.L / v;
    } else if (kind === 'spiral') {
      // a long sleeve of spikes with a twisting channel to follow
      const late = clamp((t - 20) / 30, 0, 1), tau = (0.9 + r() * 0.9) * (1 - 0.4 * late), L = v * tau, n = Math.max(3, Math.round(L / 1.0)), len = L / n;
      const turns = (r() < 0.5 ? -1 : 1) * Math.max(2, Math.round(tau * (3 + 2.5 * late + r() * 3.5)));
      const ww = clamp(w + 1, 3, 8); // a twisting channel narrower than 3 can't be followed: difficulty comes from the twist rate
      for (let k = 0; k < n; k++) {
        const ck = segWrap(nextC + Math.round(turns * k / (n - 1)));
        group('spiral', s0 + k * len, s0 + (k + 1) * len, gapMask(ck, ww));
        path.push({ s: s0 + k * len, seg: ck });
      }
      c = segWrap(nextC + turns); t = tm + tau;
    } else if (kind === 'twin') {
      // two openings on opposite sides: pick one
      const ww = Math.max(2, w - 1), other = segWrap(nextC + SEGS / 2 + Math.floor(r() * 3) - 1);
      group('ring', s0, s0 + KIND.spike.len, gapMask(nextC, ww) & gapMask(other, ww));
      path.push({ s: s0, seg: nextC });
      c = nextC; t = tm + KIND.spike.len / v;
    } else if (kind === 'cluster') {
      // rows of short spike clusters scattered round the pipe: weave through
      const rows = 2 + Math.floor(r() * 2), dt = 0.34;
      for (let k = 0; k < rows; k++) {
        const sr = sAtT(tm + k * dt);
        let mask = 0;
        const n = 3 + Math.floor(r() * 3);
        for (let q = 0; q < n; q++) {
          const at = Math.floor(r() * SEGS), size = 2 + Math.floor(r() * 2);
          for (let z = 0; z < size; z++) { const sg = segWrap(at + z); if (Math.abs(segDist(nextC, sg)) > 1) mask |= 1 << sg; }
        }
        if (mask) group('cluster', sr, sr + KIND.spike.len, mask);
        path.push({ s: sr, seg: nextC });
      }
      c = nextC; t = tm + (rows - 1) * dt + KIND.spike.len / v;
    } else {
      group('ring', s0, s0 + KIND.spike.len, gapMask(nextC, w));
      path.push({ s: s0, seg: nextC });
      c = nextC; t = tm + KIND.spike.len / v;
    }
  }
  blocks.sort((a, b) => a.s0 - b.s0 || a.id - b.id);
  orbs.sort((a, b) => a.s - b.s); orbs.forEach((o, k) => { o.id = k; });
  // visual layout of the pipes round the shared spine (drawn by the client; never affects play)
  const layout = [{ kind: 'launch', t0: 0, t1: 3.2 }];
  let lt = 3.2, ci = Math.floor(r() * track.layout.length);
  while (lt < COLLAPSE_AT) {
    const k = track.layout[ci++ % track.layout.length];
    const len = k === 'swap' ? 3.4 : k === 'twist' ? 5 + r() * 2 : k === 'spread' ? 6 + r() * 4 : 4 + r() * 3;
    const t1 = Math.min(COLLAPSE_AT, lt + len);
    layout.push({ kind: k, t0: lt, t1, spin: r() < 0.5 ? -1 : 1, rise: r() * 2 - 1 });
    lt = t1;
  }
  layout.push({ kind: 'bundle', t0: COLLAPSE_AT, t1: RACE_SECONDS + 40, finale: true });
  return { seed, track: track.key, blocks, orbs, strips, path, tl: TL0, startSeg: 0, layout, end: sAtT(RACE_SECONDS + 10) };
}

// ───── moving round the pipe: identical for humans and bots ─────
function qSum(b) { let s = 0; for (const d of b.q) s += d; return s; }
function pushStep(b, dir) { if (b.q.length < QUEUE_MAX) { b.q.push(dir); b.taps++; } }
function stepCtl(b) {
  if (b.stepT === 0 && b.q.length) { const d = b.q.shift(); b.from = b.seg; b.seg = segWrap(b.seg + d); b.stepT = STEP_TICKS; b.dir = d; }
  if (b.stepT > 0) { b.stepT--; b.cl = STEP_TICKS - b.stepT >= STEP_MID ? b.seg : b.from; }
}
/** Index of the first spike group that could still touch a racer at distance s (groups are sorted by start). */
function firstBlock(H, s) { let lo = 0, hi = H.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H[m].s0 < s - 30) lo = m + 1; else hi = m; } return lo; }
/** Is position `seg` covered by spikes (that this racer hasn't destroyed) anywhere in [sA, sB]? With `tick` (now),
 *  a plate only counts if it is live while this racer, at its current speed, would be on it; without, plates count
 *  as always live. */
function blockedAt(course, b, seg, sA, sB, tick) {
  const H = course.blocks;
  for (let j = firstBlock(H, sA); j < H.length; j++) {
    const g = H[j]; if (g.s0 - SPHERE_R > sB) break;
    if (g.s1 + SPHERE_R < sA || !((g.mask >> seg) & 1) || (b.gone && b.gone.has(g.id))) continue;
    if (g.ph != null && tick != null && !zapLiveDuring(g, b, tick)) continue;
    return true;
  }
  return false;
}
/** would plate g be live at any moment racer b (holding its current speed) is on it? (2 ticks of margin each side) */
function zapLiveDuring(g, b, tick) {
  const per = Math.max(5, b.v || 20) * DT, k0 = Math.floor(tick + (g.s0 - SPHERE_R - b.s) / per) - 2, k1 = Math.ceil(tick + (g.s1 + SPHERE_R - b.s) / per) + 2;
  for (let k = Math.max(tick, k0); k <= k1; k++) if (zapOn(g, k)) return true;
  return false;
}
/** Nearest position with no spikes in group g's mask (prefer `pref` direction on a tie). */
function nearestFree(mask, from, pref = 1) {
  if (!((mask >> from) & 1)) return from;
  for (let d = 1; d <= SEGS / 2; d++) {
    const a = segWrap(from + d * pref), b = segWrap(from - d * pref);
    if (!((mask >> a) & 1)) return a;
    if (!((mask >> b) & 1)) return b;
  }
  return from;
}
/** This racer's forward speed this tick: base × strip × slowed by a burst × lifted by an EMP; ether boost floors it. */
function racerSpeed(b, tick) {
  const t = (tick - 1) * DT;
  let v = speedAt(t) * fxMul(b.fxKind, (tick - 1 - b.fxTick) * DT);
  if (tick <= b.slowUntil) v *= SLOW_FX.mul;
  if (tick <= b.empUntil) v *= EMP_FX.mul;
  if (tick <= b.etherUntil) v = Math.max(v, POWERS.ether.speed);
  return v;
}
/** One racer's own tick (steering, moving, strips, landing from an EMP). Shared with the browser's prediction. */
function moveSphere(b, course, tick) {
  if (tick <= b.empUntil) { b.q.length = 0; }
  else stepCtl(b);
  if (tick === b.empUntil + 1) { // coming down from an EMP: always onto a free position
    const free = !blockedAt(course, b, b.seg, b.s - 0.4, b.s + 2.5);
    if (!free) { let best = b.seg; for (let d = 1; d <= SEGS / 2; d++) { if (!blockedAt(course, b, segWrap(b.seg + d), b.s - 0.4, b.s + 2.5)) { best = segWrap(b.seg + d); break; } if (!blockedAt(course, b, segWrap(b.seg - d), b.s - 0.4, b.s + 2.5)) { best = segWrap(b.seg - d); break; } } b.seg = b.from = b.cl = best; }
    b.stepT = 0; b.cl = b.seg;
  }
  b.v = racerSpeed(b, tick);
  b.s += b.v * DT;
  if (tick <= b.empUntil) return;
  const S = course.strips;
  for (let j = 0; j < S.length; j++) {
    const st = S[j];
    if (b.s < st.s0 - SPHERE_R || b.s > st.s1 + SPHERE_R || b.cl !== st.seg || b.strips.includes(st.id)) continue;
    b.strips.push(st.id); b.fxKind = st.kind; b.fxTick = tick;
  }
}
/** Does racer b hit spikes this tick? (not counting shield / invincibility) */
function spikeHit(course, b, tick) {
  const H = course.blocks, s = b.s;
  for (let j = firstBlock(H, s); j < H.length; j++) {
    const g = H[j];
    if (g.s0 - SPHERE_R >= s) break;
    if (g.s1 + SPHERE_R <= s || !((g.mask >> b.cl) & 1) || b.gone.has(g.id)) continue;
    if (g.ph != null && !zapOn(g, tick)) continue;
    return g;
  }
  return null;
}

/**
 * cfg: { key (track), seed, players: [{ i, name, human?, skill?, skin?, ai? }], active: [i, …], botSalt?, debug? }
 *  debug (practice only; the server never sets it): { god: [seat…] never crash, give: item every racer starts with }
 * rng (anti-peeking): server { record: [] } logs every draw; browsers { feed } replay them. Only a few draws, all at the start.
 */
function createRound(cfg, rng = {}) {
  const src = makeRng(cfg.seed ?? 0);
  if (rng.feed) RNG = () => rng.feed() / 4294967296;
  else if (rng.record) { const log = rng.record; RNG = () => { const v = src(); log.push(v * 4294967296); return v; }; }
  else RNG = src;
  const draw = () => Math.floor(RNG() * 4294967296) >>> 0;
  const trackKey = TRACKS[cfg.key] ? cfg.key : 'nebula', dbg = cfg.debug || {};
  const ca = draw(), cb = draw();
  // a course the flawless driver can't finish is impossible: rebuild (deterministically) until it can
  let course = null;
  for (let k = 0; k < 16 && !course; k++) { const c = buildCourse(ca + ':' + cb + ':' + k, trackKey); if (pilotSurvives(c)) course = c; }
  if (!course) course = buildCourse(ca + ':' + cb + ':safe', trackKey);
  const god = new Set(dbg.god || []);
  const tieOrder = shuffleWith(RNG, cfg.active); // last-resort tie-break, fixed before the start
  const botRng = makeRng('bots:' + (cfg.seed ?? 0) + ':' + (cfg.botSalt ?? ''));
  const spheres = cfg.players.map((p) => ({
    i: p.i, name: p.name || ROSTER[p.i][0], color: ROSTER[p.i][1], glyph: ROSTER[p.i][2], human: !!p.human, skill: p.skill ?? 0.85, skin: p.skin | 0,
    mirror: 0, seg: course.startSeg, from: course.startSeg, cl: course.startSeg, stepT: 0, dir: 0, q: [], taps: 0, alive: true, orbs: 0, got: [],
    shield: 0, immuneUntil: 0, magnetT: 0, doubleT: 0, shieldUsedTick: 0, s: 0, v: 0, fxKind: null, fxTick: -999, strips: [],
    item: dbg.give && POWERS[dbg.give] && POWERS[dbg.give].held ? dbg.give : null, ammo: dbg.give === 'cannon' ? 2 : 0, lastUse: -99,
    slowUntil: 0, empUntil: 0, empStart: -999, etherUntil: 0, gone: new Set(),
    deathTick: 0, killer: -1, place: 0, ai: p.ai || null, seen: null, actAt: 0, extra: 0, overPending: false, want: {}, heldSince: 0,
    active: cfg.active.includes(p.i),
  }));
  const byI = new Map(spheres.map((b) => [b.i, b]));
  const active = cfg.active.map((i) => byI.get(i));
  let tick = 0, t = 0, s = 0, winner = null;
  const H = course.blocks, O = course.orbs;
  const finishOrder = [], waves = [], shots = [], events = [];
  function decide(cands, why) {
    let best = null;
    const better = (a, c) => a.s !== c.s ? a.s > c.s : a.orbs !== c.orbs ? a.orbs > c.orbs : a.taps !== c.taps ? a.taps < c.taps : tieOrder.indexOf(a.i) < tieOrder.indexOf(c.i);
    for (const b of cands) if (!best || better(b, best)) best = b;
    R.decidedBy = cands.length < 2 ? why : cands.some((b) => b.s !== best.s) ? 'distance' : cands.some((b) => b.orbs !== best.orbs) ? 'orbs' : cands.some((b) => b.taps !== best.taps) ? 'taps' : 'draw';
    return best;
  }
  // ── items
  function useItem(b) {
    if (!b.item || tick - b.lastUse < USE_GAP) return;
    b.lastUse = tick;
    const kind = b.item;
    if (kind === 'cannon') {
      // the shot flies down your current position and destroys the first group of spikes there (for you only)
      let target = null;
      for (let j = firstBlock(H, b.s); j < H.length; j++) { const g = H[j]; if (g.s0 > b.s + SHOT_RANGE) break; if (g.s1 + SPHERE_R < b.s || b.gone.has(g.id) || !((g.mask >> b.seg) & 1)) continue; target = g; break; }
      const dist = target ? Math.max(0, target.s0 - b.s) : SHOT_RANGE;
      const hitTick = tick + Math.max(1, Math.ceil(dist / (SHOT_SPEED * DT)));
      shots.push({ i: b.i, seg: b.seg, s0: b.s, tick0: tick, hitTick, target: target ? target.id : -1, done: false });
      if (--b.ammo <= 0) b.item = null;
    } else {
      if (kind === 'burst') waves.push({ kind, i: b.i, s0: b.s, tick0: tick, hit: [] });
      else if (kind === 'emp') waves.push({ kind, i: b.i, s0: b.s, tick0: tick, hit: [] });
      else if (kind === 'ether') b.etherUntil = tick + POWERS.ether.ticks;
      b.item = null;
    }
    events.push({ tick, kind: 'use', item: kind, i: b.i });
  }
  // a burst or EMP reaching racer o
  function strike(w, o) {
    w.hit.push(o.i);
    if (tick <= o.etherUntil) { events.push({ tick, kind: 'immune', item: w.kind, i: o.i, by: w.i }); return; }
    if (o.shield) { o.shield = 0; o.shieldUsedTick = tick; events.push({ tick, kind: 'blocked', item: w.kind, i: o.i, by: w.i }); return; }
    if (w.kind === 'burst') o.slowUntil = tick + SLOW_FX.ticks;
    else { o.empUntil = tick + EMP_FX.ticks; o.empStart = tick; o.q.length = 0; o.stepT = 0; o.cl = o.seg; o.from = o.seg; }
    events.push({ tick, kind: 'hit', item: w.kind, i: o.i, by: w.i });
  }
  // ── computer players: read the pipe like a player. Spot the next spikes that cover where you'll be, find the
  // nearest opening, and step to it after a human-like reaction delay; now and then react late or overshoot by one.
  // Good ones detour for pickups and use items sensibly. cfg.players[].ai overrides the profile (tests model
  // players with 150–400 ms reactions).
  function aiOf(b) {
    if (b.ai) return b.ai;
    const k = 1 - b.skill;
    return (b.ai = { react: 8 + Math.round(k * 16), jitter: 2 + k * 10, lapse: 0.02 + k * 0.1, over: k * 0.35, look: 1.5, greed: b.skill > 0.7 ? 0.7 : 0.35, items: 1 });
  }
  function botInput(b) {
    const ai = aiOf(b);
    if (tick <= b.empUntil) return 0;
    let bits = 0;
    if (b.extra) { bits |= b.extra > 0 ? IN_R : IN_L; b.extra = 0; b.seen = null; return bits; } // the overshoot
    const v = Math.max(5, b.v || speedAt(t)), look = v * ai.look, planned = segWrap(b.seg + qSum(b));
    // the next spikes that cover where we'll be
    let g = null;
    for (let j = firstBlock(H, b.s); j < H.length; j++) {
      const h = H[j]; if (h.s0 - SPHERE_R > b.s + look) break;
      if (h.s1 + SPHERE_R < b.s || b.gone.has(h.id)) continue;
      if (h.ph != null && !zapLiveDuring(h, b, tick)) continue; // a plate that will be dead when we get there
      if ((h.mask >> planned) & 1) { g = h; break; }
    }
    let goal = planned, seen = null, until = b.s + v * STEP_SEC * 1.2;
    if (g) { goal = nearestFree(g.mask, planned, b.dir || 1); seen = 'g' + g.pat; until = Math.max(b.s, g.s0 - SPHERE_R - 0.01); }
    else if (ai.greed > 0) {
      // nothing in the way: maybe go for a pickup or a strip
      const nextG = (x) => { for (let j = firstBlock(H, x); j < H.length; j++) { const h = H[j]; if (h.s0 > x) return h; } return null; };
      const cands = [];
      for (const o of O) if (o.s > b.s + 1 && o.s < b.s + look && !b.got.includes(o.id) && !(o.power === 'shield' && b.shield)) cands.push({ id: 'o' + o.id, seg: o.seg, s: o.s, p: o.power && POWERS[o.power].held && b.item ? 0.2 : ai.greed });
      for (const st of course.strips) if (st.s0 > b.s + 1 && st.s0 < b.s + look && !b.strips.includes(st.id)) cands.push({ id: 'x' + st.id, seg: st.seg, s: st.s0 + 0.5, p: ai.strips === 0 ? 0 : st.kind === 'boost' ? (b.skill > 0.75 ? 0.65 : 0.25) : (b.skill < 0.7 ? 0.45 : 0.1) });
      for (const c of cands) {
        if (!(b.want[c.id] ??= RNG() < c.p)) continue;
        const ticks = (c.s - b.s) / (v * DT), need = Math.abs(segDist(planned, c.seg)) * STEP_TICKS + ai.react;
        const after = nextG(c.s), back = after ? Math.abs(segDist(c.seg, nearestFree(after.mask, c.seg))) * STEP_TICKS + ai.react : 0;
        const room = after ? (after.s0 - c.s) / (v * DT) : 999;
        if (need < ticks && back < room * 0.9) { goal = c.seg; seen = c.id; until = Math.max(b.s, c.s - 0.5); break; }
      }
    }
    if (seen === b.seen && goal !== b.lastGoal && seen) b.actAt = Math.max(b.actAt, tick + Math.round(ai.react * 0.35 + RNG() * ai.jitter * 0.5));
    b.lastGoal = goal;
    if (seen !== b.seen) {
      b.seen = seen;
      b.actAt = tick + ai.react + Math.round(RNG() * ai.jitter) + (RNG() < ai.lapse ? 8 + Math.floor(RNG() * 14) : 0);
      b.overPending = RNG() < ai.over;
    }
    if (tick >= b.actAt && goal !== planned && b.q.length === 0) {
      let d = segDist(planned, goal); if (d === SEGS / 2 || d === -SEGS / 2) d = b.dir || 1;
      const dir = d > 0 ? 1 : -1, next = segWrap(planned + dir);
      // never step into spikes between here and the spikes we're steering for
      if (!blockedAt(course, b, next, b.s, until, tick)) {
        bits |= dir > 0 ? IN_R : IN_L;
        if (Math.abs(d) === 1 && b.overPending) { b.overPending = false; b.extra = dir; }
      }
    }
    // items
    if (b.item && ai.items && tick - b.lastUse >= USE_GAP) {
      const held = tick - b.heldSince, others = active.filter((o) => o !== b && o.alive);
      let use = false;
      if (b.item === 'cannon') {
        if (g && g.s0 - b.s < v * 0.7 && Math.abs(segDist(planned, goal)) * STEP_TICKS > (g.s0 - b.s) / (v * DT) - 4) use = true; // can't make it: blast through
        else if (g && g.s0 - b.s < 18 && RNG() < 0.01) use = true;
      } else if (b.item === 'burst') use = others.some((o) => Math.abs(o.s - b.s) < 40) || held > 300;
      else if (b.item === 'emp') use = others.some((o) => o.s > b.s && o.s - b.s < 140) || held > 360;
      else if (b.item === 'ether') use = (g && Math.abs(segDist(planned, goal)) >= 4 && g.s0 - b.s < v * 0.6) || held > 300;
      if (use) bits |= IN_USE;
    }
    return bits;
  }
  function botStep(b) { const keep = RNG; RNG = botRng; try { return botInput(b); } finally { RNG = keep; } }
  const R = {
    key: trackKey, god, course, spheres, beans: spheres, active, isFinal: false, decidedBy: null, finishOrder, waves, shots, events,
    get t() { return t; }, get tick() { return tick; }, get s() { return s; }, get winner() { return winner; },
    get timeout() { return RACE_SECONDS; },
    /** inputs: { [seat]: packedInt }. Missing seats are played by the bot (own RNG stream) and written back. */
    step(inputs) {
      if (winner) return winner;
      tick++; t = tick * DT;
      for (const b of active) {
        if (!b.alive) continue;
        let p = inputs[b.i];
        if (p == null) { p = botStep(b); inputs[b.i] = p; }
        p >>>= 0;
        if (tick > b.empUntil) { if (p & IN_L) pushStep(b, -1); if (p & IN_R) pushStep(b, 1); }
        if (p & IN_USE) useItem(b);
        moveSphere(b, course, tick);
      }
      s = 0; for (const b of active) if (b.s > s) s = b.s;
      // cannon shots land
      for (const sh of shots) if (!sh.done && tick >= sh.hitTick) { sh.done = true; if (sh.target >= 0) { byI.get(sh.i).gone.add(sh.target); events.push({ tick, kind: 'blast', i: sh.i, g: sh.target }); } }
      // bursts and EMPs spread
      for (const w of waves) {
        if (w.done) continue;
        const reach = (tick - w.tick0) * DT * (w.kind === 'burst' ? WAVE_SPEED : EMP_SPEED);
        let pending = 0;
        for (const o of active) {
          if (o.i === w.i || !o.alive || w.hit.includes(o.i)) continue;
          if (w.kind === 'burst') { if (Math.abs(o.s - w.s0) <= reach) strike(w, o); else pending++; }
          else if (o.s >= w.s0) { if (o.s <= w.s0 + reach) strike(w, o); else pending++; }
        }
        if (!pending || reach > 4000) w.done = true;
      }
      // spikes
      const died = [];
      for (const b of active) {
        if (!b.alive || tick <= b.empUntil || tick <= b.etherUntil || tick <= b.immuneUntil) continue;
        const g = spikeHit(course, b, tick);
        if (!g) continue;
        if (b.shield) { b.shield = 0; b.shieldUsedTick = tick; b.immuneUntil = tick + 36; events.push({ tick, kind: 'blocked', item: 'spike', i: b.i }); continue; }
        if (god.has(b.i)) continue;
        b.alive = false; b.deathTick = tick; b.killer = g.id; died.push(b);
      }
      // pickups
      for (const o of O) {
        for (const b of active) {
          if (!b.alive || tick <= b.empUntil || b.got.includes(o.id) || Math.abs(o.s - b.s) > ORB_R + SPHERE_R) continue;
          const d = Math.abs(segDist(b.cl, o.seg));
          if (!(d === 0 || (!o.power && tick < b.magnetT && d <= 3))) continue;
          b.got.push(o.id);
          if (o.cache != null) for (const q of O) if (q.cache === o.cache && q !== o && !b.got.includes(q.id)) b.got.push(q.id); // the rest of the cache is gone for you
          if (!o.power) b.orbs += tick < b.doubleT ? 2 : 1;
          else {
            const P = POWERS[o.power];
            if (o.power === 'shield') b.shield = 1;
            else if (o.power === 'magnet') b.magnetT = tick + P.ticks;
            else if (o.power === 'double') b.doubleT = tick + P.ticks;
            else { b.item = o.power; b.ammo = P.ammo || 0; b.heldSince = tick; }
            events.push({ tick, kind: 'pickup', item: o.power, i: b.i });
          }
        }
      }
      for (const b of died) finishOrder.push(b);
      const alive = active.filter((b) => b.alive);
      if (active.length === 1) { if (!alive.length) winner = active[0]; else if (tick >= RACE_TICKS) winner = alive[0]; }
      else if (alive.length === 1) { winner = alive[0]; R.decidedBy = 'last alive'; }
      else if (!alive.length) winner = decide(died, 'last alive');
      else if (tick >= RACE_TICKS) winner = decide(alive, 'time');
      if (winner) {
        const rest = active.filter((b) => b !== winner).sort((a, c) => (c.alive - a.alive) || (c.deathTick - a.deathTick) || (c.s - a.s) || (c.orbs - a.orbs) || (a.taps - c.taps) || (tieOrder.indexOf(a.i) - tieOrder.indexOf(c.i)));
        [winner, ...rest].forEach((b, k) => { b.place = k + 1; });
      }
      return winner;
    },
    /** Exact fingerprint of the race state. */
    hash() {
      const n = [t, s, waves.length, shots.length];
      for (const b of active) n.push(b.seg, b.from, b.cl, b.stepT, b.q.length, qSum(b), b.alive ? 1 : 0, b.orbs, b.deathTick, b.shield, b.immuneUntil, b.magnetT, b.doubleT,
        b.s, b.fxTick, b.fxKind === 'boost' ? 1 : b.fxKind === 'slow' ? 2 : 0, ITEM_CODE[b.item] || 0, b.ammo, b.slowUntil, b.empUntil, b.etherUntil, b.gone.size);
      return hashNums(n);
    },
    coast() {},
  };
  return R;
}

/** Drives a course along its safe line with perfect reactions. Courses it can't finish are rebuilt. */
function pilotSurvives(course, trace) {
  const P = course.path, b = { seg: course.startSeg, from: course.startSeg, cl: course.startSeg, stepT: 0, dir: 0, q: [], taps: 0, s: 0, v: 0, fxKind: null, fxTick: -999, strips: [], gone: new Set(), slowUntil: 0, empUntil: -1, etherUntil: 0 };
  let pi = 0;
  for (let tick = 1; tick <= RACE_TICKS; tick++) {
    while (pi < P.length && P[pi].s + SPHERE_R < b.s) pi++;
    const want = pi < P.length ? P[pi].seg : b.seg, planned = segWrap(b.seg + qSum(b));
    if (want !== planned && b.q.length === 0 && b.stepT <= 1) {
      const d = segDist(planned, want), dir = d > 0 ? 1 : -1, next = segWrap(planned + dir);
      const until = pi < P.length ? Math.max(b.s, P[pi].s - SPHERE_R - 0.01) : b.s + 2;
      if (!blockedAt(course, b, next, b.s, until, tick)) pushStep(b, dir);
    }
    stepCtl(b);
    b.v = speedAt((tick - 1) * DT); b.s += b.v * DT;
    const hit = spikeHit(course, b, tick);
    if (hit) { if (trace) Object.assign(trace, { tick, seg: b.cl, g: hit, want: pi < P.length ? P[pi] : null }); return false; }
  }
  return true;
}

// The six tracks (the "arenas" of this game). Keys are stage ids in the on-chain evidence: APPEND ONLY.
// A track sets how the four pipes braid round each other, its look, and its mix of spike patterns (rings with an
// opening, twin rings with two, twisting spiral channels, scattered clusters). The difficulty schedule is the same on
// every track, and inside a race every racer gets the identical course, so the track drawn never favours anyone.
const TRACKS = {
  nebula: { key: 'nebula', name: 'Nebula Run', sub: 'Long sweeping curves. A bit of everything.', theme: 'void', mix: { ring: 4, twin: 2, spiral: 2, cluster: 2, zap: 2.5 }, layout: ['spread', 'bundle', 'swap', 'spread', 'twist', 'bundle'] },
  helix: { key: 'helix', name: 'Ion Helix', sub: 'Pipes corkscrew round each other. Spiral channels.', theme: 'ion', mix: { ring: 2, twin: 1, spiral: 5, cluster: 1, zap: 2 }, layout: ['twist', 'bundle', 'twist', 'swap', 'twist', 'bundle'] },
  canyon: { key: 'canyon', name: 'Solar Canyon', sub: 'Switchbacks and hard rings.', theme: 'solar', mix: { ring: 5, twin: 3, spiral: 1, cluster: 1, zap: 2.5 }, layout: ['spread', 'swap', 'spread', 'bundle', 'swap', 'bundle'] },
  cathedral: { key: 'cathedral', name: 'Prism Cathedral', sub: 'Climbs and drops past glass. Spike fields.', theme: 'prism', mix: { ring: 2, twin: 1, spiral: 2, cluster: 5, zap: 2.5 }, layout: ['bundle', 'spread', 'bundle', 'twist', 'spread', 'swap'] },
  storm: { key: 'storm', name: 'Vector Storm', sub: 'Pipes flung far apart, then slammed together.', theme: 'vector', mix: { ring: 3, twin: 3, spiral: 3, cluster: 1, zap: 4 }, layout: ['spread', 'spread', 'bundle', 'spread', 'swap', 'bundle'] },
  ghost: { key: 'ghost', name: 'Signal Ghost', sub: 'Braids and crossings. Twisting channels.', theme: 'signal', mix: { ring: 2, twin: 2, spiral: 3, cluster: 3, zap: 3 }, layout: ['swap', 'bundle', 'swap', 'twist', 'swap', 'bundle'] },
};
const ARENAS = TRACKS;
