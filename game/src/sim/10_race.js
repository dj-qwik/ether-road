// ───────────────────────── THE RACE: course generation + the one step function server and browsers run ─────────────────────────
// Everything that decides a result lives here and is deterministic: a course is built from two seeded random
// draws, every sphere's lane comes only from its taps, and collisions are tested in track coordinates
// (distance along the road × lane), never against meshes. The 3D world is drawn from this data.

// Distance travelled at the end of every tick (identical for every sphere: speed is the game's).
const S_TICKS = RACE_TICKS + 1800;
const S_TABLE = (() => { const a = new Float64Array(S_TICKS + 1); for (let k = 1; k <= S_TICKS; k++) a[k] = a[k - 1] + speedAt((k - 1) * DT) * DT; return a; })();
const sAtTick = (k) => S_TABLE[Math.max(0, Math.min(S_TICKS, k))];
function sAtT(t) { const x = t / DT, k = Math.floor(x); return k >= S_TICKS ? S_TABLE[S_TICKS] : k < 0 ? 0 : S_TABLE[k] + (S_TABLE[k + 1] - S_TABLE[k]) * (x - k); }
function tickAtS(x) { let lo = 0, hi = S_TICKS; while (lo < hi) { const m = (lo + hi) >> 1; if (S_TABLE[m] >= x) hi = m; else lo = m + 1; } return lo; } // first tick with s ≥ x
function tOfS(x) { const k = tickAtS(x); if (k <= 0) return 0; const a = S_TABLE[k - 1], b = S_TABLE[k]; return (k - 1 + (b > a ? (x - a) / (b - a) : 0)) * DT; }

// Is a hazard solid at time t? Periodic ones (gates, crushers) move on the music's beat; the rest switch on/off once.
function hazardOn(h, t) {
  if (h.per) { let f = (t - h.ph) / h.per; f -= Math.floor(f); return f < h.duty; }
  return t >= h.on && t < h.off;
}
// Solid at any moment while a sphere passes it (the sphere covers [s0 − r, s1 + r]), with a little margin.
function hazardLive(h, m) {
  const a = tOfS(h.s0 - SPHERE_R) - m, b = tOfS(h.s1 + SPHERE_R) + m;
  for (let k = 0; k <= 8; k++) if (hazardOn(h, a + (b - a) * k / 8)) return true;
  return false;
}

// How hard each moment is (seconds): gap between hazard beats, smallest switch window, chance a beat flips lanes.
const GAP = [[2.6, 1.0], [14, 0.74], [30, 0.52], [45, 0.4], [52, 0.32], [60, 0.24]];
const WMIN = [[2.6, 0.42], [14, 0.3], [30, 0.2], [45, 0.14], [52, 0.1], [60, 0.055]];
const FLIP = [[0, 0.5], [14, 0.55], [30, 0.62], [45, 0.78], [60, 0.92]];
// The switch window a flip is tightened to (seconds; ×0.85–1.5): this is where precision starts to matter.
const WTARGET = [[2.6, 0.65], [14, 0.45], [30, 0.28], [45, 0.18], [52, 0.115], [57, 0.08], [60, 0.06]];
const TIGHTEN = [[2.6, 0.3], [20, 0.5], [45, 0.8], [52, 1]];
const COLLAPSE_AT = 48; // "FINAL COLLAPSE": the road tightens until someone breaks
// Hazard kinds. len: depth along the road. Static kinds block always; timed kinds switch on/off; beat kinds cycle.
const KIND = {
  spike: { len: 1.0 }, mine: { len: 0.55 }, wall: { len: 1.0 }, laser: { len: 0.35, timed: 1 }, echo: { len: 1.1, timed: 1 },
  pillar: { len: 0.9, timed: 1 }, gate: { len: 0.5, beat: 1 }, teeth: { len: 0.6, beat: 1 }, crusher: { len: 0.8, beat: 1 },
  sweeper: { len: 0.45, timed: 1 }, // a bar that slides across into your lane just before you arrive
};
// Power-ups. Each sits at the same track position for every racer (mirrored lane, like every hazard), in the
// risky lane between two hazards, so taking it costs two quick taps. Effects are fixed, never random:
//   shield  — the next solid hazard you touch is passed through instead (one hit, then gone)
//   magnet  — for 4 s, orbs in BOTH lanes are yours
//   double  — for 6 s, orbs count twice
const POWERS = { shield: { ticks: 0 }, magnet: { ticks: 240 }, double: { ticks: 360 } };
const POWER_PLAN = [[11, 'magnet'], [24, 'shield'], [33, 'double'], [42, 'magnet']];
// Which kinds can appear when (introduced one at a time, then each track's own mix).
function kindPool(t, track, kinds) {
  if (kinds && kinds.length) return kinds; // debug: one kind only
  if (t < 6) return ['spike'];
  if (t < 9) return ['mine', 'spike'];
  if (t < 12) return ['laser', 'spike', 'mine'];
  if (t < 15.5) return ['echo', 'pillar', 'spike', 'mine'];
  if (t < 20) return ['gate', 'spike', 'mine', 'laser', 'pillar', 'sweeper'];
  if (t >= COLLAPSE_AT) return ['wall', 'wall', 'spike', 'gate', 'crusher', 'laser'];
  return track.mix;
}

