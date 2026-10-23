// ───────────────────────── GAME FLOW: menus, practice races, the HUD ─────────────────────────
const TICK_MS = 1000 / 60;
const game = {
  screen: 'home', mode: 'attract', phase: 'idle', R: null, me: -1, t0: 0, key: 'void', players: [], size: 4,
  stake: parseEth('0.01'), bots: 'normal', auto: typeof location !== 'undefined' && location.hash.includes('autopilot'), /* test hook: a bot drives your seat */ themeDeck: [], outSeen: new Set(), lastOrbs: 0, flipTick: 0, deposited: false,
};
const THEME_KEYS = Object.keys(SIM0.ARENAS);
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
function pickTheme() {
  if (!game.themeDeck.length) game.themeDeck = [...THEME_KEYS].sort(() => Math.random() - 0.5);
  return game.themeDeck.pop();
}
/** position of a sphere round its pipe (float; a step glides over 4 ticks), `frac` = fraction of the next tick elapsed */
function sphereX(b, frac = 0) {
  if (!(b.stepT > 0)) return b.seg;
  const p = clamp((STEP_TICKS - b.stepT + frac) / STEP_TICKS, 0, 1);
  return b.from + (b.dir || 0) * ease(p);
}
/** this tick's packed input from the queued key/pad/touch actions: at most one step and one use per tick, in order */
function takeInput() {
  let bits = 0;
  while (INPUT.acts.length) {
    const a = INPUT.acts[0][1], bit = a === 'L' ? IN_L : a === 'R' ? IN_R : IN_USE;
    if (bit === IN_USE ? bits & IN_USE : bits & (IN_L | IN_R)) break;
    bits |= bit; INPUT.acts.shift();
  }
  return bits;
}
const ITEM_HELP = {
  cannon: 'Space / ✕: blast the spikes ahead of you', burst: 'Space / ✕: slow everyone it reaches for 2 s', emp: 'Space / ✕: knock out every ball ahead for 1.5 s',
  ether: 'Space / ✕: top speed, invincible for 3 s', shield: 'The next hit passes through you', magnet: 'Pulls in orbs 3 positions either side for 4 s', double: 'Orbs count twice for 6 s',
};
const ITEM_GLYPH = { cannon: '◉', burst: '✸', emp: 'ϟ', ether: '◇', shield: '⬡', magnet: '∪', double: '×2' };

