// ───────────────────────── ONLINE PLAY ─────────────────────────
// The server runs every online race. It simulates each tick a fixed delay (D ticks, ~150 ms) after the tick's
// moment on the shared clock, so a tap stamped with the tick you were seeing still arrives in time and is applied
// on exactly that tick (bounded latency compensation: actions later than D are applied on the next tick).
// This browser replays the server's confirmed stream with the same deterministic simulation, and draws your own
// sphere AHEAD of it: confirmed state + your unconfirmed steps, re-predicted every frame. Everyone else is shown
// as confirmed. Results always come from the confirmed simulation.
const NET = (() => {
  const N = {
    ws: null, status: 'off', token: store.get('er_token'), name: store.get('er_name') || '', rtt: 0, off: 0, offBest: 1e9, F: null,
    lobby: null, end: null, lastP: -1, backoff: 0, wanted: false, queueSize: 4, err: '', at: 0, D: 9, acts: [], confirmed: 0, shown: false,
  };
  const enabled = () => typeof ONLINE !== 'undefined' && ONLINE && location.protocol.startsWith('http');
  const send = (o) => { if (N.ws && N.ws.readyState === 1) N.ws.send(JSON.stringify(o)); };
  const serverNow = () => Date.now() + N.off;
  function connect() {
    if (N.ws && N.ws.readyState <= 1) return;
    N.status = 'connecting';
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    N.ws = ws;
    ws.onopen = () => { N.backoff = 0; send({ t: 'hello', name: N.name, token: N.token, skin: mySkin() }); ping(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } try { on(m); } catch (err) { console.error('net', m.t, err); } };
    ws.onclose = () => { if (N.ws !== ws) return; N.status = 'off'; if (N.wanted) setTimeout(connect, Math.min(5000, 300 * 2 ** N.backoff++)); };
  }
  function ping() { send({ t: 'ping', c: performance.now(), w: Date.now() }); }
  setInterval(() => { if (N.ws && N.ws.readyState === 1) ping(); }, 1000);
  const waiters = [];
  function on(m) {
    for (let k = waiters.length - 1; k >= 0; k--) if (waiters[k].types.includes(m.t)) waiters.splice(k, 1)[0].res(m);
    if (m.nonce) N.nonce = m.nonce;
    switch (m.t) {
      case 'cashLobby': return CASH.onLobby(m);
      case 'authOk': case 'authFail': return;
      case 'welcome':
        N.token = m.token; store.set('er_token', m.token); N.status = 'online'; if (m.D) N.D = m.D;
        if (N.queueing) { send({ t: 'queue', mode: 'free', size: N.queueSize }); N.queueing = false; }
        return;
      case 'pong': {
        const rtt = performance.now() - m.c; N.rtt = N.rtt ? N.rtt * 0.8 + rtt * 0.2 : rtt;
        // clock offset from the fastest recent round trips (least queuing); decays so it can follow drift
        const off = m.s - (m.w + rtt / 2); N.offBest *= 1.02;
        if (rtt <= N.offBest || !N.offSet) { N.offBest = Math.max(rtt, 1); N.off = N.offSet ? N.off * 0.5 + off * 0.5 : off; N.offSet = true; }
        return;
      }
      case 'error':
        if (game.screen === 'cashSetup' || game.screen === 'cashLobby') { CASH.state.err = m.msg; CASH.state.busy = ''; CASH.refresh(); return; }
        N.err = m.msg; if (game.screen === 'onlineSetup') showOverlay(setupCard()); return;
      case 'lobby': N.lobby = m; game.screen = 'onlineLobby'; N.lobbyAt = performance.now(); showOverlay(lobbyCardOnline()); return;
      case 'left': return;
      case 'match': return startOnline(m);
      case 'round': return round(m);
      case 'intro': if (game.phase === 'intro') game.introUntil = performance.now() + m.ms; return;
      case 'count': return countdown(m);
      case 'tk': if (N.F && N.F.R) { N.F.addFrames(m.k, m.f); applyFrames(); } return;
      case 'h': if (N.F) N.F.checkpoint(m.k, m.h); return;
      case 'end': if (N.F) { N.F.ended(m); applyFrames(); } N.end = m; return;
      case 'presence': { const p = game.players.find((x) => x.i === m.i); if (p && m.i !== game.me) callout('', '#fff'); return; }
      case 'sync': return resync(m);
      case 'closed': if (m.reason !== 'finished' && game.mode === 'online') { N.wanted = false; N.F = null; game.mode = 'attract'; goHome(); } return;
    }
  }
  function startOnline(m) {
    if (m.mode === 'cash') CASH.onMatch(m); else CASH.state.match = null;
    game.mode = 'online'; game.screen = 'match'; game.size = m.size; game.me = m.you;
    game.players = m.seats.map((s) => ({ i: s.i, name: s.i === m.you ? 'You' : s.name, human: s.i === m.you, bot: s.bot }));
    N.F = createFollower({ createSim, me: m.you, onDesync: (why) => { console.warn('desync', why); send({ t: 'resync' }); } });
    N.acts = []; N.confirmed = 0; N.end = null; N.shown = false;
  }
  const withNames = (m) => ({ ...m, players: m.players.map((p) => ({ ...p, name: p.i === game.me ? 'You' : p.name })) });
  function round(m) {
    if (!N.F) return;
    N.end = null; N.shown = false; N.over = false; N.acts = []; N.confirmed = 0; N.stripSeen = new Set();
    const R = N.F.round(withNames(m));
    game.R = R; game.key = m.key; game.outSeen = new Set(); game.flipTick = 0;
    WORLD.setRace(R, game.me, m.key);
    game.phase = 'intro'; game.introUntil = performance.now() + m.introMs;
    document.body.classList.add('playing'); musicStop(); $('#hud').hidden = false;
    showOverlay(introCard(m.introMs / 1000, true)); renderHud(true);
  }
  function countdown(m) {
    N.at = m.at; if (m.D) N.D = m.D;
    showOverlay(''); game.phase = 'countdown'; game.lastCount = 0; INPUT.acts.length = 0; INPUT.enabled = true;
    musicRace((N.at - serverNow()) / 1000);
  }
  function resync(m) {
    if (!N.F || N.F.me !== m.match.you) startOnline(m.match);
    if (m.lobby) { N.lobby = m.lobby; game.screen = 'onlineLobby'; showOverlay(lobbyCardOnline()); return; }
    const r = N.F.sync({ ...m, round: m.round && withNames(m.round) });
    if (!r) return;
    game.R = r; game.key = m.round.key; WORLD.setRace(r, game.me, m.round.key);
    N.at = m.at || N.at; N.confirmed = countMine(); N.acts = N.acts.slice(0, N.confirmed);
    if (m.state === 'intro') { game.phase = 'intro'; game.introUntil = performance.now() + m.msLeft; showOverlay(introCard(m.msLeft / 1000, true)); }
    else { showOverlay(''); $('#hud').hidden = false; document.body.classList.add('playing'); game.phase = m.state === 'count' ? 'countdown' : m.state === 'play' ? 'play' : 'done'; INPUT.enabled = game.phase !== 'done'; if (m.end) N.end = m.end; }
  }
  // how many of my actions the confirmed stream has applied so far (each action is one bit on one tick)
  const bitsOf = (p) => (p & 1) + ((p >> 1) & 1) + ((p >> 2) & 1);
  function countMine() { if (!N.F || !N.F.R) return 0; const j = N.F.R.active.findIndex((b) => b.i === game.me); if (j < 0) return 0; let c = 0; for (let k = 0; k < N.F.next; k++) c += bitsOf(N.F.frames[k][0][j]); return c; }
  // apply every frame that has arrived: the confirmed world is never held back for smoothness (we draw ahead of it)
  function applyFrames() {
    const F = N.F, R = F.R; if (!R) return;
    const j = R.active.findIndex((b) => b.i === game.me);
    while (F.next < F.frames.length && !F.desync) {
      const row = F.frames[F.next][0];
      if (j >= 0) N.confirmed += bitsOf(row[j]);
      stepWithFx(() => F.step(1));
      if (R.winner) break;
    }
  }
  // ── prediction of my own sphere from the confirmed state + my unconfirmed steps (items are left to the server)
  const P = { b: null };
  function predictMe(R, tickNow) {
    const me = R.spheres.find((b) => b.i === game.me); if (!me || !R.active.includes(me)) return null;
    const b = { seg: me.seg, from: me.from, cl: me.cl, stepT: me.stepT, dir: me.dir, q: me.q.slice(), taps: me.taps, alive: me.alive, deathTick: me.deathTick, shield: me.shield,
      immuneUntil: me.immuneUntil, s: me.s, v: me.v, fxKind: me.fxKind, fxTick: me.fxTick, strips: me.strips.slice(), gone: me.gone, slowUntil: me.slowUntil, empUntil: me.empUntil,
      empStart: me.empStart, etherUntil: me.etherUntil };
    if (!b.alive || R.winner) return b;
    const pend = N.acts.slice(N.confirmed);
    let pi = 0;
    for (let k = R.tick + 1; k <= Math.min(tickNow, RACE_TICKS); k++) {
      let used = 0;
      while (pi < pend.length && Math.max(pend[pi][0], R.tick + 1) <= k) { const bit = pend[pi][1]; if (bit === IN_USE ? used & IN_USE : used & (IN_L | IN_R)) break; used |= bit; pi++; }
      if (k > b.empUntil) { if (used & IN_L) SIM0.pushStep(b, -1); if (used & IN_R) SIM0.pushStep(b, 1); }
      SIM0.moveSphere(b, R.course, k);
      if (k > b.empUntil && k > b.etherUntil && k > b.immuneUntil && SIM0.spikeHit(R.course, b)) {
        if (b.shield) { b.shield = 0; b.immuneUntil = k + 36; } else { b.alive = false; b.deathTick = k; break; }
      }
    }
    return b;
  }
  function lowerBlock(H, s) { let lo = 0, hi = H.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H[m].s0 < s) lo = m + 1; else hi = m; } return lo; }
  // ── every animation frame while online
  function frame(now) {
    const R = game.R;
    if (game.phase === 'intro') {
      const left = Math.max(0, (game.introUntil - now) / 1000), el = $('#introLeft'), bar = $('#introFill');
      if (el) el.textContent = Math.ceil(left); if (bar) bar.style.width = clamp(left / 8, 0, 1) * 100 + '%';
      return;
    }
    if (!R) return;
    // actions: stamp each with the tick it was made on (the world tick this player was looking at) and send it
    const t = (serverNow() - N.at) / 1000;
    while (INPUT.acts.length) {
      const [tp, a] = INPUT.acts.shift(), k = Math.floor((Date.now() + N.off - (performance.now() - tp) - N.at) / TICK_MS) + 1;
      if (k < 1 || game.phase === 'done') continue;
      const me = R.spheres.find((b) => b.i === game.me); if (!me || !me.alive || !R.active.includes(me)) continue;
      N.acts.push([k, a === 'L' ? IN_L : a === 'R' ? IN_R : IN_USE]); send({ t: 'in', k, a });
    }
    if (game.phase === 'countdown') {
      const n = Math.ceil(-t);
      if (n !== game.lastCount && n > 0 && n <= 3) { game.lastCount = n; SFX.count(n); callout(String(n), ['#B6FF3B', '#22E6FF', '#FF3DCB'][n - 1] || '#fff'); }
      if (t >= 0) { game.phase = 'play'; SFX.count(0); callout('GO', '#22E6FF'); }
    }
    if (game.phase === 'play') {
      const tickNow = Math.floor(t * 60);
      const pb = predictMe(R, tickNow);
      if (pb && P.b && pb.taps !== P.b.taps && pb.alive) SFX.lane(pb.q.length ? pb.q[pb.q.length - 1] > 0 : pb.dir > 0);
      if (pb && P.b && pb.fxTick !== P.b.fxTick && pb.alive) stripFx(pb.fxKind);
      if (pb && P.b && P.b.alive && !pb.alive) myCrash();
      P.b = pb;
      if (R.winner && !N.over) { N.over = true; roundOver(); }
    }
    if (game.phase === 'done' && !N.shown && performance.now() - game.doneAt > 1900) { N.shown = true; musicMenu(); showOverlay(resultCard()); }
  }
  function roundOver() {
    const R = game.R, w = R.winner;
    game.phase = 'done'; game.doneAt = performance.now(); INPUT.enabled = false;
    callout(w.i === game.me ? 'YOU WIN' : `${w.name.toUpperCase()} WINS`, w.color);
    if (w.i === game.me) SFX.win(); else SFX.lose();
    renderHud(true);
  }
  function view(now) {
    const R = game.R; if (!R) return null;
    const t = game.phase === 'intro' ? 0 : (serverNow() - N.at) / 1000;
    const tDraw = game.phase === 'done' ? R.t : Math.min(t, RACE_SECONDS);
    const tickNow = Math.floor(Math.max(0, tDraw) * 60), frac = Math.max(0, tDraw) * 60 - tickNow, pre = Math.min(0, tDraw) * 20;
    // rivals are confirmed a few ticks behind "now": carry them forward at their current speed
    const ahead = game.phase === 'play' ? Math.max(0, tickNow - R.tick + frac) * DT : 0;
    const sOf = (b) => (b.alive ? b.s + b.v * ahead : b.s) + pre;
    const pb = game.phase === 'play' ? P.b : null;
    const me = R.spheres.find((b) => b.i === game.me);
    const meDead = pb ? !pb.alive : me && !me.alive;
    let follow = game.me;
    if (!me || !R.active.includes(me) || (meDead && t - (pb ? pb.deathTick : me.deathTick) / 60 > 0.9)) follow = (R.winner || R.active.filter((b) => b.alive && b.i !== game.me).sort((a, b) => b.orbs - a.orbs)[0] || R.active[0]).i;
    const spheres = R.active.map((b) => {
        if (b.i === game.me && pb) return { i: b.i, x: sphereX(pb, frac), s: (pb.alive ? pb.s + pb.v * DT * frac : pb.s) + pre, v: pb.alive ? pb.v : 0, alive: pb.alive, winner: R.winner === b, ...powersOf(b, R) };
        return { i: b.i, x: sphereX(b, 0), s: sOf(b), v: b.alive ? b.v : 0, alive: b.alive, winner: R.winner === b, ...powersOf(b, R) };
      });
    return { t: tDraw, phase: game.phase, follow, spheres, tick: R.tick + (game.phase === 'play' ? Math.max(0, tickNow - R.tick + frac) : 0), s: (spheres.find((x) => x.i === follow) || spheres[0]).s };
  }
  // ── screens
  function setupCard() {
    return `<div class="card lobby">
      <h2>Race free online</h2>
      <div class="cols">
        <div style="display:grid;gap:14px;align-content:start">
          <label style="display:grid;gap:6px"><span class="label">Your name</span><input id="netName" class="field" maxlength="14" autocomplete="nickname" placeholder="Racer" value="${esc(N.name)}"></label>
          <div style="display:grid;gap:6px"><span class="label">Racers</span><div class="seg">${SIZES.map((s) => `<button class="${s === N.queueSize ? 'sel' : ''}" data-netsize="${s}">${s}</button>`).join('')}</div></div>
          ${N.err ? `<p style="color:var(--hot)">${esc(N.err)}</p>` : ''}
        </div>
        <div style="display:grid;gap:12px;align-content:start">
          <p>Real players first. Empty seats get computer players after 12 seconds.</p>
          <button class="btn primary big" id="netFind">Find a race</button>
          <button class="btn ghost small" id="back" style="justify-self:start">Back</button>
        </div>
      </div>
    </div>`;
  }
  function lobbyCardOnline() {
    const L = N.lobby; if (!L) return '';
    const left = L.fillInMs == null ? null : Math.max(0, Math.ceil((L.fillInMs - (performance.now() - N.lobbyAt)) / 1000));
    const seats = Array.from({ length: L.size }, (_, i) => { const s = L.seats[i]; return s ? `<div class="seat on${s.i === L.you ? ' you' : ''}" style="--c:${ROSTER[s.i][1]}"><div class="orb"></div><span class="nm">${esc(s.i === L.you ? 'You' : s.name)}</span></div>` : `<div class="seat"><div class="ghost">?</div><span class="nm" style="color:var(--dim)">Open</span></div>`; }).join('');
    return `<div class="card lobby">
      <h2>Finding racers</h2>
      <div class="seats">${seats}</div>
      <div class="row"><button class="btn ghost" id="netLeave">Leave</button><span class="label" id="netFill">${L.seats.length} of ${L.size} in${left != null ? ` · computer players fill the rest in ${left} s` : ''}</span></div>
    </div>`;
  }
  setInterval(() => { if (game.screen === 'onlineLobby' && N.lobby) { const el = document.getElementById('netFill'), L = N.lobby; if (el) { const left = L.fillInMs == null ? null : Math.max(0, Math.ceil((L.fillInMs - (performance.now() - N.lobbyAt)) / 1000)); el.textContent = `${L.seats.length} of ${L.size} in${left != null ? ` · computer players fill the rest in ${left} s` : ''}`; } } }, 250);
  $('#ov').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'goOnline') { N.err = ''; game.screen = 'onlineSetup'; showOverlay(setupCard()); setTimeout(() => $('#netName')?.focus(), 50); }
    else if (t.dataset.netsize) { N.queueSize = +t.dataset.netsize; showOverlay(setupCard()); }
    else if (t.id === 'netFind') {
      N.name = ($('#netName')?.value || '').trim().slice(0, 14) || 'Racer'; store.set('er_name', N.name);
      N.wanted = true; N.err = '';
      if (N.ws && N.ws.readyState === 1) { send({ t: 'hello', name: N.name, token: N.token, skin: mySkin() }); send({ t: 'queue', mode: 'free', size: N.queueSize }); }
      else { N.queueing = true; connect(); }
      t.disabled = true; t.textContent = 'Connecting…';
    }
    else if (t.id === 'netLeave' || (t.id === 'home' && game.mode === 'online')) { send({ t: 'leave' }); N.wanted = false; N.F = null; game.R = null; game.mode = 'attract'; goHome(); }
    else if (t.id === 'ready' && game.mode === 'online') { send({ t: 'ready' }); t.disabled = true; t.textContent = 'Waiting for the others'; }
    else if (t.id === 'again' && game.mode === 'online') {
      send({ t: 'leave' }); N.F = null; game.R = null; game.mode = 'attract'; startAttract(); document.body.classList.remove('playing'); $('#hud').hidden = true;
      if (CASH.isCashMatch()) CASH.openSetup(); else { game.screen = 'onlineSetup'; showOverlay(setupCard()); }
    }
  });
  if (enabled() && N.token) { N.wanted = true; connect(); } // reload mid-race? pick the seat back up
  function connectAsync() {
    return new Promise((res, rej) => {
      if (N.ws && N.ws.readyState === 1 && N.status === 'online') return res();
      N.wanted = true; connect();
      const t0 = Date.now(), iv = setInterval(() => {
        if (N.status === 'online' && N.ws && N.ws.readyState === 1) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 15000) { clearInterval(iv); rej(new Error('Could not reach the game server.')); }
      }, 100);
    });
  }
  function request(msg, types) {
    return new Promise((res, rej) => { const w = { types, res }; waiters.push(w); send(msg); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('The server did not answer.')); } }, 20000); });
  }
  // connection quality in the corner during a race
  setInterval(() => { const el = $('#net'); if (!el) return; const on = game.mode === 'online' && game.screen === 'match'; el.hidden = !on; if (on) el.textContent = N.ws && N.ws.readyState === 1 ? `${Math.round(N.rtt)} ms` : 'Reconnecting…'; }, 500);
  return { enabled, frame, view, send, setSkin: (k) => send({ t: 'skin', skin: k }), connectAsync, request, get state() { return N; }, set over(v) { N.over = v; } };
})();