/**
 * Build a course from a seed string. Pure function of the seed: the server and every browser build the same one.
 * Returns { blocks (sorted by s0), orbs, startLane, layout, end } in BASE lanes; each sphere sees it mirrored
 * (lane ^ mirror), which makes every sphere's road exactly equally hard.
 */
function buildCourse(seed, trackKey, opts = {}) {
  const track = TRACKS[trackKey] || TRACKS.nebula;
  const rng = makeRng('course:' + track.key + ':' + seed), r = () => rng();
  const plan = POWER_PLAN.slice(); let pid = 0;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const blocks = [], orbs = [];
  let id = 0, prevB = -1, prevEnd = -1e9, prevBlock = null, t = 2.6, first = true;
  const occ = (len) => (len + 2 * SPHERE_R); // road length a hazard + the sphere cover
  while (t < RACE_SECONDS + 1.2) {
    const v = speedAt(t);
    const B = prevB < 0 ? (r() < 0.5 ? 0 : 1) : r() < pwl(FLIP, t) ? 1 - prevB : prevB;
    let kind = pick(kindPool(t, track, opts.kinds));
    // a decoy on the SAFE lane: looks dangerous but is not solid while you pass (reading is a skill)
    let decoy = t > 20 && !opts.kinds && !KIND[kind].beat && kind !== 'sweeper' && r() < pwl([[20, 0.12], [40, 0.28], [60, 0.32]], t) * track.decoys ? pick(['laser', 'echo', 'pillar', 'crusher']) : null;
    const wantSnap = KIND[kind].beat || decoy === 'crusher';
    // where the hazard's middle is passed, snapped onto the beat for beat-driven kinds
    let tm = t + occ(KIND[kind].len) / 2 / v;
    if (wantSnap) {
      const frac = kind === 'crusher' ? 0.225 : decoy === 'crusher' && !KIND[kind].beat ? 0.725 : 0.5;
      const j = Math.floor(tm / BEAT); let target = (j + frac) * BEAT; if (target < tm) target += BEAT;
      tm = target;
    }
    let s0 = sAtT(tm) - occ(KIND[kind].len) / 2 + SPHERE_R, s1 = s0 + KIND[kind].len;
    // a lane flip needs a window to switch in: push the hazard back until there is one
    if (prevB >= 0 && B !== prevB) {
      const need = pwl(WMIN, tm) * speedAt(tm), have = s0 - prevEnd - 2 * SPHERE_R;
      if (have < need) {
        if (wantSnap) { kind = 'spike'; decoy = decoy === 'crusher' ? null : decoy; }
        s0 += need - have; s1 = s0 + KIND[kind].len;
      } else if (r() < pwl(TIGHTEN, tm)) {
        // tighten: the previous lane stays closed until just before this hazard, leaving a narrow window
        const w = Math.max(need, pwl(WTARGET, tm) * (0.85 + 0.65 * r()) * speedAt(tm)), end = s0 - 2 * SPHERE_R - w;
        if (end > prevEnd + 0.6) {
          if (prevBlock && !KIND[prevBlock.kind].timed && !KIND[prevBlock.kind].beat && prevBlock.s1 >= prevEnd - 1e-9) {
            prevBlock.s1 = end; prevBlock.tB = tOfS(end + SPHERE_R); if (prevBlock.s1 - prevBlock.s0 > 2) prevBlock.kind = 'wall';
          } else if (end - prevEnd - 0.4 >= 1) {
            const fs0 = prevEnd + 0.4;
            blocks.push({ id: id++, kind: 'wall', lane: prevB, s0: fs0, s1: end, tA: tOfS(fs0 - SPHERE_R), tB: tOfS(end + SPHERE_R), on: -1e9, off: 1e9, per: 0, ph: 0, duty: 0, decoy: false });
          }
          prevEnd = Math.max(prevEnd, end);
        }
      }
    }
    const tA = tOfS(s0 - SPHERE_R), tB = tOfS(s1 + SPHERE_R);
    // merge a run on the same lane into one long wall now and then (the canonical path never needed that gap)
    if (!first && B === prevB && prevBlock && prevBlock.s1 - prevBlock.s0 < 24 && !KIND[kind].timed && !KIND[kind].beat && !KIND[prevBlock.kind].timed && !KIND[prevBlock.kind].beat && r() < 0.3 && !decoy) {
      prevBlock.kind = 'wall'; prevBlock.s1 = s1; prevBlock.tB = tB; prevEnd = s1;
      t = tm + pwl(GAP, tm) * (0.9 + 0.22 * r());
      continue;
    }
    const mk = (k, lane, extra) => { const h = { id: id++, kind: k, lane, s0, s1, tA, tB, on: -1e9, off: 1e9, per: 0, ph: 0, duty: 0, decoy: false, ...extra }; blocks.push(h); return h; };
    let main;
    if (kind === 'laser') main = mk(kind, B, { on: tA - 0.55, off: tB + 0.3 });
    else if (kind === 'echo') main = mk(kind, B, { on: tA - 0.5 });
    else if (kind === 'pillar') main = mk(kind, B, { on: tA - 0.65 });
    else if (kind === 'crusher') main = mk(kind, B, { per: BEAT, ph: 0, duty: 0.45 });
    else if (kind === 'sweeper') { main = mk(kind, B, { on: tA - 0.38 }); mk(kind, 1 - B, { off: tA - 0.43, decoy: true }); }
    else if (kind === 'gate' || kind === 'teeth') {
      const j = Math.floor(tm / BEAT);
      main = mk(kind, B, { per: 2 * BEAT, ph: j * BEAT, duty: 0.5 });
      mk(kind, 1 - B, { per: 2 * BEAT, ph: (j + 1) * BEAT, duty: 0.5, decoy: true });
    } else main = mk(kind, B);
    if (decoy) {
      const L = 1 - B;
      if (decoy === 'laser') mk('laser', L, { decoy: true, on: tA - 1.1, off: tA - 0.32 });
      else if (decoy === 'echo') mk('echo', L, { decoy: true, on: tB + 0.32 });
      else if (decoy === 'pillar') mk('pillar', L, { decoy: true, on: tB + 0.3 });
      else mk('crusher', L, { decoy: true, per: BEAT, ph: 0, duty: 0.45 });
    }
    // an orb in the blocked lane's gap: grab it with two quick taps, or play safe. Breaks ties at the cap.
    // power-ups use the same kind of spot, at fixed times in the race (the first good gap after each planned time)
    if (!first && B === prevB && prevBlock && t > 5) {
      const gapS = s0 - prevEnd - 2 * SPHERE_R;
      if (gapS / v > 0.5) {
        if (plan.length && t >= plan[0][0] && t < plan[0][0] + 7) orbs.push({ id: orbs.length, lane: B, s: (prevEnd + s0) / 2, power: plan.shift()[1], pid: pid++ });
        else if (r() < 0.45) orbs.push({ id: orbs.length, lane: B, s: (prevEnd + s0) / 2, power: null });
      }
    }
    while (plan.length && t > plan[0][0] + 7) plan.shift(); // no fitting gap in time: that power-up is skipped (for everyone)
    prevB = B; prevEnd = Math.max(prevEnd, s1); prevBlock = main; first = false;
    t = tm + pwl(GAP, tm) * (0.9 + 0.22 * r());
  }
  blocks.sort((a, b) => a.s0 - b.s0 || a.id - b.id);
  // visual layout of the four rails along the road (drawn by the client; never affects play)
  const layout = []; let lt = 0;
  layout.push({ kind: 'launch', t0: 0, t1: 3.2 });
  lt = 3.2;
  const cycle = track.layout;
  let ci = Math.floor(r() * cycle.length);
  while (lt < COLLAPSE_AT) {
    const k = cycle[ci++ % cycle.length];
    const len = k === 'solo' ? 6 + r() * 5 : k === 'cross' ? 3.2 : k === 'helix' ? 5 + r() * 2 : 4 + r() * 3;
    const t1 = Math.min(COLLAPSE_AT, lt + len);
    layout.push({ kind: k, t0: lt, t1, spin: r() < 0.5 ? -1 : 1, rise: r() * 2 - 1, turn: r() * 2 - 1 });
    lt = t1;
  }
  layout.push({ kind: 'merge', t0: COLLAPSE_AT, t1: RACE_SECONDS + 30, finale: true });
  const startLane = 1 - (blocks.find((h) => !h.decoy)?.lane ?? 0);
  orbs.sort((a, b) => a.s - b.s);
  return { seed, track: track.key, blocks, orbs, startLane, layout, end: sAtT(RACE_SECONDS + 4) };
}