// ───────────────────────── overlays (same flicker-free redraw rules as before) ─────────────────────────
let OV_HTML = '', OV_KEY = '';
function showOverlay(html) {
  const ov = $('#ov'); html = html || '';
  document.body.classList.toggle('home-on', !!html && game.screen !== 'match');
  if (html === OV_HTML && ov.hidden === !html) return;
  const key = html ? game.screen + '|' + ((html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/) || [])[1] || '') : '';
  const same = !!html && !ov.hidden && key === OV_KEY;
  ov.classList.toggle('still', same);
  if (same) { const t = document.createElement('div'); t.innerHTML = html; morphKids(ov, t); } else ov.innerHTML = html;
  ov.hidden = !html; OV_HTML = html; OV_KEY = key;
}
function morphKids(el, to) {
  const a = [...el.childNodes], b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    const x = a[i], y = b[i];
    if (!x) { el.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.id || '') !== (y.id || '')) { el.replaceChild(y, x); continue; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if ((x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') && x !== document.activeElement && x.value !== (y.getAttribute('value') || '')) x.value = y.getAttribute('value') || '';
    if (x.tagName === 'BUTTON' || x.tagName === 'INPUT') x.disabled = y.hasAttribute('disabled');
    morphKids(x, y);
  }
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}
const chip = (p, you) => `<span class="chip${you ? ' you' : ''}" style="--c:${ROSTER[p.i][1]}"><i></i>${esc(p.name)}</span>`;
let calloutT = 0;
function callout(big, color = '#fff', sub = '') {
  const el = $('#callout'); el.style.setProperty('--c', color);
  el.innerHTML = big ? `<b>${esc(big)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}` : '';
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(calloutT); if (big) calloutT = setTimeout(() => { el.innerHTML = ''; }, 1500);
}

// ───────────────────────── SCREENS ─────────────────────────
function homeCard() {
  const cash = CASH.enabled() || CASH.pending();
  return `<div class="card home">
    <h1 class="wordmark" aria-label="Ether Road"><span>ETHER</span><span>ROAD</span></h1>
    <p class="pitch">Roll down the inside of a neon pipe. Slide left and right round the wall to dodge the spikes, grab a weapon, and outlast everyone. Last sphere alive takes 90% of the pot.</p>
    <div class="row">
      ${cash ? `<button class="btn primary big" id="goCashReal">Race for ${CASH.unit()}</button><button class="btn big" id="goOnline">Race free online</button>`
        : NET.enabled() ? '<button class="btn primary big" id="goOnline">Race online</button>' : ''}
      <button class="btn big${cash || NET.enabled() ? ' ghost' : ' primary'}" id="goPractice">Practice</button>
    </div>
    <div class="row"><button class="btn ghost skinbtn" id="goSkins"><img src="${SKINLAB.thumbnails(new THREE.Color('#22E6FF'))[mySkin()]}" alt="">Sphere: ${esc(SKINS[mySkin()].name)}</button>${LAB.unlocked() ? '<button class="btn ghost" id="goLab">Test lab</button>' : ''}</div>
    <div class="facts">
      <div><b>2–4</b><span>racers, one pipe each, braided together</span></div>
      <div><b>60 s</b><span>at most. The final collapse settles it</span></div>
      <div><b>90%</b><span>of the pot to the last sphere alive</span></div>
    </div>
    <p class="ctl"><span class="no-pad">${isTouch ? 'Hold the left or right side of the screen to slide round the pipe. The USE button fires your item.' : '<kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> slide round the pipe (hold to keep going). <kbd>Space</kbd> fires your cannon or uses whatever you are holding.'}</span><span class="pad-only">Controller ready: d-pad, left stick or L1/R1 slide round the pipe; <kbd>✕</kbd> / <kbd>A</kbd> fires or uses your item. In menus <kbd>✕</kbd> picks, <kbd>○</kbd> goes back.</span></p>
    <p class="fine" style="padding:0">${CASH.enabled() ? (CASH.state.cfg.chainId === 4663 ? 'Real ETH on Robinhood Chain. Only stake what you can afford to lose.' : 'Robinhood Chain testnet: stakes are free test ETH from the Robinhood faucet. No real money.') : NET.enabled() ? 'Free online races need no wallet. Paid races open once the server finishes its setup.' : 'Practice runs entirely in this browser.'}</p>
  </div>`;
}
function skinsCard() {
  const th = SKINLAB.thumbnails(new THREE.Color('#22E6FF')), cur = mySkin();
  return `<div class="card lobby skins">
    <h2>Your sphere</h2>
    <p>Every sphere handles exactly the same. Your racer colour still marks your pipe and name.</p>
    <div class="skingrid">${SKINS.map((k) => `<button class="skin${k.id === cur ? ' sel' : ''}" data-skin="${k.id}" title="${esc(k.note)}"><img src="${th[k.id]}" alt=""><span>${esc(k.name)}</span></button>`).join('')}</div>
    <div class="row"><button class="btn primary" id="skinsDone">Done</button><span class="label">${esc(SKINS[cur].name)}: ${esc(SKINS[cur].note)}</span></div>
  </div>`;
}
function practiceCard() {
  return `<div class="card lobby">
    <h2>Practice</h2>
    <p>Race computer players on a fresh course. Nothing is at stake.</p>
    <div style="display:grid;gap:6px"><span class="label">Racers</span><div class="seg">${SIZES.map((s) => `<button class="${s === game.size ? 'sel' : ''}" data-psize="${s}">${s}<small>${s === 2 ? 'you + 1' : `you + ${s - 1}`}</small></button>`).join('')}</div></div>
    <div style="display:grid;gap:6px"><span class="label">Computer players</span><div class="seg">${[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Sharp'], ['flawless', 'Flawless']].map(([k, l]) => `<button class="${k === game.bots ? 'sel' : ''}" data-pbots="${k}">${l}</button>`).join('')}</div></div>
    <div class="row"><button class="btn primary big" id="practiceGo">Start</button><button class="btn ghost" id="back">Back</button></div>
  </div>`;
}
const HOWTO = [
  'Your ball rolls forward on its own. Slide left / right round the pipe wall (←/→, A/D, d-pad). Hold to keep sliding.',
  'Red spikes are the only danger. Touch them and you are out. Find the gap.',
  'Pickups come in small groups: roll over the one you want, the others vanish. Space / ✕ uses it: cannon (2 shots, blows up spikes), burst (slows rivals), EMP (knocks out balls ahead), ether boost (fast + invincible 3 s).',
  'Optional strips: cyan boost (faster), amber slow (more time). Still alive at 60 s? Furthest along wins.'];
function introCard(seconds, online) {
  const A = SIM0.ARENAS[game.key] || SIM0.ARENAS.void;
  return `<div class="card intro">
    <span class="label">${online ? 'Race starts soon' : 'Practice race'} · ${game.players.length} racers · 60 s cap</span>
    <h1 class="theme">${esc(A.name)}</h1>
    <ul class="howto">${HOWTO.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="lineup">${game.players.map((p) => chip(p, p.i === game.me)).join('')}</div>
    <div class="row"><button class="btn primary" id="ready">${online ? 'Ready' : 'Go'}</button><span class="label">Starts in <span id="introLeft">${Math.ceil(seconds)}</span> s</span></div>
    <div class="bar"><div id="introFill"></div></div>
  </div>`;
}
function resultCard() {
  const R = game.R, w = R.winner, mine = w && w.i === game.me, places = [...R.active].sort((a, b) => a.place - b.place);
  const why = R.decidedBy === 'distance' ? 'More than one racer reached the cap: furthest along wins.' : R.decidedBy === 'orbs' ? 'Decided by orbs at the cap.' : R.decidedBy === 'taps' ? 'Same orbs at the cap: fewer steps won.' : R.decidedBy === 'draw' ? 'Dead level at the cap: settled by the draw fixed before the start.' : R.decidedBy === 'time' ? 'Survived to the cap.' : '';
  const cashOnline = game.mode === 'online' && CASH.isCashMatch();
  const life = (b) => (b === w ? (b.alive ? `${R.t.toFixed(1)} s, still rolling` : `${(b.deathTick / 60).toFixed(1)} s`) : b.alive ? `${R.t.toFixed(1)} s` : `out at ${(b.deathTick / 60).toFixed(1)} s`);
  return `<div class="card result">
    <h1 class="big" style="color:${w.color}">${mine ? 'You won' : `${esc(w.name)} wins`}</h1>
    ${why ? `<p>${why}</p>` : ''}
    <div class="places">${places.map((b) => `<div class="place${b === w ? ' first' : ''}" style="--c:${b.color}"><span class="n">${b.place}</span><i></i><b>${esc(b.i === game.me ? 'You' : b.name)}</b><span class="st">${life(b)} · ${Math.round(b.s)} m · ${b.orbs} orb${b.orbs === 1 ? '' : 's'}</span></div>`).join('')}</div>
    ${cashOnline ? CASH.championExtra(w) : game.mode === 'online' ? '<p>Free race: nothing was at stake.</p>' : ''}
    <div class="row"><button class="btn primary big" id="again">${game.mode === 'online' ? (cashOnline ? 'Race again' : 'Find another race') : 'Race again'}</button><button class="btn ghost big" id="home">Home</button></div>
  </div>`;
}

$('#ov').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  SFX.ui();
  if (game.mode === 'online' && ['again', 'home', 'ready'].includes(t.id)) return; // handled by NET
  if (t.id === 'goPractice') { game.screen = 'practice'; showOverlay(practiceCard()); }
  else if (t.id === 'goSkins') { game.screen = 'skins'; showOverlay(skinsCard()); }
  else if (t.dataset.skin) { store.set('er_skin', t.dataset.skin); NET.setSkin && NET.setSkin(+t.dataset.skin); showOverlay(skinsCard()); }
  else if (t.id === 'skinsDone') { game.screen = 'home'; showOverlay(homeCard()); }
  else if (t.dataset.psize) { game.size = +t.dataset.psize; showOverlay(practiceCard()); }
  else if (t.dataset.pbots) { game.bots = t.dataset.pbots; showOverlay(practiceCard()); }
  else if (t.id === 'practiceGo' || (t.id === 'again' && game.mode === 'practice')) startPractice();
  else if (t.id === 'ready' && game.mode === 'practice') beginCountdown();
  else if (t.id === 'back' || t.id === 'home') goHome();
});
$('#faucet').addEventListener('click', () => { if (CASH.state.cfg && CASH.state.privy) return; setWallet(wallet + parseEth('0.05')); SFX.orb(); });

