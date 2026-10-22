// ───────────────────────── GAME FLOW: menus, practice races, the HUD ─────────────────────────
const TICK_MS = 1000 / 60;
const game = {
  screen: 'home', mode: 'attract', phase: 'idle', R: null, me: -1, t0: 0, key: 'void', players: [], size: 4,
  stake: parseEth('0.01'), bots: 'normal', auto: typeof location !== 'undefined' && location.hash.includes('autopilot'), /* test hook: a bot drives your seat */ themeDeck: [], outSeen: new Set(), lastOrbs: 0, flipTick: 0, deposited: false,
};
const THEME_KEYS = Object.keys(SIM0.ARENAS);
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const laneXof = (l) => (l ? LANE_X : -LANE_X);
function pickTheme() {
  if (!game.themeDeck.length) game.themeDeck = [...THEME_KEYS].sort(() => Math.random() - 0.5);
  return game.themeDeck.pop();
}
/** lateral position of a sphere (smooth lane change), `frac` = fraction of the next tick already elapsed */
function sphereX(b, frac = 0) {
  if (b.swapT <= 0) return laneXof(b.target);
  const p = clamp((SWAP_TICKS - b.swapT + frac) / SWAP_TICKS, 0, 1);
  return lerp(laneXof(b.from), laneXof(b.target), ease(p));
}

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
    <p class="pitch">One tap switches lanes. Survive the road longer than everyone else. Last sphere alive takes 90% of the pot.</p>
    <div class="row">
      ${cash ? `<button class="btn primary big" id="goCashReal">Race for ${CASH.unit()}</button><button class="btn big" id="goOnline">Race free online</button>`
        : NET.enabled() ? '<button class="btn primary big" id="goOnline">Race online</button>' : ''}
      <button class="btn big${cash || NET.enabled() ? ' ghost' : ' primary'}" id="goPractice">Practice</button>
    </div>
    <div class="row"><button class="btn ghost skinbtn" id="goSkins"><img src="${SKINLAB.thumbnails(new THREE.Color('#22E6FF'))[mySkin()]}" alt="">Sphere: ${esc(SKINS[mySkin()].name)}</button>${LAB.unlocked() ? '<button class="btn ghost" id="goLab">Test lab</button>' : ''}</div>
    <div class="facts">
      <div><b>2–4</b><span>racers, one road each, braided together</span></div>
      <div><b>60 s</b><span>at most. The final collapse settles it</span></div>
      <div><b>90%</b><span>of the pot to the last sphere alive</span></div>
    </div>
    <p class="ctl"><span class="no-pad">${isTouch ? 'Tap anywhere to switch lanes.' : '<kbd>Space</kbd>, a click, any arrow key, or any controller button switches lanes. That is the whole control scheme.'}</span><span class="pad-only">Controller ready: any face button, bumper or trigger switches lanes. D-pad moves through menus, <kbd>A</kbd> picks, <kbd>B</kbd> goes back.</span></p>
    <p class="fine" style="padding:0">${CASH.enabled() ? (CASH.state.cfg.chainId === 4663 ? 'Real ETH on Robinhood Chain. Only stake what you can afford to lose.' : 'Robinhood Chain testnet: stakes are free test ETH from the Robinhood faucet. No real money.') : NET.enabled() ? 'Free online races need no wallet. Paid races open once the server finishes its setup.' : 'Practice runs entirely in this browser.'}</p>
  </div>`;
}
function skinsCard() {
  const th = SKINLAB.thumbnails(new THREE.Color('#22E6FF')), cur = mySkin();
  return `<div class="card lobby skins">
    <h2>Your sphere</h2>
    <p>Every sphere handles exactly the same. Your racer colour still marks your rail and name.</p>
    <div class="skingrid">${SKINS.map((k) => `<button class="skin${k.id === cur ? ' sel' : ''}" data-skin="${k.id}" title="${esc(k.note)}"><img src="${th[k.id]}" alt=""><span>${esc(k.name)}</span></button>`).join('')}</div>
    <div class="row"><button class="btn primary" id="skinsDone">Done</button><span class="label">${esc(SKINS[cur].name)}: ${esc(SKINS[cur].note)}</span></div>
  </div>`;
}
function practiceCard() {
  return `<div class="card lobby">
    <h2>Practice</h2>
    <p>Race computer players on a fresh road. Nothing is at stake.</p>
    <div style="display:grid;gap:6px"><span class="label">Racers</span><div class="seg">${SIZES.map((s) => `<button class="${s === game.size ? 'sel' : ''}" data-psize="${s}">${s}<small>${s === 2 ? 'you + 1' : `you + ${s - 1}`}</small></button>`).join('')}</div></div>
    <div style="display:grid;gap:6px"><span class="label">Computer players</span><div class="seg">${[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Sharp'], ['flawless', 'Flawless']].map(([k, l]) => `<button class="${k === game.bots ? 'sel' : ''}" data-pbots="${k}">${l}</button>`).join('')}</div></div>
    <div class="row"><button class="btn primary big" id="practiceGo">Start</button><button class="btn ghost" id="back">Back</button></div>
  </div>`;
}
const HOWTO = ['Your ball rolls forward on its own. Tap to switch lanes.', 'Red spikes are the only danger. Touch them and you are out.', 'Power-ups sit in the risky lane: a shield, an orb magnet, double orbs.', 'Gold orbs break ties at the 60 s cap.'];
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
  const why = R.decidedBy === 'orbs' ? 'Decided by orbs at the cap.' : R.decidedBy === 'taps' ? 'Same orbs at the cap: fewer taps won.' : R.decidedBy === 'draw' ? 'Dead level at the cap: settled by the draw fixed before the start.' : R.decidedBy === 'time' ? 'Survived to the cap.' : '';
  const cashOnline = game.mode === 'online' && CASH.isCashMatch();
  const life = (b) => (b === w ? (b.alive ? `${R.t.toFixed(1)} s, still rolling` : `${(b.deathTick / 60).toFixed(1)} s`) : b.alive ? `${R.t.toFixed(1)} s` : `out at ${(b.deathTick / 60).toFixed(1)} s`);
  return `<div class="card result">
    <h1 class="big" style="color:${w.color}">${mine ? 'You won' : `${esc(w.name)} wins`}</h1>
    ${why ? `<p>${why}</p>` : ''}
    <div class="places">${places.map((b) => `<div class="place${b === w ? ' first' : ''}" style="--c:${b.color}"><span class="n">${b.place}</span><i></i><b>${esc(b.i === game.me ? 'You' : b.name)}</b><span class="st">${life(b)} · ${b.orbs} orb${b.orbs === 1 ? '' : 's'}</span></div>`).join('')}</div>
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
  showOverlay(''); game.phase = 'countdown'; game.clock = -ms; INPUT.taps.length = 0; INPUT.enabled = true;
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
    else { INPUT.taps.length = 0; return; } // taps before GO don't count
  }
  if (game.phase !== 'play') return;
  if (game.phase === 'play') game.clock += dt * 1000 * (game.speed || 1);
  const due = Math.min(RACE_TICKS, Math.floor(game.clock / TICK_MS));
  let n = 0;
  while (!R.winner && R.tick < due && n++ < 240) {
    const inputs = {};
    if (game.me >= 0 && !game.auto && !(game.lab && game.lab.auto)) inputs[game.me] = INPUT.taps.length ? (INPUT.taps.shift(), TAP) : 0; // one tap per tick, in order
    stepWithFx(() => R.step(inputs));
  }
  if (R.winner && game.phase === 'play') raceOver();
}
// one tick plus everything the player should hear and see because of it
function stepWithFx(step) {
  const R = game.R, me = R.spheres.find((b) => b.i === game.me), before = me ? { target: me.target, orbs: me.orbs, alive: me.alive, got: me.got.length, used: me.shieldUsedTick } : null;
  const prevT = R.t;
  step();
  if (me && before && game.mode !== 'online') { // online: your own sounds come from the prediction (95_net)
    if (me.target !== before.target) { SFX.lane(me.target); game.flipTick = R.tick; }
    if (me.orbs > before.orbs) { SFX.orb(); }
    else if (me.got.length > before.got) { const o = R.course.orbs.find((x) => x.id === me.got[me.got.length - 1]); if (o && o.power) { SFX.power(); callout(o.power === 'shield' ? 'SHIELD' : o.power === 'magnet' ? 'MAGNET' : 'DOUBLE ORBS', o.power === 'shield' ? '#6FB7FF' : o.power === 'magnet' ? '#B48CFF' : '#FFF1A8', o.power === 'shield' ? 'The next hit passes through you' : o.power === 'magnet' ? 'Orbs in both lanes for 4 s' : 'Orbs count twice for 6 s'); padRumble(0.3, 80); } }
    if (me.shieldUsedTick !== before.used) { SFX.shieldPop(); padRumble(0.6, 160); }
    if (before.alive && !me.alive) { SFX.crash(true); padRumble(1, 380); $('#flash').classList.add('on'); setTimeout(() => $('#flash').classList.remove('on'), 60); WORLD.shake(1.2); }
  }
  for (const b of R.active) if (!b.alive && !game.outSeen.has(b.i)) {
    game.outSeen.add(b.i);
    if (b.i !== game.me && game.mode !== 'attract') { SFX.crash(false); }
    const left = R.active.filter((x) => x.alive).length;
    if (game.mode !== 'attract' && !R.winner) callout(b.i === game.me ? 'OUT' : `${b.name} out`, b.color, left === 2 && R.active.length > 2 ? 'Final two' : b.i === game.me ? 'Spectating the rest of the race' : '');
  }
  if (game.mode !== 'attract' && prevT < COLLAPSE_AT && R.t >= COLLAPSE_AT && !R.winner) callout('FINAL COLLAPSE', '#FF2E5B', 'The road tightens until someone breaks');
  if (game.mode !== 'attract' && prevT < RACE_SECONDS - 10 && R.t >= RACE_SECONDS - 10 && !R.winner) callout('10 SECONDS', '#FF9F1C');
  // near miss: you flipped out of a lane just before a solid hazard there
  if (game.mode !== 'online' && me && me.alive && R.tick - game.flipTick < 14 && R.tick - game.flipTick > 2) {
    for (const h of R.course.blocks) {
      if (h.s0 - SPHERE_R > R.s || h.s0 - SPHERE_R <= R.s - speedAt(R.t) * DT) continue;
      if ((h.lane ^ me.mirror) === 1 - me.cl && SIM0.hazardOn(h, R.t)) { SFX.near(); padRumble(0.15, 50); game.flipTick = -99; break; }
    }
  }
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
  const key = `${left}|${game.phase}|${R.active.map((b) => `${b.alive ? 1 : 0}${b.orbs}${b.shield}${R.tick < b.magnetT ? 1 : 0}${R.tick < b.doubleT ? 1 : 0}`).join('')}`;
  if (!force && key === lastHud) return; lastHud = key;
  $('#hTime').textContent = left; $('#hClock').classList.toggle('low', game.phase === 'play' && left <= 10);
  $('#hPhase').textContent = t >= COLLAPSE_AT ? 'Final collapse' : 'Last sphere alive wins';
  const pw = (b) => `${b.shield ? '<span class="pw sh" title="Shield">⬡</span>' : ''}${R.tick < b.magnetT ? '<span class="pw mg" title="Magnet">∪</span>' : ''}${R.tick < b.doubleT ? '<span class="pw db" title="Double orbs">×2</span>' : ''}`;
  $('#hField').innerHTML = R.active.map((b) => `<div class="racer${b.i === game.me ? ' you' : ''}${b.alive ? '' : ' out'}" style="--c:${b.color}"><i></i>${esc(b.i === game.me ? 'You' : b.name)}${pw(b)}${b.orbs ? ` <em>◆${b.orbs}</em>` : ''}</div>`).join('');
  const me = R.spheres.find((b) => b.i === game.me), banner = $('#banner');
  const showTip = game.mode !== 'attract' && game.phase === 'play' && R.t < 4;
  banner.hidden = !(showTip || (me && !me.alive && game.phase === 'play'));
  banner.textContent = me && !me.alive ? 'You are out. Spectating.' : PAD.used ? 'Any button switches lanes' : isTouch ? 'Tap anywhere to switch lanes' : 'Space or click to switch lanes';
}