// ───── the lane controller: identical for humans and bots ─────
function sphereTap(b, tick) {
  if (tick - b.lastTap < DEBOUNCE_TICKS) return;
  b.lastTap = tick; b.taps++;
  if (b.swapT > 0) b.buf = BUFFER_TICKS; else startSwap(b);
}
function startSwap(b) { b.from = b.target; b.target = 1 - b.target; b.swapT = SWAP_TICKS; b.buf = 0; }
function advanceSwap(b) {
  if (b.swapT > 0) {
    b.swapT--;
    b.cl = SWAP_TICKS - b.swapT >= SWAP_MID ? b.target : b.from; // collision lane flips at the 50% point
    if (b.swapT === 0 && b.buf > 0) { startSwap(b); b.swapT--; b.cl = b.from; } // buffered tap: straight into the next change
  }
  if (b.buf > 0) b.buf--;
}
const TAP_TO_FLIP = 2; // ticks from a tap to the collision lane flipping (see advanceSwap)

/** First solid hazard on `lane` (as this sphere sees it) between s and s + ahead; null if the way is clear. */
function threatOn(course, b, lane, s, ahead, from, fooled) {
  const H = course.blocks;
  for (let j = from; j < H.length; j++) {
    const h = H[j];
    if (h.s0 - SPHERE_R > s + ahead) break;
    if ((h.lane ^ b.mirror) !== lane || h.s1 + SPHERE_R <= s) continue;
    if (h.live === undefined) h.live = hazardLive(h, 0.03);
    if (h.live || (fooled && fooled(h))) return h;
  }
  return null;
}