// ───────────────────────── local races: practice, the lab and the attract loop behind the home screen ─────────────────────────
// game.clock = race milliseconds (negative during the countdown); advanced every frame × game.speed (lab only).
const randomSkin = () => Math.floor(Math.random() * SKIN_COUNT);
const mySkin = () => { const v = +store.get('er_skin'); return v >= 0 && v < SKIN_COUNT ? v : 0; };
function localRace(players, me, mode, o = {}) {
  const seed = o.seed != null ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  game.key = o.key || pickTheme(); game.players = players; game.me = me; game.mode = mode; game.outSeen = new Set(); game.lastOrbs = 0; game.seed = seed;
  game.R = createSim({ seed }).createRound({ key: game.key, seed, players, active: players.map((p) => p.i), botSalt: String(seed), debug: o.debug });
  WORLD.setRace(game.R, me, game.key, o.theme);
}
function startAttract() {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  localRace([0, 1, 2, 3].map((i) => ({ i, name: names[i], skill: 0.6 + Math.random() * 0.35, skin: randomSkin() })), -1, 'attract');
  game.phase = 'play'; game.clock = 2500; game.speed = 1; game.lab = null; INPUT.enabled = false;
}
function practicePlayers(n, lvl) {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  return Array.from({ length: n }, (_, i) => (i === 0 ? { i, name: 'You', human: true, skin: mySkin() } : { i, name: names[i], skill: lvl === 'flawless' ? 1 : lvl[0] + Math.random() * (lvl[1] - lvl[0]), skin: randomSkin(), ...(lvl === 'flawless' ? { ai: { react: 0, sigma: 0, fool: 0, lapse: 0, greed: 0.8, aim: 0 } } : {}) }));
}
const BOT_LEVELS = { easy: [0.5, 0.65], normal: [0.66, 0.8], hard: [0.84, 0.94], flawless: 'flawless' };
function startPractice() {
  localRace(practicePlayers(game.size, BOT_LEVELS[game.bots]), 0, 'practice');
  game.lab = null; game.speed = 1;
  game.screen = 'match'; game.phase = 'intro'; game.introUntil = performance.now() + 6000;
  document.body.classList.add('playing'); musicStop();
  showOverlay(introCard(6, false)); $('#hud').hidden = false; renderHud(true);
}
function beginCountdown(ms = 3000) {
  if (game.phase !== 'intro') return;
  showOverlay(''); game.phase = 'countdown'; game.clock = -ms; INPUT.acts.length = 0; INPUT.enabled = true;
  musicRace(ms / 1000); game.lastCount = 0;
}
function goHome() {
  document.body.classList.remove('playing'); game.screen = 'home'; $('#hud').hidden = true; callout(''); game.lab = null; LAB.hud(false);
  INPUT.enabled = false; musicMenu(); startAttract(); showOverlay(homeCard());
}

