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

// How hard each moment is (seconds): gap between hazards, smallest switch window, chance a hazard flips lanes.
const GAP = [[2.6, 0.9], [12, 0.62], [26, 0.46], [40, 0.36], [50, 0.29], [60, 0.23]];
const WMIN = [[2.6, 0.4], [12, 0.26], [24, 0.17], [36, 0.13], [46, 0.1], [52, 0.085], [60, 0.05]];
const FLIP = [[0, 0.6], [14, 0.68], [30, 0.74], [45, 0.84], [60, 0.94]]; // lots of back and forth
// The switch window a flip is tightened to (seconds; ×0.85–1.5): this is where precision starts to matter.
const WTARGET = [[2.6, 0.55], [12, 0.32], [24, 0.2], [36, 0.15], [46, 0.12], [52, 0.095], [57, 0.072], [60, 0.055]];
const TIGHTEN = [[2.6, 0.4], [12, 0.75], [30, 0.9], [44, 1]];
const COLLAPSE_AT = 48; // "FINAL COLLAPSE": the road tightens until someone breaks
// ONE hazard: red spikes. If it's red, it's solid, always. A long stretch is just a longer row of spikes.
const KIND = { spike: { len: 1.0 } };
// Power-ups. Each sits at the same track position for every racer (mirrored lane, like every hazard), in the
// risky lane between two hazards, so taking it costs two quick taps. Effects are fixed, never random:
//   shield  — the next spikes you touch are passed through instead (one hit, then gone)
//   magnet  — for 4 s, orbs in BOTH lanes are yours
//   double  — for 6 s, orbs count twice
const POWERS = { shield: { ticks: 0 }, magnet: { ticks: 240 }, double: { ticks: 360 } };
const POWER_PLAN = [[11, 'magnet'], [24, 'shield'], [33, 'double'], [42, 'magnet']];

/**
 * Build a course from a seed string. Pure function of the seed: the server and every browser build the same one.
 * Returns { blocks (sorted by s0), orbs, startLane, layout, end } in BASE lanes; each sphere sees it mirrored
 * (lane ^ mirror), which makes every sphere's road exactly equally hard.
 */
function buildCourse(seed, trackKey, opts = {}) {
  const track = TRACKS[trackKey] || TRACKS.nebula;
  const rng = makeRng('course:' + track.key + ':' + seed), r = () => rng();
  const plan = POWER_PLAN.slice(); let pid = 0;
  const blocks = [], orbs = [];
  let id = 0, prevB = -1, prevEnd = -1e9, prevBlock = null, t = 2.6, first = true;
  const occ = (len) => (len + 2 * SPHERE_R); // road length a block + the sphere cover
  const mk = (lane, s0, s1) => { const h = { id: id++, kind: 'spike', lane, s0, s1, tA: tOfS(s0 - SPHERE_R), tB: tOfS(s1 + SPHERE_R), on: -1e9, off: 1e9, per: 0, ph: 0, duty: 0, decoy: false }; blocks.push(h); return h; };
  while (t < RACE_SECONDS + 1.2) {
    const v = speedAt(t);
    // a power-up is due: hold the lane and leave a gap long enough to dip into the other lane for it
    const powerDue = !first && plan.length && t >= plan[0][0];
    const B = prevB < 0 ? (r() < 0.5 ? 0 : 1) : powerDue ? prevB : r() < pwl(FLIP, t) ? 1 - prevB : prevB;
    let tm = t + occ(1) / 2 / v;
    if (powerDue) tm = Math.max(tm, tOfS(prevEnd + 2 * SPHERE_R + 0.62 * v) + occ(1) / 2 / v);
    let s0 = sAtT(tm) - occ(1) / 2 + SPHERE_R, s1 = s0 + 1;
    // a lane flip needs a window to switch in: push the spikes back until there is one
    if (prevB >= 0 && B !== prevB) {
      const need = pwl(WMIN, tm) * speedAt(tm), have = s0 - prevEnd - 2 * SPHERE_R;
      if (have < need) { s0 += need - have; s1 = s0 + 1; }
      else if (r() < pwl(TIGHTEN, tm)) {
        // tighten: the previous lane's spikes run on until just before these, leaving a narrow window
        const w = Math.max(need, pwl(WTARGET, tm) * (0.85 + 0.65 * r()) * speedAt(tm)), end = s0 - 2 * SPHERE_R - w;
        if (end > prevEnd + 0.6 && prevBlock && prevBlock.s1 >= prevEnd - 1e-9) {
          prevBlock.s1 = end; prevBlock.tB = tOfS(end + SPHERE_R);
          prevEnd = end;
        }
      }
    }
    // run spikes on the same lane together into one long row now and then
    if (!first && !powerDue && B === prevB && prevBlock && prevBlock.s1 - prevBlock.s0 < 24 && r() < track.walls) {
      prevBlock.s1 = s1; prevBlock.tB = tOfS(s1 + SPHERE_R); prevEnd = s1;
      t = tm + pwl(GAP, tm) * (0.9 + 0.22 * r());
      continue;
    }
    const main = mk(B, s0, s1);
    // an orb in the blocked lane's gap: grab it with two quick taps, or play safe. Breaks ties at the cap.
    // power-ups use the same kind of spot, at fixed times in the race (the first good gap after each planned time)
    if (!first && B === prevB && prevBlock && t > 5) {
      const gapS = s0 - prevEnd - 2 * SPHERE_R;
      if (gapS / v > 0.5) {
        if (powerDue) orbs.push({ id: orbs.length, lane: B, s: (prevEnd + s0) / 2, power: plan.shift()[1], pid: pid++ });
        else if (r() < 0.45) orbs.push({ id: orbs.length, lane: B, s: (prevEnd + s0) / 2, power: null });
      }
    }
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
 *  debug (practice only; the server never sets it): { god: [seat…] never crash }
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
// A track sets how the four rails braid, its look, and how often spikes run together into long rows. The difficulty
// schedule (gaps, switch windows, final collapse) is the same on every track, and inside a race every racer
// has the same road (mirrored), so the track drawn never favours anyone.
const TRACKS = {
  nebula: { key: 'nebula',  name: 'Nebula Run', sub: 'Long sweeping curves.', theme: 'void', walls: 0.3, layout: ['solo', 'parallel', 'cross', 'solo', 'helix', 'merge'] },
  helix: { key: 'helix',  name: 'Ion Helix', sub: 'Rails corkscrew round each other.', theme: 'ion', walls: 0.22, layout: ['helix', 'parallel', 'helix', 'cross', 'helix', 'merge'] },
  canyon: { key: 'canyon',  name: 'Solar Canyon', sub: 'Switchbacks between long rows of spikes.', theme: 'solar', walls: 0.42, layout: ['solo', 'cross', 'solo', 'parallel', 'cross', 'merge'] },
  cathedral: { key: 'cathedral',  name: 'Prism Cathedral', sub: 'Climbs and drops past glass towers.', theme: 'prism', walls: 0.3, layout: ['parallel', 'solo', 'merge', 'helix', 'solo', 'cross'] },
  storm: { key: 'storm',  name: 'Vector Storm', sub: 'Rails flung far apart, then slammed together.', theme: 'vector', walls: 0.25, layout: ['solo', 'solo', 'merge', 'solo', 'cross', 'parallel'] },
  ghost: { key: 'ghost',  name: 'Signal Ghost', sub: 'Braids and crossings.', theme: 'signal', walls: 0.36, layout: ['cross', 'parallel', 'cross', 'helix', 'cross', 'merge'] },
};
const ARENAS = TRACKS;