/**
 * cfg: { key (track), seed, players: [{ i, name, human?, skill?, skin? }], active: [i, …], botSalt?, debug? }
 *  debug (practice only; the server never sets it): { god: [seat…] never crash, kinds: [kind…] only these hazards }
 * rng (anti-peeking, same contract as before): server { record: [] } logs every draw; browsers { feed } replay them.
 * The course needs only three draws, all taken here at the start.
 */
function createRound(cfg, rng = {}) {
  const src = makeRng(cfg.seed ?? 0);
  if (rng.feed) RNG = () => rng.feed() / 4294967296;
  else if (rng.record) { const log = rng.record; RNG = () => { const v = src(); log.push(v * 4294967296); return v; }; }
  else RNG = src;
  const draw = () => Math.floor(RNG() * 4294967296) >>> 0;
  const trackKey = TRACKS[cfg.key] ? cfg.key : 'nebula', dbg = cfg.debug || {};
  const ca = draw(), cb = draw();
  // a course the perfect pilot can't finish is impossible: rebuild (deterministically) until it can
  let course = null;
  for (let k = 0; k < 12 && !course; k++) { const c = buildCourse(ca + ':' + cb + ':' + k, trackKey, dbg); if (pilotSurvives(c)) course = c; }
  if (!course) course = buildCourse(ca + ':' + cb + ':safe', trackKey, dbg);
  const god = new Set(dbg.god || []);
  const order = shuffleWith(RNG, cfg.active);        // who drives the mirrored road (exactly as hard)
  const tieOrder = shuffleWith(RNG, cfg.active);     // last-resort tie-break, fixed before the start
  const botRng = makeRng('bots:' + (cfg.seed ?? 0) + ':' + (cfg.botSalt ?? ''));
  const spheres = cfg.players.map((p) => {
    const m = order.indexOf(p.i) & 1, lane = course.startLane ^ m;
    return { i: p.i, name: p.name || ROSTER[p.i][0], color: ROSTER[p.i][1], glyph: ROSTER[p.i][2], human: !!p.human, skill: p.skill ?? 0.85, skin: p.skin | 0,
      mirror: m, target: lane, from: lane, cl: lane, swapT: 0, buf: 0, lastTap: -99, taps: 0, alive: true, orbs: 0, got: [],
      shield: 0, immuneS: -1, magnetT: 0, doubleT: 0, shieldUsedTick: 0,
      deathTick: 0, killer: -1, place: 0, plan: 0, planFor: -1, fooled: {}, wantOrb: {}, ai: p.ai || null, active: cfg.active.includes(p.i) };
  });
  const byI = new Map(spheres.map((b) => [b.i, b]));
  const active = cfg.active.map((i) => byI.get(i));
  let tick = 0, t = 0, s = 0, winner = null, bi = 0, oi = 0;
  const H = course.blocks, O = course.orbs;
  const finishOrder = []; // eliminated, earliest first
  function decide(cands, why) {
    let best = null;
    const better = (a, c) => a.orbs !== c.orbs ? a.orbs > c.orbs : a.taps !== c.taps ? a.taps < c.taps : tieOrder.indexOf(a.i) < tieOrder.indexOf(c.i);
    for (const b of cands) if (!best || better(b, best)) best = b;
    R.decidedBy = cands.length < 2 ? why : cands.some((b) => b.orbs !== best.orbs) ? 'orbs' : cands.some((b) => b.taps !== best.taps) ? 'taps' : 'draw';
    return best;
  }
  function botTap(b) {
    const keep = RNG; RNG = botRng;
    try { return botThink(b); } finally { RNG = keep; }
  }
  // Bots read the road like a player: spot the next solid hazard in their lane, find the window on the other
  // lane, and tap to land in the middle of it, with human-like timing error (less skilled → sloppier, slower to
  // react, fooled by decoys more often). Good bots also detour for orbs. cfg.players[].ai overrides the profile
  // (the test suite uses it to model players with 150–400 ms reactions).
  function aiOf(b) {
    if (b.ai) return b.ai;
    const k = 1 - b.skill;
    return (b.ai = { react: 6 + Math.round(k * 14), sigma: 0.6 + k * 7, fool: k * 0.45, lapse: (k + 0.1) * 0.06, greed: b.skill > 0.7 ? 0.75 : 0.3, aim: k * 0.6 });
  }
  function botThink(b) {
    const ai = aiOf(b);
    if (b.plan && tick >= b.plan) { b.plan = 0; return true; }
    if (b.plan || b.swapT > 0) return false;
    const ahead = speedAt(t) * 1.6;
    const fooled = (h) => h.decoy && h.kind !== 'gate' && h.kind !== 'teeth' && (b.fooled[h.id] ??= RNG() < ai.fool);
    const L2 = 1 - b.target;
    // the latest point the flip can happen so the other lane is clear from there up to sb
    const windowTo = (sb) => {
      let sa = s + 0.05;
      for (let j = bi; j < H.length; j++) {
        const h = H[j]; if (h.s0 - SPHERE_R >= sb) break;
        if ((h.lane ^ b.mirror) !== L2 || h.s1 + SPHERE_R <= s) continue;
        if (h.live === undefined) h.live = hazardLive(h, 0.03);
        if (h.live || fooled(h)) sa = Math.max(sa, h.s1 + SPHERE_R + 0.02);
      }
      return sa;
    };
    const schedule = (sa, sb, id) => {
      b.planFor = id;
      if (sa > sb) return false; // no way round from here: hold and hope
      const g = (RNG() + RNG() + RNG() - 1.5) * 2 * ai.sigma;
      let k = tickAtS(sa + (sb - sa) * (0.5 + (RNG() - 0.5) * ai.aim)) - TAP_TO_FLIP + Math.round(g);
      if (RNG() < ai.lapse) k += 4 + Math.floor(RNG() * 10); // a late reaction now and then
      k = Math.max(k, tick + ai.react, b.lastTap + DEBOUNCE_TICKS);
      if (k <= tick) return true;
      b.plan = k; return false;
    };
    const th = threatOn(course, b, b.target, s, ahead, bi, fooled);
    // an orb on the other lane before any threat here: detour for it if the window looks comfortable
    for (let j = oi; j < O.length; j++) {
      const o = O[j]; if (o.s > s + ahead || (th && o.s > th.s0)) break;
      if ((o.lane ^ b.mirror) !== L2 || b.got.includes(o.id) || o.s < s + 1 || b.planFor === 'o' + o.id) continue;
      if (o.power === 'shield' && b.shield) continue; // already holding one
      const want = b.wantOrb[o.id] ??= RNG() < ai.greed;
      if (!want) continue;
      const sb = o.s - 0.1, sa = windowTo(sb);
      if (sb - sa < speedAt(t) * 0.12) continue; // too tight to bother
      return schedule(sa, sb, 'o' + o.id);
    }
    if (!th || b.planFor === th.id) return false;
    const sb = th.s0 - SPHERE_R - 0.02;
    return schedule(windowTo(sb), sb, th.id);
  }
  const R = {
    key: trackKey, god, course, spheres, beans: spheres, active, isFinal: false, decidedBy: null, finishOrder,
    get t() { return t; }, get tick() { return tick; }, get s() { return s; }, get winner() { return winner; },
    get timeout() { return RACE_SECONDS; },
    /** inputs: { [seat]: packedInt }. Missing seats are played by the bot (own RNG stream) and written back. */
    step(inputs) {
      if (winner) return winner;
      tick++; t = tick * DT; s = sAtTick(tick);
      while (bi < H.length && H[bi].s1 + SPHERE_R < s - 40) bi++; // long walls stay in range; 40 u covers the longest
      for (const b of active) {
        if (!b.alive) continue;
        let p = inputs[b.i];
        if (p == null) { p = botTap(b) ? TAP : 0; inputs[b.i] = p; }
        if ((p >>> 0) & TAP) sphereTap(b, tick);
        advanceSwap(b);
      }
      // collisions (track coordinates only)
      const died = [];
      for (const b of active) {
        if (!b.alive) continue;
        for (let j = bi; j < H.length; j++) {
          const h = H[j];
          if (h.s0 - SPHERE_R >= s) break;
          if (h.s1 + SPHERE_R <= s || (h.lane ^ b.mirror) !== b.cl || s < b.immuneS) continue;
          if (hazardOn(h, t)) {
            if (b.shield) { b.shield = 0; b.immuneS = h.s1 + SPHERE_R + 0.5; b.shieldUsedTick = tick; break; } // pass through this one
            if (god.has(b.i)) continue;
            b.alive = false; b.deathTick = tick; b.killer = h.id; died.push(b); break;
          }
        }
      }
      // orbs
      while (oi < O.length && O[oi].s + ORB_R + SPHERE_R < s) oi++;
      for (let j = oi; j < O.length && O[j].s - ORB_R - SPHERE_R < s; j++) {
        const o = O[j];
        for (const b of active) {
          if (!b.alive || b.got.includes(o.id)) continue;
          const inLane = b.cl === (o.lane ^ b.mirror);
          if (!(inLane || (!o.power && tick < b.magnetT))) continue;
          b.got.push(o.id);
          if (!o.power) b.orbs += tick < b.doubleT ? 2 : 1;
          else if (o.power === 'shield') b.shield = 1;
          else if (o.power === 'magnet') b.magnetT = tick + POWERS.magnet.ticks;
          else if (o.power === 'double') b.doubleT = tick + POWERS.double.ticks;
        }
      }
      for (const b of died) finishOrder.push(b);
      const alive = active.filter((b) => b.alive);
      if (active.length === 1) { if (!alive.length) winner = active[0]; else if (tick >= RACE_TICKS) winner = alive[0]; }
      else if (alive.length === 1) { winner = alive[0]; R.decidedBy = 'last alive'; }
      else if (!alive.length) winner = decide(died, 'last alive');
      else if (tick >= RACE_TICKS) winner = decide(alive, 'time');
      if (winner) {
        // places: winner first, then survivors / simultaneous fallers by the same rule, then latest eliminations
        const rest = active.filter((b) => b !== winner).sort((a, c) => (c.alive - a.alive) || (c.deathTick - a.deathTick) || (c.orbs - a.orbs) || (a.taps - c.taps) || (tieOrder.indexOf(a.i) - tieOrder.indexOf(c.i)));
        [winner, ...rest].forEach((b, k) => { b.place = k + 1; });
      }
      return winner;
    },
    /** Exact fingerprint of the race state. */
    hash() {
      const n = [t, s];
      for (const b of active) n.push(b.target, b.from, b.cl, b.swapT, b.buf, b.lastTap, b.alive ? 1 : 0, b.orbs, b.deathTick, b.shield, b.immuneS, b.magnetT, b.doubleT);
      return hashNums(n);
    },
    coast() {},
  };
  return R;
}