// ───────────────────────── per-frame ─────────────────────────
function stepLocal(now, dt) {
  const R = game.R;
  if (game.phase === 'intro') {
    const left = Math.max(0, (game.introUntil - now) / 1000), el = $('#introLeft'), bar = $('#introFill');
    if (el) el.textContent = Math.ceil(left); if (bar) bar.style.width = (left / 6) * 100 + '%';
    if (left <= 0) beginCountdown();
    return;
  }
  if (game.phase === 'countdown') {
    game.clock += dt * 1000;
    const n = Math.ceil(-game.clock / 1000);
    if (n !== game.lastCount && n > 0) { game.lastCount = n; SFX.count(n); callout(String(n), ['#B6FF3B', '#22E6FF', '#FF3DCB'][n - 1] || '#fff'); }
    if (game.clock >= 0) { game.phase = 'play'; SFX.count(0); callout('GO', '#22E6FF'); }
    else { INPUT.acts.length = 0; return; } // presses before GO don't count
  }
  if (game.phase !== 'play') return;
  if (game.phase === 'play') game.clock += dt * 1000 * (game.speed || 1);
  const due = Math.min(RACE_TICKS, Math.floor(game.clock / TICK_MS));
  let n = 0;
  while (!R.winner && R.tick < due && n++ < 240) {
    const inputs = {};
    if (game.me >= 0 && !game.auto && !(game.lab && game.lab.auto)) inputs[game.me] = takeInput();
    stepWithFx(() => R.step(inputs));
  }
  if (R.winner && game.phase === 'play') raceOver();
}
// one tick plus everything the player should hear and see because of it
function stepWithFx(step) {
  const R = game.R, me = R.spheres.find((b) => b.i === game.me), before = me ? { taps: me.taps, orbs: me.orbs, alive: me.alive, fx: me.fxTick } : null;
  const prevT = R.t, ev0 = R.events.length;
  step();
  if (me && before && game.mode !== 'online') { // online: your own sounds come from the prediction (95_net)
    if (me.taps !== before.taps) SFX.lane(me.q.length ? me.q[me.q.length - 1] > 0 : me.dir > 0);
    if (me.orbs > before.orbs) SFX.orb();
    if (me.fxTick !== before.fx) stripFx(me.fxKind);
    if (before.alive && !me.alive) myCrash();
  }
  if (game.mode !== 'attract') for (let k = ev0; k < R.events.length; k++) itemEvent(R.events[k], R);
  for (const b of R.active) if (!b.alive && !game.outSeen.has(b.i)) {
    game.outSeen.add(b.i);
    if (b.i !== game.me && game.mode !== 'attract') { SFX.crash(false); }
    const left = R.active.filter((x) => x.alive).length;
    if (game.mode !== 'attract' && !R.winner) callout(b.i === game.me ? 'OUT' : `${b.name} out`, b.color, left === 2 && R.active.length > 2 ? 'Final two' : b.i === game.me ? 'Spectating the rest of the race' : '');
  }
  if (game.mode !== 'attract' && prevT < COLLAPSE_AT && R.t >= COLLAPSE_AT && !R.winner) callout('FINAL COLLAPSE', '#FF2E5B', 'The pipe tightens until someone breaks');
  if (game.mode !== 'attract' && prevT < RACE_SECONDS - 10 && R.t >= RACE_SECONDS - 10 && !R.winner) callout('10 SECONDS', '#FF9F1C');
}
function myCrash() { SFX.crash(true); padRumble(1, 380); $('#flash').classList.add('on'); setTimeout(() => $('#flash').classList.remove('on'), 60); WORLD.shake(1.2); }
/** what you see and hear for an item event (pickups, uses, hits on you, blocks) */
function itemEvent(e, R) {
  const L = ITEM_LOOK[e.item] || {}, mine = e.i === game.me, byMe = e.by === game.me, who = (i) => (R.spheres.find((b) => b.i === i) || {}).name || '';
  if (e.kind === 'pickup' && mine) { SFX.power(); callout(L.name.toUpperCase(), L.color, ITEM_HELP[e.item]); padRumble(0.3, 80); }
  else if (e.kind === 'use') {
    if (mine) { SFX.boost(); padRumble(0.5, 140); if (e.item === 'ether') callout('ETHER BOOST', L.color, 'Invincible for 3 s'); }
    else if (e.item === 'emp' || e.item === 'burst') callout(`${who(e.i)}: ${L.name.toUpperCase()}`, L.color, '');
  } else if (e.kind === 'blast' && mine) { SFX.crash(false); padRumble(0.5, 120); WORLD.shake(0.5); }
  else if (e.kind === 'hit' && mine) { SFX.slow(); padRumble(0.8, e.item === 'emp' ? 600 : 300); WORLD.shake(0.8); callout(e.item === 'emp' ? 'EMP HIT' : 'BURST HIT', L.color, e.item === 'emp' ? `${who(e.by)} knocked you off the track` : `${who(e.by)} slowed you for 2 s`); }
  else if (e.kind === 'hit' && byMe) { SFX.near(); callout(`HIT ${who(e.i).toUpperCase()}`, L.color, ''); }
  else if ((e.kind === 'blocked' || e.kind === 'immune') && mine) { SFX.shieldPop(); padRumble(0.6, 160); }
}
function stripFx(kind) {
  if (kind === 'boost') { callout('BOOST', '#22E6FF', 'Faster for 2 s: more distance, less time to react'); SFX.boost(); padRumble(0.4, 220); WORLD.shake(0.5); }
  else if (kind === 'slow') { callout('SLOW', '#FFB347', 'Slower for 2 s: more time to react, less distance'); SFX.slow(); padRumble(0.25, 160); }
}
function raceOver() {
  const R = game.R, w = R.winner;
  game.phase = 'done'; game.doneAt = performance.now(); INPUT.enabled = false;
  if (game.mode === 'attract') { setTimeout(() => { if (game.mode === 'attract' && (game.screen === 'home' || game.screen === 'skins')) startAttract(); }, 2500); return; }
  callout(w.i === game.me ? 'YOU WIN' : `${w.name.toUpperCase()} WINS`, w.color);
  if (w.i === game.me) SFX.win(); else SFX.lose();
  renderHud(true);
  setTimeout(() => { if (game.phase === 'done' && game.R === R) { musicMenu(); showOverlay(game.lab ? LAB.resultCard() : resultCard()); } }, game.lab ? 900 : 1900);
}