// power-up state the world draws on a sphere
const powersOf = (b, R) => ({ shield: b.shield, magnet: R.tick < b.magnetT, double: R.tick < b.doubleT, shieldPop: b.shieldUsedTick > 0 && R.tick - b.shieldUsedTick < 30 });
// what the world draws this frame
function viewOf(now) {
  const R = game.R;
  if (!R) return null;
  const tNow = game.phase === 'intro' ? 0 : game.clock / 1000;
  const frac = clamp(game.clock / TICK_MS - R.tick, 0, 1);
  const tDraw = game.phase === 'done' ? R.t : Math.min(tNow, R.t + DT);
  const sDraw = SIM0.sAtT(Math.max(0, tDraw)) + Math.min(0, tDraw) * 20;
  const alive = R.active.filter((b) => b.alive);
  let follow = game.me;
  const me = R.spheres.find((b) => b.i === game.me);
  if (!me || (!me.alive && game.clock / 1000 - me.deathTick / 60 > 0.9)) follow = (R.winner && game.phase === 'done' ? R.winner : alive.sort((a, b) => b.orbs - a.orbs)[0] || R.active[0]).i;
  return {
    t: tDraw, s: sDraw, phase: game.phase, follow,
    spheres: R.active.map((b) => ({ i: b.i, x: sphereX(b, frac), alive: b.alive, deadS: SIM0.sAtTick(b.deathTick), winner: R.winner === b, ...powersOf(b, R) })),
  };
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    pollPad();
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