/** Replays a course with a flawless driver (taps in the middle of every window). Courses it can't finish are rebuilt. */
function pilotSurvives(course) {
  const H = course.blocks, b = { mirror: 0, target: course.startLane, from: course.startLane, cl: course.startLane, swapT: 0, buf: 0, lastTap: -99, taps: 0 };
  let plan = 0, planFor = -1, bi = 0;
  for (let tick = 1; tick <= RACE_TICKS; tick++) {
    const t = tick * DT, s = sAtTick(tick);
    while (bi < H.length && H[bi].s1 + SPHERE_R < s - 40) bi++;
    let tap = false;
    if (plan && tick >= plan) { plan = 0; tap = true; }
    else if (!plan && b.swapT === 0) {
      const th = threatOn(course, b, b.target, s, speedAt(t) * 2.5, bi, null);
      if (th && th.id !== planFor) {
        planFor = th.id;
        const sb = th.s0 - SPHERE_R - 0.02; let sa = s + 0.05;
        for (let j = bi; j < H.length; j++) { const h = H[j]; if (h.s0 - SPHERE_R >= sb) break; if (h.lane !== 1 - b.target || h.s1 + SPHERE_R <= s) continue; if (h.live === undefined) h.live = hazardLive(h, 0.03); if (h.live) sa = Math.max(sa, h.s1 + SPHERE_R + 0.02); }
        if (sa <= sb) { const k = Math.max(tickAtS((sa + sb) / 2) - TAP_TO_FLIP, b.lastTap + DEBOUNCE_TICKS); if (k <= tick) tap = true; else plan = k; }
      }
    }
    if (tap) sphereTap(b, tick);
    advanceSwap(b);
    for (let j = bi; j < H.length; j++) {
      const h = H[j]; if (h.s0 - SPHERE_R >= s) break;
      if (h.s1 + SPHERE_R <= s || h.lane !== b.cl) continue;
      if (hazardOn(h, t)) return false;
    }
  }
  return true;
}