// ───────────────────────── HUD ─────────────────────────
let lastHud = '';
function renderHud(force) {
  const R = game.R; if (!R || $('#hud').hidden) return;
  const t = game.phase === 'play' ? Math.min(RACE_SECONDS, R.t) : game.phase === 'done' ? R.t : 0, left = Math.max(0, Math.ceil(RACE_SECONDS - t));
  const ring = $('#hRing'); if (ring) { ring.setAttribute('stroke-dashoffset', String(163.4 * clamp(t / RACE_SECONDS, 0, 1))); ring.setAttribute('stroke', t >= COLLAPSE_AT ? '#FF2E5B' : '#22e6ff'); }
  const key = `${left}|${game.phase}|${R.active.map((b) => `${b.alive ? 1 : 0}${Math.round(b.s / 2)}${b.orbs}${b.shield}${R.tick < b.magnetT ? 1 : 0}${R.tick < b.doubleT ? 1 : 0}${b.item || ''}${b.ammo}`).join('')}`;
  if (!force && key === lastHud) return; lastHud = key;
  $('#hTime').textContent = left; $('#hClock').classList.toggle('low', game.phase === 'play' && left <= 10);
  $('#hPhase').textContent = t >= COLLAPSE_AT ? 'Final collapse' : 'Last sphere alive wins';
  const pw = (b) => `${b.shield ? '<span class="pw sh" title="Shield">⬡</span>' : ''}${R.tick < b.magnetT ? '<span class="pw mg" title="Magnet">∪</span>' : ''}${R.tick < b.doubleT ? '<span class="pw db" title="Double orbs">×2</span>' : ''}${b.item ? `<span class="pw" style="color:${ITEM_LOOK[b.item].color}" title="${ITEM_LOOK[b.item].name}">${ITEM_GLYPH[b.item]}</span>` : ''}`;
  const lead = Math.max(...R.active.map((b) => b.s)), gap = (b) => { const d = Math.round(lead - b.s); return d >= 1 ? `<span class="gap">−${d} m</span>` : ''; };
  $('#hField').innerHTML = R.active.map((b) => `<div class="racer${b.i === game.me ? ' you' : ''}${b.alive ? '' : ' out'}" style="--c:${b.color}"><i></i>${esc(b.i === game.me ? 'You' : b.name)}${pw(b)}${gap(b)}${b.orbs ? ` <em>◆${b.orbs}</em>` : ''}</div>`).join('');
  const me = R.spheres.find((b) => b.i === game.me), banner = $('#banner');
  const showTip = game.mode !== 'attract' && game.phase === 'play' && R.t < 4;
  banner.hidden = !(showTip || (me && !me.alive && game.phase === 'play'));
  banner.textContent = me && !me.alive ? 'You are out. Spectating.' : PAD.used ? 'D-pad / stick to slide · ✕ to use' : isTouch ? 'Hold left / right to slide · USE to fire' : '← → or A D to slide · Space to use';
  // held item
  const box = $('#hItem'), ub = $('#useBtn'), it = me && me.alive ? me.item : null, L = it ? ITEM_LOOK[it] : null;
  box.hidden = !me || game.mode === 'attract'; box.classList.toggle('has', !!it); box.style.setProperty('--c', L ? L.color : '');
  box.innerHTML = it ? `<div class="ic">${ITEM_GLYPH[it]}</div><div><b>${L.name}${it === 'cannon' ? `<span class="ammo">${'<i></i>'.repeat(me.ammo)}</span>` : ''}</b><small>${isTouch ? 'Tap USE' : PAD.used ? 'Press ✕' : 'Press Space'}</small></div>` : '<div class="ic">·</div><div><b>No item</b><small>Roll over a pickup</small></div>';
  ub.classList.toggle('has', !!it); ub.style.setProperty('--c', L ? L.color : ''); ub.hidden = !me || game.mode === 'attract';
}