// The six tracks (the "arenas" of this game). Keys are stage ids in the on-chain evidence: APPEND ONLY.
// A track sets the hazard mix after the opening, how the four rails braid, and its look. The difficulty
// schedule (gaps, switch windows, final collapse) is the same on every track, and inside a race every racer
// has the same road (mirrored), so the track drawn never favours anyone.
const TRACKS = {
  nebula: { key: 'nebula', name: 'Nebula Run', sub: 'Long sweeping curves. A bit of everything.', theme: 'void', decoys: 1,
    mix: ['spike', 'spike', 'mine', 'mine', 'laser', 'echo', 'pillar', 'gate', 'teeth', 'crusher', 'sweeper'], layout: ['solo', 'parallel', 'cross', 'solo', 'helix', 'merge'] },
  helix: { key: 'helix', name: 'Ion Helix', sub: 'Rails corkscrew round each other. Everything moves on the beat.', theme: 'ion', decoys: 0.8,
    mix: ['spike', 'spike', 'spike', 'mine', 'mine', 'gate', 'teeth', 'crusher', 'laser'], layout: ['helix', 'parallel', 'helix', 'cross', 'helix', 'merge'] },
  canyon: { key: 'canyon', name: 'Solar Canyon', sub: 'Hard switchbacks between walls and falling pillars.', theme: 'solar', decoys: 0.9,
    mix: ['spike', 'spike', 'wall', 'pillar', 'pillar', 'mine', 'crusher', 'sweeper'], layout: ['solo', 'cross', 'solo', 'parallel', 'cross', 'merge'] },
  cathedral: { key: 'cathedral', name: 'Prism Cathedral', sub: 'Climbs and drops past glass. Half of what you see is not solid.', theme: 'prism', decoys: 1.45,
    mix: ['spike', 'mine', 'echo', 'echo', 'pillar', 'laser', 'gate', 'sweeper'], layout: ['parallel', 'solo', 'merge', 'helix', 'solo', 'cross'] },
  storm: { key: 'storm', name: 'Vector Storm', sub: 'Rails flung far apart, then slammed together.', theme: 'vector', decoys: 1,
    mix: ['spike', 'mine', 'mine', 'laser', 'laser', 'sweeper', 'sweeper', 'teeth'], layout: ['solo', 'solo', 'merge', 'solo', 'cross', 'parallel'] },
  ghost: { key: 'ghost', name: 'Signal Ghost', sub: 'Braids and crossings. Echoes everywhere.', theme: 'signal', decoys: 1.25,
    mix: ['spike', 'echo', 'echo', 'sweeper', 'crusher', 'crusher', 'gate', 'mine'], layout: ['cross', 'parallel', 'cross', 'helix', 'cross', 'merge'] },
};
const ARENAS = TRACKS;