// power-up state the world draws on a sphere
const powersOf = (b, R) => ({
  shield: b.shield, magnet: R.tick < b.magnetT, double: R.tick < b.doubleT, shieldPop: b.shieldUsedTick > 0 && R.tick - b.shieldUsedTick < 30,
  ether: R.tick <= b.etherUntil, slowed: R.tick <= b.slowUntil, lift: R.tick <= b.empUntil ? clamp((R.tick - b.empStart) / Math.max(1, b.empUntil - b.empStart), 0, 1) : 0, item: b.item,
});
// what the world draws this frame
function viewOf(now) {
  const R = game.R;
  if (!R) return null;
  const tNow = game.phase === 'intro' ? 0 : game.clock / 1000;
  const frac = clamp(game.clock / TICK_MS - R.tick, 0, 1);
  const tDraw = game.phase === 'done' ? R.t : Math.min(tNow, R.t + DT);
  const fr = game.phase === 'play' ? frac : 0, pre = Math.min(0, tDraw) * 20; // before GO everyone waits behind the line
  const sOf = (b) => (b.alive ? b.s + b.v * DT * fr : b.s) + pre;
  const alive = R.active.filter((b) => b.alive);
  let follow = game.me;
  const me = R.spheres.find((b) => b.i === game.me);
  if (!me || (!me.alive && game.clock / 1000 - me.deathTick / 60 > 0.9)) follow = (R.winner && game.phase === 'done' ? R.winner : alive.sort((a, b) => b.orbs - a.orbs)[0] || R.active[0]).i;
  return {
    t: tDraw, s: sOf(R.spheres.find((b) => b.i === follow) || R.active[0]), phase: game.phase, follow, tick: R.tick + fr,
    spheres: R.active.map((b) => ({ i: b.i, x: sphereX(b, frac), s: sOf(b), v: b.alive ? b.v : 0, alive: b.alive, winner: R.winner === b, ...powersOf(b, R) })),
  };
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    pollPad(); pollHolds(now);
    if (game.mode === 'online') NET.frame(now); else if (game.R) stepLocal(now, dt);
    if (game.lab) LAB.frame();
    const v = game.mode === 'online' ? NET.view(now) : viewOf(now);
    WORLD.frame(dt, v || { t: 0, s: 0, spheres: [], phase: 'idle' });
    if (game.mode !== 'attract') renderHud(false);
  } catch (e) { if ((frame.errs = (frame.errs || 0) + 1) < 4) console.error(e); }
  requestAnimationFrame(frame);
}
// ───────────────────────── boot (after three.js has loaded) ─────────────────────────
const SPEAKER = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#edebff"/>${on ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="#edebff" stroke-width="2" fill="none" stroke-linecap="round"/>' : '<path d="M16 9l6 6M22 9l-6 6" stroke="#ff2e5b" stroke-width="2.2" stroke-linecap="round"/>'}</svg>`;
function renderMute() { const m = $('#mute'); m.innerHTML = SPEAKER(!AUDIO.muted); m.setAttribute('aria-label', AUDIO.muted ? 'Sound off' : 'Sound on'); }
$('#mute').addEventListener('click', () => { audioInit(); setMuted(!AUDIO.muted); renderMute(); });
function boot() {
  if (boot.done) return; boot.done = true;
  renderMute(); setWallet(wallet);
  try { WORLD.init($('#gl')); } catch (e) { console.error(e); showOverlay(`<div class="card"><h2>3D graphics are unavailable</h2><p>This browser could not start WebGL. Try a recent Chrome, Safari, Firefox or Edge, with hardware acceleration on.</p></div>`); return; }
  goHome();
  requestAnimationFrame(frame);
}
// the on-screen USE button (touch screens)
if (isTouch) document.body.classList.add('touch');
$('#useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); actNow('U'); });
